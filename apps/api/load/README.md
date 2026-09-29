# POS load test (roadmap 5.8)

`load/pos-peak.yml` drives the three paths a shop hits hardest, at three
times the expected peak, and records the p95 latency and error rate as the
performance baseline (`docs/LOAD_TEST_BASELINE.md`).

| Path | Route | Expected peak | Tested (x3) |
|---|---|---:|---:|
| Checkout | `POST /api/billing/invoice` (cash sale, 1-3 units of a ZERO-GST product) | 5 / s | 15 / s |
| Dashboard | `GET /api/dashboard/summary` | 10 / s | 30 / s |
| Login | `POST /api/auth/login` | 1 / s | 3 / s |

The expected peak is an assumption for one API instance serving a fleet of
small shops (a busy shop bills about one sale every few seconds; the
dashboard polls every few seconds while open). The virtual users are spread
round-robin over `LOAD_SHOPS` shops (default 16): a checkout holds the shop's
shift, number-sequence and product row locks, so one shop bills serially by
design and a single shop cannot absorb the whole fleet peak. Change the
phase `arrivalRate` and the scenario weights together when the target
changes.

## Run

```bash
cd apps/api
LOAD_DATABASE_URL='mysql://user:pass@127.0.0.1:3306/dukaanai_load' \
LOAD_REDIS_URL='redis://127.0.0.1:6379/2' \
load/run.sh
```

- The database must be migrated (`DATABASE_URL=... npx prisma migrate deploy`)
  and disposable: the run writes a user, a product, stock and about a
  thousand invoices.
- `run.sh` builds `dist/`, boots `node dist/main` under `NODE_ENV=test` on
  `LOAD_PORT` (3019) with crons off and the production logging profile
  (`PRISMA_LOG_QUERIES=false`: per-query logging measures
  the log writer, not the API), runs `load/setup.mjs` (per shop: register,
  promote to OWNER, log in, create and stock the product, open a shift; the
  result lands in the untracked `load/.state.json`), runs artillery and
  prints the table with `load/summarize.mjs`, which exits non-zero when the
  roadmap gate fails: **checkout p95 < 500 ms, zero 5xx and zero transport
  errors (a request that times out is a failure too)**.
- `ARTILLERY` names the artillery command (`npx artillery@2` by default;
  artillery is not a dependency of the workspace).
- Reports go to `load/reports/` (untracked): the artillery JSON and the API
  log of each run.

Never run it against a production database or a Redis db index a running
API uses.
