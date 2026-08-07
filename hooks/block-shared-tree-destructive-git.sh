#!/bin/sh
# block-shared-tree-destructive-git — a PreToolUse hook that makes the destructive-command ban
# executable instead of merely written down.
#
# WHY THIS EXISTS
#
# `agent-isolation` has banned repo-wide destructive git commands since v1.4.0. On 2026-07-29 the
# orchestrator that had spent the day hardening that very rule spawned two writing agents into one
# shared checkout; one ran `git stash` + `git reset` to get a clean tree for a check, and 22 files
# of the other agent's uncommitted work vanished. Recovery was luck — the work happened to be in a
# stash. Had the command been `git checkout -- .`, it was gone.
#
# The security review then found the obvious thing: the ban was prose in four files, and the only
# test asserted THE BAN TEXT WAS PRESENT IN THE MARKDOWN. A documentation-presence check, not a
# behavioural one — a rule that cannot fail, guarding the incident that had just happened.
#
# `spawn-gate.sh` enforces the PRECONDITION (worktrees exist before spawning). This enforces the
# ACTION. They are different halves and neither substitutes for the other — and spawn-gate is
# invoked by markdown an orchestrator can skip, which is precisely what happened on 2026-07-29.
#
# SCOPE — narrow, because a blanket ban on `git reset` would be user-hostile
#
# It refuses ONLY when both are true:
#   1. the command is repo-wide destructive — it sweeps or discards work the caller did not write
#      individually, and
#   2. **this tree has uncommitted work.** That is the thing such a command destroys.
#
# A clean tree keeps every git command. A path-scoped command keeps working in any tree. So this
# cannot fire on everything, which matters: a gate that refuses constantly gets switched off, and a
# switched-off gate protects nothing.
#
# The first version keyed on agent worktrees existing. The security review probed both states and
# found the hole: DR4-027 was two writers in ONE checkout with NO worktrees, so the hook stood down
# in exactly the configuration it was written for. Keying on the harm rather than a proxy for it
# also covers the case the proxy had backwards — a solo developer with dirty state has MORE to lose
# from `git reset --hard`, not less.
#
# CONTRACT
#   stdin  : the PreToolUse payload (JSON) — the Bash command is read from it
#   exit 0 : allow
#   exit 2 : BLOCK, with the reason and the safe alternative on stderr
#
# Anything unparseable is ALLOWED. A hook that blocks on its own confusion is a hook that gets
# removed the first time it misfires on a legitimate command.

set -u

PAYLOAD=$(cat 2>/dev/null || true)
[ -n "$PAYLOAD" ] || exit 0

# Pull the command out without a JSON parser (there is none, and this must stay dependency-free).
#
# The first version of this used `\(...\|...\)` alternation, which is a GNU sed extension. BSD sed
# — i.e. macOS, i.e. the machine this plugin is mostly used on — does not support it and fails the
# substitution SILENTLY, leaving CMD empty, so the hook exited 0 and allowed everything. A gate that
# cannot fire, written on the day this repo spent hunting gates that cannot fire, and caught only
# because it was tested rather than read. Keep this POSIX; there is a portability assertion for it.
CMD=$(printf '%s' "$PAYLOAD" | tr '\n' ' ' | awk '
  {
    i = index($0, "\"command\"");
    if (i == 0) exit;
    rest = substr($0, i + 9);
    j = index(rest, "\"");
    if (j == 0) exit;
    rest = substr(rest, j + 1);
    out = "";
    for (k = 1; k <= length(rest); k++) {
      c = substr(rest, k, 1);
      if (c == "\\") { k++; out = out substr(rest, k, 1); continue }
      if (c == "\"") break;
      out = out c;
    }
    print out;
  }')
[ -n "$CMD" ] || exit 0

case "$CMD" in *git*) ;; *) exit 0 ;; esac

# Resolved once, used by both checks below. Not a git repository -> nothing here to guard.
ROOT=$(git rev-parse --show-toplevel 2>/dev/null) || exit 0

