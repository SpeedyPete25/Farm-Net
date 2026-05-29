# Farm-Net

Farm-Net is a university booking prototype for managing room reservations, equipment loans, and account settings. The app includes a weekly room timetable, booking management, admin tools, and a lightweight Express/SQLite backend.

## Project Overview

This repository contains the prototype used for the ITC303/ITC306 software development project. The current implementation focuses on:

- User registration and login with server-side sessions.
- Optional email mailbox verification during registration.
- Room booking through a weekly timetable and booking form.
- Equipment borrowing and return workflows.
- Return-condition notes and optional photo uploads for loan returns.
- User dashboard for reviewing active and historical requests.
- Admin tools for managing users, bookings, loans, rooms, equipment, and audit history.
- User settings for password changes and theme preference.

## Where To Start

The main application lives in [Prototype/](Prototype/). Start there for local development, implementation details, and the frontend/backend entrypoints.

Quick start:

1. Open a terminal in `Prototype/`.
2. Run `npm install`.
3. Run `npm start`.
4. Open `http://localhost:3000`.

## Current Status

The prototype already covers the core booking, equipment, return processing, and admin management flows. Remaining roadmap items from the project brief include booking email notifications, registration confirmation by email links, and notification preferences.

Configuration details (including `EMAIL_VERIFICATION_*` settings) are documented in [Prototype/README.md](Prototype/README.md).
