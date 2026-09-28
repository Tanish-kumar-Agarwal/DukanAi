# Project agent memory

This file is the project's committed home for project-intrinsic agent knowledge: build, test, release, architecture, and sharp-edge notes that should travel with the code.

- Add durable project-specific notes here as they are discovered through real work.

## Build and run sharp edges (apps/api)

- `nest build` uses `tsconfig.build.json` (`include: ["src/**/*"]`), so the
  entrypoint compiles to `dist/main.js` and `start:prod` is `node dist/main`.
  If the root-level `check-db.ts` (or any other root-level script) ever gets
  pulled into the build, tsc widens rootDir and the output moves to `dist/src/main.js`;
  `test/boot-regression.e2e-spec.ts` guards the script/output agreement.
- Boot failures are surfaced via `abortOnError: false` + a `bootstrap().catch`
  in `src/main.ts` that writes to stderr. `bufferLogs: true` otherwise swallows
  pre-logger crashes into a silent `exit(1)` (and `process.exit` truncates
  piped/redirected `console.error`, so use `fs.writeSync(2, ...)` when
  diagnosing a startup crash directly).
- Config is validated by `class-validator` on typed domain classes in
  `src/config/domains/*` (see `EnterpriseConfigModule`), NOT Joi. All domains
  are `useFactory`-provided; the `@ConfigDomain` metadata lives on the injection
  token, which `ConfigurationRegistryService` must read (not `wrapper.metatype`).
  `@IsOptional` does not skip `NaN`: a numeric env var set to a non-number fails
  boot, so `.env.production` carries real numeric defaults and only secrets and
  endpoints are placeholders. The web `.env.production` must likewise hold
  valid URLs and a 32+ character `NEXTAUTH_SECRET` placeholder or `next build`
  fails while collecting page data.
- Nest's `ConfigModule` loads `.env.local`, `.env.<NODE_ENV>` (only when
  `NODE_ENV` is set), then `.env` (see `EnterpriseConfigModule`). `NODE_ENV` is
  required (`AppConfig` has no default; the `start*` scripts pin it, `start:prod`
  to production), so a bare process never runs as development. Committed
  `.env.production`/`.env.development`/`.env.test` are templates the owner
  deliberately tracks; the root `.gitignore` documents this ("ALWAYS COMMITTED")
  and is marked do-not-modify. A production boot that still carries a template
  placeholder (`JWT_SECRET`, `FRONTEND_URL`) refuses to start.
- `@dukaanai/invoice-math` resolves to `packages/invoice-math/dist` (gitignored).
  Build it first (`npm run build` at the root runs turbo in dependency order;
  in isolation run `cd packages/invoice-math && npx tsc -p tsconfig.json`), or
  the API/web type-checks fail with TS2307.
- Prisma migrations under `apps/api/prisma/migrations` now produce exactly
  `schema.prisma` (`20260919090500_schema_sync` closed the historical drift;
  verify with `prisma migrate diff --from-url ... --to-schema-datamodel
  prisma/schema.prisma --exit-code` after `migrate deploy`). Always run
  `npx prisma generate` after changing `schema.prisma` or switching branches.
- Production runs MySQL 8, dev/CI here often MariaDB: they differ. MySQL
  cannot reference a TEMPORARY table twice in one statement (ERROR 1137,
  MariaDB allows it). Test raw-SQL migrations on MySQL 8; without Docker Hub,
  `apt-get download mysql-server-core-8.0` + `dpkg -x` runs one side by side.
- MySQL treats NULLs as distinct in unique indexes: a unique key that includes
  a nullable column (`deletedAt`, `variantId`) never blocks duplicates. Never
  rely on such a key; `InventoryItem` carries `variantKey = variantId ?? '-'`
  for its real unique index, and the default warehouse/bin bootstrap runs
  under a `SELECT ... FOR UPDATE` on the Shop row.
- `Shop.ownerId` and `User.shopId` are mutually-required foreign keys; creating
  the pair needs FK checks deferred within the transaction (MySQL). See
  `AuthBypassService.provisionSystemUser`.
