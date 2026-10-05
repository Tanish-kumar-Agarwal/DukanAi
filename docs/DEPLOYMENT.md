# Deployment

Roadmap 7.3, 9.7 and 9.8. Two images, one release step, probes an
orchestrator can trust, and a shutdown that finishes what it started.
`docker-compose.yml` at the repository root is the reference stack for
development and the phase 7 exit gate (everything bundled, HTTP on
localhost); `docker-compose.prod.yml` is the production variant (managed
database and Redis outside, documents on a cloud disk, HTTPS at the edge),
and `deploy/k8s/` the same topology on Kubernetes.

## Production topology

Decided (roadmap 9.7, with the recovery design signed in
`docs/DATA_SAFETY.md`, section 6):

- **Database**: a managed MySQL 8 service (high availability, automated
  backups with point-in-time recovery, deletion protection, private
  endpoint), reached over TLS with the server certificate verified
  (`DATABASE_URL` carries `?sslaccept=strict`, plus `sslcert=` and the
  provider's CA file when it is not signed by a public CA). Nothing in the
  repository runs the production database.
- **Redis**: a managed instance (`rediss://` when it offers TLS); disposable,
  nothing is backed up or restored.
- **API**: exactly one replica on one cloud host (or one pod). The documents
  under `STORAGE_ROOT` (billing evidence, statements, backups of a shop)
  and the product images under `uploads/media` are files on a persistent
  cloud disk attached to that host, snapshotted by the provider on a
  schedule. One replica is what the POS needs today (a shop bills serially
  by design, `docs/LOAD_TEST_BASELINE.md`), and it keeps the documents a
  plain directory with a plain backup. The path to several replicas is
  object storage behind `StoragePathBuilder` (two days, not built); until
  then `replicas > 1` is never set.
- **Web**: the Next.js server next to the API, reaching it over the
  internal network (`API_INTERNAL_URL`); stateless.
- **Edge**: Caddy (compose) or an Ingress controller (Kubernetes)
  terminates HTTPS for `WEB_HOST` and `API_HOST`, redirects HTTP, forwards
  the client address, and is the only thing that publishes a port. The API
  runs with `TRUST_PROXY=1`.
- **Backups**: the `backup-agent` (a compose service, a sidecar on
  Kubernetes) runs the daily dump of the managed database with its
  binary-log position, the documents archive and the encrypted off-site
  copy, stamping each success for the stale-backup alert; the provider's
  point-in-time recovery is the primary database recovery path and the
  dump the independent copy (`docs/BACKUP_RESTORE.md`).

In one line: internet -> edge (443) -> web (3000) and API (3002) on one
host -> managed MySQL (TLS) and managed Redis; documents on the host's
cloud disk; backups to a second disk and off-site. The compose smoke
proves this variant on every CI run against an external TLS-only MySQL
(`scripts/compose-smoke-prod.sh`, below).

## Images

Both Dockerfiles build from the repository root (the npm workspace is the
unit of install) on one pinned Node version (`NODE_VERSION` in each
Dockerfile, the major of `.nvmrc`; bump them together), on Debian slim
(Prisma engines, sharp and bcrypt are glibc builds), as the non-root `node`
user, with the `HEALTHCHECK` on the liveness route.

| Image | Build | Contents | Serves |
|---|---|---|---|
| `dukaanai-api` | `docker build -f apps/api/Dockerfile -t dukaanai-api .` | `apps/api/dist`, production `node_modules` of the API only, Prisma schema + migrations | `node dist/main` on `PORT` (3002) |
| `dukaanai-web` | `docker build -f apps/web/Dockerfile --build-arg NEXT_PUBLIC_API_URL=<browser-facing API URL> -t dukaanai-web .` | Next.js standalone output (`NEXT_STANDALONE=true` at build) | `node apps/web/server.js` on `PORT` (3000) |

The web image inlines `NEXT_PUBLIC_API_URL` into the browser bundle: build one
image per public API URL. Everything else is runtime environment. No `.env`
file is copied into either image; every value comes from the orchestrator.

## Release step: migrations

`prisma migrate deploy` runs once per release, before the new API starts, from
the API image:

```
docker run --rm -e DATABASE_URL=mysql://user:pass@host:3306/dukaanai dukaanai-api npx prisma migrate deploy
```

Compose models it as the `migrate` service (`api` depends on
`service_completed_successfully`); on Kubernetes it is a Job or an init
container with the same command; on ECS a one-off task. It is a no-op when
nothing is pending, so run it on every deploy. The API never migrates on its
own: a boot against a database behind the migrations refuses to start with the
drift message (see `apps/api/prisma/MIGRATIONS.md` for `migrate status` /
`migrate resolve`). The database user needs `CREATE TRIGGER` (the ledger
immutability triggers) and, with binary logging on, MySQL's
`log_bin_trust_function_creators=1` (compose sets it on the server).

## Probes

| Route | Meaning | Wire to |
|---|---|---|
| `GET /api/health`, `GET /api/health/live` (API) | the process serves HTTP; never touches a dependency | liveness probe, `HEALTHCHECK` |
| `GET /api/health/ready` (API) | 200 only when the database answers, Redis answers and no shutdown is in progress; 503 with `{ status: 'draining' \| 'unavailable', checks }` otherwise | readiness probe, load balancer target health, compose `healthcheck` |
| `GET /api/health` (web) | the Next.js server answers | liveness probe, `HEALTHCHECK` |

Both health controllers are public and exempt from rate limiting. The API
listens only after its BullMQ connections are open (`QUEUE_READY_TIMEOUT_MS`),
so a passing readiness probe means the instance both serves and consumes.

Kubernetes sketch for the API:

```yaml
livenessProbe:  { httpGet: { path: /api/health/live,  port: 3002 }, periodSeconds: 10 }
readinessProbe: { httpGet: { path: /api/health/ready, port: 3002 }, periodSeconds: 5, failureThreshold: 2 }
startupProbe:   { httpGet: { path: /api/health/live,  port: 3002 }, periodSeconds: 5, failureThreshold: 24 }
terminationGracePeriodSeconds: 45   # > SHUTDOWN_DRAIN_DELAY_MS + SHUTDOWN_TIMEOUT_MS
```

## Graceful shutdown (API)

On `SIGTERM`/`SIGINT` (`GracefulShutdownService`, `src/common/lifecycle`):

1. readiness answers 503 `draining` at once;
2. the process waits `SHUTDOWN_DRAIN_DELAY_MS` (0 under compose; 5 s behind a
   Kubernetes Service, so endpoints stop routing before the listener closes);
3. every BullMQ worker is closed: no new job is taken, active jobs finish;
4. the HTTP and socket servers close: in-flight requests complete, idle
   keep-alive connections are dropped;
5. BullMQ queues, the Redis client (`QUIT`) and Prisma (`$disconnect`) close;
6. the process exits 0. A drain still running after `SHUTDOWN_TIMEOUT_MS`
   (30 s) exits 1 instead of waiting for `SIGKILL`.

Keep the orchestrator's grace period above the sum of the two settings
(compose: `stop_grace_period: 40s`). `HTTP_KEEP_ALIVE_TIMEOUT_MS` (65 s) must
exceed the idle timeout of the proxy or load balancer in front, or it reuses
a connection the server just closed and answers 502.
`test/integration/deployment.integration-spec.ts` sends a real `SIGTERM` to
the compiled API and asserts every step; `scripts/compose-smoke.sh` does the
same through `docker compose stop`.

## Environment

API (`apps/api/.env.example` documents every key; the class defaults cover
the tuning values, so a container needs only these):

| Variable | Required | Notes |
|---|---|---|
| `NODE_ENV` | yes | `production` (set in the image) |
| `DATABASE_URL` | yes | MySQL 8; add `?connection_limit=` per instance |
| `REDIS_URL` | yes | `redis://` or `rediss://`, path = db index |
| `JWT_SECRET` | yes | 32+ characters, no template value (boot refuses otherwise) |
| `FRONTEND_URL` | yes | browser origin(s), comma-separated: CORS and sockets |
| `TRUST_PROXY` | recommended | hop count of proxies in front; the web server is one hop on sign-in |
| `STORAGE_ROOT`, `UPLOAD_TEMP_DIR` | `STORAGE_ROOT` required in production | an absolute path on a persistent volume (billing evidence; a relative or placeholder root refuses to boot) and a writable temp dir |
| `SMTP_URL`, `EMAIL_FROM` | for invitations / password reset | production refuses to issue an invitation without SMTP |
| `GEMINI_API_KEY`, `OCR_MODEL` | for the AI scanner | 503 `OCR_NOT_CONFIGURED` otherwise |
| `SHUTDOWN_*`, `HTTP_KEEP_ALIVE_TIMEOUT_MS`, `QUEUE_READY_TIMEOUT_MS` | optional | above |
| `LOG_LEVEL` | optional | most verbose level printed (default `log` in production, which refuses `debug`/`verbose`); JSON lines with the correlation id |
| `METRICS_ENABLED`, `METRICS_TOKEN` | optional | `GET /api/metrics` (Prometheus); the token (16+ characters) makes the scrape require a bearer token. See `docs/OBSERVABILITY.md` |
| `BACKUP_STATUS_DIR` | production | the backup jobs' `<kind>.last-success` stamps, read on every scrape into `backup_last_success_timestamp_seconds{kind}` for the stale-backup alert; compose mounts the `db-backups` volume read-only and points it at `status/` (roadmap 9.4) |
| `SENTRY_DSN`, `SENTRY_ENVIRONMENT`, `SENTRY_TRACES_SAMPLE_RATE`, `APP_RELEASE` | optional | error tracking is off until the DSN is set; set `APP_RELEASE` to the image tag or commit at deploy time |
| `CRON_RETENTION_SWEEP`, `RETENTION_*` | optional | the nightly purge of expired tokens, DONE outbox rows and old history (roadmap 7.8; windows in `apps/api/.env.example`) |
| `CRON_RECONCILIATION` | optional | the nightly financial reconciliation of every shop's previous business day (roadmap 9.5; default 01:30 server time, after every shop's midnight); drift raises `DukaanAiReconciliationDrift` |

