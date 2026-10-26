#!/usr/bin/env bash
#
# The restore drill.
#
# Takes a backup of DATABASE_URL, restores it into a scratch database, and then
# tries to break the result in every way the restore runbook says matters:
# missing constraints, a schema behind the code, oversold slots, stale holds, a
# ledger that does not balance. Prints a pass/fail line per check and exits
# non-zero on the first failure.
#
# This exists because "the steps are written down" and "the steps work" are
# different claims, and only one of them is worth anything at three in the
# morning. Run it before a release, and after any change to the schema, the
# constraints or the seed.
#
#   ./scripts/restore-drill.sh            # against DATABASE_URL
#   DRILL_KEEP=1 ./scripts/restore-drill.sh   # leave the scratch database behind
#
# It never writes to DATABASE_URL. The scratch database is dropped at the end
# unless DRILL_KEEP is set.

set -euo pipefail

cd "$(dirname "$0")/.."

# shellcheck disable=SC1091
[ -f .env ] && set -a && . ./.env && set +a

: "${DATABASE_URL:?DATABASE_URL is not set. Copy .env.example to .env.}"

#
# Prisma connection strings carry `?schema=public`, which libpq rejects as an
# unknown URI parameter — `psql: error: invalid URI query parameter: "schema"`.
# Every pg_* tool in this script needs it stripped. This is the first thing the
# drill found and the reason the runbook's commands could not be pasted as
# written.
#
libpq_url() { printf '%s' "${1%%\?*}"; }

SOURCE_URL="$(libpq_url "$DATABASE_URL")"
DRILL_DB="arc_stay_drill_$(date -u +%Y%m%d%H%M%S)"
ADMIN_URL="${SOURCE_URL%/*}/postgres"
RESTORE_URL="${SOURCE_URL%/*}/$DRILL_DB"
DUMP_FILE="$(mktemp -t arc-stay-drill-XXXXXX.dump)"

PASS=0
FAIL=0

ok()   { printf '  \033[32mPASS\033[0m  %s\n' "$1"; PASS=$((PASS + 1)); }
bad()  { printf '  \033[31mFAIL\033[0m  %s\n' "$1"; FAIL=$((FAIL + 1)); }
step() { printf '\n\033[1m%s\033[0m\n' "$1"; }

cleanup() {
  rm -f "$DUMP_FILE"
  if [ -z "${DRILL_KEEP:-}" ]; then
    psql "$ADMIN_URL" -q -c "DROP DATABASE IF EXISTS \"$DRILL_DB\" WITH (FORCE);" >/dev/null 2>&1 || true
  else
    printf '\nScratch database kept: %s\n' "$RESTORE_URL"
  fi
}
trap cleanup EXIT

printf '\033[1mARC Stay restore drill\033[0m\n'
printf 'source:  %s\n' "$SOURCE_URL"
printf 'scratch: %s\n' "$RESTORE_URL"

step '1. Take the backup'
pg_dump --format=custom --no-owner --no-privileges --file="$DUMP_FILE" "$SOURCE_URL"
DUMP_BYTES=$(wc -c < "$DUMP_FILE")
if [ "$DUMP_BYTES" -gt 1024 ]; then
  ok "dump taken ($DUMP_BYTES bytes)"
else
  bad "dump is $DUMP_BYTES bytes — that is not a database"
  exit 1
fi

step '2. Restore into an empty database'
psql "$ADMIN_URL" -q -c "CREATE DATABASE \"$DRILL_DB\";"
# --single-transaction so a partial restore is no restore at all.
pg_restore --dbname="$RESTORE_URL" --no-owner --no-privileges --single-transaction "$DUMP_FILE"
ok 'restored'

step '3. Re-apply the constraints Prisma cannot express (ADR-020)'
DATABASE_URL="$RESTORE_URL" npm run --silent db:constraints >/dev/null
#
# The expected count is counted from the file rather than written here, so
# adding a constraint cannot leave the drill checking yesterday's number.
#
EXPECTED_CHECKS=$(grep -c 'ADD CONSTRAINT' prisma/constraints.sql)
CHECKS=$(psql "$RESTORE_URL" -tAc \
  "SELECT count(*) FROM pg_constraint WHERE contype = 'c' AND connamespace = 'public'::regnamespace;")
TRIGGERS=$(psql "$RESTORE_URL" -tAc \
  "SELECT count(*) FROM pg_trigger WHERE tgconstraint <> 0 AND NOT tgisinternal;")
if [ "$CHECKS" -ge "$EXPECTED_CHECKS" ]; then
  ok "$CHECKS CHECK constraints present (constraints.sql declares $EXPECTED_CHECKS)"
