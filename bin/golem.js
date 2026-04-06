#!/bin/bash
# Golem — start the platform with auto-restart support
# Exit code 75 = restart requested (e.g. after onboarding writes config)
SOURCE="${BASH_SOURCE[0]}"
while [ -L "$SOURCE" ]; do
  DIR="$(cd -P "$(dirname "$SOURCE")" && pwd)"
  SOURCE="$(readlink "$SOURCE")"
  [[ $SOURCE != /* ]] && SOURCE="$DIR/$SOURCE"
done
SCRIPT_DIR="$(cd -P "$(dirname "$SOURCE")/.." && pwd)"
cd "$SCRIPT_DIR"

while true; do
  npx tsx src/cli.ts
  EXIT_CODE=$?
  if [ "$EXIT_CODE" -eq 75 ]; then
    echo "[golem] restarting platform..."
    sleep 1
    continue
  fi
  exit $EXIT_CODE
done
