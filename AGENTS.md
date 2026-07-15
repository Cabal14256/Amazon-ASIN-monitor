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

## Git and Branch Workflow

- Treat `main` as protected. Never develop or commit directly on it.
- Before starting a change, switch to `main`, fast-forward from `origin/main`, and create one short-lived branch for one task.
- Use `feat/<issue>-<slug>` for features, `fix/<issue>-<slug>` for bug fixes, `chore/<issue>-<slug>` for maintenance, or `codex/<issue>-<slug>` for automated work.
- Every pull request must target `main`. Do not use feature branches as long-lived or stacked PR targets.
- Before opening or merging a pull request, run the relevant checks. The default baseline is:
  - `npm run test:contracts`
  - `npx --no-install tsc --noEmit --pretty false`
  - `npm run build`
  - `git diff --check`
- If a check cannot be run, record the command and reason in the PR's `验证` section.
- Merge only after required CI passes and all review conversations are resolved. Use Squash merge only.
- After a merge, sync local `main` and delete the local task branch; GitHub deletes the merged remote branch automatically.
- If a pull request is abandoned, document its replacement or the reason, close it, and delete both local and remote branches.
- Administrator bypass is only for recovering broken branch protection or CI, not for normal development.
- Keep human-facing collaboration guidance in `CONTRIBUTING.md`; this section is the execution contract for repository agents.
