const express = require('express');
const path = require('path');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const sqlite3 = require('sqlite3');
const fs = require('fs');

// Simple lab booking backend using Express and SQLite.
// - Express serves API routes and the static frontend.
// - Sessions keep users logged in.
// - SQLite stores users, rooms, equipment, bookings, and loans.
const app = express();

// Application data directory for SQLite storage.
const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const dbFile = path.join(dataDir, 'lab-booking.db');
const db = new sqlite3.Database(dbFile);

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
 * Ensure the SQLite schema exists and seed default data.
 * This uses CREATE TABLE IF NOT EXISTS so it is safe to run every startup.
 */
async function initDatabase() {
  await run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    passwordHash TEXT NOT NULL
  )`);

  // Rename username column to email if it exists
  const columns = await query("PRAGMA table_info(users)");
  const hasUsernameColumn = columns.some(col => col.name === 'username');
  if (hasUsernameColumn) {
    await run(`ALTER TABLE users RENAME COLUMN username TO email`);
  }

  await run(`CREATE TABLE IF NOT EXISTS rooms (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    location TEXT NOT NULL
  )`);

  await run(`CREATE TABLE IF NOT EXISTS equipment (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    quantity INTEGER NOT NULL
  )`);

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

  await run(`CREATE TABLE IF NOT EXISTS loans (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    userId INTEGER NOT NULL,
    equipmentId INTEGER NOT NULL,
    borrowDate TEXT NOT NULL,
    returnDate TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(userId) REFERENCES users(id),
    FOREIGN KEY(equipmentId) REFERENCES equipment(id)
  )`);

  // Check if status column exists, add it if not
  const loanColumns = await query("PRAGMA table_info(loans)");
  const hasLoanStatus = loanColumns.some(col => col.name === 'status');
  if (!hasLoanStatus) {
    await run(`ALTER TABLE loans ADD COLUMN status TEXT NOT NULL DEFAULT 'active'`);
  }

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
}

// Middleware helper: only allow authenticated users to access protected routes.
function requireLogin(req, res, next) {
  if (!req.session.userId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
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
  res.json({ message: 'Login successful.', email: user.email });
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
  res.json({ authenticated: true, email: req.session.email });
});

// Return available rooms and equipment for the dashboard.
app.get('/api/resources', requireLogin, async (req, res) => {
  const rooms = await query('SELECT * FROM rooms');
  const equipment = await query('SELECT * FROM equipment');

  const loans = await query('SELECT equipmentId, COUNT(*) AS activeLoans FROM loans WHERE returnDate >= date("now") AND status = ? GROUP BY equipmentId', ['active']);
  const loanMap = loans.reduce((acc, item) => {
    acc[item.equipmentId] = item.activeLoans;
    return acc;
  }, {});

  // Calculate available equipment by subtracting active loans from total quantity.
  const equipmentWithAvailability = equipment.map((item) => {
    const activeLoans = loanMap[item.id] || 0;
    return { ...item, available: Math.max(0, item.quantity - activeLoans) };
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
      `SELECT b.id, r.name AS roomName, r.location, b.date, b.startTime, b.durationHours, b.status
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
      `SELECT b.id, r.name AS roomName, r.location, b.date, b.startTime, b.durationHours, b.status
       FROM bookings b
       JOIN rooms r ON r.id = b.roomId
       WHERE b.userId = ?
         AND b.status = 'active'
         AND (b.date > ? OR (b.date = ? AND b.startTime > ?))
       ORDER BY b.date DESC, b.startTime DESC`,
      [userId, today, today, nowTime]
    );
  }

  let loans;
  if (statusFilter === 'all') {
    loans = await query(
      `SELECT l.id, e.name AS equipmentName, l.borrowDate, l.returnDate, l.status
       FROM loans l
       JOIN equipment e ON e.id = l.equipmentId
       WHERE l.userId = ?
       ORDER BY l.borrowDate DESC`,
      [userId]
    );
  } else {
    const today = new Date().toISOString().slice(0, 10);
    loans = await query(
      `SELECT l.id, e.name AS equipmentName, l.borrowDate, l.returnDate, l.status
       FROM loans l
       JOIN equipment e ON e.id = l.equipmentId
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
  if (booking.status !== 'active') {
    return res.status(400).json({ error: 'Booking is already cancelled.' });
  }

  const bookingDateTime = new Date(`${booking.date}T${booking.startTime}:00`);
  if (bookingDateTime <= new Date()) {
    return res.status(400).json({ error: 'Past bookings cannot be cancelled.' });
  }

  await run('UPDATE bookings SET status = ? WHERE id = ?', ['cancelled', bookingId]);
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
    return res.status(400).json({ error: 'Loan is already cancelled.' });
  }

  const today = new Date().toISOString().slice(0, 10);
  if (loan.returnDate < today) {
    return res.status(400).json({ error: 'Past loans cannot be cancelled.' });
  }

  await run('UPDATE loans SET status = ? WHERE id = ?', ['cancelled', loanId]);
  res.json({ message: 'Loan cancelled successfully.' });
});

// Submit a room booking request.
// Validates future time, 15-minute increments, and overlapping bookings.
app.post('/api/book-room', requireLogin, async (req, res) => {
  const { roomId, date, startTime, durationHours } = req.body;
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

  // Load active bookings for the selected room and date so we can detect overlaps.
  const existingBookings = await query(
    'SELECT startTime, durationHours FROM bookings WHERE roomId = ? AND date = ? AND status = ? ',
    [roomId, date, 'active']
  );

  // Convert the requested booking time into minutes since midnight.
  const requestedStart = (() => {
    const [hours, minutes] = startTime.split(':').map(Number);
    return hours * 60 + minutes;
  })();
  const requestedEnd = requestedStart + duration * 60;

  // Determine whether the requested interval overlaps any existing booking.
  const hasOverlap = existingBookings.some((booking) => {
    const [hours, minutes] = booking.startTime.split(':').map(Number);
    const existingStart = hours * 60 + minutes;
    const existingDuration = Number(booking.durationHours) || 0;
    const existingEnd = existingStart + existingDuration * 60;
    return requestedStart < existingEnd && existingStart < requestedEnd;
  });

  if (hasOverlap) {
    return res.status(400).json({ error: 'Selected room is already booked during that time.' });
  }

  await run(
    'INSERT INTO bookings (userId, roomId, date, startTime, durationHours) VALUES (?, ?, ?, ?, ?)',
    [req.session.userId, roomId, date, startTime, duration]
  );
  res.json({ message: 'Room booked successfully.' });
});

// Submit an equipment loan request and enforce quantity availability.
app.post('/api/borrow-equipment', requireLogin, async (req, res) => {
  const { equipmentId, days } = req.body;
  if (!equipmentId || !days) {
    return res.status(400).json({ error: 'Equipment and borrow duration are required.' });
  }

  const equip = await query('SELECT * FROM equipment WHERE id = ?', [equipmentId]);
  if (equip.length === 0) {
    return res.status(404).json({ error: 'Equipment not found.' });
  }

  const activeLoans = await query(
    'SELECT COUNT(*) AS count FROM loans WHERE equipmentId = ? AND returnDate >= date("now")',
    [equipmentId]
  );

  const available = equip[0].quantity - activeLoans[0].count;
  if (available <= 0) {
    return res.status(400).json({ error: 'No equipment available to borrow right now.' });
  }

  const borrowDate = new Date().toISOString().slice(0, 10);
  const returnDate = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  await run(
    'INSERT INTO loans (userId, equipmentId, borrowDate, returnDate) VALUES (?, ?, ?, ?)',
    [req.session.userId, equipmentId, borrowDate, returnDate]
  );
  res.json({ message: 'Equipment borrowed successfully.' });
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
