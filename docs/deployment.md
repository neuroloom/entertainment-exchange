# Entertainment Business Exchange -- Deployment Guide

## Prerequisites

| Component | Minimum | Recommended | Notes |
|-----------|---------|-------------|-------|
| Node.js | 20.x | 20 LTS | Required for TypeScript + ESM |
| PostgreSQL | 16 | 16 | Required for production persistence |
| Redis | 7.x (optional) | 7 Alpine | Optional; enables L2 semantic cache persistence |
| Docker | 24+ | Latest | For containerized deployment |
| Docker Compose | v2 | Latest | For multi-service orchestration |

---

## Environment Variables Reference

Copy `.env.example` to `.env` and configure. Variables marked **Required** must be set.

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `JWT_SECRET` | **Yes** | -- | HS256 signing key, minimum 32 characters |
| `DATABASE_URL` | **Yes** | -- | PostgreSQL connection string `postgres://user:pass@host:5432/db` |
| `PORT` | No | `3000` | HTTP server port |
| `NODE_ENV` | No | `development` | `development`, `production`, or `test` |
| `CORS_ORIGINS` | No | -- | Comma-separated allowed origins (required in production) |
| `LOG_LEVEL` | No | `info` | Pino log level: `trace`, `debug`, `info`, `warn`, `error`, `fatal` |
| `TRUST_PROXY` | No | `false` | Set to `true` when behind a reverse proxy (enables X-Forwarded-For) |
| `OPENAI_API_KEY` | No | -- | OpenAI API key for embedding generation (semantic cache) |
| `EMBEDDING_PROVIDER` | No | `openai` | Embedding backend provider |
| `ANTHROPIC_AUTH_TOKEN` | No | -- | Anthropic API key for agent inference |
| `ANTHROPIC_BASE_URL` | No | `https://api.anthropic.com` | Anthropic API base URL |

### Generating a JWT_SECRET

```bash
openssl rand -base64 48
```

---

## Docker Compose Deployment (Recommended)

The project includes `docker-compose.yml` at the repository root with API and PostgreSQL services.

### Quick Start

```bash
# Clone and enter the repository
cd entertainment-exchange

# Copy and edit environment
cp .env.example .env
# Edit .env: set JWT_SECRET, verify DATABASE_URL matches docker-compose

# Build and start
docker-compose up -d

# Check status
docker-compose ps

# View logs
docker-compose logs -f api

# Verify health
curl http://localhost:3000/health
```

### docker-compose.yml Services

```
Service   Port     Description
------    ----     -----------
api       3000     Fastify API server (multi-stage Docker build)
db        5432     PostgreSQL 16 with health check
redis     6379     Redis 7 (commented out by default, uncomment to enable)
```

### Stop and Clean Up

```bash
# Stop services (preserves data volume)
docker-compose down

# Stop and remove data volume
docker-compose down -v
```

---

## Manual Deployment

### 1. Install Dependencies

```bash
# From the repository root
npm ci --ignore-scripts
```

### 2. Build TypeScript

```bash
npm run build
```

### 3. Set Up PostgreSQL

Create the database and user:

```sql
CREATE USER entx WITH PASSWORD 'your-secure-password';
CREATE DATABASE entertainment_exchange OWNER entx;
```

### 4. Configure Environment

```bash
export DATABASE_URL=postgres://entx:your-secure-password@localhost:5432/entertainment_exchange
export JWT_SECRET=$(openssl rand -base64 48)
export NODE_ENV=production
export CORS_ORIGINS=https://your-domain.com
```

### 5. Run Migrations

```bash
# Migrations run automatically at server startup, or manually:
cd packages/db && npm run migrate
```

Migration files live in `packages/db/migrations/` and run in numbered order:
- `0001_initial.sql` -- Core schema (businesses, bookings, ledger, audit, rights)
- `0002_seed_defaults.sql` -- Default chart of accounts
- `0003_refresh_tokens.sql` -- Refresh token persistence

### 6. Start the Server

```bash
# Development (with hot reload)
npm run dev

# Production
NODE_ENV=production node apps/api/dist/server.js

# Or via the workspace script
cd apps/api && npm start
```

### 7. (Optional) Seed Sample Data

```bash
cd apps/api && npm run seed
```

### 8. Systemd Service (Linux)

Create `/etc/systemd/system/entx-api.service`:

```ini
[Unit]
Description=Entertainment Business Exchange API
After=network.target postgresql.service

[Service]
Type=simple
User=entx
WorkingDirectory=/opt/entertainment-exchange
Environment=NODE_ENV=production
Environment=PORT=3000
EnvironmentFile=/opt/entertainment-exchange/.env
ExecStart=/usr/bin/node apps/api/dist/server.js
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now entx-api
```

---

## Reverse Proxy Configuration

### Nginx Example

