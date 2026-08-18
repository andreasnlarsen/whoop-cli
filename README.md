# whoop-cli

Simple WHOOP command-line tool for humans and agents.

It gives you:
- easy OAuth login
- daily readiness commands (`day-brief`, `summary`, `health flags`)
- machine-safe JSON output (`{data,error}`)
- export + webhook verification tools

---

## Important: auth model (for now)

This project is currently **BYO WHOOP app credentials**.

That means each user (or each installer/agent) must create a WHOOP Developer app and use its:
- Client ID
- Client Secret
- Redirect URI

There is **no managed/shared auth service** in this repo right now.

Secrets are local-only:
- macOS defaults to Keychain for the WHOOP client secret, access token, and refresh token.
- Linux/OpenClaw should use 1Password service-account storage for recurring unattended use.
- Windows can use explicit 1Password storage with `--secret-storage onepassword`; `auto` storage is limited to macOS and Linux.
- Linux VPS setups can explicitly opt into `local-vps` storage for a Telegram-only/simple setup.
- `~/.whoop-cli/profiles/<name>.json` stores non-secret profile metadata only.
- After login, regular reads and refreshes should not need passwords or Touch ID prompts.

Authentication is automatic after login:
- Every WHOOP API data command refreshes an expiring access token before its request.
- A `401` response gets one coordinated refresh and one retry.
- Login, refresh, logout, and automatic refresh share one per-profile lock across processes on macOS, Linux, and Windows.
- WHOOP rotates refresh tokens. The replacement is stored before other token state so the revoked token is not restored after a partial write.
- If WHOOP rejects the stored refresh token, the CLI gives the explicit action: run `whoop auth login` again.

## Important legal / brand notice

- This project is **unofficial** and is **not affiliated with, endorsed by, or sponsored by Whoop, Inc.**
- **WHOOP** is a trademark of Whoop, Inc., used here for compatibility/reference only.
- This CLI is built to work with the WHOOP developer API, but you are responsible for complying with:
  - WHOOP API Terms of Use
  - WHOOP brand/design guidelines
  - applicable privacy and data-protection laws
- Do **not** embed or publish client secrets/tokens in source code, examples, or public logs.
- If WHOOP requests naming/branding/compliance changes, maintainers should address them promptly and cooperatively.

## Trust & Safety (quick)

- Package: `@andreasnlarsen/whoop-cli`
- Releases are published via GitHub Actions trusted publishing (OIDC) with npm provenance.
- This integration is unofficial and not affiliated with Whoop, Inc.
- Never paste long-lived OAuth client secrets/tokens into chat. Use Keychain on macOS, 1Password on Linux/OpenClaw or Windows, or explicitly acknowledged `local-vps` storage for simple locked-down Linux VPS setups.
- Verify install quickly:
  - `npx -y @andreasnlarsen/whoop-cli --help`
  - `whoop auth status --json`
  - `whoop day-brief --json`

---

## One-line options (no clone)

If you want agents/users to run it immediately without cloning:

### Recommended (npm registry)

Run once (ephemeral):

```bash
npx -y @andreasnlarsen/whoop-cli summary --json --pretty
```

Install globally:

```bash
npm install -g @andreasnlarsen/whoop-cli
```

### Fallback (GitHub source)

If npm registry is unavailable for any reason:

```bash
npm exec --yes --package=github:andreasnlarsen/whoop-cli -- whoop summary --json --pretty
npm install -g github:andreasnlarsen/whoop-cli
```

Then use:

```bash
whoop --help
```

### Agent skill install (optional)

After global install, copy the bundled skill into the local agent skills folder:

```bash
whoop skill install --target agents --force
```

Default target: `~/.agents/skills/whoop-cli/SKILL.md`, with a Codex discovery symlink at `~/.codex/skills/whoop-cli`.

For OpenClaw:

```bash
whoop skill install --target openclaw --force
```

---

## Quick start

## 1) Install

```bash
npm install
npm run build
```

Run help:

