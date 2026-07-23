#!/usr/bin/env bash
# Runs every time the dev container starts or resumes.
set -u

if ! command -v codex >/dev/null 2>&1; then
  echo "==> Codex remote control skipped: the Codex CLI is not installed yet."
  exit 0
fi

# Older Codex releases gated remote control behind this feature flag. Current
# standalone releases expose the command directly and mark the flag as removed.
remote_control_feature_status="$(
  codex features list 2>/dev/null |
    awk '$1 == "remote_control" { print $2; exit }'
)"
if [ -n "$remote_control_feature_status" ] &&
  [ "$remote_control_feature_status" != "removed" ]; then
  echo "==> Enabling the Codex remote-control feature..."
  if ! codex features enable remote_control; then
    echo "==> Warning: could not enable the remote-control feature flag."
  fi
fi

if ! codex login status >/dev/null 2>&1; then
  echo "==> Codex remote control skipped: run 'codex login', then restart the Codespace."
  exit 0
fi

echo "==> Starting Codex remote control..."
if ! codex remote-control start; then
  echo "==> Warning: Codex remote control could not be started."
  exit 0
fi

echo "==> Creating a Codex remote-control pairing code..."
if ! codex remote-control pair; then
  echo "==> Warning: Codex remote control started, but pairing failed."
fi
