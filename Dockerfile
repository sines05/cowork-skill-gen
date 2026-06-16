# Cowork Skill Factory — engine image.
#
# Runs the whole pipeline (mine → skill-gen → back-test) entirely over HTTP via the
# `--runner api` path, so NO `claude` CLI is needed inside the container — it only needs a
# gateway base URL + token in the environment (ANTHROPIC_BASE_URL / ANTHROPIC_AUTH_TOKEN).
#
# Build:  docker build -t cowork-miner .
# Run (interactive launcher):
#   docker run -it --env-file .env -v "$PWD/data:/data" -v "$PWD/out:/app/out" \
#     -v "/path/to/cowork-logs:/logs:ro" cowork-miner
# Run (one stage, headless):
#   docker run --rm --env-file .env -v "$PWD/data:/data" -v "$PWD/out:/app/out" \
#     cowork-miner pipeline --source cowork --runner api --mine --yes

FROM oven/bun:1.3.14-slim
WORKDIR /app

# Install deps first for layer caching (only @types/bun today).
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

# App code.
COPY . .

# Engine config. The launcher reads MINER_DATA_DIR to keep SQLite on the /data volume;
# MINER_RUNNER=api forces the HTTP path (no claude CLI in the image). COWORK_SESSIONS_ROOT
# points at the mounted host logs.
ENV MINER_DATA_DIR=/data \
    MINER_RUNNER=api \
    COWORK_SESSIONS_ROOT=/logs \
    MINER_SOURCE=cowork

VOLUME ["/data"]

# Default to the interactive launcher (needs `-it`). Override the command for a headless
# single stage, e.g. `docker run … cowork-miner skillcheck`.
ENTRYPOINT ["bun", "run"]
CMD ["start.ts"]
