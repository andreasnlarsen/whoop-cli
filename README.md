# whoop-cli

Open-source WHOOP command-line client designed for both humans and automation agents (including OpenClaw skills).

## Why this exists

WHOOP has an official developer platform (OAuth2 + API + webhooks), but no official first-party CLI. This project provides:

- agent-safe JSON output contracts
- robust token refresh for unattended jobs
- decision-oriented commands (`day-brief`, `health flags`, `strain-plan`)

## Install (local dev)

```bash
npm install
npm run build
node dist/index.js --help
```

## OAuth setup

Create a WHOOP app in the Developer Dashboard and collect:

- client id
- client secret
- redirect URI

Then authenticate:

```bash
whoop auth login \
  --client-id "$WHOOP_CLIENT_ID" \
  --client-secret "$WHOOP_CLIENT_SECRET" \
  --redirect-uri "$WHOOP_REDIRECT_URI"
```

You can also set env vars:

- `WHOOP_CLIENT_ID`
- `WHOOP_CLIENT_SECRET`
- `WHOOP_REDIRECT_URI`

## Global flags

- `--json` output `{data,error}` envelope
- `--pretty` pretty-print JSON
- `--profile <name>` profile slot (default `default`)
- `--base-url <url>` defaults to `https://api.prod.whoop.com`
- `--timeout-ms <n>` request timeout

## Command surface

### Auth

- `whoop auth login`
- `whoop auth status`
- `whoop auth refresh`
- `whoop auth logout`

### Core reads

- `whoop profile show`
- `whoop recovery latest|list`
- `whoop sleep latest|list|trend`
- `whoop cycle latest|list`
- `whoop workout list|trend`

### Planning + coaching

- `whoop summary`
- `whoop day-brief`
- `whoop strain-plan`
- `whoop health flags`
- `whoop health trend`

### Data + operations

- `whoop sync pull --start YYYY-MM-DD --end YYYY-MM-DD --out ./whoop.jsonl`
- `whoop webhook verify --secret ... --timestamp ... --signature ... --body-file ...`

### Behavior + experiments

- `whoop behavior impacts --file ~/.whoop-cli/journal-observations.jsonl`
- `whoop experiment start --name ... --behavior ...`
- `whoop experiment list`
- `whoop experiment report --id ...`

## JSON envelope contract

Success:

```json
{ "data": {"...": "..."}, "error": null }
```

Error:

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

## Exit codes

- `0` success
- `2` usage/config/feature-unavailable
- `3` auth
- `4` api/network
- `1` internal unexpected

## OpenClaw integration (intended)

- morning brief cron: `whoop day-brief --json`
- nightly trend: `whoop sleep trend --days 7 --json`
- weekly export: `whoop sync pull ...`
- health guardrails: `whoop health flags --json`

## Notes on behavior impacts

WHOOP public API currently does not expose Journal impact outputs directly in the same way as app UI behavior insights. The `behavior impacts` command supports a local behavior log JSONL to bridge this for personal experiments.

## Security

- tokens stored in `~/.whoop-cli/profiles/<name>.json` with strict file perms
- refresh token flow supported for unattended automation
- never print secrets by default

## Sources

- https://developer.whoop.com/api/
- https://developer.whoop.com/docs/developing/oauth/
- https://developer.whoop.com/docs/developing/webhooks/
- https://developer.whoop.com/docs/developing/getting-started/
