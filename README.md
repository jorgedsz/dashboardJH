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

## Proxy gate

The dashboard can sit in front of your n8n webhook to act as a balance gate.

```
POST {API_BASE}/api/proxy/<PROXY_TOKEN>
Body : whatever your upstream caller (GHL workflow) was already sending to n8n
```

Flow:
- Balance ≥ $0.01 → message row recorded as `success`, balance debited,
  body forwarded verbatim to `PROXY_TARGET_URL`. The upstream response is
  mirrored back to the caller.
- Balance < $0.01 → message row recorded as `blocked` (cost = 0), nothing
  forwarded. Response body:
  ```json
  {
    "blocked": true,
    "reason": "no_balance",
    "fallback_message": "<the noBalanceMessage configured in the dashboard>",
    "available_balance": 0
  }
  ```
  Configure your GHL workflow with a conditional after the webhook step:
  *if response.blocked == true → Send Message with response.fallback_message*.

## Capturing the bot's reply (`outputMessage`)

The proxy already writes `inputMessage` when GHL fires the webhook. The
reply has two paths:

1. **Auto-capture (zero-config).** If your n8n responds with a JSON body
   carrying one of `outputMessage`, `output`, `reply`, `response`,
   `message`, `text`, `answer`, or `content`, the proxy stores it as the
   message's outputMessage on the same row. Nothing to do.

2. **Manual callback (if your n8n's response doesn't include the reply).**
   The proxy injects a reserved key into the body it forwards to n8n:
   ```json
   { "__dashboardMessageId": 123, "...the rest of the GHL payload": "..." }
   ```
   At the very end of the n8n workflow, after the bot's reply is ready,
   add an HTTP Request node:

   ```
   POST {DASHBOARD_BASE}/api/messages/{{ $('Webhook').first().json.body.__dashboardMessageId }}/response
   Header: x-ingest-secret: <INGEST_SECRET>
   Body  : { "outputMessage": "{{ $json.botReplyText }}" }
   ```

   That writes the reply to the same row. Set `errorMessage` instead (or
   in addition) if the bot failed:
   ```json
   { "errorMessage": "OpenAI timed out" }
   ```

## Calls ingest + pre-call gate (sword-ai integration)

The dashboard receives every VAPI call from the sword-ai backend at:

```
POST {API_BASE}/api/calls/ingest
Header: x-ingest-secret: <INGEST_SECRET>
Body  : {
  "vapiCallId": "...",          // idempotency key
  "agentId": "...", "agentName": "...",
  "contactId": "...", "contactName": "...",
  "customerNumber": "+57...", "fromNumber": "+1...",
  "durationSeconds": 124,
  "outcome": "answered" | "no_answer" | "voicemail" | "failed",
  "endedReason": "...",
  "summary": "...", "transcript": "...", "recordingUrl": "..."
}
```

Cost is computed at ingest time as `durationSeconds / 60 * CALL_RATE_PER_MINUTE`
and snapshotted on the row, so changing the env later doesn't rewrite
historical totals. Repeat ingests of the same `vapiCallId` update non-cost
fields (transcripts, summaries) without double-debiting.

Pre-call gate (optional; sword-ai can call this before starting an outbound):

```
GET {API_BASE}/api/calls/check-balance?estimatedMinutes=5
Header: x-ingest-secret: <INGEST_SECRET>
→ {
  "hasBalance": true,
  "availableBalance": 12.40,
  "ratePerMinute": 0.10,
  "estimatedMinutes": 5,
  "estimatedCost": 0.50,
  "noBalanceMessage": "Lo siento, tu cuenta no tiene saldo…"
}
```

If `estimatedMinutes` is omitted, the gate falls back to "is balance > 0".

## Recharge webhook

```
POST {API_BASE}/api/proxy/recharge
Header: x-recharge-secret: <RECHARGE_SECRET>
Body  : { "amount": 25, "source": "stripe", "reference": "ch_abc123" }
```

- `amount` is required and must be positive.
- `reference` is treated as an idempotency key; the second hit with the same
  reference is a no-op.
- Every successful recharge appears in the dashboard's Recharges section.

## Railway deploy

- Single service that runs `npm run start` from `server/` (server serves the
  built client too). The build script in `server/package.json` builds the
  client and copies the bundle into `server/public/`.
- Required env: `DATABASE_URL`, `JWT_SECRET`, `OWNER_EMAIL`, `OWNER_PASSWORD`,
  `INGEST_SECRET`.
- Start command on Railway: `npx prisma db push --accept-data-loss && node src/seed/seedOwner.js && node src/index.js`.
