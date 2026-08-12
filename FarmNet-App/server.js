const express = require('express');
const path = require('path');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const sqlite3 = require('sqlite3');
const fs = require('fs');
const dns = require('dns').promises;
const net = require('net');
const multer = require('multer');
require('dotenv').config({ path: path.join(__dirname, '.env') });

// Farm-Net backend.
// - Serves the static frontend and JSON API.
// - Handles login sessions, password hashing, and account preferences.
// - Stores users, rooms, equipment, bookings, loans, return photos, and audit data in SQLite.
const app = express();

// Application data directory for SQLite storage.
// Tests can override this to isolate their database and uploaded files.
const dataDir = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

// Directory for equipment return condition photos.
const photosDir = path.join(dataDir, 'return-photos');
if (!fs.existsSync(photosDir)) fs.mkdirSync(photosDir, { recursive: true });

// Multer storage: save files with a randomised name to avoid collisions.
const photoStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, photosDir),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase() || '.jpg';
    const safeName = `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`;
    cb(null, safeName);
  }
});

const uploadPhoto = multer({
  storage: photoStorage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB
  fileFilter: (_req, file, cb) => {
    if (!file.mimetype.startsWith('image/')) {
      return cb(new Error('Only image files are allowed.'));
    }
    cb(null, true);
  }
});

const dbFile = path.join(dataDir, 'lab-booking.db');
const db = new sqlite3.Database(dbFile);

function parseBooleanEnv(value, defaultValue) {
  if (value == null) return defaultValue;
  const normalized = String(value).trim().toLowerCase();
  if (['true', '1', 'yes', 'on'].includes(normalized)) return true;
  if (['false', '0', 'no', 'off'].includes(normalized)) return false;
  return defaultValue;
}

function parseNumberEnv(value, defaultValue) {
  if (value == null || String(value).trim() === '') return defaultValue;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : defaultValue;
}

const EMAIL_VERIFICATION_ENABLED = parseBooleanEnv(process.env.EMAIL_VERIFICATION_ENABLED, true);
const EMAIL_VERIFICATION_TIMEOUT_MS = parseNumberEnv(process.env.EMAIL_VERIFICATION_TIMEOUT_MS, 8000);
const EMAIL_VERIFICATION_MAX_MX = Math.max(1, Math.trunc(parseNumberEnv(process.env.EMAIL_VERIFICATION_MAX_MX, 3)));

// Handle database errors
db.on('error', (err) => {
  console.error('Database error:', err);
  process.exit(1);
});

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Session configuration for user login state.
app.use(session({
  secret: 'laboratory-booking-secret',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 24 * 60 * 60 * 1000 }
}));

/**
 * Execute a SELECT query and return the result rows.
 * @param {string} sql SQL query text with ? placeholders
 * @param {Array<any>} params Parameter values for placeholders
 * @returns {Promise<Array<any>>}
 */
function query(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

/**
 * Execute a statement that modifies data and return the statement context.
 * @param {string} sql SQL statement with ? placeholders
 * @param {Array<any>} params Parameter values for placeholders
 * @returns {Promise<import('sqlite3').Statement>}
 */
function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) reject(err);
      else resolve(this);
    });
  });
}

/**
 * Wait for a complete SMTP response line (supports multiline responses).
 * @param {import('net').Socket} socket
 * @param {{ buffer: string }} state
 * @param {number} timeoutMs
 * @returns {Promise<{ code: number, message: string }>}
 */
function readSmtpResponse(socket, state, timeoutMs) {
  return new Promise((resolve, reject) => {
    let timeoutId = null;

    function cleanup() {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
      socket.off('data', onData);
      socket.off('error', onError);
      socket.off('close', onClose);
    }

    function parseResponseFromBuffer() {
      const lines = state.buffer.split(/\r?\n/);
      if (!state.buffer.endsWith('\n')) {
        state.buffer = lines.pop() || '';
      } else {
        state.buffer = '';
      }

      if (lines.length === 0) {
        return null;
      }

      let candidateCode = null;
      let candidateMessage = null;
      for (const line of lines) {
        const match = line.match(/^(\d{3})([\s-])(.*)$/);
        if (!match) {
          continue;
        }

        const code = Number(match[1]);
        const separator = match[2];
        const message = match[3] || '';
        if (separator === ' ') {
          return { code, message };
        }

        candidateCode = code;
        candidateMessage = message;
      }

      if (candidateCode != null) {
        return { code: candidateCode, message: candidateMessage || '' };
      }

      return null;
    }

    function onData(chunk) {
      state.buffer += chunk.toString('utf8');
      const parsed = parseResponseFromBuffer();
      if (parsed) {
        cleanup();
        resolve(parsed);
      }
    }

    function onError(err) {
      cleanup();
      reject(err);
    }

    function onClose() {
      cleanup();
      reject(new Error('SMTP connection closed unexpectedly.'));
    }

    timeoutId = setTimeout(() => {
      cleanup();
      reject(new Error('SMTP response timed out.'));
    }, timeoutMs);

    socket.on('data', onData);
    socket.on('error', onError);
    socket.on('close', onClose);

    const immediate = parseResponseFromBuffer();
    if (immediate) {
      cleanup();
      resolve(immediate);
    }
  });
}

/**
 * Send a single SMTP command and await response.
 * @param {import('net').Socket} socket
 * @param {{ buffer: string }} state
 * @param {string} command
 * @param {number} timeoutMs
 * @returns {Promise<{ code: number, message: string }>}
 */
async function sendSmtpCommand(socket, state, command, timeoutMs) {
  socket.write(`${command}\r\n`);
  return readSmtpResponse(socket, state, timeoutMs);
}

/**
 * Validate mailbox using SMTP RCPT for one MX server.
 * @param {string} mxHost
 * @param {string} email
 * @returns {Promise<{ status: 'valid'|'invalid'|'indeterminate', reason?: string }>}
 */
async function verifyMailboxAgainstMx(mxHost, email) {
  const timeoutMs = EMAIL_VERIFICATION_TIMEOUT_MS;
  const socket = net.createConnection({ host: mxHost, port: 25, timeout: timeoutMs });

  await new Promise((resolve, reject) => {
    socket.once('connect', resolve);
    socket.once('error', reject);
    socket.once('timeout', () => reject(new Error('SMTP connect timeout.')));
  });

  const state = { buffer: '' };

  try {
    const greeting = await readSmtpResponse(socket, state, timeoutMs);
    if (greeting.code !== 220) {
      return { status: 'indeterminate', reason: `SMTP greeting failed (${greeting.code}).` };
    }

    const ehloHost = 'farm-net.local';
    const ehlo = await sendSmtpCommand(socket, state, `EHLO ${ehloHost}`, timeoutMs);
    if (ehlo.code < 200 || ehlo.code >= 400) {
      const helo = await sendSmtpCommand(socket, state, `HELO ${ehloHost}`, timeoutMs);
      if (helo.code < 200 || helo.code >= 400) {
        return { status: 'indeterminate', reason: `SMTP HELO failed (${helo.code}).` };
      }
    }

    const mailFrom = await sendSmtpCommand(socket, state, 'MAIL FROM:<>', timeoutMs);
    if (mailFrom.code < 200 || mailFrom.code >= 400) {
      return { status: 'indeterminate', reason: `SMTP MAIL FROM failed (${mailFrom.code}).` };
    }

    const rcptTo = await sendSmtpCommand(socket, state, `RCPT TO:<${email}>`, timeoutMs);
    if (rcptTo.code === 250 || rcptTo.code === 251 || rcptTo.code === 252) {
      return { status: 'valid' };
    }

    if (rcptTo.code >= 500 && rcptTo.code < 600) {
      return { status: 'invalid', reason: `Mailbox rejected by mail server (${rcptTo.code}).` };
    }

    return { status: 'indeterminate', reason: `Mailbox verification returned ${rcptTo.code}.` };
  } finally {
    try {
      socket.write('QUIT\r\n');
    } catch {
      // Ignore write failures when closing a transient verification socket.
    }
    socket.end();
    socket.destroy();
  }
}

/**
 * Verify that an email domain has MX records and mailbox is accepted by SMTP server.
 * @param {string} email
 * @returns {Promise<{ valid: boolean, error?: string }>}
 */
async function verifyEmailAddressExists(email) {
  const parts = String(email || '').split('@');
  const domain = String(parts[1] || '').toLowerCase().trim();

  if (!domain) {
    return { valid: false, error: 'Email domain is invalid.' };
  }

  let mxRecords;
  try {
    mxRecords = await dns.resolveMx(domain);
  } catch (err) {
    const dnsCode = String(err?.code || '').toUpperCase();
    const hardFailCodes = new Set(['ENOTFOUND', 'NXDOMAIN', 'ENODATA']);
    if (hardFailCodes.has(dnsCode)) {
      return { valid: false, error: 'Could not find mail servers for this email domain.' };
    }

    const knownProviderDomains = new Set([
      'gmail.com',
      'googlemail.com',
      'outlook.com',
      'hotmail.com',
      'live.com',
      'yahoo.com',
      'icloud.com'
    ]);
    if (!knownProviderDomains.has(domain)) {
      return { valid: false, error: 'Could not verify this email domain right now. Please try again later.' };
    }

    // Resolver/network failures are indeterminate and can happen in restricted
    // environments even for valid domains (for example gmail.com).
    console.warn(`Email MX lookup indeterminate for ${email} (${dnsCode || 'UNKNOWN'}): ${err?.message || 'lookup failed'}`);
    return { valid: true };
  }

  if (!Array.isArray(mxRecords) || mxRecords.length === 0) {
    return { valid: false, error: 'Could not find mail servers for this email domain.' };
  }

  const sortedMx = [...mxRecords]
    .filter((row) => row && row.exchange)
    .sort((a, b) => a.priority - b.priority)
    .slice(0, Math.max(1, EMAIL_VERIFICATION_MAX_MX));

  if (sortedMx.length === 0) {
    return { valid: false, error: 'Email domain does not publish usable mail servers.' };
  }

  let lastIndeterminateReason = 'Mailbox could not be verified.';

  for (const mx of sortedMx) {
    try {
      const result = await verifyMailboxAgainstMx(mx.exchange, email);
      if (result.status === 'valid') {
        return { valid: true };
      }
      if (result.status === 'invalid') {
        return { valid: false, error: result.reason || 'Mailbox does not exist.' };
      }
      lastIndeterminateReason = result.reason || lastIndeterminateReason;
    } catch (err) {
      lastIndeterminateReason = err.message || lastIndeterminateReason;
    }
  }

  // Some providers (including Gmail) can return inconclusive responses to
  // unauthenticated SMTP RCPT probing. If MX records exist, treat this as
  // deliverable to avoid false negatives while still rejecting explicit invalids.
  console.warn(`Email verification indeterminate for ${email}: ${lastIndeterminateReason}`);
  return { valid: true };
}

/**
 * Create a short stable prefix for equipment codes.
 * Example: "Laptop" -> "lap", "Microscope" -> "mic".
 * @param {string} name
 * @returns {string}
 */