Web:

| Variable | When | Notes |
|---|---|---|
| `NEXT_PUBLIC_API_URL` | build (inlined) and runtime (CSP `connect-src`) | the API as the browser reaches it |
| `API_INTERNAL_URL` | runtime, optional | the API as the web server reaches it (sign-in, refresh); defaults to the public URL |
| `NEXTAUTH_SECRET`, `NEXTAUTH_URL` | runtime | 32+ character secret; the web's public origin |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `NEXT_PUBLIC_GOOGLE_OAUTH_ENABLED` | runtime, optional (the flag is inlined at build) | Google sign-in is registered only with real values; the button shows only when the flag is `true` at build time |

`NEXT_PUBLIC_AUTH_DISABLED` and `AUTH_DISABLED` are never set in a container:
both builds and the API refuse them under `NODE_ENV=production`.

## Compose from a fresh clone

```
cp .env.example .env
sed -i "s/^JWT_SECRET=.*/JWT_SECRET=$(openssl rand -hex 32)/; s/^NEXTAUTH_SECRET=.*/NEXTAUTH_SECRET=$(openssl rand -hex 32)/" .env
docker compose up --build -d --wait
open http://localhost:3000
```

`--wait` returns once `web` is healthy, which implies `migrate` exited 0 and
the API readiness probe passed. Data lives in the `mysql-data`, `redis-data`,
`api-storage` and `api-uploads` volumes. Redeploy with
`docker compose build && docker compose run --rm migrate && docker compose up -d`.

