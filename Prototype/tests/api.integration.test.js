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
        startTime: '10:00',
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
        startTime: '10:15',
        durationHours: 1.5
      })
    });
    assert.equal(edited.status, 200);

    const afterEdit = await client.request('/api/my-requests?status=all');
    assert.equal(afterEdit.body.bookings[0].date, editedDate);
    assert.equal(afterEdit.body.bookings[0].startTime, '10:15');

    const cancelled = await client.request('/api/cancel-booking', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bookingId })
    });
    assert.equal(cancelled.status, 200);

    const afterCancel = await client.request('/api/my-requests?status=all');
    assert.equal(afterCancel.body.bookings[0].status, 'cancelled');
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
});