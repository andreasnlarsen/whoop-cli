# Agent skill integration guide

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

Normal WHOOP API data commands refresh expiring access tokens automatically. A `401` gets one coordinated refresh and one retry. You do not need a separate refresh schedule to keep routine commands working.

Use `scripts/whoop-refresh-monitor.sh` every 30-60 minutes only when you want an explicit authentication health check.

Auth storage guidance:
- macOS defaults to Keychain and should not require repeated Touch ID/password prompts for normal reads.
- Linux/OpenClaw recurring deployments should use `whoop auth login --secret-storage onepassword --op-vault ... --op-item ...` with `op` already authenticated by a service account or deployment environment.
- Windows deployments should select `--secret-storage onepassword` explicitly. Windows `auto` storage is not supported.
- Telegram-only/simple VPS setup can use `whoop auth login --secret-storage local-vps --accept-local-vps-risk`.
- Do not send long-lived 1Password service-account tokens through Telegram. For `local-vps`, the expected Telegram handoff is the short-lived WHOOP OAuth auth URL and redirected callback URL.
- Login, refresh, logout, and automatic refresh share one per-profile cross-process lock. A process that waits for another refresh reloads and reuses the current token.
- If WHOOP rejects the stored refresh token, ask the user to run `whoop auth login` again.

## Skill install targets

Default local agent/Codex setup:

```bash
whoop skill install --target agents --force
```

This writes `~/.agents/skills/whoop-cli/SKILL.md` and links `~/.codex/skills/whoop-cli` to that canonical folder.

OpenClaw setup:

```bash
whoop skill install --target openclaw --force
```

Custom skill directory:

```bash
whoop skill install --target path --skill-dir /path/to/skills/whoop-cli --force
```

## Suggested agent skill usage flow

1. Run `whoop auth status --json` and read `authState`.
2. If `authState` is `login-required`, instruct the user to run `whoop auth login` with the storage mode that matches the machine. `refresh-required` does not require login; the next data command refreshes automatically.
3. run requested command with `--json`
4. summarize in plain language + next action
