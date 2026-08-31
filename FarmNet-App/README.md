# Farm-Net App

Farm-Net App is a university room booking and equipment checkout web app. It combines an Express backend, PostgreSQL persistence, and a static (no build step) frontend with a weekly timetable for booking rooms. This folder is the active development line; [`../Prototype/`](../Prototype/) is kept as a frozen reference copy of the earlier prototype.

## Requirements

- Node.js 18+ (uses only the packages listed in `package.json`).
- A PostgreSQL server. The included `docker-compose.yml` is the easiest way to get one locally (requires Docker Desktop); a cloud/managed Postgres instance also works — just point `DATABASE_URL` at it.

## Run Locally

1. Open a terminal in `FarmNet-App/`.
2. Start a local Postgres server (skip this if pointing `DATABASE_URL` at your own instance).

```bash
docker compose up -d
```

This starts Postgres on `localhost:5432` with a `farmnet` database for the app and a separate `farmnet_test` database for the automated test suite (so tests never touch dev data).

3. Install dependencies.

```bash
npm install
```

4. Start the app.

```bash
npm start
```

5. Open `http://localhost:3000`.

Optional: create `FarmNet-App/.env` to override configuration values.

```env
PORT=3000
DATABASE_URL=postgres://farmnet:farmnet@localhost:5432/farmnet
EMAIL_VERIFICATION_ENABLED=false
EMAIL_VERIFICATION_TIMEOUT_MS=8000
EMAIL_VERIFICATION_MAX_MX=3
```

No default admin account is seeded. Register a normal account first, then promote it to `admin` directly in the database (`UPDATE users SET role = 'admin' WHERE email = '...'`, e.g. via `docker exec -it <postgres-container> psql -U farmnet -d farmnet`) — only existing admins can promote other users through the app itself.

## Testing

The app includes automated tests using the built-in Node.js test runner plus Playwright for browser-level checks.

Commands:

```bash
npm test          # reset test data, then run the API integration suite
npm run test:api      # same as above, explicit alias
npm run test:browser  # reset test data, then run the Playwright smoke suite
npm run test:reset     # clear automated test artifacts only
```

What the suite currently covers (`tests/api.integration.test.js`, 19 scenarios):

- Frontend shell response and signed-out `/api/profile` state.
- Register, login, profile, preferences, and logout.
- Validation and authorization failures (expected 400/401/403/404 status codes).
- Booking flow: create, edit, cancel.
- Recurring bookings: daily/weekly/monthly creation, the weekly per-user frequency cap across occurrences, series-wide cancel and reschedule (including atomicity when one occurrence conflicts), admin bulk approve/deny/cancel across a series, and stable occurrence position/total reporting.
- Equipment loan flow: borrow, edit, return; admin borrowing/returning on behalf of another user with damage flagging.
- Admin listing and edit flows for bookings and loans.
- Admin room and equipment management endpoints (add/update/remove, including quantity and unit-code edge cases).
- Equipment unit damage tagging: marking units damaged/working, resulting availability changes, blocked borrowing when no working units remain, and admin-only access to the condition endpoint.
- Equipment unit lifecycle status, including overdue detection and the booked-out list.
- Equipment request/admin approval workflow.
- Equipment kits: bundling multiple equipment types, atomic borrow/reserve, admin bulk approve/deny/cancel, and returning a kit as one verified checklist (including rejection of an incomplete checklist or a missing condition note, with no partial changes applied).
- Configurable room policies and the admin room-booking approval workflow.

Not yet covered by the automated suite (verified manually against a live server during development instead): equipment reservation for a future date, notification content generation (`/api/notifications/*`), and the room usage report (`/api/reports/room-usage`).

Browser smoke suite (`tests/browser/smoke.spec.js`, `playwright.config.js`):

- Signed-out app shell loads correctly.
- Register, login, page navigation, and logout journey.
- Admin-only navigation appears for an admin account.