function buildEquipmentCodePrefix(name) {
  const cleaned = String(name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  if (!cleaned) return 'eqp';
  return cleaned.slice(0, 3).padEnd(3, 'x');
}

/**
 * Add missing coded equipment units for a category.
 * @param {number} equipmentId
 * @param {string} equipmentName
 * @param {number} count
 * @returns {Promise<void>}
 */
async function addEquipmentUnits(equipmentId, equipmentName, count) {
  if (!Number.isInteger(count) || count <= 0) return;

  const prefix = buildEquipmentCodePrefix(equipmentName);
  const existingRows = await query('SELECT code FROM equipment_units WHERE equipmentId = ?', [equipmentId]);
  const existingCodes = new Set(existingRows.map((row) => String(row.code || '').toLowerCase()));

  let nextNumber = 1;
  let created = 0;

  while (created < count) {
    const code = `${prefix}${String(nextNumber).padStart(3, '0')}`;
    if (!existingCodes.has(code)) {
      await run('INSERT INTO equipment_units (equipmentId, code) VALUES (?, ?)', [equipmentId, code]);
      existingCodes.add(code);
      created += 1;
    }
    nextNumber += 1;
  }
}

/**
 * Compute the lifecycle status of equipment units from their condition and any active loan.
 * Status priority: in-maintenance (damaged) > reserved (future-dated loan) > overdue
 * (past return date) > checked-out (active loan) > available.
 * @param {number|null} [equipmentId] Restrict to a single equipment category, or all when omitted.
 * @returns {Promise<Array<{ id: number, equipmentId: number, code: string, condition: string, status: 'available'|'reserved'|'checked-out'|'overdue'|'in-maintenance' }>>}
 */
async function getEquipmentUnitStatuses(equipmentId = null) {
  const today = new Date().toISOString().slice(0, 10);

  const unitParams = [];
  let unitSql = 'SELECT id, equipmentId, code, condition FROM equipment_units';
  if (equipmentId != null) {
    unitSql += ' WHERE equipmentId = ?';
    unitParams.push(equipmentId);
  }
  const units = await query(unitSql, unitParams);

  const loanParams = [];
  let loanSql = "SELECT equipmentUnitId, borrowDate, returnDate FROM loans WHERE status = 'active' AND equipmentUnitId IS NOT NULL";
  if (equipmentId != null) {
    loanSql += ' AND equipmentId = ?';
    loanParams.push(equipmentId);
  }
  const activeLoans = await query(loanSql, loanParams);
  const loanByUnitId = new Map(activeLoans.map((loan) => [Number(loan.equipmentUnitId), loan]));

  return units.map((unit) => {
    const loan = loanByUnitId.get(Number(unit.id));
    let status = 'available';

    if (unit.condition === 'damaged') {
      status = 'in-maintenance';
    } else if (loan) {
      if (loan.borrowDate > today) {
        status = 'reserved';
      } else if (loan.returnDate < today) {
        status = 'overdue';
      } else {
        status = 'checked-out';
      }
    }

    return { id: unit.id, equipmentId: unit.equipmentId, code: unit.code, condition: unit.condition, status };
  });
}

/**
 * Remove unassigned equipment units from a category.
 * @param {number} equipmentId
 * @param {number} count
 * @returns {Promise<boolean>} True if units were removed successfully.
 */
async function removeUnassignedEquipmentUnits(equipmentId, count) {
  if (!Number.isInteger(count) || count <= 0) return true;

  const removable = await query(
    `SELECT eu.id
     FROM equipment_units eu
     LEFT JOIN loans l
       ON l.equipmentUnitId = eu.id
      AND l.status = 'active'
      AND l.returnDate >= date("now")
     WHERE eu.equipmentId = ?
       AND l.id IS NULL
     ORDER BY eu.id DESC
     LIMIT ?`,
    [equipmentId, count]
  );

  if (removable.length < count) {
    return false;
  }

  for (const unit of removable) {
    await run('DELETE FROM equipment_units WHERE id = ?', [unit.id]);
  }
  return true;
}

/**
 * Convert an HH:MM time string to minutes since midnight.
 * @param {string} time
 * @returns {number}
 */
function timeToMinutes(time) {
  const [hours, minutes] = time.split(':').map(Number);
  return hours * 60 + minutes;
}

/**
 * Return the Monday-Sunday week range (inclusive) containing a date.
 * @param {string} dateStr Date in YYYY-MM-DD.
 * @returns {{ weekStart: string, weekEnd: string }}
 */
function getWeekRange(dateStr) {
  const [year, month, day] = dateStr.split('-').map(Number);
  const monday = new Date(year, month - 1, day);
  const dayOfWeek = monday.getDay();
  monday.setDate(monday.getDate() + (dayOfWeek === 0 ? -6 : 1 - dayOfWeek));

  const toDateString = (date) =>
    `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

  const sunday = new Date(monday);
  sunday.setDate(sunday.getDate() + 6);

  return { weekStart: toDateString(monday), weekEnd: toDateString(sunday) };
}

/**
 * Add a number of days to a YYYY-MM-DD date string, in local time.
 * @param {string} dateStr Date in YYYY-MM-DD.
 * @param {number} days Signed day offset.
 * @returns {string} Shifted date in YYYY-MM-DD.
 */
function addDaysToDateString(dateStr, days) {
  const [year, month, day] = dateStr.split('-').map(Number);
  const shifted = new Date(year, month - 1, day);
  shifted.setDate(shifted.getDate() + days);
  return `${shifted.getFullYear()}-${String(shifted.getMonth() + 1).padStart(2, '0')}-${String(shifted.getDate()).padStart(2, '0')}`;
}

/**
 * Add a number of months to a YYYY-MM-DD date string, clamping the day to the
 * last valid day of the target month (e.g. 31 Jan + 1 month -> 28/29 Feb,
 * never rolling over into March).
 * @param {string} dateStr Date in YYYY-MM-DD.
 * @param {number} months Signed month offset.
 * @returns {string} Shifted date in YYYY-MM-DD.
 */
function addMonthsToDateString(dateStr, months) {
  const [year, month, day] = dateStr.split('-').map(Number);
  const totalMonths = (month - 1) + months;
  const targetYear = year + Math.floor(totalMonths / 12);
  const targetMonthIndex = ((totalMonths % 12) + 12) % 12;
  const lastDayOfTargetMonth = new Date(targetYear, targetMonthIndex + 1, 0).getDate();
  const clampedDay = Math.min(day, lastDayOfTargetMonth);
  return `${targetYear}-${String(targetMonthIndex + 1).padStart(2, '0')}-${String(clampedDay).padStart(2, '0')}`;
}

/**
 * Parse an optional positive integer from request input.
 * @param {*} value
 * @returns {number|null} Parsed integer, null if the value was empty/absent, or NaN if invalid.
 */
function parseOptionalPositiveInt(value) {
  if (value === undefined || value === null || value === '') return null;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) return NaN;
  return parsed;
}

/**
 * Validate a requested booking against a room's configured policy: booking
 * length limits, blackout windows, and the weekly per-user frequency cap.
 * @param {object} room Room row including policy columns.
 * @param {string} date YYYY-MM-DD
 * @param {string} startTime HH:MM
 * @param {number} durationHours
 * @param {number} userId
 * @param {number[]} [excludeBookingIds] Booking IDs to exclude from frequency counts (when editing
 *   one booking, or every occurrence of a series being rescheduled together).
 * @param {string[]} [additionalSeriesDates] Other occurrence dates from the same not-yet-created
 *   recurring request, counted alongside committed bookings so a multi-occurrence-per-week
 *   frequency (e.g. daily) can't slip past the weekly cap before any occurrence is inserted.
 * @returns {Promise<string|null>} Error message, or null if the booking satisfies policy.
 */
async function checkRoomBookingPolicy(room, date, startTime, durationHours, userId, excludeBookingIds = [], additionalSeriesDates = []) {
  const durationMinutes = Math.round(durationHours * 60);

  if (room.minDurationMinutes != null && durationMinutes < room.minDurationMinutes) {
    return `This room requires bookings of at least ${room.minDurationMinutes} minutes.`;
  }
  if (room.maxDurationMinutes != null && durationMinutes > room.maxDurationMinutes) {
    return `This room allows bookings of at most ${room.maxDurationMinutes} minutes.`;
  }

  const requestedStart = timeToMinutes(startTime);
  const requestedEnd = requestedStart + durationMinutes;

  const blackouts = await query(
    'SELECT startTime, endTime FROM room_blackouts WHERE roomId = ? AND date = ?',
    [room.id, date]
  );
  const hasBlackoutOverlap = blackouts.some((blackout) => {
    const blackoutStart = timeToMinutes(blackout.startTime);
    const blackoutEnd = timeToMinutes(blackout.endTime);
    return requestedStart < blackoutEnd && blackoutStart < requestedEnd;
  });
  if (hasBlackoutOverlap) {
    return 'Selected time falls within a blackout period for this room.';
  }

  if (room.maxBookingsPerUserPerWeek != null) {
    const { weekStart, weekEnd } = getWeekRange(date);
    const excludeIds = excludeBookingIds.length > 0 ? excludeBookingIds : [0];
    const weekBookings = await query(
      `SELECT id FROM bookings
       WHERE roomId = ? AND userId = ? AND date >= ? AND date <= ?
         AND status IN ('active', 'pending')
         AND id NOT IN (${excludeIds.map(() => '?').join(',')})`,
      [room.id, userId, weekStart, weekEnd, ...excludeIds]
    );
    const otherSeriesOccurrencesInWeek = additionalSeriesDates.filter(
      (seriesDate) => seriesDate !== date && seriesDate >= weekStart && seriesDate <= weekEnd
    ).length;
    if (weekBookings.length + otherSeriesOccurrencesInWeek >= room.maxBookingsPerUserPerWeek) {
      return `You have reached the maximum of ${room.maxBookingsPerUserPerWeek} booking(s) per week for this room.`;
    }
  }

  return null;
}

/**
 * Ensure the SQLite schema exists and seed default data.
 * This uses CREATE TABLE IF NOT EXISTS so it is safe to run every startup.
 */
async function initDatabase() {
  await run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    passwordHash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'user',
    theme TEXT NOT NULL DEFAULT 'dark'
  )`);

  // Rename username column to email if it exists
  const columns = await query("PRAGMA table_info(users)");
  const hasUsernameColumn = columns.some(col => col.name === 'username');
  if (hasUsernameColumn) {
    await run(`ALTER TABLE users RENAME COLUMN username TO email`);
  }

  // Rename legacy password column to passwordHash if present.
  const hasPasswordHashColumn = columns.some(col => col.name === 'passwordHash');
  const hasLegacyPasswordColumn = columns.some(col => col.name === 'password');
  if (!hasPasswordHashColumn && hasLegacyPasswordColumn) {
    await run(`ALTER TABLE users RENAME COLUMN password TO passwordHash`);
  }

  // If both are missing (unexpected legacy state), add passwordHash to keep auth functional.
  if (!hasPasswordHashColumn && !hasLegacyPasswordColumn) {
    await run(`ALTER TABLE users ADD COLUMN passwordHash TEXT`);
  }

  // Add role column if it doesn't exist
  const hasRoleColumn = columns.some(col => col.name === 'role');
  if (!hasRoleColumn) {
    await run(`ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'user'`);
  }

  const hasThemeColumn = columns.some(col => col.name === 'theme');
  if (!hasThemeColumn) {
    await run(`ALTER TABLE users ADD COLUMN theme TEXT NOT NULL DEFAULT 'dark'`);
  }

  await run(`CREATE TABLE IF NOT EXISTS rooms (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    location TEXT NOT NULL
  )`);

  // Room policy columns: booking length limits, weekly frequency cap, and
  // whether new bookings need admin approval before becoming active.
  const roomColumns = await query('PRAGMA table_info(rooms)');
  const roomPolicyColumns = [
    ['minDurationMinutes', 'INTEGER'],
    ['maxDurationMinutes', 'INTEGER'],
    ['maxBookingsPerUserPerWeek', 'INTEGER'],
    ['requiresApproval', 'INTEGER NOT NULL DEFAULT 0']
  ];
  for (const [columnName, columnType] of roomPolicyColumns) {
    if (!roomColumns.some((col) => col.name === columnName)) {
      await run(`ALTER TABLE rooms ADD COLUMN ${columnName} ${columnType}`);
    }
  }

  await run(`CREATE TABLE IF NOT EXISTS room_blackouts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    roomId INTEGER NOT NULL,
    date TEXT NOT NULL,
    startTime TEXT NOT NULL,
    endTime TEXT NOT NULL,
    reason TEXT,
    createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(roomId) REFERENCES rooms(id)
  )`);

  await run(`CREATE TABLE IF NOT EXISTS equipment (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    quantity INTEGER NOT NULL
  )`);

  await run(`CREATE TABLE IF NOT EXISTS equipment_units (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    equipmentId INTEGER NOT NULL,
    code TEXT NOT NULL UNIQUE,
    condition TEXT NOT NULL DEFAULT 'working',
    FOREIGN KEY(equipmentId) REFERENCES equipment(id)
  )`);

  const equipmentUnitColumns = await query('PRAGMA table_info(equipment_units)');
  const hasConditionColumn = equipmentUnitColumns.some(col => col.name === 'condition');
  if (!hasConditionColumn) {
    await run(`ALTER TABLE equipment_units ADD COLUMN condition TEXT NOT NULL DEFAULT 'working'`);
  }

  await run(`CREATE TABLE IF NOT EXISTS bookings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    userId INTEGER NOT NULL,
    roomId INTEGER NOT NULL,
    date TEXT NOT NULL,
    startTime TEXT NOT NULL,
    durationHours INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(userId) REFERENCES users(id),
    FOREIGN KEY(roomId) REFERENCES rooms(id)
  )`);

  // Check if status column exists, add it if not
  const bookingColumns = await query("PRAGMA table_info(bookings)");
  const hasStatusColumn = bookingColumns.some(col => col.name === 'status');
  if (!hasStatusColumn) {
    await run(`ALTER TABLE bookings ADD COLUMN status TEXT NOT NULL DEFAULT 'active'`);
  }

  // seriesId groups the occurrences created by a single recurring booking request.
  // It's the id of the first occurrence in the series; null for one-off bookings.
  const hasSeriesId = bookingColumns.some(col => col.name === 'seriesId');
  if (!hasSeriesId) {
    await run(`ALTER TABLE bookings ADD COLUMN seriesId INTEGER`);
  }

  await run(`CREATE TABLE IF NOT EXISTS loans (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    userId INTEGER NOT NULL,
    equipmentId INTEGER NOT NULL,
    equipmentUnitId INTEGER,
    borrowDate TEXT NOT NULL,
    returnDate TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    returnCondition TEXT,
    returnConditionPhotoPath TEXT,
    returnedAt TEXT,
    createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(userId) REFERENCES users(id),
    FOREIGN KEY(equipmentId) REFERENCES equipment(id),
    FOREIGN KEY(equipmentUnitId) REFERENCES equipment_units(id)
  )`);

  // Check if status column exists, add it if not
  const loanColumns = await query("PRAGMA table_info(loans)");
  const hasLoanStatus = loanColumns.some(col => col.name === 'status');
  if (!hasLoanStatus) {
    await run(`ALTER TABLE loans ADD COLUMN status TEXT NOT NULL DEFAULT 'active'`);
  }

  const hasEquipmentUnitId = loanColumns.some(col => col.name === 'equipmentUnitId');
  if (!hasEquipmentUnitId) {
    await run(`ALTER TABLE loans ADD COLUMN equipmentUnitId INTEGER`);
  }

  const hasReturnCondition = loanColumns.some(col => col.name === 'returnCondition');
  if (!hasReturnCondition) {
    await run(`ALTER TABLE loans ADD COLUMN returnCondition TEXT`);
  }

  const hasReturnConditionPhotoPath = loanColumns.some(col => col.name === 'returnConditionPhotoPath');
  if (!hasReturnConditionPhotoPath) {
    await run(`ALTER TABLE loans ADD COLUMN returnConditionPhotoPath TEXT`);
  }

  const hasReturnedAt = loanColumns.some(col => col.name === 'returnedAt');
  if (!hasReturnedAt) {
    await run(`ALTER TABLE loans ADD COLUMN returnedAt TEXT`);
  }

  await run(`CREATE TABLE IF NOT EXISTS activity_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    userId INTEGER NOT NULL,
    eventType TEXT NOT NULL,
    resourceType TEXT NOT NULL,
    resourceId INTEGER NOT NULL,
    description TEXT NOT NULL,
    timestamp TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(userId) REFERENCES users(id)
  )`);

  const rooms = await query('SELECT id FROM rooms LIMIT 1');
  if (rooms.length === 0) {
    await run('INSERT INTO rooms (name, location) VALUES (?, ?)', ['Chemistry Lab', 'Block A, Floor 2']);
    await run('INSERT INTO rooms (name, location) VALUES (?, ?)', ['Computer Lab', 'Block B, Floor 1']);
    await run('INSERT INTO rooms (name, location) VALUES (?, ?)', ['Physics Lab', 'Block C, Floor 3']);
  }

  const equipment = await query('SELECT id FROM equipment LIMIT 1');
  if (equipment.length === 0) {
    await run('INSERT INTO equipment (name, quantity) VALUES (?, ?)', ['Laptop', 10]);
    await run('INSERT INTO equipment (name, quantity) VALUES (?, ?)', ['Microscope', 6]);
    await run('INSERT INTO equipment (name, quantity) VALUES (?, ?)', ['Oscilloscope', 4]);
  }

  // Backfill coded equipment units for existing equipment rows.
  const equipmentRows = await query('SELECT id, name, quantity FROM equipment');
  for (const item of equipmentRows) {
    const currentUnitCountRows = await query('SELECT COUNT(*) AS count FROM equipment_units WHERE equipmentId = ?', [item.id]);
    const currentUnitCount = Number(currentUnitCountRows[0]?.count || 0);
    const targetQuantity = Number(item.quantity || 0);
    if (targetQuantity > currentUnitCount) {
      await addEquipmentUnits(item.id, item.name, targetQuantity - currentUnitCount);
    }
  }
}