# --- a raw `git merge` INTO the integration branch, by anyone at all ------------------------------
#
# FOUND BY RUNNING A REAL SPRINT (H6, 2026-08-07). A `qa-engineer` agent, told in its own role file
# "you never merge your own work — tech-manager merges", ran `git merge --no-ff` directly onto
# `main` anyway. No board event backed it — no `review_requested`, no `approved`, no `merged` — so
# the work landed on the branch every other ticket builds from with zero provenance and zero review.
# `board.mjs` could not have stopped this: the rule it enforces is which EVENTS may be appended to
# the log, and this command never touched the log at all. It is DR4-027's shape at the git layer —
# a rule that was prose, defeated by an agent with a shell — caught by the same kind of hook that
# closed that one.
#
# THIS IS NOT A ROLE CHECK, because a hook has no reliable signal for which subagent is running —
# the payload carries a command, not an identity. It is a PATTERN check, and the pattern it refuses
# is one this repository has independently decided is always wrong now, for anyone: merging
# directly into the checked-out integration branch via `git merge`. `wave-integrate.mjs` used to do
# exactly this — `git merge --ff-only` on the live checkout — and B1 (the review that shipped
# alongside this hook) replaced it with a ref update precisely because merging into a checkout you
# might not even be standing on is unsafe. If the studio's OWN merge tool no longer does this, an
# agent should not be doing it by hand either — regardless of role.
#
# So this fires whenever: (a) the command contains `git merge`, (b) it is NOT `--ff-only`, and
# (c) the branch currently checked out in this tree is the project's DECLARED integration branch.
#
# `--ff-only` IS SPECIFICALLY EXEMPT, and that took a second pass to get right. `wave-integrate.mjs`
# prints exactly one documented manual fallback — `git checkout $BASE && git merge --ff-only
# $WAVE_BRANCH && git push origin $BASE` — for landing an already-vetted, fully-tested wave onto
# the integration branch by hand. Running the first version of THIS hook against that exact command
# (while landing H6's own wave) blocked it: a fast-forward-only merge cannot create a merge commit,
# cannot lose history, and cannot land anything that was not already a strict descendant of HEAD —
# it is the same operation `wave-integrate.mjs`'s own `git fetch . src:dst` performs, in a git
# subcommand that happens to be spelled `merge`. The risk this hook exists to stop is a `--no-ff`
# (or plain) merge that FABRICATES a merge commit combining an unreviewed branch into the
# integration branch — which is exactly the qa-engineer's `git merge --no-ff -m "..." <branch>`
# that started this. Gating on the literal `--ff-only` flag, rather than trying to compute whether
# history WOULD allow a fast-forward, keeps this a static check with no side effects.
case "$CMD" in
  *"--ff-only"*) MERGE_CMD=0 ;;
  *"git merge"*) MERGE_CMD=1 ;;
  *) MERGE_CMD=0 ;;
esac
if [ "$MERGE_CMD" = "1" ]; then
  HEAD=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "")
  # Mirror scripts/integration-branch.sh's own resolution — declared in docs/23-git-strategy.md
  # (or docs/20-architecture.md), falling back to `main` only when no such doc exists at all. Kept
  # deliberately minimal and dependency-free rather than shelling out to that script, because this
  # hook must not assume any repo-relative path (like $CLAUDE_PLUGIN_ROOT) is set in its own process.
  DECLARED=""
  for doc in "$ROOT/docs/23-git-strategy.md" "$ROOT/docs/20-architecture.md"; do
    [ -f "$doc" ] || continue
    DECLARED=$(sed -nE 's/.*[Ii]ntegration branch[[:space:]]*(:|=|—|–|-|\||is)[[:space:]]*[^A-Za-z0-9_/-]*([A-Za-z0-9._/-]+).*/\2/p' "$doc" | head -n 1)
    [ -n "$DECLARED" ] && break
  done
  [ -n "$DECLARED" ] || DECLARED="main"

  if [ -n "$HEAD" ] && [ "$HEAD" = "$DECLARED" ]; then
    cat >&2 <<EOF
