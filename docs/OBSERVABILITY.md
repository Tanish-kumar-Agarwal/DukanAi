# Observability

Roadmap 7.6: what the API tells an operator, where it comes from, and what to
do when an alert fires. Everything here is API-side; the web app has no
telemetry of its own (its errors reach the API as requests, and the browser
console on a page failure).

## Logs

The API prints one JSON object per line (`CorrelationLogger`,
`apps/api/src/common/logger/correlation.logger.ts`) with `message`,
`context`, `level`, `timestamp` and `correlationId`. The correlation id is
the one the request carried in `x-correlation-id` (sanitised; anything
malformed becomes a UUID) and the one the client gets back in every error
envelope, so a user-reported `correlationId` finds every line of that request:

```
docker compose logs api | grep '"correlationId":"3f1c…"'
```

Lines written outside a request (crons, workers) carry `system-job`.
Sensitive keys (`password`, `token`, `authorization`, `cookie`, `secret`,
`payment`, …) are redacted before the line is written.

`LOG_LEVEL` is the most verbose level printed: `fatal`, `error`, `warn`,
`log`, `debug` or `verbose` (`LoggingConfig`). The default is `debug`
outside production and `log` in production, and production refuses to boot
with `debug` or `verbose` (`[Bootstrap FATAL] … logLevel is "debug":
production prints at most the "log" level`). `PRISMA_LOG_QUERIES` is the
separate switch for query logging and stays `false` in production.

Ship the container's stdout to whatever indexes JSON (Loki, CloudWatch,
Elastic); no file is written.

## Metrics

`GET /api/metrics` answers the Prometheus text format (prom-client). The
route needs no login (a scraper has no user) and is exempt from rate
limiting; `METRICS_ENABLED=false` answers 404 and `METRICS_TOKEN` (16+
characters, never a placeholder) makes the scrape require
`Authorization: Bearer <token>` (401 otherwise; the refused scrapes are
counted like any other answer). Keep the API port off the public internet
regardless: the scrape target is the internal address. The reference edge
(`deploy/edge/Caddyfile`) answers 404 for `/api/metrics` and the
Kubernetes Ingress routes it to a Service with no endpoints, so from the
internet the route does not exist (roadmap 9.8); Prometheus reads
`api:3002` on the compose network or `dukaanai-api.dukaanai.svc:3002`
through the NetworkPolicy's monitoring rule.
`deploy/prometheus/prometheus.yml` is the scrape configuration;
`docker compose --profile ops up -d prometheus` runs it against the compose
stack on <http://localhost:9090> (the whole monitoring stack:
`deploy/observability/compose.yml`, included by both compose files).