// Middleware helper: only allow authenticated users to access protected routes.
function requireLogin(req, res, next) {
  if (!req.session.userId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

// Middleware helper: only allow admin users to access admin routes.
function requireAdmin(req, res, next) {
  if (!req.session.userId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  if (req.session.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required.' });
  }
  next();
}

/**
 * Log an activity event to the activity history.
 * @param {number} userId User ID performing the action
 * @param {string} eventType Type of event (e.g., 'booking_created', 'booking_cancelled')
 * @param {string} resourceType Type of resource affected (e.g., 'booking', 'loan')
 * @param {number} resourceId ID of the resource affected
 * @param {string} description Human-readable description of the event
 * @returns {Promise<void>}
 */
async function logActivity(userId, eventType, resourceType, resourceId, description) {
  try {
    await run(
      'INSERT INTO activity_history (userId, eventType, resourceType, resourceId, description) VALUES (?, ?, ?, ?, ?)',
      [userId, eventType, resourceType, resourceId, description]
    );
  } catch (err) {
    console.error('Failed to log activity:', err);
  }
}

// Register a new user with email and password.
app.post('/api/register', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required.' });
  }

  // Validate email format
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return res.status(400).json({ error: 'Please enter a valid email address.' });
  }

  if (EMAIL_VERIFICATION_ENABLED) {
    const verification = await verifyEmailAddressExists(email);
    if (!verification.valid) {
      return res.status(400).json({ error: verification.error || 'Email mailbox could not be verified.' });
    }
  }

  const passwordHash = await bcrypt.hash(password, 10);
  try {
    await run('INSERT INTO users (email, passwordHash) VALUES (?, ?)', [email, passwordHash]);
    res.json({ message: 'Registration successful. You can now log in.' });
  } catch (err) {
    if (err.message.includes('UNIQUE')) {
      return res.status(400).json({ error: 'Email already exists.' });
    }
    res.status(500).json({ error: 'Could not create account.' });
  }
});

// User login endpoint.
// Authenticate an existing user and start a session.
app.post('/api/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required.' });
  }

  const users = await query('SELECT * FROM users WHERE email = ?', [email]);
  if (users.length === 0) {
    return res.status(400).json({ error: 'Invalid email or password.' });
  }

  const user = users[0];
  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) {
    return res.status(400).json({ error: 'Invalid email or password.' });
  }

  req.session.userId = user.id;
  req.session.email = user.email;
  req.session.role = user.role;
  req.session.theme = user.theme || 'dark';
  res.json({
    message: 'Login successful.',
    email: user.email,
    role: user.role,
    theme: req.session.theme
  });
});

// Logout endpoint clears the current session.
// End the current user session.
app.post('/api/logout', (req, res) => {
  req.session.destroy(() => {
    res.json({ message: 'Logged out.' });
  });
});

// Return authentication status and logged-in email.
app.get('/api/profile', (req, res) => {
  if (!req.session.userId) {
    return res.json({ authenticated: false });
  }
  res.json({
    authenticated: true,
    email: req.session.email,
    role: req.session.role,
    theme: req.session.theme || 'dark'
  });
});

// Read and update persisted user preferences.
app.patch('/api/preferences', requireLogin, async (req, res) => {
  const theme = String(req.body?.theme || '').trim().toLowerCase();
  const allowedThemes = ['dark', 'light'];

  if (!allowedThemes.includes(theme)) {
    return res.status(400).json({ error: 'Invalid theme. Allowed values are dark and light.' });
  }

  await run('UPDATE users SET theme = ? WHERE id = ?', [theme, req.session.userId]);
  req.session.theme = theme;

  res.json({
    message: 'Preferences updated successfully.',
    preferences: { theme }
  });
});

// Change password for the currently authenticated user.
app.post('/api/change-password', requireLogin, async (req, res) => {
  const currentPassword = String(req.body?.currentPassword || '').trim();
  const newPassword = String(req.body?.newPassword || '').trim();

  if (!currentPassword || !newPassword) {
    return res.status(400).json({ error: 'Current password and new password are required.' });
  }

  if (newPassword.length < 8) {
    return res.status(400).json({ error: 'New password must be at least 8 characters long.' });
  }

  if (currentPassword === newPassword) {
    return res.status(400).json({ error: 'New password must be different from current password.' });
  }

  const users = await query('SELECT id, passwordHash FROM users WHERE id = ?', [req.session.userId]);
  if (users.length === 0) {
    return res.status(404).json({ error: 'User not found.' });
  }

  const user = users[0];
  const valid = await bcrypt.compare(currentPassword, user.passwordHash);
  if (!valid) {
    return res.status(400).json({ error: 'Current password is incorrect.' });
  }

  const newPasswordHash = await bcrypt.hash(newPassword, 10);
  await run('UPDATE users SET passwordHash = ? WHERE id = ?', [newPasswordHash, user.id]);

  await logActivity(req.session.userId, 'password_changed', 'user', req.session.userId, `${req.session.email} changed account password`);

  res.json({ message: 'Password changed successfully.' });
});

// Return available rooms and equipment for the dashboard.
app.get('/api/resources', requireLogin, async (req, res) => {
  const rooms = await query('SELECT * FROM rooms');
  const equipment = await query(
    `SELECT e.id, e.name, e.quantity,
            COALESCE(unitCounts.totalUnits, 0) AS totalUnits
     FROM equipment e
     LEFT JOIN (
       SELECT equipmentId, COUNT(*) AS totalUnits
       FROM equipment_units
       GROUP BY equipmentId
     ) unitCounts ON unitCounts.equipmentId = e.id`
  );

  // Derive per-status unit counts (available/reserved/checked-out/overdue/in-maintenance)
  // so damaged, reserved, and overdue units are all excluded from what's offered to borrow.
  const unitStatuses = await getEquipmentUnitStatuses();
  const statusCountsByEquipmentId = unitStatuses.reduce((acc, unit) => {
    if (!acc[unit.equipmentId]) {
      acc[unit.equipmentId] = { available: 0, reserved: 0, checkedOut: 0, overdue: 0, inMaintenance: 0 };
    }
    const bucket = acc[unit.equipmentId];
    if (unit.status === 'available') bucket.available += 1;
    else if (unit.status === 'reserved') bucket.reserved += 1;
    else if (unit.status === 'checked-out') bucket.checkedOut += 1;
    else if (unit.status === 'overdue') bucket.overdue += 1;
    else if (unit.status === 'in-maintenance') bucket.inMaintenance += 1;
    return acc;
  }, {});

  const equipmentWithAvailability = equipment.map((item) => {
    const counts = statusCountsByEquipmentId[item.id]
      || { available: 0, reserved: 0, checkedOut: 0, overdue: 0, inMaintenance: 0 };
    const totalQuantity = Number(item.totalUnits || item.quantity || 0);
    return {
      id: item.id,
      name: item.name,
      quantity: totalQuantity,
      available: counts.available,
      statusCounts: counts
    };
  });

  res.json({ rooms, equipment: equipmentWithAvailability });
});

// Return the current user's room bookings and equipment loans.
app.get('/api/my-requests', requireLogin, async (req, res) => {
  const userId = req.session.userId;
  const statusFilter = req.query.status || 'active'; // 'active' or 'all'

  let bookings;
  if (statusFilter === 'all') {
    bookings = await query(
      `SELECT b.id, r.name AS roomName, r.location, b.date, b.startTime, b.durationHours, b.status, b.seriesId
       FROM bookings b
       JOIN rooms r ON r.id = b.roomId
       WHERE b.userId = ?
       ORDER BY b.date DESC, b.startTime DESC`,
      [userId]
    );
  } else {
    const today = new Date().toISOString().slice(0, 10);
    const nowTime = new Date().toTimeString().slice(0, 5);

    bookings = await query(
      `SELECT b.id, r.name AS roomName, r.location, b.date, b.startTime, b.durationHours, b.status, b.seriesId
       FROM bookings b
       JOIN rooms r ON r.id = b.roomId
       WHERE b.userId = ?
         AND b.status IN ('active', 'pending')
         AND (b.date > ? OR (b.date = ? AND b.startTime > ?))
       ORDER BY b.date DESC, b.startTime DESC`,
      [userId, today, today, nowTime]
    );
  }

  let loans;
  if (statusFilter === 'all') {
    loans = await query(
      `SELECT l.id, e.name AS equipmentName, eu.code AS equipmentCode, l.borrowDate, l.returnDate,
              l.status, l.returnCondition, l.returnConditionPhotoPath, l.returnedAt
       FROM loans l
       JOIN equipment e ON e.id = l.equipmentId
       LEFT JOIN equipment_units eu ON eu.id = l.equipmentUnitId
       WHERE l.userId = ?
       ORDER BY l.borrowDate DESC`,
      [userId]
    );
  } else {
    const today = new Date().toISOString().slice(0, 10);
    loans = await query(
      `SELECT l.id, e.name AS equipmentName, eu.code AS equipmentCode, l.borrowDate, l.returnDate,
              l.status, l.returnCondition, l.returnConditionPhotoPath, l.returnedAt
       FROM loans l
       JOIN equipment e ON e.id = l.equipmentId
       LEFT JOIN equipment_units eu ON eu.id = l.equipmentUnitId
       WHERE l.userId = ?
         AND l.status = 'active'
         AND l.returnDate >= ?
       ORDER BY l.borrowDate DESC`,
      [userId, today]
    );
  }

  res.json({ bookings, loans });
});

// Cancel a room booking owned by the current user.
app.post('/api/cancel-booking', requireLogin, async (req, res) => {
  const { bookingId } = req.body;
  if (!bookingId) {
    return res.status(400).json({ error: 'Booking ID is required.' });
  }

  // Ensure users can only cancel their own booking.
  const existing = await query('SELECT * FROM bookings WHERE id = ? AND userId = ?', [bookingId, req.session.userId]);
  if (existing.length === 0) {
    return res.status(404).json({ error: 'Booking not found or not owned by user.' });
  }

  const booking = existing[0];
  if (!['active', 'pending'].includes(booking.status)) {
    return res.status(400).json({ error: 'Booking is already cancelled.' });
  }

  const bookingDateTime = new Date(`${booking.date}T${booking.startTime}:00`);
  if (bookingDateTime <= new Date()) {
    return res.status(400).json({ error: 'Past bookings cannot be cancelled.' });
  }

  await run('UPDATE bookings SET status = ? WHERE id = ?', ['cancelled', bookingId]);

  // Log booking cancellation event
  const description = `Cancelled booking for ${booking.date} at ${booking.startTime}`;
  await logActivity(req.session.userId, 'booking_cancelled', 'booking', bookingId, description);

  res.json({ message: 'Booking cancelled successfully.' });
});

// Cancel an equipment loan owned by the current user.
app.post('/api/cancel-loan', requireLogin, async (req, res) => {
  const { loanId } = req.body;
  if (!loanId) {
    return res.status(400).json({ error: 'Loan ID is required.' });
  }

  const existing = await query('SELECT * FROM loans WHERE id = ? AND userId = ?', [loanId, req.session.userId]);
  if (existing.length === 0) {
    return res.status(404).json({ error: 'Loan not found or not owned by user.' });
  }

  const loan = existing[0];
  if (loan.status !== 'active') {
    return res.status(400).json({ error: 'Only active loans can be cancelled.' });
  }

  const today = new Date().toISOString().slice(0, 10);
  if (loan.returnDate < today) {
    return res.status(400).json({ error: 'Past loans cannot be cancelled.' });
  }

  await run('UPDATE loans SET status = ? WHERE id = ?', ['cancelled', loanId]);
  res.json({ message: 'Loan cancelled successfully.' });
});

