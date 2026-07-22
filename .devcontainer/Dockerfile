# Base image: Microsoft's maintained Dev Container image for JavaScript/Node.
# It ships Node 20 (LTS), npm, git, and a non-root "node" user out of the box —
# everything an Expo project and the Codex CLI need to run.
FROM mcr.microsoft.com/devcontainers/javascript-node:20

# Install the OpenAI Codex CLI globally so `codex` is on PATH in every session.
# Baking it into the image (instead of postCreate) means it survives rebuilds
# and doesn't re-download on every container start.
RUN npm install -g @openai/codex@latest \
    && npm cache clean --force

# Handy globals for Expo development. `expo` itself is normally run via `npx`
# inside the project, but EAS CLI is convenient to have available.
RUN npm install -g eas-cli@latest \
    && npm cache clean --force

# Expo's Metro bundler watches many files; give Node a bit more headroom.
ENV NODE_OPTIONS=--max-old-space-size=4096