| Metric | Type | Labels | Meaning |
|---|---|---|---|
| `http_requests_total` | counter | `method`, `route`, `status` | every answer, guard rejections and 404s included (`httpMetricsMiddleware`, before the routers). `route` is the Express pattern (`/api/products/:id`), or `unmatched` for a path no route owns, so scanner noise is one series. |
| `http_request_duration_seconds` | histogram | `method`, `route` | request latency; p95 per route with `histogram_quantile(0.95, sum by (le, route) (rate(http_request_duration_seconds_bucket[5m])))`. |
| `checkout_duration_seconds` | histogram | `outcome` = `completed` / `replayed` / `rejected` | `BillingService.createInvoice` end to end, the one-transaction sale (contract §3). The load baseline (`docs/LOAD_TEST_BASELINE.md`) is p95 under 500 ms at 3x peak. |
| `ledger_posting_failures_total` | counter | `source` (SALE, RETURN, GRN, …) | a `LedgerPostingService.post` that threw: unbalanced entries, a lock or write failure. The surrounding transaction rolled back. |
| `outbox_oldest_pending_age_seconds` | gauge | | seconds since the oldest PENDING / CLAIMED outbox row was created, 0 when nothing waits. Refreshed on each scrape from MySQL. |
| `outbox_rows` | gauge | `status` | outbox rows by status (PENDING, CLAIMED, PROCESSING, DONE, FAILED). |
| `queue_jobs` | gauge | `queue`, `state` | BullMQ job counts per queue (waiting, active, delayed, failed) from the queue clients of this process. |
| `retention_rows_purged_total` | counter | `table` | rows removed by the retention sweep (roadmap 7.8). |
| `reconciliation_runs_total` | counter | `status` = `clean` / `drift` / `failed` | financial reconciliation runs (roadmap 9.5): the nightly cron, `POST /reconciliation/run` and the CLI alike. |
| `reconciliation_drift_total` | counter | `check` = `documents` / `postings` / `tenders` / `dashboard` / `shifts` / `stock` / `ledger` | drifts found by reconciliation runs, by check. |
| `reconciliation_shops_with_drift` | gauge | | shops whose newest reconciliation run ended in DRIFT or FAILED, read from `ReconciliationRun` on every scrape (a restart or another instance shows the same figure). |
| `reconciliation_last_run_timestamp_seconds` | gauge | | Unix time the most recent reconciliation run finished, across every shop; no series until one has run. |
- `backup_last_success_timestamp_seconds{kind}`: Unix time of the last successful backup job (`dump`, `binlog`, `documents`, `offsite`), read on every scrape from the `<kind>.last-success` files in `BACKUP_STATUS_DIR` (roadmap 9.4; written by `scripts/db/lib.sh` `record_success`). A kind whose file disappears loses its series.
| `errors_tracked_total` | counter | `kind` = `unhandled` / `prisma` / `job` / `startup` | errors handed to error tracking, counted whether or not a DSN is set. |
| `dukaanai_process_*`, `dukaanai_nodejs_*` | | | prom-client's default process and event-loop metrics. |

Every series carries `service="dukaanai-api"`. Counters and histograms are
per process: with several API instances, `sum(...)` across them; the gauges
read shared state (database, Redis) and are the same from every instance,
so take `max(...)`.

Labels stay low-cardinality on purpose: route patterns, status codes, queue
names, source types. Never add an id, a shop or a user as a label; those go
on the log line and on the tracked error.

## Error tracking

`ErrorTracking` (`apps/api/src/common/observability/error-tracking.ts`) is a
facade over `@sentry/node` that is a no-op until `SENTRY_DSN` is set (a
placeholder DSN refuses to boot, so a template value cannot silently
disable it). It is initialised in `main.ts` before anything else can fail
and captures:

- every error the `GlobalExceptionFilter` answers as 500: an unhandled
  exception, an `InternalServerErrorException` thrown on purpose, and a
  Prisma error with no mapped status (`kind` = `unhandled` / `prisma`);
- a failed bootstrap (`kind` = `startup`, flushed before `exit(1)`).

Expected 4xx/5xx answers (validation, 404, `OCR_NOT_CONFIGURED` 503, the
draining 503) are not errors and are not sent; they are visible in
`http_requests_total`. Each event is tagged with `correlationId`, `shopId`,
`route`, `method`, `statusCode` and `kind`, and the user id when a request
had one, so an issue joins the JSON log line that carries the same id.
Request bodies, headers, cookies and query strings are never sent
(`dataCollection` is switched off). `APP_RELEASE` (set it to the commit SHA
or image tag at deploy time) and `SENTRY_ENVIRONMENT` (defaults to
`NODE_ENV`) label every event; `SENTRY_TRACES_SAMPLE_RATE` stays 0 unless
performance tracing is wanted (0..1).

## Alerts

`deploy/prometheus/alerts.yml` (validated with `promtool check rules`) holds
the rules; `severity` is `critical` for the two the roadmap requires and
`warning` for the rest. Runbook:

| Alert | Fires when | First look |
|---|---|---|
| `DukaanAiApiDown` | no scrape for 2 min | `GET /api/health/ready` (503 `draining` / `unavailable` with `checks`), container logs for `[Bootstrap FATAL]`. |
| `DukaanAiHigh5xxRate` | > 1 % of answers are 5xx over 5 min, with traffic | JSON logs: `"statusCode":500` lines carry the correlation id; the error tracker has the stack. A 503 wave means readiness is failing (database / Redis down or an instance draining too long). |
| `DukaanAiUnhandledErrors` | > 5 tracked errors in 15 min | same as above when the ratio alert is quiet (low traffic). |
| `DukaanAiLedgerPostingFailures` | any posting threw in 10 min | `Unbalanced ledger posting` in the logs is a code defect (money math changed outside `@dukaanai/invoice-math`); a database error means the sale / return / receipt rolled back and the client saw an error. The ledger stayed consistent: nothing was written. |
| `DukaanAiCheckoutSlow` | completed-checkout p95 > 500 ms for 10 min | MySQL lock waits (one shop bills serially: shift, number sequence and product rows are locked in order), the MySQL slow query log, Redis latency, CPU of the instance. Re-run the load test after a fix (`apps/api/load`). |
| `DukaanAiOutboxLag` | oldest waiting outbox row > 5 min for 10 min | `CRON_ENABLED` must be true on at least one instance; the relay crons run under Redis locks (`cron:*`), so a dead pod's lock expires after its TTL. Check `queue_jobs{state="active"}` for a stuck worker and Redis. |
| `DukaanAiOutboxFailedRows` | FAILED rows for 15 min | `GET /sales/events?status=FAILED` lists them with their last error; fix the cause (a webhook target, a listener bug) and `POST /sales/events/retry` with the id. |
| `DukaanAiQueueBacklog` | > 1000 waiting jobs on a queue for 15 min | the worker is not keeping up (add an API instance: every instance runs every worker) or is crashing on every job (its errors are in the logs). |
| `DukaanAiQueueFailedJobs` | failed jobs on a queue for 30 min | the failed set in Redis holds the job data and the last error; outbox-backed jobs also marked their row FAILED (above). |
| `DukaanAiBackupStale` | a backup kind older than its objective: `binlog` 15 min, `dump` / `documents` / `offsite` 26 h, for 5 min | `db-ops status` shows every job's last success; run the late job by hand (`db-ops backup`, `binlog-archive --flush`, `documents-backup`, `offsite push`) and read its error: a full volume, a lost privilege, an unreachable remote, a wrong key. The recovery point grows while it stays red (`docs/DATA_SAFETY.md`). |
| `DukaanAiBackupNeverRecorded` | no `backup_last_success_timestamp_seconds` series for a kind, for 30 min | the job is not scheduled (cron, `binlog-archiver` service), the API cannot read `BACKUP_STATUS_DIR` (the `db-backups` volume mounted read-only), or the job writes its stamps elsewhere (`BACKUP_STATUS_DIR` on the job side). |
| `DukaanAiReconciliationDrift` | a shop's newest reconciliation run ended in DRIFT or FAILED (at once) | `GET /reconciliation/latest` as that shop's owner, or `npm run reconcile -- --shop <id> --date <day>` from a checkout: every drift names the check, the document or row and the two figures that disagree (`docs/POS_BILLING_CONTRACT.md` §11). A FAILED run carries the error. Nothing is corrected by the job; find the write that produced the row and fix the data with a recorded adjustment. |
| `DukaanAiReconciliationStale` | no reconciliation run finished anywhere for 26 h, for 30 min | `CRON_ENABLED` on at least one instance, `CRON_RECONCILIATION`, the `cron:reconciliation` lock (a dead pod's lock expires after 30 min), the `Reconciliation` lines in the logs; run one by hand with `POST /reconciliation/run`. |

## Alert delivery

Roadmap 9.10. Prometheus sends every firing rule to Alertmanager
(`deploy/observability/compose.yml`, service `alertmanager`;
`deploy/alertmanager/alertmanager.yml.tmpl` rendered by `render.sh` from
the `ALERT_*` variables of `.env`):

| Severity | Who | How | Repeat |
|---|---|---|---|
| `critical` (API down, 5xx wave, ledger failure, stale backup, drift, endpoint down) | the on-call AND the team | PagerDuty when `ALERT_PAGERDUTY_ROUTING_KEY` is set (a page), else Slack + email at once | hourly until resolved |
| `warning` (everything else) | the team | Slack and/or email | every 4 h; held between 22:00 and 08:00 and on Sunday in `ALERT_TIMEZONE`, delivered when the window ends |

While `DukaanAiApiDown` fires every warning is inhibited (one page, not a
dozen). Each channel is on when its variable is set (`ALERT_EMAIL_TO` with
`ALERT_SMTP_*`, `ALERT_SLACK_WEBHOOK_URL`, `ALERT_PAGERDUTY_ROUTING_KEY`);
with none set the service starts, logs that alerts reach nobody, and the
compose smoke still proves the routing. Validate a change with
`sh deploy/alertmanager/render.sh --out /tmp/am.yml --secrets /tmp/s &&
amtool check-config /tmp/am.yml` and read the routing with
`amtool config routes test --config.file /tmp/am.yml severity=critical`
(CI does both, in the `prom/alertmanager` image).

### On-call

The rota is kept where the pager is (the PagerDuty schedule, or this table
when Slack + email are the page):

| Week of | Primary | Phone | Backup |
|---|---|---|---|
| (filled in by the owner) | | | |

Expectations: a critical page is acknowledged within 15 minutes, day and
night; a warning is looked at the next working morning. The runbook column
of the alert table below says where to look first.

### Test the delivery (gate of row 9.10)

With the stack up and `ALERT_*` set, fire a synthetic critical alert and
confirm it reaches the on-call phone:

```
curl -fsS -X POST -H 'content-type: application/json' http://localhost:9093/api/v2/alerts \
  -d '[{"labels":{"alertname":"DukaanAiDeliveryTest","severity":"critical","job":"manual"},"annotations":{"summary":"delivery test: reply in the channel when received"}}]'
```

Alertmanager lists it under `/api/v2/alerts` with receivers `oncall` and
`team`; the page (or the Slack message and the mail) must arrive within
`group_wait` (30 s). Record the date, who received it and on which channel
in `docs/STAGING.md`. Resolve it with the same POST and `"endsAt"` in the
past, or let it expire (`resolve_timeout`, 5 min).

## Dashboards

Grafana (`docker compose --profile ops up -d grafana`,
<http://localhost:3001>, admin / `GRAFANA_ADMIN_PASSWORD`) provisions two
dashboards from `deploy/grafana/dashboards` (folder "DukaanAI", read-only in
the UI: edit the JSON in the repository):

- **DukaanAI operations** (`dukaanai-ops`): API up, 5xx ratio, checkout p95,
  outbox lag and failing probes at the top; then checkout latency
  percentiles and checkouts per minute by outcome, requests per second by
  status class, 5xx per route, latency p95 per route, tracked errors;
  outbox rows by status and queue depth by queue and state; ledger posting
  failures, reconciliation drift and age, backup age by kind, retention
  purges; the uptime probes. Every threshold matches the alert it mirrors.
- **DukaanAI logs** (`dukaanai-logs`): the log search below.

`apps/api/src/common/observability/dashboards.spec.ts` fails the unit suite
when a panel or an alert names a metric the API does not register.

## Log search

Every container's stdout is shipped to Loki by Alloy through the Docker
socket (`deploy/alloy/config.alloy`, `deploy/loki/loki.yml`; 31 days,
`docker compose --profile ops up -d loki alloy`), labelled `service`
(the compose service: `api`, `web`, `edge`, ...), `project` and
`container`. The API prints one JSON line per entry
(`{"level","pid","timestamp","message":{...,"correlationId"},"context"}`)
and, since roadmap 9.10, one access line per answer
(`context: HttpAccess`, `message.event: http`, method, path, route pattern,
status, duration, client address, correlation id; the probes and the scrape
are silent), so a correlation id a client quoted (every API answer echoes
`x-correlation-id`) always finds its request, guard rejections included.

The saved query is the "DukaanAI logs" dashboard: type the id into the
`correlationId` box. Its panels run, in LogQL:

```
{service="api"} |~ "<id>"                                      # every line mentioning it
{service="api"} |~ "<id>" | json | message_correlationId="<id>" # the API's parsed lines
{service="api"} | json | level="error"                          # unhandled and Prisma errors
```

(`| json` flattens `message.correlationId` to `message_correlationId`.) The
compose smoke sends a request with a chosen id and finds its access line
in Loki on every CI run; on staging, do the same by hand once and note the
date in `docs/STAGING.md`. A hosted store (Grafana Cloud, Datadog, ...)
replaces `loki.write` in the Alloy file and nothing else.

## Uptime checks

Two layers:

- **Inside the stack**: the blackbox exporter (`deploy/blackbox/blackbox.yml`)
  probes `GET /api/health/ready` (module `http_2xx`: 200, which means
  database and Redis up and not draining) and the login page (module
  `http_login_page`: 200 and the DukaanAI sign-in in the body) every minute
  (`deploy/prometheus/prometheus.yml`, jobs `blackbox-http` and
  `blackbox-login`). The inner targets watch the containers; add the public
  URLs through the edge (commented there) to watch what customers see.
  `DukaanAiEndpointDown` pages after two failed minutes;
  `DukaanAiCertificateExpiring` warns 14 days before a certificate lapses
  (both with promtool tests).
- **Outside**: a checker on another network, because a dead host cannot
  report itself. Set up, with the owner's account (UptimeRobot, Better
  Stack, Pingdom or the cloud provider's own): an HTTP(S) monitor on
  `https://<API_HOST>/api/health/ready` expecting 200 and the string
  `"status":"ok"`, one on `https://<WEB_HOST>/login` expecting 200 and
  `DukaanAI`, both every minute from at least two regions, alerting the
  same on-call channel (phone/SMS for the API monitor). Gate of row 9.10:
  stop the API on staging (`docker compose -f docker-compose.prod.yml stop
  api`) and confirm the checker reports the outage within two minutes and
  the recovery after `start`; record it in `docs/STAGING.md`.

## Verification

`deploy/prometheus/alerts.test.yml` is a promtool unit test: the two backup
alerts fire on stale and missing series and stay quiet on fresh ones, the
two reconciliation alerts fire on a drifted shop and on a day without a run
(roadmap 9.5), and the uptime alerts fire on a failed probe and a
certificate inside 14 days (roadmap 9.10). CI runs
`promtool test rules` with the rule check in the "Deployment (compose
smoke)" job; locally: `promtool test rules deploy/prometheus/alerts.test.yml`
from `deploy/prometheus`. The same job renders the Alertmanager template in
three configurations and checks the routing with `amtool`, and the compose
smoke brings the whole monitoring stack up: a request is found by its
correlation id in Loki, Prometheus delivers to Alertmanager and a critical
test alert is routed to `oncall` and `team`, Grafana has both data sources
and both dashboards, the two blackbox probes succeed.

- Unit: `apps/api/src/common/observability/*.spec.ts`,
  `src/common/filters/global-exception.filter.spec.ts`,
  `src/config/domains/{logging,monitoring}.config.spec.ts`.
- Integration: `apps/api/test/integration/observability.integration-spec.ts`
  (scrape format, route / status counting, checkout outcomes, outbox and
  queue gauges, the ledger counter, token and disable switches);
  `test/integration/reconciliation.integration-spec.ts` (the reconciliation
  gauges and counters before and after a corrupted row).
- Boot: `test/boot-regression.e2e-spec.ts` refuses `LOG_LEVEL=debug` and a
  placeholder `SENTRY_DSN` in production.
- Rules: `promtool check rules deploy/prometheus/alerts.yml` (CI job
  "Deployment (compose smoke)").
