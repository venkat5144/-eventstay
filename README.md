# EventStay — Wedding & Accommodation Management

EventStay manages wedding events, hotels, rooms, guests, invitations, room allocation and QR-based check-in.

## Project status

The repository began as a static prototype. It now has an Express/PostgreSQL API and an initial frontend connection for organizer authentication, event/hotel/room creation and guest registration. This is an integration stage, not a production-ready release.

## Stack

- Frontend: existing HTML/CSS/JavaScript prototype
- API: Node.js 22, Express
- Database: PostgreSQL 17
- Authentication: bcrypt password hashing + short-lived JWT
- Local orchestration: Docker Compose

## Run the backend locally

1. Install Docker Desktop and start it.
2. Copy `.env.example` to `.env`.
3. Set unique values for `POSTGRES_PASSWORD` and `JWT_SECRET` (at least 32 characters).
4. Run:

```bash
docker compose up --build
```

The API listens on `http://localhost:5000`. PostgreSQL is exposed on host port `5433`.

Health check: `GET http://localhost:5000/api/health`.

The API creates its initial tables when it starts. Do not use the example secrets outside local development.

## API foundation

- `POST /api/auth/register`, `POST /api/auth/login`
- `GET /api/me`
- `GET/POST /api/events`
- `GET/POST /api/hotels`
- `GET/POST /api/hotels/:hotelId/rooms`
- `GET/POST /api/events/:eventId/guests`
- `PATCH /api/invitations/:id`
- `GET /api/dashboard/:eventId`
- `GET/POST /api/allocations`
- `POST /api/check-in/verify`
- `POST /api/check-in/:allocationId/checkout`

Authenticated routes require `Authorization: Bearer <token>`.

## Remaining work before production

- Finish connecting every frontend screen to authenticated API calls; remove remaining localStorage demo/invitation storage as the source of truth.
- Add event/hotel/guest CRUD, edits and deletion with authorization checks; replace prompt-based initial management actions with polished forms.
- Add hotel staff membership and proper tenant permissions.
- Add guest photo upload/storage, invitation templates and invitation delivery integration.
- Add QR token rotation/revocation and robust check-in allocation selection.
- Add room/floor/building UX, reports, pagination, audit log and export.
- Add automated API/database tests, migrations, security review, backups and deployment configuration.
- Test mobile browsers and complete end-to-end workflows.

## GitHub Pages

GitHub Pages can host only the static frontend. The API and PostgreSQL must be deployed separately. Never expose database credentials or JWT secrets in frontend files.
