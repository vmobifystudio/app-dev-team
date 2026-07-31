---
name: git-pr-strategy
description: Apply safe branching, commits, conflict resolution, review ownership, merge, rollback, and release-tag rules.
---

# Git and PR strategy

Use for every code or documentation change that will be reviewed, merged, released, reverted, or
shared with another agent. Read `knowledge/git-workflow.md` and `agent-isolation` first.

## Lifecycle

1. Run context preflight and confirm the base branch, ticket, worktree, and dirty-tree state.
2. Use one worktree per writing agent and one ticket per branch. Never stage blindly.
3. Keep commits coherent and reversible: implementation, tests, docs, and generated artifacts should
   be distinguishable when that helps review. Do not rewrite another agent's branch.
4. Before review, update from the declared integration branch and rerun the relevant gates. A review
   is stale when the source commit or required evidence changes.
5. The reviewer owns the verdict; the author fixes findings. No self-approval, no merge on a summary,
   and no merge while required checks are unknown.
6. Resolve conflicts by reading both sides and the governing spec. Never choose “ours” or “theirs”
   blindly. If the conflict changes behavior or contract, escalate to the owner of that contract.
7. Record the merge commit/tag, checks, evidence bundle, and rollback/revert path in the release record.

## Communication

Use the team ledger for material decisions, blockers, escalations, and handoffs. State what changed,
what was verified, what remains unknown, and the exact next action. Do not hide a failed command behind
“could not run”; name the missing toolchain or input.
