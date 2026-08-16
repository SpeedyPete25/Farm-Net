const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const net = require('net');
const { once } = require('events');
const { spawn } = require('child_process');
const sqlite3 = require('sqlite3');

const prototypeDir = path.join(__dirname, '..');
const testDataDir = path.join(prototypeDir, '.test-data', 'api');
const dbFile = path.join(testDataDir, 'lab-booking.db');

let serverProcess;
let baseUrl;
let serverOutput = '';

function removeDir(targetPath) {
  fs.rmSync(targetPath, { recursive: true, force: true });
}

function ensureDir(targetPath) {
  fs.mkdirSync(targetPath, { recursive: true });
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : null;
      server.close((err) => {
        if (err) {
          reject(err);
          return;
        }
        resolve(port);
      });
    });
  });
}

async function waitForServer(url, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (serverProcess?.exitCode != null) {
      throw new Error(`Server exited early.\n${serverOutput}`);
    }

    try {
      const response = await fetch(`${url}/api/profile`);
      if (response.ok) {
        return;
      }
    } catch {
      // Server is still starting.
    }

    await wait(200);
  }

  throw new Error(`Timed out waiting for test server.\n${serverOutput}`);
}

function openDatabase() {
  return new sqlite3.Database(dbFile);
}

function runSql(sql, params = []) {
  return new Promise((resolve, reject) => {
    const db = openDatabase();
    db.run(sql, params, function onRun(err) {
      db.close(() => {
        if (err) {
          reject(err);
          return;
        }
        resolve(this);
      });
    });
  });
}