// Mark an equipment loan as returned and capture return condition notes + optional photo.
// Accepts multipart/form-data so a photo file can be uploaded directly.
app.post('/api/return-loan', requireLogin, (req, res, next) => {
  uploadPhoto.single('photo')(req, res, (err) => {
    if (err instanceof multer.MulterError) {
      return res.status(400).json({ error: `Upload error: ${err.message}` });
    }
    if (err) {
      return res.status(400).json({ error: err.message || 'File upload failed.' });
    }
    next();
  });
}, async (req, res) => {
  const loanId = Number(req.body.loanId);
  if (!loanId) {
    return res.status(400).json({ error: 'Loan ID is required.' });
  }

  // Admins can return any user's equipment; everyone else can only return their own.
  const isAdmin = req.session.role === 'admin';
  const existing = isAdmin
    ? await query(
        `SELECT l.*, u.email AS ownerEmail FROM loans l JOIN users u ON u.id = l.userId WHERE l.id = ?`,
        [loanId]
      )
    : await query(
        `SELECT l.*, u.email AS ownerEmail FROM loans l JOIN users u ON u.id = l.userId WHERE l.id = ? AND l.userId = ?`,
        [loanId, req.session.userId]
      );
  if (existing.length === 0) {
    // Clean up any uploaded file if loan ownership check fails.
    if (req.file) fs.unlink(req.file.path, () => {});
    return res.status(404).json({ error: 'Loan not found or not owned by user.' });
  }

  const loan = existing[0];
  if (loan.status !== 'active') {
    if (req.file) fs.unlink(req.file.path, () => {});
    return res.status(400).json({ error: 'Only active loans can be returned.' });
  }

  const conditionText = typeof req.body.returnCondition === 'string' ? req.body.returnCondition.trim() : '';
  if (!conditionText) {
    if (req.file) fs.unlink(req.file.path, () => {});
    return res.status(400).json({ error: 'Condition description is required when returning equipment.' });
  }
  if (conditionText.length > 1000) {
    if (req.file) fs.unlink(req.file.path, () => {});
    return res.status(400).json({ error: 'Condition description is too long (max 1000 characters).' });
  }

  // Store only the filename (not full path) to avoid path traversal on retrieval.
  const photoFilename = req.file ? req.file.filename : null;
  const flaggedDamaged = ['true', 'on', '1', 'yes'].includes(String(req.body.damaged || '').trim().toLowerCase());

  await run(
    'UPDATE loans SET status = ?, returnCondition = ?, returnConditionPhotoPath = ?, returnedAt = CURRENT_TIMESTAMP WHERE id = ?',
    ['returned', conditionText, photoFilename, loanId]
  );

  const description = loan.userId === req.session.userId
    ? `Returned equipment loan ${loanId}. Condition: ${conditionText}`
    : `${req.session.email} returned equipment loan ${loanId} on behalf of ${loan.ownerEmail}. Condition: ${conditionText}`;
  await logActivity(req.session.userId, 'loan_returned', 'loan', loanId, description);

  if (flaggedDamaged && loan.equipmentUnitId) {
    await run('UPDATE equipment_units SET condition = ? WHERE id = ?', ['damaged', loan.equipmentUnitId]);
    const unitRows = await query('SELECT code FROM equipment_units WHERE id = ?', [loan.equipmentUnitId]);
    const unitCode = unitRows[0]?.code || loan.equipmentUnitId;
    const damageDescription = `${req.session.email} flagged item ${unitCode} as damaged while returning loan ${loanId}`;
    await logActivity(req.session.userId, 'equipment_condition_updated', 'equipment_unit', loan.equipmentUnitId, damageDescription);
  }

  res.json({
    message: flaggedDamaged
      ? 'Equipment returned successfully and flagged as damaged.'
      : 'Equipment returned successfully.'
  });
});

// Serve a return-condition photo for the current user's own loan.
app.get('/api/loans/:id/photo', requireLogin, async (req, res) => {
  const loanId = Number(req.params.id);
  if (!Number.isFinite(loanId) || loanId <= 0) {
    return res.status(400).json({ error: 'Invalid loan ID.' });
  }

  const rows = await query(
    'SELECT returnConditionPhotoPath FROM loans WHERE id = ? AND userId = ?',
    [loanId, req.session.userId]
  );
  if (rows.length === 0 || !rows[0].returnConditionPhotoPath) {
    return res.status(404).json({ error: 'No photo found for this loan.' });
  }

  // Use only the stored filename joined against the known photos directory
  // to prevent path traversal attacks.
  const filename = path.basename(rows[0].returnConditionPhotoPath);
  const filePath = path.join(photosDir, filename);

  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'Photo file not found on server.' });
  }

  res.sendFile(filePath);
});

// Serve a return-condition photo for a specific loan. Admin only.
app.get('/api/admin/loans/:id/photo', requireAdmin, async (req, res) => {
  const loanId = Number(req.params.id);
  if (!Number.isFinite(loanId) || loanId <= 0) {
    return res.status(400).json({ error: 'Invalid loan ID.' });
  }

  const rows = await query('SELECT returnConditionPhotoPath FROM loans WHERE id = ?', [loanId]);
  if (rows.length === 0 || !rows[0].returnConditionPhotoPath) {
    return res.status(404).json({ error: 'No photo found for this loan.' });
  }

  // Use only the stored filename joined against the known photos directory
  // to prevent path traversal attacks.
  const filename = path.basename(rows[0].returnConditionPhotoPath);
  const filePath = path.join(photosDir, filename);

  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'Photo file not found on server.' });
  }

  res.sendFile(filePath);
});

// Edit a room booking owned by the current user.
app.post('/api/edit-booking', requireLogin, async (req, res) => {
  const { bookingId, date, startTime, durationHours } = req.body;
  if (!bookingId || !date || !startTime || durationHours == null) {
    return res.status(400).json({ error: 'Booking ID, date, start time and duration are required.' });
  }

  const duration = Number(durationHours);
  const timeMatch = /^[0-9]{2}:[0-9]{2}$/.test(startTime);
  const minute = timeMatch ? Number(startTime.split(':')[1]) : null;

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(400).json({ error: 'Date must be in YYYY-MM-DD format.' });
  }
  if (!timeMatch || minute % 15 !== 0) {
    return res.status(400).json({ error: 'Start time must be in 15-minute increments.' });
  }
  if (!Number.isFinite(duration) || duration <= 0 || duration % 0.25 !== 0) {
    return res.status(400).json({ error: 'Duration must be in 15-minute increments.' });
  }

  const existing = await query('SELECT * FROM bookings WHERE id = ? AND userId = ?', [bookingId, req.session.userId]);
  if (existing.length === 0) {
    return res.status(404).json({ error: 'Booking not found or not owned by user.' });
  }

  const booking = existing[0];
  if (!['active', 'pending'].includes(booking.status)) {
    return res.status(400).json({ error: 'Only active bookings can be edited.' });
  }

  const requestedDateTime = new Date(`${date}T${startTime}:00`);
  if (Number.isNaN(requestedDateTime.getTime()) || requestedDateTime <= new Date()) {
    return res.status(400).json({ error: 'Booking must be in the future.' });
  }

  const roomRows = await query('SELECT * FROM rooms WHERE id = ?', [booking.roomId]);
  if (roomRows.length > 0) {
    const policyError = await checkRoomBookingPolicy(roomRows[0], date, startTime, duration, req.session.userId, [bookingId]);
    if (policyError) {
      return res.status(400).json({ error: policyError });
    }
  }

  const existingBookings = await query(
    `SELECT id, startTime, durationHours FROM bookings WHERE roomId = ? AND date = ? AND status IN ('active', 'pending') AND id != ?`,
    [booking.roomId, date, bookingId]
  );

  const requestedStart = (() => {
    const [hours, minutes] = startTime.split(':').map(Number);
    return hours * 60 + minutes;
  })();
  const requestedEnd = requestedStart + duration * 60;

  const hasOverlap = existingBookings.some((item) => {
    const [hours, minutes] = item.startTime.split(':').map(Number);
    const existingStart = hours * 60 + minutes;
    const existingDuration = Number(item.durationHours) || 0;
    const existingEnd = existingStart + existingDuration * 60;
    return requestedStart < existingEnd && existingStart < requestedEnd;
  });

  if (hasOverlap) {
    return res.status(400).json({ error: 'Selected room is already booked during that time.' });
  }

  await run(
    'UPDATE bookings SET date = ?, startTime = ?, durationHours = ? WHERE id = ?',
    [date, startTime, duration, bookingId]
  );

  const description = `Updated booking to ${date} at ${startTime} for ${duration} hours`;
  await logActivity(req.session.userId, 'booking_updated', 'booking', bookingId, description);

  res.json({ message: 'Booking updated successfully.' });
});

// Edit an equipment loan return date owned by the current user.
app.post('/api/edit-loan', requireLogin, async (req, res) => {
  const { loanId, returnDate } = req.body;
  if (!loanId || !returnDate) {
    return res.status(400).json({ error: 'Loan ID and return date are required.' });
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(returnDate)) {
    return res.status(400).json({ error: 'Return date must be in YYYY-MM-DD format.' });
  }

  const existing = await query('SELECT * FROM loans WHERE id = ? AND userId = ?', [loanId, req.session.userId]);
  if (existing.length === 0) {
    return res.status(404).json({ error: 'Loan not found or not owned by user.' });
  }

  const loan = existing[0];
  if (loan.status !== 'active') {
    return res.status(400).json({ error: 'Only active loans can be edited.' });
  }

  const today = new Date().toISOString().slice(0, 10);
  if (loan.returnDate < today) {
    return res.status(400).json({ error: 'Past loans cannot be edited.' });
  }

  if (returnDate < today) {
    return res.status(400).json({ error: 'Return date must be today or later.' });
  }

  if (returnDate < loan.borrowDate) {
    return res.status(400).json({ error: 'Return date cannot be before borrow date.' });
  }

  await run('UPDATE loans SET returnDate = ? WHERE id = ?', [returnDate, loanId]);

  const description = `Updated loan return date to ${returnDate}`;
  await logActivity(req.session.userId, 'loan_updated', 'loan', loanId, description);

  res.json({ message: 'Loan updated successfully.' });
});

// Submit a room booking request.
// Validates future time, 15-minute increments, and overlapping bookings.
app.post('/api/book-room', requireLogin, async (req, res) => {
  const { roomId, date, startTime, durationHours, recurrence } = req.body;
  if (!roomId || !date || !startTime || durationHours == null) {
    return res.status(400).json({ error: 'Room, date, start time and duration are required.' });
  }

  const duration = Number(durationHours);
  const timeMatch = /^[0-9]{2}:[0-9]{2}$/.test(startTime);
  const minute = timeMatch ? Number(startTime.split(':')[1]) : null;

  if (!timeMatch || minute % 15 !== 0) {
    return res.status(400).json({ error: 'Start time must be in 15-minute increments.' });
  }
  if (!Number.isFinite(duration) || duration <= 0 || duration % 0.25 !== 0) {
    return res.status(400).json({ error: 'Duration must be in 15-minute increments.' });
  }

  const requestedDateTime = new Date(`${date}T${startTime}:00`);
  if (Number.isNaN(requestedDateTime.getTime()) || requestedDateTime <= new Date()) {
    return res.status(400).json({ error: 'Booking must be in the future.' });
  }

  // A recurring request expands into one date per occurrence.
  const RECURRENCE_STEP_DAYS = { daily: 1, weekly: 7 };
  let occurrenceDates = [date];
  if (recurrence != null) {
    if (typeof recurrence !== 'object' || !['daily', 'weekly', 'monthly'].includes(recurrence.frequency)) {
      return res.status(400).json({ error: "Recurrence frequency must be 'daily', 'weekly', or 'monthly'." });
    }
    const occurrences = Number(recurrence.occurrences);
    if (!Number.isInteger(occurrences) || occurrences < 2 || occurrences > 52) {
      return res.status(400).json({ error: 'A recurring booking must repeat between 2 and 52 times.' });
    }
    occurrenceDates = recurrence.frequency === 'monthly'
      ? Array.from({ length: occurrences }, (_, i) => addMonthsToDateString(date, i))
      : Array.from({ length: occurrences }, (_, i) => addDaysToDateString(date, i * RECURRENCE_STEP_DAYS[recurrence.frequency]));
  }

  const roomRows = await query('SELECT * FROM rooms WHERE id = ?', [roomId]);
  if (roomRows.length === 0) {
    return res.status(400).json({ error: 'Room not found.' });
  }
  const room = roomRows[0];

  const requestedStart = timeToMinutes(startTime);
  const requestedEnd = requestedStart + duration * 60;
  const isRecurring = occurrenceDates.length > 1;

  // Validate every occurrence before creating any of them, so a recurring booking
  // either fully succeeds or fails outright rather than leaving a partial series.
  for (const occurrenceDate of occurrenceDates) {
    const policyError = await checkRoomBookingPolicy(room, occurrenceDate, startTime, duration, req.session.userId, [], occurrenceDates);
    if (policyError) {
      return res.status(400).json({ error: isRecurring ? `${policyError} (on ${occurrenceDate})` : policyError });
    }

    const existingBookings = await query(
      `SELECT startTime, durationHours FROM bookings WHERE roomId = ? AND date = ? AND status IN ('active', 'pending')`,
      [roomId, occurrenceDate]
    );
    const hasOverlap = existingBookings.some((booking) => {
      const existingStart = timeToMinutes(booking.startTime);
      const existingEnd = existingStart + (Number(booking.durationHours) || 0) * 60;
      return requestedStart < existingEnd && existingStart < requestedEnd;
    });
    if (hasOverlap) {
      return res.status(400).json({
        error: isRecurring
          ? `Selected room is already booked during that time (on ${occurrenceDate}).`
          : 'Selected room is already booked during that time.'
      });
    }
  }

  const status = room.requiresApproval ? 'pending' : 'active';
  let seriesId = null;
  const createdIds = [];

  for (const occurrenceDate of occurrenceDates) {
    const result = await run(
      'INSERT INTO bookings (userId, roomId, date, startTime, durationHours, status, seriesId) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [req.session.userId, roomId, occurrenceDate, startTime, duration, status, seriesId]
    );
    createdIds.push(result.lastID);
    if (isRecurring && seriesId === null) {
      // The first occurrence's own id becomes the series identifier for the rest.
      seriesId = result.lastID;
      await run('UPDATE bookings SET seriesId = ? WHERE id = ?', [seriesId, result.lastID]);
    }
  }

  const description = isRecurring
    ? `${status === 'pending' ? 'Requested' : 'Booked'} ${room.name} ${recurrence.frequency} (${occurrenceDates.length} occurrences starting ${date}) at ${startTime} for ${duration} hours${status === 'pending' ? ' (pending admin approval)' : ''}`
    : (status === 'pending'
      ? `Requested ${room.name} on ${date} at ${startTime} for ${duration} hours (pending admin approval)`
      : `Booked ${room.name} on ${date} at ${startTime} for ${duration} hours`);
  await logActivity(req.session.userId, status === 'pending' ? 'booking_requested' : 'booking_created', 'booking', createdIds[0], description);

  res.json({
    message: status === 'pending'
      ? (isRecurring
        ? `Booking requests submitted for ${occurrenceDates.length} occurrences and are awaiting admin approval.`
        : 'Booking request submitted and is awaiting admin approval.')
      : (isRecurring
        ? `Room booked successfully for ${occurrenceDates.length} occurrences.`
        : 'Room booked successfully.'),
    status,
    occurrences: occurrenceDates.length
  });
});