```bash
node dist/index.js --help
```

(If installed globally later, use `whoop ...` directly.)

### Command name

The executable is `whoop` (not `whoop-cli`).

## 2) Create WHOOP app

Open: https://developer-dashboard.whoop.com/

Create an app and set these fields:

- **App name:** anything (example: `whoop-cli`)
- **Redirect URI:** use one value and keep it consistent
  - recommended: `http://localhost:1234/callback`
  - accepted alternative: `https://localhost:1234/callback`
- **Scopes:** include at least
  - `read:recovery`
  - `read:cycles`
  - `read:workout`
  - `read:sleep`
  - `read:profile`
  - `read:body_measurement`
  - `offline` (for refresh token)

Then copy these 3 values from WHOOP dashboard:
- client id
- client secret
- redirect URI

## 3) Login

Run login locally and paste the three WHOOP app values when prompted. The client secret prompt is hidden, so it does not land in shell history or process arguments.

```bash
whoop auth login
```

For scripted setup only, you can provide `--client-id`, `--client-secret`, and `--redirect-uri`, or inject `WHOOP_CLIENT_ID`, `WHOOP_CLIENT_SECRET`, and `WHOOP_REDIRECT_URI` for that one command. Do not keep real secrets in shell startup files, checked-in `.env` files, or shared docs.

Secret storage is selected with `--secret-storage`:

- `auto` (default): macOS uses Keychain. Linux preserves an existing supported backend; explicit `--op-vault` and `--op-item` retarget to 1Password, and `WHOOP_OP_VAULT`/`WHOOP_OP_ITEM` configure 1Password when no supported backend is already stored. Without those choices, Linux auto fails with setup guidance.
- `macos-keychain`: stores the client secret and OAuth tokens in macOS Keychain under the `whoop-cli` service. Keychain access uses macOS Security APIs through `/usr/bin/swift` so secret values are passed over stdin instead of command-line arguments.
- `onepassword`: stores rotating WHOOP secrets in a 1Password item using the `op` CLI. Use this for Linux/OpenClaw VPSes with a service account or for explicit Windows storage.
- `local-vps`: explicit Linux VPS fallback that stores secrets in `~/.whoop-cli/secrets/<profile>.json` with `0600` permissions. It requires `--accept-local-vps-risk` and protects against accidental repo/chat/log exposure, not VPS compromise.

On Windows, select `onepassword` explicitly and provide `--op-vault` plus `--op-item`. Windows `auto` storage is not supported.

Example Linux/OpenClaw 1Password setup:

```bash
whoop auth login \
  --secret-storage onepassword \
  --op-vault "Ops" \
  --op-item "WHOOP default"
```

Example Telegram-only/simple VPS setup:

```bash
whoop auth login \
  --secret-storage local-vps \
  --accept-local-vps-risk
```

The profile JSON on disk keeps only metadata. If `/usr/bin/swift` is unavailable for macOS Keychain, install Apple Command Line Tools with `xcode-select --install`, then retry.

If a sandboxed agent shell cannot access macOS Keychain, rerun the command from a normal Terminal or with unsandboxed execution. Do not switch to command-line secret arguments as a workaround.

During a normal login, macOS should not ask for "password data for new item". If that prompt appears, stop and update/reinstall the CLI before trying again.

Then test:

```bash
whoop auth status --json --pretty
whoop day-brief --json --pretty
```

`whoop auth status --json` reports `authState` as `active`, `refresh-required`, or `login-required`. An expired access token with a stored refresh token remains authenticated because the next WHOOP API data command refreshes it automatically.

---

## Redirect URI: what to use

This is the #1 setup confusion, so here is the practical rule:

- The redirect URI in WHOOP Dashboard and CLI must **match exactly**.
- `whoop-cli` currently uses a **manual paste flow** (it does not require a running callback server).

### Recommended default

Use:

`http://localhost:1234/callback`

Set this in WHOOP Dashboard, and pass the same value to `whoop auth login`.

