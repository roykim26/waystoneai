# Waystone AI

Marketing site and self-hosted submission backend for [waystoneai.online](https://waystoneai.online) — a curated directory of AI tools.

No third-party form services: submissions, admin review, and free-tier backlink verification all run on a single small Node.js service with SQLite.

## Contents

| Path | Description |
| --- | --- |
| [`backend/`](./backend) | Express API, SQLite storage, admin dashboard, backlink cron checks |
| [`预售落地页/`](./预售落地页) | Static landing page, privacy policy, refund policy |

## Features

- **Submission intake** — `POST /api/submissions` with server-side validation, a honeypot field, and per-IP rate limiting (5 requests / 10 min).
- **Admin review** — token-protected dashboard at `/admin` to filter, annotate, and approve or reject submissions.
- **Backlink verification** — free-tier listings are checked on a cron schedule; missing backlinks move to `grace` and then `missing`.
- **Notifications** — optional Feishu / DingTalk / WeCom webhook alerts for new submissions and Resend confirmation emails to submitters. Both are fire-and-forget and never block intake.

## Tech stack

- Node.js 18+ / Express 4
- SQLite via `better-sqlite3` (WAL mode)
- `node-cron` for recurring backlink checks
- Plain HTML/CSS/JS for the landing page and admin UI — no build step

## Getting started

```bash
cd backend
npm install
cp .env.example .env    # then edit values, at minimum ADMIN_TOKEN
npm start               # http://localhost:3000
```

- Landing page: <http://localhost:3000/>
- Admin dashboard: <http://localhost:3000/admin>
- Health check: <http://localhost:3000/api/health>

## Configuration

All configuration lives in `backend/.env` (see [`backend/.env.example`](./backend/.env.example)):

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3000` | HTTP port |
| `ADMIN_TOKEN` | — | Required. Long random string used by `/admin` and the admin API |
| `DB_PATH` | `./data/waystone.db` | SQLite file path, relative to `backend/` |
| `SITE_URL` | `https://waystoneai.online` | Public site URL used in emails and links |
| `BACKLINK_DOMAIN` | `waystoneai.online` | Domain a free-tier listing must link back to |
| `CHECK_CRON` | `0 */6 * * *` | Backlink check schedule |
| `GRACE_DAYS` | `7` | Days a missing backlink stays in `grace` before `missing` |
| `STATIC_DIR` | `../预售落地页` | Static files served by Express |
| `ADMIN_NOTIFY_WEBHOOK_URL` | — | Optional group-bot webhook for new submissions |
| `ADMIN_NOTIFY_TYPE` | `feishu` | `feishu`, `dingtalk`, or `wecom` |
| `RESEND_API_KEY` | — | Optional Resend key for submitter confirmation emails |
| `EMAIL_FROM` | — | Verified Resend sender address |

> `ADMIN_TOKEN`, webhook URLs, API keys, and the SQLite database are never committed. Only `.env.example` is tracked.

## API

| Method | Path | Auth | Description |
| --- | --- | --- | --- |
| `POST` | `/api/submissions` | public | Create a submission |
| `GET` | `/api/health` | public | Liveness probe |
| `GET` | `/api/admin/submissions` | `x-admin-token` | List submissions (`?status=`, `?tier=`) |
| `PATCH` | `/api/admin/submissions/:id` | `x-admin-token` | Update `status` / `notes` |
| `POST` | `/api/admin/submissions/:id/check` | `x-admin-token` | Re-run backlink check now |

Submission statuses: `new` → `contacted` → `approved` / `rejected`.
Backlink statuses: `pending`, `detected`, `grace`, `missing`, `not_required`.

## Deployment

### Docker

```bash
cd backend
docker build -t waystone:latest .
docker run -d --name waystone --restart unless-stopped \
  -p 127.0.0.1:3000:3000 \
  -v "$PWD/../预售落地页:/app/site:ro" \
  -v "$PWD/data:/app/data" \
  --env-file .env \
  waystone:latest
```

### Reverse proxy

[`backend/caddy-waystone.caddyfile`](./backend/caddy-waystone.caddyfile) contains a sample Caddy vhost with TLS, compression, security headers, and JSON access logs. Equivalent Nginx config works the same way — proxy to the container and serve static files directly.

### PM2

```bash
cd backend
pm2 start ecosystem.config.js
```

## Notes

- The admin token is stored in `sessionStorage` only; there are no user accounts or cookies.
- Submission data stays in the local SQLite file — export or back up `backend/data/` as needed.
- Built and maintained by an independent developer. Contact: <hello@waystoneai.online>
