# Two stages: build with the toolchain, run without it.
#
# better-sqlite3 is native, so it is compiled in the builder against the same
# Node and libc the runtime uses, and only the finished artefact is copied.

FROM node:22-bookworm-slim AS build
WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
  && rm -rf /var/lib/apt/lists/*

RUN corepack enable && corepack prepare pnpm@10.33.0 --activate

# Manifests first: dependencies only reinstall when they actually change.
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY packages/core/package.json packages/core/
COPY packages/dice/package.json packages/dice/
COPY packages/formula/package.json packages/formula/
COPY packages/protocol/package.json packages/protocol/
COPY packages/rulesets/package.json packages/rulesets/
COPY packages/server/package.json packages/server/
COPY packages/client/package.json packages/client/
COPY packages/adapter-cloudflare/package.json packages/adapter-cloudflare/
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm --filter @vtt/client build \
  && pnpm --filter @vtt/server build

# pnpm links rather than copies, so packages/server/node_modules/better-sqlite3
# is a symlink into /app/node_modules/.pnpm — a path the runtime stage does not
# have. Dereference it here, or what lands over there is a broken link.
#
# Its own runtime dependencies are siblings in that store rather than nested
# inside it, so copying the package alone leaves them behind: better-sqlite3
# needs bindings, which needs file-uri-to-path. prebuild-install is in its
# dependencies too, but only runs at install time, so it stays out of here.
# The object files are build intermediates and are not needed to load it.
RUN set -eu; mkdir -p /nm; for p in better-sqlite3 bindings file-uri-to-path; do src="$(find /app/node_modules/.pnpm -maxdepth 3 -type d -path "*/node_modules/$p" | head -1)"; test -n "$src"; cp -RL "$src" "/nm/$p"; done; rm -rf /nm/better-sqlite3/build/Release/obj /nm/better-sqlite3/build/Release/obj.target

# ---

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production

# Only the native module needs to exist at runtime; everything else is bundled.
COPY --from=build /nm ./node_modules
COPY --from=build /app/packages/server/dist ./dist
COPY --from=build /app/packages/client/dist ./public

# Runs unprivileged: the image's own user owns nothing under /data, which is a
# mounted volume, so ownership is set at start-up by the entrypoint instead.
# That is why USER is not set here — the entrypoint drops to `table` itself,
# after the one thing that needs root is done.
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN useradd --system --uid 10001 --create-home table && chmod +x /usr/local/bin/docker-entrypoint.sh

ENV PORT=8080 DATA_DIR=/data CLIENT_DIR=/app/public
EXPOSE 8080
VOLUME ["/data"]

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
CMD ["node", "dist/server.js"]
