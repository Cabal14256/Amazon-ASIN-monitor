# Project Instructions

- Server-side logging must use `logger` instead of `console.*`.
- Log levels:
  - `debug`: verbose diagnostics (SQL, cache hits, flow tracing).
  - `info`: normal business events (task start/finish, scheduler, success paths).
  - `warn`: recoverable issues and policy violations (rate limit, retries, fallback).
  - `error`: failures that need attention (exceptions, external API failures).
- Environment strategy:
  - Development can log `debug`/`info`.
  - Production must avoid noisy `debug`; rely on `info`+ for operational events.
  - Use `LOG_LEVEL` env to control verbosity (default INFO).
- Sensitive data:
  - Never log raw secrets, tokens, passwords, or PII.
  - Use `logger` sanitization (mask keys like `password`, `token`, `secret`, `authorization`).
  - For error objects, log `message` and minimal context; avoid full payload dumps.
