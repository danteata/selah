# Build stage
FROM oven/bun:latest as build-stage
WORKDIR /app
COPY package.json ./
COPY bun.lockb* ./
RUN bun install
COPY . .
RUN bun run build

# Serve stage
FROM pierrezemb/gostatic
COPY --from=build-stage /app/dist /srv/http/
CMD ["-port","8080","-https-promote", "-enable-logging"]