Test runs use the dedicated `farmnet_test` Postgres database (wiped via `DROP SCHEMA public CASCADE` before each run — see `scripts/reset-test-data.js`) and an isolated return-photo directory under `FarmNet-App/.test-data/` (the Playwright suite further isolates its uploaded files under `.test-data/browser/` on port `3201`), so they never touch your dev database, `FarmNet-App/data/` files, or default port `3000`. Requires the local Postgres container (`docker compose up -d`) to be running.

If Playwright reports a missing browser runtime on a new machine, run:

```bash
npx playwright install chromium
```

## What The App Does

- Register and log in with email-based accounts; registration can optionally verify the mailbox is real (MX + SMTP check).
- View the weekly availability timetable for rooms.
- Book a room using a date, start time, and duration, in 15-minute increments — as a one-off or as a **daily/weekly/monthly recurring series** (2–52 occurrences). A whole series can be rescheduled or cancelled in one action, and each occurrence shows its position in the series (e.g. "2 of 6").
- Cancel and edit personal room bookings (future, active/pending bookings only; conflicts are rejected).
- Rooms can be configured with booking policies: minimum/maximum booking length, a maximum number of bookings per user per week, blackout windows, and whether new bookings require admin approval before becoming active.
- Borrow or **reserve for a future date** individual equipment items, or a whole **kit** (a named bundle of multiple equipment types) in one request; return it with a required condition note and optional photo. Each physical unit gets a unique code (e.g. `lap001`) assigned at borrow/reserve time, and admins can borrow/return on behalf of another user.
- Equipment units carry a computed lifecycle state — `available` / `reserved` / `checked-out` / `overdue` / `pending` (awaiting approval) / `in-maintenance` (flagged damaged) — so overdue or damaged units are automatically excluded from what can be borrowed.
- Return a kit as one **checklist**: every component in the kit is verified and given its own condition note (and optional damage flag) together, rather than being returned as one undifferentiated block.
- Flagging equipment as damaged on return creates a linked damage report (with photo), and admins can review all damage reports and clear a unit back to working condition.
- Individual equipment items, like rooms, can be configured to require admin approval before a loan becomes active.
- View generated notification content (in-app, not emailed) for your own equipment due soon or overdue, and admins can generate the same content for every user plus escalating overdue reminders.
- Admins can generate a room usage report for a date range (bookings, hours booked, unique users, busiest day per room).
- Review active and historical bookings, loans, and request status.
- Change your password and save a light or dark theme preference.
- Use admin pages to manage users (roles, deletion), bookings (including recurring series), loans, rooms, equipment, equipment kits, damage reports, and audit history.

## Key Screens

- `User Bookings`: dashboard showing the signed-in user's bookings and loans, including recurring-series and kit groupings with bulk actions.
- `Room Bookings`: weekly timetable plus booking form (with recurrence options).
- `Equipment Loans`: current equipment inventory, kit availability, and borrowing/reserving actions.
- `Notifications`: the signed-in user's own generated "equipment due soon" and "overdue" notification content.
- `Settings`: password change and theme preference.
- `User Management`: role management, user deletion, plus booking (including recurring series), loan, kit-loan, damage report, and audit log administration.
- `Room Management` and `Equipment Management`: admin-only inventory administration, including per-room/per-equipment approval policy, blackout window management, and equipment kit definitions.
- `Reports`: jumps to the room usage report section on the admin page.

## Project Structure