### If localhost is blocked by your policy

Use any stable URI you control, for example:

`https://your-domain.com/whoop/callback`

Again, pass the exact same value in CLI.

### What happens during login?

After WHOOP consent, browser redirects to that URI with `?code=...&state=...`.
Copy the **full redirected URL** from the browser address bar and paste it into the CLI prompt.

(If localhost page fails to load, that is usually fine—just copy the URL.)

If browser auto-open does not work on your machine, run login with:

```bash
whoop auth login --no-open
```

Then open the printed URL manually in your browser.

---

## For non-technical users

If an agent/dev is installing for you, provide these 3 values through a secure channel or an approved secret manager:
1. Client ID
2. Client Secret
3. Redirect URI

They run login once, then you can use ready commands like:

```bash
whoop summary --json --pretty
whoop day-brief --json --pretty
```

---

## For agents/installers (recommended setup flow)

1. Verify auth and read `authState`:

```bash
whoop auth status --json
```

2. If `authState` is `login-required`, help the user run `whoop auth login` with the right storage mode. `refresh-required` does not require login.
   - macOS: default `auto`/Keychain.
   - Linux/OpenClaw recurring use: `--secret-storage onepassword --op-vault ... --op-item ...`.
   - Windows: `--secret-storage onepassword --op-vault ... --op-item ...`.
   - Telegram-only simple VPS: `--secret-storage local-vps --accept-local-vps-risk`.
3. Do not send long-lived 1Password service-account tokens through Telegram. For simple `local-vps` setup, the expected Telegram handoff is the short-lived WHOOP OAuth auth URL and redirected callback URL.
4. Validate with:

```bash
whoop profile show --json
whoop day-brief --json
```

5. Optional: use the monitor as an explicit health check. Normal WHOOP API data commands already refresh automatically.

```bash
scripts/whoop-refresh-monitor.sh
```

---

## Most useful commands

### Daily coaching
- `whoop summary`
- `whoop day-brief`
- `whoop strain-plan`
- `whoop health flags`

### Core data
- `whoop profile show`
- `whoop recovery latest|list`
- `whoop sleep latest|list|trend`
- `whoop cycle latest|list`
- `whoop activity list|trend|types`
  - `whoop activity` is the canonical source for movement/training records.
  - WHOOP generic `activity` entries are auto-detected and can be unlabeled movement (housework/incidental activity), not necessarily intentional training.
  - Use filters (`--labeled-only`, `--generic-only`, `--sport-id`, `--sport-name`) for analysis slices.

### Agent-first filtering pattern (recommended)

Use raw `activity` output as your source of truth, then filter for the task.

Examples:

```bash
# All activities in a window
whoop activity list --days 30 --json --pretty

# Training-only slice (exclude generic auto-detected activity)
whoop activity list --days 30 --labeled-only --json --pretty

# Specific type slice (stable by IDs or names returned from `activity types`)
whoop activity list --days 30 --sport-id 63 --json --pretty
whoop activity list --days 30 --sport-name walking --json --pretty

# Optional shell-side filtering when jq is available
whoop activity list --days 30 --json | jq '.data.records | map(select(.sport_id != -1))'
```

### Ops
- `whoop sync pull --start YYYY-MM-DD --end YYYY-MM-DD --out ./whoop.jsonl`
- `whoop --profile default webhook verify --timestamp ... --signature ... --body-file ...`
- `whoop activity map-v1-id --id <legacyV1ActivityId>`
- `whoop skill install --target agents --force`
- `whoop skill install --target openclaw --force`

### Behavior/experiments
- `whoop behavior impacts --file ~/.whoop-cli/journal-observations.jsonl`
- `whoop experiment plan --name ... --behavior ... --start-date YYYY-MM-DD [--end-date YYYY-MM-DD] [--description ... --why ... --hypothesis ... --success-criteria ... --protocol ...]`
- `whoop experiment start --name ... --behavior ... [--start-date YYYY-MM-DD] [--end-date YYYY-MM-DD] [--description ... --why ... --hypothesis ... --success-criteria ... --protocol ...]`
- `whoop experiment context --id ... [--description ... --why ... --hypothesis ... --success-criteria ... --protocol ...]`
- `whoop experiment status [--status planned|running|completed] [--id ...]`
- `whoop experiment list`
- `whoop experiment report --id ...`

