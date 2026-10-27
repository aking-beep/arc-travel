# Harness log

Why each check in `.claude/` exists. One row per amendment, newest first.

This file is the first thing to read when a check looks pointless and somebody
is tempted to delete it. A row names the miss that prompted the rule, which is
the thing nobody remembers six months later. An amendment that cannot fill in
the "because" column probably should not land.

Amendments are proposed by whichever agent noticed the gap, following
`.claude/skills/arc-harness-feedback/SKILL.md`, and land as ordinary pull
requests. Nothing in `.claude/` edits itself.

| Date | What changed | Because |
| --- | --- | --- |
| 2026-10-27 | `release-captain` hands its collected amendments back rather than committing them; `arc-harness-feedback` says who writes one | The captain was told to put the reviewers' amendments on the PR as a commit. It holds no `Write` or `Edit`, and reviewers may only propose — so the commit the loop depends on had nobody to make it |
| 2026-10-27 | Every agent now closes with a proposed amendment to the relevant file, or an explicit "none" | The harness had no way to improve from what it learned. The four misses below were all found by an outside reviewer, not by anything in here |
| 2026-10-27 | The guard lost its exemption for its own path | The exemption matched the *command*, not the file's contents, so `cat .claude/hooks/deny-dangerous.mjs; PRISMA_USER_CONSENT…=1 npx prisma migrate reset` passed in full — one semicolon away from every rule being off |
| 2026-10-27 | `conditions-steward` and `verification-diary` given explicit `tools` | Both omitted the frontmatter, so two agents documented as read-only inherited `Write` and `Edit` and could change the very rows they exist to report on |
| 2026-10-27 | Deny list extended to `pull_request_review_write`; the guard covers `gh pr merge` and `gh pr review` | `.claude/README.md` claimed no agent could approve a pull request. Only the merge tools were denied, so the claim was false |
| 2026-10-27 | The routing tables point at `src/modules/destination/conditions.ts` | They pointed at `conditions/**`, but the gate is a file, not a directory. The glob matched nothing, so `release-captain` would have skipped `ai-safety-reviewer` on a change to the safety gate — the reviewer that matters most, missed by a glob |
