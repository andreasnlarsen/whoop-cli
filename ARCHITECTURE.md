# whoop-cli architecture

## 1) Tech stack

- **Runtime:** Node.js 20+
- **Language:** TypeScript
- **CLI parser:** `commander`
- **HTTP:** native `fetch` (undici)
- **Validation:** `zod`
- **Optional secure storage:** `keytar` (fallback to file with strict perms)

Rationale: easy contributor onboarding, good agent operability, strong typing + schema guardrails.

## 2) Project structure

```text
src/
  cli.ts
  index.ts
  auth/
    oauth.ts
    token-store.ts
    refresh-lock.ts
  http/
    client.ts
    errors.ts
    pagination.ts
  commands/
    auth.ts
    profile.ts
    recovery.ts
    sleep.ts
    cycle.ts
    workout.ts
    sync.ts
    webhook.ts
  models/
    whoop.ts
  output/
    envelope.ts
    table.ts
  util/
    time.ts
    config.ts
```

## 3) OAuth strategy

### Preferred flow
`auth login` launches browser to WHOOP auth URL and spins local callback listener (`http://127.0.0.1:<port>/callback`).

### Non-interactive fallback
Support manual code exchange mode:
- print auth URL
- user pastes redirected URL/code
- CLI exchanges code for tokens

### Token lifecycle
- persist `access_token`, `refresh_token`, `expires_at`, `scope`, `token_type`
- refresh proactively (e.g., when <120s left)
- single-flight refresh lock to avoid concurrent refresh races

## 4) Data model + commands

Command principles:
- all commands return stable envelope under `--json`
- command names map directly to WHOOP resources
- pagination abstracted (`next_token` handling)

Examples:
- `recovery latest` -> recent record by sleep start desc
- `sleep latest` -> most recent sleep
- `workout list` -> bounded window, optional `--limit`

## 5) Agent-first output contract

JSON envelope:

```json
{ "data": {"...": "..."}, "error": null }
```

Error envelope:

```json
{
  "data": null,
  "error": {
    "code": "HTTP_401",
    "message": "Unauthorized",
    "details": {"status": 401, "requestId": "..."}
  }
}
```

Exit codes:
- `0` success
- `2` usage/config error
- `3` auth error
- `4` API/network error

## 6) Open-source quality baseline

- MIT license
- conventional commits
- CI: lint + typecheck + test
- release via npm + GitHub releases
- semantic versioning

## 7) OpenClaw skill integration

Skill should guide agent to:
1. check `whoop auth status`
2. run command with `--json`
3. summarize concise insights (no raw dump)
4. use safe retries for transient network failures

## 8) Security notes

- never print client secret
- redact token strings in logs
- strict file perms on local token cache
- verify webhook signatures with HMAC-SHA256 + base64
