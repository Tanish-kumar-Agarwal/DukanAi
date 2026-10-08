# On-call and incident runbooks (roadmap 9.22)

What to do when DukaanAI pages you. Section 1 says who does what in an
incident, section 2 how bad it is, section 3 what to tell the shops, section
4 the commands every runbook uses, section 5 has **one runbook per alert in
`deploy/prometheus/alerts.yml`** (each alert's `runbook_url` points at its
page here, and `apps/api/src/common/observability/runbooks.spec.ts` fails
when an alert has no page or a page has no alert), section 6 the review
after an incident, and section 7 the record of every runbook walked.

The alert table in `docs/OBSERVABILITY.md` is the one-line summary; the
pages here are what you follow. Related: `docs/DRILLS.md` (what each failure
looked like when it was rehearsed), `docs/BACKUP_RESTORE.md` (restores),
`RELEASE.md` (deploy and roll back), `docs/SECRETS.md` (rotations),
`docs/DATA_SAFETY.md` (recovery objectives).

## 1. Incident roles

| Role | Who by default | Does |
|---|---|---|
| **Incident lead** | the on-call primary who acknowledged the page, until they hand over | Declares the incident and its severity, decides, assigns the other roles, keeps the timeline, says when it is over. Does not type commands in a SEV1 if anyone else can. |
| **Operator** | the on-call primary (the lead's hands in a one-person rota) | Runs the runbook, says what they see before they change anything, writes every command into the incident channel. |
| **Communicator** | the on-call backup, from 15 minutes into a SEV1 | Sends the shop messages of section 3 on time, answers the shops' phones and WhatsApp, collects what shops report (which shop, which screen, which time) for the lead. |
| **Owner** | the product owner (`docs/SECRETS.md` lists the people) | Approves what cannot be undone or that the shops will notice: restoring a backup, rolling back a release with a destructive migration, a data correction in a shop's books, telling shops that data was lost, a security notice. |

In a one-person rota the primary is lead and operator, and calls the backup
for communications when a SEV1 passes 15 minutes. The incident channel is
the team's chat channel where the alerts land; one thread per incident,
named `INC <date> <alert>`.

**Lifecycle.** Page → acknowledge (critical: within 15 minutes, day and
night) → assess (section 2) → declare (thread, lead, severity) → mitigate
(the runbook) → tell the shops (section 3) → resolved (the alert has
cleared AND the runbook's verification passed) → review (section 6, within
five working days for SEV1 and SEV2).

**Rules that hold in every incident.**

- Sales are the priority: anything that keeps the POS billing correctly
  comes before diagnosis.
- Never edit a shop's books by hand in the database. Corrections go through
  the application (a stock adjustment, a repayment, a cancellation) so the
  ledger and the reconciliation see them; the ledger tables refuse updates
  anyway (immutability triggers).
- Never restore a backup over the live database. Restores go to a new
  database and are switched to (`docs/BACKUP_RESTORE.md`), with the owner's
  approval.
- Write down what you did and when, in the thread, as you do it.

## 2. Severity

| Severity | When | Examples (default severity of each alert in section 5) | Shop messages |
|---|---|---|---|
| **SEV1** | Shops cannot bill, or money or data is at risk | API down, database down, 5xx wave, expired certificate, ledger posting failures, reconciliation drift that moves money | first within 15 min, then every 30 min, and when it ends |
| **SEV2** | Billing works but something shops use does not, or a SEV1 is close | storage full (photos refused), email failing, a backup late, Redis down (jobs wait), certificate expiring within 3 days, a stuck queue that delays something shops wait for | when shops notice or ask, and when it ends |
| **SEV3** | No one is affected yet | a warning that can wait for the morning: storage low, a backup never recorded on a new stack, a queue with old failed jobs | none |

Raise the severity when shops report what the alert did not predict, or
when a SEV2 has lasted an hour. Lower it only when the runbook's
verification has passed.

## 3. Messages to shop owners

Shop owners hear from us by the channel they gave at onboarding (WhatsApp
broadcast list, SMS or email; the list is kept with the shop contacts, not
in this repository). Plain words, no internal names, always what still
works and what they should do. Fill the braces; times in IST.

**S1: investigating, billing affected**

> DukaanAI: since {time} some shops cannot complete bills; the screen asks
> to retry. We are working on it. Please keep the customer's items aside
> and press **Retry** on the bill when it asks: a retried bill is never
> charged twice. Do not enter the same sale again as a new bill. Next
> update by {time}.

**S2: investigating, billing works**

> DukaanAI: since {time} {what does not work: "saving bill photos" / "the
> dashboard figures" / "emails such as password resets"} is not working.
> Billing works normally. We are fixing it and will tell you when it is
> back. Next update by {time}.

**S3: update, with a workaround**

> DukaanAI update {time}: {what changed}. Until it is fixed: {workaround:
> "write the bill on paper with the time and the amount, and enter it in
> DukaanAI once the screen works" / "take the photo again later; nothing
> was saved"}. Next update by {time}.

**S4: resolved**

> DukaanAI: fixed at {time}. {What happened, in one sentence.} Bills made
> before and after are safe{; bills that showed an error were completed
> when you pressed Retry}. If anything looks wrong on your screen, reply to
> this message with your shop name.

**S5: planned maintenance** (a release with downtime, `RELEASE.md`)

> DukaanAI: on {date} between {time} and {time} we are updating DukaanAI.
> Billing may stop for up to {minutes} minutes in that window. Please
> finish open bills before {time}; nothing else is needed.

**S6: a correction to a shop's books** (after `DukaanAiReconciliationDrift`, owner approved)

> DukaanAI: our nightly check of your books for {date} found {what, in
> words: "one bill whose stock was not reduced"}. We corrected it on {date}
> with {"a stock adjustment" / "an entry"} that you can see under {screen}.
> Your sales and cash totals {are / are not} affected. Call us on {number}
> if you have questions.

**S7: sign in again** (after a secret rotation or a security incident, `docs/SECRETS.md`)

> DukaanAI: for your security everyone has been signed out at {time}.
> Please sign in again with your email and password. {If needed: "If you
> cannot, use 'Forgot password' on the sign-in page."} No data was {lost /
> seen by anyone else}.

Send S1 only for SEV1, S2 for SEV2 when shops will notice. One message per
step: never more than one update every 30 minutes unless something
changed.

## 4. Commands every runbook uses

Production runs `docker-compose.prod.yml` on one host (`/srv/dukaanai`,
`docs/DEPLOYMENT.md`); Kubernetes equivalents are in the second line. Set
once in your shell:

```
cd /srv/dukaanai && alias dc='docker compose -f docker-compose.prod.yml'
# Kubernetes: alias k='kubectl -n dukaanai'
```

| What | Command |
|---|---|
| State of the services | `dc ps` · `k get pods` |
| Readiness and the failing dependency | `curl -sS https://<API_HOST>/api/health/ready` (503 `{status, checks}` names it) |
| API logs, errors only, last 15 min | `dc logs --since 15m api \| grep -E '"level":"(error\|fatal)"'` · `k logs deploy/dukaanai-api --since=15m` |
| One request's log lines | Grafana › Explore › Loki: `{service="api"} \| json \| message_correlationId="<id>"` (the id is in every error answer and in the error tracker's tags) |
| Answers of one route | `{service="api"} \| json \| message_event="http" \| message_route="/api/billing/invoice"` |
| A metric | Prometheus (operator tunnel, `docs/OBSERVABILITY.md`) or the Grafana operations dashboard |
| Firing alerts and what holds them back | `curl -s http://localhost:9093/api/v2/alerts \| jq '.[] \| {alert: .labels.alertname, state: .status.state, inhibitedBy: .status.inhibitedBy}'` |
| Restart the API (graceful: drains in-flight requests) | `dc restart api` · `k rollout restart deploy/dukaanai-api` |
| Backups' last success | `dc --profile ops run --rm db-ops status` |
| Reconcile a shop's day | as the shop's owner `POST /api/reconciliation/run {"date":"YYYY-MM-DD"}`, or from a checkout with `DATABASE_URL`: `npm run reconcile -- --shop <shopId> --date <day>` |
| Deploy, roll back | `RELEASE.md` |

## 5. Runbooks

Each page: what the alert means and who is affected, the first checks in
order, the fix for each cause found, how to verify it is over, what to tell
the shops. The **Walked** line records the last rehearsal (section 7 has
the details).

### DukaanAiApiDown

**Critical · SEV1 if users see it.** Prometheus could not scrape
`/api/metrics` on an API instance for 2 minutes. Either the API process is
down, restarting in a loop or hung, or only the scrape path is broken. If
the API is really down every screen fails: the POS offers Retry (the edge
answers 502), the dashboard keeps its last figures. While this fires every
warning is held back (they appear after it clears).

**First checks**

1. From your own machine: `curl -sS -o /dev/null -w '%{http_code}\n' https://<API_HOST>/api/health`.
   200 means the API is alive and only the scrape fails: go to "Scrape path" below (SEV3).
2. `dc ps api`: running, restarting, exited? How many restarts?
3. `dc logs --since 10m api | tail -100`: a `[Bootstrap FATAL]` line names a
   refused setting; `Killed` / exit 137 is memory; nothing new means hung.
4. The host: `df -h /`, `free -m`, `docker stats --no-stream`.

**Fix**

- *Boot refused* (`[Bootstrap FATAL] ...`): the message names the setting
  (`JWT_SECRET`, `FRONTEND_URL`, `STORAGE_ROOT`, `LOG_LEVEL`...). Correct
  `.env`, `dc up -d api`. If it began with a deploy, roll back to the
  previous tag (`RELEASE.md`, "Roll back") and fix the setting before
  promoting again.
- *Killed for memory*: `dc up -d api`; find what grew (an import of a very
  large file, an export) in the last log lines before the kill; raise the
  container's memory limit if the load was legitimate.
- *Hung* (health times out, process present): `dc restart api`. Shutdown
  drains in-flight requests (`SHUTDOWN_TIMEOUT_MS`), so sales in progress
  finish or are retried by the POS.
- *Host down*: the provider's console; once the host is up `dc up -d`
  (the restart policy starts everything); the database is managed and was
  not on this host.
- *Scrape path* (API alive): `dc ps prometheus`, Prometheus › Status ›
  Targets for the scrape error. A `401` means `METRICS_TOKEN` differs
  between the API and `deploy/prometheus`'s bearer file; a timeout with
  `dependency_up` missing means a source hangs (finding 4 of
  `docs/DRILLS.md`).

**Verify.** `/api/health/ready` is 200, the alert resolved, and
`scripts/smoke-remote.sh https://<WEB_HOST> https://<API_HOST> --probes-only`
passes. Then the warnings that were held back: read each.

**Tell the shops.** S1 if billing failed for more than 5 minutes; S4 when
back.

**Walked:** not yet; planned: API stopped for 3 minutes on the drill stack (section 7).

### DukaanAiHigh5xxRate

**Critical · SEV1.** More than 1 % of API answers (health probes left out)
have been server errors for 5 minutes, with real traffic. Users see errors
on whatever routes fail: at the POS a failed bill offers Retry (safe), other
screens show their error panel.

**First checks**

1. Which answers: Grafana operations dashboard, "5xx by route"; or Loki
   `{service="api"} | json | message_event="http" | message_status >= 500`.
2. Which code: an answer with a code names its cause.
   - 503 `DATABASE_UNAVAILABLE`: the database is away; follow
     **DukaanAiDependencyDown** (it fires too after 2 minutes).
   - 507 `STORAGE_FULL`: follow **DukaanAiStorageFull**.
   - 500 without a code: a fault. Take a correlation id from the access
     log, then its error lines in Loki and its stack in the error tracker
     (Sentry, tag `correlationId`).
3. Did it start with a deploy (`dc ps` shows the image tag and its age; the
   release thread)? Did it start with a migration?

**Fix**

- *After a deploy*: roll back to the previous tag (`RELEASE.md`), then
  investigate on staging.
- *One route failing on a database error* (a missing column, a refused
  privilege, `ER_...` in the error): check the last migration ran
  (`dc run --rm migrate npx prisma migrate status`); a privilege lost on the
  managed database is restored in the provider's console.
- *A fault in code* (a stack in our source): roll back if a release
  introduced it; otherwise mitigate (a feature the shops can live without
  is avoided, the shops told by S2) and fix through a release.

**Verify.** The ratio back under 1 % for 10 minutes; a test sale on the
smoke shop; if bills failed, reconcile the affected shops' day (section 4):
CLEAN.

**Tell the shops.** S1 when billing routes fail, S2 otherwise; S4.

**Walked:** not yet; planned: a privilege removed from the API's database user on the drill stack (section 7).

### DukaanAiDependencyDown

**Critical.** Every API instance has failed to reach a dependency
(`dependency` label) for 2 minutes. `database`: SEV1, sign-in, sales and
every page answer 503 `DATABASE_UNAVAILABLE` ("please retry in a few
seconds"; the POS Retry keeps the same key, so nothing is billed twice).
`redis`: SEV2, sales continue (stock keys, cache and rate-limit counters
fall back in-process) but background work waits: outbox relays, webhooks,
imports, the dashboard cache. While this fires the readiness probe's
`DukaanAiEndpointDown` is held back, and it keeps firing for 2 minutes after
the dependency is back so the probes recover first.

**First checks**

1. `curl -sS https://<API_HOST>/api/health/ready`: which check is `down`.
2. `database`: the provider's status page and the instance's metrics
   (CPU, connections, storage, maintenance events). From the host:
   `dc run --rm db-ops sh -c 'mysql --protocol=tcp -e "select 1"'` (the
   db-ops image carries the client and the credentials).
3. `redis`: the provider's status page; from the host
   `dc exec api node -e "new (require('ioredis'))(process.env.REDIS_URL).ping().then(console.log,console.error).finally(()=>process.exit())"`.
4. Was there a credential rotation or a network change (the secrets
   register, `docs/SECRETS.md`)?

**Fix**

- *Instance stopped, failing over or in maintenance*: wait for the provider
  (a failover takes 1 to 2 minutes; the API reconnects on its own, no
  restart needed), or start it.
- *Too many connections*: the instance's connection limit against
  `connection_limit` in `DATABASE_URL` times the API instances; raise the
  instance's limit or lower the pool.
- *Credential or TLS error after a rotation*: correct `DATABASE_URL` /
  `REDIS_URL` in `.env` (the register says where the current value lives),
  `dc up -d api`.
- *Storage full on the database instance*: grow it in the provider's
  console (writes fail until then).

**Verify.** Readiness 200; the alert resolved (2 minutes after recovery);
`DukaanAiOutboxLag` does not follow (the relays catch up within minutes);
for `database`, reconcile the day of the shops that were billing (CLEAN).

**Tell the shops.** `database`: S1, then S4. `redis`: nothing unless a
shop waits on an import or a webhook.

**Walked:** not yet; planned: `mysql-stop` and `redis-stop` drills (section 7).

### DukaanAiStorageLow

**Warning · SEV3.** A volume (`volume` label: `storage` for documents under
`STORAGE_ROOT`, `uploads` for uploads in flight) has had less than 10 %
free for 15 minutes. Nothing fails yet; at 2 % documents are refused.

**First checks**

1. Which volume and how fast it fills: Grafana, `storage_volume_free_bytes`
   by volume over 7 days.
2. On the host: `dc exec api du -sh "$STORAGE_ROOT"/* | sort -h | tail`
   and the uploads volume (`/app/uploads`: `imports/`, `exports/`, `tmp/`).

**Fix**

- *Normal growth*: grow the disk (`docs/DEPLOYMENT.md`, "Production
  topology": the documents disk is a snapshotted cloud disk; grow it in the
  provider's console, then `resize2fs`).
- *Reproducible files*: import files older than a month under
  `uploads/imports` and stale exports may be removed; never delete under
  `STORAGE_ROOT` (customer documents, backups' source).

**Verify.** Free space above 10 %, the alert resolved.

**Tell the shops.** Nothing.

**Walked:** not yet; planned: `storage-full` drill (section 7).

### DukaanAiStorageFull

**Critical · SEV2.** A volume has less than 2 % free. Bill photos, invoice
PDFs and statements are refused with 507 `STORAGE_FULL` ("Nothing was
saved; try again once space has been freed"); nothing partial is kept, so
the same upload succeeds once space is back. Sales are not affected.

**First checks**

1. Which volume (`volume` label) and `df -h` on the host for its mount.
2. What filled it: `du` as in **DukaanAiStorageLow**; a sudden jump is
   usually one process (an export loop, a backup written to the wrong
   directory).

**Fix.** Free space now (reproducible files first, or stop the process that
fills it), then grow the disk as in **DukaanAiStorageLow**.

**Verify.** A bill photo stored from Smart Capture on the smoke shop; the
alert resolved; `DukaanAiHigh5xxRate` quiet (507s count as 5xx).

**Tell the shops.** S2 ("saving bill photos and documents") if it lasts
more than 15 minutes; S4.

**Walked:** not yet; planned: `storage-full` drill (section 7).

### DukaanAiUnhandledErrors

**Warning · SEV3, SEV2 if a shop reports it.** More than 5 server-side
errors reached error tracking in 15 minutes (`kind` = `unhandled` or
`prisma`). It catches faults when traffic is too low for the 5xx ratio.

**First checks**

1. The error tracker: the issues of the last 15 minutes, each with its
   `correlationId`, route, shop and user tags.
2. The same request in Loki by correlation id: what the user did before.
3. `kind=prisma`: an unmapped database error (a schema or privilege
   problem: compare with the last migration, `migrate status`).

**Fix.** As in **DukaanAiHigh5xxRate**: a release rolled back, a privilege
or migration restored, or a code fix through a release. A single shop's
data shape that trips a bug: note the shop and the route, tell the shop the
workaround (S3).

**Verify.** No new events for 15 minutes; the alert resolved.

**Tell the shops.** The affected shop only, if any.

**Walked:** not yet; planned: with **DukaanAiHigh5xxRate** (section 7).

### DukaanAiLedgerPostingFailures

**Critical · SEV1.** A ledger posting threw in the last 10 minutes
(`source` label: SALE, RETURN, CUSTOMER_PAYMENT, GRN...). The business
transaction it belonged to was rolled back: the user saw an error and
nothing was written (the ledger stays consistent). Repeated failures mean
bills, returns or payments are being refused.

**First checks**

1. Loki: `{service="api"} | json | message_context="LedgerPostingService"`
   and the error lines around it: `Unbalanced ledger posting` (a code
   defect: money computed outside `@dukaanai/invoice-math`) or a database
   error (lock wait timeout, deadlock, connection).
2. Which `source` and which shop: the error's tags in the error tracker.
3. Lock waits: `SELECT * FROM performance_schema.data_lock_waits` and
   `SHOW ENGINE INNODB STATUS` (LATEST DETECTED DEADLOCK, TRANSACTIONS) on
   the database; a transaction holding `LedgerAccountBalance` rows for
   minutes is the usual suspect.

**Fix**

- *A stuck transaction holding ledger rows* (a long-running manual session,
  a hung process): end it (`KILL <id>` from the processlist, after noting
  what it was); the POS retries succeed at once.
- *Deadlocks under load*: they are retried automatically
  (`withSerializationRetry`); persistent ones mean a new code path takes
  locks out of the canonical order (CLAUDE.md, "Lock order"): roll back the
  release that added it.
- *Unbalanced posting*: a defect; roll back the release; never post a
  correcting entry by hand.

**Verify.** No failure for 10 minutes; a test sale; reconcile the affected
shops' day: CLEAN (a failed posting wrote nothing, so CLEAN is expected).

**Tell the shops.** S1 while bills fail; S4.

**Walked:** not yet; planned: ledger rows held by a stuck session on the drill stack (section 7).

### DukaanAiCheckoutSlow

**Warning · SEV2 if cashiers notice.** The 95th percentile of completed
checkouts has been over 500 ms for 10 minutes (baseline: well under at 3x
peak, `docs/LOAD_TEST_BASELINE.md`). Cashiers wait on the Charge button.

**First checks**

1. Is it every shop or one? Grafana: checkout duration by outcome; Loki:
   `message_route="/api/billing/invoice"` answers with their `ms`, grouped
   by `message_shopId` when present.
2. Lock waits on the database (`performance_schema.data_lock_waits`): one
   shop bills serially by design (shift, number sequence and product rows
   are locked in order), so a shop with many terminals and one product in
   every bill queues on that product.
3. The database instance: CPU, IOPS, slow query log; Redis latency.
4. The API: CPU and event-loop lag (`nodejs_eventloop_lag_seconds`).

**Fix**

- *A session holding a shop's rows*: as in **DukaanAiLedgerPostingFailures**.
- *Instance saturated*: scale the database instance; check for a report or
  an import running at the same time (imports are background jobs but use
  the same database).
- *After a release*: compare with the previous tag on staging (the load
  test, `apps/api/load`); roll back if it regressed.

**Verify.** p95 under 500 ms for 10 minutes.

**Tell the shops.** Only the shops that called.

**Walked:** not yet; planned: product rows held in turns during checkouts on the drill stack (section 7).

### DukaanAiOutboxLag

**Warning · SEV2 when it delays what shops see.** The oldest outbox row
waiting to be relayed is more than 5 minutes old, for 10 minutes. Sales are
unaffected; what follows a sale waits: low-stock notifications, dashboard
cache invalidation by the event, webhooks to the shop's integrations,
purchase events.

**First checks**

1. The relays run on a schedule under Redis locks. `CRON_ENABLED` must be
   true on at least one instance (`dc exec api printenv CRON_ENABLED`).
2. A lock held by a dead instance: in Redis, `TTL cron:outbox-reaper` (and
   the other `cron:*` keys); a dead pod's lock expires after its TTL.
3. The workers: Grafana `queue_jobs{state="active"}` per queue; worker
   errors in the logs (`SystemEventsProcessor`, `ProductOutboxWorker`).
4. Redis reachable (`DukaanAiDependencyDown` would say so).

**Fix**

- *Schedules off*: set `CRON_ENABLED=true` on one instance, `dc up -d api`.
- *Lock of a dead instance*: wait for its TTL, or delete the key once you
  are sure no instance holds it (`DEL cron:<name>`).
- *Worker failing every job*: its error in the logs; a code defect is
  rolled back; a webhook target that refuses is **DukaanAiOutboxFailedRows**.

**Verify.** `outbox_oldest_pending_age_seconds` back under a minute; the
alert resolved.

**Tell the shops.** Nothing unless a shop's integration depends on webhooks.

**Walked:** not yet; planned: a relay lock held as by a dead instance on the drill stack (section 7).

### DukaanAiOutboxFailedRows

**Warning · SEV3.** Outbox rows exhausted their retries
(`EVENTS_OUTBOX_MAX_RETRIES`) and are FAILED. Each carries its last error.
What they would have triggered (a webhook, a notification) did not happen.

**First checks**

1. As a manager of the shop: `GET /api/sales/events?status=FAILED` lists the
   shop's failed rows with their error and event type. Across shops (on the
   database, read only): `SELECT shopId, eventType, error, updatedAt FROM
   OutboxEvent WHERE status='FAILED' ORDER BY updatedAt DESC LIMIT 20`.
2. The error says why: a webhook target that refuses or is not public (the
   SSRF guard), a listener defect, a removed product.

**Fix.** Fix the cause first (the shop corrects its webhook URL, a defect
is fixed), then re-queue each row as a manager of its shop:
`POST /api/sales/events/retry {"id":"<outboxEventId>"}` (409
`OUTBOX_EVENT_NOT_FAILED` when it is not FAILED any more). A row whose
event no longer matters is left FAILED (retention keeps FAILED rows).

**Verify.** `outbox_rows{status="FAILED"}` back to 0 (or only the rows you
chose to leave); the alert resolved.

**Tell the shops.** The shop whose integration missed events, with the
time range.

**Walked:** not yet; planned: a failed row re-queued through the route on the drill stack (section 7).

### DukaanAiBackupStale

**Critical · SEV2.** A backup job has not succeeded in time (`kind`:
`binlog` 15 minutes, `dump`, `documents` and `offsite` 26 hours). Nothing
fails for users, but the recovery point grows (`docs/DATA_SAFETY.md`): a
database loss now would lose more than the promised 5 minutes.

**First checks**

1. `dc --profile ops run --rm db-ops status`: every job's last success.
2. The job's own log: `dc logs --since 2h binlog-archiver` /
   `backup-agent`; on Kubernetes the `backup-agent` sidecar.
3. The usual causes: the backups volume full (`df -h` on it), a privilege
   lost by the backup user (RELOAD, REPLICATION CLIENT / SLAVE), the
   off-site remote unreachable or its key wrong, the agent not running.

**Fix.** Correct the cause, then run the late job by hand and read its
output: `dc --profile ops run --rm db-ops binlog-archive --flush`,
`... db-ops backup`, `... db-ops documents-backup`, `... db-ops offsite push`.
Each success stamps the status directory the metric reads.

**Verify.** `db-ops status` shows a fresh success for the kind; the alert
resolved within a scrape.

**Tell the shops.** Nothing.

**Walked:** not yet; planned: the binlog archiver stopped on the drill stack (section 7).

### DukaanAiBackupNeverRecorded

**Warning · SEV3.** There is no `backup_last_success_timestamp_seconds`
series for a backup kind, for 30 minutes: as far as monitoring knows, that
job has never succeeded. On a new stack it fires until the first nightly
run; on a running stack it means the job, or the stamp, is gone.

**First checks**

1. `dc --profile ops run --rm db-ops status`: is the kind listed?
2. Is the job scheduled (the `binlog-archiver` service, the `backup-agent`,
   or host cron)?
3. Can the API read the stamps? `BACKUP_STATUS_DIR` on the API and the
   jobs must name the same directory, and the `db-backups` volume is
   mounted into the API read-only (`dc exec api ls -l "$BACKUP_STATUS_DIR"`).

**Fix.** Schedule the job, or align `BACKUP_STATUS_DIR` / the mount, then
run the job once by hand (as in **DukaanAiBackupStale**).

**Verify.** The series exists (Prometheus:
`backup_last_success_timestamp_seconds`); the alert resolved.

**Tell the shops.** Nothing.

**Walked:** not yet; planned: the off-site stamp removed on the drill stack (section 7).

### DukaanAiReconciliationDrift

**Critical · SEV1 when money moved, else SEV2.** A shop's newest
reconciliation run (nightly, or run by hand) ended in DRIFT or FAILED: its
documents, ledger, tenders, stock or shifts disagree somewhere. The job
never corrects anything.

**First checks**

1. Which shops: on the database, read only:
   `SELECT shopId, businessDate, status, driftCount FROM ReconciliationRun
   ORDER BY createdAt DESC LIMIT 20`, or the shop's owner reads
   `GET /api/reconciliation/latest`.
2. Read the run: every drift names its check (`documents`, `postings`,
   `tenders`, `dashboard`, `shifts`, `stock`, `ledger`), the document or
   row, and the expected and actual figures (contract §11). A FAILED run
   carries the error.
3. Find the write that produced the row: the document's audit rows
   (`AuditLog` by `entityId`), its correlation id in Loki, what else
   happened to it that day (a return, a cancellation, an adjustment).

**Fix**

- *A FAILED run* (the engine threw: database away during the run, a
  timeout): run it again (`POST /api/reconciliation/run {"date":...}`);
  CLEAN closes it.
- *A real drift*: the owner decides the correction; it is made in the
  application (a stock adjustment, a cancellation and re-bill, a repayment)
  with a note that names the run, never in the database. If a code defect
  wrote the bad row, the defect is fixed first (a release) so it does not
  happen again.
- *Many shops drift the same way overnight*: a defect in a release; roll
  back and reconcile again after the fix.

**Verify.** The shop's day reconciles CLEAN after the correction; the alert
resolved (it reads the latest run per shop).

**Tell the shops.** S6 to the shop whose books were corrected, after the
owner approves the text.

**Walked:** not yet; planned: a product's stock changed behind the ledger on the drill stack (section 7).

### DukaanAiReconciliationStale

**Warning · SEV3.** No reconciliation run has finished anywhere for 26
hours: the nightly job is not running. Drift, if any, goes unseen.

**First checks**

1. `CRON_ENABLED` on at least one instance; `CRON_RECONCILIATION` (default
   nightly) valid.
2. The `cron:reconciliation` lock in Redis (`TTL cron:reconciliation`): a
   dead instance's lock expires after 30 minutes.
3. The `Reconciliation` lines in the logs of the last night: started,
   failed before writing a run, never started.

**Fix.** Re-enable the schedule or clear the dead lock as in
**DukaanAiOutboxLag**; then run one by hand for yesterday:
`POST /api/reconciliation/run {"date":"<yesterday>"}` as an owner, or the
CLI per shop.

**Verify.** A run row with today's `createdAt`; the alert resolved.

**Tell the shops.** Nothing.

**Walked:** not yet; planned: the newest run made 27 hours old on the drill stack (section 7).

### DukaanAiQueueBacklog

**Warning · SEV2 when shops wait.** More than 1,000 jobs have waited on a
BullMQ queue (`queue` label) for 15 minutes: its worker is not keeping up
or not running. Depending on the queue: imports wait (`import-job`),
webhooks are late (`webhook-delivery`), notifications and cache
invalidation wait (`system-events`), images are not processed
(`media-processing`).

**First checks**

1. Grafana `queue_jobs` by queue and state: waiting growing, active 0
   (worker stopped) or active steady (worker slow)?
2. The worker's errors in the logs; a worker that fails every job also
   fills the failed set (**DukaanAiQueueFailedJobs**).
3. Redis memory and latency.

**Fix**

- *Worker not running*: every API instance runs every worker; restart the
  API (`dc restart api`). A queue paused by hand is resumed from a shell on
  the API container (BullMQ `queue.resume()`).
- *Worker slow*: add an API instance only after the documents move to
  object storage (one replica until then, `docs/DEPLOYMENT.md`); meanwhile
  find the slow job (a huge import) and let it finish.

**Verify.** Waiting back under 1,000 and falling; the alert resolved.

**Tell the shops.** A shop waiting on an import: S2.

**Walked:** not yet; planned: a paused queue with 1,200 waiting jobs on the drill stack (section 7).

### DukaanAiQueueFailedJobs

**Warning · SEV3.** A queue holds jobs that failed every attempt, for 30
minutes. Each kept its data and its last error in Redis; outbox-backed jobs
also marked their outbox row FAILED.

**First checks**

1. The failed set: from the API container
   `node -e "const {Queue}=require('bullmq');const q=new Queue('<queue>',{connection:{url:process.env.REDIS_URL}});q.getFailed(0,9).then(j=>{console.log(j.map(x=>({id:x.id,name:x.name,reason:x.failedReason})));process.exit()})"`.
2. The reason: a job for a removed document (harmless), a defect, a
   dependency that was away.

**Fix.** Fix the cause, then retry the jobs that still matter
(`job.retry()` from the same shell) or remove the ones that do not
(`job.remove()`). An import job that failed is simply uploaded again (it is
idempotent).

**Verify.** `queue_jobs{state="failed"}` back to 0 for the queue; the alert
resolved.

**Tell the shops.** Nothing, unless an import of theirs failed.

**Walked:** not yet; planned: a failing job on the import queue on the drill stack (section 7).

### DukaanAiCredentialFlood

**Warning · SEV2 if real users are locked out.** The credential routes
(`/api/auth/*`) have refused more than one attempt every 10 seconds with
429 for 10 minutes: a brute-force or credential-stuffing run. The limits
are holding (`docs/PRODUCTION_LIMITS.md`); the risk is a real user locked
out of their account for the lockout window.

**First checks**

1. The access log: `{service="api"} | json | message_event="http" |
   message_status=429 | message_route=~"/api/auth/.*"`: the source
   addresses (`message_ip`) and the routes.
2. One address or many? Many addresses against one account means the
   per-account throttle and the lockout are doing the work: check that
   account's owner is not locked out (`User.isLocked`, `lockedUntil`).
3. Is the address the shop's own (a misconfigured integration retrying)?

**Fix**

- *One or a few addresses*: block them at the edge (Caddy `remote_ip`
  matcher, or the provider's firewall) for 24 hours; record them.
- *A distributed run*: leave the limits to work; if a real owner is locked
  out, they reset their password (the lock ends on its own after
  `SECURITY_LOCKOUT_DURATION_MS`).
- *A shop's integration*: tell the shop to fix its credentials.

**Verify.** The 429 rate falls under the threshold for 10 minutes.

**Tell the shops.** The account's owner if their account was targeted
(S7's wording when a password reset is advised).

**Walked:** not yet; planned: 12 minutes of wrong passwords from one address on the drill stack (section 7).

### DukaanAiEmailDeliveryFailing

**Warning · SEV2.** The mail relay refused or could not take a message of
a `purpose` (invitation, password reset, password changed) in the last 30
minutes. Invitations answered the owner 502 `INVITATION_EMAIL_FAILED` (and
kept nothing, so they can repeat it); a reset link was voided while the
user was told it had been sent: sign-in recovery is broken until this is
fixed.

**First checks**

1. The API log line `was not accepted by the relay` carries the relay's
   reply: `535` credentials, `550`/`553` sender or recipient refused,
   `ECONNECTION`/`ETIMEDOUT` relay unreachable, a quota message.
2. The provider's dashboard: quota, suspension, the sending domain's
   SPF/DKIM status.

**Fix.** Correct `SMTP_URL` (credentials rotated, `docs/SECRETS.md`) or
`EMAIL_FROM` (a verified sender), restart the API; ask the provider to lift
a suspension. Then send an invitation to yourself from the smoke shop.

**Verify.** Your invitation arrives; no failure for 30 minutes; the alert
resolved.

**Tell the shops.** Users who asked for a reset meanwhile request it again
(the shops that called).

**Walked:** not yet; planned: the API pointed at a relay that refuses mail on the drill stack (section 7).

### DukaanAiEndpointDown

**Critical · SEV1.** A blackbox probe has failed for 2 minutes: the
readiness route (`/api/health/ready`) or the login page, through the edge
or inside. It is what a shop sees from outside. Held back while
`DukaanAiApiDown` fires, while `DukaanAiDependencyDown` fires (readiness
probes), and while `DukaanAiCertificateExpired` fires for the same address.

**First checks**

1. Which probe (`instance`, `job`): readiness or login page, edge or
   internal.
2. Readiness failing: `curl -sS https://<API_HOST>/api/health/ready` names
   the dependency (then its runbook); `draining` means a shutdown is in
   progress.
3. Login page failing: the web container (`dc ps web`, `dc logs --since
   10m web`).
4. Only the edge address failing: the edge (`dc logs --since 10m edge`),
   DNS (`dig +short <WEB_HOST>`), and the certificate: `curl -vI
   https://<WEB_HOST>` (a wrong name, an incomplete chain, an unknown
   issuer fail the probe without expiring).

**Fix.** By cause: the dependency's runbook; restart the web
(`dc restart web`); the edge configuration (`caddy validate`, then
`dc restart edge`); DNS at the registrar; a certificate as in
**DukaanAiCertificateExpired**.

**Verify.** The probe succeeds for 2 minutes; the alert resolved; the login
page loads in a browser.

**Tell the shops.** S1 when the public address is down; S4.

**Walked:** not yet; planned: `api-kill` and the web stopped on the drill stack (section 7).

### DukaanAiCertificateExpiring

**Warning · SEV3, SEV2 under 3 days.** The certificate of a public address
expires in under 14 days and has done so for an hour: automatic renewal
has not happened. When it lapses, every browser refuses the address.

**First checks**

1. `echo | openssl s_client -connect <HOST>:443 -servername <HOST> 2>/dev/null | openssl x509 -noout -dates -issuer`.
2. Caddy: `dc logs --since 24h edge | grep -iE 'certificate|acme|challenge'`;
   ports 80 and 443 must reach the edge from the internet, and the DNS
   names must point at it. Kubernetes: `k describe certificate`, the
   cert-manager logs.

**Fix.** Correct what blocks the challenge (firewall, DNS), then
`dc restart edge` (Caddy retries at start); on Kubernetes delete the
failing `CertificateRequest` so cert-manager retries.

**Verify.** The new certificate's dates; the alert resolved within an hour.

**Tell the shops.** Nothing.

**Walked:** not yet; planned: `tls-expiry` drill (near-expiry stage) (section 7).

### DukaanAiCertificateExpired

**Critical · SEV1.** The certificate of a public address has expired: every
browser refuses it (with HSTS there is no way past the warning) and every
client call fails. The probes of the same address are held back while this
fires; it keeps firing for 2 minutes after a renewal is read.

**First checks.** As in **DukaanAiCertificateExpiring**: the dates, the
edge's ACME log, ports, DNS.

**Fix.** Renew now: correct what blocks the challenge and restart the edge.
If the ACME issuer cannot issue quickly (rate limits), install a
certificate from another issuer as a file (`EDGE_TLS_LINE="tls
/etc/caddy/certs/<host>.crt /etc/caddy/certs/<host>.key"`, `dc up -d
edge`) and return to automatic renewal afterwards.

**Verify.** `curl -sSI https://<WEB_HOST>` succeeds; the POS loads; the
alert resolved and its address's probes recovered.

**Tell the shops.** S1 (the app does not open), S4.

**Walked:** not yet; planned: `tls-expiry` drill (section 7).

## 6. Post-incident review

Within five working days of every SEV1 and SEV2, and of every drill that
found something, the lead writes the review as
`docs/incidents/<YYYY-MM-DD>-<alert-or-slug>.md` from this template and the
team reads it together. Blameless: the review asks what made the mistake
possible, never who.

```markdown
# <YYYY-MM-DD> <one-line title>

| | |
|---|---|
| Severity | SEV1 / SEV2 |
| Duration | <first user impact> to <resolved>, <minutes> min (IST) |
| Shops affected | <how many, which> |
| Detected by | <alert name, or a shop's call> at <time>; page acknowledged at <time> |
| Time from page to the first correct action | <minutes> (the runbook's own measure) |
| Lead / operator / communicator | <names> |

## What the shops saw
<In their words: which screens, which errors, for how long. Bills affected:
none lost / <n> retried / <n> on paper and entered later.>

## Timeline (IST)
| Time | What happened / what we did |
|---|---|

## Cause
<What broke, and why it could: keep asking "why" until the answer is
something we can change.>

## What went well
## What went badly
## Where we were lucky

## Data
<Reconciliation of the affected shops' days: CLEAN / DRIFT and the
corrections made (with the owner's approval and the S6 message sent).>

## Actions
| Action | Owner | Due | Done |
|---|---|---|---|
<Each action prevents a recurrence, detects it sooner, or shortens the
recovery. Runbook changes are actions too.>

## Messages sent to the shops
<The S1 to S7 messages as sent, with their times.>
```

The runbook of every alert that fired gets its **Walked** line and its row
in section 7 updated with the date and the time from the page to the first
correct action.

## 7. Runbooks walked

Row 9.22's gate: each runbook walked once during the drills of row 9.18.
The walks below ran on the production-shaped drill stack
(`scripts/drills/drill-stack.sh`: MySQL 8, Redis, the API and web images,
the TLS edge, Prometheus, Alertmanager and the blackbox exporter). The six
drills of `docs/DRILLS.md` fire seven of the alerts; the other fourteen
have no drill of their own, so their condition was produced on the same
stack by a fault injection (the column says which), and the runbook was
followed from the page as written. "Page to first correct action" is the
time from the alert firing to the first step of the runbook that led to
the fix; "fixed" is the alert resolving after that fix.

| Alert | How it was produced | Fired | Page to first correct action | Fixed | What the walk changed |
|---|---|---|---|---|---|
| _filled in by the walks below_ | | | | | |

The staging runs of `docs/DRILLS.md` §6 repeat these walks with the
on-call's phone and the real paging channel; their dates go into the
**Walked** line of each page.