`scripts/compose-smoke.sh` is the automated gate (CI job "Deployment (compose
smoke)"): it creates `.env` when missing, brings the stack up, proves the
release step is idempotent, both probes, registration, API and web sign-in,
stock, an open shift, a cash sale, the dashboard figure, then stops the API
with `SIGTERM` and asserts exit code 0 and the shutdown log lines, and tears
the stack down (`KEEP=1` leaves it running).

## Production compose variant

`docker-compose.prod.yml` (project `dukaanai-prod`) runs the topology above
on one host: the same images and release step as the reference stack,
without MySQL and Redis, with the `edge` always on, no port published but
80/443, and the `backup-agent` service. `.env` at the repository root
(template `.env.example`, "Production variant" block) supplies:

| Variable | Value |
|---|---|
| `DATABASE_URL` | `mysql://<user>:<pass>@<host>:3306/<db>?connection_limit=20&sslaccept=strict` (+ `&sslcert=/etc/dukaanai/db-ca.pem` with `DB_CA_FILE=<path to the provider CA>` for a private CA) |
| `REDIS_URL` | `redis://` or `rediss://<host>:6379/0` |
| `WEB_HOST`, `API_HOST` | the two public DNS names (A records at this host) |
| `WEB_ORIGIN`, `API_PUBLIC_URL` | `https://<WEB_HOST>`, `https://<API_HOST>/api` (the latter is baked into the web image at build) |
| `EDGE_TLS_LINE` | blank: automatic public certificates; `tls internal` for a host without public DNS |
| `STORAGE_PATH`, `UPLOADS_PATH`, `BACKUPS_PATH` | absolute paths on the cloud disk(s); blank = named volumes on the host disk |
| `TRUST_PROXY` | `1` (the edge); `2` with a load balancer in front of it |
| `DB_OPS_DATABASE_URL`, `BACKUP_COORDINATES` | the backup user (RELOAD + REPLICATION CLIENT) for the agent, or the application user with `skip` |
| `JWT_SECRET`, `NEXTAUTH_SECRET`, `OFFSITE_*`, integrations | as in the reference stack |