BLOCKED — a raw \`git merge\` directly onto the integration branch (\`$DECLARED\`).

  command : $CMD
  why     : merging straight onto the checkout every other ticket builds from leaves no board
            record — no review_requested, no approved, no merged event — so the work lands with
            zero provenance and zero review. Measured live (H6, 2026-08-07): a qa-engineer agent
            did exactly this, bypassing code-reviewer and the tech-manager merge gate entirely.

This studio's own merge tool no longer merges into a live checkout for the same reason
(wave-integrate.mjs updates the ref instead) — an agent should not do it by hand either.

Instead:
  - land a whole wave                     node scripts/wave-integrate.mjs --wave <N> [--push]
  - landing a wave branch by hand?        git merge --ff-only <wave-branch>   (fast-forward only —
                                           this is the one form that IS allowed here, because it
                                           cannot fabricate a merge commit or lose history)
  - resolving a real conflict by hand?    do it in a DEDICATED worktree
                                           (.agent-wt/integration-wave-N), never on this checkout
EOF
    exit 2
  fi
fi

# --- is there anything here to destroy? ---------------------------------------------------------
#
# The first version gated on agent worktrees existing (.agent-wt/, .claude/worktrees/). The security
# review found the hole by probing both states: DR4-027 — the incident this hook was written for —
# was two writers in ONE shared checkout with NO worktrees, so the hook stood down in exactly the
# configuration that caused it. It protected the isolated case and went silent in the unisolated
# one. A guard for an incident that does not fire on that incident.
#
# The trigger is now the harm, not a proxy for it: **uncommitted work exists in this tree.** That is
# what a repo-wide destructive command destroys, and it is the same loss whether the work belongs to
# a sibling agent or to the human sitting at the keyboard — a solo developer with dirty state has
# MORE to lose from `git reset --hard`, not less, which the worktree proxy had exactly backwards.
#
# A clean tree keeps every command, so this still cannot fire on everything. That matters: a gate
# that refuses constantly gets switched off, and a switched-off gate protects nothing.
DIRTY=$(git status --porcelain -uall 2>/dev/null | head -n 1)
[ -n "$DIRTY" ] || exit 0

# --- is the command repo-wide destructive? ------------------------------------------------------
# Each pattern discards or sweeps work the caller may not have written. A path-scoped command
# (`git checkout -- src/one.swift`, `git add src/`) is NOT matched: explicit paths are the
# documented safe form, and banning them would ban the alternative we tell people to use.
NORM=$(printf '%s' "$CMD" | tr -s ' ')
VERDICT=""
case "$NORM" in
  *"git checkout -- ."*|*"git checkout -- :/"*)   VERDICT="git checkout -- . discards every uncommitted change in the tree" ;;
  *"git checkout -f"*|*"git switch -f"*|*"git switch --discard-changes"*)
                                                   VERDICT="a forced checkout/switch discards every uncommitted change in the tree" ;;
  *"git restore ."*|*"git restore -- ."*|*"git restore --staged --worktree"*|*"git restore -SW"*)
                                                   VERDICT="git restore over the whole tree discards every uncommitted change" ;;
  *"git reset --hard"*|*"git reset --keep"*)       VERDICT="git reset --hard/--keep discards uncommitted changes in the tree" ;;
  *"git clean -"*)                                 VERDICT="git clean deletes untracked files, including another agent's new files" ;;
  *"git push --force"*|*"git push -f "*|*"git push --force-with-lease"*)
                                                   VERDICT="a force push rewrites published history others may have based work on" ;;
  *"git branch -D"*)                               VERDICT="git branch -D deletes an unmerged branch and the commits only it referenced" ;;
  *"git stash"*)
    # `git stash push -- <path>` is scoped and fine; a bare stash sweeps the whole tree.
    case "$NORM" in *"git stash"*" -- "*) : ;; *) VERDICT="git stash sweeps the whole tree, including work you did not write — this is the exact command that cost 22 files on 2026-07-29" ;; esac ;;
  *"git add -A"*|*"git add --all"*|*"git add ."*)  VERDICT="git add -A/. stages another agent's half-written files into your commit" ;;
  *"git commit -a"*)                               VERDICT="git commit -a commits every modified tracked file, including files you did not write" ;;
esac
[ -n "$VERDICT" ] || exit 0

DIRTY_N=$(git status --porcelain -uall 2>/dev/null | grep -c . || echo "?")

cat >&2 <<EOF
BLOCKED — repo-wide destructive git command, and this tree has uncommitted work.

  command : $CMD
  why     : $VERDICT
  at risk : $DIRTY_N uncommitted path(s) in this tree

There is uncommitted work here — yours, another agent's, or both. This is the
\`agent-isolation\` Rule 2 ban, enforced rather than described — it was prose on
2026-07-29 and 22 files were lost to exactly this (DR4-027).

Instead:
  - stage explicit paths            git add path/one path/two
  - discard one file you wrote      git checkout -- path/you/wrote
  - need a clean tree to test?      copy the repo to a temp dir and test there;
                                    never clean the tree others are working in
  - found changes you did not make? STOP and report them. Do not discard
                                    anything you did not write (Rule 5).
EOF
exit 2
