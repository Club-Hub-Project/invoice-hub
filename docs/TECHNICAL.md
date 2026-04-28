# Invoice Hub — Technical Documentation

## Overview

Invoice Hub is a Cloudflare Workers app for managing event-based invoices for TKD Bern. It integrates with Webling (club management software) to create Debitor entries and generates German email templates for each invoice.

## Architecture

```
Invoice Hub (Cloudflare Worker + Workers Assets)
    |
    +-- KV Namespace (invoice-hub-kv)  — events, invoice drafts, settings
    |
    +-- AUTH_SERVICE (service binding) — auth-service worker, JWT verification
    |
    +-- USER_CONNECTOR (service binding) — webling-connector, member search
    |
    +-- Webling REST API (direct) — accounting: periods, accounts, debitor creation
```

### Worker Entry Point

`worker/src/index.js` — CORS, auth proxy, route dispatch.

All routes under `/api/*` require an admin or superadmin role except:
- `GET /api/hub/stats` — public stats for Club Hub dashboard
- `POST /api/auth/request-code` — initiate email code
- `POST /api/auth/verify-code` — verify code, get JWT

### KV Data Model

| Key pattern | Content |
|---|---|
| `config::settings` | Webling defaults, bank/Twint details |
| `config::superadmin` | First-ever user ID (gets superadmin) |
| `user-role::{userId}` | KV role override |
| `event::{id}` | Event object |
| `event-index` | `string[]` of event IDs |
| `invoice::{id}` | Invoice draft/committed object |
| `invoice-index::all` | `string[]` of all invoice IDs |
| `invoice-index::event::{eventId}` | `string[]` of invoice IDs per event |

### Event Object

```json
{
  "id": "uuid",
  "name": "Sommer-Camp 2026",
  "date": "2026-07-15",
  "fee": 120,
  "currency": "CHF",
  "description": "3-tägiges Camp",
  "periodId": "webling-period-id",
  "debitorcategoryId": "webling-cat-id",
  "creditAccountId": "webling-account-id",
  "debitAccountId": "webling-account-id",
  "createdAt": "ISO8601",
  "updatedAt": "ISO8601"
}
```

### Invoice Object

```json
{
  "id": "uuid",
  "eventId": "event-uuid",
  "eventName": "Sommer-Camp 2026",
  "memberId": "webling-member-id",
  "memberName": "Max Muster",
  "memberEmail": "max@example.com",
  "amount": 120,
  "title": "Veranstaltungsbeitrag Sommer-Camp 2026",
  "invoiceDate": "2026-07-15",
  "dueDate": "2026-08-15",
  "status": "draft",
  "periodId": "webling-period-id",
  "debitorcategoryId": "",
  "creditAccountId": "",
  "debitAccountId": "",
  "weblingDebitorId": null,
  "createdAt": "ISO8601",
  "committedAt": null
}
```

Status transitions: `draft` → `committed` (after Webling commit, irreversible).

## API Reference

### Auth

| Method | Path | Description |
|---|---|---|
| POST | `/api/auth/request-code` | Send 6-digit code via email |
| POST | `/api/auth/verify-code` | Verify code, get JWT |
| GET | `/api/auth/me` | Current user info |
| POST | `/api/auth/logout` | Client-side logout |

### Events

| Method | Path | Description |
|---|---|---|
| GET | `/api/events` | List all events |
| POST | `/api/events` | Create event |
| PUT | `/api/events/:id` | Update event |
| DELETE | `/api/events/:id` | Delete event |

### CSV Upload

| Method | Path | Description |
|---|---|---|
| POST | `/api/upload/csv` | Parse CSV, match members |

Request: `multipart/form-data` with `file` field, or raw CSV text body.

Response:
```json
{
  "rows": [{
    "name": "Max Muster",
    "matchStatus": "matched|unmatched|multiple",
    "memberId": "123",
    "memberName": "Max Muster",
    "memberEmail": "max@example.com",
    "customAmount": null
  }],
  "stats": { "total": 5, "matched": 4, "multiple": 0, "unmatched": 1 }
}
```