- The `archiver` dependency is ESM-only; jest maps it to
  `apps/api/test/stubs/archiver.stub.js` in the e2e/integration configs.
- MySQL `LIKE` is case-insensitive: outbox relays partition event types with
  `LIKE BINARY` (`'Invoice%'` must not match `'INVOICE_CREATED'`).
- Prisma promises are lazy: code that relies on the tenant AsyncLocalStorage
  context must `await` inside `runWithContext`/`runAsSuperAdmin`, never return
  the bare PrismaPromise out of the scope.

## POS / billing architecture (EXEC-006C)

- Contract: `docs/POS_BILLING_CONTRACT.md` is the binding API/engine contract
  for the web POS, the API and `@dukaanai/invoice-math`. Update it with any
  route or payload change.
- Money math lives only in `packages/invoice-math` (`CALCULATION_SPEC.md`).
  The API re-reads prices inside the checkout transaction and recomputes; the
  web runs the same engine for previews. Never add arithmetic elsewhere.
- Stock has one writer: `InventoryMutationEngine.mutateStock` (inventory-domain).
  `InventoryItem.locationId` is a FK to `Location.id`; callers resolve the
  location with `InventoryLocationService` (`resolveSaleLocation` for POS,
  `resolveWarehouseBin` for receipts). Never pass a code such as `'DEFAULT'`.
  Products that only carry `Product.currentStock` are bootstrapped into an
  `InventoryItem` + `OPENING_BALANCE` ledger row on first mutation.
- `BillingService.createInvoice` is one transaction. Lock order is canonical
  for sales, returns, cancellations and repayments: original Invoice → Shift →
  Customer → NumberSequence → Product rows in ascending productId
  (`InventoryMutationEngine.lockProducts`, exclusive, BEFORE inserting any
  invoice/return line: a child-row insert takes a shared lock on Product and
  upgrading it later deadlocks) → LedgerAccountBalance by account. Deadlock /
  lock-wait rollbacks (P2034, P2028, MySQL 1213/1205 via P2010) are retried
  (`common/db/serialization-retry.ts`). Returns and cancellations
  (`InvoiceReversalService`) reverse the same authorities.
  `LedgerPostingService` lives in the global `LedgerModule` (`src/ledger`);
  GRNs, purchase returns and adjustments post through it too (contract §9).
  Every `post()` needs a `source` key; the unique `LedgerPosting` index is the
  ledger's idempotency guard, so never add check-then-insert dedupe around it.
- `BillingCheckpoints` (`billing/billing-checkpoints.ts`) is the fault
  injection seam: no-op in production, overridden by the failure-injection
  integration spec. Keep every checkpoint call when editing the flows.
- Custom (ad-hoc) invoice lines have `productId = null`, `isCustom = true`;
  any query joining `InvoiceItem` to `Product` must LEFT JOIN.
- Discount authority: cashiers are limited to
  `BILLING_CASHIER_MAX_DISCOUNT_PERCENT` (default 10); see contract §2.
- Redis stock keys (`stock:{shopId}:{productId}`) are advisory only; an
  "insufficient" answer is re-checked against the DB and never rejects a sale
  on its own. Compensation never creates keys.
- Business day / financial year come from `src/common/time/business-day.ts`
  with `ShopSettings.timezone` (default Asia/Kolkata); dashboards, reports,
  invoice dates and cancellation windows all use it.
