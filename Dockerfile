# Build stage
# Pinned to a specific bun version so optional-dep resolution stays consistent
# (oven/bun:latest has caused esbuild host/binary version mismatches in CI).
FROM oven/bun:1.3.0 as build-stage
WORKDIR /app

# Vite reads VITE_* env vars at build time and inlines them into the bundle.
# Fly passes these via --build-arg (see [build.args] in fly.toml). We declare
# them as ARGs here and re-export as ENV so the Vite process can see them.
ARG VITE_CLERK_PUBLISHABLE_KEY
ARG VITE_CONVEX_URL
ARG VITE_FF_SERMON_LISTENER
ENV VITE_CLERK_PUBLISHABLE_KEY=$VITE_CLERK_PUBLISHABLE_KEY \
    VITE_CONVEX_URL=$VITE_CONVEX_URL \
    VITE_FF_SERMON_LISTENER=$VITE_FF_SERMON_LISTENER

# Install deps first for better layer caching. --frozen-lockfile fails the build
# if bun.lock would be modified, so we never silently drift.
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

# Copy source AFTER install so source changes don't bust the install layer.
COPY . .

# Defensive: esbuild's optional @esbuild/<platform> package sometimes
# resolves to a different version than the host esbuild, which makes
# esbuild refuse to start with "Host version X does not match binary
# version Y". Re-running esbuild's install.js forces the platform
# binary to match the host package version.
RUN node node_modules/esbuild/install.js

RUN bun run build

# Serve stage
FROM pierrezemb/gostatic
COPY --from=build-stage /app/dist /srv/http/
CMD ["-port","8080","-https-promote", "-enable-logging"]