Recommended single-source workflow:

1. `whoop experiment plan ...` (capture context at creation time)
2. `whoop experiment context --id ...` (optional updates)
3. `whoop experiment status ...`
4. `whoop experiment report --id ...`

Profile scope behavior:
- Experiments are scoped to active `--profile` by default.
- Use `--all-profiles` on `experiment list|status|report|context` when you explicitly want cross-profile views.

`~/.whoop-cli/experiments.json` is the canonical experiment state. Agent outputs include
`sourceOfTruth` (and `experimentsFile` compatibility alias) so automations can verify source path.

---

## JSON output contract

With `--json`, every command returns:

```json
{ "data": {"...": "..."}, "error": null }
```

or

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
- `4` api/network
- `1` unexpected internal

---

## Security

- macOS Keychain stores the WHOOP client secret, access token, and refresh token on macOS
- 1Password service-account storage is the preferred Linux/OpenClaw VPS backend
- `local-vps` is an explicit Linux fallback with `0700` secret directory and `0600` secret files
- `~/.whoop-cli/profiles/<name>.json` stores non-secret metadata with strict file permissions
- WHOOP API data commands refresh expiring tokens automatically and retry one `401` after coordinated refresh
- Per-profile authentication locks coordinate login, refresh, and logout across processes on macOS, Linux, and Windows
- Rotated refresh tokens are persisted before other token state
- CLI avoids printing secrets by default
- JSON error details redact fields that look like secrets, tokens, authorization headers, or cookies

---

## Maintainer release (npm)

### Option A: Trusted publisher (recommended)

This repo includes: `.github/workflows/npm-publish.yml`.

One-time setup on npmjs.com (**required**):

1. Go to package settings for `@andreasnlarsen/whoop-cli`
2. Add trusted publisher:
   - Provider: GitHub Actions
   - Organization/User: `andreasnlarsen`
   - Repository: `whoop-cli`
   - Workflow filename: `npm-publish.yml`
   - Environment name: leave empty (or set if you enforce GitHub Environment)
3. Optional hardening (recommended): package Settings → Publishing access →
   - "Require two-factor authentication and disallow tokens"

Release flow (branch-protected safe):

```bash
# 1) prepare release commit on a branch
git switch main
git pull --ff-only

git switch -c release/vX.Y.Z
npm version X.Y.Z --no-git-tag-version
npm install --package-lock-only
# update both exact X.Y.Z pins in agent-skill/SKILL.md
npm run typecheck && npm test && npm run build

git add package.json package-lock.json agent-skill/SKILL.md
git commit -m "chore(release): vX.Y.Z"
git push -u origin release/vX.Y.Z

# 2) open PR: release/vX.Y.Z -> main, then merge

# 3) tag from merged main commit
git switch main
git pull --ff-only origin main
git tag vX.Y.Z
git push origin vX.Y.Z
```

The GitHub workflow publishes automatically on `v*` tags via OIDC trusted publishing.

### Bootstrap note (first publish)

npm currently requires the package to exist before trusted publisher can be configured in package settings.
If this is your very first publish for this package, do one manual publish first:

```bash
npm login
./scripts/publish-npm.sh
```

Then enable trusted publisher and use tag-based releases going forward.

## Sources

- https://developer.whoop.com/api/
- https://developer.whoop.com/docs/developing/oauth/
- https://developer.whoop.com/docs/developing/webhooks/
- https://developer.whoop.com/docs/developing/getting-started/
- https://developer.whoop.com/api-terms-of-use/
- https://developer.whoop.com/docs/developing/design-guidelines/
- https://developer.whoop.com/docs/developing/app-approval/
