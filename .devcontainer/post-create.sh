#!/usr/bin/env bash
# Runs once after the dev container is created.
set -euo pipefail

echo "==> Ensuring ~/.codex is owned by the 'node' user..."
# The mounted named volume can come up owned by root on first creation.
sudo chown -R node:node "$HOME/.codex" 2>/dev/null || true
chmod 700 "$HOME/.codex" 2>/dev/null || true

echo "==> Installing the standalone OpenAI Codex CLI..."
curl -fsSL https://chatgpt.com/codex/install.sh | CODEX_NON_INTERACTIVE=1 sh

echo "==> Toolchain versions:"
echo "    node    $(node --version)"
echo "    npm     $(npm --version)"
echo "    codex   $(codex --version 2>/dev/null || echo 'not found')"

if [ -f package.json ]; then
  echo "==> Found package.json — installing dependencies..."
  npm install
else
  cat <<'EOF'

==> No Expo app found yet.
    To scaffold one into this folder, run:

        npx create-expo-app@latest .

    Then start the web app with:

        npx expo start --web

EOF
fi

cat <<'EOF'

==> Codex is ready. To sign in with your ChatGPT Plus account, run:

        codex login

    Choose "Sign in with ChatGPT" and complete the flow in your browser
    (port 1455 is forwarded for the OAuth callback). Your login is stored
    in the persistent ~/.codex volume, so you won't need to repeat it after
    a rebuild.

EOF
