# Telegram Support Ticketing System

A serverless, Telegram-based support ticketing system built with **JavaScript**, **Cloudflare Workers**, **Cloudflare D1 (SQLite)**, and the **Telegram Bot API**.

> **Status:** Private refactoring workspace. The existing production implementation is being generalized for reuse. This repository is not yet a ready-to-deploy release.

## Overview

The system receives support requests through a Telegram bot, stores them as tickets, forwards them to an administrator group, and routes administrator replies back to the requesting user. Ticket metadata, replies, and delivery jobs are stored in D1.

## Existing workflow

1. A Telegram user submits a support request.
2. A Cloudflare Worker validates and stores the request.
3. A delivery job forwards the request to an administrator group.
4. An administrator replies to the corresponding group message.
5. The system stores and delivers the response to the user.
6. The original administrator-group message is updated with the reply history.
7. A ticket may be marked resolved.

## Core capabilities

- Two-way Telegram messaging with administrator authorization
- Persistent ticket and reply records in Cloudflare D1
- Database-backed delivery jobs and delivery-state tracking
- Reply-source deduplication
- Ticket status management
- Telegram media-message handling
- Consolidated administrator-group ticket updates
- Optional Google Sheets reporting integration

## Architecture

```text
Telegram User
    |
    v
Telegram Bot API (webhook)
    |
    v
Cloudflare Worker <----> Cloudflare D1
    |                       |
    v                       +-- Tickets / Replies
Admin Telegram Group        +-- Delivery Jobs
    |                       +-- Message References
    v
Administrator Reply
    |
    v
Worker -> Delivery Queue -> Telegram User
    |
    +-> Update Original Group Message
```

## Technology

| Component | Technology |
| --- | --- |
| Application runtime | Cloudflare Workers |
| Application language | JavaScript |
| Database | Cloudflare D1 / SQLite |
| Messaging | Telegram Bot API |
| Optional reporting | Google Apps Script / Google Sheets |
| Source control | GitHub |

## Security and privacy

**Do not commit** bot tokens, webhook secrets, production chat IDs, administrator IDs, real user messages, database exports, private spreadsheets, or organization-specific configuration.

The generic implementation will use environment variables and documented placeholders. Production credentials must be provisioned separately.

## Refactoring roadmap

- [ ] Remove organization-specific names, labels, and content
- [ ] Convert all user-facing messages and comments to English
- [ ] Extract configurable ticket categories and administrator settings
- [ ] Provide clean D1 migrations and Cloudflare configuration examples
- [ ] Add automated tests for delivery retries, deduplication, and safe message cleanup
- [ ] Validate deployment in an isolated environment
- [ ] Complete a security and privacy review before public release

## Deployment

Deployment instructions will be added after the generic code, schema migrations, and tests have been validated. **Do not deploy this repository over an existing production bot.**

## License

No license has been selected yet. The repository remains private while the source is prepared for potential open-source publication.