// Cancel every remaining active/pending occurrence in a recurring booking series
// owned by the current user, so users don't have to cancel each week individually.
app.post('/api/cancel-booking-series', requireLogin, async (req, res) => {
  const seriesId = Number(req.body.seriesId);
  if (!Number.isFinite(seriesId) || seriesId <= 0) {
    return res.status(400).json({ error: 'Series ID is required.' });
  }

  const today = new Date().toISOString().slice(0, 10);
  const occurrences = await query(
    `SELECT id FROM bookings
     WHERE seriesId = ? AND userId = ? AND status IN ('active', 'pending') AND date >= ?`,
    [seriesId, req.session.userId, today]
  );

  if (occurrences.length === 0) {
    return res.status(404).json({ error: 'No upcoming bookings found for this series.' });
  }

  const ids = occurrences.map((row) => row.id);
  await run(`UPDATE bookings SET status = 'cancelled' WHERE id IN (${ids.map(() => '?').join(',')})`, ids);

  const description = `Cancelled ${ids.length} upcoming occurrence(s) of recurring booking series #${seriesId}`;
  await logActivity(req.session.userId, 'booking_series_cancelled', 'booking', seriesId, description);

  res.json({ message: `Cancelled ${ids.length} upcoming booking(s) in the series.` });
});

// Reschedule every remaining occurrence in a recurring booking series owned by the
// current user. `bookingId` identifies the specific occurrence being edited; its new
// date becomes the anchor, and every other still-upcoming occurrence in the series
// shifts by the same number of days (preserving the series' relative spacing) and
// adopts the same start time and duration.
app.post('/api/edit-booking-series', requireLogin, async (req, res) => {
  const { bookingId, date, startTime, durationHours } = req.body;
  if (!bookingId || !date || !startTime || durationHours == null) {
    return res.status(400).json({ error: 'Booking ID, date, start time and duration are required.' });
  }

  const duration = Number(durationHours);
  const timeMatch = /^[0-9]{2}:[0-9]{2}$/.test(startTime);
  const minute = timeMatch ? Number(startTime.split(':')[1]) : null;

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(400).json({ error: 'Date must be in YYYY-MM-DD format.' });
  }
  if (!timeMatch || minute % 15 !== 0) {
    return res.status(400).json({ error: 'Start time must be in 15-minute increments.' });
  }
  if (!Number.isFinite(duration) || duration <= 0 || duration % 0.25 !== 0) {
    return res.status(400).json({ error: 'Duration must be in 15-minute increments.' });
  }

  const anchorRows = await query('SELECT * FROM bookings WHERE id = ? AND userId = ?', [bookingId, req.session.userId]);
  if (anchorRows.length === 0) {
    return res.status(404).json({ error: 'Booking not found or not owned by user.' });
  }
  const anchor = anchorRows[0];
  if (!anchor.seriesId) {
    return res.status(400).json({ error: 'This booking is not part of a recurring series.' });
  }
  if (!['active', 'pending'].includes(anchor.status)) {
    return res.status(400).json({ error: 'Only active bookings can be edited.' });
  }

  const requestedDateTime = new Date(`${date}T${startTime}:00`);
  if (Number.isNaN(requestedDateTime.getTime()) || requestedDateTime <= new Date()) {
    return res.status(400).json({ error: 'Booking must be in the future.' });
  }

  const dayDelta = Math.round(
    (new Date(`${date}T00:00:00`) - new Date(`${anchor.date}T00:00:00`)) / (24 * 60 * 60 * 1000)
  );

  const today = new Date().toISOString().slice(0, 10);
  const seriesOccurrences = await query(
    `SELECT id, date FROM bookings
     WHERE seriesId = ? AND userId = ? AND status IN ('active', 'pending') AND (date >= ? OR id = ?)`,
    [anchor.seriesId, req.session.userId, today, anchor.id]
  );

  const roomRows = await query('SELECT * FROM rooms WHERE id = ?', [anchor.roomId]);
  const room = roomRows[0];
  const seriesBookingIds = seriesOccurrences.map((row) => row.id);
  const updates = seriesOccurrences.map((occurrence) => ({
    id: occurrence.id,
    newDate: dayDelta === 0 ? occurrence.date : addDaysToDateString(occurrence.date, dayDelta)
  }));

  const requestedStart = timeToMinutes(startTime);
  const requestedEnd = requestedStart + duration * 60;

  // Validate every shifted occurrence before changing any of them.
  for (const update of updates) {
    if (room) {
      const policyError = await checkRoomBookingPolicy(room, update.newDate, startTime, duration, req.session.userId, seriesBookingIds);
      if (policyError) {
        return res.status(400).json({ error: `${policyError} (on ${update.newDate})` });
      }
    }

    const existingBookings = await query(
      `SELECT startTime, durationHours FROM bookings
       WHERE roomId = ? AND date = ? AND status IN ('active', 'pending') AND id NOT IN (${seriesBookingIds.map(() => '?').join(',')})`,
      [anchor.roomId, update.newDate, ...seriesBookingIds]
    );
    const hasOverlap = existingBookings.some((item) => {
      const existingStart = timeToMinutes(item.startTime);
      const existingEnd = existingStart + (Number(item.durationHours) || 0) * 60;
      return requestedStart < existingEnd && existingStart < requestedEnd;
    });
    if (hasOverlap) {
      return res.status(400).json({ error: `Selected room is already booked during that time (on ${update.newDate}).` });
    }
  }

  for (const update of updates) {
    await run(
      'UPDATE bookings SET date = ?, startTime = ?, durationHours = ? WHERE id = ?',
      [update.newDate, startTime, duration, update.id]
    );
  }

  const description = `Rescheduled ${updates.length} upcoming occurrence(s) of recurring booking series #${anchor.seriesId} to ${startTime} for ${duration} hours${dayDelta !== 0 ? `, shifted by ${dayDelta} day(s)` : ''}`;
  await logActivity(req.session.userId, 'booking_series_updated', 'booking', anchor.seriesId, description);

  res.json({ message: `Rescheduled ${updates.length} upcoming booking(s) in the series.` });
});

