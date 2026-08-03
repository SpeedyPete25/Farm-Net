# Farm-Net App

Farm-Net App is a university room booking and equipment checkout web app. It combines an Express backend, SQLite persistence, and a static (no build step) frontend with a weekly timetable for booking rooms. This folder is the active development line; [`../Prototype/`](../Prototype/) is kept as a frozen reference copy of the earlier prototype.

## Requirements

- Node.js 18+ (uses only the packages listed in `package.json`).
- No external database is required — SQLite storage is created automatically on first run.

## Run Locally

1. Open a terminal in `FarmNet-App/`.
2. Install dependencies.

```bash
npm install
```

3. Start the app.

```bash
npm start
```

4. Open `http://localhost:3000`.

Optional: create `FarmNet-App/.env` to override configuration values.

```env
PORT=3000
EMAIL_VERIFICATION_ENABLED=false
EMAIL_VERIFICATION_TIMEOUT_MS=8000
EMAIL_VERIFICATION_MAX_MX=3
```

No default admin account is seeded. Register a normal account first, then promote it to `admin` directly in the SQLite database (`UPDATE users SET role = 'admin' WHERE email = '...'`) — only existing admins can promote other users through the app itself.

## Testing

The app includes automated tests using the built-in Node.js test runner plus Playwright for browser-level checks.

Commands:

```bash
npm test          # reset test data, then run the API integration suite
npm run test:api      # same as above, explicit alias
npm run test:browser  # reset test data, then run the Playwright smoke suite
npm run test:reset     # clear automated test artifacts only
```

What the suite currently covers (`tests/api.integration.test.js`):

- Frontend shell response and signed-out `/api/profile` state.
- Register, login, profile, preferences, and logout.
- Validation and authorization failures (expected 400/401/403/404 status codes).
- Booking flow: create, edit, cancel.
- Equipment loan flow: borrow, edit, return.
- Admin listing and edit flows for bookings and loans.
- Admin room and equipment management endpoints (add/update/remove, including quantity and unit-code edge cases).
- Equipment unit damage tagging: marking units damaged/working, resulting availability changes, blocked borrowing when no working units remain, and admin-only access to the condition endpoint.

Browser smoke suite (`tests/browser/smoke.spec.js`, `playwright.config.js`):

- Signed-out app shell loads correctly.
- Register, login, page navigation, and logout journey.
- Admin-only navigation appears for an admin account.

Test runs use an isolated SQLite database and return-photo directory under `FarmNet-App/.test-data/` (the Playwright suite further isolates itself under `.test-data/browser/` on port `3201`), so they do not touch your normal `FarmNet-App/data/` files or default port `3000`.

If Playwright reports a missing browser runtime on a new machine, run:

```bash
npx playwright install chromium
```

## What The App Does

- Register and log in with email-based accounts; registration can optionally verify the mailbox is real (MX + SMTP check).
- View the weekly availability timetable for rooms.
- Book a room using a date, start time, and duration, in 15-minute increments.
- Cancel and edit personal room bookings (future, active/pending bookings only; conflicts are rejected).
- Rooms can be configured with booking policies: minimum/maximum booking length, a maximum number of bookings per user per week, blackout windows, and whether new bookings require admin approval before becoming active.
- Borrow equipment and return it with condition notes and an optional photo; each physical unit gets a unique code (e.g. `lap001`) assigned at borrow time.
- Review active and historical bookings, loans, and request status.
- Change your password and save a light or dark theme preference.
- Use admin pages to manage users (roles, deletion), bookings, loans, rooms, equipment, and audit history.

## Key Screens

- `User Bookings`: dashboard showing the signed-in user's bookings and loans.
- `Room Bookings`: weekly timetable plus booking form.
- `Equipment Loans`: current equipment inventory and borrowing actions.
- `Settings`: password change and theme preference.
- `User Management`: role management, user deletion, plus booking, loan, and audit log administration.
- `Room Management` and `Equipment Management`: admin-only inventory administration, including per-room booking policy (length limits, weekly frequency cap, admin approval toggle) and blackout window management.

## Project Structure

- `server.js`: Express backend — session handling, SQLite schema/migrations, mailbox verification, and all API routes.
- `public/index.html`: page structure and form markup for every screen.
- `public/app.js`: application bootstrap and page/router wiring.
- `public/js/api.js`: shared `fetch` wrapper used by all page modules.
- `public/js/utils.js`: shared formatting/DOM helpers.
- `public/js/dashboard-page.js`: user dashboard (bookings + loans overview).
- `public/js/rooms-page.js`: weekly timetable and room booking form.
- `public/js/equipment-page.js`: equipment inventory, borrowing, and returns.
- `public/js/settings-page.js`: password change and theme preference.
- `public/js/admin-page.js`: admin user/booking/loan management and audit log.
- `public/js/room-management-page.js`: admin room CRUD.
- `public/js/equipment-management-page.js`: admin equipment CRUD.
- `public/styles.css`: shared styling for the whole app.
- `scripts/reset-test-data.js`: deletes `.test-data/` for a clean test run.
- `data/lab-booking.db`: SQLite database created at runtime (default data dir).
- `data/return-photos/`: uploaded photos attached to equipment returns (default data dir).
- `tests/api.integration.test.js`: Node.js test runner API/integration suite.
- `tests/browser/smoke.spec.js`: Playwright browser smoke suite.
- `playwright.config.js`: Playwright config — boots the server on port `3201` against an isolated data dir.

