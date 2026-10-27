#!/usr/bin/env node
/**
 * PreToolUse guard for ARC Stay.
 *
 * `CLAUDE.md` states eight non-negotiables and `docs/going-live.md` adds the
 * production rules. Every one of them was honour-system until this file
 * existed: an agent that had not read them could run the command anyway. This
 * turns the handful that are irreversible into a refused tool call.
 *
 * It is deliberately a blunt instrument. Each rule names the document it comes
 * from, so a refusal tells you which decision you are arguing with rather than
 * just saying no. The answer to a false positive is for a person to run the
 * command, not to widen the pattern.
 *
 * Exit 0 allows, exit 2 blocks and returns stderr to the model.
 */

const RULES = [
  {
    // memory: deliberately not consented to on anyone's behalf. The token
    // disarms the guard for every future run and every future agent.
    pattern: /PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION/,
    why: 'Consenting to Prisma\'s destructive-action guard disarms it for every later run and every later agent. That is a person\'s decision, not an agent\'s. `tests/global-setup.ts` does its own guarded teardown instead.',
  },
  {
    pattern: /prisma\s+migrate\s+reset|\bdb:reset\b/,
    why: '`migrate reset` drops every table. Integration tests do not need it — `tests/global-setup.ts` tears down what it owns. If you genuinely need a reset, ask a person to run it.',
  },
  {
    pattern: /prisma\s+db\s+push/,
    why: '`db push` builds a schema without recording a migration, which is what caused `P3005 — the database schema is not empty` on the demo database. Write a migration (see ADR-034 and `docs/going-live.md`).',
  },
  {
    pattern: /ARC_DB_REBUILD|\bdb:rebuild\b/,
    why: '`db:rebuild` resets a demo schema. It is a person\'s call, and the flag must be removed from the deployment immediately afterwards.',
  },
  {
    pattern: /ARC_ENABLE_OUTBOUND_MESSAGING\s*=\s*(1|true)/i,
    why: 'CLAUDE.md non-negotiable 6: that switch governs ARC *initiating* contact with a guest, and it stays off. Transactional mail is the separate `ARC_ENABLE_TRANSACTIONAL_EMAIL` (ADR-040).',
  },
  {
    pattern: /\b(sk|pk|rk)_live_[A-Za-z0-9]/,
    why: 'A live Stripe key does not belong in a command line, a file or a log. `docs/going-live.md` §3: a person sets these in the deployment, on the production project only.',
  },
  {
    // non-negotiable 2 and ADR-036: /admin plus a person who looked at a
    // document is the only route to a verified standing.
    pattern: /(update|insert\s+into)[\s\S]{0,80}("?Supplier"?)[\s\S]{0,200}(verification|insuranceOnFile|verifiedChecks|insuranceExpiresOn)/i,
    why: 'CLAUDE.md non-negotiable 2 and ADR-036: `/admin` is the only route to a VERIFIED status, and verification means a person looked at a certificate. SQL that writes a supplier\'s verification state forges that.',
  },
  {
    pattern: /(update|insert\s+into|delete\s+from)[\s\S]{0,80}"?ConditionReport"?/i,
    why: 'The conditions gate reads `ConditionReport` rows a person wrote (`docs/going-live.md` §7). An agent authoring a reading is an agent inventing the sea state the safety gate then trusts.',
  },
  {
    pattern: /\b(truncate|drop\s+(table|schema|database))\b/i,
    why: 'Destructive SQL. If this is a local test database, say so to a person and let them run it.',
  },
];

function read() {
  return new Promise((resolve) => {
    let buf = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (c) => { buf += c; });
    process.stdin.on('end', () => resolve(buf));
  });
}

const raw = await read();
let payload;
try {
  payload = JSON.parse(raw || '{}');
} catch {
  // A guard that fails closed on its own parse error blocks every command in
  // the session. Fail open and let the documented rules stand on their own.
  process.exit(0);
}

const command = payload?.tool_input?.command;
if (typeof command !== 'string' || command.length === 0) process.exit(0);

// The guard's own source quotes every pattern it blocks, so reading or
// grepping this file must not trip it.
if (/\.claude\/hooks\/deny-dangerous\.mjs/.test(command)) process.exit(0);

for (const rule of RULES) {
  if (rule.pattern.test(command)) {
    process.stderr.write(
      `Refused by .claude/hooks/deny-dangerous.mjs.\n\n${rule.why}\n\n` +
        'If this is wrong, the fix is to ask Andrew to run the command or to change the rule deliberately — not to reword the command past the pattern.\n',
    );
    process.exit(2);
  }
}

process.exit(0);
