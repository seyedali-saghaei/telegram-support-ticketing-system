# Telegram Support Ticketing System

[![JavaScript](https://img.shields.io/badge/JavaScript-ESM-informational)](https://developer.mozilla.org/en-US/docs/Web/JavaScript)
[![Cloudflare Workers](https://img.shields.io/badge/Cloudflare-Workers-orange)](https://developers.cloudflare.com/workers/)
[![Cloudflare D1](https://img.shields.io/badge/Database-Cloudflare%20D1-blue)](https://developers.cloudflare.com/d1/)

A serverless, Telegram-based ticketing system for teams that manage user requests through a shared Telegram administrator group. Built with **Cloudflare Workers**, **D1 (SQLite)**, and the **Telegram Bot API**.

> **Release status:** Public-release candidate in development. The source is organization-neutral and written in English, but it has **not** yet passed isolated end-to-end deployment tests. Do not point it at an existing production bot.

## What it does

Users submit support requests through a Telegram bot. The Worker persists each request as a ticket, forwards it to an administrator group, accepts replies from authorized administrators, and delivers replies to the original user. The administrator-group ticket message is updated to show delivered replies and the current ticket status.

### Features

- Category-based intake: Question, Suggestion, Feedback
- Optional event/program field
- Text and supported Telegram media intake
- Authorized administrator replies and ticket resolution
- Database-backed delivery queue with delivery-state tracking
- Duplicate-update and reply-source protection
- Consolidated administrator-group conversation history
- Safe handling of long messages and retained media replies
- User blocking and basic flood protection
- Optional Google Sheets synchronization
- Health and database connectivity endpoints

## Architecture

```text
User -> Telegram Bot API -> Worker webhook (/telegram)
                               |
                               v
                        Cloudflare D1
                        - messages
                        - message_replies
                        - delivery_jobs
                        - reply_sources
                               |
                               v
                        Admin Telegram group
                               |
                               v
                    Authorized administrator reply
                               |
                               v
                      Queue -> Telegram user
                               |
                               +-> Update group ticket
                               +-> Clean up eligible text reply
```

## Requirements

- Node.js 20 or newer
- A Cloudflare account with Workers and D1 enabled
- A Telegram bot created through BotFather
- A private Telegram group for administrators
- Telegram user IDs for administrators

## Quick start (isolated test environment)

1. Clone the repository and run `npm install`.
2. Create a **new test bot and test admin group**. Do not reuse production credentials.
3. Create a D1 database with `npx wrangler d1 create telegram-support-db`.
4. Replace `REPLACE_WITH_YOUR_D1_DATABASE_ID` in `wrangler.jsonc` with the new database ID.
5. Apply the schema with `npm run db:migrate:local` for local development, or `npm run db:migrate:remote` for the isolated Cloudflare environment.
6. Copy `.dev.vars.example` to `.dev.vars` and set the local-only values. For deployment, configure `BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, `BOARD_CHAT_ID`, and `ADMIN_USER_IDS` as Cloudflare secrets/variables.
7. Run `npm run check` and `npm test`.
8. Start local development with `npm run dev`. Deploy only to the **test Worker** after validation.
9. Register a Telegram webhook for `https://YOUR_TEST_WORKER_URL/telegram` using Telegram's `setWebhook` API, including the matching `secret_token`.
10. Verify the complete flow with test users and administrator replies.

### Environment variables

| Variable | Required | Description |
| --- | --- | --- |
| `BOT_TOKEN` | Yes | Telegram Bot API token (secret) |
| `TELEGRAM_WEBHOOK_SECRET` | Yes | Webhook authentication secret |
| `BOARD_CHAT_ID` | Yes | Telegram administrator group ID |
| `ADMIN_USER_IDS` | Yes | Comma-separated administrator Telegram user IDs |
| `DB` | Yes | Cloudflare D1 binding |
| `SHEETS_SYNC_URL` | No | Google Apps Script endpoint |
| `SHEETS_SYNC_SECRET` | For Sheets | Shared secret for optional Sheets integration |

The Google Sheets integration requires a compatible external Apps Script endpoint; that script is not included in this repository.

## HTTP endpoints

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/health` | Worker health and version |
| GET | `/db-check` | D1 connectivity and ticket count |
| POST | `/telegram` | Authenticated Telegram webhook |
| POST | `/sync-sheets` | Optional secret-protected Sheets synchronization |

**Note:** Health and database-check endpoints are not authenticated in the current implementation. Restrict access or remove them when your deployment requires stricter operational privacy.

## Reliability model and limitations

The queue distinguishes pending, sending, done, and review states. Uncertain delivery outcomes are marked for manual review to reduce accidental duplicate sends. A successful user delivery is not repeated solely because updating the administrator-group message fails. Failed group-message reconciliation can be retried separately.

This is **not an exactly-once delivery guarantee**. Telegram network timeouts and database-write failures can still require operator intervention. Telegram message length and deletion-window restrictions also apply.

## Testing

```bash
npm run check
npm test
```

The included automated tests currently cover health, routing, missing configuration, and webhook-secret rejection. **Database-backed queue behavior, Telegram API failure simulation, media handling, and end-to-end flows still need dedicated tests** before a stable release.

## Security and privacy

- Never commit credentials, production chat IDs, database exports, real support messages, or private spreadsheet URLs.
- Use separate Telegram bots, groups, and databases for development and production.
- Review access controls and data retention obligations before deploying for real users.
- Read [Security and privacy guidance](docs/SECURITY.md) before publishing or deploying.
- Do not copy historical production data into this repository.

## Project structure

```text
src/index.js                 Worker implementation
migrations/0001_initial.sql Fresh-install D1 schema
tests/worker.test.js        Basic Worker tests
wrangler.jsonc              Example Cloudflare deployment configuration
.dev.vars.example           Example local environment variables
docs/SECURITY.md            Security and privacy checklist
```

## Roadmap

- [x] Remove organization-specific labels and translate bot text to English
- [x] Provide generic D1 schema and Worker configuration
- [x] Add initial automated tests
- [ ] Run isolated Cloudflare D1 migrations and Telegram end-to-end tests
- [ ] Expand automated coverage for queue retries, deduplication, and safe deletion
- [ ] Add a complete example Google Apps Script or make Sheets integration fully optional
- [ ] Review rate limits, monitoring, and data retention
- [ ] Complete pre-publication security review
- [ ] Choose an open-source license and publish a stable release

## Contributing

Contributions and issues will be welcome after the repository is opened publicly. Until then, this repository is a private development workspace.

## License

**Not yet licensed for public reuse.** A license will be selected before public release.