- Tests: `npm test` (unit, src/**/*.spec.ts), `npm run test:integration`
  (real MySQL + Redis via `.env.test`, boots AppModule; build the test DB with
  `DATABASE_URL=... npx prisma migrate deploy` first). The integration suites
  are `pos-workflow` (business flow), `pos-failure-injection` (every
  checkpoint × sale/return/cancel/repayment), `pos-concurrency` (the
  concurrency × stock × quantity matrix up to 200 parallel checkouts, edge
  cases, multi-location, bootstrap race) and `pos-resilience` (Redis outage,
  outbox, accounting incl. purchase side, custom items, authority rules) and
  `dashboard` (EXEC-005: every dashboard figure against SQL, boundaries,
  stock alerts, insights, partial failure, tenant isolation).
  `apps/web` has `npm run test:e2e` (Playwright: checkout and dashboard
  states/polling). `npm run test:e2e` in apps/api is the boot regression.
  `test/security/*.security-spec.ts` (also matched by `test:integration`;
  alone: `npm run test:security`) asserts the secure behaviour the audit
  found missing: an open finding is `it.failing`, so it runs, is expected to
  fail, and breaks the build the moment a fix lands until it is flipped to
  `it` (see `test/security/README.md`). Never skip or delete one.
  Point either at another database with `TEST_DATABASE_URL` (integration) or
  `DATABASE_URL` + `E2E_DATABASE_URL` (Playwright); no env file edits needed.
- BullMQ's connection comes from `bullConnectionFromUrl(REDIS_URL)`
  (`src/common/redis/redis-connection.ts`: `rediss://` turns TLS on,
  credentials are percent-decoded, the path is the db, `maxRetriesPerRequest:
  null`). The db index matters: dev (db 0) and tests (db 1) share one Redis
  server, and before the db was honoured a running dev API consumed the tests'
  jobs. Every queue is BullMQ (`@nestjs/bullmq`); the legacy `@nestjs/bull`
  package is gone (`barcode-bulk` was its last processor and dialled
  localhost:6379 db 0 regardless of `REDIS_URL`). The shared `REDIS_CLIENT` is
  QUIT on application shutdown (`RedisClientLifecycle`).
- The cache (`CACHE_MANAGER`) is a Keyv Redis store (`buildCacheOptions`,
  `src/common/cache/cache-options.ts`): keys are `cache:<key>` in Redis, so
  every instance shares entries and an invalidation is seen by all. Without
  `REDIS_URL` it is an in-process Map (dev only). cache-manager 7 reads
  `stores`, not `store`: the old `cache-manager-redis-yet` wiring was ignored
  and left an unbounded per-process Map.
- Integration runs are hermetic: `test/jest-integration.global-setup.ts`
  flushes the test Redis db first (index >= 1 only), and the setup file sets
  `CRON_ENABLED=false` so no scheduler registers (the two
  `scheduler-*.integration-spec.ts` suites assert both switch positions). A
  "never fires" cron string is not an option: `CronJob.start()` throws when an
  expression has no run in the next 8 years, and `IsCronExpression` rejects
  such values at boot for the same reason. `npm run test:e2e` in apps/api is
  the boot regression only; `src/config/config-platform.spec.ts` proves
  env -> injected config through the real module.
- `app.init()` returns before BullMQ has opened its Redis connections; closing
  the app inside that window surfaces as unhandled `Connection is closed`
  errors (bullmq emits them after removing its own listeners). The shared
  `bootApp()` fixture waits for every queue/worker with `waitUntilReady()`, so
  boot-assert-close suites are deterministic; production shutdown has the same
  race (roadmap 7.3).
- Config domains read env through `hydrateFromEnv` (`src/config/hydrate-from-env.ts`):
  only `@EnvVariable` properties are copied, blank keeps the default, `0` is a
  value, garbage fails boot (`IntegerFromEnv`, `NumberFromEnv` for decimals,
  `BooleanFromEnv`, `IsCronExpression`). Every numeric/boolean domain uses it
  (`AppConfig`, `JwtConfig`, `SecurityConfig`, `CronConfig`, `CacheConfig`,
  `BullConfig`, `PrismaConfig`, `QueueConfig`, `EmailConfig`, all
  `*FeatureConfig`); never hydrate with `plainToInstance(..., {
  enableImplicitConversion: true })`, which turned the string "false" into
  true. Bounds live on the class (`BILLING_CASHIER_MAX_DISCOUNT_PERCENT` 0-100,
  `OCR_FUZZY_MATCH_THRESHOLD` 0-1, `BCRYPT_ROUNDS` 4-31, limits >= 1).
  Shared rules live in `src/config/validation/env-rules.ts`:
  `IsProductionSecret` (under `NODE_ENV=production` a secret must be 32+ chars
  and no template placeholder such as `___REPLACE_ME___`/`your_`/`CHANGE_ME`),
  `IsUrlList` (`FRONTEND_URL`: comma-separated absolute http(s) origins).
