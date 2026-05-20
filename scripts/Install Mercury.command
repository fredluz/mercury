#!/usr/bin/env bash
set -euo pipefail

# Double-clickable macOS installer wrapper.
# This file opens in Terminal, then runs Mercury's agent-first installer.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
LOCAL_INSTALLER="$SCRIPT_DIR/install-mac-release.sh"
REMOTE_INSTALLER="https://raw.githubusercontent.com/fredluz/mercury/main/scripts/install-mac-release.sh"

clear || true
cat <<'EOF'
Mercury macOS Installer
=======================

This will install Mercury from GitHub Releases.

Default behavior:
- use a local agent first if one is installed (codex, claude, pi, hermes, openclaw, claw)
- otherwise install directly
- copy Mercury.app into /Applications
- remove the macOS quarantine flag for Mercury.app
- open Mercury when finished

EOF

if [[ -x "$LOCAL_INSTALLER" ]]; then
  "$LOCAL_INSTALLER" "$@"
else
  echo "Using latest installer from GitHub..."
  curl -fsSL "$REMOTE_INSTALLER" | bash -s -- "$@"
fi

cat <<'EOF'

Installer finished. You can close this Terminal window.
EOF

# Keep Terminal open long enough for double-click users to read the result.
if [[ -t 0 ]]; then
  printf "Press Return to close... "
  read -r _ || true
fi
