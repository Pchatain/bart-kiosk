#!/usr/bin/env bash
# Fails if the version in index.html (<span id="version">vN</span>) on this
# branch isn't greater than the version on the base branch.
# Usage: check-version.sh <base-ref>     e.g. check-version.sh origin/main
set -euo pipefail

base_ref="${1:-origin/main}"
pattern='s/.*id="version">v([0-9]+)<.*/\1/p'

head_version="$(sed -nE "$pattern" index.html | head -n1)"
base_version="$(git show "$base_ref:index.html" 2>/dev/null | sed -nE "$pattern" | head -n1 || true)"
base_version="${base_version:-0}"

if [[ -z "$head_version" ]]; then
  echo "::error file=index.html::No version found. The footer needs <span id=\"version\">vN</span>."
  exit 1
fi

echo "Version on $base_ref: v$base_version"
echo "Version on this branch: v$head_version"

if (( head_version <= base_version )); then
  echo "::error file=index.html::Version not increased. Change v$head_version to v$((base_version + 1)) in index.html."
  exit 1
fi

echo "OK: v$base_version -> v$head_version"