- Boot refusals throw: `StartupValidatorService` and
  `ConfigurationRegistryService` raise an Error (never `process.exit`), so the
  reason reaches `bootstrap().catch` and stderr. `test/boot-regression.e2e-spec.ts`
  spawns `node dist/main` for the matrix (no `NODE_ENV`, blank / placeholder /
  short `JWT_SECRET`, placeholder `FRONTEND_URL`, `AUTH_DISABLED` in
  production) and asserts each message.

## Money and stock correctness (roadmap phase 3)

- Returns are cumulative (`InvoiceMathEngine.calculateReturn`, spec in
  `packages/invoice-math/CALCULATION_SPEC.md`): every line carries
  `returnedQuantity`, a document refunds `cum(before + qty) − cum(before)`
  per stored amount, is never rounded to the rupee on its own, and is settled
  against the sale (`settlement`: capped at `invoiceTotal − refundedTotal`,
  exact remainder when it completes the invoice). `InvoiceReversalService`
  reads the earlier returns under the invoice lock (`priorReturns`) and the
  web preview passes the same settlement. A cancellation settles as a
  completing return, so its math lands on the stored total.
- `splitRevenue` (`billing.types.ts`) decides the SALES_REVENUE / GST_PAYABLE
  split of a sale or reversal: revenue carries the round-off and a sub-₹0.50
  document moves the shortfall onto GST, because the ledger drops negative
  entries. Use it for any new revenue posting.
- Reversals run on soft-deleted products and customers: the engine blocks a
  deleted product only for SALE/RESERVATION, `lockCustomer` takes
  `allowDeleted`. A refund posts to the sale's shift while it is still open
  and usable by the actor (`lockShiftForReversal`), else to the actor's own.
- Authority: `creditLimit` is accepted from MANAGER+ only
  (`CREDIT_LIMIT_REQUIRES_MANAGER`, AuditLog row `CUSTOMER_CREDIT_LIMIT_CHANGED`
  in the same transaction). A cashier's discount authority is the max of the
  line, invoice and combined effective percentages, and a cashier's custom
  line is capped at `BILLING_CASHIER_MAX_CUSTOM_LINE_AMOUNT` (default 500,
  `CUSTOM_LINE_REQUIRES_APPROVAL`).
- Soft-delete unique keys use `deletedToken` (`''` live, the row id once
  deleted; `src/prisma/soft-delete-token.ts`, DMMF-derived, stamped by the
  Prisma extension on `update`/`upsert` by id: a soft delete through
  `updateMany` throws). Keys are `(shopId, key, deletedToken)` on Category,
  Product (sku, barcode), ProductVariant (sku, barcode), Supplier, Customer,
  CustomerGroup/Category, PurchaseOrder, GoodsReceipt, VendorBill,
  PurchaseReturn, SupplierCreditNote, Warehouse, Location. The index is the
  guard: services pre-check for a friendly message and map P2002 with
  `rethrowUniqueViolation` (`common/db/unique-violation.ts`); the global
  filter answers 409 `DB_P2002` with `details.target` otherwise. Live rows
  that were already duplicates when the migration ran keep their id as token
  (exempt, still live); list them with `deletedToken <> '' AND isDeleted = 0`.
- Stock engine: `idempotencyKey` is per document line (`GRN:<grn>:<lineId>`,
  `PRET:<return>:<lineId>`) and callers skip the value of an `idempotent`
  result; a RESERVATION_RELEASE floors `reserved` at 0; `variantId` on the
  request addresses the variant row (adjustments, allocations, releases pass
  it); a new product-level item bootstraps `currentStock − Σ onHand` as
  OPENING_BALANCE; `InventoryReconService` writes an InventoryLog row
  (recorded under the shop owner) when it corrects `currentStock`.
