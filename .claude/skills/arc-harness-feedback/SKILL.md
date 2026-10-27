---
name: arc-harness-feedback
description: Propose an amendment to this repository's own agents, skills or guard after a review, an incident or a bug fix — as a reviewable change, never a silent edit. Use at the end of any review, triage or fix, and whenever the harness missed something it should have caught.
---

# Amending the harness

Every agent and skill in `.claude/` is a fixed file. It behaves the same way
every run until somebody changes it in a pull request, which is the point: a
harness that rewrites itself is a harness nobody can audit.

What it does do is **notice**. At the end of a review, an incident or a fix, the
thing that just happened often shows that a check was missing, a path was
wrong, or a rule was stated in a place nobody reads. That observation is worth
more then than it will ever be again. Write it down as a proposed amendment.

## The rule

**Propose, never self-edit.** An amendment lands the way any change lands: in a
pull request Andrew reviews. There is no path where an agent changes its own
instructions, or another agent's, between one run and the next. If a change
feels too obvious to review, it is still too obvious to skip review.

## When one is warranted

- **The harness missed something.** A reviewer did not catch a defect it exists
  to catch; a glob matched nothing; a skill sent somebody to a file that moved.
  This is the strongest case, and the amendment should name the miss.
- **The code moved under a rule.** A path, a script name or a file the harness
  points at changed.
- **A decision was made that the next session will not know.** Usually this is
  an ADR plus a `CLAUDE.md` row (use `arc-adr`). It belongs in `.claude/` only
  when it changes *how an agent should work*, not what the product does.
- **An operator reported something nobody could act on.** If a report did not
  say what it was waiting on, fix the agent's report section.

## When one is not

Say "nothing needs one" and move on. That is the normal outcome, and saying it
is useful — it means the question was asked.

- A one-off mistake that the existing rules already cover. The rule was not
  read; adding a second copy of it makes both weaker.
- Anything that would **relax** a non-negotiable, a deny-list entry or a guard
  pattern. Those are Andrew's to loosen, deliberately and on their own, never
  as a tidy-up at the end of unrelated work. If a guard refused something it
  should not have, say so plainly and let a person decide — do not widen the
  pattern to make your command pass.
- A rule you cannot state without naming the specific incident. If it only
  makes sense as a story, it is a log entry, not a check.
- Style. The reviewers are deliberately not style reviewers.

## Writing it

Keep it to the smallest change that would have caught the thing:

1. **Name the miss in one sentence**, concretely. "`conditions/**` matched
   nothing because the gate is a file" beats "improve path coverage".
2. **Pick the one file.** The agent that should have caught it, the skill
   somebody should have read, or the guard. Not all three — a rule in three
   places drifts in two of them.
3. **Write the check as a question an agent can answer** about a diff, in the
   voice of the file's existing checks.
4. **Add a row to `.claude/harness-log.md`**: the date, the miss, what changed.
   That file is why a check exists, which is the first thing somebody wants
   when they are tempted to delete it.
5. **Separate commit**, so it can be dropped without losing the fix it rode in
   with. Say in the PR body that the amendment is separable.

Who writes it matters. A reviewer or an operator **proposes** — it says the
file and the check and stops there, because none of them holds `Write` or
`Edit`. The session driving the work is what commits it, including the
amendments `release-captain` hands back. If no session is in a position to
commit, the proposal goes to Andrew in words and waits; it does not get written
by whoever noticed it.

With no PR in flight — an incident, a question, a read-only triage — put the
proposal in the reply instead, in the same shape, and let Andrew say whether it
becomes a change.

## Closing a review, a triage or a fix

End with one of two things, always:

> **Harness amendment:** `<file>` — `<the check>`, because `<the miss>`.

or

> **Harness amendment:** none. `<what already covered this>`.

The second is not a formality. An agent that proposes an amendment every run is
an agent padding its instruction files, and the files are read by people.