function formatDateFromToday(daysAhead) {
  const date = new Date();
  date.setHours(12, 0, 0, 0);
  date.setDate(date.getDate() + daysAhead);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function uniqueEmail(label) {
  return `${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
}

function getMondayOf(dateStr) {
  const [year, month, day] = dateStr.split('-').map(Number);
  const monday = new Date(year, month - 1, day);
  const dayOfWeek = monday.getDay();
  monday.setDate(monday.getDate() + (dayOfWeek === 0 ? -6 : 1 - dayOfWeek));
  return `${monday.getFullYear()}-${String(monday.getMonth() + 1).padStart(2, '0')}-${String(monday.getDate()).padStart(2, '0')}`;
}

class TestClient {
  constructor(url) {
    this.url = url;
    this.cookies = new Map();
  }

  updateCookies(response) {
    const setCookieHeaders = typeof response.headers.getSetCookie === 'function'
      ? response.headers.getSetCookie()
      : (response.headers.get('set-cookie') ? [response.headers.get('set-cookie')] : []);

    for (const headerValue of setCookieHeaders) {
      const cookie = String(headerValue).split(';')[0];
      const separatorIndex = cookie.indexOf('=');
      if (separatorIndex <= 0) continue;
      const name = cookie.slice(0, separatorIndex);
      this.cookies.set(name, cookie);
    }
  }

  async request(route, options = {}) {
    const headers = new Headers(options.headers || {});
    if (this.cookies.size > 0) {
      headers.set('cookie', Array.from(this.cookies.values()).join('; '));
    }

    const response = await fetch(`${this.url}${route}`, {
      ...options,
      headers,
      redirect: 'manual'
    });

    this.updateCookies(response);

    const contentType = response.headers.get('content-type') || '';
    const body = contentType.includes('application/json')
      ? await response.json()
      : await response.text();

    return {
      status: response.status,
      body,
      headers: response.headers
    };
  }
}

async function registerUser(client, email, password = 'Password123') {
  const response = await client.request('/api/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password })
  });

  assert.equal(response.status, 200);
  return { email, password };
}

async function loginUser(client, email, password = 'Password123') {
  const response = await client.request('/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password })
  });

  assert.equal(response.status, 200);
  assert.equal(response.body.email, email);
  return response.body;
}

async function logoutUser(client) {
  const response = await client.request('/api/logout', { method: 'POST' });
  assert.equal(response.status, 200);
}

async function getResources(client) {
  const response = await client.request('/api/resources');
  assert.equal(response.status, 200);
  assert.ok(Array.isArray(response.body.rooms));
  assert.ok(Array.isArray(response.body.equipment));
  return response.body;
}

test.before(async () => {
  removeDir(testDataDir);
  ensureDir(testDataDir);

  const port = await getFreePort();
  baseUrl = `http://127.0.0.1:${port}`;

  serverProcess = spawn(process.execPath, ['server.js'], {
    cwd: prototypeDir,
    env: {
      ...process.env,
      PORT: String(port),
      DATA_DIR: testDataDir,
      EMAIL_VERIFICATION_ENABLED: 'false'
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  serverProcess.stdout.on('data', (chunk) => {
    serverOutput += chunk.toString();
  });
  serverProcess.stderr.on('data', (chunk) => {
    serverOutput += chunk.toString();
  });

  await waitForServer(baseUrl);
});

test.after(async () => {
  if (serverProcess && serverProcess.exitCode == null) {
    serverProcess.kill();
    await once(serverProcess, 'exit');
  }

  removeDir(testDataDir);
});

test('automated integration coverage for critical flows', async (t) => {
  await t.test('serves the frontend shell and signed-out profile state', async () => {
    const client = new TestClient(baseUrl);

    const home = await client.request('/');
    assert.equal(home.status, 200);
    assert.match(home.body, /auth-section/);
    assert.match(home.body, /dashboard-section/);

    const profile = await client.request('/api/profile');
    assert.equal(profile.status, 200);
    assert.deepEqual(profile.body, { authenticated: false });
  });

  await t.test('supports register, login, profile, preferences, and logout', async () => {
    const client = new TestClient(baseUrl);
    const email = uniqueEmail('auth');
    const password = 'Password123';

    await registerUser(client, email, password);
    const login = await loginUser(client, email, password);
    assert.equal(login.role, 'user');

    const profile = await client.request('/api/profile');
    assert.equal(profile.status, 200);
    assert.equal(profile.body.authenticated, true);
    assert.equal(profile.body.email, email);

    const preferences = await client.request('/api/preferences', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ theme: 'light' })
    });
    assert.equal(preferences.status, 200);
    assert.equal(preferences.body.preferences.theme, 'light');

    await logoutUser(client);

    const loggedOutProfile = await client.request('/api/profile');
    assert.deepEqual(loggedOutProfile.body, { authenticated: false });
  });

  await t.test('handles validation and authorization failures with expected status codes', async () => {
    const guestClient = new TestClient(baseUrl);

    const unauthorizedResources = await guestClient.request('/api/resources');
    assert.equal(unauthorizedResources.status, 401);
    assert.equal(unauthorizedResources.body.error, 'Unauthorized');

    const invalidRegistration = await guestClient.request('/api/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'invalid-email' })
    });
    assert.equal(invalidRegistration.status, 400);
    assert.equal(invalidRegistration.body.error, 'Email and password are required.');

    const invalidLogin = await guestClient.request('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'nobody@example.com', password: 'wrong-pass' })
    });
    assert.equal(invalidLogin.status, 400);
    assert.equal(invalidLogin.body.error, 'Invalid email or password.');

    const memberEmail = uniqueEmail('negative-member');
    const memberPassword = 'Password123';
    const memberClient = new TestClient(baseUrl);
    await registerUser(memberClient, memberEmail, memberPassword);
    await loginUser(memberClient, memberEmail, memberPassword);

    const nonAdminUsers = await memberClient.request('/api/admin/users');
    assert.equal(nonAdminUsers.status, 403);
    assert.equal(nonAdminUsers.body.error, 'Admin access required.');

    const invalidTheme = await memberClient.request('/api/preferences', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ theme: 'blue' })
    });
    assert.equal(invalidTheme.status, 400);
    assert.equal(invalidTheme.body.error, 'Invalid theme. Allowed values are dark and light.');

    const resources = await getResources(memberClient);
    const roomId = resources.rooms[0].id;
    const equipmentId = resources.equipment[0].id;
    const bookingDate = formatDateFromToday(7);

    const invalidBookingTime = await memberClient.request('/api/book-room', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        roomId,
        date: bookingDate,
        startTime: '10:07',
        durationHours: 1
      })
    });
    assert.equal(invalidBookingTime.status, 400);
    assert.equal(invalidBookingTime.body.error, 'Start time must be in 15-minute increments.');

    const invalidBorrowDuration = await memberClient.request('/api/borrow-equipment', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ equipmentId, days: 1.5 })
    });
    assert.equal(invalidBorrowDuration.status, 400);
    assert.equal(invalidBorrowDuration.body.error, 'Borrow duration must be a whole number of days.');

    const createdBooking = await memberClient.request('/api/book-room', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        roomId,
        date: bookingDate,
        startTime: '10:00',
        durationHours: 1
      })
    });
    assert.equal(createdBooking.status, 200);

    const memberRequests = await memberClient.request('/api/my-requests?status=all');
    const memberBooking = memberRequests.body.bookings.find((booking) => booking.date === bookingDate && booking.startTime === '10:00');
    assert.ok(memberBooking);

    const outsiderEmail = uniqueEmail('negative-outsider');
    const outsiderPassword = 'Password123';
    const outsiderClient = new TestClient(baseUrl);
    await registerUser(outsiderClient, outsiderEmail, outsiderPassword);
    await loginUser(outsiderClient, outsiderEmail, outsiderPassword);

    const ownershipCancel = await outsiderClient.request('/api/cancel-booking', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bookingId: memberBooking.id })
    });
    assert.equal(ownershipCancel.status, 404);
    assert.equal(ownershipCancel.body.error, 'Booking not found or not owned by user.');
  });

  await t.test('supports booking create, edit, and cancel flow', async () => {
    const client = new TestClient(baseUrl);
    const email = uniqueEmail('booking');
    const password = 'Password123';
    await registerUser(client, email, password);
    await loginUser(client, email, password);

    const resources = await getResources(client);
    const roomId = resources.rooms[0].id;
    const createdDate = formatDateFromToday(7);
    const editedDate = formatDateFromToday(8);

    const created = await client.request('/api/book-room', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        roomId,
        date: createdDate,
        startTime: '12:00',
        durationHours: 1
      })
    });
    assert.equal(created.status, 200);

    const allRequests = await client.request('/api/my-requests?status=all');
    assert.equal(allRequests.status, 200);
    assert.equal(allRequests.body.bookings.length, 1);

    const bookingId = allRequests.body.bookings[0].id;

    const edited = await client.request('/api/edit-booking', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        bookingId,
        date: editedDate,
        startTime: '12:15',
        durationHours: 1.5
      })
    });
    assert.equal(edited.status, 200);

    const afterEdit = await client.request('/api/my-requests?status=all');
    assert.equal(afterEdit.body.bookings[0].date, editedDate);
    assert.equal(afterEdit.body.bookings[0].startTime, '12:15');

    const cancelled = await client.request('/api/cancel-booking', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bookingId })
    });
    assert.equal(cancelled.status, 200);

    const afterCancel = await client.request('/api/my-requests?status=all');
    assert.equal(afterCancel.body.bookings[0].status, 'cancelled');
  });

  await t.test('supports recurring room bookings and cancelling a whole series', async () => {
    const client = new TestClient(baseUrl);
    const email = uniqueEmail('recurring');
    const password = 'Password123';
    await registerUser(client, email, password);
    await loginUser(client, email, password);

    const resources = await getResources(client);
    const roomId = resources.rooms[1].id;
    const startDate = formatDateFromToday(30);

    const invalidFrequency = await client.request('/api/book-room', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        roomId, date: startDate, startTime: '09:00', durationHours: 1,
        recurrence: { frequency: 'fortnightly', occurrences: 3 }
      })
    });
    assert.equal(invalidFrequency.status, 400);

    const invalidCount = await client.request('/api/book-room', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        roomId, date: startDate, startTime: '09:00', durationHours: 1,
        recurrence: { frequency: 'weekly', occurrences: 1 }
      })
    });
    assert.equal(invalidCount.status, 400);

    // Create a genuine 3-occurrence weekly series.
    const created = await client.request('/api/book-room', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        roomId, date: startDate, startTime: '09:00', durationHours: 1,
        recurrence: { frequency: 'weekly', occurrences: 3 }
      })
    });
    assert.equal(created.status, 200);
    assert.equal(created.body.occurrences, 3);

    const afterCreate = await client.request('/api/my-requests?status=all');
    assert.equal(afterCreate.body.bookings.length, 3);
    const seriesId = afterCreate.body.bookings[0].seriesId;
    assert.ok(seriesId);
    assert.ok(afterCreate.body.bookings.every((booking) => booking.seriesId === seriesId));

    const expectedDates = [startDate, formatDateFromToday(37), formatDateFromToday(44)].sort();
    const actualDates = afterCreate.body.bookings.map((booking) => booking.date).sort();
    assert.deepEqual(actualDates, expectedDates);

    // A recurring request must fully fail — with no partial series left behind — if any
    // single occurrence conflicts, even when that occurrence isn't the first one checked.
    const otherClient = new TestClient(baseUrl);
    const otherEmail = uniqueEmail('recurring-conflict');
    await registerUser(otherClient, otherEmail, password);
    await loginUser(otherClient, otherEmail, password);

    const conflictStartDate = formatDateFromToday(23); // occurrence 2 of this series lands on `startDate`.
    const conflicting = await otherClient.request('/api/book-room', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        roomId, date: conflictStartDate, startTime: '09:00', durationHours: 1,
        recurrence: { frequency: 'weekly', occurrences: 3 }
      })
    });
    assert.equal(conflicting.status, 400);
    assert.match(conflicting.body.error, /already booked/);

    const otherRequests = await otherClient.request('/api/my-requests?status=all');
    assert.equal(otherRequests.body.bookings.length, 0);

    // Cancelling the series cancels every upcoming occurrence in one call.
    const cancelSeries = await client.request('/api/cancel-booking-series', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ seriesId })
    });
    assert.equal(cancelSeries.status, 200);
    assert.match(cancelSeries.body.message, /3/);

    const afterCancel = await client.request('/api/my-requests?status=all');
    assert.ok(afterCancel.body.bookings.every((booking) => booking.status === 'cancelled'));
  });

  await t.test('reports a stable occurrence position and total for each series booking', async () => {
    const client = new TestClient(baseUrl);
    const email = uniqueEmail('recurring-position');
    const password = 'Password123';
    await registerUser(client, email, password);
    await loginUser(client, email, password);

    const resources = await getResources(client);
    const roomId = resources.rooms[0].id;
    const startDate = formatDateFromToday(250);

    const created = await client.request('/api/book-room', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        roomId, date: startDate, startTime: '09:00', durationHours: 1,
        recurrence: { frequency: 'weekly', occurrences: 4 }
      })
    });
    assert.equal(created.status, 200);

    const afterCreate = await client.request('/api/my-requests?status=all');
    const seriesBookings = afterCreate.body.bookings
      .filter((booking) => booking.date >= startDate)
      .sort((a, b) => (a.date < b.date ? -1 : 1));
    assert.equal(seriesBookings.length, 4);
    assert.deepEqual(seriesBookings.map((booking) => booking.seriesPosition), [1, 2, 3, 4]);
    assert.ok(seriesBookings.every((booking) => booking.seriesTotal === 4));

    // Cancelling the second occurrence alone must not renumber or shrink the total —
    // "2 of 4" should still mean the same thing as when the series was created.
    const cancelled = await client.request('/api/cancel-booking', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bookingId: seriesBookings[1].id })
    });
    assert.equal(cancelled.status, 200);

    const afterSingleCancel = await client.request('/api/my-requests?status=all');
    const seriesBookingsAfterCancel = afterSingleCancel.body.bookings
      .filter((booking) => booking.date >= startDate)
      .sort((a, b) => (a.date < b.date ? -1 : 1));
    assert.equal(seriesBookingsAfterCancel.length, 4);
    assert.deepEqual(seriesBookingsAfterCancel.map((booking) => booking.seriesPosition), [1, 2, 3, 4]);
    assert.ok(seriesBookingsAfterCancel.every((booking) => booking.seriesTotal === 4));
    assert.equal(seriesBookingsAfterCancel[1].status, 'cancelled');
  });

  await t.test('supports daily and monthly recurrence, and enforces the weekly cap across occurrences', async () => {
    const client = new TestClient(baseUrl);
    const email = uniqueEmail('recurring-freq');
    const password = 'Password123';
    await registerUser(client, email, password);
    await loginUser(client, email, password);

    const resources = await getResources(client);
    const roomId = resources.rooms[2].id;

    // Daily recurrence produces consecutive-day occurrences.
    const dailyStart = formatDateFromToday(60);
    const dailyCreated = await client.request('/api/book-room', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        roomId, date: dailyStart, startTime: '09:00', durationHours: 1,
        recurrence: { frequency: 'daily', occurrences: 3 }
      })
    });
    assert.equal(dailyCreated.status, 200);

    const afterDaily = await client.request('/api/my-requests?status=all');
    const dailyDates = afterDaily.body.bookings.map((booking) => booking.date).sort();
    assert.deepEqual(dailyDates, [dailyStart, formatDateFromToday(61), formatDateFromToday(62)].sort());

    // Monthly recurrence keeps the same day of month across occurrences.
    const monthlyClient = new TestClient(baseUrl);
    const monthlyEmail = uniqueEmail('recurring-monthly');
    await registerUser(monthlyClient, monthlyEmail, password);
    await loginUser(monthlyClient, monthlyEmail, password);

    const monthlyStart = formatDateFromToday(90);
    const monthlyCreated = await monthlyClient.request('/api/book-room', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        roomId, date: monthlyStart, startTime: '14:00', durationHours: 1,
        recurrence: { frequency: 'monthly', occurrences: 3 }
      })
    });
    assert.equal(monthlyCreated.status, 200);

    const afterMonthly = await monthlyClient.request('/api/my-requests?status=all');
    const monthlyDayOfMonth = Number(monthlyStart.slice(8, 10));
    assert.ok(afterMonthly.body.bookings.every((booking) => Number(booking.date.slice(8, 10)) === monthlyDayOfMonth));
    const monthlyMonths = afterMonthly.body.bookings.map((booking) => booking.date.slice(0, 7)).sort();
    assert.equal(new Set(monthlyMonths).size, 3);

    // A daily series that would put more than one occurrence in the same calendar
    // week must be rejected under a weekly cap, with no partial series created —
    // this is the gap that only showed up once a non-weekly frequency was allowed.
    const cappedRoomSuffix = Date.now();
    const cappedAdmin = new TestClient(baseUrl);
    const cappedAdminEmail = uniqueEmail('recurring-cap-admin');
    await registerUser(cappedAdmin, cappedAdminEmail, password);
    await runSql('UPDATE users SET role = ? WHERE email = ?', ['admin', cappedAdminEmail]);
    await loginUser(cappedAdmin, cappedAdminEmail, password);

    const addCappedRoom = await cappedAdmin.request('/api/admin/rooms', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: `Capped Room ${cappedRoomSuffix}`, location: `Capped Wing ${cappedRoomSuffix}` })
    });
    assert.equal(addCappedRoom.status, 200);

    const cappedRooms = await cappedAdmin.request('/api/admin/rooms');
    const cappedRoom = cappedRooms.body.rooms.find((room) => room.location === `Capped Wing ${cappedRoomSuffix}`);
    assert.ok(cappedRoom);

    const setCap = await cappedAdmin.request(`/api/admin/rooms/${cappedRoom.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ maxBookingsPerUserPerWeek: 1 })
    });
    assert.equal(setCap.status, 200);

    const cappedMemberClient = new TestClient(baseUrl);
    const cappedMemberEmail = uniqueEmail('recurring-cap-member');
    await registerUser(cappedMemberClient, cappedMemberEmail, password);
    await loginUser(cappedMemberClient, cappedMemberEmail, password);

    // Start on a Monday-safe offset and request 2 consecutive days, guaranteeing both
    // occurrences fall in the same Mon-Sun week regardless of today's day of week.
    const capWeekStart = getMondayOf(formatDateFromToday(120));
    const overCapAttempt = await cappedMemberClient.request('/api/book-room', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        roomId: cappedRoom.id, date: capWeekStart, startTime: '09:00', durationHours: 1,
        recurrence: { frequency: 'daily', occurrences: 2 }
      })
    });
    assert.equal(overCapAttempt.status, 400);
    assert.match(overCapAttempt.body.error, /maximum of 1 booking/);

    const cappedMemberRequests = await cappedMemberClient.request('/api/my-requests?status=all');
    assert.equal(cappedMemberRequests.body.bookings.length, 0);
  });

  await t.test('supports rescheduling an entire recurring booking series', async () => {
    const client = new TestClient(baseUrl);
    const email = uniqueEmail('recurring-edit');
    const password = 'Password123';
    await registerUser(client, email, password);
    await loginUser(client, email, password);

    const resources = await getResources(client);
    const roomId = resources.rooms[1].id;
    const startDate = formatDateFromToday(150);

    const created = await client.request('/api/book-room', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        roomId, date: startDate, startTime: '09:00', durationHours: 1,
        recurrence: { frequency: 'weekly', occurrences: 3 }
      })
    });
    assert.equal(created.status, 200);

    const afterCreate = await client.request('/api/my-requests?status=all');
    const seriesBookings = afterCreate.body.bookings
      .filter((booking) => booking.date >= startDate)
      .sort((a, b) => (a.date < b.date ? -1 : 1));
    assert.equal(seriesBookings.length, 3);
    const seriesId = seriesBookings[0].seriesId;
    const anchor = seriesBookings[1]; // middle occurrence, startDate + 7 days

    // A non-owner cannot edit someone else's series booking.
    const otherClient = new TestClient(baseUrl);
    const otherEmail = uniqueEmail('recurring-edit-other');
    await registerUser(otherClient, otherEmail, password);
    await loginUser(otherClient, otherEmail, password);
    const foreignAttempt = await otherClient.request('/api/edit-booking-series', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bookingId: anchor.id, date: anchor.date, startTime: '10:00', durationHours: 1 })
    });
    assert.equal(foreignAttempt.status, 404);

    // A single (non-recurring) booking can't be edited as a series.
    const singleDate = formatDateFromToday(180);
    const singleBooking = await client.request('/api/book-room', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ roomId, date: singleDate, startTime: '09:00', durationHours: 1 })
    });
    assert.equal(singleBooking.status, 200);
    const afterSingle = await client.request('/api/my-requests?status=all');
    const singleBookingRow = afterSingle.body.bookings.find((booking) => booking.date === singleDate);
    const notASeries = await client.request('/api/edit-booking-series', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bookingId: singleBookingRow.id, date: formatDateFromToday(181), startTime: '09:00', durationHours: 1 })
    });
    assert.equal(notASeries.status, 400);
    assert.match(notASeries.body.error, /not part of a recurring series/);

    // Reschedule the whole series, anchored on the middle occurrence: shift +2 days
    // and change the start time and duration for every occurrence.
    const newAnchorDate = formatDateFromToday(150 + 7 + 2);
    const rescheduled = await client.request('/api/edit-booking-series', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bookingId: anchor.id, date: newAnchorDate, startTime: '11:00', durationHours: 1.5 })
    });
    assert.equal(rescheduled.status, 200);
    assert.match(rescheduled.body.message, /3/);

    const afterReschedule = await client.request('/api/my-requests?status=all');
    const rescheduledBookings = afterReschedule.body.bookings.filter((booking) => booking.seriesId === seriesId);
    assert.equal(rescheduledBookings.length, 3);
    const expectedDates = [
      formatDateFromToday(150 + 2),
      formatDateFromToday(150 + 7 + 2),
      formatDateFromToday(150 + 14 + 2)
    ].sort();
    const actualDates = rescheduledBookings.map((booking) => booking.date).sort();
    assert.deepEqual(actualDates, expectedDates);
    assert.ok(rescheduledBookings.every((booking) => booking.startTime === '11:00' && Number(booking.durationHours) === 1.5));

    // A conflict on any single occurrence must block the whole reschedule (atomicity) —
    // nothing about the series should change if any occurrence can't be moved.
    const blockerClient = new TestClient(baseUrl);
    const blockerEmail = uniqueEmail('recurring-edit-blocker');
    await registerUser(blockerClient, blockerEmail, password);
    await loginUser(blockerClient, blockerEmail, password);
    const blockerDate = formatDateFromToday(150 + 2); // matches the first (already-shifted) occurrence's date
    const blockerBooking = await blockerClient.request('/api/book-room', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ roomId, date: blockerDate, startTime: '13:00', durationHours: 1 })
    });
    assert.equal(blockerBooking.status, 200);

    const conflictingReschedule = await client.request('/api/edit-booking-series', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bookingId: anchor.id, date: newAnchorDate, startTime: '13:00', durationHours: 1 })
    });
    assert.equal(conflictingReschedule.status, 400);
    assert.match(conflictingReschedule.body.error, /already booked/);

    const afterFailedReschedule = await client.request('/api/my-requests?status=all');
    const unchangedBookings = afterFailedReschedule.body.bookings.filter((booking) => booking.seriesId === seriesId);
    assert.deepEqual(unchangedBookings.map((booking) => booking.date).sort(), expectedDates);
    assert.ok(unchangedBookings.every((booking) => booking.startTime === '11:00'));
  });

  await t.test('supports admin bulk approve/deny/cancel across a recurring booking series', async () => {
    const adminEmail = uniqueEmail('admin-series-bulk');
    const password = 'Password123';
    await registerUser(new TestClient(baseUrl), adminEmail, password);
    await runSql('UPDATE users SET role = ? WHERE email = ?', ['admin', adminEmail]);

    const adminClient = new TestClient(baseUrl);
    const login = await loginUser(adminClient, adminEmail, password);
    assert.equal(login.role, 'admin');

    const roomSuffix = Date.now();
    const addRoom = await adminClient.request('/api/admin/rooms', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: `Bulk Series Room ${roomSuffix}`, location: `Bulk Series Wing ${roomSuffix}` })
    });
    assert.equal(addRoom.status, 200);

    const rooms = await adminClient.request('/api/admin/rooms');
    const room = rooms.body.rooms.find((r) => r.location === `Bulk Series Wing ${roomSuffix}`);
    assert.ok(room);

    const setApproval = await adminClient.request(`/api/admin/rooms/${room.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ requiresApproval: true })
    });
    assert.equal(setApproval.status, 200);

    const memberClient = new TestClient(baseUrl);
    const memberEmail = uniqueEmail('series-bulk-member');
    await registerUser(memberClient, memberEmail, password);
    await loginUser(memberClient, memberEmail, password);

    // Non-admins cannot use the bulk series endpoints.
    const nonAdminAttempt = await memberClient.request('/api/admin/bookings/series/1/cancel', { method: 'POST' });
    assert.equal(nonAdminAttempt.status, 403);

    // First series: deny it in bulk.
    const denyStart = formatDateFromToday(200);
    const denySeriesCreate = await memberClient.request('/api/book-room', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        roomId: room.id, date: denyStart, startTime: '09:00', durationHours: 1,
        recurrence: { frequency: 'weekly', occurrences: 3 }
      })
    });
    assert.equal(denySeriesCreate.status, 200);
    assert.equal(denySeriesCreate.body.status, 'pending');

    const adminBookingsAfterDenyCreate = await adminClient.request('/api/admin/bookings?status=all');
    const denySeriesBookings = adminBookingsAfterDenyCreate.body.bookings.filter((b) => b.userEmail === memberEmail && b.date >= denyStart);
    assert.equal(denySeriesBookings.length, 3);
    const denySeriesId = denySeriesBookings[0].seriesId;
    assert.ok(denySeriesId);
    assert.ok(denySeriesBookings.every((b) => b.status === 'pending' && b.seriesId === denySeriesId));

    const denySeries = await adminClient.request(`/api/admin/bookings/series/${denySeriesId}/deny`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason: 'Room unavailable' })
    });
    assert.equal(denySeries.status, 200);
    assert.match(denySeries.body.message, /3/);

    const afterDenySeries = await adminClient.request('/api/admin/bookings?status=all');
    const deniedBookings = afterDenySeries.body.bookings.filter((b) => b.seriesId === denySeriesId);
    assert.ok(deniedBookings.every((b) => b.status === 'denied'));

    // Denying again finds nothing pending left.
    const denyAgain = await adminClient.request(`/api/admin/bookings/series/${denySeriesId}/deny`, { method: 'POST' });
    assert.equal(denyAgain.status, 404);

    // Second series: approve it in bulk, then cancel it in bulk.
    const approveStart = formatDateFromToday(220);
    const approveSeriesCreate = await memberClient.request('/api/book-room', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        roomId: room.id, date: approveStart, startTime: '09:00', durationHours: 1,
        recurrence: { frequency: 'weekly', occurrences: 3 }
      })
    });
    assert.equal(approveSeriesCreate.status, 200);

    const adminBookingsAfterApproveCreate = await adminClient.request('/api/admin/bookings?status=all');
    const approveSeriesBookings = adminBookingsAfterApproveCreate.body.bookings.filter(
      (b) => b.userEmail === memberEmail && b.date >= approveStart
    );
    assert.equal(approveSeriesBookings.length, 3);
    const approveSeriesId = approveSeriesBookings[0].seriesId;

    const approveSeries = await adminClient.request(`/api/admin/bookings/series/${approveSeriesId}/approve`, {
      method: 'POST'
    });
    assert.equal(approveSeries.status, 200);
    assert.match(approveSeries.body.message, /3/);

    const afterApproveSeries = await adminClient.request('/api/admin/bookings?status=all');
    const approvedBookings = afterApproveSeries.body.bookings.filter((b) => b.seriesId === approveSeriesId);
    assert.ok(approvedBookings.every((b) => b.status === 'active'));

    const cancelSeries = await adminClient.request(`/api/admin/bookings/series/${approveSeriesId}/cancel`, {
      method: 'POST'
    });
    assert.equal(cancelSeries.status, 200);
    assert.match(cancelSeries.body.message, /3/);

    const afterCancelSeries = await adminClient.request('/api/admin/bookings?status=all');
    const cancelledBookings = afterCancelSeries.body.bookings.filter((b) => b.seriesId === approveSeriesId);
    assert.ok(cancelledBookings.every((b) => b.status === 'cancelled'));

    // Cancelling again finds nothing upcoming left.
    const cancelAgain = await adminClient.request(`/api/admin/bookings/series/${approveSeriesId}/cancel`, { method: 'POST' });
    assert.equal(cancelAgain.status, 404);
  });

  await t.test('supports loan borrow, edit, and return flow', async () => {
    const client = new TestClient(baseUrl);
    const email = uniqueEmail('loan');
    const password = 'Password123';
    await registerUser(client, email, password);
    await loginUser(client, email, password);

    const resources = await getResources(client);
    const equipmentId = resources.equipment[0].id;

    const borrowed = await client.request('/api/borrow-equipment', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ equipmentId, days: 3 })
    });
    assert.equal(borrowed.status, 200);

    const afterBorrow = await client.request('/api/my-requests?status=all');
    assert.equal(afterBorrow.status, 200);
    assert.equal(afterBorrow.body.loans.length, 1);

    const loan = afterBorrow.body.loans[0];
    const newReturnDate = formatDateFromToday(5);

    const edited = await client.request('/api/edit-loan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ loanId: loan.id, returnDate: newReturnDate })
    });
    assert.equal(edited.status, 200);

    const returnForm = new FormData();
    returnForm.append('loanId', String(loan.id));
    returnForm.append('returnCondition', 'Returned in good working condition.');

    const returned = await client.request('/api/return-loan', {
      method: 'POST',
      body: returnForm
    });
    assert.equal(returned.status, 200);

    const afterReturn = await client.request('/api/my-requests?status=all');
    assert.equal(afterReturn.body.loans[0].status, 'returned');
    assert.equal(afterReturn.body.loans[0].returnCondition, 'Returned in good working condition.');
  });

  await t.test('supports admin borrowing and returning equipment on behalf of another user, with damage flagging on return', async () => {
    const adminEmail = uniqueEmail('admin-onbehalf');
    const borrowerEmail = uniqueEmail('borrower-onbehalf');
    const otherEmail = uniqueEmail('other-onbehalf');
    const password = 'Password123';

    await registerUser(new TestClient(baseUrl), adminEmail, password);
    await runSql('UPDATE users SET role = ? WHERE email = ?', ['admin', adminEmail]);

    const adminClient = new TestClient(baseUrl);
    const login = await loginUser(adminClient, adminEmail, password);
    assert.equal(login.role, 'admin');

    const borrowerClient = new TestClient(baseUrl);
    await registerUser(borrowerClient, borrowerEmail, password);
    await loginUser(borrowerClient, borrowerEmail, password);

    const otherClient = new TestClient(baseUrl);
    await registerUser(otherClient, otherEmail, password);
    await loginUser(otherClient, otherEmail, password);

    const resources = await getResources(adminClient);
    const equipmentId = resources.equipment[0].id;

    // A regular user cannot borrow on behalf of someone else.
    const nonAdminAttempt = await borrowerClient.request('/api/borrow-equipment', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ equipmentId, days: 3, borrowerEmail: adminEmail })
    });
    assert.equal(nonAdminAttempt.status, 403);

    // Admin borrowing on behalf of an unknown email fails.
    const unknownUserAttempt = await adminClient.request('/api/borrow-equipment', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ equipmentId, days: 3, borrowerEmail: uniqueEmail('missing') })
    });
    assert.equal(unknownUserAttempt.status, 404);

    // Admin borrows equipment on behalf of the borrower.
    const onBehalfBorrow = await adminClient.request('/api/borrow-equipment', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ equipmentId, days: 3, borrowerEmail })
    });
    assert.equal(onBehalfBorrow.status, 200);
    assert.match(onBehalfBorrow.body.message, new RegExp(borrowerEmail));

    const borrowerRequests = await borrowerClient.request('/api/my-requests?status=all');
    assert.equal(borrowerRequests.body.loans.length, 1);
    const loan = borrowerRequests.body.loans[0];
    assert.equal(loan.status, 'active');

    // A user who is neither the owner nor an admin cannot return the loan.
    const foreignReturnForm = new FormData();
    foreignReturnForm.append('loanId', String(loan.id));
    foreignReturnForm.append('returnCondition', 'Should not be accepted.');
    const foreignReturnAttempt = await otherClient.request('/api/return-loan', {
      method: 'POST',
      body: foreignReturnForm
    });
    assert.equal(foreignReturnAttempt.status, 404);

    // Admin returns the loan on behalf of the borrower and flags the unit as damaged.
    const adminReturnForm = new FormData();
    adminReturnForm.append('loanId', String(loan.id));
    adminReturnForm.append('returnCondition', 'Cracked casing found on return.');
    adminReturnForm.append('damaged', 'true');
    const adminReturn = await adminClient.request('/api/return-loan', {
      method: 'POST',
      body: adminReturnForm
    });
    assert.equal(adminReturn.status, 200);
    assert.match(adminReturn.body.message, /damaged/);

    const adminLoans = await adminClient.request('/api/admin/loans?status=all');
    const returnedLoan = adminLoans.body.loans.find((row) => row.id === loan.id);
    assert.equal(returnedLoan.status, 'returned');
    assert.equal(returnedLoan.userEmail, borrowerEmail);
    assert.equal(returnedLoan.returnCondition, 'Cracked casing found on return.');

    // The unit backing the loan should now be flagged damaged.
    const equipmentList = await adminClient.request('/api/admin/equipment');
    const equipmentEntry = equipmentList.body.equipment.find((item) => item.id === equipmentId);
    const returnedUnit = equipmentEntry.codes.find((unit) => unit.code === returnedLoan.equipmentCode);
    assert.ok(returnedUnit);
    assert.equal(returnedUnit.condition, 'damaged');

    // Flagging damage on return should create a damage report linked back to the loan.
    const nonAdminReportsAttempt = await borrowerClient.request('/api/admin/damage-reports');
    assert.equal(nonAdminReportsAttempt.status, 403);

    const damageReports = await adminClient.request('/api/admin/damage-reports');
    assert.equal(damageReports.status, 200);
    const report = damageReports.body.reports.find((entry) => entry.loanId === loan.id);
    assert.ok(report, 'Expected a damage report linked to the returned loan.');
    assert.equal(report.description, 'Cracked casing found on return.');
    assert.equal(report.borrowerEmail, borrowerEmail);
    assert.equal(report.reportedByEmail, adminEmail);
    assert.equal(report.equipmentCode, returnedLoan.equipmentCode);
    assert.equal(report.photoPath, null);

    // No photo was uploaded on this return, so the photo route should 404.
    const missingPhoto = await adminClient.request(`/api/admin/damage-reports/${report.id}/photo`);
    assert.equal(missingPhoto.status, 404);
  });

  await t.test('supports admin listing and edit flows', async () => {
    const userClient = new TestClient(baseUrl);
    const userEmail = uniqueEmail('member');
    const password = 'Password123';
    await registerUser(userClient, userEmail, password);
    await loginUser(userClient, userEmail, password);

    const resources = await getResources(userClient);
    const roomId = resources.rooms[0].id;
    const equipmentId = resources.equipment[0].id;
    const bookingDate = formatDateFromToday(9);

    const bookingResponse = await userClient.request('/api/book-room', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        roomId,
        date: bookingDate,
        startTime: '11:00',
        durationHours: 1
      })
    });
    assert.equal(bookingResponse.status, 200);

    const borrowResponse = await userClient.request('/api/borrow-equipment', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ equipmentId, days: 2 })
    });
    assert.equal(borrowResponse.status, 200);

    const userRequests = await userClient.request('/api/my-requests?status=all');
    const bookingId = userRequests.body.bookings[0].id;
    const loanId = userRequests.body.loans[0].id;
    await logoutUser(userClient);

    const adminEmail = uniqueEmail('admin');
    await registerUser(new TestClient(baseUrl), adminEmail, password);
    await runSql('UPDATE users SET role = ? WHERE email = ?', ['admin', adminEmail]);

    const adminClient = new TestClient(baseUrl);
    const login = await loginUser(adminClient, adminEmail, password);
    assert.equal(login.role, 'admin');

    const users = await adminClient.request('/api/admin/users');
    assert.equal(users.status, 200);
    assert.ok(users.body.users.some((user) => user.email === userEmail));
    assert.ok(users.body.users.some((user) => user.email === adminEmail && user.role === 'admin'));

    const editedBookingDate = formatDateFromToday(10);
    const bookingEdit = await adminClient.request(`/api/admin/bookings/${bookingId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        date: editedBookingDate,
        startTime: '11:15',
        durationHours: 1.5
      })
    });
    assert.equal(bookingEdit.status, 200);

    const bookings = await adminClient.request('/api/admin/bookings?status=all');
    const editedBooking = bookings.body.bookings.find((booking) => booking.id === bookingId);
    assert.equal(editedBooking.date, editedBookingDate);
    assert.equal(editedBooking.startTime, '11:15');

    const editedLoanDate = formatDateFromToday(6);
    const loanEdit = await adminClient.request(`/api/admin/loans/${loanId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ returnDate: editedLoanDate })
    });
    assert.equal(loanEdit.status, 200);

    const loans = await adminClient.request('/api/admin/loans?status=all');
    const editedLoan = loans.body.loans.find((loanRow) => loanRow.id === loanId);
    assert.equal(editedLoan.returnDate, editedLoanDate);
  });

  await t.test('supports admin room and equipment management endpoints', async () => {
    const adminEmail = uniqueEmail('admin-mgmt');
    const password = 'Password123';

    await registerUser(new TestClient(baseUrl), adminEmail, password);
    await runSql('UPDATE users SET role = ? WHERE email = ?', ['admin', adminEmail]);

    const adminClient = new TestClient(baseUrl);
    const login = await loginUser(adminClient, adminEmail, password);
    assert.equal(login.role, 'admin');

    const roomSuffix = Date.now();
    const roomName = `Automation Room ${roomSuffix}`;
    const roomLocation = `Automation Wing ${roomSuffix}`;

    const addRoom = await adminClient.request('/api/admin/rooms', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: roomName, location: roomLocation })
    });
    assert.equal(addRoom.status, 200);
    assert.equal(addRoom.body.message, 'Room added successfully.');

    const roomsAfterAdd = await adminClient.request('/api/admin/rooms');
    assert.equal(roomsAfterAdd.status, 200);
    const addedRoom = roomsAfterAdd.body.rooms.find((room) => room.location === roomLocation);
    assert.ok(addedRoom);
    assert.equal(addedRoom.name, roomName);

    const removeRoom = await adminClient.request(`/api/admin/rooms/${addedRoom.id}`, {
      method: 'DELETE'
    });
    assert.equal(removeRoom.status, 200);
    assert.equal(removeRoom.body.message, 'Room removed successfully.');

    const roomsAfterRemove = await adminClient.request('/api/admin/rooms');
    assert.equal(roomsAfterRemove.status, 200);
    assert.equal(roomsAfterRemove.body.rooms.some((room) => room.id === addedRoom.id), false);

    const equipmentSuffix = Date.now();
    const equipmentName = `Automation Device ${equipmentSuffix}`;

    const addEquipment = await adminClient.request('/api/admin/equipment', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: equipmentName, quantity: 2 })
    });
    assert.equal(addEquipment.status, 200);
    assert.equal(addEquipment.body.message, 'Equipment added successfully.');

    const equipmentAfterAdd = await adminClient.request('/api/admin/equipment');
    assert.equal(equipmentAfterAdd.status, 200);
    const addedEquipment = equipmentAfterAdd.body.equipment.find((item) => item.name === equipmentName);
    assert.ok(addedEquipment);
    assert.equal(Number(addedEquipment.quantity), 2);

    const updateEquipment = await adminClient.request(`/api/admin/equipment/${addedEquipment.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ quantity: 3 })
    });
    assert.equal(updateEquipment.status, 200);
    assert.equal(updateEquipment.body.message, 'Equipment quantity updated successfully.');
    assert.equal(Number(updateEquipment.body.equipment.quantity), 3);

    const bookedOutEquipment = await adminClient.request('/api/admin/equipment/booked-out');
    assert.equal(bookedOutEquipment.status, 200);
    assert.ok(Array.isArray(bookedOutEquipment.body.loans));

    const removeEquipment = await adminClient.request(`/api/admin/equipment/${addedEquipment.id}`, {
      method: 'DELETE'
    });
    assert.equal(removeEquipment.status, 200);
    assert.equal(removeEquipment.body.message, 'Equipment removed successfully.');

    const equipmentAfterRemove = await adminClient.request('/api/admin/equipment');
    assert.equal(equipmentAfterRemove.status, 200);
    assert.equal(equipmentAfterRemove.body.equipment.some((item) => item.id === addedEquipment.id), false);
  });

  await t.test('marks equipment units as damaged and reduces borrowable availability', async () => {
    const adminEmail = uniqueEmail('admin-damage');
    const password = 'Password123';

    await registerUser(new TestClient(baseUrl), adminEmail, password);
    await runSql('UPDATE users SET role = ? WHERE email = ?', ['admin', adminEmail]);

    const adminClient = new TestClient(baseUrl);
    const login = await loginUser(adminClient, adminEmail, password);
    assert.equal(login.role, 'admin');

    const equipmentSuffix = Date.now();
    const equipmentName = `Damage Test Device ${equipmentSuffix}`;

    const addEquipment = await adminClient.request('/api/admin/equipment', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: equipmentName, quantity: 2 })
    });
    assert.equal(addEquipment.status, 200);

    const equipmentList = await adminClient.request('/api/admin/equipment');
    assert.equal(equipmentList.status, 200);
    const addedEquipment = equipmentList.body.equipment.find((item) => item.name === equipmentName);
    assert.ok(addedEquipment);
    assert.equal(addedEquipment.codes.length, 2);
    assert.ok(addedEquipment.codes.every((unit) => unit.condition === 'working'));

    const memberEmail = uniqueEmail('damage-member');
    const memberClient = new TestClient(baseUrl);
    await registerUser(memberClient, memberEmail, password);
    await loginUser(memberClient, memberEmail, password);

    const resourcesBefore = await getResources(memberClient);
    const equipmentBefore = resourcesBefore.equipment.find((item) => item.id === addedEquipment.id);
    assert.ok(equipmentBefore);
    assert.equal(equipmentBefore.available, 2);

    const [firstUnit, secondUnit] = addedEquipment.codes;

    const nonAdminAttempt = await memberClient.request(`/api/admin/equipment/units/${firstUnit.id}/condition`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ condition: 'damaged' })
    });
    assert.equal(nonAdminAttempt.status, 403);

    const invalidCondition = await adminClient.request(`/api/admin/equipment/units/${firstUnit.id}/condition`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ condition: 'broken' })
    });
    assert.equal(invalidCondition.status, 400);

    const markFirstDamaged = await adminClient.request(`/api/admin/equipment/units/${firstUnit.id}/condition`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ condition: 'damaged' })
    });
    assert.equal(markFirstDamaged.status, 200);
    assert.equal(markFirstDamaged.body.unit.condition, 'damaged');

    const resourcesAfterFirstDamage = await getResources(memberClient);
    const equipmentAfterFirstDamage = resourcesAfterFirstDamage.equipment.find((item) => item.id === addedEquipment.id);
    assert.equal(equipmentAfterFirstDamage.available, 1);

    const markSecondDamaged = await adminClient.request(`/api/admin/equipment/units/${secondUnit.id}/condition`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ condition: 'damaged' })
    });
    assert.equal(markSecondDamaged.status, 200);

    const resourcesAllDamaged = await getResources(memberClient);
    const equipmentAllDamaged = resourcesAllDamaged.equipment.find((item) => item.id === addedEquipment.id);
    assert.equal(equipmentAllDamaged.available, 0);

    const borrowAttempt = await memberClient.request('/api/borrow-equipment', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ equipmentId: addedEquipment.id, days: 2 })
    });
    assert.equal(borrowAttempt.status, 400);
    assert.equal(borrowAttempt.body.error, 'No equipment available to borrow right now.');

    const markFirstWorkingAgain = await adminClient.request(`/api/admin/equipment/units/${firstUnit.id}/condition`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ condition: 'working' })
    });
    assert.equal(markFirstWorkingAgain.status, 200);
    assert.equal(markFirstWorkingAgain.body.unit.condition, 'working');

    const resourcesAfterRestore = await getResources(memberClient);
    const equipmentAfterRestore = resourcesAfterRestore.equipment.find((item) => item.id === addedEquipment.id);
    assert.equal(equipmentAfterRestore.available, 1);
  });

  await t.test('tracks equipment unit lifecycle status, including overdue loans', async () => {
    const adminEmail = uniqueEmail('admin-state');
    const password = 'Password123';

    await registerUser(new TestClient(baseUrl), adminEmail, password);
    await runSql('UPDATE users SET role = ? WHERE email = ?', ['admin', adminEmail]);

    const adminClient = new TestClient(baseUrl);
    const login = await loginUser(adminClient, adminEmail, password);
    assert.equal(login.role, 'admin');

    const equipmentName = `Overdue Test Device ${Date.now()}`;
    const addEquipment = await adminClient.request('/api/admin/equipment', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: equipmentName, quantity: 1 })
    });
    assert.equal(addEquipment.status, 200);

    const equipmentList = await adminClient.request('/api/admin/equipment');
    const addedEquipment = equipmentList.body.equipment.find((item) => item.name === equipmentName);
    assert.ok(addedEquipment);
    assert.equal(addedEquipment.codes[0].status, 'available');
    assert.equal(addedEquipment.statusCounts.available, 1);

    const memberEmail = uniqueEmail('state-member');
    const memberClient = new TestClient(baseUrl);
    await registerUser(memberClient, memberEmail, password);
    await loginUser(memberClient, memberEmail, password);

    const borrowed = await memberClient.request('/api/borrow-equipment', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ equipmentId: addedEquipment.id, days: 1 })
    });
    assert.equal(borrowed.status, 200);

    const equipmentAfterBorrow = await adminClient.request('/api/admin/equipment');
    const checkedOutUnit = equipmentAfterBorrow.body.equipment.find((item) => item.id === addedEquipment.id);
    assert.equal(checkedOutUnit.codes[0].status, 'checked-out');
    assert.equal(checkedOutUnit.statusCounts.checkedOut, 1);

    const memberLoans = await memberClient.request('/api/my-requests?status=all');
    const loanId = memberLoans.body.loans[0].id;

    // Simulate the loan going overdue (the API only ever creates future-dated return dates).
    await runSql('UPDATE loans SET returnDate = ? WHERE id = ?', [formatDateFromToday(-2), loanId]);

    const equipmentAfterOverdue = await adminClient.request('/api/admin/equipment');
    const overdueUnit = equipmentAfterOverdue.body.equipment.find((item) => item.id === addedEquipment.id);
    assert.equal(overdueUnit.codes[0].status, 'overdue');
    assert.equal(overdueUnit.statusCounts.overdue, 1);
    assert.equal(overdueUnit.statusCounts.available, 0);

    const resourcesWhileOverdue = await getResources(memberClient);
    const equipmentWhileOverdue = resourcesWhileOverdue.equipment.find((item) => item.id === addedEquipment.id);
    assert.equal(equipmentWhileOverdue.available, 0);
    assert.equal(equipmentWhileOverdue.statusCounts.overdue, 1);

    // Overdue equipment must stay on the booked-out list rather than disappearing once its return date passes.
    const bookedOut = await adminClient.request('/api/admin/equipment/booked-out');
    const overdueLoanRow = bookedOut.body.loans.find((loan) => loan.equipmentCode === overdueUnit.codes[0].code);
    assert.ok(overdueLoanRow);
    assert.equal(overdueLoanRow.status, 'overdue');

    // A second user must not be able to borrow the same overdue (still checked-out) unit.
    const otherMemberEmail = uniqueEmail('state-other');
    const otherMemberClient = new TestClient(baseUrl);
    await registerUser(otherMemberClient, otherMemberEmail, password);
    await loginUser(otherMemberClient, otherMemberEmail, password);

    const blockedBorrow = await otherMemberClient.request('/api/borrow-equipment', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ equipmentId: addedEquipment.id, days: 1 })
    });
    assert.equal(blockedBorrow.status, 400);
    assert.equal(blockedBorrow.body.error, 'No equipment available to borrow right now.');

    // Returning the overdue loan frees the unit back to available.
    const returnForm = new FormData();
    returnForm.append('loanId', String(loanId));
    returnForm.append('returnCondition', 'Returned late but undamaged.');
    const returned = await memberClient.request('/api/return-loan', { method: 'POST', body: returnForm });
    assert.equal(returned.status, 200);

    const equipmentAfterReturn = await adminClient.request('/api/admin/equipment');
    const returnedUnit = equipmentAfterReturn.body.equipment.find((item) => item.id === addedEquipment.id);
    assert.equal(returnedUnit.codes[0].status, 'available');
    assert.equal(returnedUnit.statusCounts.available, 1);
  });

  await t.test('enforces configurable room policies and the admin booking approval workflow', async () => {
    const adminEmail = uniqueEmail('policy-admin');
    const password = 'Password123';

    await registerUser(new TestClient(baseUrl), adminEmail, password);
    await runSql('UPDATE users SET role = ? WHERE email = ?', ['admin', adminEmail]);

    const adminClient = new TestClient(baseUrl);
    const login = await loginUser(adminClient, adminEmail, password);
    assert.equal(login.role, 'admin');

    const roomSuffix = Date.now();
    const roomName = `Policy Room ${roomSuffix}`;
    const roomLocation = `Policy Wing ${roomSuffix}`;

    const addRoom = await adminClient.request('/api/admin/rooms', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: roomName, location: roomLocation })
    });
    assert.equal(addRoom.status, 200);

    const roomsAfterAdd = await adminClient.request('/api/admin/rooms');
    const room = roomsAfterAdd.body.rooms.find((r) => r.location === roomLocation);
    assert.ok(room);
    assert.equal(room.requiresApproval, 0);

    const invalidPolicy = await adminClient.request(`/api/admin/rooms/${room.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ minDurationMinutes: 120, maxDurationMinutes: 60 })
    });
    assert.equal(invalidPolicy.status, 400);

    const policyUpdate = await adminClient.request(`/api/admin/rooms/${room.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        minDurationMinutes: 60,
        maxDurationMinutes: 120,
        maxBookingsPerUserPerWeek: 1,
        requiresApproval: true
      })
    });
    assert.equal(policyUpdate.status, 200);

    const memberEmail = uniqueEmail('policy-member');
    const memberClient = new TestClient(baseUrl);
    await registerUser(memberClient, memberEmail, password);
    await loginUser(memberClient, memberEmail, password);

    const nonAdminBlackoutList = await memberClient.request(`/api/admin/rooms/${room.id}/blackouts`);
    assert.equal(nonAdminBlackoutList.status, 403);

    const bookingDate = formatDateFromToday(14);

    const tooShort = await memberClient.request('/api/book-room', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ roomId: room.id, date: bookingDate, startTime: '09:00', durationHours: 0.5 })
    });
    assert.equal(tooShort.status, 400);
    assert.match(tooShort.body.error, /at least 60 minutes/);

    const tooLong = await memberClient.request('/api/book-room', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ roomId: room.id, date: bookingDate, startTime: '09:00', durationHours: 3 })
    });
    assert.equal(tooLong.status, 400);
    assert.match(tooLong.body.error, /at most 120 minutes/);

    const invalidBlackout = await adminClient.request(`/api/admin/rooms/${room.id}/blackouts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ date: bookingDate, startTime: '10:00', endTime: '09:00' })
    });
    assert.equal(invalidBlackout.status, 400);

    const addBlackout = await adminClient.request(`/api/admin/rooms/${room.id}/blackouts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ date: bookingDate, startTime: '09:00', endTime: '10:00', reason: 'Maintenance' })
    });
    assert.equal(addBlackout.status, 200);

    const blackoutHit = await memberClient.request('/api/book-room', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ roomId: room.id, date: bookingDate, startTime: '09:00', durationHours: 1 })
    });
    assert.equal(blackoutHit.status, 400);
    assert.match(blackoutHit.body.error, /blackout period/);

    const firstBooking = await memberClient.request('/api/book-room', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ roomId: room.id, date: bookingDate, startTime: '11:00', durationHours: 1 })
    });
    assert.equal(firstBooking.status, 200);
    assert.equal(firstBooking.body.status, 'pending');

    const memberRequestsAfterFirst = await memberClient.request('/api/my-requests?status=all');
    const pendingBooking = memberRequestsAfterFirst.body.bookings.find((b) => b.date === bookingDate && b.startTime === '11:00');
    assert.ok(pendingBooking);
    assert.equal(pendingBooking.status, 'pending');

    const overFrequencyCap = await memberClient.request('/api/book-room', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ roomId: room.id, date: bookingDate, startTime: '14:00', durationHours: 1 })
    });
    assert.equal(overFrequencyCap.status, 400);
    assert.match(overFrequencyCap.body.error, /maximum of 1 booking/);

    const nonAdminApprove = await memberClient.request(`/api/admin/bookings/${pendingBooking.id}/approve`, {
      method: 'POST'
    });
    assert.equal(nonAdminApprove.status, 403);

    const approve = await adminClient.request(`/api/admin/bookings/${pendingBooking.id}/approve`, {
      method: 'POST'
    });
    assert.equal(approve.status, 200);

    const memberRequestsAfterApprove = await memberClient.request('/api/my-requests?status=all');
    const approvedBooking = memberRequestsAfterApprove.body.bookings.find((b) => b.id === pendingBooking.id);
    assert.equal(approvedBooking.status, 'active');

    const reApprove = await adminClient.request(`/api/admin/bookings/${pendingBooking.id}/approve`, {
      method: 'POST'
    });
    assert.equal(reApprove.status, 400);

    const denyDate = formatDateFromToday(30);
    const bookingToDeny = await memberClient.request('/api/book-room', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ roomId: room.id, date: denyDate, startTime: '11:00', durationHours: 1 })
    });
    assert.equal(bookingToDeny.status, 200);
    assert.equal(bookingToDeny.body.status, 'pending');

    const memberRequestsBeforeDeny = await memberClient.request('/api/my-requests?status=all');
    const denyTarget = memberRequestsBeforeDeny.body.bookings.find((b) => b.date === denyDate && b.startTime === '11:00');
    assert.ok(denyTarget);

    const deny = await adminClient.request(`/api/admin/bookings/${denyTarget.id}/deny`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason: 'Conflicts with maintenance schedule.' })
    });
    assert.equal(deny.status, 200);

    const memberRequestsAfterDeny = await memberClient.request('/api/my-requests?status=all');
    const deniedBooking = memberRequestsAfterDeny.body.bookings.find((b) => b.id === denyTarget.id);
    assert.equal(deniedBooking.status, 'denied');

    // A denied booking frees its slot: rebooking the same time now succeeds (again pending approval).
    const rebooked = await memberClient.request('/api/book-room', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ roomId: room.id, date: denyDate, startTime: '11:00', durationHours: 1 })
    });
    assert.equal(rebooked.status, 200);
    assert.equal(rebooked.body.status, 'pending');

    const blackoutsList = await adminClient.request(`/api/admin/rooms/${room.id}/blackouts`);
    assert.equal(blackoutsList.status, 200);
    assert.equal(blackoutsList.body.blackouts.length, 1);

    const removeBlackout = await adminClient.request(`/api/admin/rooms/${room.id}/blackouts/${blackoutsList.body.blackouts[0].id}`, {
      method: 'DELETE'
    });
    assert.equal(removeBlackout.status, 200);

    const blackoutsAfterRemove = await adminClient.request(`/api/admin/rooms/${room.id}/blackouts`);
    assert.equal(blackoutsAfterRemove.body.blackouts.length, 0);
  });
});