- Reservations always expire (`expiresInSeconds` 30 s..7 d, mandatory);
  `POST /reservations/:id/cancel|release` free the stock once
  (`ReservationExpiryService.releaseReservation`, status-guarded). Stock-count
  adjustments are never auto-approved, take their delta from
  `StockCountItem.variance` when raised from a count item, need an approver
  other than the requester, and approve + post in one transaction with
  guarded PENDING_APPROVAL → APPROVED → POSTED transitions.
- Payables (`SupplierPayablesService`, global LedgerModule): a GRN adds to
  `Supplier.pendingPayables` and a purchase return floors it, in the same
  transaction as their postings; supplier and vendor-bill payments create a
  `SupplierPayment` row (idempotent per `(shopId, idempotencyKey)`), decrement
  the balance under a guard (`PAYABLES_INSUFFICIENT`) and post DR
  ACCOUNTS_PAYABLE / CR CASH|BANK with source `SUPPLIER_PAYMENT`.
  `payablesFromLedger` rebuilds the balance (`openingPayables` + postings).
- Migrations: an applied migration is never edited
  (`scripts/check-migrations-immutable.sh`, run in CI against the base
  branch); a fix ships as a new migration with `information_schema` guards
  (`20260929090100_foundation_convergence` is the template); the ledger
  immutability triggers are a migration (`20260929090200`), so
  `LedgerTransaction` rows cannot be updated or deleted, not even by tests.
  The boot drift message and `prisma/MIGRATIONS.md` give the
  `migrate deploy` / `migrate resolve` runbook; `prisma db push` is never used.
  `test/integration/migrations.integration-spec.ts` replays the phase 3
  migrations on a seeded scratch database (needs CREATE DATABASE rights on
  the test server).

## Scaffolding modules (roadmap phase 4)

- 4.1: the media, product-validation, product-identity, import-export,
  webhook and product-events controllers take the shop from `@CurrentShop()`
  and the user from `@CurrentUser('id')` (`src/iam/decorators`); `req.shop`
  was never set and every call answered 500. Every body is a DTO; webhooks
  are MANAGER+ for reads and writes and the HMAC secret is returned once, in
  the create response, only when the server generated it. Foreign keys in
  those routes go through `assertOwned` (media attach, barcode targets, bulk
  validation); validation state rows are read and written by shop;
  `VariantIdentity.sku` is unique per shop (`(shopId, sku)`, migration
  `20260929120000`). The former media `bulk`/`search` stubs are gone; `tag`
  and `order` are real. `test/integration/scaffolding-routes.integration-spec.ts`
  walks every route as OWNER, VIEWER and a foreign owner (no 500s, role
  gates, 404 on foreign ids) and follows an import to the worker.
- Every BullMQ processor runs its job under a tenant context
  (`src/iam/tenant-context/job-context.ts`): `jobContext(shopId, jobId)` when
  the job names its shop (`requireJobShop` refuses one that does not),
  `runInShopOf(tenant, prisma, model, id, jobId, fn)` when it names only a
  document (the owner is read as the system tenant; a missing row is a
  logged no-op, not a crash loop), `runAsSuperAdmin` for relays.
  `src/iam/tenant-context/processor-context.spec.ts` scans every
  `@Processor` source and fails a worker that touches a collaborator
  without one (a pure Redis/queue worker is allowlisted there with its reason).
  Producers put `shopId` on the job (`import-job`, `webhook-delivery`).

## Toolchain

- Node is pinned once, in `.nvmrc` (CI reads it via `node-version-file`) and
  `engines` in every package.json. `npm run lint|type-check|test|build` at the
  root go through turbo; `apps/api` lint is clean at zero errors and must stay
  so: unused parameters that a signature must keep are `_`-prefixed, and a
  deliberately un-awaited promise is written `void fn()` only when the callee
  catches its own errors (`no-floating-promises` is on; `no-unsafe-argument`
  stays off until the `any` request bodies become DTOs).

