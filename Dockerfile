# Cowork Skill Factory — FULL engine image (bundles the Claude Code CLI).
#
# Why the CLI is bundled: skilleval (the back-test) and calibrate's self-consistency call
# `claude -p` directly — they have no HTTP path — so a CLI-free image could only run mining,
# not the whole system. We therefore ship the CLI and route EVERY stage through it.
#
# Auth needs NO interactive login: `claude -p` authenticates purely from the environment —
#   ANTHROPIC_BASE_URL + ANTHROPIC_AUTH_TOKEN  (bearer to your gateway, e.g. `ccs env son`)
# so the container is fully headless. The CLI is a Node app, hence Node is installed too.
#
# Build:  docker build -t cowork-miner .
# Run (interactive launcher):
#   docker run -it --env-file .env -v "$PWD/data:/data" -v "$PWD/out:/app/out" \
#     -v "/path/to/cowork-logs:/logs:ro" cowork-miner
# Run (one stage, headless):
#   docker run --rm --env-file .env -v "$PWD/data:/data" -v "$PWD/out:/app/out" \
#     cowork-miner pipeline --source cowork --runner claude --mine --yes

# Base = Node (the Claude Code CLI's runtime). We add Bun and the CLI via npm — no apt-get,
# so the build doesn't depend on Debian repo signatures (the oven/bun trixie base hit a
# "repository not signed / not live until …" clock-skew failure during apt-get update).
FROM node:22-bookworm-slim

# Bun (runs the engine) + the Claude Code CLI (the LLM path), both global, both via npm.
RUN npm install -g bun @anthropic-ai/claude-code && npm cache clean --force

WORKDIR /app

# Deps first for layer caching (only @types/bun today).
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

# App code.
COPY . .

# Engine config. claude CLI is present, so route through it (`--runner claude` uses the
# ambient env — i.e. the gateway creds passed in at run time). No ccs profile needed.
ENV MINER_DATA_DIR=/data \
    MINER_RUNNER=claude \
    COWORK_SESSIONS_ROOT=/logs \
    MINER_SOURCE=cowork

VOLUME ["/data"]

# Default to the interactive launcher (needs `-it`). Override the command for a headless
# single stage, e.g. `docker run … cowork-miner skillcheck`.
ENTRYPOINT ["bun", "run"]
CMD ["start.ts"]
