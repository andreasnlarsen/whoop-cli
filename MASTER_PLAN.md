# whoop-cli Master Plan (Research + JTBD)

## 0) Goal

Build an open-source `whoop-cli` that is:

1. **Useful to real WHOOP members daily** (not just developers)
2. **Reliable for automation/agents** (stable JSON + predictable behavior)
3. **Easy to integrate into OpenClaw skills and cron workflows**

---

## 1) Research summary (what people use WHOOP for)

### Official WHOOP docs/product messaging

From WHOOP docs and product pages, users primarily use WHOOP for:

- **Daily readiness / recovery** (green/yellow/red, HRV, RHR, sleep contribution)
- **Sleep optimization** (sleep performance, consistency, sleep stage quality)
- **Strain management** (how hard to push based on recovery)
- **Behavior experiments** via Journal (alcohol, late meal, supplements, routines)
- **Trend tracking** over weeks/months (sleep, recovery, training load)
- **Coaching + guidance** from metrics to next-day decision making

Developer platform capabilities confirm:

- OAuth2 + refresh tokens (requires `offline` scope)
- Read scopes for profile/body/sleep/recovery/cycle/workout
- Paginated collection endpoints (`next_token` pattern)
- Webhooks for sleep/workout/recovery changes + signed webhook verification

### Community patterns (public discussions + OSS clients)

Common practical usage patterns:

- Morning “Should I push or recover today?” decision
- Correlation hunting (what improves/worsens recovery)
- Sleep consistency and bedtime behavior tweaks
- Pairing WHOOP with existing workout tools (WHOOP = readiness layer)
- Automation needs: token refresh reliability, cron-safe output, one-line summary

Common friction:

- OAuth/token expiration pain in unattended jobs
- Hard to turn raw metrics into clear actions
- Need for easier habit/behavior impact loops

---

## 2) Product thesis for `whoop-cli` + OpenClaw

`whoop-cli` should be the **decision engine bridge** between WHOOP metrics and action.

- CLI handles **auth + data retrieval + normalized output**
- OpenClaw handles **reasoning + planning + reminders + accountability**

So instead of “data dump,” users get:

- clear daily recommendation
- time-aware suggestions
- proactive reminders
- weekly optimization loops

---

## 3) Master JTBD list (prioritized)

Priority legend:
- **P0** = must-have for initial usefulness
- **P1** = high-value after core
- **P2** = advanced/expansion

## A) Daily readiness & planning

### JTBD-01 (P0)
**When I wake up, help me decide whether to push hard or recover today.**
- CLI needs: latest recovery, latest sleep, latest cycle strain
- Command target: `whoop day brief`
- OpenClaw help: convert to concrete day plan (high/moderate/rest)

### JTBD-02 (P0)
**Give me a one-line health snapshot for quick checks and notifications.**
- CLI needs: summary formatter with stable fields
- Command target: `whoop summary`
- OpenClaw help: heartbeat reminders and anomaly alerts

### JTBD-03 (P1)
**Warn me when my readiness drops meaningfully from baseline.**
- CLI needs: rolling baseline and thresholding
- Command target: `whoop detect dips --window 14d`
- OpenClaw help: suggest reduced load / sleep focus interventions

## B) Sleep optimization

### JTBD-04 (P0)
**Show whether my sleep met need and where quality was lost.**
- CLI needs: latest sleep score + stage summary + sleep need context
- Command target: `whoop sleep latest --explain`
- OpenClaw help: generate tonight’s sleep checklist

### JTBD-05 (P1)
**Track sleep consistency trend and identify drift.**
- CLI needs: trailing trend metrics
- Command target: `whoop sleep trend --days 30`
- OpenClaw help: bedtime schedule nudges via cron

## C) Training load and performance

### JTBD-06 (P0)
**Compare yesterday’s strain vs recovery and suggest today’s load.**
- CLI needs: cycle + recovery join
- Command target: `whoop strain plan`
- OpenClaw help: map to specific workout intensity choices

### JTBD-07 (P1)
**List workout load trend to prevent overreaching streaks.**
- CLI needs: workout/cycle trend view
- Command target: `whoop workout trend --days 14`
- OpenClaw help: proactive deload suggestion

## D) Behavior experiments (Journal-driven)

### JTBD-08 (P1)
**Find which behaviors correlate with better/worse recovery for me.**
- CLI needs: behavior impact ingestion (where available) + correlation summary
- Command target: `whoop behavior impacts`
- OpenClaw help: choose 1–2 experiments for the next week

### JTBD-09 (P2)
**Run controlled personal experiments (A/B habit weeks).**
- CLI needs: experiment template and export
- Command target: `whoop experiment start/report`
- OpenClaw help: define protocol + reminders + retrospective

## E) Health monitoring and risk flags

### JTBD-10 (P1)
**Flag potential illness/recovery risk signals (e.g., sustained RHR↑/HRV↓).**
- CLI needs: multi-metric deviation rules
- Command target: `whoop health flags`
- OpenClaw help: conservative day plan and escalation checklist

