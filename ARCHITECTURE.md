# whoop-cli architecture

## 1) Stack and goals

- **Runtime:** Node.js 20+
- **Language:** TypeScript (ESM)
- **CLI parser:** `commander`
- **HTTP:** native `fetch`
- **Validation/helpers:** light custom guards + typed error model
- **Tests:** `node:test` via `tsx --test`

Design goals:
- deterministic JSON contracts for agents
- resilient OAuth token lifecycle for cron/automation
- command surface aligned with WHOOP resources + planning workflows

## 2) Implemented structure

```text
src/
  index.ts
  cli.ts
  types.ts
  auth/
    oauth.ts
    refresh-lock.ts
    token-service.ts
  commands/
    auth.ts
    profile.ts
    recovery.ts
    sleep.ts
    cycle.ts
    workout.ts
    summary.ts
    health.ts
    sync.ts
    webhook.ts
    behavior.ts
    experiment.ts
    context.ts
  http/
    client.ts
    errors.ts
    whoop-data.ts
  models/
    whoop.ts
  output/
    envelope.ts
  store/
    profile-store.ts
  util/
    config.ts
    fs.ts
    metrics.ts
    open-browser.ts
    prompt.ts
    time.ts
    webhook-signature.ts

test/
  envelope.test.ts
  time.test.ts
  webhook-signature.test.ts
```

## 3) OAuth model

### Supported flow
- `whoop auth login` prints auth URL and optionally opens browser.
- User pastes full redirect URL or auth code.
- CLI exchanges code at WHOOP token endpoint.

### Token handling
- Tokens stored per profile in `~/.whoop-cli/profiles/<name>.json`
- File writes are atomic + mode `0600`
- Refresh runs proactively (expiry skew) and on-demand (`auth refresh`)
- Single-flight lock prevents concurrent refresh races

## 4) API integration model

- Base URL default: `https://api.prod.whoop.com`
- Endpoints currently used:
  - `/developer/v2/user/profile/basic`
  - `/developer/v2/user/measurement/body`
  - `/developer/v2/recovery`
  - `/developer/v2/cycle`
  - `/developer/v2/activity/sleep`
  - `/developer/v2/activity/workout`
- Collection pagination supported via `next_token`

## 5) Output contract (agent-first)

All commands support global `--json` envelope:

```json
{ "data": {"...": "..."}, "error": null }
```

Errors:

```json
{
  "data": null,
  "error": {
    "code": "AUTH_ERROR",
    "message": "...",
    "details": {"...": "..."}
  }
}
```

Exit codes:
- `0` success
- `2` usage/config/feature-unavailable
- `3` auth
- `4` API/network
- `1` unexpected/internal

## 6) Command groups

- `auth`: login/status/refresh/logout
- `profile`: show
- `recovery`: latest/list
- `sleep`: latest/list/trend
- `cycle`: latest/list
- `workout`: list/trend
- `summary`: one-line snapshot
- `day-brief`: readiness guidance
- `strain-plan`: intensity recommendation
- `health`: flags/trend
- `sync`: pull export (JSONL)
- `webhook`: signature verification
- `behavior`: local behavior impact analysis
- `experiment`: start/list/report

## 7) Security

- never log secrets intentionally
- token persistence with strict file permissions
- webhook verification uses HMAC-SHA256 + base64 + timing-safe compare

## 8) OpenClaw integration pattern

Recommended flows:
1. `whoop auth status --json`
2. data command (`day-brief`, `summary`, `health flags`) with `--json`
3. concise agent interpretation + scheduling/reminders
4. periodic `auth refresh` health checks for unattended jobs