```
docker compose -f docker-compose.prod.yml up --build -d --wait      # first deploy
docker compose -f docker-compose.prod.yml build \
  && docker compose -f docker-compose.prod.yml run --rm migrate \
  && docker compose -f docker-compose.prod.yml up -d                # redeploy
docker compose -f docker-compose.prod.yml --profile ops run --rm db-ops status   # the backup jobs
```

`scripts/compose-smoke-prod.sh` is the automated gate (CI job "Deployment
(compose smoke)", after the reference smoke): it generates a private CA,
starts a throwaway MySQL 8 that refuses plaintext and a Redis
(`scripts/smoke-prod/external-services.yml`, layered over the production
file for the run), writes the operator's `.env`, brings the variant up with
`tls internal`, and proves: the release step and the API connected over TLS
with the certificate verified; HTTP redirected to HTTPS, HSTS, no `Server`
header; registration, API and web sign-in, stock, shift, a sale, the
dashboard and the reconciliation through the edge over HTTPS
(`scripts/smoke-flow.mjs` trusting Caddy's root); `/api/metrics` 404 from
outside and served inside; the login rate limit counted per client address
with a client-supplied `X-Forwarded-For` ignored; the backup agent's dump
(with its binary-log position) and documents archive, both stamps exposed
by the API; the graceful stop.

## Provider steps

The exact order for a first production deployment of the variant above.
Names are the provider's (RDS / Cloud SQL / Azure Database for MySQL, a
managed Redis, a VM with an attached disk); the settings are the ones the
code depends on.

1. **Managed MySQL 8** (not MariaDB; `apps/api/prisma/MIGRATIONS.md`):
   smallest HA tier, automated backups on with the longest point-in-time
   window the plan allows, deletion protection on, private endpoint only.
   Server parameters: `log_bin_trust_function_creators=1` (the ledger
   triggers of migration `20260929090200` are created by a user without
   SUPER; binary logging is on by default on the managed tiers),
   `require_secure_transport=ON`. Create the database `dukaanai`
   (`utf8mb4`), the application user with `ALL PRIVILEGES` on it (the
   migrations create tables and triggers, so `CREATE`, `ALTER`, `DROP`,
   `INDEX`, `REFERENCES`, `TRIGGER` are needed; a managed service grants
   them with `ALL ON dukaanai.*`), and the backup user with
   `SELECT, SHOW VIEW, TRIGGER, EVENT, LOCK TABLES ON dukaanai.*` plus the
   global `RELOAD, REPLICATION CLIENT` (the dump records its binary-log
   position; where the provider withholds those two, run the agent with
   `BACKUP_COORDINATES=skip`). Download the provider's CA bundle when the
   server certificate is not signed by a public CA, place it on the host
   (`DB_CA_FILE`), and verify the connection once:
   `mysql --ssl-mode=VERIFY_IDENTITY --ssl-ca=<ca.pem> -h <host> -u dukaanai -p`.
2. **Managed Redis** 7 (the smallest instance; nothing persistent),
   private endpoint, TLS on where offered (`rediss://`), one database.
3. **The host**: a VM in the same private network as both services
   (2 vCPU / 4 GB is the measured baseline, `docs/LOAD_TEST_BASELINE.md`),
   Docker Engine with compose v2, the repository checkout (or just the two
   compose files, `deploy/`, `scripts/` and `.env`) under `/srv/dukaanai`.
   Attach a persistent disk, format and mount it at `/srv/dukaanai/data`,
   and set `STORAGE_PATH=/srv/dukaanai/data/storage`,
   `UPLOADS_PATH=/srv/dukaanai/data/uploads`,
   `BACKUPS_PATH=/srv/dukaanai/data/backups` (create the directories;
   the API runs as uid 1000 and the backup agent as the image's user, so
   `chown -R 1000:1000` the first two and `chmod 1777` the third, or keep
   the backups on a second disk). Schedule provider snapshots of the disk
   (daily, keep 14) and record the first one. Firewall: inbound 80 and 443
   from anywhere, 22 from the operator's addresses, nothing else (the API
   and web ports are not published).
