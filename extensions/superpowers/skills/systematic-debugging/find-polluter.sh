#!/usr/bin/env bash
# Sequential scan, not bisection. Run only in an isolated test checkout.
# Usage: find-polluter.sh <absent-file-or-directory> <test-path-pattern>
# Pattern is relative to cwd, e.g. 'src/*.test.ts' (find's * crosses /).
# Exit: 0 all selected tests passed without pollution; 1 polluter; 2 inconclusive.
set -euo pipefail
if [ $# -ne 2 ]; then
  echo "usage: find-polluter.sh <absent-path> <test-pattern>" >&2
  exit 2
fi
pollution=$1
pattern="./${2#./}"
if [ -e "$pollution" ] || [ -L "$pollution" ]; then
  echo "inconclusive: pollution path already exists: $pollution" >&2
  exit 2
fi
listing=$(mktemp)
trap 'rm -f "$listing"' EXIT
find . -type f -path "$pattern" -print0 > "$listing"
count=0
failures=0
while IFS= read -r -d '' test_file; do
  count=$((count + 1))
  printf 'Testing: %s\n' "$test_file"
  if ! npm test -- "$test_file"; then
    failures=$((failures + 1))
  fi
  if [ -e "$pollution" ] || [ -L "$pollution" ]; then
    printf 'Polluter: %s; created: %s\n' "$test_file" "$pollution"
    exit 1
  fi
done < "$listing"
if [ "$count" -eq 0 ] || [ "$failures" -ne 0 ]; then
  echo "inconclusive: $count tests selected, $failures commands failed" >&2
  exit 2
fi
echo "No polluter observed: $count selected test commands passed."
