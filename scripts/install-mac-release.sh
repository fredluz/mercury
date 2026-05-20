#!/usr/bin/env bash
set -euo pipefail

REPO="${MERCURY_RELEASE_REPO:-fredluz/mercury}"
APP_PATH="${MERCURY_APP_PATH:-/Applications/Mercury.app}"
ASSET_URL="${MERCURY_DMG_URL:-}"
OPEN_APP=1
ALLOW_SUDO=1
AGENT_FIRST=1
FORCED_AGENT="${MERCURY_INSTALL_AGENT:-}"
PRINT_AGENT_PROMPT=0
TMP_DIR=""
MOUNT_DIR=""
MOUNTED=0

usage() {
  cat <<'EOF'
Usage: install-mac-release.sh [options]

Agent-first Mercury installer for macOS.

By default, this script looks for a local agent CLI in this order:
  codex, claude, pi, hermes, openclaw, claw

If it finds one, it starts a new visible agent session with a prompt that asks
the agent to install Mercury via this same script in --direct mode. If no agent
CLI is found, it falls back to direct installation.

Direct installation downloads the latest Mercury macOS DMG from GitHub Releases,
mounts it, copies Mercury into /Applications, removes the macOS quarantine flag,
and opens the app.

Options:
  --repo OWNER/REPO       GitHub repository. Defaults to fredluz/mercury
  --asset-url URL         Install a specific DMG URL instead of the latest release
  --app PATH              Destination app bundle. Defaults to /Applications/Mercury.app
  --agent COMMAND         Force a specific agent command/path
  --direct                Skip agent detection and install directly
  --agent-first           Prefer launching a local agent first (default)
  --print-agent-prompt    Print the prompt that would be sent to the agent
  --no-open               Do not open Mercury after installing
  --no-sudo               Do not retry privileged steps with sudo
  -h, --help              Show this help

Examples:
  curl -fsSL https://raw.githubusercontent.com/fredluz/mercury/main/scripts/install-mac-release.sh | bash
  curl -fsSL https://raw.githubusercontent.com/fredluz/mercury/main/scripts/install-mac-release.sh | bash -s -- --direct
  scripts/install-mac-release.sh --agent codex
EOF
}

cleanup() {
  if [[ "$MOUNTED" == "1" && -n "$MOUNT_DIR" && -d "$MOUNT_DIR" ]]; then
    hdiutil detach "$MOUNT_DIR" -quiet >/dev/null 2>&1 || true
  fi
  if [[ -n "$TMP_DIR" && -d "$TMP_DIR" ]]; then
    rm -rf "$TMP_DIR"
  fi
}
trap cleanup EXIT

shell_quote() {
  printf '%q' "$1"
}

run_or_sudo() {
  if "$@"; then
    return 0
  fi
  if [[ "$ALLOW_SUDO" != "1" ]]; then
    return 1
  fi
  echo "Retrying with sudo: $*"
  sudo "$@"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --repo)
      if [[ $# -lt 2 ]]; then echo "Missing value for --repo" >&2; exit 2; fi
      REPO="$2"
      shift 2
      ;;
    --asset-url)
      if [[ $# -lt 2 ]]; then echo "Missing value for --asset-url" >&2; exit 2; fi
      ASSET_URL="$2"
      shift 2
      ;;
    --app)
      if [[ $# -lt 2 ]]; then echo "Missing value for --app" >&2; exit 2; fi
      APP_PATH="$2"
      shift 2
      ;;
    --agent)
      if [[ $# -lt 2 ]]; then echo "Missing value for --agent" >&2; exit 2; fi
      FORCED_AGENT="$2"
      AGENT_FIRST=1
      shift 2
      ;;
    --direct)
      AGENT_FIRST=0
      shift
      ;;
    --agent-first)
      AGENT_FIRST=1
      shift
      ;;
    --print-agent-prompt)
      PRINT_AGENT_PROMPT=1
      shift
      ;;
    --no-open)
      OPEN_APP=0
      shift
      ;;
    --no-sudo)
      ALLOW_SUDO=0
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "This installer is only for macOS." >&2
  exit 1
fi

build_direct_install_command() {
  local raw_url="https://raw.githubusercontent.com/${REPO}/main/scripts/install-mac-release.sh"
  local args=(--direct --repo "$REPO" --app "$APP_PATH")

  if [[ -n "$ASSET_URL" ]]; then
    args+=(--asset-url "$ASSET_URL")
  fi
  if [[ "$OPEN_APP" != "1" ]]; then
    args+=(--no-open)
  fi
  if [[ "$ALLOW_SUDO" != "1" ]]; then
    args+=(--no-sudo)
  fi

  printf 'curl -fsSL %s | bash -s --' "$(shell_quote "$raw_url")"
  local arg
  for arg in "${args[@]}"; do
    printf ' %s' "$(shell_quote "$arg")"
  done
  printf '\n'
}

