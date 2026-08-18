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
    activity.ts
    summary.ts
    health.ts
    sync.ts
    webhook.ts
    behavior.ts
    experiment.ts
    context.ts
    skill.ts
  http/
    client.ts
    errors.ts
    whoop-data.ts
  models/
    whoop.ts
  output/
    envelope.ts
  store/
    keychain-secret-store.ts
    local-vps-secret-store.ts
    onepassword-secret-store.ts
    profile-secret-store.ts
    profile-secret-store-selector.ts
    profile-store.ts
  util/
    activity.ts
    config.ts
    experiment-context.ts
    experiment-scope.ts
    experiment-status.ts
    fs.ts
    metrics.ts
    open-browser.ts
    prompt.ts
    time.ts
    webhook-signature.ts

test/ (selected)
  activity-utils.test.ts
  auth-login-command.test.ts
  envelope.test.ts
  keychain-secret-store.test.ts
  local-vps-secret-store.test.ts
  oauth-refresh.test.ts
  onepassword-secret-store.test.ts
  profile-store.test.ts
  refresh-lock.test.ts
  secret-storage-selector.test.ts
  time.test.ts
  token-service.test.ts
  webhook-signature.test.ts
```

## 3) OAuth model

### Supported flow
- `whoop auth login` prints auth URL and optionally opens browser.
- User pastes the full redirect URL so OAuth `state` can be verified.
- CLI exchanges code at WHOOP token endpoint.

### Token handling
- `ProfileSecretStore` is the narrow secret interface for client secrets, access tokens, and refresh tokens
- `profile-secret-store-selector.ts` is the canonical owner for backend routing
- macOS `auto` uses Keychain under service `whoop-cli`
- Linux `auto` preserves an existing supported backend; explicit `--op-vault`/`--op-item` retargets to 1Password, and `WHOOP_OP_VAULT`/`WHOOP_OP_ITEM` configure 1Password when no supported backend is already stored. Without those choices, Linux `auto` fails with setup choices
- Windows supports explicit 1Password storage. `auto` storage is limited to macOS and Linux
- Explicit Linux `local-vps` stores secrets in `~/.whoop-cli/secrets/<profile>.json` only after risk acknowledgement
- Keychain access uses macOS Security APIs through `/usr/bin/swift`; write values are passed over stdin instead of command-line arguments
- 1Password access uses the installed `op` CLI and writes JSON templates through stdin instead of secret-bearing command arguments
- If `/usr/bin/swift` is unavailable, the CLI reports the missing Apple Command Line Tools prerequisite instead of falling back to command-line secret arguments
- If a sandboxed agent process cannot access macOS Keychain, rerun the CLI with normal user permissions instead of falling back to secret-bearing command-line arguments
- Profile JSON at `~/.whoop-cli/profiles/<name>.json` stores metadata only
- Profile JSON writes are atomic + mode `0600`
- Every WHOOP API data request checks token freshness. Expiring tokens refresh proactively, and one `401` can trigger one refresh plus one retry
- Login, refresh, and logout use the same per-profile queue and cross-process lock
- macOS uses `lockf`, Linux uses `flock`, and Windows uses an exclusive PowerShell `FileStream`; all locks release when the owner exits
- After lock acquisition, refresh reloads the stored profile so a waiter can reuse a token written by another operation
- WHOOP refresh-token rotation is commit-aware: the replacement refresh token is written before other token state and is never rolled back to its revoked predecessor
- OAuth token exchange is not client-aborted because authorization codes and refresh tokens are single-use; normal WHOOP API data requests still use the configured timeout
- `auth status` reports `active`, `refresh-required`, or `login-required`
- Invalid stored refresh tokens return an explicit `whoop auth login` action

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
- `activity`: list/trend/types + v1→v2 mapping
- `summary`: one-line snapshot
- `day-brief`: readiness guidance
- `strain-plan`: intensity recommendation
- `health`: flags/trend
- `sync`: pull export (JSONL)
- `webhook`: signature verification
- `behavior`: local behavior impact analysis
- `experiment`: plan/start/context/status/list/report
- `skill`: install the bundled agent skill

## 7) Security

- never log secrets intentionally
- persistent secrets live in macOS Keychain, 1Password, or explicit `local-vps` storage instead of profile JSON
- `local-vps` is a deliberate lower-security Linux fallback with `0700` secret directory and `0600` secret files; it protects against accidental repo/chat/log exposure, not VPS compromise
- profile metadata persistence uses strict file permissions
- OAuth login requires full redirect URL input so `state` can be checked
- JSON error details redact fields that look like secrets, tokens, authorization headers, or cookies
- webhook verification loads the selected profile's stored client secret and uses HMAC-SHA256 + base64 + timing-safe compare

## 8) Agent skill integration pattern

Recommended flows:
1. `whoop auth status --json`
2. data command (`day-brief`, `summary`, `health flags`) with `--json`
3. concise agent interpretation + scheduling/reminders
4. optional `auth refresh` health checks for unattended jobs; data commands refresh automatically

Bundled skill install targets:
- local agents/Codex: `whoop skill install --target agents --force`
- OpenClaw: `whoop skill install --target openclaw --force`
- custom directory: `whoop skill install --target path --skill-dir /path/to/skills/whoop-cli --force`
