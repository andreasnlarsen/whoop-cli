#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

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
if ! npm whoami >/tmp/npm_whoami.out 2>/tmp/npm_whoami.err; then
  echo "ERROR: npm auth missing/expired. Run: npm login"
  cat /tmp/npm_whoami.err || true
  exit 1
fi
npm_user=$(cat /tmp/npm_whoami.out)
echo "Authenticated as: $npm_user"

echo "==> Checking if version already exists"
if npm view "$pkg_name@$pkg_version" version >/tmp/npm_ver.out 2>/tmp/npm_ver.err; then
  echo "ERROR: Version already published: $pkg_name@$pkg_version"
  cat /tmp/npm_ver.out
  exit 1
fi

echo "==> Packing preview"
npm publish --dry-run

echo "==> Publishing"
npm publish --access public

echo "==> Verifying registry"
npm view "$pkg_name" version dist-tags.latest

echo "==> Smoke tests"
npx -y "$pkg_name" --help >/tmp/npm_npx_help.out
head -n 8 /tmp/npm_npx_help.out

echo "SUCCESS: Published $pkg_name@$pkg_version"
