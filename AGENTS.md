# AGENTS.md

Agent operating guide for `whoop-cli`.

## Scope

- Repo: `andreasnlarsen/whoop-cli`
- Package: `@andreasnlarsen/whoop-cli`
- ClawHub skill slug: `whoop-cli` (display name: `WHOOP CLI for Agents`)
- Release model: npm trusted publishing via GitHub Actions OIDC

## Day-to-day rules

1. Never push directly to `main` (branch is protected).
2. Always use a feature/release branch + PR.
3. Run quality gates before asking for merge:
   - `npm run typecheck`
   - `npm test`
   - `npm run build`
4. Keep docs/examples aligned with current CLI commands.

## Protected-branch-friendly release checklist (recommended)

Use this sequence to avoid the exact issue we hit (tag pushed but `main` rejected).

### A) Prepare release commit on a branch

```bash
git switch main
git pull --ff-only

git switch -c release/vX.Y.Z
npm version X.Y.Z --no-git-tag-version
npm install --package-lock-only
npm run typecheck && npm test && npm run build

git add package.json package-lock.json
git commit -m "chore(release): vX.Y.Z"
git push -u origin release/vX.Y.Z
```

### B) Open and merge PR into main

- Create PR: `release/vX.Y.Z` -> `main`
- Merge after checks pass.

### C) Tag from merged `main` commit (not from rejected local `main`)

```bash
git switch main
git fetch origin
git reset --hard origin/main

git tag vX.Y.Z
git push origin vX.Y.Z
```

### D) Verify publish workflow

```bash
gh run list --workflow npm-publish.yml --limit 5
gh run watch <run-id> --exit-status
npm view @andreasnlarsen/whoop-cli version dist-tags.latest --json
```

Expected: latest is `X.Y.Z`.

### E) Publish ClawHub skill update (keep installer aligned with npm release)

After npm `X.Y.Z` is live, update and publish the bundled skill so agent installs resolve to that exact package version.

1) Update `openclaw-skill/SKILL.md`:
- `metadata.openclaw.install[].package` -> `@andreasnlarsen/whoop-cli@X.Y.Z`
- install snippet -> `npm install -g @andreasnlarsen/whoop-cli@X.Y.Z`

2) Merge that change via PR (same protected-branch rule: no direct push to `main`).

3) Publish to ClawHub with a new skill version:

```bash
npx -y clawhub publish ./openclaw-skill \
  --slug whoop-cli \
  --name "WHOOP CLI for Agents" \
  --version <skill-semver> \
  --changelog "Align skill installer to @andreasnlarsen/whoop-cli@X.Y.Z" \
  --tags latest
```

4) Verify by installing to a temp workdir and checking installed `SKILL.md` references `@andreasnlarsen/whoop-cli@X.Y.Z`.

## Trusted publishing notes

- Workflow file: `.github/workflows/npm-publish.yml`
- Trigger: tag push matching `v*`
- Required GitHub permissions in workflow:
  - `id-token: write`
  - `contents: read`
- npm package settings must include trusted publisher pointing to:
  - owner/user: `andreasnlarsen`
  - repo: `whoop-cli`
  - workflow filename: `npm-publish.yml`

## Provenance hard requirement (important)

Trusted publishing with provenance will fail if `package.json` metadata is missing/inconsistent.

`package.json` must include and keep accurate:

- `repository.url` -> `https://github.com/andreasnlarsen/whoop-cli`
- `homepage`
- `bugs.url`

If provenance fails with `E422`, check these fields first.

## Bootstrap / fallback publishing

- First publish may require manual publish before trusted publisher can be configured in npm UI.
- Manual flow script (only when needed):

```bash
npm login
./scripts/publish-npm.sh
```

After trusted publisher is active, prefer tag-based OIDC releases only.

## One-line agent install references

- Ephemeral run:
  - `npx -y @andreasnlarsen/whoop-cli summary --json --pretty`
- Global install:
  - `npm install -g @andreasnlarsen/whoop-cli`
- Optional OpenClaw skill install:
  - `whoop openclaw install-skill --force`