## Data Model

SQLite tables, created and migrated automatically on startup (`initDatabase()` in `server.js`):

- `users`: `id`, `email` (unique), `passwordHash`, `role` (`user`/`admin`, default `user`), `theme` (default `dark`).
- `rooms`: `id`, `name`, `location`, `minDurationMinutes`, `maxDurationMinutes`, `maxBookingsPerUserPerWeek` (all nullable — unset means no limit), `requiresApproval` (0/1, default 0).
- `room_blackouts`: `id`, `roomId`, `date`, `startTime`, `endTime`, `reason`, `createdAt` — blocked-out windows during which a room cannot be booked.
- `equipment`: `id`, `name`, `quantity` (total units).
- `equipment_units`: `id`, `equipmentId`, `code` (unique short code such as `lap001`) — one row per physical, loanable unit.
- `bookings`: `id`, `userId`, `roomId`, `date`, `startTime`, `durationHours`, `status` (`active`/`pending`/`denied`/`cancelled`), `createdAt`. A booking is created as `pending` when its room has `requiresApproval` set, otherwise `active`.
- `loans`: `id`, `userId`, `equipmentId`, `equipmentUnitId`, `borrowDate`, `returnDate`, `status` (`active`/`cancelled`/`returned`), `returnCondition`, `returnConditionPhotoPath`, `returnedAt`, `createdAt`.
- `activity_history`: `id`, `userId` (actor), `eventType`, `resourceType`, `resourceId`, `description`, `timestamp` — the audit log backing `/api/admin/audit-log`.

Three rooms (Chemistry Lab, Computer Lab, Physics Lab) and three equipment types (Laptop, Microscope, Oscilloscope) are seeded on first run if the tables are empty.

## API Reference

All routes are prefixed with `/api`. Routes marked **auth** require an active session (`requireLogin`); routes marked **admin** require an admin session (`requireAdmin`) and return `401`/`403` otherwise.

**Account & session**
- `POST /register` — create an account (validates email format, and mailbox reachability if enabled).
- `POST /login` — authenticate and start a session.
- `POST /logout` — destroy the current session.
- `GET /profile` — current auth state, email, role, theme.
- `PATCH /preferences` **auth** — update theme (`dark`/`light`).
- `POST /change-password` **auth** — change password (requires current password, 8+ char new password).

**Resources & timetable**
- `GET /resources` **auth** — rooms plus equipment with computed availability.
- `GET /timetable` **auth** — 7-day booking grid for a room (`roomId`, `weekStart`).
- `GET /rooms/:roomId/schedule` **auth** — bookings for a room on a specific date.

**Bookings (self-service)**
- `GET /my-requests` **auth** — current user's bookings and loans (`status=active|all`; `active` includes `pending`).
- `POST /book-room` **auth** — create a booking (future time, 15-minute increments, overlap check, room policy checks). Returns `status: 'pending'` instead of `'active'` when the room requires admin approval.
- `POST /edit-booking` **auth** — edit own active/pending booking (re-validated against room policy).
- `POST /cancel-booking` **auth** — cancel own active/pending, future booking.

**Equipment loans (self-service)**
- `POST /borrow-equipment` **auth** — borrow an available unit for N days; assigns a specific unit code.
- `POST /edit-loan` **auth** — change the return date on an active loan.
- `POST /cancel-loan` **auth** — cancel an active, non-past loan.
- `POST /return-loan` **auth**, `multipart/form-data` — mark a loan returned with a required condition note and optional photo (image, ≤5 MB).
- `GET /loans/:id/photo` **auth** — fetch the return-condition photo for one of your own loans.

**Admin — users**
- `GET /admin/users` **admin** — list all users.
- `PATCH /admin/users/:id/role` **admin** — change a user's role (blocks demoting the last admin).
- `DELETE /admin/users/:id` **admin** — delete a user and cascade-delete their bookings, loans, and activity history (blocks self-deletion and deleting the last admin).

**Admin — bookings**
- `GET /admin/bookings` **admin** — list all bookings (`status=active|all`).
- `POST /admin/bookings/:id/cancel` **admin** — cancel any active/pending, future booking.
- `PATCH /admin/bookings/:id` **admin** — edit any active/pending booking (same validation as user edit, room policy not re-checked).
- `POST /admin/bookings/:id/approve` **admin** — approve a `pending` booking, moving it to `active`.
- `POST /admin/bookings/:id/deny` **admin** — deny a `pending` booking, moving it to `denied` (optional `reason` logged to the audit trail).

