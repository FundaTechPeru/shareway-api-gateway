# syntax=docker/dockerfile:1

# Build stage: installs every dependency, compiles TypeScript and keeps only what runs.
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json tsconfig.build.json ./
COPY src/ src/
RUN npm run build && npm prune --omit=dev

# Runtime stage: production dependencies and the compiled code, run by the unprivileged node user.
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production \
    PORT=8000
COPY --from=build --chown=node:node /app/package.json ./
COPY --from=build --chown=node:node /app/node_modules/ node_modules/
COPY --from=build --chown=node:node /app/dist/ dist/
USER node
EXPOSE 8000
HEALTHCHECK --interval=15s --timeout=3s --start-period=10s --retries=3 \
    CMD wget -qO /dev/null "http://127.0.0.1:${PORT}/health" || exit 1
CMD ["node", "dist/server.js"]