## Dashboard (EXEC-005)

- Contract §6. `GET /dashboard/summary` loads 11 sections independently: a
  failed one is listed in `failedSections` with `null` figures (503 only when
  all fail); the web marks exactly those tiles/cards unavailable. Keep new
  summary figures inside a section.
- Stock alerts count active, non-deleted, stock-tracked products only
  (`stockAlertProductFilter`: not SERVICE/DIGITAL, which the inventory engine
  bypasses). The inventory page's `?tab=low-stock` lists them all.
- KPIs are cached 60 s; `BillingHelpers.afterStockChange` drops the cache
  right after every committed sale/return/cancel, and the outbox processor
  drops it again, so tiles and KPI strip agree on the next read.
- Web resources go through `useDashboardResource` (newest response wins, polls
  skip a request in flight), dashboard GETs time out after 15 s and payloads
  are shape-checked (`DashboardPayloadError`): never render a failure as zeros.

## Authorization policy (roadmap phase 1)

- `RolesGuard` is deny-by-default: every POST/PUT/PATCH/DELETE handler must
  carry `@Roles(...)`, `@AnyAuthenticated()` (own-data self-service) or
  `@Public()`; GET stays open to any signed-in user unless narrowed.
  `RouteAuthorizationAssertion` (AppModule) refuses to boot otherwise, and
  `src/auth/route-authorization.spec.ts` scans every controller source without
  booting. Write roles with the sets in `src/auth/role-sets.ts`
  (`ADMIN_ROLES`, `MANAGEMENT_ROLES`, `POS_ROLES`); `SUPER_ADMIN` is never
  implicit, list it.
- Every `@Body()` is a class-validator DTO (the scan spec rejects `any`,
  `unknown`, `object` and inline object types). A body that is a free-form
  JSON document goes through `@Body(JsonObjectPipe)`. Never spread a request
  body into Prisma `data`: pick the columns you mean to write (see
  `ShopsService.updateShopProfile`, `PurchaseDraftService.pickDraftFields`).
- Separation of duties: the creator/submitter of a purchase order, the
  creator of a goods receipt and the requester of a stock-count adjustment
  cannot approve it (`ForbiddenException` in the approval services).
- Shop isolation is derived from the schema (`src/prisma/tenant-scope.ts`):
  every model with a `shopId` column is tenant-owned except `GLOBAL_MODELS`
  (`User`, `Invitation`: read before the tenant is known). Under a tenant
  context the Prisma extension narrows every filter to the shop, binds creates,
  refuses `data.shopId` changes and scopes nested writes (`connect` etc. get
  `shopId`, so a foreign target answers P2025). Code that runs outside a
  request must pick a context: `runAsSuperAdmin` for work that spans shops
  (outbox relays), `runWithContext(jobContext(shopId, jobId))` for a job that
  names its shop (`src/iam/tenant-context/job-context.ts`); a tenant-model
  query with neither throws "Missing tenant context".
- A foreign key supplied in a request body is never read by the extension, so
  every write that stores one calls `assertOwned` / `assertOwnedMany`
  (`src/prisma/tenant-ownership.ts`) first, inside the same transaction
  (404 for a foreign row). `test/integration/tenant-isolation.integration-spec.ts`
  sends shop B's IDs to every such route as shop A.
- Sweeps are per shop: `POST /batches/sweep-expiry` and `POST /reservations/sweep`
  act on the caller's shop; the global sweeps are the locked crons
  `BatchExpirySweep` / `ReservationExpirySweep` (`CRON_BATCH_EXPIRY_SWEEP`,
  `CRON_RESERVATION_EXPIRY_SWEEP`), which use `sweepEveryShop`
  (`src/common/sweeps/per-shop-sweep.ts`): shop list as system tenant, each
  shop in its own context, per-shop and per-row failures logged and skipped.
  `TenantGuard` lets only `ACTIVE` shops through (SUSPENDED/LOCKED/ARCHIVED/
  DELETED and an unknown status are 403).