else
  bad "only $CHECKS CHECK constraints — constraints.sql declares $EXPECTED_CHECKS"
fi
if [ "$TRIGGERS" -ge 1 ]; then
  ok "$TRIGGERS constraint trigger(s) present"
else
  bad 'the payout_balances constraint trigger is missing'
fi

step '4. Is the restored schema the one the code expects?'
#
# A dump from an older deployment can be a migration or two behind. Better to
# be told here than by a query failing at runtime.
#
if DATABASE_URL="$RESTORE_URL" npx prisma migrate status >/dev/null 2>&1; then
  ok 'every migration applied'
else
  bad 'schema is behind the migrations — run `prisma migrate deploy` against it'
fi

step '5. Prove the invariant the inventory model rests on'
OVERSOLD=$(psql "$RESTORE_URL" -tAc \
  'SELECT count(*) FROM "AvailabilitySlot" WHERE booked + held > capacity;')
if [ "$OVERSOLD" = '0' ]; then
  ok 'no oversold slots'
else
  bad "$OVERSOLD oversold slots — do not take traffic on this restore"
fi

NEGATIVE=$(psql "$RESTORE_URL" -tAc \
  'SELECT count(*) FROM "AvailabilitySlot" WHERE booked < 0 OR held < 0;')
if [ "$NEGATIVE" = '0' ]; then
  ok 'no negative counters'
else
  bad "$NEGATIVE slots with a negative counter (ADR-020: returnCapacity throws rather than clamping)"
fi

step '6. Release holds that were promises about a time now past'
HELD_BEFORE=$(psql "$RESTORE_URL" -tAc 'SELECT coalesce(sum(held), 0) FROM "AvailabilitySlot";')
SWEPT=$(DATABASE_URL="$RESTORE_URL" npx tsx -e \
  'import("./src/modules/inventory/service").then(m => m.sweepExpiredHolds()).then(n => console.log(n))' \
  | tail -1)
HELD_AFTER=$(psql "$RESTORE_URL" -tAc 'SELECT coalesce(sum(held), 0) FROM "AvailabilitySlot";')
ok "swept $SWEPT expired hold(s); held units $HELD_BEFORE → $HELD_AFTER"

step '7. Does the ledger still balance?'
#
# Not in the runbook before this drill was written. A restore that silently
# loses ledger rows is the failure nobody would notice until a partner asked why
# their payout was short — which is exactly how the seed's refund bug was found.
#
LEDGER=$(psql "$RESTORE_URL" -tAc "
  SELECT coalesce(sum(\"amountMinor\"), 0)
  FROM \"LedgerEntry\"
  WHERE \"organizationId\" IN (SELECT id FROM \"Organization\");")
ORPHANS=$(psql "$RESTORE_URL" -tAc '
  SELECT count(*) FROM "LedgerEntry" le
  LEFT JOIN "Order" o ON o.id = le."orderId"
  WHERE le."orderId" IS NOT NULL AND o.id IS NULL;')
if [ "$ORPHANS" = '0' ]; then
  ok "no orphaned ledger entries (total of all accounts: $LEDGER minor units)"
else
  bad "$ORPHANS ledger entries point at an order that is not in the restore"
fi

UNBALANCED=$(psql "$RESTORE_URL" -tAc '
  SELECT count(*) FROM (
    SELECT p.id
    FROM "Payout" p
    JOIN "PayoutLine" l ON l."payoutId" = p.id
    WHERE p.status <> '"'"'CANCELLED'"'"'
    GROUP BY p.id, p."netMinor"
    HAVING sum(l."amountMinor") <> p."netMinor"
  ) AS bad;')
if [ "$UNBALANCED" = '0' ]; then
  ok 'every payout equals the sum of its lines'
else
  bad "$UNBALANCED payout(s) do not equal the sum of their lines"
fi

step '8. Does the application work against the restored schema?'
#
# NOT the integration suite, though the runbook used to say so. The harness now
# builds its schema from the migrations, which means it drops the public schema
# before the first test — pointed at a restore it destroys the thing it was
# meant to be checking, and then proves the migrations work, which was never the
# question. (It also refuses, since it will not drop a database whose name does
# not say "test".)
#
# `restore-smoke.ts` reads the restored rows through the real module code and
# tries to violate the capacity CHECK constraint to confirm the restore carried
# it. See the comment at the top of that file.
#
if DATABASE_URL="$RESTORE_URL" npx tsx scripts/restore-smoke.ts; then
  ok 'application reads and constraints hold on the restored data'
else
  bad 'the application cannot work against this restore — see above'
fi

step 'Result'
printf '  %d passed, %d failed\n\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ] || exit 1
printf 'The restore works. Record the date in docs/operations.md.\n'
