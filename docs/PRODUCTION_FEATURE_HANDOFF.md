# Production Feature Handoff (Sanitized)

This document records capabilities verified in a separate production deployment. It is **not** a claim that the public sample Worker currently implements them. Do not deploy this repository over a running production bot.

## Features to port into the public example

- **Channel entry point:** Add a configurable Telegram inline URL button to new posts from explicitly allowlisted channels. Handle `channel_post` webhook updates; do not create extra reply posts in channels.
- **Channel permissions:** The bot needs the Telegram administrator permission to edit channel posts. Keep channel IDs in deployment configuration, not source control.
- **Conversation lifecycle:** Maintain at most one active conversation per member. Allow follow-up messages in the same conversation, and present explicit continue/close choices. Do not introduce a time-based auto-close.
- **Board workflow:** Forward member requests to a private administrator group. Keep reply/reply-again and close-state handling, and reflect delivered responses in the board conversation view.
- **Google Sheets:** Synchronize by stable request ID, preserving one row per conversation; include optional user metadata, member-message history, administrator-response history, conversation state, and last activity. Use an authenticated Apps Script endpoint and idempotent updates.
- **Webhook:** Register `message`, `callback_query`, and `channel_post` update types. Avoid dropping pending updates during routine configuration changes.
- **Release transition:** Preserve historical database records. If a clean reporting start is required, use an explicit cutoff rather than deleting operational D1 tables.

## Public repository rules

1. All source-code comments, identifiers, technical logs, error messages, tests, and documentation are in English. The public sample uses English user-facing messages.
2. Do not commit production bot tokens, webhook or Sheets secrets, real chat/user/channel IDs, organization names, internal endpoints, spreadsheet links, messages, database exports, or identifiable metadata.
3. Use placeholders and environment variables for deployment-specific configuration.
4. Keep production and sample deployments separate; never deploy unverified public-example code over production.
5. Preserve existing behavior unless a change is explicitly scoped and tested.
6. Before merging a feature implementation, run syntax checks and automated tests and perform isolated end-to-end tests of channel posts, member conversations, administrator replies, and Sheets synchronization.
7. Keep release notes explicit about what is documented, implemented, tested, and deployed.

## Current status

The production workflow has been manually tested, including a button on a new channel post. The public repository still needs a reviewed, sanitized port of the production Worker and Apps Script, plus dedicated tests. **This document is documentation only.**