- Procurement line tables (`PurchaseOrderItem`, `GoodsReceiptLine`,
  `VendorBillLine`, `PurchaseReturnLine`, `SupplierCreditLine`) carry
  `shopId` (migration `20260927180000_scope_line_tables_by_shop`, backfilled
  from the parent); nested creates must set it, and `BatchStock`'s unique key
  is `(shopId, batchId, inventoryItemId)`.

## Rate limiting and proxies (roadmap 2.1)

- `SecurityConfig` windows are milliseconds (`RATE_LIMIT_*_TTL_MS`, under
  1000 fails boot); the old second-based `RATE_LIMIT_*_TTL` keys are not read.
  Counters live in Redis (`RedisThrottlerStorage`, keys `throttle:{...}`) and
  degrade to the per-process storage when Redis is down. Routes that take
  credentials carry `@AuthThrottle()` (login, register, refresh, google,
  invitation accept) and get the `AUTH_RATE_LIMIT_*` limits instead of the
  general ones (`src/common/throttling`). `.env.test` opens every window wide;
  `test/integration/rate-limit.integration-spec.ts` proves the limiter with its
  own overrides and clears `throttle:*` before and after.
- The tracker is `req.ip`, so `TRUST_PROXY` (Express `trust proxy`, applied in
  `main.ts`) decides whether `X-Forwarded-For` counts. Every sign-in and
  refresh call reaches the API from the web server, which forwards the
  browser's address (`apps/web/src/lib/auth.ts`); count it as a hop.
- Login lockout (`UsersService.incrementFailedAttempts`, atomic
  `{ increment: 1 }`): `SECURITY_MAX_LOGIN_ATTEMPTS` failures lock NEW logins
  for `SECURITY_LOCKOUT_DURATION_MS`; an expired lock is cleared on the next
  attempt (`isLockedNow`). A lock never revokes open sessions or sockets
  (`JwtStrategy`, `AuthenticatedIoAdapter` ignore `isLocked`): suspension is
  `isActive`, revocation is `tokenVersion`. The `auth-account` throttler
  (`AUTH_RATE_LIMIT_ACCOUNT_LIMIT` per medium window, keyed by the submitted
  email) caps attempts spread over many addresses.

## Invitations, Google sign-in, email (roadmap 2.8, 2.9)

- Invitations (`InvitationsService`): the invited role must rank strictly
  below the inviter's (`ROLE_RANK`/`outranks` in `src/auth/role-sets.ts`, also
  used by user suspend/delete), `Invitation.inviterId` records the issuer, and
  the token reaches the invitee only by email: the API response carries no
  token. A MANAGER revokes only their own invitations; ADMIN roles any.
- `EmailService` (`src/common/email`, global) sends through nodemailer from
  `SMTP_URL`; unset, it logs each message (`isConfigured` false). Production
  refuses to issue an invitation without SMTP (503). Integration specs
  override the provider (`bootApp(b => b.overrideProvider(EmailService)...)`)
  and read the token from the recorded message. The email links to
  `<FRONTEND_URL>/register?invite=<token>`; the web register page does not
  read that parameter yet (the invitee pastes the code).
- Google sign-in: the web sends only `{ idToken: account.id_token }` to
  `POST /auth/google`, and registers the provider only with real credentials
  (`hasGoogleCredentials`, placeholder-aware). The API never links a Google
  identity to an existing account that was not created through Google (409,
  surfaced as `AccessDenied` on the login page): anyone can register a
  password account under someone else's address.

## WebSockets and correlation (roadmap 2.13, 2.14)

