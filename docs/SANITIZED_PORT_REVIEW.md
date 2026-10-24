# Sanitized Worker Port (Review Candidate)

`src/production-port.js` is a **review candidate**, not the default Worker entrypoint. The existing `src/index.js` and production Cloudflare deployment are unchanged.

The port preserves the conversation, board reply, and Sheets integration logic from a separately provided deployed Worker, while replacing organization-specific identifiers and member-facing Persian text with generic English text.

## Additional configuration

- `TEST_CHANNEL_IDS`: comma-separated Telegram test channel IDs
- `PRODUCTION_CHANNEL_IDS`: comma-separated Telegram production channel IDs
- `SUPPORT_BOT_URL`: full `https://t.me/...` bot URL for the inline button

Configure these values in the deployment environment. Do not commit real IDs or URLs.

Telegram webhook `allowed_updates` must include `message`, `callback_query`, and `channel_post`. Do not discard pending updates during routine webhook updates.

## Review gates

1. Run `node --check src/production-port.js`, `npm test`, and `npm run check`.
2. Verify all user-facing translations, particularly conversation close/reopen, administrator replies, and error messages.
3. Check D1 schema compatibility and migrations against a **separate test database**.
4. Verify channel post permissions and the no-extra-channel-message requirement.
5. Test Sheets sync against a separate test spreadsheet and compatible Apps Script. The production Apps Script is not included.
6. Review security, rate limits, queue retries, and any feature drift before changing the default entrypoint.

No claim is made that these gates have passed. Do not merge or deploy this port until reviewed.
