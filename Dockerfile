# syntax=docker/dockerfile:1

# ============================================================
# Stage 1: build + pack fum_library tarball
# fum_library is consumed by fum_automation as a local tarball
# (file:../fum_library/fum_library-2.0.0.tgz). It is not published
# to a registry, so we have to produce the tarball during build.
# ============================================================
FROM node:22-alpine AS library-builder
WORKDIR /build/fum_library
COPY fum_library/ ./
# `npm run pack` runs build + npm pack. It also tries to reinstall
# into ../fum and ../fum_automation, but those directories aren't
# present in this stage's context, so those branches no-op with a
# harmless "not found" echo.
RUN npm run pack

# ============================================================
# Stage 2: install fum_automation production dependencies
# fum_automation's package.json references the tarball at
# file:../fum_library/fum_library-2.0.0.tgz, so the file must
# sit at exactly that relative path when npm install runs.
# ============================================================
FROM node:22-alpine AS deps
WORKDIR /build/fum_automation
COPY fum_automation/package.json fum_automation/package-lock.json ./
COPY --from=library-builder /build/fum_library/fum_library-2.0.0.tgz /build/fum_library/fum_library-2.0.0.tgz
RUN npm install --omit=dev --omit=optional

# ============================================================
# Stage 3: runtime image
# ============================================================
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production

COPY --from=deps /build/fum_automation/node_modules ./node_modules
COPY fum_automation/package.json ./
COPY fum_automation/src ./src
COPY fum_automation/scripts ./scripts

# /app/data holds runtime state (vaults/, blacklist.json,
# trackingFailures.json). Mount a Railway volume here for
# persistence across deploys, or set DATA_DIR to point elsewhere.
RUN mkdir -p /app/data && chown -R node:node /app
USER node

CMD ["node", "scripts/start-automation.js"]