- `server.js`: Express backend — session handling, Postgres schema/migrations, mailbox verification, and all API routes.
- `public/index.html`: page structure and form markup for every screen.
- `public/app.js`: application bootstrap and page/router wiring.
- `public/js/api.js`: shared `fetch` wrapper used by all page modules.
- `public/js/utils.js`: shared formatting/DOM helpers.
- `public/js/dashboard-page.js`: user dashboard (bookings + loans overview, including recurring-series and kit checklist grouping).
- `public/js/rooms-page.js`: weekly timetable and room booking form, including recurrence options.
- `public/js/equipment-page.js`: equipment inventory, borrowing/reserving, and returns.
- `public/js/equipment-kits-page.js`: kit availability, and borrow/reserve actions.
- `public/js/notifications-page.js`: the signed-in user's own generated notification content.
- `public/js/settings-page.js`: password change and theme preference.
- `public/js/admin-page.js`: admin user/booking/loan/kit-loan/damage-report management, notification generation, room usage reports, and audit log.
- `public/js/room-management-page.js`: admin room CRUD.
- `public/js/equipment-management-page.js`: admin equipment CRUD and equipment kit definitions.
- `public/styles.css`: shared styling for the whole app.
- `docker-compose.yml`: local Postgres server for development and testing.
- `scripts/init-test-db.sql`: one-time init script that creates the separate `farmnet_test` database inside the Postgres container.
- `scripts/reset-test-data.js`: wipes the `farmnet_test` database schema and deletes `.test-data/` for a clean test run.
- `data/return-photos/`: uploaded photos attached to equipment returns (default data dir).
- `tests/api.integration.test.js`: Node.js test runner API/integration suite.
- `tests/browser/smoke.spec.js`: Playwright browser smoke suite.
- `playwright.config.js`: Playwright config — boots the server on port `3201` against the test database and an isolated data dir.

## Data Model

PostgreSQL tables, created and migrated automatically on startup (`initDatabase()` in `server.js`). Column names are camelCase in application code; Postgres folds them to lowercase in storage, and `server.js` restores the original casing on every result row (see the `CAMEL_CASE_COLUMN_MAP` comment in `server.js`) so this doesn't leak into the API or the rest of the codebase:

- `users`: `id`, `email` (unique), `passwordHash`, `role` (`user`/`admin`, default `user`), `theme` (default `dark`).
- `rooms`: `id`, `name`, `location`, `minDurationMinutes`, `maxDurationMinutes`, `maxBookingsPerUserPerWeek` (all nullable — unset means no limit), `requiresApproval` (0/1, default 0).
- `room_blackouts`: `id`, `roomId`, `date`, `startTime`, `endTime`, `reason`, `createdAt` — blocked-out windows during which a room cannot be booked.
- `equipment`: `id`, `name`, `quantity` (total units), `requiresApproval` (0/1, default 0).
- `equipment_units`: `id`, `equipmentId`, `code` (unique short code such as `lap001`), `condition` (`working`/`damaged`) — one row per physical, loanable unit. A unit's full lifecycle status (`available`/`reserved`/`checked-out`/`overdue`/`pending`/`in-maintenance`) is computed on the fly from `condition` plus any active/pending loan, not stored directly.
- `bookings`: `id`, `userId`, `roomId`, `date`, `startTime`, `durationHours`, `status` (`active`/`pending`/`denied`/`cancelled`), `createdAt`, `seriesId` (nullable — the first occurrence's own id, shared by every occurrence in a recurring series). A booking is created as `pending` when its room has `requiresApproval` set, otherwise `active`.
- `loans`: `id`, `userId`, `equipmentId`, `equipmentUnitId`, `borrowDate`, `returnDate`, `status` (`active`/`pending`/`denied`/`cancelled`/`returned`), `returnCondition`, `returnConditionPhotoPath`, `returnedAt`, `createdAt`, `kitId` (nullable — the kit this loan was created from, if any), `kitLoanGroupId` (nullable — the first loan's own id, shared by every loan created from one kit borrow/reserve request).
- `equipment_kits`: `id`, `name` (unique), `createdAt` — a named bundle of equipment types.
- `equipment_kit_items`: `id`, `kitId`, `equipmentId`, `quantity` — the composition of a kit (one row per equipment type in the kit).
- `damage_reports`: `id`, `loanId`, `equipmentUnitId`, `reportedByUserId`, `description`, `photoPath`, `createdAt` — created whenever a loan (including a kit component) is returned with the damaged flag set.
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
- `GET /resources` **auth** — rooms, equipment (with computed availability and per-status counts), and kits (with computed availability) available.
- `GET /timetable` **auth** — 7-day booking grid for a room (`roomId`, `weekStart`).
- `GET /rooms/:roomId/schedule` **auth** — bookings for a room on a specific date.

**Bookings (self-service)**
- `GET /my-requests` **auth** — current user's bookings and loans (`status=active|all`; `active` includes `pending`). Bookings include `seriesId`/`seriesPosition`/`seriesTotal` when part of a recurring series; loans include `kitId`/`kitLoanGroupId`/`kitName` when part of a kit.
- `POST /book-room` **auth** — create a booking (future time, 15-minute increments, overlap check, room policy checks). Returns `status: 'pending'` instead of `'active'` when the room requires admin approval. Accepts an optional `recurrence: { frequency: 'daily'|'weekly'|'monthly', occurrences: 2-52 }` to create a whole series in one atomic request (all occurrences validated before any are created).
- `POST /edit-booking` **auth** — edit one occurrence's own active/pending booking (re-validated against room policy).
- `POST /edit-booking-series` **auth** — reschedule every remaining occurrence in a series at once: the edited occurrence's date shift is applied to every other occurrence, preserving the series' spacing; same new time/duration applied to all. All-or-nothing.
- `POST /cancel-booking` **auth** — cancel own active/pending, future booking.
- `POST /cancel-booking-series` **auth** — cancel every remaining active/pending occurrence in a series at once.

**Equipment & kit loans (self-service)**
- `POST /borrow-equipment` **auth** — borrow an available unit for N days; assigns a specific unit code. Returns `status: 'pending'` if the equipment requires approval. Accepts an optional `borrowerEmail` (admin only) to borrow on behalf of another user.
- `POST /reserve-equipment` **auth** — reserve an available unit for a future date range (same approval/on-behalf semantics as borrowing).
- `POST /borrow-kit` / `POST /reserve-kit` **auth** — borrow/reserve every component of a kit as one atomic request; creates one loan per assigned unit, all sharing a `kitLoanGroupId`. Each component's `active`/`pending` status still follows its own equipment's approval policy, so one request can end up partially pending. Accepts an optional `borrowerEmail` (admin only).
- `POST /edit-loan` **auth** — change the return date on an active loan.
- `POST /cancel-loan` **auth** — cancel an active/pending, non-past loan.
- `POST /cancel-kit-loan` **auth** — cancel every active/pending loan in a kit loan group at once.
- `POST /return-loan` **auth**, `multipart/form-data` — mark a loan returned with a required condition note, optional photo (image, ≤5 MB), and optional `damaged` flag (creates a linked damage report). Admins can return on behalf of another user.
- `POST /return-kit` **auth** — return every currently-active loan in a kit loan group as one checklist: the submission must include every active item with its own condition note (and optional `damaged` flag) or it's rejected outright with nothing applied. No photo support here — use `/return-loan` per item if a photo is needed.
- `GET /loans/:id/photo` **auth** — fetch the return-condition photo for one of your own loans.

**Notifications (self-service, generated content only — nothing is emailed)**
- `GET /notifications/mine` **auth** — the current user's own "equipment due soon" notification content (`days`, default 3).
- `GET /notifications/overdue` **auth** — the current user's own overdue-escalation notification content (`levels`, comma-separated day thresholds, default `3,7,14`).

**Admin — users**
- `GET /admin/users` **admin** — list all users.
- `PATCH /admin/users/:id/role` **admin** — change a user's role (blocks demoting the last admin).
- `DELETE /admin/users/:id` **admin** — delete a user and cascade-delete their bookings, loans, damage reports, and activity history (blocks self-deletion and deleting the last admin) inside a single database transaction.

**Admin — bookings**
- `GET /admin/bookings` **admin** — list all bookings (`status=active|all`), including series position/total.
- `POST /admin/bookings/:id/cancel` **admin** — cancel any active/pending, future booking.
- `PATCH /admin/bookings/:id` **admin** — edit any active/pending booking (same validation as user edit, room policy not re-checked).
- `POST /admin/bookings/:id/approve` **admin** — approve a `pending` booking, moving it to `active`.
- `POST /admin/bookings/:id/deny` **admin** — deny a `pending` booking, moving it to `denied` (optional `reason` logged to the audit trail).
- `POST /admin/bookings/series/:seriesId/{cancel,approve,deny}` **admin** — apply the same action to every matching occurrence in a series at once.

**Admin — loans & kit loans**
- `GET /admin/loans` **admin** — list all loans (`status=active|all`), including kit grouping.
- `POST /admin/loans/:id/cancel` **admin** — cancel any active/pending, non-past loan.
- `POST /admin/loans/:id/approve` / `POST /admin/loans/:id/deny` **admin** — approve or deny a `pending` loan.
- `PATCH /admin/loans/:id` **admin** — edit any active loan's return date.
- `POST /admin/kit-loans/:groupId/{approve,deny,cancel}` **admin** — apply the same action to every matching loan in a kit loan group at once.
- `GET /admin/loans/:id/photo` **admin** — fetch the return-condition photo for any loan.
- `GET /admin/equipment/booked-out` **admin** — active/overdue loans with borrower and unit details.
- `GET /admin/damage-reports` **admin** — every damage report, joined with the loan, borrower, reporter, and equipment/unit it relates to.
- `GET /admin/damage-reports/:id/photo` **admin** — fetch the photo attached to a damage report.

**Admin — rooms**
- `GET /admin/rooms` **admin** — list all rooms, including configured policy fields.
- `POST /admin/rooms` **admin** — add a room (rejects duplicate location); accepts optional policy fields (see below).
- `PATCH /admin/rooms/:id` **admin** — update a room's booking policy: `minDurationMinutes`, `maxDurationMinutes`, `maxBookingsPerUserPerWeek` (all optional — omit/blank for no limit) and `requiresApproval` (boolean).
- `DELETE /admin/rooms/:id` **admin** — remove a room (blocks if it has future active/pending bookings).
- `GET /admin/rooms/:roomId/blackouts` **admin** — list blackout windows for a room.
- `POST /admin/rooms/:roomId/blackouts` **admin** — add a blackout window (`date`, `startTime`, `endTime`, optional `reason`); bookings overlapping a blackout are rejected.
- `DELETE /admin/rooms/:roomId/blackouts/:blackoutId` **admin** — remove a blackout window.

**Admin — equipment & kits**
- `GET /admin/equipment` **admin** — list equipment with unit codes and computed status per unit.
- `POST /admin/equipment` **admin** — add equipment (creates matching unit codes; rejects duplicate name).
- `PATCH /admin/equipment/:id` **admin** — change quantity (adds/removes unit codes; blocks reducing below active loan count or below available unassigned units).
- `PATCH /admin/equipment/:id/policy` **admin** — toggle whether an equipment type requires admin approval to borrow/reserve.
- `PATCH /admin/equipment/units/:unitId/condition` **admin** — mark a specific unit `working` or `damaged`.
- `DELETE /admin/equipment/:id` **admin** — remove equipment and its unit codes (blocks if it has active loans).
- `GET /admin/kits` **admin** — list kits with their component items.
- `POST /admin/kits` **admin** — create a kit (name + list of `{ equipmentId, quantity }`; rejects duplicate names, duplicate items within a kit, and references to equipment that doesn't exist).
- `PATCH /admin/kits/:id` **admin** — replace a kit's name and item composition.
- `DELETE /admin/kits/:id` **admin** — remove a kit definition (loans already created from it are unaffected).

**Admin — notifications & reports**
- `GET /notifications/equipment-due` **admin** — generated "equipment due soon" content for every user (`days`, default 3).
- `GET /notifications/overdue-escalations` **admin** — generated overdue-escalation content for every user (`levels`, comma-separated day thresholds, default `3,7,14`).
- `GET /reports/room-usage` **admin** — per-room usage report for a date range (`start`, `end`, both `YYYY-MM-DD`): total bookings, total hours, unique users, and busiest date.

**Admin — audit**
- `GET /admin/audit-log` **admin** — most recent 100 audit log entries (actor, event type, resource, description, timestamp).

## Configuration

- `EMAIL_VERIFICATION_ENABLED`: defaults to `true`. Set to `false` to bypass MX and SMTP mailbox verification during offline development.
- `EMAIL_VERIFICATION_TIMEOUT_MS`: defaults to `8000`. Timeout for each DNS/SMTP step during mailbox verification.
- `EMAIL_VERIFICATION_MAX_MX`: defaults to `3`. Maximum number of MX servers probed per registration.
- `PORT`: defaults to `3000`.
- `DATABASE_URL`: Postgres connection string. Defaults to `postgres://farmnet:farmnet@localhost:5432/farmnet`, matching `docker-compose.yml`.
- `DATABASE_SSL`: defaults to `false`. Set to `true` when connecting to a managed Postgres provider that requires SSL (e.g. most cloud hosts) — connects with `rejectUnauthorized: false`.
- `DATA_DIR`: optional override for the app data directory (`return-photos/` only — used by automated tests to isolate uploaded files from `data/`).

`EMAIL_VERIFICATION_ENABLED` accepts `true/false`, `1/0`, `yes/no`, and `on/off` (case-insensitive).

Known-provider domains (Gmail, Outlook, Yahoo, iCloud, etc.) are treated as valid when DNS/SMTP verification is inconclusive, to avoid false negatives on networks that block outbound SMTP.

## Resetting Data

- Run `docker exec -it <postgres-container> psql -U farmnet -d farmnet -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"` (or connect with any Postgres client) and restart the app to recreate the seeded database from scratch.
- Delete files in `FarmNet-App/data/return-photos/` if you want to clear uploaded return photos during local development.
- Run `npm run test:reset` to wipe the `farmnet_test` database and clear automated test artifacts in `FarmNet-App/.test-data/`.
- `docker compose down -v` removes the Postgres container's data volume entirely (both `farmnet` and `farmnet_test`).

## Troubleshooting

- App does not start because port `3000` is already in use:
	- Set a different port in `FarmNet-App/.env`, for example `PORT=3001`, then restart with `npm start`.
	- Or stop the process currently using port `3000` and start the app again.
- App fails to start with a database connection error:
	- Make sure Postgres is running: `docker compose up -d`, then check `docker compose ps`.
	- Confirm `DATABASE_URL` (in `.env` or your shell) points at the right host/port/database.
- Registration fails while testing offline or on restricted networks:
	- Set `EMAIL_VERIFICATION_ENABLED=false` in `FarmNet-App/.env` to bypass MX/SMTP mailbox checks during development.
	- Restart the server after changing environment variables.
- Login/auth issues after schema changes or old local data:
	- Reset the database schema (see "Resetting Data" above) and restart to rebuild it from the current schema.
	- Re-register users after a reset because accounts are deleted along with the schema.
- Return photo upload problems:
	- Ensure uploads are image files and under 5 MB.
	- Confirm `FarmNet-App/data/return-photos/` exists and is writable by the running process.
- Playwright browser tests fail with a "missing browser" error:
	- Run `npx playwright install chromium`.

## Known Limitations

- The Express session secret is a fixed string in `server.js`, suitable for local development only — do not deploy this as-is without moving it to an environment variable.
- Registration validates mailbox reachability (MX + SMTP checks when enabled) but does not send a click-to-confirm email.
- No rate limiting on login/registration endpoints.
- Foreign-key relationships (e.g. a loan referencing its equipment, a booking referencing its room) are stored as plain columns without database-level `FOREIGN KEY` constraints. This preserves the exact behaviour of the original SQLite version, which never enabled foreign-key enforcement — several admin delete routes (equipment, rooms) only guard against *active* references, not full history, and would need that audited before real FK enforcement could be turned on safely.

## Notes

- Room booking uses a weekly timetable rather than a per-day slot picker.
- The app already supports booking edits, recurring booking series, booking archives/history, admin management flows, and configurable per-room/per-equipment approval policies (length limits, weekly frequency cap, blackout windows, admin approval).
- Notification and reminder **content** is generated on demand via `/api/notifications/*` and shown in-app (the `Notifications` page); nothing is actually emailed yet — no outbox, delivery, or notification-preferences layer exists. That, and email confirmation links for registration, remain the roadmap items from the project brief that aren't built.
- Only admins can create admins (via role promotion). No default admin account is seeded automatically.
