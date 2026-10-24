# Verified Deployment Delta — 2026-10-24

The deployed Worker source was supplied for comparison with this public repository. This note contains **no deployment-specific identifiers or credentials**.

## Confirmed in the supplied Worker source

- The Worker parses `channel_post` and checks an allowlist containing separate test and production channels.
- It uses `editMessageReplyMarkup` to attach a support-bot URL button to new channel posts and avoids duplicate buttons.
- It maintains one active member thread and supports explicit continue/close choices.
- It records follow-up messages in `awa_thread_events`, with board replies handled separately.
- Sheets synchronization combines `messages`, `awa_thread_events`, `message_replies`, and `awa_threads` into one record per original request ID, including user metadata, histories, conversation status, and last activity.
- Telegram member-facing strings remain Persian, while code comments are predominantly English.

## Porting constraints

- **Do not copy the supplied production Worker verbatim** into the public repository. Replace organization-specific text, Telegram handles, channel IDs, endpoints, and any other deployment identifiers with generic placeholders or configuration.
- Keep the public sample's English-facing messages as the established repository convention.
- Do not assume the production Apps Script source was included with the Worker file; verify the deployed script independently.
- The public `src/index.js` currently lacks the new thread and channel functionality; a full, reviewed implementation and regression tests are still required.
- Preserve the functioning production Worker; no deployment should be triggered by changes to this public repository.
- The supplied Worker passed a JavaScript syntax check; this does not establish runtime or end-to-end test coverage.

## Next implementation milestone

Port the verified features into the generic Worker, add isolated test fixtures and regression tests, and review the diff before merging. Never commit production data or configuration values.
