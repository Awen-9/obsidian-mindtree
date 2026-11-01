#!/usr/bin/env bash
# Copy the build into a vault's plugin folder.
# Usage: npm run deploy -- /path/to/vault   (or set MINDTREE_VAULT)
set -euo pipefail

VAULT="${1:-${MINDTREE_VAULT:-}}"
[ -n "$VAULT" ] || { echo "Usage: npm run deploy -- /path/to/vault (or set MINDTREE_VAULT)" >&2; exit 1; }
DEST="$VAULT/.obsidian/plugins/mindtree"

cd "$(dirname "$0")/.."
[ -f main.js ] || { echo "main.js not found, run npm run build first" >&2; exit 1; }

mkdir -p "$DEST"
cp main.js manifest.json styles.css "$DEST/"
echo "Deployed to $DEST"
