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
- `whoop workout list|trend`

### Ops
- `whoop sync pull --start YYYY-MM-DD --end YYYY-MM-DD --out ./whoop.jsonl`
- `whoop webhook verify --secret ... --timestamp ... --signature ... --body-file ...`
- `whoop activity map-v1-id --id <legacyV1ActivityId>`

### Behavior/experiments
- `whoop behavior impacts --file ~/.whoop-cli/journal-observations.jsonl`
- `whoop experiment start --name ... --behavior ...`
- `whoop experiment list`
- `whoop experiment report --id ...`

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

## Sources

- https://developer.whoop.com/api/
- https://developer.whoop.com/docs/developing/oauth/
- https://developer.whoop.com/docs/developing/webhooks/
- https://developer.whoop.com/docs/developing/getting-started/
