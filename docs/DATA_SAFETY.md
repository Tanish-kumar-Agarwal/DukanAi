# Data safety: recovery objectives and the state of every copy

Roadmap 9.1. This document is the authority on what must survive, how much
may be lost, how fast service must be back, and what protects each store
today. The procedures live next to it (`docs/BACKUP_RESTORE.md`,
`docs/DEPLOYMENT.md`, `apps/api/prisma/MIGRATIONS.md`); this file says what
they must achieve and where they still fall short. It is reviewed at every
change to a data store, a backup script or a schedule, and at the release
that closes each gap listed in section 5.

Terms: **RPO** (recovery point objective) is the most data, measured in time,
that an incident may lose. **RTO** (recovery time objective) is the longest
the service may be unavailable while it is restored. Both are commitments
for production; staging gets the same mechanisms but no commitment.

## 1. Objectives

| Data class | RPO | RTO | Meaning for a shop |
|---|---|---|---|
| Database: every business record | 5 minutes | 1 hour | A crash at 17:00 loses at most the sales of the last five minutes; billing is back within the hour. |
| Documents: billing evidence, captured bills, statements, customer files, product images | 24 hours | 4 hours | A document captured yesterday survives; one captured minutes before the incident may have to be re-captured. |
| Secrets | 0 (never lost) | 15 minutes | Rotating a lost secret ends sessions, never data. |
| Redis: cache, counters, locks, queued jobs | no commitment | restart | Rebuilt from the database and the outbox; nothing a shop entered lives only there. |
| Code, migrations, images | 0 | redeploy | Git and the image registry hold every release. |

The database objective is stricter than the documents' because a sale exists
only as database rows (`Invoice`, `InvoiceItem`, ledger postings, stock
movements); the evidence files are copies of what the database already
proves. Section 5 states which objectives are met today and which rows of the
roadmap close the rest; until a row is closed, the figure in section 2 is
the real one.

## 2. Data inventory: where each store lives, what it holds, what protects it

The reference deployment is `docker-compose.yml` (volumes in brackets); a
managed deployment maps each store to the provider's equivalent
(`docs/DEPLOYMENT.md`).

