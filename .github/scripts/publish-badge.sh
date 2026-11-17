#!/usr/bin/env bash
# Publishes a shields.io endpoint badge file to the `badges` branch, which holds only
# badge data, so the README can read it from raw.githubusercontent.com.
# Usage: GH_TOKEN=... publish-badge.sh <file>
set -euo pipefail
file=$1
dir=$(mktemp -d)
cp "$file" "$dir/"
cd "$dir"
git init -q
git add .
git -c user.name="github-actions[bot]" -c user.email="41898282+github-actions[bot]@users.noreply.github.com" commit -qm "Update $(basename "$file")"
git push -qf "https://x-access-token:${GH_TOKEN}@github.com/${GITHUB_REPOSITORY}.git" HEAD:refs/heads/badges