4. **DNS and certificates**: A/AAAA records for `WEB_HOST` and `API_HOST`
   at the host's public address. Caddy obtains and renews the certificates
   itself (Let's Encrypt, with ZeroSSL as fallback) once both names resolve
   and ports 80/443 are reachable; nothing to install. Behind a provider
   load balancer that terminates TLS itself, the balancer holds the
   certificate, the edge keeps redirecting and forwarding, and the API
   runs with `TRUST_PROXY=2` (the balancer must be in Caddy's
   `trusted_proxies`, "The edge" below). The first deployment should show
   the certificate being obtained in `docker compose logs edge`.
5. **Secrets** (`.env`, mode 600, owned by the deploy user, in the secret
   store as well): `JWT_SECRET` and `NEXTAUTH_SECRET` from
   `openssl rand -hex 32`, `DATABASE_URL` / `DB_OPS_DATABASE_URL` /
   `REDIS_URL` from step 1 and 2, `METRICS_TOKEN`, `SMTP_URL` (production
   refuses to invite without it), `OFFSITE_REMOTE` +
   `OFFSITE_CRYPT_PASSWORD` + the backend's `RCLONE_CONFIG_<NAME>_*` for the
   off-site copies (`docs/BACKUP_RESTORE.md`), `SENTRY_DSN` when used.
6. **First deploy**: `docker compose -f docker-compose.prod.yml up --build
   -d --wait`; then `DEPLOYMENT_CHECKLIST.md` from phase 3 (probes through
   the edge, a sale, the observability checks), `db-ops status` after the
   agent's first run (a minute after boot), and the restore drill against
   a restored copy of the managed instance (`docs/BACKUP_RESTORE.md`,
   "Managed MySQL"). Record the deployed topology in `docs/DATA_SAFETY.md`
   section 2 if any path above differs from this document.
7. **Every release**: `git pull`, the redeploy line above (backup first:
   the checklist), `docker compose -f docker-compose.prod.yml ps`.

## The edge

`deploy/edge/Caddyfile` is the reference edge (roadmap 9.8), run by the
`edge` service (profile `edge` in the reference stack, always on in the
production variant):

- HTTPS for `WEB_HOST` and `API_HOST` with certificates obtained and renewed
  automatically; HTTP answered with a 308 redirect to HTTPS; HSTS
  (`max-age` two years, `includeSubDomains`); the `Server` header removed;
  zstd / gzip encoding.
- The client address goes to the upstreams in `X-Forwarded-For`. Caddy has
  no `trusted_proxies` configured, so a value a client sends is discarded
  and the API always receives the address Caddy accepted the connection
  from. The web server forwards that header on sign-in and refresh
  (`apps/web/src/lib/auth.ts`). Hence `TRUST_PROXY=1` on the API: one
  trusted hop, whether the request came straight from the edge or through
  the web. A load balancer in front of the edge that appends to
  `X-Forwarded-For` is a second hop (`TRUST_PROXY=2`) and must be named in
  `trusted_proxies` in the Caddyfile so Caddy keeps its header.
- `EDGE_MAX_BODY` (64 MB) caps request bodies above the largest upload the
  API accepts (`UPLOAD_MAX_MEDIA_BYTES`, 50 MB; the API still answers 413
  itself for anything over its own caps), and `EDGE_UPSTREAM_TIMEOUT`
  (60 s) exceeds `BILLING_GATEWAY_TIMEOUT_MS` (30 s), so a slow checkout is
  answered by the API, never cut by the edge. Keep
  `HTTP_KEEP_ALIVE_TIMEOUT_MS` above Caddy's idle timeout (it has none by
  default).