// Submit an equipment loan request and enforce quantity availability.
app.post('/api/borrow-equipment', requireLogin, async (req, res) => {
  const { equipmentId, days, borrowerEmail } = req.body;
  if (!equipmentId || !days) {
    return res.status(400).json({ error: 'Equipment and borrow duration are required.' });
  }

  const parsedDays = Number(days);
  if (!Number.isInteger(parsedDays) || parsedDays <= 0) {
    return res.status(400).json({ error: 'Borrow duration must be a whole number of days.' });
  }

  // Admins may borrow equipment on behalf of another user by email; everyone else can only borrow for themselves.
  let targetUserId = req.session.userId;
  let targetEmail = req.session.email;
  const requestedEmail = typeof borrowerEmail === 'string' ? borrowerEmail.trim() : '';
  if (requestedEmail) {
    if (req.session.role !== 'admin') {
      return res.status(403).json({ error: 'Only admins can borrow equipment on behalf of another user.' });
    }
    const targetUsers = await query('SELECT id, email FROM users WHERE email = ?', [requestedEmail]);
    if (targetUsers.length === 0) {
      return res.status(404).json({ error: 'No user found with that email.' });
    }
    targetUserId = targetUsers[0].id;
    targetEmail = targetUsers[0].email;
  }

  const equip = await query('SELECT * FROM equipment WHERE id = ?', [equipmentId]);
  if (equip.length === 0) {
    return res.status(404).json({ error: 'Equipment not found.' });
  }

  const equipmentRow = equip[0];
  const unitCountRows = await query('SELECT COUNT(*) AS count FROM equipment_units WHERE equipmentId = ?', [equipmentId]);
  const unitCount = Number(unitCountRows[0]?.count || 0);
  const requiredUnits = Number(equipmentRow.quantity || 0);

  if (unitCount < requiredUnits) {
    await addEquipmentUnits(equipmentId, equipmentRow.name, requiredUnits - unitCount);
  }

  // Only units whose computed status is 'available' can be assigned — this excludes
  // units that are checked out, overdue, reserved, or in maintenance.
  const unitStatuses = await getEquipmentUnitStatuses(equipmentId);
  const availableUnits = unitStatuses.filter((unit) => unit.status === 'available');

  // Legacy loans created before equipmentUnitId existed aren't tied to a specific unit,
  // so reserve a slot from the shuffled pool for each one rather than risk over-assigning.
  const legacyActiveLoanRows = await query(
    `SELECT COUNT(*) AS count FROM loans WHERE equipmentId = ? AND status = 'active' AND equipmentUnitId IS NULL`,
    [equipmentId]
  );
  const legacyActiveLoans = Number(legacyActiveLoanRows[0]?.count || 0);

  for (let i = availableUnits.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [availableUnits[i], availableUnits[j]] = [availableUnits[j], availableUnits[i]];
  }

  const availablePool = availableUnits.slice(legacyActiveLoans);
  if (availablePool.length <= 0) {
    return res.status(400).json({ error: 'No equipment available to borrow right now.' });
  }

  const assignedUnit = availablePool[0];

  const borrowDate = new Date().toISOString().slice(0, 10);
  const returnDate = new Date(Date.now() + parsedDays * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const result = await run(
    'INSERT INTO loans (userId, equipmentId, equipmentUnitId, borrowDate, returnDate) VALUES (?, ?, ?, ?, ?)',
    [targetUserId, equipmentId, assignedUnit.id, borrowDate, returnDate]
  );

  if (targetUserId !== req.session.userId) {
    const description = `${req.session.email} borrowed ${equipmentRow.name} (${assignedUnit.code}) on behalf of ${targetEmail}, due ${returnDate}`;
    await logActivity(req.session.userId, 'admin_equipment_borrowed', 'loan', result.lastID, description);
    return res.json({
      message: `Equipment borrowed successfully on behalf of ${targetEmail}. Assigned item: ${assignedUnit.code}.`,
      equipmentCode: assignedUnit.code
    });
  }

  res.json({ message: `Equipment borrowed successfully. Assigned item: ${assignedUnit.code}.`, equipmentCode: assignedUnit.code });
});

// Return bookings for a single room across a 7-day week for the timetable view.
// weekStart must be a Monday in YYYY-MM-DD format.
app.get('/api/timetable', requireLogin, async (req, res) => {
  const { roomId: roomIdParam, weekStart } = req.query;
  const roomId = Number(roomIdParam);
  if (!Number.isFinite(roomId) || roomId <= 0) {
    return res.status(400).json({ error: 'A valid roomId is required.' });
  }
  if (!weekStart || !/^\d{4}-\d{2}-\d{2}$/.test(weekStart)) {
    return res.status(400).json({ error: 'A valid weekStart date (YYYY-MM-DD) is required.' });
  }

  // Build array of 7 date strings starting from weekStart.
  const dates = [];
  const base = new Date(`${weekStart}T00:00:00`);
  for (let i = 0; i < 7; i++) {
    const d = new Date(base);
    d.setDate(base.getDate() + i);
    dates.push(d.toISOString().slice(0, 10));
  }

  const weekEnd = dates[6];

  const bookings = await query(
    `SELECT b.date, b.startTime, b.durationHours
     FROM bookings b
     WHERE b.roomId = ? AND b.date >= ? AND b.date <= ? AND b.status IN ('active', 'pending')
     ORDER BY b.date, b.startTime`,
    [roomId, weekStart, weekEnd]
  );

  res.json({ dates, bookings });
});

// Return all bookings for a room on a given date for the schedule visualisation.
app.get('/api/rooms/:roomId/schedule', requireLogin, async (req, res) => {
  const roomId = Number(req.params.roomId);
  const { date } = req.query;
  if (!Number.isFinite(roomId) || roomId <= 0 || !date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(400).json({ error: 'Room ID and date are required.' });
  }
  const bookings = await query(
    `SELECT b.startTime, b.durationHours, u.email
     FROM bookings b JOIN users u ON b.userId = u.id
     WHERE b.roomId = ? AND b.date = ? AND b.status IN ('active', 'pending')
     ORDER BY b.startTime`,
    [roomId, date]
  );
  res.json(bookings);
});

// Return all users for admin role management.
app.get('/api/admin/users', requireAdmin, async (req, res) => {
  const users = await query(
    'SELECT id, email, role FROM users ORDER BY email ASC'
  );
  res.json({ users });
});

// Return bookings for admin management.
app.get('/api/admin/bookings', requireAdmin, async (req, res) => {
  const statusFilter = req.query.status || 'active'; // 'active' or 'all'

  let bookings;
  if (statusFilter === 'all') {
    bookings = await query(
      `SELECT b.id, b.userId, u.email AS userEmail, r.name AS roomName, r.location,
              b.date, b.startTime, b.durationHours, b.status, b.createdAt, b.seriesId
       FROM bookings b
       JOIN users u ON u.id = b.userId
       JOIN rooms r ON r.id = b.roomId
       ORDER BY b.date DESC, b.startTime DESC`,
      []
    );
  } else {
    const today = new Date().toISOString().slice(0, 10);
    const nowTime = new Date().toTimeString().slice(0, 5);
    bookings = await query(
      `SELECT b.id, b.userId, u.email AS userEmail, r.name AS roomName, r.location,
              b.date, b.startTime, b.durationHours, b.status, b.createdAt, b.seriesId
       FROM bookings b
       JOIN users u ON u.id = b.userId
       JOIN rooms r ON r.id = b.roomId
       WHERE b.status = 'active'
         AND (b.date > ? OR (b.date = ? AND b.startTime > ?))
       ORDER BY b.date DESC, b.startTime DESC`,
      [today, today, nowTime]
    );
  }

  res.json({ bookings });
});

// Return equipment loans for admin management.
app.get('/api/admin/loans', requireAdmin, async (req, res) => {
  const statusFilter = req.query.status || 'active'; // 'active' or 'all'

  let loans;
  if (statusFilter === 'all') {
    loans = await query(
      `SELECT l.id, l.userId, u.email AS userEmail, e.name AS equipmentName,
              eu.code AS equipmentCode, l.borrowDate, l.returnDate, l.status,
              l.returnCondition, l.returnConditionPhotoPath, l.returnedAt, l.createdAt
       FROM loans l
       JOIN users u ON u.id = l.userId
       JOIN equipment e ON e.id = l.equipmentId
       LEFT JOIN equipment_units eu ON eu.id = l.equipmentUnitId
       ORDER BY l.borrowDate DESC, l.id DESC`,
      []
    );
  } else {
    const today = new Date().toISOString().slice(0, 10);
    loans = await query(
      `SELECT l.id, l.userId, u.email AS userEmail, e.name AS equipmentName,
              eu.code AS equipmentCode, l.borrowDate, l.returnDate, l.status,
              l.returnCondition, l.returnConditionPhotoPath, l.returnedAt, l.createdAt
       FROM loans l
       JOIN users u ON u.id = l.userId
       JOIN equipment e ON e.id = l.equipmentId
       LEFT JOIN equipment_units eu ON eu.id = l.equipmentUnitId
       WHERE l.status = 'active'
         AND l.returnDate >= ?
       ORDER BY l.borrowDate DESC, l.id DESC`,
      [today]
    );
  }

  res.json({ loans });
});

// Cancel a booking as admin.
app.post('/api/admin/bookings/:id/cancel', requireAdmin, async (req, res) => {
  const bookingId = Number(req.params.id);
  if (!Number.isFinite(bookingId) || bookingId <= 0) {
    return res.status(400).json({ error: 'Invalid booking ID.' });
  }

  const rows = await query(
    `SELECT b.id, b.userId, b.date, b.startTime, b.status, u.email AS userEmail
     FROM bookings b
     JOIN users u ON u.id = b.userId
     WHERE b.id = ?`,
    [bookingId]
  );

  if (rows.length === 0) {
    return res.status(404).json({ error: 'Booking not found.' });
  }

  const booking = rows[0];
  if (!['active', 'pending'].includes(booking.status)) {
    return res.status(400).json({ error: 'Booking is already cancelled.' });
  }

  const bookingDateTime = new Date(`${booking.date}T${booking.startTime}:00`);
  if (bookingDateTime <= new Date()) {
    return res.status(400).json({ error: 'Past bookings cannot be cancelled.' });
  }

  await run('UPDATE bookings SET status = ? WHERE id = ?', ['cancelled', bookingId]);

  const description = `${req.session.email} cancelled booking #${bookingId} for ${booking.userEmail} (${booking.date} ${booking.startTime})`;
  await logActivity(req.session.userId, 'admin_booking_cancelled', 'booking', bookingId, description);

  res.json({ message: 'Booking cancelled successfully.' });
});

// Approve a pending booking as admin.
app.post('/api/admin/bookings/:id/approve', requireAdmin, async (req, res) => {
  const bookingId = Number(req.params.id);
  if (!Number.isFinite(bookingId) || bookingId <= 0) {
    return res.status(400).json({ error: 'Invalid booking ID.' });
  }

  const rows = await query(
    `SELECT b.id, b.date, b.startTime, b.status, u.email AS userEmail
     FROM bookings b
     JOIN users u ON u.id = b.userId
     WHERE b.id = ?`,
    [bookingId]
  );

  if (rows.length === 0) {
    return res.status(404).json({ error: 'Booking not found.' });
  }

  const booking = rows[0];
  if (booking.status !== 'pending') {
    return res.status(400).json({ error: 'Only pending bookings can be approved.' });
  }

  await run('UPDATE bookings SET status = ? WHERE id = ?', ['active', bookingId]);

  const description = `${req.session.email} approved booking #${bookingId} for ${booking.userEmail} (${booking.date} ${booking.startTime})`;
  await logActivity(req.session.userId, 'admin_booking_approved', 'booking', bookingId, description);

  res.json({ message: 'Booking approved successfully.' });
});

// Deny a pending booking as admin.
app.post('/api/admin/bookings/:id/deny', requireAdmin, async (req, res) => {
  const bookingId = Number(req.params.id);
  const reason = String(req.body?.reason || '').trim();

  if (!Number.isFinite(bookingId) || bookingId <= 0) {
    return res.status(400).json({ error: 'Invalid booking ID.' });
  }

  const rows = await query(
    `SELECT b.id, b.date, b.startTime, b.status, u.email AS userEmail
     FROM bookings b
     JOIN users u ON u.id = b.userId
     WHERE b.id = ?`,
    [bookingId]
  );

  if (rows.length === 0) {
    return res.status(404).json({ error: 'Booking not found.' });
  }

  const booking = rows[0];
  if (booking.status !== 'pending') {
    return res.status(400).json({ error: 'Only pending bookings can be denied.' });
  }

  await run('UPDATE bookings SET status = ? WHERE id = ?', ['denied', bookingId]);

  const description = `${req.session.email} denied booking #${bookingId} for ${booking.userEmail} (${booking.date} ${booking.startTime})`
    + (reason ? ` — Reason: ${reason}` : '');
  await logActivity(req.session.userId, 'admin_booking_denied', 'booking', bookingId, description);

  res.json({ message: 'Booking denied successfully.' });
});

// Cancel every upcoming active/pending occurrence of a recurring booking series. Admin only.
app.post('/api/admin/bookings/series/:seriesId/cancel', requireAdmin, async (req, res) => {
  const seriesId = Number(req.params.seriesId);
  if (!Number.isFinite(seriesId) || seriesId <= 0) {
    return res.status(400).json({ error: 'Invalid series ID.' });
  }

  const today = new Date().toISOString().slice(0, 10);
  const rows = await query(
    `SELECT b.id, u.email AS userEmail
     FROM bookings b
     JOIN users u ON u.id = b.userId
     WHERE b.seriesId = ? AND b.status IN ('active', 'pending') AND b.date >= ?`,
    [seriesId, today]
  );

  if (rows.length === 0) {
    return res.status(404).json({ error: 'No upcoming bookings found for this series.' });
  }

  const ids = rows.map((row) => row.id);
  await run(`UPDATE bookings SET status = 'cancelled' WHERE id IN (${ids.map(() => '?').join(',')})`, ids);

  const description = `${req.session.email} cancelled ${ids.length} upcoming occurrence(s) of recurring booking series #${seriesId} for ${rows[0].userEmail}`;
  await logActivity(req.session.userId, 'admin_booking_series_cancelled', 'booking', seriesId, description);

  res.json({ message: `Cancelled ${ids.length} upcoming booking(s) in the series.` });
});

// Approve every pending occurrence of a recurring booking series. Admin only.
app.post('/api/admin/bookings/series/:seriesId/approve', requireAdmin, async (req, res) => {
  const seriesId = Number(req.params.seriesId);
  if (!Number.isFinite(seriesId) || seriesId <= 0) {
    return res.status(400).json({ error: 'Invalid series ID.' });
  }

  const rows = await query(
    `SELECT b.id, u.email AS userEmail
     FROM bookings b
     JOIN users u ON u.id = b.userId
     WHERE b.seriesId = ? AND b.status = 'pending'`,
    [seriesId]
  );

  if (rows.length === 0) {
    return res.status(404).json({ error: 'No pending bookings found for this series.' });
  }

  const ids = rows.map((row) => row.id);
  await run(`UPDATE bookings SET status = 'active' WHERE id IN (${ids.map(() => '?').join(',')})`, ids);

  const description = `${req.session.email} approved ${ids.length} pending occurrence(s) of recurring booking series #${seriesId} for ${rows[0].userEmail}`;
  await logActivity(req.session.userId, 'admin_booking_series_approved', 'booking', seriesId, description);

  res.json({ message: `Approved ${ids.length} pending booking(s) in the series.` });
});

// Deny every pending occurrence of a recurring booking series. Admin only.
app.post('/api/admin/bookings/series/:seriesId/deny', requireAdmin, async (req, res) => {
  const seriesId = Number(req.params.seriesId);
  const reason = String(req.body?.reason || '').trim();
  if (!Number.isFinite(seriesId) || seriesId <= 0) {
    return res.status(400).json({ error: 'Invalid series ID.' });
  }

  const rows = await query(
    `SELECT b.id, u.email AS userEmail
     FROM bookings b
     JOIN users u ON u.id = b.userId
     WHERE b.seriesId = ? AND b.status = 'pending'`,
    [seriesId]
  );

  if (rows.length === 0) {
    return res.status(404).json({ error: 'No pending bookings found for this series.' });
  }

  const ids = rows.map((row) => row.id);
  await run(`UPDATE bookings SET status = 'denied' WHERE id IN (${ids.map(() => '?').join(',')})`, ids);

  const description = `${req.session.email} denied ${ids.length} pending occurrence(s) of recurring booking series #${seriesId} for ${rows[0].userEmail}`
    + (reason ? ` — Reason: ${reason}` : '');
  await logActivity(req.session.userId, 'admin_booking_series_denied', 'booking', seriesId, description);

  res.json({ message: `Denied ${ids.length} pending booking(s) in the series.` });
});

// Edit a booking as admin.
app.patch('/api/admin/bookings/:id', requireAdmin, async (req, res) => {
  const bookingId = Number(req.params.id);
  const { date, startTime, durationHours } = req.body;

  if (!Number.isFinite(bookingId) || bookingId <= 0) {
    return res.status(400).json({ error: 'Invalid booking ID.' });
  }

  if (!date || !startTime || durationHours == null) {
    return res.status(400).json({ error: 'Date, start time and duration are required.' });
  }

  const duration = Number(durationHours);
  const timeMatch = /^[0-9]{2}:[0-9]{2}$/.test(startTime);
  const minute = timeMatch ? Number(startTime.split(':')[1]) : null;

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(400).json({ error: 'Date must be in YYYY-MM-DD format.' });
  }
  if (!timeMatch || minute % 15 !== 0) {
    return res.status(400).json({ error: 'Start time must be in 15-minute increments.' });
  }
  if (!Number.isFinite(duration) || duration <= 0 || duration % 0.25 !== 0) {
    return res.status(400).json({ error: 'Duration must be in 15-minute increments.' });
  }

  const existingRows = await query(
    `SELECT b.id, b.userId, b.roomId, b.date, b.startTime, b.durationHours, b.status, u.email AS userEmail
     FROM bookings b
     JOIN users u ON u.id = b.userId
     WHERE b.id = ?`,
    [bookingId]
  );

  if (existingRows.length === 0) {
    return res.status(404).json({ error: 'Booking not found.' });
  }

  const booking = existingRows[0];
  if (!['active', 'pending'].includes(booking.status)) {
    return res.status(400).json({ error: 'Only active bookings can be edited.' });
  }

  const requestedDateTime = new Date(`${date}T${startTime}:00`);
  if (Number.isNaN(requestedDateTime.getTime()) || requestedDateTime <= new Date()) {
    return res.status(400).json({ error: 'Booking must be in the future.' });
  }

  const existingBookings = await query(
    `SELECT id, startTime, durationHours FROM bookings WHERE roomId = ? AND date = ? AND status IN ('active', 'pending') AND id != ?`,
    [booking.roomId, date, bookingId]
  );

  const requestedStart = (() => {
    const [hours, minutes] = startTime.split(':').map(Number);
    return hours * 60 + minutes;
  })();
  const requestedEnd = requestedStart + duration * 60;

  const hasOverlap = existingBookings.some((item) => {
    const [hours, minutes] = item.startTime.split(':').map(Number);
    const existingStart = hours * 60 + minutes;
    const existingDuration = Number(item.durationHours) || 0;
    const existingEnd = existingStart + existingDuration * 60;
    return requestedStart < existingEnd && existingStart < requestedEnd;
  });

  if (hasOverlap) {
    return res.status(400).json({ error: 'Selected room is already booked during that time.' });
  }

  await run(
    'UPDATE bookings SET date = ?, startTime = ?, durationHours = ? WHERE id = ?',
    [date, startTime, duration, bookingId]
  );

  const description = `${req.session.email} edited booking #${bookingId} for ${booking.userEmail} from ${booking.date} ${booking.startTime} (${booking.durationHours}h) to ${date} ${startTime} (${duration}h)`;
  await logActivity(req.session.userId, 'admin_booking_updated', 'booking', bookingId, description);

  res.json({ message: 'Booking updated successfully.' });
});

