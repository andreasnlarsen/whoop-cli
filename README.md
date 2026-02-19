# whoop-cli

Open-source WHOOP command-line client designed for both humans and automation agents (including OpenClaw skills).

## Goals

- **Reliable daily use** for personal metrics checks (recovery/sleep/strain/workouts/profile)
- **Automation-friendly output** (`--json` envelopes, stable fields, exit codes)
- **Safe OAuth handling** (token rotation, refresh lock, profile support)
- **Agent-native UX** (commands shaped for scripting and OpenClaw workflows)

## Research baseline (WHOOP official docs)

- WHOOP provides an official OAuth2 + API platform (no official first-party CLI).
- OAuth endpoints:
  - Auth URL: `https://api.prod.whoop.com/oauth/oauth2/auth`
  - Token URL: `https://api.prod.whoop.com/oauth/oauth2/token`
- Core read scopes: `read:recovery`, `read:cycles`, `read:workout`, `read:sleep`, `read:profile`, `read:body_measurement`
- Webhooks support v2 UUID model + signature verification via `X-WHOOP-Signature` and timestamp header.

Primary refs:
- https://developer.whoop.com/api/
- https://developer.whoop.com/docs/developing/oauth/
- https://developer.whoop.com/docs/developing/webhooks/
- https://developer.whoop.com/docs/developing/getting-started/

## Architecture summary

Detailed design: [ARCHITECTURE.md](./ARCHITECTURE.md)

Core modules:
- `src/cli.ts` - command parser + envelope handling
- `src/auth/` - OAuth login + token refresh + token locking
- `src/http/` - WHOOP API client + retry/backoff + typed errors
- `src/commands/` - command handlers (`recovery`, `sleep`, `cycle`, `workout`, `profile`, `webhook`)
- `src/store/` - profile/token storage abstraction (keychain-backed if available)
- `src/output/` - human + JSON renderers

## Planned command surface

- `whoop auth login`
- `whoop auth status`
- `whoop auth refresh`
- `whoop profile show`
- `whoop recovery latest`
- `whoop sleep latest`
- `whoop cycle latest`
- `whoop workout list --start ... --end ...`
- `whoop sync pull --start ... --end ... --out ./whoop.jsonl`
- `whoop webhook verify --secret ... --timestamp ... --signature ... --body-file ...`

Global options:
- `--json` (stable envelope: `{ data, error }`)
- `--profile <name>`
- `--timeout-ms <n>`
- `--base-url <url>` (default WHOOP prod)

## OpenClaw integration target

- Ship a skill: `skills/whoop-cli/SKILL.md`
- Keep deterministic flows for agent calls:
  1. ensure auth
  2. call read endpoint command
  3. parse `--json`
  4. summarize actionable signals

## Current status

Scaffold + architecture complete. Implementation next:
1. OAuth login callback flow
2. API client + typed models
3. `recovery latest`, `sleep latest`, `profile show`
4. JSON envelope + robust errors
5. first release (MIT)
