# Security and Privacy

This repository is intended to contain only organization-neutral, sanitized source code and synthetic examples.

## Before publishing

- Search source, commit history, documentation, and configuration for organization names and identifiers.
- Remove production Telegram bot tokens, webhook secrets, chat IDs, administrator IDs, spreadsheet IDs, and user data.
- Keep runtime secrets in Cloudflare secrets or local untracked environment files.
- Do not upload D1 database exports or real support conversations.
- Validate authorization checks, webhook authentication, duplicate-delivery handling, and deletion behavior.
- Test the generic version in an isolated bot and group before deployment.
- Rotate any credential accidentally committed, even if the commit is later removed.

## Reporting vulnerabilities

While the repository is private, report issues to the repository owner through a private channel rather than creating public disclosures.
