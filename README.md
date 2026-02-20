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
- Never paste OAuth client secrets/tokens into chat. Run login locally:
  - `whoop auth login --client-id ... --client-secret ... --redirect-uri ...`
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

### OpenClaw skill install (optional)

After global install, copy bundled skill into OpenClaw workspace:

```bash
whoop openclaw install-skill --force
```

(Default target: `~/.openclaw/workspace/skills/whoop-cli/SKILL.md`)

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

```bash
whoop auth login \
  --client-id "<CLIENT_ID>" \
  --client-secret "<CLIENT_SECRET>" \
  --redirect-uri "<REDIRECT_URI>"
```

Then test:

```bash
whoop auth status --json --pretty
whoop day-brief --json --pretty
```

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

If an agent/dev is installing for you, send them these 3 values only:
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

1. Verify auth:

```bash
whoop auth status --json
```

2. If not authenticated, run `whoop auth login ...`
3. Validate with:

```bash
whoop profile show --json
whoop day-brief --json
```

4. For unattended systems, schedule:

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
- `whoop webhook verify --secret ... --timestamp ... --signature ... --body-file ...`
- `whoop activity map-v1-id --id <legacyV1ActivityId>`
- `whoop openclaw install-skill --force`

### Behavior/experiments
- `whoop behavior impacts --file ~/.whoop-cli/journal-observations.jsonl`
- `whoop experiment plan --name ... --behavior ... --start-date YYYY-MM-DD [--end-date YYYY-MM-DD]`
- `whoop experiment start --name ... --behavior ... [--start-date YYYY-MM-DD] [--end-date YYYY-MM-DD]`
- `whoop experiment status [--status planned|running|completed] [--id ...]`
- `whoop experiment list`
- `whoop experiment report --id ...`

Recommended single-source workflow:

1. `whoop experiment plan ...`
2. `whoop experiment status ...`
3. `whoop experiment report --id ...`

`~/.whoop-cli/experiments.json` is the canonical experiment state. Agent outputs include
`experimentsFile` so automations can verify they are reading from that file.

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

- Tokens saved in `~/.whoop-cli/profiles/<name>.json` with strict file permissions
- Refresh-token flow supported for automation
- CLI avoids printing secrets by default

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
npm run typecheck && npm test && npm run build

git add package.json package-lock.json
git commit -m "chore(release): vX.Y.Z"
git push -u origin release/vX.Y.Z

# 2) open PR: release/vX.Y.Z -> main, then merge

# 3) tag from merged main commit
git switch main
git fetch origin
git reset --hard origin/main
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