CSV column detection (case-insensitive):
- Name: `Vorname`+`Name`, or `Vollständiger Name`, or first column
- Email: any column matching `/e.?mail/i`
- Amount: any column matching `/betrag|amount|fee|preis/i`

### Invoices

| Method | Path | Description |
|---|---|---|
| GET | `/api/invoices` | List invoices (`?status=draft|committed|all&eventId=...`) |
| POST | `/api/invoices` | Create drafts from upload results |
| PUT | `/api/invoices/:id` | Edit draft |
| DELETE | `/api/invoices/:id` | Delete draft |
| POST | `/api/invoices/:id/commit` | Commit single invoice to Webling |
| GET | `/api/invoices/:id/email` | Get email text for invoice |
| POST | `/api/invoices/bulk/commit` | Bulk commit `{ ids: [...] }` |
| POST | `/api/invoices/bulk/delete` | Bulk delete `{ ids: [...] }` |

### Webling Metadata

| Method | Path | Description |
|---|---|---|
| GET | `/api/webling/periods` | List accounting periods |
| GET | `/api/webling/accounts` | List accounts |
| GET | `/api/webling/categories` | List debitor categories |

### Settings

| Method | Path | Description |
|---|---|---|
| GET | `/api/settings` | Get settings |
| PUT | `/api/settings` | Update settings (admin only) |

### Public

| Method | Path | Description |
|---|---|---|
| GET | `/api/hub/stats` | Stats for Club Hub dashboard |

## Deployment

### Prerequisites

- Cloudflare account with `auth-service` and `webling-connector` workers deployed
- Wrangler CLI installed: `npm i -g wrangler`
- `WEBLING_API_KEY` secret available

### Steps

```bash
cd Invoice/worker

# 1. Install deps
npm install

# 2. Create KV namespace
npx wrangler kv:namespace create invoice-hub-kv
# Copy the 'id' from output into wrangler.toml [[kv_namespaces]]

# 3. Set secrets
echo "YOUR_WEBLING_API_KEY" | npx wrangler secret put WEBLING_API_KEY
echo "YOUR_INTERNAL_SECRET" | npx wrangler secret put INTERNAL_SECRET  # if behind gateway

# 4. Deploy
npx wrangler deploy
```

### Environment Variables (`wrangler.toml` vars)

| Var | Value |
|---|---|
| `WEBLING_BASE_URL` | `https://tkdbern.webling.ch/api/1` |
| `JWT_SECRET` | Shared secret with auth-service |
| `ORG_ID` | `tkdbern` |
| `WEBLING_MEMBER_GROUP_ID` | `456` |

### Secrets (`wrangler secret put`)

| Secret | Description |
|---|---|
| `WEBLING_API_KEY` | Webling REST API key |
| `INTERNAL_SECRET` | Gateway passthrough secret (optional) |

## Webling Invoice Structure

Invoice Hub creates `/debitor` entries in Webling. The structure:

```
POST /debitor
{
  properties: { title, date, duedate },
  parents: [periodId],
  links: {
    member: [memberId],
    revenue: [{
      properties: { amount, title },
      parents: [{ properties: ..., parents: [periodId] }],
      links: { debit: [accountId], credit: [accountId] }
    }],
    debitorcategory: [categoryId]
  }
}
```

The `periodId`, `debitAccountId`, `creditAccountId`, and `debitorcategoryId` can be configured globally in Settings or per-event. Per-event values take precedence.

## CSV Format Examples

**Semicolon (Swiss Excel export):**
```csv
Vorname;Name;E-Mail
Max;Muster;max@example.com
Anna;Schmidt;anna@example.com
```

**Comma with custom amount:**
```csv
Vollständiger Name,E-Mail,Betrag
Max Muster,max@example.com,95
Anna Schmidt,anna@example.com,120
```