| Store | What lives there | Protection today | Real RPO today | Objective |
|---|---|---|---|---|
| MySQL 8, `DATABASE_URL` [`mysql-data`] | All 230 Prisma models: shops, users and sessions (`RefreshToken`), products, stock (`InventoryItem`, ledger rows), invoices, returns, customers, udhar, payments, shifts, expenses, suppliers, procurement, the immutable ledger, outbox, audit log, notifications. Every row carries its `shopId`. | `scripts/db/backup.sh` (consistent InnoDB snapshot that records its binary-log position; `.sha256` and `.meta` sidecars; keep 14) nightly, `binlog-archive.sh --flush` every five minutes copying the closed binary logs next to the dumps, both run by the `db-ops` service (or the `binlog-archiver` service for the archive) into the `db-backups` volume on the same host; `restore.sh --to` rolls a dump forward to any second the archive covers; `restore-drill.sh --pitr require` proves the chain on every CI push and the compose smoke proves a sale made after a dump survives the roll-forward. | the archive interval, 5 minutes, where the archiver runs; the dump interval where only the dump runs | 5 minutes |
| Documents, `STORAGE_ROOT` [`api-storage`] | Per shop: `Customers/<customerId>/{Invoices,Bills,Statements,Profile,…}` (evidence written once with the `wx` flag and never replaced; a delete moves the file to `Deleted/`), `System/customer_index.json` and `invoice_registry.json` (indexes derived from the files), `Logs/` (the storage action log), `Backups/<type>/backup_<date>.zip` (the zip `POST /storage/backup` makes of the shop's own folders: it lands on the same volume, so it is an export, not a backup). | A manual copy of the volume (`docs/BACKUP_RESTORE.md`, "What else to back up"): no schedule, no checksum, no restore test. | undefined (whenever someone last copied it) | 24 hours |
| Uploads [`api-uploads`, `apps/api/uploads`] | `media/`: product images and thumbnails; `MediaStorage.cdnUrl` and `MediaThumbnail.cdnUrl` point at them. `imports/`, `exports/`: import and export files. `tmp/` (`UPLOAD_TEMP_DIR`): upload staging, never older than a request. | None. A lost volume leaves `cdnUrl` rows pointing at nothing. | undefined | 24 hours for `media/`; `imports/`, `exports/` and `tmp/` are reproducible and excluded |
| Redis, `REDIS_URL` [`redis-data`, append-only] | Cache (`cache:*`), rate-limit counters, cron locks, BullMQ jobs, advisory stock keys, the search-history budget. | None, by design. Append-only mode lets queued jobs survive a restart. | not applicable | none |
| Secrets | `JWT_SECRET`, `NEXTAUTH_SECRET`, the database and Redis passwords, `SMTP_URL`, `GOOGLE_CLIENT_SECRET`, `GEMINI_API_KEY`, `METRICS_TOKEN`, `SENTRY_DSN`, the `S3_*` keys. | The deployment's secret store or the host's `.env`; never inside a dump (`backup.sh` dumps data only). | not applicable | none |
| Browser | The POS cart (per tab and per shop in `sessionStorage`), the theme, a captured frame handed to the AI scanner. | None. A sale exists only once `POST /billing/invoice` has answered; an unsent cart is lost with the tab by design. | not applicable | none |
| Operational | JSON logs on stdout, Prometheus samples [`prometheus-data`], error tracking. | None; no customer data. | not applicable | none |
| Code and images | The repository, migrations, the two images. | GitHub and the image registry. | none | none |

What a Redis loss costs, precisely: caches rebuild on the next read, counters
and locks expire, and a job that was running is lost; the outbox row it had
claimed returns to PENDING after `EVENTS_OUTBOX_STALE_CLAIM_MS` (5 minutes)
through the reaper and is delivered again. Sessions are unaffected: refresh
tokens live in MySQL.

MySQL 8 writes a binary log by default; the compose server keeps seven days
of it (`binlog_expire_logs_seconds=604800`) and the archive is the long
memory. Every dump records the position it was taken at, so it rolls forward
to any second the archive covers (`docs/BACKUP_RESTORE.md`, "Binary-log
archive" and "Restore"). On a managed MySQL the provider's point-in-time
recovery replaces the archive; its settings and the drill against it are in
the same document and wait for the account.

## 3. What keeps the application itself from losing data

Backups answer disasters. These rules, all enforced in code and tests,
answer the everyday way data disappears: a bug or a user action.

- Business records are never hard-deleted: products, customers, suppliers,
  categories, locations and the procurement documents soft-delete with
  `isDeleted` and the `deletedToken` unique keys; `DELETE /shops` sets
  `status = DELETED` and keeps every row; returns and cancellations are new
  documents that reverse a sale, never an update of it.
- The ledger is immutable at the database (`prevent_ledger_update`,
  `prevent_ledger_delete` triggers, migration `20261003090100`); not even a
  test can change a posted row.
- Billing evidence is written once: a repeat answers 409
  `STORAGE_EVIDENCE_EXISTS` and nothing is replaced or partially written; a
  delete is a move into `Deleted/`.
- The retention sweep deletes only expired refresh and password-reset tokens
  (`RETENTION_EXPIRED_TOKENS_DAYS`, 7), DONE outbox rows (14 days), search
  history (90) and product event logs (180): never a business record.
- A migration never deletes rows on its own; a destructive change ships as
  expand then contract across two releases, and the pre-release backup is
  the step before `migrate deploy` (`DEPLOYMENT_CHECKLIST.md`).
- Every write is one transaction with a canonical lock order and the
  checkpoint fault-injection suite proves that a failure inside a sale,
  return, cancellation or repayment leaves nothing partial
  (`pos-failure-injection`).

## 4. Restore: who, how, how long

**Who.** Today the repository owner is the operator for every restore and
the only person who may order one; the on-call rota and the incident roles
are row 9.22. A restore needs database root (`CREATE DATABASE`), the host or
cluster access to stop and start the API, and the secret store.

**How.** `docs/BACKUP_RESTORE.md`, "Restore": stop the API; restore the
dump into a fresh database; if the dump is from an older release, run the
release step `prisma migrate deploy` on it; verify (`migrate status` up to
date, `migrate diff` clean, row counts, ledger triggers present: exactly what
`restore-drill.sh` automates); point `DATABASE_URL` at it; start the API;
readiness 200; sign in; dashboard loads; the outbox drains. Documents: copy
the archive back onto the volume, compare checksums, remount. A release
rollback that needs data back is the same procedure
(`apps/api/prisma/MIGRATIONS.md`, "Rolling back a release").

**How long, measured.** On this revision, local MySQL 8.0.46 (the production
engine), MySQL 8 clients, one CPU-constrained container:

| Step | Measured | Data |
|---|---|---|
| Dump + checksum | 5 s | `dukaanai_integ8`: 231 tables, 277,812 rows, 192 MB on disk, 14 MB compressed |
| Restore into a fresh database | 20 s | same dump, 2 triggers, 21 migrations |
| Release step on a dump five migrations old | 6 s | `prisma migrate deploy`, `20261003090000` to `20261004120000` |
| Full drill (dump, restore, status, diff, counts, triggers) | 49 s | `scripts/db/restore-drill.sh` |
| Documents: tar + checksum, untar + verify | 1.7 s + 0.1 s | the local storage root: 78 files, every checksum identical |
| Point in time: markers, archive of every closed log, dump restored and rolled forward to the target second | 110 s for the whole drill; restore 15 s, replay under 1 s | `restore-drill.sh --pitr require`: 29 logs (about 560 MB) archived, the write before the target time kept, the write after it excluded, 231 tables equal |

A first drill against the same database refused at the status step because
the source was five migrations behind the repository; after `migrate deploy`
it passed. That is the older-release case of the runbook and the reason the
drill checks it.

The restore itself is a small part of the hour. Budget for the database
objective:

| Phase | Budget | What bounds it today |
|---|---|---|
| Detect | 10 min | `DukaanAiApiDown` fires after 2 minutes without a scrape; readiness answers 503 while the database is down. No alert yet says a *backup* is missing (row 9.4). |
| Decide and reach the host | 10 min | one operator today; the rota is row 9.22 |
| Restore | 15 min | measured above; the dump restores at roughly 0.7 MB/s of compressed dump, and one shop's year of billing is a few megabytes |
| Verify | 10 min | `restore-drill.sh` steps 3 to 6, sign-in, a test sale |
| Switch and warm | 5 min | `DATABASE_URL`, start, caches rebuild |
| Reserve | 10 min | |

Documents (4 hours): detect, fetch the archive from the off-site copy (up to
1 hour at consumer bandwidth), untar and verify checksums, remount, with the
rest in reserve. Both budgets are rehearsed in the failure drills of row 9.18
and the measured times recorded here are replaced by the staging figures
then.

## 5. Gaps against the objectives and what closes them

| Gap | Today | Objective | Closed by |
|---|---|---|---|
| Database recovery point | self-hosted: the archive interval, 5 minutes, with the `binlog-archiver` service or the cron line running (in place since this revision); managed: the provider's point-in-time recovery, to switch on when the instance exists | 5 minutes | 9.2: done for the self-hosted path; the provider settings and the provider drill wait for the account |
| Copies on the database host only, unencrypted | `db-backups` volume next to `mysql-data`; a manual copy off the host | off-site, encrypted, in another account | 9.4 |
| Nobody is told when a backup is missing or old | no backup metric, no alert | `DukaanAiBackupStale` on `backup_last_success_timestamp` | 9.4 |
| Documents and product images | a manual copy, unscheduled, unverified; `media/` not covered at all | scheduled, checksummed, restore-drilled, incl. `uploads/media` | 9.3 |
| A restored day's books are not proven to agree | the drill compares row counts | reconciliation of invoices, ledger, tenders, stock and dashboard to the paisa | 9.5 |
| One operator, no rota, no rehearsed incident flow | the repository owner | on-call rota, runbook per alert, drills | 9.18, 9.22 |
| Secrets never rotated | in the store, untested rotation | every secret rotated once on staging | 9.11 |

### Interim measures, in force until the rows above close

They cost nothing and shrink the exposure now:

1. Run the binary-log archive every five minutes next to the nightly dump
   (`docs/BACKUP_RESTORE.md`, "Backup"):

   ```
   0 2 * * *    cd /srv/dukaanai && docker compose --profile ops run --rm db-ops backup
   */5 * * * *  cd /srv/dukaanai && docker compose --profile ops run --rm db-ops binlog-archive --flush
   docker compose --profile ops up -d binlog-archiver     # the */5 line as a service, without cron
   ```

   Real database recovery point: five minutes. Where the archive cannot run
   (a backup user without REPLICATION SLAVE and RELOAD), dump hourly into
   its own directory instead (`--out /backups/hourly --keep 48`; pruning is
   per directory and per database name, so the two schedules never prune
   each other): one hour instead of twenty-four.
2. After the nightly dump, copy the `db-backups` volume and a tar of the
   `api-storage` and `api-uploads/media` volumes off the host (the commands
   in `docs/BACKUP_RESTORE.md`), and keep the copy in a different account
   than the server.
3. Once a week, restore the newest off-host copy on a scratch server with
   `restore-drill.sh`: CI's drill proves the scripts on CI's data, not your
   backup files.
4. Before every `migrate deploy`: the labelled pre-release backup
   (`DEPLOYMENT_CHECKLIST.md`, phase 2).

## 6. Decisions

- Production runs on a managed MySQL 8 service with high availability,
  automated backups and point-in-time recovery, deletion protection and a
  private endpoint (the roadmap discussion of 2026-10-04); the self-hosted
  binary-log path of row 9.2 is the fallback only.
- Documents stay files under `STORAGE_ROOT` on a persistent volume with
  snapshots for a single API replica; object storage behind
  `StoragePathBuilder` is the path to several replicas (row 9.7 decides).
- `uploads/media` is customer data (product images) and joins the documents
  objective; `uploads/imports`, `exports` and `tmp` are reproducible and are
  not backed up.
- The in-app zip (`POST /storage/backup`) is a per-shop export for row 9.24,
  not part of the recovery design.
- Redis is disposable. No backup is taken and none is restored.
- Point-in-time recovery is the provider's on a managed MySQL and the
  binary-log archive on a VM; a dump always records its position so either
  path can start from it.

## 7. Sign-off

Row 9.1 is complete when the owner has signed the objectives in section 1
and the decisions in section 6.

| Role | Name | Date | Signed |
|---|---|---|---|
| Owner | shoryabansalgithub | | pending |

Review this document: at every change to a data store, a backup script or a
schedule; when rows 9.2, 9.3, 9.4, 9.5, 9.11 and 9.22 close (replace the
"today" column of section 5 and the measured times of section 4 with the
staging figures); and before the go/no-go record (`docs/GO_LIVE.md`).
