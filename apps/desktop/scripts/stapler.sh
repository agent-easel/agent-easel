#!/usr/bin/env bash
# Runs `xcrun stapler <staple|validate> <app>` with retries. Both fetch the notarization ticket
# from Apple's CloudKit service, whose connection intermittently drops on GitHub's macOS
# runners (NSURLErrorDomain -1005, stapler error 68), which failed the 0.6.0 and 0.7.0 builds.
#
#   apps/desktop/scripts/stapler.sh staple|validate <path/to/App.app>
set -euo pipefail

action=$1
app=$2
attempts=5
for ((attempt = 1; ; attempt++)); do
  if xcrun stapler "$action" "$app"; then exit 0; fi
  if ((attempt == attempts)); then
    echo "stapler $action failed $attempts times for $app." >&2
    exit 1
  fi
  echo "stapler $action failed (attempt $attempt of $attempts); retrying in $((attempt * 15))s." >&2
  sleep $((attempt * 15))
done
