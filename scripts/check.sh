#!/bin/sh
# Run the same checks CI would run. Usable two ways:
#   ./scripts/check.sh          — run on demand any time during development
#   .githooks/pre-push          — runs this automatically before every push (see that file)
#
# This exists because GitHub Actions minutes are constrained on a free account right now — this is
# the interim local enforcement standing in for real CI (see ../csvx-spec/AGENTS.md section 6).
set -e

cd "$(dirname "$0")/.."

if ! command -v npm >/dev/null 2>&1; then
	echo "check: 'npm' not found on PATH" >&2
	exit 1
fi

if [ ! -d node_modules ]; then
	echo "check: node_modules missing — run 'npm install' first" >&2
	exit 1
fi

echo "check: tsc --noEmit..."
npx tsc --noEmit

echo "check: vitest run (includes real-fixture + schema-validation checks)..."
npx vitest run

echo "check: tsc build..."
npx tsc -p tsconfig.json

echo "check: all checks passed"