build_agent_prompt() {
  local direct_cmd
  direct_cmd="$(build_direct_install_command)"
  cat <<EOF
You are helping install Mercury on this Mac.

Goal: install the latest Mercury desktop app from GitHub Releases, place it in /Applications, remove the macOS quarantine flag because the app is currently unsigned, and open it.

Please run this deterministic installer command in the terminal/session you control:

${direct_cmd}

Important constraints:
- Be transparent about every command you run.
- If sudo is requested, explain that it is only for copying to /Applications or removing the quarantine flag.
- Do not print or modify unrelated secrets, API keys, SSH keys, browser cookies, or other private files.
- If the command fails, diagnose the failure and ask before trying destructive changes.
- When done, summarize whether Mercury opened successfully.
EOF
}

find_agent_command() {
  if [[ -n "$FORCED_AGENT" ]]; then
    if command -v "$FORCED_AGENT" >/dev/null 2>&1 || [[ -x "$FORCED_AGENT" ]]; then
      printf '%s\n' "$FORCED_AGENT"
      return 0
    fi
    echo "Requested agent command was not found or executable: $FORCED_AGENT" >&2
    return 1
  fi

  local candidate
  for candidate in codex claude pi hermes openclaw claw; do
    if command -v "$candidate" >/dev/null 2>&1; then
      printf '%s\n' "$candidate"
      return 0
    fi
  done

  return 1
}

launch_agent_installer() {
  local agent_cmd="$1"
  local prompt="$2"

  echo "Starting local agent installer session with: $agent_cmd"
  echo "You can watch and approve its work in this terminal."
  echo

  if [[ -r /dev/tty ]]; then
    "$agent_cmd" "$prompt" < /dev/tty
  else
    "$agent_cmd" "$prompt"
  fi
}

if [[ "$AGENT_FIRST" == "1" ]]; then
  AGENT_PROMPT="$(build_agent_prompt)"
  if [[ "$PRINT_AGENT_PROMPT" == "1" ]]; then
    printf '%s\n' "$AGENT_PROMPT"
    exit 0
  fi

  if AGENT_CMD="$(find_agent_command)"; then
    launch_agent_installer "$AGENT_CMD" "$AGENT_PROMPT"
    exit $?
  fi

  echo "No local agent CLI found (checked: codex, claude, pi, hermes, openclaw, claw)."
  echo "Falling back to direct install."
  echo
elif [[ "$PRINT_AGENT_PROMPT" == "1" ]]; then
  build_agent_prompt
  exit 0
fi

for required in curl hdiutil ditto xattr; do
  if ! command -v "$required" >/dev/null 2>&1; then
    echo "Missing required command: $required" >&2
    exit 1
  fi
done

select_dmg_asset() {
  local repo="$1"
  local arch
  local release_json
  local urls
  local selected=""

  arch="$(uname -m)"
  echo "Looking up latest Mercury release from GitHub ($repo)..." >&2
  release_json="$(curl -fsSL "https://api.github.com/repos/${repo}/releases/latest")"
  urls="$(printf '%s\n' "$release_json" | sed -n 's/.*"browser_download_url": "\([^"]*\.dmg\)".*/\1/p')"

  if [[ -z "$urls" ]]; then
    echo "No DMG asset found in the latest release for $repo." >&2
    return 1
  fi

  selected="$(printf '%s\n' "$urls" | grep -Ei 'universal.*\.dmg$' | head -n 1 || true)"
  if [[ -z "$selected" && "$arch" == "arm64" ]]; then
    selected="$(printf '%s\n' "$urls" | grep -Ei '(arm64|aarch64).*\.dmg$' | head -n 1 || true)"
  fi
  if [[ -z "$selected" && "$arch" != "arm64" ]]; then
    selected="$(printf '%s\n' "$urls" | grep -Ei '(x64|x86_64|amd64).*\.dmg$' | head -n 1 || true)"
  fi
  if [[ -z "$selected" ]]; then
    selected="$(printf '%s\n' "$urls" | head -n 1)"
  fi

  printf '%s\n' "$selected"
}

if [[ -z "$ASSET_URL" ]]; then
  ASSET_URL="$(select_dmg_asset "$REPO")"
fi

TMP_DIR="$(mktemp -d -t mercury-install)"
MOUNT_DIR="$TMP_DIR/mount"
DMG_PATH="$TMP_DIR/Mercury.dmg"
mkdir -p "$MOUNT_DIR"

echo "Downloading Mercury DMG:"
echo "  $ASSET_URL"
curl -fL --progress-bar -o "$DMG_PATH" "$ASSET_URL"

echo "Mounting DMG..."
hdiutil attach "$DMG_PATH" -nobrowse -readonly -mountpoint "$MOUNT_DIR" >/dev/null
MOUNTED=1

SOURCE_APP="$(find "$MOUNT_DIR" -maxdepth 2 -name 'Mercury*.app' -type d | head -n 1 || true)"
if [[ -z "$SOURCE_APP" ]]; then
  echo "Could not find Mercury.app inside the DMG." >&2
  exit 1
fi

echo "Installing Mercury to:"
echo "  $APP_PATH"

if [[ -e "$APP_PATH" ]]; then
  run_or_sudo rm -rf "$APP_PATH"
fi
run_or_sudo ditto "$SOURCE_APP" "$APP_PATH"

echo "Removing macOS quarantine flag..."
run_or_sudo xattr -dr com.apple.quarantine "$APP_PATH"

echo "Mercury installed successfully."

if [[ "$OPEN_APP" == "1" ]]; then
  echo "Opening Mercury..."
  open "$APP_PATH"
fi

echo "Done."
