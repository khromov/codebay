#!/usr/bin/env bash
# Update the vendored mochi-framework to the latest main branch.
#
# Bun can't install a git subdirectory (the package lives in packages/mochi),
# so we vendor that subdir into ./vendor/mochi-framework and depend on it via
# a file: reference in package.json. This script refreshes that vendored copy.
#
# Usage: bun run update:mochi   (or: ./scripts/update-mochi.sh [ref])
#   ref - optional branch/tag/commit to vendor (default: main)
set -euo pipefail

REPO="https://github.com/khromov/mochi.git"
REF="${1:-main}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEST="$ROOT/vendor/mochi-framework"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

echo "Cloning $REPO ($REF)..."
git clone --depth 1 --branch "$REF" "$REPO" "$TMP" >/dev/null 2>&1 \
  || git clone --depth 1 "$REPO" "$TMP" >/dev/null 2>&1  # fall back for raw commit SHAs
if [ -n "${1:-}" ]; then
  git -C "$TMP" fetch --depth 1 origin "$REF" >/dev/null 2>&1 || true
  git -C "$TMP" checkout "$REF" >/dev/null 2>&1 || true
fi

COMMIT="$(git -C "$TMP" rev-parse HEAD)"
SRC="$TMP/packages/mochi"
[ -d "$SRC" ] || { echo "error: packages/mochi not found in repo" >&2; exit 1; }

echo "Vendoring packages/mochi @ ${COMMIT:0:12} -> vendor/mochi-framework"
rm -rf "$DEST"
mkdir -p "$ROOT/vendor"
cp -R "$SRC" "$DEST"
rm -rf "$DEST/node_modules" "$DEST/.git"
cat > "$DEST/.mochi-source" <<EOF
source: https://github.com/khromov/mochi/tree/main/packages/mochi
ref: $REF
commit: $COMMIT
vendored: $(date +%Y-%m-%d)
EOF

echo "Installing dependencies..."
cd "$ROOT"
# Bun records a file: dep's transitive dependencies in bun.lock at install time
# and won't re-read the vendored package.json on a plain `bun install` (even with
# --force). If this mochi update changed mochi's own deps, the lockfile is stale
# and those new packages never get installed. Drop the lockfile so Bun fully
# re-resolves against the freshly vendored vendor/mochi-framework/package.json.
rm -f bun.lock
bun install

echo "Done. mochi-framework now pinned to $REF @ ${COMMIT:0:12}"
