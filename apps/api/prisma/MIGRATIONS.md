# Migrations runbook

The database schema changes only through `prisma/migrations`, applied with
`npx prisma migrate deploy`. Never `prisma db push` (it bypasses the history;
the ledger triggers and the data fixes exist only as migrations) and never
edit a migration that has been applied anywhere: CI compares every migration
file with the base branch (`scripts/check-migrations-immutable.sh`) and fails
on a change. A fix is a new migration; when it must work on databases in
different states, guard each statement with `information_schema` (see
`20260929090100_foundation_convergence/migration.sql`).

## Everyday

```bash
cd apps/api
npx prisma migrate status      # what is pending, failed or unknown
npx prisma migrate deploy      # apply pending migrations
npx prisma migrate diff --from-url "$DATABASE_URL" --to-schema-datamodel prisma/schema.prisma --exit-code
```

The last command must print "No difference detected": the migrations produce
exactly `schema.prisma`. The API refuses to boot on a missing table or
column (`SCHEMA DRIFT DETECTED`) and prints these commands.

## A migration recorded as failed

`migrate deploy` stops at a failed migration. MySQL auto-commits DDL, so part
of it may have run. Decide from `migrate status` and the file:

- Nothing of it should stay: undo the statements that ran, then
  `npx prisma migrate resolve --rolled-back <name>` and `migrate deploy` again.
- Its effect is already there (or a later guarded migration converges it):
  `npx prisma migrate resolve --applied <name>` and `migrate deploy` again.

`20260919090000_pos_correctness_foundation` is the known case: its first
version failed on MySQL 8 at the duplicate merge. Resolve it as applied and
let `20260929090100_foundation_convergence` complete the structure; the
convergence migration is a no-op on a database that already has it.

## A migration edited after it was applied

`migrate deploy` does not verify checksums, so an edited migration applies
nowhere and breaks nothing at deploy time, but `migrate dev` and the CI check
reject it. Restore the original file from git and put the change into a new
migration.

## New database

`npx prisma migrate deploy` from an empty schema builds everything, triggers
included. The integration test database is built the same way in CI.
