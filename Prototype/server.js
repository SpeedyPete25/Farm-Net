const express = require('express');
const path = require('path');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const sqlite3 = require('sqlite3');
const fs = require('fs');

const app = express();
const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const dbFile = path.join(dataDir, 'lab-booking.db');
const db = new sqlite3.Database(dbFile);

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use(session({
  secret: 'laboratory-booking-secret',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 24 * 60 * 60 * 1000 }
}));

function query(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) reject(err);
      else resolve(this);
    });
  });
}

async function initDatabase() {
  await run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    passwordHash TEXT NOT NULL
  )`);

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
    createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(userId) REFERENCES users(id),
    FOREIGN KEY(roomId) REFERENCES rooms(id)
  )`);

  await run(`CREATE TABLE IF NOT EXISTS loans (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    userId INTEGER NOT NULL,
    equipmentId INTEGER NOT NULL,
    borrowDate TEXT NOT NULL,
    returnDate TEXT NOT NULL,
    createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(userId) REFERENCES users(id),
    FOREIGN KEY(equipmentId) REFERENCES equipment(id)
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
}

function requireLogin(req, res, next) {
  if (!req.session.userId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

app.post('/api/register', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required.' });
  }

  const passwordHash = await bcrypt.hash(password, 10);
  try {
    await run('INSERT INTO users (username, passwordHash) VALUES (?, ?)', [username, passwordHash]);
    res.json({ message: 'Registration successful. You can now log in.' });
  } catch (err) {
    if (err.message.includes('UNIQUE')) {
      return res.status(400).json({ error: 'Username already exists.' });
    }
    res.status(500).json({ error: 'Could not create account.' });
  }
});

app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required.' });
  }

  const users = await query('SELECT * FROM users WHERE username = ?', [username]);
  if (users.length === 0) {
    return res.status(400).json({ error: 'Invalid username or password.' });
  }

  const user = users[0];
  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) {
    return res.status(400).json({ error: 'Invalid username or password.' });
  }

  req.session.userId = user.id;
  req.session.username = user.username;
  res.json({ message: 'Login successful.', username: user.username });
});

app.post('/api/logout', (req, res) => {
  req.session.destroy(() => {
    res.json({ message: 'Logged out.' });
  });
});

app.get('/api/profile', (req, res) => {
  if (!req.session.userId) {
    return res.json({ authenticated: false });
  }
  res.json({ authenticated: true, username: req.session.username });
});

app.get('/api/resources', requireLogin, async (req, res) => {
  const rooms = await query('SELECT * FROM rooms');
  const equipment = await query('SELECT * FROM equipment');

  const loans = await query('SELECT equipmentId, COUNT(*) AS activeLoans FROM loans WHERE returnDate >= date("now") GROUP BY equipmentId');
  const loanMap = loans.reduce((acc, item) => {
    acc[item.equipmentId] = item.activeLoans;
    return acc;
  }, {});

  const equipmentWithAvailability = equipment.map((item) => {
    const activeLoans = loanMap[item.id] || 0;
    return { ...item, available: Math.max(0, item.quantity - activeLoans) };
  });

  res.json({ rooms, equipment: equipmentWithAvailability });
});

app.get('/api/my-requests', requireLogin, async (req, res) => {
  const userId = req.session.userId;
  const bookings = await query(
    `SELECT b.id, r.name AS roomName, r.location, b.date, b.startTime, b.durationHours
     FROM bookings b
     JOIN rooms r ON r.id = b.roomId
     WHERE b.userId = ?
     ORDER BY b.date, b.startTime`,
    [userId]
  );

  const loans = await query(
    `SELECT l.id, e.name AS equipmentName, l.borrowDate, l.returnDate
     FROM loans l
     JOIN equipment e ON e.id = l.equipmentId
     WHERE l.userId = ?
     ORDER BY l.borrowDate`,
    [userId]
  );
  res.json({ bookings, loans });
});

app.post('/api/book-room', requireLogin, async (req, res) => {
  const { roomId, date, startTime, durationHours } = req.body;
  if (!roomId || !date || !startTime || !durationHours) {
    return res.status(400).json({ error: 'Room, date, start time and duration are required.' });
  }

  const conflict = await query(
    'SELECT * FROM bookings WHERE roomId = ? AND date = ? AND startTime = ?',
    [roomId, date, startTime]
  );

  if (conflict.length > 0) {
    return res.status(400).json({ error: 'Selected room is already booked at that time.' });
  }

  await run(
    'INSERT INTO bookings (userId, roomId, date, startTime, durationHours) VALUES (?, ?, ?, ?, ?)',
    [req.session.userId, roomId, date, startTime, durationHours]
  );
  res.json({ message: 'Room booked successfully.' });
});

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

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

initDatabase()
  .then(() => {
    const port = process.env.PORT || 3000;
    app.listen(port, () => console.log(`Lab booking app running on http://localhost:${port}`));
  })
  .catch((err) => {
    console.error('Failed to initialize database:', err);
    process.exit(1);
  });