- `AuthenticatedIoAdapter` registers its middleware on the root socket.io
  server AND on every namespace as it is created (`new_namespace`), because
  `server.use` alone never guards `/inventory`. The middleware verifies the
  access token (HS256, live session family), the user and the shop, then joins
  `tenant:<shopId>`; `InventoryGateway` emits to that room under the tenant
  context. `test/integration/infrastructure.integration-spec.ts` connects with
  `socket.io-client`.
- A request's correlation id is settled once by `CorrelationIdMiddleware`
  (`sanitizeIdentifier` in `src/common/correlation/correlation-id.ts`: a
  well-formed client value is kept, anything else becomes a UUID) and read as
  `req.correlationId` by the tenant interceptor and `GlobalExceptionFilter`
  (so a guard's 401 carries it too); never read the raw header. The socket
  handshake header goes through the same function.
- `CorrelationLogger` prints one JSON line per entry (Nest's ConsoleLogger
  json mode) with the correlation id (`system-job` outside a request) and
  redacts sensitive keys cycle- and depth-safely (`redact`).

## Auth bypass flag

- `AUTH_DISABLED` (API) + `NEXT_PUBLIC_AUTH_DISABLED` (web, build-time) disable
  authentication for demos/dev. OFF by default and accepted only under
  `NODE_ENV=development` or `test` (`assertAuthBypassPermitted` refuses boot
  otherwise, and `AuthBypassService.isEnabled` stays false); no committed
  template sets it, put it in an untracked `.env.local`. See `AuthBypassService`
  (`apps/api/src/auth/auth-bypass.service.ts`), `AuthConfig`
  (`apps/api/src/config/domains/auth.config.ts`), and `apps/web/src/lib/auth-bypass.ts`.
  When on, every request runs as a provisioned system user
  (`system@dukaanai.local`, OWNER, own shop). Real auth code stays intact - the
  flag gates access, it never accepts unverified identity from a request.
- Tokens are HS256 only (`JWT_ALGORITHM`, pinned in `JwtModule`, `JwtStrategy`
  and the socket adapter). Refresh tokens are opaque and stored hashed; there
  is no `JWT_REFRESH_SECRET`. The web enforces a real `NEXTAUTH_SECRET` on a
  running production server (`apps/web/src/config/env.ts`, skipped during
  `next build`, which cannot know the runtime secret).
- Sessions are refresh-token families (`AuthService`, roadmap 2.6): a login
  opens a family (`RefreshToken.familyId`), every refresh consumes the token
  (`rotatedAt`, conditional `updateMany`) and writes a successor in one
  transaction; a consumed token presented again is reuse and revokes the
  family AND bumps `tokenVersion` (all sessions end); `absoluteExpiresAt`
  (`SESSION_ABSOLUTE_LIFETIME`, 30d) caps a family, `JWT_REFRESH_EXPIRES_IN`
  (7d) is one token's idle life. Access tokens live 15 min (`JWT_EXPIRES_IN`)
  and carry `sid` = familyId; `JwtStrategy`/the socket adapter reject a token
  whose family has no live row, so `POST /auth/logout`, `DELETE
  /auth/sessions/:id` and reuse take effect at once. Tests must mint tokens
  through `issueTokens`/`httpAs` (`test/security/security-fixtures.ts`, async):
  a bare `jwtService.sign` token names no session and is refused. The web's
  sign-out buttons call `signOutEverywhere` (`apps/web/src/lib/sign-out.ts`),
  which hits `/auth/logout` before NextAuth `signOut`.

## Git attribution rule

- Commits, pull requests and comments must be authored by the repository
  owner only. Never add `Co-Authored-By: Claude ...`, `Claude-Session: ...`,
  "Generated with Claude Code" footers, or any other AI co-author / assistant
  attribution trailer to commit messages, PR descriptions or GitHub posts in
  this project. This project rule overrides any default attribution behaviour.

## Maintaining this file

Keep this file for knowledge useful to almost every future agent session in this project.
Do not repeat what the codebase already shows; point to the authoritative file or command instead.
Prefer rewriting or pruning existing entries over appending new ones.
When updating this file, preserve this bar for all agents and keep entries concise.