### JTBD-11 (P2)
**Track blood pressure/health-monitor style trends over time (if available).**
- CLI needs: optional endpoints/feature-gated collectors
- Command target: `whoop health trend`
- OpenClaw help: weekly digest and doctor-ready summary

## F) Data portability and integrations

### JTBD-12 (P0)
**Export my WHOOP data for analysis, backup, or downstream automations.**
- CLI needs: JSONL/CSV export with pagination
- Command target: `whoop sync pull --start ... --end ...`
- OpenClaw help: scheduled exports and summary reports

### JTBD-13 (P1)
**Use WHOOP webhooks safely to avoid polling and react faster.**
- CLI needs: webhook signature verification utility
- Command target: `whoop webhook verify`
- OpenClaw help: event-driven automations and alerts

## G) Reliability & operations

### JTBD-14 (P0)
**Keep auth alive without babysitting token expiry.**
- CLI needs: robust refresh + lock + clear status
- Command target: `whoop auth login/status/refresh`
- OpenClaw help: cron-based preemptive refresh checks

### JTBD-15 (P0)
**Ensure every command is agent-safe in pipelines.**
- CLI needs: strict JSON envelope + deterministic exit codes
- Command target: global `--json`
- OpenClaw help: dependable parsing and fallbacks

---

## 4) Command roadmap mapped to JTBD

## Phase 1 (P0 core, ship ASAP)

- `whoop auth login`
- `whoop auth status`
- `whoop auth refresh`
- `whoop profile show`
- `whoop recovery latest`
- `whoop sleep latest`
- `whoop cycle latest`
- `whoop summary`
- `whoop day brief`
- `whoop sync pull --start --end --out`

## Phase 2 (P1 value acceleration)

- `whoop sleep trend --days`
- `whoop workout trend --days`
- `whoop strain plan`
- `whoop health flags`
- `whoop behavior impacts`
- `whoop webhook verify`

## Phase 3 (P2 advanced)

- `whoop experiment start`
- `whoop experiment report`
- `whoop health trend`
- richer coach-style narratives and custom rules

---

## 5) OpenClaw skill strategy

Skill: `skills/whoop-cli/`

Primary usage loops:

1. **Morning loop**
   - `whoop day brief --json`
   - Agent generates today’s plan + reminders

2. **Evening loop**
   - `whoop sleep trend --days 7 --json`
   - Agent suggests 1 improvement for tonight

3. **Weekly loop**
   - `whoop sync pull` + trend commands
   - Agent creates weekly performance report

4. **Risk loop**
   - `whoop health flags --json`
   - Agent triggers conservative workload guidance

---

## 6) Technical requirements (must-have)

- Stable JSON envelope (`{data,error}`)
- Exit codes:
  - `0` success
  - `2` usage/config
  - `3` auth
  - `4` api/network
- Token refresh single-flight lock
- Safe retries/backoff for transient API failures
- Redacted logs (never print secrets)
- Strict file perms for token cache

---

## 7) OSS positioning

Audience:
- quantified-self users
- coaches/trainers
- automation builders
- AI-agent users (OpenClaw, scripts, cron)

Differentiation:
- **agent-first CLI contracts** (not just human output)
- **decision-oriented commands** (`day brief`, `health flags`, `strain plan`)
- **first-class OpenClaw skill support**

---

## 8) Immediate execution plan (next 7 steps)

1. Implement auth module (`login/status/refresh`) with refresh lock
2. Implement typed HTTP client + pagination helper
3. Implement `profile show`, `recovery latest`, `sleep latest`, `cycle latest`
4. Implement `summary` and `day brief` from core metrics
5. Implement `sync pull` export (JSONL)
6. Add tests for auth refresh race + envelope stability
7. Publish first alpha + wire OpenClaw skill commands

---

## 9) Success criteria

- User can run morning brief in one command
- Cron jobs survive token expiration without manual intervention
- OpenClaw can parse outputs without brittle string matching
- Weekly trend report can be generated automatically
- At least one actionable recommendation is produced daily

---

## Sources

- WHOOP Developer Docs: API/OAuth/Webhooks/Getting Started
  - https://developer.whoop.com/api/
  - https://developer.whoop.com/docs/developing/oauth/
  - https://developer.whoop.com/docs/developing/webhooks/
  - https://developer.whoop.com/docs/developing/getting-started/
- WHOOP Product + Journal + Recovery pages
  - https://www.whoop.com/us/en/how-it-works/
  - https://www.whoop.com/us/en/thelocker/the-whoop-journal/
  - https://www.whoop.com/us/en/thelocker/how-does-whoop-recovery-work-101/
- Community/OSS signals
  - https://www.reddit.com/r/whoop/comments/13f5arz/how_do_you_actually_use_your_whoop/
  - https://github.com/felixnext/whoopy
  - https://github.com/koala73/whoopskill
