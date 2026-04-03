# Lab Booking & Equipment Checkout Prototype

This prototype provides a university lab room booking and equipment borrowing web app.

## Run locally

1. Open a terminal in `Prototype/`
2. Install Node.js locally

```bash
winget install OpenJS.NodeJS.LTS
```

3. Install dependencies:

```bash
npm install
```

4. Start the app:

```bash
npm start
```

5. Open `http://localhost:3000`

## Features

- Register and log in as a student.
- View available lab rooms.
- Book a room for a date and time in 15-minute increments.
- View available equipment and borrow items for a number of days.
- Review your active bookings and loans.
- Cancel your own upcoming room bookings.

## Architecture

- `server.js`: Express backend, session login, SQLite database, and API routes.
- `public/index.html`: frontend structure and booking UI.
- `public/styles.css`: styling for the login/register form, dashboard, and booking panel.
- `public/app.js`: client-side logic for authentication, room listing, booking, and equipment loans.
- `data/lab-booking.db`: SQLite database file created at runtime.

## How it works

- Users register and log in through `/api/register` and `/api/login`.
- Authenticated users can load resources from `/api/resources`.
- Room booking requests are sent to `/api/book-room`.
- Room cancellation requests are sent to `/api/cancel-booking` (only your upcoming bookings can be cancelled).
- Equipment borrowing requests are sent to `/api/borrow-equipment`.
- The server validates 15-minute booking increments and prevents overlapping room reservations.

## Modify rooms or equipment

- Change default room seed data in `Prototype/server.js` inside `initDatabase()`.
- Delete `Prototype/data/lab-booking.db` to recreate seeded rooms and equipment on next launch.
