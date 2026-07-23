# Base image: Microsoft's maintained Dev Container image for JavaScript/Node.
# It ships Node 20 (LTS), npm, git, and a non-root "node" user out of the box.
FROM mcr.microsoft.com/devcontainers/javascript-node:20

# Handy globals for Expo development. `expo` itself is normally run via `npx`
# inside the project, but EAS CLI is convenient to have available.
RUN npm install -g eas-cli@latest \
    && npm cache clean --force

# Expo's Metro bundler watches many files; give Node a bit more headroom.
ENV NODE_OPTIONS=--max-old-space-size=4096
