# Farm-Net Prototype

This prototype is a university room booking and equipment checkout web app. It combines an Express backend, SQLite persistence, and a static frontend with a weekly timetable for booking rooms.

## Run Locally

1. Open a terminal in `Prototype/`.
2. Install dependencies.

```bash
npm install
```

3. Start the app.

```bash
npm start
```

4. Open `http://localhost:3000`.

Node.js 18+ is recommended. The prototype uses only the packages listed in `package.json`.

## What The App Does

- Register and log in with email-based accounts.
- View the weekly availability timetable for rooms.
- Book a room using a date, start time, and duration.
- Cancel and edit personal room bookings.
- Borrow equipment and return it with condition notes and an optional photo.
- Review active and historical bookings, loans, and request status.
- Change your password and save a light or dark theme preference.
- Use admin pages to manage users, bookings, loans, rooms, and equipment.

## Key Screens

- `User Bookings`: dashboard showing the signed-in user's bookings and loans.
- `Room Bookings`: weekly timetable plus booking form.
- `Equipment Loans`: current equipment inventory and borrowing actions.
- `Settings`: password change and theme preference.
- `Admin`: user, booking, loan, and audit log management.
- `Room Management` and `Equipment Management`: admin-only inventory administration.

## Project Structure

- `server.js`: Express backend, session handling, SQLite database access, and API routes.
- `public/index.html`: page structure and form markup.
- `public/app.js`: application bootstrap and page wiring.
- `public/js/`: page modules for rooms, equipment, admin, settings, and management screens.
- `public/styles.css`: shared styling for the whole prototype.
- `data/lab-booking.db`: SQLite database created at runtime.
- `data/return-photos/`: uploaded photos attached to equipment returns.

## Important API Areas

- `/api/register`, `/api/login`, `/api/logout`, `/api/profile`
- `/api/preferences`, `/api/change-password`
- `/api/resources`, `/api/my-requests`, `/api/book-room`, `/api/cancel-booking`, `/api/edit-booking`
- `/api/borrow-equipment`, `/api/cancel-loan`, `/api/return-loan`, `/api/edit-loan`
- `/api/timetable`, `/api/rooms/:roomId/schedule`
- Admin routes under `/api/admin/*` for users, bookings, loans, rooms, equipment, and audit logging

## Configuration

- `EMAIL_VERIFICATION_ENABLED`: defaults to `true`. Set to `false` to bypass MX and SMTP mailbox verification during offline development.
- `EMAIL_VERIFICATION_TIMEOUT_MS`: defaults to `8000`.
- `EMAIL_VERIFICATION_MAX_MX`: defaults to `3`.

## Resetting Data

- Delete `Prototype/data/lab-booking.db` to recreate the seeded database on the next launch.
- Delete files in `Prototype/data/return-photos/` if you want to clear uploaded return photos during local development.

## Notes

- Room booking uses a weekly timetable rather than the older per-day slot picker.
- The prototype already supports booking edits, booking archives/history, and admin management flows.
- Remaining roadmap items from the project brief are email notifications and registration confirmation.
- Only admins can create admins. Teast login for admins is "admin@gmail.com" & "admin1234"
