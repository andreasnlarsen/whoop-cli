#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

WHOAMI_OUT="$(mktemp /tmp/npm-whoami.XXXXXX.out)"
WHOAMI_ERR="$(mktemp /tmp/npm-whoami.XXXXXX.err)"
VER_OUT="$(mktemp /tmp/npm-ver.XXXXXX.out)"
VER_ERR="$(mktemp /tmp/npm-ver.XXXXXX.err)"
NPX_HELP_OUT="$(mktemp /tmp/npm-npx-help.XXXXXX.out)"
trap 'rm -f "$WHOAMI_OUT" "$WHOAMI_ERR" "$VER_OUT" "$VER_ERR" "$NPX_HELP_OUT"' EXIT

pkg_name=$(node -p "require('./package.json').name")
pkg_version=$(node -p "require('./package.json').version")

echo "==> npm publish preflight"
echo "Package: $pkg_name@$pkg_version"

if [[ -n "$(git status --porcelain)" ]]; then
  echo "ERROR: Working tree is not clean. Commit/stash changes first."
  git status --short
  exit 1
fi

echo "==> Running quality gates"
npm run typecheck
npm test
npm run build

echo "==> Verifying npm auth"
if ! npm whoami >"$WHOAMI_OUT" 2>"$WHOAMI_ERR"; then
  echo "ERROR: npm auth missing/expired. Run: npm login"
  cat "$WHOAMI_ERR" || true
  exit 1
fi
npm_user=$(cat "$WHOAMI_OUT")
echo "Authenticated as: $npm_user"

echo "==> Checking if version already exists"
if npm view "$pkg_name@$pkg_version" version >"$VER_OUT" 2>"$VER_ERR"; then
  echo "ERROR: Version already published: $pkg_name@$pkg_version"
  cat "$VER_OUT"
  exit 1
fi

echo "==> Packing preview"
npm publish --dry-run

echo "==> Publishing"
npm publish --access public

echo "==> Verifying registry"
npm view "$pkg_name" version dist-tags.latest

echo "==> Smoke tests"
npx -y "$pkg_name" --help >"$NPX_HELP_OUT"
head -n 8 "$NPX_HELP_OUT"

echo "SUCCESS: Published $pkg_name@$pkg_version"