**Admin — loans**
- `GET /admin/loans` **admin** — list all loans (`status=active|all`).
- `POST /admin/loans/:id/cancel` **admin** — cancel any active, non-past loan.
- `PATCH /admin/loans/:id` **admin** — edit any active loan's return date.
- `GET /admin/loans/:id/photo` **admin** — fetch the return-condition photo for any loan.
- `GET /admin/equipment/booked-out` **admin** — active loans with borrower and unit details.

**Admin — rooms**
- `GET /admin/rooms` **admin** — list all rooms, including configured policy fields.
- `POST /admin/rooms` **admin** — add a room (rejects duplicate location); accepts optional policy fields (see below).
- `PATCH /admin/rooms/:id` **admin** — update a room's booking policy: `minDurationMinutes`, `maxDurationMinutes`, `maxBookingsPerUserPerWeek` (all optional — omit/blank for no limit) and `requiresApproval` (boolean).
- `DELETE /admin/rooms/:id` **admin** — remove a room (blocks if it has future active/pending bookings).
- `GET /admin/rooms/:roomId/blackouts` **admin** — list blackout windows for a room.
- `POST /admin/rooms/:roomId/blackouts` **admin** — add a blackout window (`date`, `startTime`, `endTime`, optional `reason`); bookings overlapping a blackout are rejected.
- `DELETE /admin/rooms/:roomId/blackouts/:blackoutId` **admin** — remove a blackout window.

**Admin — equipment**
- `GET /admin/equipment` **admin** — list equipment with unit codes.
- `POST /admin/equipment` **admin** — add equipment (creates matching unit codes; rejects duplicate name).
- `PATCH /admin/equipment/:id` **admin** — change quantity (adds/removes unit codes; blocks reducing below active loan count or below available unassigned units).
- `DELETE /admin/equipment/:id` **admin** — remove equipment and its unit codes (blocks if it has active loans).

**Admin — audit**
- `GET /admin/audit-log` **admin** — most recent 100 audit log entries (actor, event type, resource, description, timestamp).

## Configuration

- `EMAIL_VERIFICATION_ENABLED`: defaults to `true`. Set to `false` to bypass MX and SMTP mailbox verification during offline development.
- `EMAIL_VERIFICATION_TIMEOUT_MS`: defaults to `8000`. Timeout for each DNS/SMTP step during mailbox verification.
- `EMAIL_VERIFICATION_MAX_MX`: defaults to `3`. Maximum number of MX servers probed per registration.
- `PORT`: defaults to `3000`.
- `DATA_DIR`: optional override for the app data directory (SQLite database + `return-photos/`). Used by automated tests to isolate data from `data/`.

`EMAIL_VERIFICATION_ENABLED` accepts `true/false`, `1/0`, `yes/no`, and `on/off` (case-insensitive).

Known-provider domains (Gmail, Outlook, Yahoo, iCloud, etc.) are treated as valid when DNS/SMTP verification is inconclusive, to avoid false negatives on networks that block outbound SMTP.

## Resetting Data

- Delete `FarmNet-App/data/lab-booking.db` to recreate the seeded database on the next launch.
- Delete files in `FarmNet-App/data/return-photos/` if you want to clear uploaded return photos during local development.
- Run `npm run test:reset` to clear automated test artifacts in `FarmNet-App/.test-data/`.

## Troubleshooting

- App does not start because port `3000` is already in use:
	- Set a different port in `FarmNet-App/.env`, for example `PORT=3001`, then restart with `npm start`.
	- Or stop the process currently using port `3000` and start the app again.
- Registration fails while testing offline or on restricted networks:
	- Set `EMAIL_VERIFICATION_ENABLED=false` in `FarmNet-App/.env` to bypass MX/SMTP mailbox checks during development.
	- Restart the server after changing environment variables.
- Login/auth issues after schema changes or old local data:
	- Remove `FarmNet-App/data/lab-booking.db` and restart to rebuild the database from the current schema.
	- Re-register users after a reset because local accounts are deleted with the database file.
- Return photo upload problems:
	- Ensure uploads are image files and under 5 MB.
	- Confirm `FarmNet-App/data/return-photos/` exists and is writable by the running process.
- Playwright browser tests fail with a "missing browser" error:
	- Run `npx playwright install chromium`.

## Known Limitations

- The Express session secret is a fixed string in `server.js`, suitable for local development only — do not deploy this as-is without moving it to an environment variable.
- Registration validates mailbox reachability (MX + SMTP checks when enabled) but does not send a click-to-confirm email.
- No rate limiting on login/registration endpoints.

## Notes

- Room booking uses a weekly timetable rather than a per-day slot picker.
- The app already supports booking edits, booking archives/history, admin management flows, and configurable per-room booking policies (length limits, weekly frequency cap, blackout windows, admin approval).
- Remaining roadmap items from the project brief are booking email notifications, email confirmation links, and notification preferences.
- Only admins can create admins (via role promotion). No default admin account is seeded automatically.
