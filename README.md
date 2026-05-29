# dashboardJH

Single-tenant dashboard for an n8n-driven text agent. Receives messages from
n8n via an ingest webhook, persists them in its own Postgres, and shows
counts and cost ($0.01 / message) behind a single owner login.

## Repo layout

- `server/` — Express + Prisma + Postgres. Auth, message ingest, stats API.
- `client/` — React + Vite + Tailwind. Login + dashboard view.

## Stack

Mirrors the patterns from the parent agentia repo:
- Express 4, Prisma 5 client.
- bcrypt for password hashing (10 rounds).
- JWT for session.
- React 18 + Vite + Tailwind on the client.
- Axios with token interceptor.

## Local dev

```bash
# 1. Install deps
cd server && npm install
cd ../client && npm install

# 2. Set env vars (see server/.env.example)
cp server/.env.example server/.env

# 3. Init the DB (or `prisma db push` if remote)
cd server && npx prisma generate && npx prisma db push

# 4. Seed the single owner account (reads OWNER_EMAIL/OWNER_PASSWORD from .env)
node src/seed/seedOwner.js

# 5. Run dev
cd server && npm run dev          # API on :8080
cd client && npm run dev          # UI on :5173
```

## n8n integration

n8n posts every message to:
```
POST {API_BASE}/api/messages/ingest
Header: x-ingest-secret: <INGEST_SECRET from server .env>
Body  : { sessionId, contactId?, contactName?, inputMessage, outputMessage?, status? }
```

The server stamps `costCharged: 0.01` per row.

## Railway deploy

- Single service that runs `npm run start` from `server/` (server serves the
  built client too). The build script in `server/package.json` builds the
  client and copies the bundle into `server/public/`.
- Required env: `DATABASE_URL`, `JWT_SECRET`, `OWNER_EMAIL`, `OWNER_PASSWORD`,
  `INGEST_SECRET`.
- Start command on Railway: `npx prisma db push --accept-data-loss && node src/seed/seedOwner.js && node src/index.js`.
