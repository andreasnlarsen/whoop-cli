# OpenClaw integration guide

## Recommended daily automations

### Morning brief
Run at wake-up:

```bash
whoop day-brief --json
```

Agent pattern:
1. Parse readiness zone (`green|yellow|red`)
2. Suggest training/load strategy
3. Adjust calendar blocks if needed

### Evening check

```bash
whoop sleep trend --days 7 --json
```

Agent pattern:
- identify consistency drift
- suggest one concrete bedtime improvement

### Risk guardrail

```bash
whoop health flags --json
```

Agent pattern:
- if high severity flags exist: reduce next-day load + recovery reminder

### Weekly export

```bash
whoop sync pull --start 2026-02-01 --end 2026-02-07 --out ./whoop-week.jsonl --json
```

## Cron-safe auth upkeep

Use `scripts/whoop-refresh-monitor.sh` every 30-60 minutes for unattended setups.

## Suggested OpenClaw skill usage flow

1. `whoop auth status --json`
2. if unauthenticated: instruct user to run `whoop auth login`
3. run requested command with `--json`
4. summarize in plain language + next action
