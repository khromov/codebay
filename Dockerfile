# syntax=docker/dockerfile:1
#
# Codebay as a Docker-out-of-Docker (DooD) container: the manager runs in this
# image but drives the *host's* Docker daemon over a mounted socket, so the
# devcontainers it spins up are siblings on the host. See docker-compose.yml and
# the "Run with Docker" section in README.md for the run recipe (host networking
# + a same-path DATA_DIR bind mount are both required).

# ---- builder: install deps, produce the production build ----
FROM oven/bun:1.3.14-alpine AS builder
WORKDIR /app

# Install layer: only the manifest, lockfile, and patches, so it caches
# independently of source changes. patches/ is required because package.json
# declares a patchedDependency applied during install.
COPY package.json bun.lock* ./
COPY patches ./patches
RUN bun install --frozen-lockfile

# Build layer: the rest of the source, then the production SSR/client build.
COPY . .
RUN bun run build

# ---- runtime: slim image with the CLIs the manager shells out to ----
FROM oven/bun:1.3.14-alpine
WORKDIR /app

# Runtime tools the manager invokes as subprocesses:
#   docker-cli   — @devcontainers/cli and `docker context inspect` both need it
#   nodejs       — node_modules/.bin/devcontainer has a `#!/usr/bin/env node` shebang (Bun can't run it)
#   git          — workspace/.git handling + reads the host global gitconfig
#   github-cli   — `gh auth token` fallback when CODEBAY_GITHUB_TOKEN is unset
RUN apk add --no-cache docker-cli git github-cli nodejs openssh-client ca-certificates bash

COPY --from=builder /app /app

# Run as root so the mounted /var/run/docker.sock is accessible regardless of the
# host socket's gid. (Tradeoff: root in the container has full control of the host
# daemon — expected for a Docker-management tool, but keep it on a trusted host.)
USER root

# HOST=0.0.0.0 is required, not just for LAN access: the code-server containers
# reach the manager's attention bridge via host.docker.internal → host-gateway,
# which a 127.0.0.1-only listener would never answer. Always set BASIC_AUTH_PASSWORD.
ENV PORT=6969 \
    HOST=0.0.0.0 \
    NODE_ENV=production

EXPOSE 6969
CMD ["bun", "run", "start"]