```nginx
upstream entx_api {
    server 127.0.0.1:3000;
    keepalive 64;
}

server {
    listen 443 ssl http2;
    server_name api.entertainment-exchange.example.com;

    ssl_certificate     /etc/ssl/certs/entx.pem;
    ssl_certificate_key /etc/ssl/private/entx.key;

    # Rate limit: 100 req/s per IP
    limit_req_zone $binary_remote_addr zone=entx:10m rate=100r/s;
    limit_req zone=entx burst=50 nodelay;

    # Security headers
    add_header X-Frame-Options "DENY" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;

    location / {
        proxy_pass http://entx_api;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # Timeouts for long-running agent requests
        proxy_read_timeout 120s;
        proxy_send_timeout 120s;
    }

    location /health {
        proxy_pass http://entx_api;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
    }
}

# Redirect HTTP to HTTPS
server {
    listen 80;
    server_name api.entertainment-exchange.example.com;
    return 301 https://$host$request_uri;
}
```

When behind a reverse proxy, set `TRUST_PROXY=true` in the environment to enable
`X-Forwarded-For` trust for rate limiting.

---

## Database Setup

### Auto-Migration

Migrations run automatically at server startup when `DATABASE_URL` is set. The migration
runner (`packages/db/src/migrate.ts`):
1. Reads `.sql` files from `packages/db/migrations/` in numbered order
2. Tracks applied migrations in `schema_migrations` table
3. Runs each unapplied migration inside a transaction
4. Skips previously applied migrations (idempotent)

### Manual Migration

```bash
cd packages/db
DATABASE_URL=postgres://entx:pass@localhost:5432/entertainment_exchange npx tsx src/migrate.ts
```

### Schema Overview

Core tables (see `0001_initial.sql`):
- `businesses` -- Business entities with tenant isolation
- `bookings` -- Booking records with status state machine
- `ledger_journals` / `ledger_entries` -- Immutable double-entry records
- `audit_events` -- Compliance audit trail
- `rights_anchors` / `rights_assets` / `rights_passports` -- Chain-of-title
- `marketplace_listings` / `marketplace_deals` -- Deal negotiation records
- `schema_migrations` -- Migration tracking

---

## Health Check Verification

The API exposes a health endpoint at `GET /health`:

```bash
# Basic health
curl http://localhost:3000/health

# Example response
# { "status": "ok", "uptime": 12345, "pg": "connected", "memory": { "stores": 7 } }
```

Health check fields:
- `status` -- `ok` or `degraded`
- `uptime` -- Process uptime in seconds
- `pg` -- PostgreSQL status: `connected`, `disconnected`, or `not_configured`
- `memory` -- Count of in-memory stores and their sizes

Docker health check uses `curl -f http://localhost:3000/health` every 30 seconds.

---

## Backup Strategy

### PostgreSQL Backup (pg_dump)

```bash
# Full database dump
pg_dump -U entx -h localhost -d entertainment_exchange \
  --no-owner --no-acl -Fc \
  > entx_$(date +%Y%m%d_%H%M%S).dump

# Restore
pg_restore -U entx -h localhost -d entertainment_exchange \
  --clean --if-exists entx_20260509_120000.dump
```

### Automated Backup Script

```bash
#!/bin/bash
# /opt/scripts/entx-backup.sh
BACKUP_DIR="/opt/backups/entx"
RETENTION_DAYS=30
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
mkdir -p "$BACKUP_DIR"

pg_dump -U entx -h localhost -d entertainment_exchange \
  --no-owner --no-acl -Fc \
  > "$BACKUP_DIR/entx_$TIMESTAMP.dump"

# Remove backups older than retention period
find "$BACKUP_DIR" -name "entx_*.dump" -mtime +$RETENTION_DAYS -delete

echo "Backup complete: entx_$TIMESTAMP.dump"
```

### Cron Schedule

```cron
# Daily at 2 AM
0 2 * * * /opt/scripts/entx-backup.sh >> /var/log/entx-backup.log 2>&1
```

### Point-in-Time Recovery

Enable WAL archiving in `postgresql.conf` for PITR:

```ini
wal_level = replica
archive_mode = on
archive_command = 'test ! -f /mnt/wal_archive/%f && cp %p /mnt/wal_archive/%f'
```

---

## Monitoring Setup

### Application Metrics

The API exposes internal metrics through the `metricsPlugin`. Enable structured logging:

```bash
LOG_LEVEL=debug  # Detailed request/response logging
```

Key metrics tracked per request:
- Route, method, status code
- Response time (slow requests >1s are warned)
- Trace ID for distributed tracing correlation

### PostgreSQL Monitoring

```sql
-- Active connections
SELECT count(*) FROM pg_stat_activity;

-- Long-running queries
SELECT pid, now() - query_start AS duration, query
FROM pg_stat_activity
WHERE state = 'active' AND now() - query_start > interval '5 seconds';

-- Cache hit ratio (target: >99%)
SELECT sum(blks_hit) * 100.0 / sum(blks_hit + blks_read) AS cache_hit_ratio
FROM pg_stat_database WHERE datname = 'entertainment_exchange';
```

### Log Aggregation

Pino outputs structured JSON logs to stdout. Pipe to your log aggregator:

```bash
# File-based (with rotation)
node dist/server.js 2>&1 | pino-rotatelog -d /var/log/entx/

# ELK / Loki
node dist/server.js 2>&1 | pino-elasticsearch --index entx-api
```

### Uptime Monitoring

The `/health` endpoint is designed for uptime monitoring services. Configure your
monitor (UptimeRobot, Pingdom, Datadog) to check `http://your-host:3000/health`
every 60 seconds and alert if the `status` field is not `ok`.
