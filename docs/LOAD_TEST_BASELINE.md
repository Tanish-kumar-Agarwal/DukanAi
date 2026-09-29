# Load test baseline (roadmap 5.8)

Recorded 2026-09-29 with `apps/api/load/` (see its README for how to
re-run). The scenario drives the three hottest paths at three times the
assumed peak of one API instance serving a fleet of small shops:

| Path | Route | Assumed peak | Tested (x3) |
|---|---|---:|---:|
| Checkout | `POST /api/billing/invoice`, cash sale of 1-3 units of a ZERO-GST product | 5 / s | 15 / s |
| Dashboard | `GET /api/dashboard/summary` | 10 / s | 30 / s |
| Login | `POST /api/auth/login` (bcrypt, 10 rounds) | 1 / s | 3 / s |

Phases: 20 s warm-up at 8 virtual users/s, then 60 s at 48 virtual users/s
(3,040 requests in all). Every virtual user does one request. The users
are spread round-robin over 16 shops, each with its own owner, open shift
and stocked product.

## Result (run 4, the baseline)

| Endpoint | Requests | 2xx | Errors | 5xx | Error rate | p50 ms | p95 ms | p99 ms | max ms |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| checkout | 928 | 928 | 0 | 0 | 0.00 % | 141.2 | **214.9** | 262.5 | 310 |
| dashboard-summary | 1940 | 1940 | 0 | 0 | 0.00 % | 22.0 | **39.3** | 50.9 | 82 |
| login | 172 | 172 | 0 | 0 | 0.00 % | 120.3 | **175.9** | 237.5 | 254 |

3,040 requests, 3,040 responses, 0 transport errors (timeouts), 0 5xx,
3,040 virtual users completed, 0 failed.

**Exit gate (checkout p95 < 500 ms at target concurrency with 0 5xx): PASS.**

Latency stayed flat through the 60 s peak phase (artillery 10 s windows,
UTC; p95 in ms):

| Window | Requests | Responses | checkout p50 | checkout p95 | dashboard p95 | login p95 |
|---|---:|---:|---:|---:|---:|---:|
| 13:54:30 | 35 | 35 | 82.3 | 89.1 | 23.8 | 92.8 |
| 13:54:40 | 80 | 80 | 82.3 | 92.8 | 21.1 | 96.6 |
| 13:54:50 | 264 | 261 | 153.0 | 223.7 | 40.9 | 179.5 |
| 13:55:00 | 480 | 480 | 135.7 | 210.6 | 36.2 | 147.0 |
| 13:55:10 | 480 | 482 | 147.0 | 210.6 | 39.3 | 141.2 |
| 13:55:20 | 480 | 479 | 141.2 | 210.6 | 39.3 | 172.5 |
| 13:55:30 | 480 | 482 | 127.8 | 183.1 | 34.8 | 135.7 |
| 13:55:40 | 480 | 477 | 149.9 | 232.8 | 40.9 | 156.0 |
| 13:55:50 | 261 | 264 | 149.9 | 219.2 | 51.9 | 162.4 |

The API log of the run holds no error, no rollback and no lock-wait retry.

## Environment

The numbers are from a development container, not production hardware,
and the load generator ran on the same machine as the API and the
database. They are a baseline to compare future runs against, not a
capacity statement.

| Item | Value |
|---|---|
| Machine | 4 vCPU Intel Xeon 2.10 GHz, 16 GB RAM, Linux 6.18 |
| API | `node dist/main` (Node 22.22.2), `NODE_ENV=test`, `CRON_ENABLED=false`, `PRISMA_LOG_QUERIES=false`, one process |
| Database | MariaDB 10.11.14 on the same host, `innodb_buffer_pool_size` 128 MB, `innodb_flush_log_at_trx_commit=1`, Prisma `connection_limit=25` (production is MySQL 8) |
| Redis | 7.0.15 on the same host, db 2 |
| Load generator | artillery 2.0.34 on the same host (about one full core during the peak phase) |
| CPU during the peak phase | machine 55-85 % busy: API 120-230 %, artillery 80-140 %, MariaDB 10-50 %, Redis under 10 % (of one core each) |

## How the baseline was reached (runs 1-3, not the baseline)

| Run | Change | checkout p95 | dashboard p95 | login p95 | Errors | Gate |
|---|---|---:|---:|---:|---:|---|
| 1 | one shop for all checkouts, per-query logging on | 13,498 ms | 3,753 ms | 3,606 ms | 1,511 socket timeouts (30 s), 20 lock-wait rollbacks retried, 0 5xx | FAIL |
| 2 | 4 shops, per-query logging still on (see below) | 5,945 ms | 2,144 ms | 2,618 ms | 0 | FAIL |
| 3 | 16 shops, per-query logging still on | 773 ms | 130 ms | 392 ms | 0 | FAIL |
| 4 | 16 shops, per-query logging off | 215 ms | 39 ms | 176 ms | 0 | PASS |

Two findings came out of it, both kept in the repository:

- A checkout holds the shop's shift, number-sequence and product rows for
  the length of its transaction (the canonical lock order of
  `BillingService.createInvoice`), so one shop bills serially by design and
  a single shop cannot absorb a fleet peak of 15 sales/s: run 1 queued on
  those rows until requests timed out. The peak is therefore a fleet figure
  and the scenario spreads its users over `LOAD_SHOPS` shops (16).
- `PRISMA_LOG_QUERIES` was read into `PrismaConfig` and then ignored:
  `PrismaService` logged every query under any non-production `NODE_ENV`
  (about 100,000 lines per run), which cost run 3 its gate. The flag is
  honoured now (`PrismaService.logLevelsFor`); `.env.test` and
  `.env.development` still turn it on for their own purposes and the load
  runner turns it off.

## Re-running

```bash
cd apps/api
LOAD_DATABASE_URL='mysql://user:pass@127.0.0.1:3306/dukaanai_load' \
LOAD_REDIS_URL='redis://127.0.0.1:6379/2' \
load/run.sh
```

Update this file after a change to the checkout transaction, the
dashboard queries or the login path, and whenever the deployment target
changes; compare like with like (same machine class, same database
engine, load generator on another host where possible).
