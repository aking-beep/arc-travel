---
name: arc-adr
description: Record a decision in ARC Stay — write the ADR and the matching CLAUDE.md "looks wrong but is not" row in the same change so the two cannot drift. Use when overturning something that looks odd, or when a change leaves behind code a later reader would want to simplify.
---

# Recording a decision

`docs/decisions.md` and the "Things that look wrong but are not" table in
`CLAUDE.md` are one artefact in two places. The table is the index a reader hits
first; the ADR is why. **Write both in the same change.** A row with no ADR is a
claim, and an ADR with no row gets re-litigated by the next person.

## When this is needed

- You are overturning something the table already explains. Then you are
  arguing with an existing ADR: say which, and either amend it or supersede it.
  ADR-028 supersedes a row rather than deleting it, and the table still says
  so.
- Your change leaves code that looks wrong. If a reasonable reader would try to
  simplify it and break something, it needs a row.
- You relaxed, or want to relax, one of the eight non-negotiables. That is a
  conversation with Andrew first — a non-negotiable is a product commitment, not
  a style preference, and it is not an agent's to trade away.

## The ADR

Match what is already in `docs/decisions.md`: the next number, the decision
stated in one sentence, what was tried or considered, and the consequence that
makes it load-bearing. The useful ones in this repository all name the **bug
that would come back** if somebody undid them. Write that sentence; it is the
whole value of the file.

Where a constraint has to be added `NOT VALID`, say why in the ADR itself —
ADR-036 and ADR-041 both do, and both explain that a later migration cannot fix
it because `migrate deploy` stops at the first failure.

## The row

One line in the `CLAUDE.md` table: what it looks like, and what it actually is,
ending in the ADR number. Keep the voice of the rows around it — they are
written for somebody who has just been surprised by the code, not for somebody
browsing.

## Then

Re-read your row as somebody who has not read the ADR. If it does not tell them
whether they may change the thing, rewrite it.
