# `.claude/` — the agent harness

What an agent working on ARC Stay is given, and what it is refused.

| | |
| --- | --- |
| `agents/` | Focused reviewers. `CLAUDE.md` asks for an independent review before merging a change to inventory, money, the conditions gate or tenancy. |
| `skills/` | The procedures that get repeated. A skill is the answer to "how do we do this here", so that it is written once rather than rediscovered per session. |
| `hooks/deny-dangerous.mjs` | A `PreToolUse` guard. The non-negotiables that are irreversible, as refused tool calls rather than prose somebody might not read. |
| `settings.json` | The deny list, and the wiring for the hook. |

## The reviewers, and when each one is the right one

| Path touched | Reviewer |
| --- | --- |
| `prisma/**`, or any new query | `data-reviewer` |
| `src/modules/inventory/**`, anything inside a transaction, `src/modules/commerce/**` | `architecture-reviewer` **and** `data-reviewer` |
| `src/modules/auth/**`, `src/modules/tenancy/**`, `src/app/api/**`, server actions, anything that logs | `security-reviewer` |
| `src/modules/ai/**`, `src/modules/destination/conditions.ts` | `ai-safety-reviewer` |
| Any page or component | `ux-reviewer` |
| Any change in behaviour | `qa-reviewer` |

`release-captain` applies that table to a diff so nobody has to remember it.

## What no agent does

Not a style preference; each of these is somewhere a mistake cannot be taken
back, and the harness is arranged so an agent cannot make it alone.

- Consent to Prisma's destructive-action guard, or reset or push a database schema.
- Write a supplier's verification state, or an insurance check. `/admin` and a person who looked at a certificate are the only route (non-negotiable 2, ADR-036).
- Author a `ConditionReport`. The gate trusts those rows.
- Turn on `ARC_ENABLE_OUTBOUND_MESSAGING` (non-negotiable 6).
- Put a live Stripe key anywhere.
- Change a deployment's environment, promote, roll back, or pause a project.
- Merge or approve a pull request. The deny list covers the merge tools and
  `pull_request_review_write`, which is the tool that would submit an approval;
  the hook covers `gh pr merge` and `gh pr review`. A consequence worth knowing:
  an agent cannot post a GitHub *review* either, approving or otherwise. It
  posts its findings as a comment, which is how the reviewer agents here already
  work — they hold `Read`, `Grep`, `Glob` and `Bash`, and nothing else.

The hook enforces the first five and the command-line route to the last; the
deny list in `settings.json` covers the tools. A refusal names the document the
rule comes from; argue with the decision, not with the pattern.

The hook has **no exemption for its own path**. One existed and was a hole:
it allowed any command that mentioned the file, so a `cat` of it joined to a
forbidden command by a semicolon passed in full.