- `/api/metrics` answers 404 at the edge: the scrape endpoint exists only on
  the internal network (`api:3002`), where Prometheus reads it with
  `METRICS_TOKEN` (`docs/OBSERVABILITY.md`).
- Validate an edit with `caddy validate --config deploy/edge/Caddyfile
  --adapter caddyfile` (CI runs it with placeholder hosts).

An nginx edge would set the same things: `proxy_set_header X-Forwarded-For
$remote_addr` (never `$proxy_add_x_forwarded_for`, which keeps a client's
value), `client_max_body_size 64m`, `proxy_read_timeout 60s`, a `return
301 https://...` server on port 80, `add_header Strict-Transport-Security`,
`server_tokens off`, and `location /api/metrics { return 404; }`.

## Kubernetes

`deploy/k8s/` (README there) is the same topology as the production
variant, rendered with kustomize and validated with kubeconform in CI:
namespace, ConfigMap, a Secret generated from `dukaanai-secrets.env`, three
ReadWriteOnce claims, the migrate Job, the API Deployment (one replica,
Recreate, the probes above, 45 s grace, `backup-agent` sidecar), the web
Deployment, Services, an ingress-nginx + cert-manager Ingress (HTTPS for
both hosts, HTTP redirected, body 64m, timeouts 60 s, `/api/metrics` routed
to a Service with no endpoints) and NetworkPolicies (the API reachable from
the Ingress controller, the web and the monitoring namespace only).

## Operations

- Logs, metrics, error tracking and the alert rules: `docs/OBSERVABILITY.md`
  (`deploy/prometheus/` holds the rules and a scrape configuration;
  `docker compose --profile ops up -d prometheus` runs them against the stack).
- Backups, the binary-log archive, the documents archive, the encrypted
  off-site copy, restore to a point in time and the rehearsed drills:
  `docs/BACKUP_RESTORE.md` (`scripts/db/`, `scripts/storage/`,
  `scripts/backup/`; the `db-ops` image is `deploy/db-ops/Dockerfile`:
  `docker compose --profile ops run --rm db-ops backup` nightly,
  `db-ops binlog-archive --flush` every five minutes or `docker compose
  --profile ops up -d binlog-archiver`, `db-ops documents-backup` nightly,
  `db-ops offsite push` nightly with `OFFSITE_*` in `.env`;
  `db-ops status` shows every job's last success). Keep binary logging on (MySQL 8 default)
  with `binlog_expire_logs_seconds` above the archive interval (compose sets
  7 days). Take a backup before every `migrate deploy`; the rollback paths
  are in `apps/api/prisma/MIGRATIONS.md`. Objectives: `docs/DATA_SAFETY.md`.
- Retention: the `RetentionSweep` cron (`CRON_RETENTION_SWEEP`, 03:30 by
  default, one instance at a time under the `cron:retention-sweep` lock)
  deletes expired refresh and password-reset tokens, DONE outbox rows, old
  `SearchHistory` and `ProductEventLog` rows in bounded batches
  (`RETENTION_*`); `retention_rows_purged_total` counts what it removed.
- Reconciliation: the `Reconciliation` cron (`CRON_RECONCILIATION`, 01:30 by
  default, one instance at a time under the `cron:reconciliation` lock)
  proves every shop's previous business day to the paisa (documents against
  ledger postings, tenders, shifts, stock, account balances and the
  dashboard figure) and records a `ReconciliationRun` row; the owner reads
  it at `GET /reconciliation/latest`, runs one on demand with
  `POST /reconciliation/run`, and an operator from a checkout with
  `npm run reconcile -- --shop <id> --date <day>`. Drift is reported, never
  corrected (`docs/POS_BILLING_CONTRACT.md` §11, `docs/OBSERVABILITY.md`).
- `DEPLOYMENT_CHECKLIST.md` keeps the go-live order.
