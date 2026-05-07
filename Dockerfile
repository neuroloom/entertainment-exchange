# Entertainment Business Exchange — Multi-stage Dockerfile
# Stage 1: Build (compile TypeScript)
FROM node:20 AS build

WORKDIR /app

# Copy workspace root config
COPY package.json package-lock.json ./
COPY packages/ ./packages/
COPY apps/api/package.json apps/api/tsconfig.json apps/api/

# Install only production dependencies for all workspaces, then dev deps for build
RUN npm ci --ignore-scripts

# Copy API source
COPY apps/api/src/ apps/api/src/

# Compile TypeScript
RUN cd apps/api && npx tsc

# Stage 2: Production runtime (minimal)
FROM node:20-slim AS runtime

# Install curl for health checks
RUN apt-get update && apt-get install -y --no-install-recommends curl && rm -rf /var/lib/apt/lists/*

# Create non-root user
RUN groupadd -r entx && useradd -r -g entx -d /app -s /sbin/nologin entx

WORKDIR /app

# Copy compiled output (preserve apps/api/dist path for workspace resolution)
COPY --from=build /app/apps/api/dist/ ./apps/api/dist/

# Copy workspace node_modules (only production deps needed at runtime)
COPY --from=build /app/node_modules/ ./node_modules/
COPY --from=build /app/apps/api/node_modules/ ./apps/api/node_modules/
COPY --from=build /app/packages/ ./packages/

# Copy workspace package.json files for module resolution
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/apps/api/package.json ./apps/api/package.json

ENV PORT=3000
ENV NODE_ENV=production

EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -f http://localhost:${PORT}/health || exit 1

USER entx

CMD ["node", "apps/api/dist/server.js"]
