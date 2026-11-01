#!/usr/bin/env bash
# Fails if the version in index.html (<span id="version">vN</span> or vN.M)
# on this branch isn't greater than the version on the base branch.
#   Major updates: v9 -> v10.   Smaller updates: v10 -> v10.1 -> v10.2.
# Usage: check-version.sh <base-ref>     e.g. check-version.sh origin/main
set -euo pipefail

base_ref="${1:-origin/main}"
pattern='s/.*id="version">v([0-9]+(\.[0-9]+)*)<.*/\1/p'

head_version="$(sed -nE "$pattern" index.html | head -n1)"
base_version="$(git show "$base_ref:index.html" 2>/dev/null | sed -nE "$pattern" | head -n1 || true)"
base_version="${base_version:-0}"

if [[ -z "$head_version" ]]; then
  echo "::error file=index.html::No version found. The footer needs <span id=\"version\">vN</span> (e.g. v10 or v10.1)."
  exit 1
fi

echo "Version on $base_ref: v$base_version"
echo "Version on this branch: v$head_version"

# Compare part by part (10.2 > 10.1 > 10 > 9.10 > 9.9). sort -V orders version numbers.
highest="$(printf '%s\n%s\n' "$base_version" "$head_version" | sort -V | tail -n1)"
if [[ "$head_version" == "$base_version" || "$highest" != "$head_version" ]]; then
  major="${base_version%%.*}"
  if [[ "$base_version" == *.* ]]; then minor="${base_version#*.}"; minor="${minor%%.*}"; else minor=0; fi
  echo "::error file=index.html::Version not increased (main is v$base_version). Use v$major.$((minor + 1)) for a small update or v$((major + 1)) for a major one."
  exit 1
fi

echo "OK: v$base_version -> v$head_version"