// Cancel an equipment loan as admin.
app.post('/api/admin/loans/:id/cancel', requireAdmin, async (req, res) => {
  const loanId = Number(req.params.id);
  if (!Number.isFinite(loanId) || loanId <= 0) {
    return res.status(400).json({ error: 'Invalid loan ID.' });
  }

  const rows = await query(
    `SELECT l.id, l.userId, l.borrowDate, l.returnDate, l.status, u.email AS userEmail
     FROM loans l
     JOIN users u ON u.id = l.userId
     WHERE l.id = ?`,
    [loanId]
  );

  if (rows.length === 0) {
    return res.status(404).json({ error: 'Loan not found.' });
  }

  const loan = rows[0];
  if (loan.status !== 'active') {
    return res.status(400).json({ error: 'Only active loans can be cancelled.' });
  }

  const today = new Date().toISOString().slice(0, 10);
  if (loan.returnDate < today) {
    return res.status(400).json({ error: 'Past loans cannot be cancelled.' });
  }

  await run('UPDATE loans SET status = ? WHERE id = ?', ['cancelled', loanId]);

  const description = `${req.session.email} cancelled loan #${loanId} for ${loan.userEmail} (borrowed ${loan.borrowDate}, return ${loan.returnDate})`;
  await logActivity(req.session.userId, 'admin_loan_cancelled', 'loan', loanId, description);

  res.json({ message: 'Loan cancelled successfully.' });
});

// Edit an equipment loan return date as admin.
app.patch('/api/admin/loans/:id', requireAdmin, async (req, res) => {
  const loanId = Number(req.params.id);
  const returnDate = String(req.body?.returnDate || '').trim();

  if (!Number.isFinite(loanId) || loanId <= 0) {
    return res.status(400).json({ error: 'Invalid loan ID.' });
  }

  if (!returnDate) {
    return res.status(400).json({ error: 'Return date is required.' });
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(returnDate)) {
    return res.status(400).json({ error: 'Return date must be in YYYY-MM-DD format.' });
  }

  const rows = await query(
    `SELECT l.id, l.userId, l.borrowDate, l.returnDate, l.status, u.email AS userEmail
     FROM loans l
     JOIN users u ON u.id = l.userId
     WHERE l.id = ?`,
    [loanId]
  );

  if (rows.length === 0) {
    return res.status(404).json({ error: 'Loan not found.' });
  }

  const loan = rows[0];
  if (loan.status !== 'active') {
    return res.status(400).json({ error: 'Only active loans can be edited.' });
  }

  const today = new Date().toISOString().slice(0, 10);
  if (loan.returnDate < today) {
    return res.status(400).json({ error: 'Past loans cannot be edited.' });
  }

  if (returnDate < today) {
    return res.status(400).json({ error: 'Return date must be today or later.' });
  }

  if (returnDate < loan.borrowDate) {
    return res.status(400).json({ error: 'Return date cannot be before borrow date.' });
  }

  await run('UPDATE loans SET returnDate = ? WHERE id = ?', [returnDate, loanId]);

  const description = `${req.session.email} edited loan #${loanId} for ${loan.userEmail} return date from ${loan.returnDate} to ${returnDate}`;
  await logActivity(req.session.userId, 'admin_loan_updated', 'loan', loanId, description);

  res.json({ message: 'Loan updated successfully.' });
});

// Return all rooms for admin room management, including configured policy.
app.get('/api/admin/rooms', requireAdmin, async (req, res) => {
  const rooms = await query(
    `SELECT id, name, location, minDurationMinutes, maxDurationMinutes,
            maxBookingsPerUserPerWeek, requiresApproval
     FROM rooms ORDER BY name ASC`
  );
  res.json({ rooms });
});

/**
 * Validate and normalise room policy fields from request input.
 * @param {object} body Request body containing optional policy fields.
 * @returns {{ error: string }|{ minDurationMinutes: number|null, maxDurationMinutes: number|null, maxBookingsPerUserPerWeek: number|null, requiresApproval: 0|1 }}
 */
function parseRoomPolicyInput(body) {
  const minDurationMinutes = parseOptionalPositiveInt(body?.minDurationMinutes);
  const maxDurationMinutes = parseOptionalPositiveInt(body?.maxDurationMinutes);
  const maxBookingsPerUserPerWeek = parseOptionalPositiveInt(body?.maxBookingsPerUserPerWeek);

  if (Number.isNaN(minDurationMinutes)) {
    return { error: 'Minimum booking length must be a whole number of minutes greater than 0.' };
  }
  if (Number.isNaN(maxDurationMinutes)) {
    return { error: 'Maximum booking length must be a whole number of minutes greater than 0.' };
  }
  if (Number.isNaN(maxBookingsPerUserPerWeek)) {
    return { error: 'Weekly booking limit must be a whole number greater than 0.' };
  }
  if (minDurationMinutes != null && maxDurationMinutes != null && minDurationMinutes > maxDurationMinutes) {
    return { error: 'Minimum booking length cannot be greater than the maximum booking length.' };
  }

  const requiresApproval = body?.requiresApproval === true || body?.requiresApproval === 'true' ? 1 : 0;

  return { minDurationMinutes, maxDurationMinutes, maxBookingsPerUserPerWeek, requiresApproval };
}

