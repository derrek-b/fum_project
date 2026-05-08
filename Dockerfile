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
# Drop the integrity hash for fum_library: the in-Docker tarball bytes
# won't match the locally-packed one (file mtimes differ between the
# local filesystem and Docker COPY operations). All other deps keep
# their integrity pinning intact.
RUN node -e "const fs=require('fs'); const lf=JSON.parse(fs.readFileSync('package-lock.json','utf8')); const e=lf.packages['node_modules/fum_library']; if(e) delete e.integrity; fs.writeFileSync('package-lock.json', JSON.stringify(lf,null,2));"
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
#
# Runs as root: Railway-mounted volumes come up owned by root, and our
# DATA_DIR (e.g. /data) typically points at one of those mounts. A
# non-root USER would hit EACCES on the volume regardless of any
# build-time chown, since the volume mount overlays the build-time
# path with its own ownership at runtime. The container is isolated
# by Railway's infrastructure; running as root here doesn't escape it.
RUN mkdir -p /app/data

CMD ["node", "scripts/start-automation.js"]
