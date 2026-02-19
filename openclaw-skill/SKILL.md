---
name: whoop-cli
description: Use whoop-cli to fetch WHOOP data, generate day briefs/health flags, and export trend data for automation workflows.
---

# whoop-cli

Use the installed `whoop` command.

## Core checks

1. `whoop auth status --json`
2. If unauthenticated: `whoop auth login --client-id ... --client-secret ... --redirect-uri ...`
3. Validate: `whoop day-brief --json --pretty`

## Useful commands

- Daily:
  - `whoop summary --json --pretty`
  - `whoop day-brief --json --pretty`
  - `whoop strain-plan --json --pretty`
  - `whoop health flags --days 7 --json --pretty`
- Trends:
  - `whoop sleep trend --days 30 --json --pretty`
  - `whoop workout trend --days 14 --json --pretty`
- Export:
  - `whoop sync pull --start YYYY-MM-DD --end YYYY-MM-DD --out ./whoop.jsonl --json --pretty`

## Safety

- Never print client secrets or raw tokens.
- Keep API errors concise and actionable.
- Treat this integration as unofficial/non-affiliated.