// Add a new room. Admin only.
app.post('/api/admin/rooms', requireAdmin, async (req, res) => {
  const name = String(req.body?.name || '').trim();
  const location = String(req.body?.location || '').trim();

  if (!name || !location) {
    return res.status(400).json({ error: 'Room name and location are required.' });
  }

  const duplicateLocation = await query(
    'SELECT id FROM rooms WHERE LOWER(location) = LOWER(?) LIMIT 1',
    [location]
  );
  if (duplicateLocation.length > 0) {
    return res.status(400).json({ error: 'A room already exists at this location.' });
  }

  const policy = parseRoomPolicyInput(req.body);
  if (policy.error) {
    return res.status(400).json({ error: policy.error });
  }

  const result = await run(
    `INSERT INTO rooms (name, location, minDurationMinutes, maxDurationMinutes, maxBookingsPerUserPerWeek, requiresApproval)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [name, location, policy.minDurationMinutes, policy.maxDurationMinutes, policy.maxBookingsPerUserPerWeek, policy.requiresApproval]
  );
  const description = `${req.session.email} added room ${name} (${location})`;
  await logActivity(req.session.userId, 'room_added', 'room', result.lastID, description);

  res.json({ message: 'Room added successfully.' });
});

// Update a room's booking policy (length limits, weekly frequency cap, admin approval). Admin only.
app.patch('/api/admin/rooms/:id', requireAdmin, async (req, res) => {
  const roomId = Number(req.params.id);
  if (!Number.isFinite(roomId) || roomId <= 0) {
    return res.status(400).json({ error: 'Invalid room ID.' });
  }

  const roomRows = await query('SELECT id, name FROM rooms WHERE id = ?', [roomId]);
  if (roomRows.length === 0) {
    return res.status(404).json({ error: 'Room not found.' });
  }

  const policy = parseRoomPolicyInput(req.body);
  if (policy.error) {
    return res.status(400).json({ error: policy.error });
  }

  await run(
    `UPDATE rooms SET minDurationMinutes = ?, maxDurationMinutes = ?, maxBookingsPerUserPerWeek = ?, requiresApproval = ?
     WHERE id = ?`,
    [policy.minDurationMinutes, policy.maxDurationMinutes, policy.maxBookingsPerUserPerWeek, policy.requiresApproval, roomId]
  );

  const description = `${req.session.email} updated booking policy for room ${roomRows[0].name}`;
  await logActivity(req.session.userId, 'room_policy_updated', 'room', roomId, description);

  res.json({
    message: 'Room policy updated successfully.',
    room: { id: roomId, ...policy }
  });
});

// List blackout windows for a room. Admin only.
app.get('/api/admin/rooms/:roomId/blackouts', requireAdmin, async (req, res) => {
  const roomId = Number(req.params.roomId);
  if (!Number.isFinite(roomId) || roomId <= 0) {
    return res.status(400).json({ error: 'Invalid room ID.' });
  }

  const blackouts = await query(
    'SELECT id, roomId, date, startTime, endTime, reason FROM room_blackouts WHERE roomId = ? ORDER BY date ASC, startTime ASC',
    [roomId]
  );
  res.json({ blackouts });
});

// Add a blackout window for a room. Admin only.
app.post('/api/admin/rooms/:roomId/blackouts', requireAdmin, async (req, res) => {
  const roomId = Number(req.params.roomId);
  const date = String(req.body?.date || '').trim();
  const startTime = String(req.body?.startTime || '').trim();
  const endTime = String(req.body?.endTime || '').trim();
  const reason = String(req.body?.reason || '').trim();

  if (!Number.isFinite(roomId) || roomId <= 0) {
    return res.status(400).json({ error: 'Invalid room ID.' });
  }

  const roomRows = await query('SELECT id, name FROM rooms WHERE id = ?', [roomId]);
  if (roomRows.length === 0) {
    return res.status(404).json({ error: 'Room not found.' });
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(400).json({ error: 'Date must be in YYYY-MM-DD format.' });
  }
  if (!/^[0-9]{2}:[0-9]{2}$/.test(startTime) || !/^[0-9]{2}:[0-9]{2}$/.test(endTime)) {
    return res.status(400).json({ error: 'Start and end time must be in HH:MM format.' });
  }
  if (timeToMinutes(startTime) >= timeToMinutes(endTime)) {
    return res.status(400).json({ error: 'End time must be after start time.' });
  }

  const result = await run(
    'INSERT INTO room_blackouts (roomId, date, startTime, endTime, reason) VALUES (?, ?, ?, ?, ?)',
    [roomId, date, startTime, endTime, reason || null]
  );

  const description = `${req.session.email} added a blackout for ${roomRows[0].name} on ${date} ${startTime}-${endTime}`;
  await logActivity(req.session.userId, 'room_blackout_added', 'room', roomId, description);

  res.json({ message: 'Blackout window added successfully.', blackout: { id: result.lastID, roomId, date, startTime, endTime, reason } });
});

// Remove a blackout window from a room. Admin only.
app.delete('/api/admin/rooms/:roomId/blackouts/:blackoutId', requireAdmin, async (req, res) => {
  const roomId = Number(req.params.roomId);
  const blackoutId = Number(req.params.blackoutId);

  if (!Number.isFinite(roomId) || roomId <= 0 || !Number.isFinite(blackoutId) || blackoutId <= 0) {
    return res.status(400).json({ error: 'Invalid room or blackout ID.' });
  }

  const rows = await query('SELECT id FROM room_blackouts WHERE id = ? AND roomId = ?', [blackoutId, roomId]);
  if (rows.length === 0) {
    return res.status(404).json({ error: 'Blackout window not found.' });
  }

  await run('DELETE FROM room_blackouts WHERE id = ?', [blackoutId]);

  const description = `${req.session.email} removed a blackout window from room #${roomId}`;
  await logActivity(req.session.userId, 'room_blackout_removed', 'room', roomId, description);

  res.json({ message: 'Blackout window removed successfully.' });
});

// Remove a room. Admin only.
app.delete('/api/admin/rooms/:id', requireAdmin, async (req, res) => {
  const roomId = Number(req.params.id);
  if (!Number.isFinite(roomId) || roomId <= 0) {
    return res.status(400).json({ error: 'Invalid room ID.' });
  }

  const roomRows = await query('SELECT id, name, location FROM rooms WHERE id = ?', [roomId]);
  if (roomRows.length === 0) {
    return res.status(404).json({ error: 'Room not found.' });
  }

  const room = roomRows[0];
  const today = new Date().toISOString().slice(0, 10);
  const nowTime = new Date().toTimeString().slice(0, 5);

  const futureActiveBookings = await query(
    `SELECT id FROM bookings
     WHERE roomId = ?
       AND status IN ('active', 'pending')
       AND (date > ? OR (date = ? AND startTime > ?))
     LIMIT 1`,
    [roomId, today, today, nowTime]
  );

  if (futureActiveBookings.length > 0) {
    return res.status(400).json({ error: 'Cannot remove a room that has future active bookings.' });
  }

  await run('DELETE FROM room_blackouts WHERE roomId = ?', [roomId]);
  await run('DELETE FROM rooms WHERE id = ?', [roomId]);

  const description = `${req.session.email} removed room ${room.name} (${room.location})`;
  await logActivity(req.session.userId, 'room_removed', 'room', roomId, description);

  res.json({ message: 'Room removed successfully.' });
});

// Return all equipment for admin equipment management.
app.get('/api/admin/equipment', requireAdmin, async (req, res) => {
  const equipmentRows = await query(
    `SELECT e.id, e.name,
            COALESCE(unitCounts.totalUnits, 0) AS quantity
     FROM equipment e
     LEFT JOIN (
       SELECT equipmentId, COUNT(*) AS totalUnits
       FROM equipment_units
       GROUP BY equipmentId
     ) unitCounts ON unitCounts.equipmentId = e.id
     ORDER BY e.name ASC`
  );

  const unitStatuses = await getEquipmentUnitStatuses();
  const statusByUnitId = new Map(unitStatuses.map((unit) => [unit.id, unit.status]));

  const codeRows = await query(
    `SELECT id, equipmentId, code, condition
     FROM equipment_units
     ORDER BY code ASC`
  );

  const codesByEquipmentId = codeRows.reduce((acc, row) => {
    if (!acc[row.equipmentId]) {
      acc[row.equipmentId] = [];
    }
    acc[row.equipmentId].push({
      id: row.id,
      code: row.code,
      condition: row.condition,
      status: statusByUnitId.get(row.id) || 'available'
    });
    return acc;
  }, {});

  const statusCountKeys = { available: 'available', reserved: 'reserved', 'checked-out': 'checkedOut', overdue: 'overdue', 'in-maintenance': 'inMaintenance' };
  const equipment = equipmentRows.map((item) => {
    const codes = codesByEquipmentId[item.id] || [];
    const statusCounts = { available: 0, reserved: 0, checkedOut: 0, overdue: 0, inMaintenance: 0 };
    for (const unit of codes) {
      const key = statusCountKeys[unit.status];
      if (key) statusCounts[key] += 1;
    }
    return { ...item, codes, statusCounts };
  });

  res.json({ equipment });
});

// Return active booked-out equipment and borrower details for admins.
app.get('/api/admin/equipment/booked-out', requireAdmin, async (req, res) => {
  const today = new Date().toISOString().slice(0, 10);
  const loans = await query(
    `SELECT l.id,
            e.name AS equipmentName,
            eu.code AS equipmentCode,
            u.email AS borrowerEmail,
            l.borrowDate,
            l.returnDate
     FROM loans l
     JOIN equipment e ON e.id = l.equipmentId
     JOIN users u ON u.id = l.userId
     LEFT JOIN equipment_units eu ON eu.id = l.equipmentUnitId
     WHERE l.status = 'active'
     ORDER BY e.name ASC, l.returnDate ASC, l.borrowDate ASC`,
    []
  );

  // Overdue loans stay on this list (rather than disappearing once returnDate passes)
  // since the item is still physically checked out until it's actually returned.
  const loansWithStatus = loans.map((loan) => ({
    ...loan,
    status: loan.returnDate < today ? 'overdue' : 'checked-out'
  }));

  res.json({ loans: loansWithStatus });
});

// Add a new equipment item. Admin only.
app.post('/api/admin/equipment', requireAdmin, async (req, res) => {
  const name = String(req.body?.name || '').trim();
  const quantity = Number(req.body?.quantity);

  if (!name || !Number.isInteger(quantity) || quantity <= 0) {
    return res.status(400).json({ error: 'Equipment name and a quantity greater than 0 are required.' });
  }

  const duplicateName = await query(
    'SELECT id FROM equipment WHERE LOWER(name) = LOWER(?) LIMIT 1',
    [name]
  );
  if (duplicateName.length > 0) {
    return res.status(400).json({ error: 'Equipment with this name already exists.' });
  }

  const result = await run('INSERT INTO equipment (name, quantity) VALUES (?, ?)', [name, quantity]);
  await addEquipmentUnits(result.lastID, name, quantity);
  const description = `${req.session.email} added equipment ${name} (quantity: ${quantity})`;
  await logActivity(req.session.userId, 'equipment_added', 'equipment', result.lastID, description);

  res.json({ message: 'Equipment added successfully.' });
});

// Update equipment quantity. Admin only.
app.patch('/api/admin/equipment/:id', requireAdmin, async (req, res) => {
  const equipmentId = Number(req.params.id);
  const quantity = Number(req.body?.quantity);

  if (!Number.isFinite(equipmentId) || equipmentId <= 0) {
    return res.status(400).json({ error: 'Invalid equipment ID.' });
  }

  if (!Number.isInteger(quantity) || quantity <= 0) {
    return res.status(400).json({ error: 'Quantity must be a whole number greater than 0.' });
  }

  const equipmentRows = await query('SELECT id, name, quantity FROM equipment WHERE id = ?', [equipmentId]);
  if (equipmentRows.length === 0) {
    return res.status(404).json({ error: 'Equipment not found.' });
  }

  const today = new Date().toISOString().slice(0, 10);
  const activeLoanRows = await query(
    `SELECT COUNT(*) AS count FROM loans
     WHERE equipmentId = ?
       AND status = 'active'
       AND returnDate >= ?`,
    [equipmentId, today]
  );
  const activeLoanCount = Number(activeLoanRows[0]?.count || 0);

  if (quantity < activeLoanCount) {
    return res.status(400).json({
      error: `Quantity cannot be lower than active loans (${activeLoanCount}).`
    });
  }

  const previousQuantityRows = await query('SELECT COUNT(*) AS count FROM equipment_units WHERE equipmentId = ?', [equipmentId]);
  const previousQuantity = Number(previousQuantityRows[0]?.count || 0);
  if (previousQuantity === quantity) {
    return res.json({
      message: 'Quantity already set.',
      equipment: {
        id: equipmentId,
        name: equipmentRows[0].name,
        quantity: previousQuantity
      }
    });
  }

  if (quantity > previousQuantity) {
    await addEquipmentUnits(equipmentId, equipmentRows[0].name, quantity - previousQuantity);
  } else {
    const removed = await removeUnassignedEquipmentUnits(equipmentId, previousQuantity - quantity);
    if (!removed) {
      return res.status(400).json({
        error: 'Cannot reduce quantity because not enough unassigned item codes are available.'
      });
    }
  }

  await run('UPDATE equipment SET quantity = ? WHERE id = ?', [quantity, equipmentId]);

  const equipmentName = equipmentRows[0].name;
  const description = `${req.session.email} updated equipment ${equipmentName} quantity from ${previousQuantity} to ${quantity}`;
  await logActivity(req.session.userId, 'equipment_updated', 'equipment', equipmentId, description);

  res.json({
    message: 'Equipment quantity updated successfully.',
    equipment: {
      id: equipmentId,
      name: equipmentName,
      quantity
    }
  });
});

// Update an equipment unit's condition (working/damaged). Admin only.
app.patch('/api/admin/equipment/units/:unitId/condition', requireAdmin, async (req, res) => {
  const unitId = Number(req.params.unitId);
  const condition = String(req.body?.condition || '').trim().toLowerCase();

  if (!Number.isFinite(unitId) || unitId <= 0) {
    return res.status(400).json({ error: 'Invalid equipment unit ID.' });
  }

  if (condition !== 'working' && condition !== 'damaged') {
    return res.status(400).json({ error: "Condition must be 'working' or 'damaged'." });
  }

  const unitRows = await query(
    `SELECT eu.id, eu.code, eu.condition, e.name AS equipmentName
     FROM equipment_units eu
     JOIN equipment e ON e.id = eu.equipmentId
     WHERE eu.id = ?`,
    [unitId]
  );
  if (unitRows.length === 0) {
    return res.status(404).json({ error: 'Equipment unit not found.' });
  }

  const unit = unitRows[0];
  if (unit.condition === condition) {
    return res.json({ message: 'Condition already set.', unit: { id: unit.id, code: unit.code, condition } });
  }

  await run('UPDATE equipment_units SET condition = ? WHERE id = ?', [condition, unitId]);

  const description = `${req.session.email} marked ${unit.equipmentName} item ${unit.code} as ${condition}`;
  await logActivity(req.session.userId, 'equipment_condition_updated', 'equipment_unit', unitId, description);

  res.json({ message: 'Equipment condition updated successfully.', unit: { id: unit.id, code: unit.code, condition } });
});

// Remove an equipment item. Admin only.
app.delete('/api/admin/equipment/:id', requireAdmin, async (req, res) => {
  const equipmentId = Number(req.params.id);
  if (!Number.isFinite(equipmentId) || equipmentId <= 0) {
    return res.status(400).json({ error: 'Invalid equipment ID.' });
  }

  const equipmentRows = await query('SELECT id, name, quantity FROM equipment WHERE id = ?', [equipmentId]);
  if (equipmentRows.length === 0) {
    return res.status(404).json({ error: 'Equipment not found.' });
  }

  const today = new Date().toISOString().slice(0, 10);
  const activeLoans = await query(
    `SELECT id FROM loans
     WHERE equipmentId = ?
       AND status = 'active'
       AND returnDate >= ?
     LIMIT 1`,
    [equipmentId, today]
  );

  if (activeLoans.length > 0) {
    return res.status(400).json({ error: 'Cannot remove equipment that has active loans.' });
  }

  await run('DELETE FROM equipment_units WHERE equipmentId = ?', [equipmentId]);
  await run('DELETE FROM equipment WHERE id = ?', [equipmentId]);

  const equipment = equipmentRows[0];
  const description = `${req.session.email} removed equipment ${equipment.name} (quantity: ${equipment.quantity})`;
  await logActivity(req.session.userId, 'equipment_removed', 'equipment', equipmentId, description);

  res.json({ message: 'Equipment removed successfully.' });
});

// Update a user's role. Admins can promote/demote other users.
app.patch('/api/admin/users/:id/role', requireAdmin, async (req, res) => {
  const targetUserId = Number(req.params.id);
  const { role } = req.body;
  const allowedRoles = ['user', 'admin'];

  if (!Number.isFinite(targetUserId) || targetUserId <= 0) {
    return res.status(400).json({ error: 'Invalid user ID.' });
  }

  if (!allowedRoles.includes(role)) {
    return res.status(400).json({ error: 'Invalid role. Allowed roles are user and admin.' });
  }

  const actingUserId = req.session.userId;
  const actingUserRows = await query('SELECT email FROM users WHERE id = ?', [actingUserId]);
  const actingUserEmail = actingUserRows[0]?.email || req.session.email || 'unknown';

  const targetUserRows = await query('SELECT id, email, role FROM users WHERE id = ?', [targetUserId]);
  if (targetUserRows.length === 0) {
    return res.status(404).json({ error: 'User not found.' });
  }

  const targetUser = targetUserRows[0];
  if (targetUser.role === role) {
    return res.json({ message: 'Role already set.', user: targetUser });
  }

  // Prevent removing admin access from the last admin account.
  if (targetUser.role === 'admin' && role !== 'admin') {
    const adminCountRows = await query('SELECT COUNT(*) AS count FROM users WHERE role = ?', ['admin']);
    const adminCount = Number(adminCountRows[0]?.count || 0);
    if (adminCount <= 1) {
      return res.status(400).json({ error: 'Cannot demote the last admin user.' });
    }
  }

  await run('UPDATE users SET role = ? WHERE id = ?', [role, targetUserId]);

  const description = `${actingUserEmail} changed role for ${targetUser.email} from ${targetUser.role} to ${role}`;
  await logActivity(actingUserId, 'user_role_changed', 'user', targetUserId, description);

  // Keep session role in sync if an admin updates their own role.
  if (req.session.userId === targetUserId) {
    req.session.role = role;
  }

  res.json({
    message: `Role updated to ${role}.`,
    user: {
      id: targetUser.id,
      email: targetUser.email,
      role
    }
  });
});

// Delete a user account. Admins only.
app.delete('/api/admin/users/:id', requireAdmin, async (req, res) => {
  const targetUserId = Number(req.params.id);
  if (!Number.isFinite(targetUserId) || targetUserId <= 0) {
    return res.status(400).json({ error: 'Invalid user ID.' });
  }

  if (req.session.userId === targetUserId) {
    return res.status(400).json({ error: 'You cannot delete your own account while signed in.' });
  }

  const targetUserRows = await query('SELECT id, email, role FROM users WHERE id = ?', [targetUserId]);
  if (targetUserRows.length === 0) {
    return res.status(404).json({ error: 'User not found.' });
  }

  const targetUser = targetUserRows[0];

  // Prevent deleting the last admin account.
  if (targetUser.role === 'admin') {
    const adminCountRows = await query('SELECT COUNT(*) AS count FROM users WHERE role = ?', ['admin']);
    const adminCount = Number(adminCountRows[0]?.count || 0);
    if (adminCount <= 1) {
      return res.status(400).json({ error: 'Cannot delete the last admin user.' });
    }
  }

  try {
    await run('BEGIN TRANSACTION');
    await run('DELETE FROM bookings WHERE userId = ?', [targetUserId]);
    await run('DELETE FROM loans WHERE userId = ?', [targetUserId]);
    await run('DELETE FROM activity_history WHERE userId = ?', [targetUserId]);
    await run('DELETE FROM users WHERE id = ?', [targetUserId]);
    await run('COMMIT');
  } catch (err) {
    try {
      await run('ROLLBACK');
    } catch {
      // Ignore rollback failures after an already failed transaction.
    }
    console.error('Failed to delete user account:', err);
    return res.status(500).json({ error: 'Could not delete user account.' });
  }

  const actingUserEmail = req.session.email || 'unknown';
  const description = `${actingUserEmail} deleted user account ${targetUser.email} (#${targetUserId})`;
  await logActivity(req.session.userId, 'user_deleted', 'user', targetUserId, description);

  res.json({ message: 'User account deleted successfully.' });
});

// Return recent admin audit log entries.
app.get('/api/admin/audit-log', requireAdmin, async (req, res) => {
  const entries = await query(
    `SELECT
       ah.id,
       ah.eventType,
       ah.resourceType,
       ah.resourceId,
       ah.description,
       ah.timestamp,
       actor.email AS actorEmail,
       target.email AS targetEmail
     FROM activity_history ah
     JOIN users actor ON actor.id = ah.userId
     LEFT JOIN users target ON target.id = ah.resourceId
     ORDER BY ah.timestamp DESC, ah.id DESC
     LIMIT 100`
  );

  res.json({ entries });
});

// Serve the frontend application for any unmatched route.
// Serve the frontend application for any route not handled by the API.
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

initDatabase()
  .then(() => {
    const port = process.env.PORT || 3000;
    const server = app.listen(port, () => console.log(`Lab booking app running on http://localhost:${port}`));
    
    // Handle server errors
    server.on('error', (err) => {
      console.error('Server error:', err);
      process.exit(1);
    });
  })
  .catch((err) => {
    console.error('Failed to initialize database:', err);
    process.exit(1);
  });
