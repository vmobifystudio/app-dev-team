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

#
# HOW A COMMAND IS READ — a small shell tokenizer, not substring matching
#
# v1–v3 matched fixed substrings against the raw command (`*"git reset --hard"*`). An independent
# review (2026-11) reproduced both failure directions of that, live:
#   - FALSE NEGATIVES: `git reset -q --hard`, `git reset HEAD --hard`, `git -C . reset --hard`,
#     `git -c k=v stash`, `git checkout .`, `git commit -m x -a`, `git add -u`, `git add :/` — all
#     exit 0 on a dirty tree, because the destructive flag was not where the fixed string expected.
#     And `--ff-only` ANYWHERE in the command exempted EVERY merge in it
#     (`git merge --ff-only x; git merge --no-ff feat`).
#   - FALSE POSITIVES that blocked real work: `grep -n "git add -A" README.md`,
#     `git log --grep="git reset --hard"`, a heredoc whose BODY mentions `git add .`, and
#     `git stash list` — the pattern text appeared, but no such git command would run.
#   - The JSON extractor turned `\n` into a literal `n`, so a multi-line command was one glued line.
#
# So the command is now tokenized the way a shell would: quotes make one word (a quoted string is
# an ARGUMENT, never a command), heredoc bodies are dropped (they are data — except when fed to
# `sh`/`bash`, which runs them), `$(...)`, backticks, `( )`, `sh -c`/`bash -c` and `eval` are parsed
# recursively (they DO execute), and the command splits into segments on `; && || | & ( )` and
# newline. A segment matters only when `git` is its COMMAND WORD (after env assignments and
# `if/then/do/sudo/env/…`), and each segment is judged on its own subcommand and flags — so an
# exemption flag exempts only its own segment. The awk program prints one line per segment that
# needs a verdict; the shell below gives it one.
#
#   D <TAB> - <TAB> dir <TAB> reason     repo-wide destructive — blocked only if `dir` is dirty
#   M <TAB> ref|- <TAB> dir <TAB> verb   a merge — blocked if `dir` has the integration branch
#                                         checked out (and `ref`, when given, is not that branch)
#   R <TAB> ref <TAB> dir <TAB> verb     a ref write — blocked if `ref` IS the integration branch
#
# WHICH TREE. v1–v3 checked the hook PROCESS's own cwd. The payload carries the caller's `cwd`, and
# a segment can `cd X &&` or `git -C X` somewhere else entirely, so dirtiness is evaluated in the
# directory each segment actually runs in. A directory that cannot be known statically (`cd "$X"`,
# `cd -`, a missing path) FAILS CLOSED, for the destructive class only.
#
# ponytail: a static tokenizer, not a shell. Aliases, functions, `xargs git …`, and a command
# string assembled at runtime are out of reach — closing those means not being a static hook.

set -u

PAYLOAD=$(cat 2>/dev/null || true)
[ -n "$PAYLOAD" ] || exit 0

# Pull a string out without a JSON parser (there is none, and this must stay dependency-free).
#
# The first version of this used `\(...\|...\)` alternation, which is a GNU sed extension. BSD sed
# — i.e. macOS, i.e. the machine this plugin is mostly used on — does not support it and fails the
# substitution SILENTLY, leaving CMD empty, so the hook exited 0 and allowed everything. A gate that
# cannot fire, written on the day this repo spent hunting gates that cannot fire, and caught only
# because it was tested rather than read. Keep this POSIX; there is a portability assertion for it.
#
# `\n` and `\t` decode to a real newline and tab. Decoding them to the bare letter (as v1–v3 did)
# made `git<TAB>reset --hard` read as `gittreset` and glued every line of a heredoc with an `n`.
json_str() {
  printf '%s' "$PAYLOAD" | tr '\n' ' ' | awk -v key="\"$1\"" '
  {
    i = index($0, key);
    if (i == 0) exit;
    rest = substr($0, i + length(key));
    j = index(rest, "\"");
    if (j == 0) exit;
    rest = substr(rest, j + 1);
    out = "";
    for (k = 1; k <= length(rest); k++) {
      c = substr(rest, k, 1);
      if (c == "\\") {
        k++; c = substr(rest, k, 1);
        if (c == "n" || c == "r") c = "\n"; else if (c == "t") c = "\t";
        out = out c; continue
      }
      if (c == "\"") break;
      out = out c;
    }
    printf "%s", out;
  }'
}
CMD=$(json_str command)
[ -n "$CMD" ] || exit 0
case "$CMD" in *git*) ;; *) exit 0 ;; esac

BASE=$(json_str cwd)
[ -n "$BASE" ] && [ -d "$BASE" ] || BASE=$(pwd)
AGENT=$(json_str agent_id)
# This hook's own plugin: the shared wrapper table (G7-8), the branch resolver (G7-11) and the
# operational-paths list (W7-9) all live beside it.
PLUGIN=$(cd "$(dirname "$0")/.." 2>/dev/null && pwd)

# G7-10: a segment may run in one of SEVERAL directories — a `cd` that may not run or may fail
# (after && / ||, in a pipeline or behind &, inside if/while/case/a function body, popd, a cd the
# command redefines, a directory it cannot enter) keeps the old one as a candidate. Candidates are
# joined by \034; every verdict line is printed once per candidate.
SEGS=$(printf '%s\n' "$CMD" | awk -v base="$BASE" -v home="${HOME:-}" -v wrapfile="$PLUGIN/hooks/wrappers.txt" '
function emit(kind, ref, dir, why,    C, n, j) {
  n = split(dir, C, SEP)
  for (j = 1; j <= n; j++) printf "%s\t%s\t%s\t%s\n", kind, (ref == "" ? "-" : ref), C[j], why
}
function addc(list, d) { if (list == "") return d; if (index(SEP list SEP, SEP d SEP)) return list; return list SEP d }
function union(a, b,    C, n, j) { n = split(b, C, SEP); for (j = 1; j <= n; j++) a = addc(a, C[j]); return a }
# Every candidate is a directory the shell can enter (so a cd to it cannot fail).
function enterable(list,    C, n, j) {
  n = split(list, C, SEP)
  for (j = 1; j <= n; j++) if (C[j] == "?" || index(C[j], "\047") || system("test -d \047" C[j] "\047 && test -x \047" C[j] "\047")) return 0
  return 1
}

# A directory a segment runs in, or "?" when it cannot be known without running anything.
# E2E-3: `$(mktemp …)` is a FRESH directory this command made — no other work in it, never the main
# checkout — so it stands as "@TMP". `NAME=literal` / `NAME=$(mktemp …)` bind for the rest of the
# command (VARS), so `cd "$W"` to a bound name is that path. Anything else assigned is unknown again.
function once(nm,    t) { t = CMDALL; return gsub("(^|[^$A-Za-z0-9_{])" nm "([^A-Za-z0-9_]|$)", "", t) }
function lit(t) { gsub(/[$~]/, "\002", t); return t }   # quoted/escaped: neither expands
function sub_word(body) { return (body ~ /^[ \t]*mktemp([ \t]+-[A-Za-z]+)*[ \t]*$/) ? "\001MKTEMP\001" : "$(...)" }
function expand(x,    nm, rest) {
  if (x ~ /^\001MKTEMP\001/) return (substr(x, 9) ~ /(^|\/)\.\.(\/|$)|[$`*?\001\002]/) ? "?" : "@TMP"
  if (!match(x, /^(\$[A-Za-z_][A-Za-z0-9_]*|\$\{[A-Za-z_][A-Za-z0-9_]*\})/)) return x   # ${T:+x}, ${T%/*}: unknown
  nm = substr(x, 2, RLENGTH - 1); gsub(/[{}]/, "", nm); rest = substr(x, RLENGTH + 1)
  if (!(nm in VARS) || rest ~ /^[A-Za-z0-9_]/ || once(nm) != 1) return x
  if (VARS[nm] == "@TMP") return (rest ~ /(^|\/)\.\.(\/|$)|[$`*?\001\002]/) ? "?" : "@TMP"
  return VARS[nm] rest
}
function joindir1(cur, x) {
  x = expand(x)
  if (x == "@TMP") return (cur == "?") ? "@TMP" : "@TMP"
  if (cur == "@TMP" && x !~ /^[\/~]/ && x !~ /[$`*?\001\002]/ && x != "-" && x !~ /(^|\/)\.\.(\/|$)/) return "@TMP"
  if (cur == "?" || cur == "@TMP" || x == "" || x == "-" || x ~ /[$`*?\001\002]/) return "?"
  if (x ~ /^~/) { if (home == "" || x !~ /^~(\/|$)/) return "?"; x = home substr(x, 2) }   # ~+ ~- ~user ~N: unknown
  return (x ~ /^\//) ? x : cur "/" x
}
function lex1(p,    C, n, j, o, k, out) {
  if (p !~ /^\// || p !~ /(^|\/)\.\.?(\/|$)/) return p
  n = split(p, C, "/"); k = 0
  for (j = 1; j <= n; j++) { if (C[j] == "" || C[j] == ".") continue; if (C[j] == "..") { if (k) k--; continue } o[++k] = C[j] }
  out = ""; for (j = 1; j <= k; j++) out = out "/" o[j]
  return out == "" ? "/" : out
}
function lexdir(d, P,    C, n, j, out) { n = split(d, C, SEP); out = ""; for (j = 1; j <= n; j++) out = addc(out, (P && C[j] ~ /(^|\/)\.\.(\/|$)/) ? "?" : lex1(C[j])); return out }
function joindir(cur, x,    C, n, j, out) { n = split(cur, C, SEP); out = ""; for (j = 1; j <= n; j++) out = addc(out, joindir1(C[j], x)); return out }

# A pathspec that names the whole tree.
function whole(x) { return x == "." || x == "./" || x == ":/" || x == ":/." || x == ":(top)" || x == "*" }
function heads(r) { sub(/^refs\/heads\//, "", r); return r }
function has(A, na, f,    j) { for (j = 1; j <= na; j++) { if (A[j] == "--") return 0; if (A[j] == f) return 1 } return 0 }
function pos(A, na, P,    j, np, dd) {
  split("", P); np = 0; dd = 0
  for (j = 1; j <= na; j++) { if (!dd && A[j] == "--") { dd = 1; continue } if (dd || A[j] !~ /^-/) P[++np] = A[j] }
  return np
}
function anywhole(P, np,    j) { for (j = 1; j <= np; j++) if (whole(P[j])) return 1; return 0 }

# First word that is actually run: past env assignments, shell keywords, and wrapper commands WITH
# their flags, flag values and leading operands (PR46-2: `timeout 30 git …`, `env -i git …`,
# `sudo -u me git …`, `xargs -n1 git …`, `flock /tmp/l git …` all run git).
function cmdat(W, nw,    i, w, k) {
  i = 1
  while (i <= nw) {
    if (W[i] ~ /^[A-Za-z_][A-Za-z0-9_]*=/ || W[i] in SKIP) { i++; continue }
    w = W[i]; sub(/^.*\//, "", w)
    if (!(w in WRAP)) break
    for (i++; i <= nw && (W[i] ~ /^-/ || W[i] ~ /^[A-Za-z_][A-Za-z0-9_]*=/); i++)
      if (index(WV[w], " " W[i] " ")) i++
    for (k = WP[w]; k > 0 && i <= nw; k--) i++
  }
  return i
}

# PR47-9: what a clean/stash sweeps, parsed from ITS OWN flags (a glob over the whole command read
# `stash push -m update-ui` as -u): "i" ignored files too (clean -x/-X, stash -a/--all), "u"
# untracked files (clean without -x, stash -u/--include-untracked), "" neither (a plain stash).
function sweep(sc, A, na,    j, x, q, c, m) {
  m = (sc == "clean") ? "u" : ""
  for (j = 1; j <= na && A[j] != "--"; j++) {
    x = A[j]
    if (x == "-m" || x == "--message") { j++; continue }
    if (x ~ /^--/) {
      if (sc == "clean" && x ~ /^--ignored/) return "i"
      if (sc == "stash" && x == "--all") return "i"
      if (sc == "stash" && x == "--include-untracked") m = "u"
      continue
    }
    if (x !~ /^-./) continue
    for (q = 2; q <= length(x); q++) {
      c = substr(x, q, 1)
      if (sc == "stash" && c == "m") { if (q == length(x)) j++; break }
      if (sc == "clean" && (c == "x" || c == "X")) return "i"
      if (sc == "stash" && c == "a") return "i"
      if (sc == "stash" && c == "u") m = "u"
    }
  }
  return m
}

function classify(sc, A, na, d,    P, np, j, r, src, dst, plus, force, del, all, st, wt, x, q, c, k, L) {
  np = pos(A, na, P)
  if (sc == "reset") {
    if (has(A, na, "--hard") || has(A, na, "--keep") || has(A, na, "--merge"))
      emit("D", "", d, "git reset --hard/--keep discards uncommitted changes in the tree")
  } else if (sc == "checkout" || sc == "switch") {
    if (has(A, na, "-f") || has(A, na, "--force") || has(A, na, "--discard-changes"))
      emit("D", "", d, "a forced checkout/switch discards every uncommitted change in the tree")
    else if (sc == "checkout" && anywhole(P, np))
      emit("D", "", d, "git checkout -- . discards every uncommitted change in the tree")
    # R7-7: a branch switch (judged below: only a subagent, only in the main checkout of a studio project).
    if (sc == "switch" || has(A, na, "-b") || has(A, na, "-B") || has(A, na, "--orphan") || has(A, na, "--detach")) emit("S", "", d, sc)
    else if (np == 1 && !has(A, na, "--")) emit("S", P[1], d, sc)
  } else if (sc == "read-tree") {
    if (has(A, na, "-u")) emit("D", "", d, "git read-tree -u rewrites the working tree from the index it reads")
  } else if (sc == "checkout-index") {
    if ((has(A, na, "-f") || has(A, na, "--force")) && (has(A, na, "-a") || has(A, na, "--all")))
      emit("D", "", d, "git checkout-index -f -a overwrites every tracked file in the tree")
  } else if (sc == "restore") {
    st = has(A, na, "-S") || has(A, na, "--staged"); wt = has(A, na, "-W") || has(A, na, "--worktree")
    if (has(A, na, "-SW") || has(A, na, "-WS")) st = wt = 1
    if ((st && wt) || (!st && anywhole(P, np)))
      emit("D", "", d, "git restore over the whole tree discards every uncommitted change")
  } else if (sc == "clean") {
    if (na > np && !has(A, na, "-n") && !has(A, na, "--dry-run"))
      emit("D", sweep(sc, A, na), d, "git clean deletes untracked files, including another agent'"'"'s new files")
  } else if (sc == "push") {
    force = 0
    for (j = 1; j <= na && A[j] != "--"; j++) if (A[j] == "-f" || A[j] ~ /^--force/) force = 1
    del = has(A, na, "-d") || has(A, na, "--delete")
    for (j = 2; j <= np; j++) {
      r = P[j]; plus = sub(/^\+/, "", r)
      if (index(r, ":")) { src = r; sub(/:.*$/, "", src); dst = r; sub(/^[^:]*:/, "", dst) } else src = dst = r
      if (plus || force || del || heads(src) != heads(dst)) emit("R", heads(dst), d, "push")
      if (plus) force = 1
    }
    if (force) emit("D", "", d, "a force push rewrites published history others may have based work on")
  } else if (sc == "fetch") {
    for (j = 2; j <= np; j++) if (index(P[j], ":")) { dst = P[j]; sub(/^[^:]*:/, "", dst); emit("R", heads(dst), d, "fetch") }
  } else if (sc == "branch") {
    force = 0
    for (j = 1; j <= na && A[j] != "--"; j++) if (A[j] == "-f" || A[j] == "--force" || A[j] == "-M" || A[j] == "-C") force = 1
    if (force) for (j = 1; j <= np; j++) emit("R", heads(P[j]), d, "branch")
    if (has(A, na, "-D") || (force && (has(A, na, "-d") || has(A, na, "--delete"))))
      emit("D", "", d, "git branch -D deletes an unmerged branch and the commits only it referenced")
  } else if (sc == "update-ref") {
    if (np >= 1 && P[1] ~ /^refs\/heads\//) emit("R", heads(P[1]), d, "update-ref")
  } else if (sc == "symbolic-ref") {
    # C5G-6: pointing refs/heads/<integration> at another branch moves it as surely as update-ref.
    if (np >= 1 && P[1] ~ /^refs\/heads\// && (np >= 2 || has(A, na, "-d") || has(A, na, "--delete"))) emit("R", heads(P[1]), d, "symbolic-ref")
  } else if (sc == "stash") {
    # list/show/pop/apply/branch/create/store do not discard the tree. A bare stash, push and save
    # sweep it — unless path-scoped after `--`. drop/clear destroy entries on the stack every
    # worktree of this repo shares.
    x = (na ? A[1] : "")
    if (x == "drop" || x == "clear")
      emit("D", "", d, "git stash drop/clear destroys stash entries, and every worktree of this repo shares that stack")
    else if (x == "" || x == "push" || x == "save" || x ~ /^-/) {
      for (j = 1; j <= na && A[j] != "--"; j++) ;
      if (j > na) emit("D", sweep(sc, A, na), d, "git stash sweeps the whole tree, including work you did not write — this is the exact command that cost 22 files on 2026-07-29")
    }
  } else if (sc == "add") {
    all = 0
    for (j = 1; j <= na && A[j] != "--"; j++) if (A[j] == "-A" || A[j] == "--all" || A[j] == "-u" || A[j] == "--update") all = 1
    if (anywhole(P, np) || (all && np == 0))
      emit("D", "", d, "git add -A/-u/. stages another agent'"'"'s half-written files into your commit")
  } else if (sc == "commit") {
    # Option VALUES are skipped, or `git commit -m -a` style messages would read as flags.
    all = 0; k = 0; split("", L)
    for (j = 1; j <= na; j++) {
      x = A[j]
      if (x == "--") { for (j++; j <= na; j++) L[++k] = A[j]; break }
      if (x == "--all") all = 1
      else if (x ~ /^--(message|file|reuse-message|reedit-message|template|author|date|fixup|squash|cleanup|trailer)$/) j++
      else if (x ~ /^--/) ;
      else if (x ~ /^-./) {
        for (q = 2; q <= length(x); q++) {
          c = substr(x, q, 1)
          if (c == "a") all = 1
          if (index("mFCct", c)) { if (q == length(x)) j++; break }
        }
      } else L[++k] = x
    }
    if (all || anywhole(L, k))
      emit("D", "", d, "git commit -a commits every modified tracked file, including files you did not write")
  } else if (sc == "merge") {
    if (!has(A, na, "--ff-only") && !has(A, na, "--abort") && !has(A, na, "--continue") && !has(A, na, "--quit"))
      emit("M", "", d, "merge")
  } else if (sc == "pull") {
    if (!has(A, na, "--ff-only")) {
      if (has(A, na, "--no-ff")) emit("M", "", d, "pull")
      else if (np >= 2) emit("M", heads(P[2]), d, "pull")
    }
  }
}

# One segment. Returns the directory later segments run in (a `cd` carries forward). `unsure`:
# the cd may not run here (see SEGS above), so the old directory stays a candidate.
# Codex P1 on #50: a nested parse is another shell (or may not run) — its assignments bind nothing here.
# ...and a cd inside it moves nothing out here: LASTCD is restored, so no outer && chain starts there.
function nparse(s, dir,    sv) { sv = LASTCD; NEST++; parse(s, dir); NEST--; LASTCD = sv }
# Codex round 7: a separate shell process sees none of the bindings made in this command.
function xparse(s, dir,    k, SV) { for (k in VARS) { SV[k] = VARS[k]; delete VARS[k] }; nparse(s, dir); for (k in VARS) delete VARS[k]; for (k in SV) VARS[k] = SV[k] }
function seg(W, nw, dir, unsure,    i, j, cmd, g, A, na, x, nd) {
  LASTCD = ""
  i = cmdat(W, nw)
  if (i > nw) {
    for (j = 1; j <= nw; j++) if (match(W[j], /^[A-Za-z_][A-Za-z0-9_]*=/)) {
      x = substr(W[j], RLENGTH + 1); nd = substr(W[j], 1, RLENGTH - 1)
      if (unsure || NEST) delete VARS[nd]
      else if (x ~ /^\001MKTEMP\001/ && substr(x, 9) !~ /[$`*?\001\002]|(^|\/)\.\.(\/|$)/) VARS[nd] = "@TMP"
      else if (x != "" && x !~ /[$`*?\001\002]/ && x !~ /^~/ && !(nd in IMPLICIT)) VARS[nd] = x
      else delete VARS[nd]
    }
    return dir
  }
  cmd = W[i]
  if (cmd == "cd" || cmd == "pushd" || cmd == "popd") {
    if (cmd == "popd") { nd = (PN > 0) ? PSTK[PN--] : "?"; unsure = 1; LASTCD = "?" }
    else {
      for (j = i + 1; j <= nw && W[j] ~ /^-./; j++) ;
      nd = joindir(dir, (j <= nw) ? W[j] : home)
      for (x = i + 1; x < j; x++) if (W[x] ~ /^-[A-Za-z]*P/) break
      nd = (x < j) ? "?" : lexdir(nd, 0)   # `cd -P` resolves symlinks first: where it lands is unknown here
      # `pushd -n` / `pushd +N` / a bare `pushd` edit, rotate or swap the stack: where it lands is unknown
      if (cmd == "pushd" && (j > i + 1 || j > nw || W[j] ~ /^[+-][0-9]/)) { nd = "?"; unsure = 1 }
      if (cmd == "pushd") PSTK[++PN] = dir
      # `! cd X`: the `!` makes a FAILED cd the success path — what follows may run where we were
      # ...and a cd behind a wrapper (`command -v cd`, `builtin cd`, `time cd`) may not move at all,
      # or may: either way it is never trusted, and it ends any chain
      for (j = 1; j < i && W[j] != "!" && (W[j] in SKIP || W[j] ~ /^[A-Za-z_][A-Za-z0-9_]*=/); j++) ;
      if (j < i) { unsure = 1; LASTCD = "?" }
      else if (!SHADOW) LASTCD = nd
    }
    return (unsure || SHADOW || !enterable(nd)) ? union(nd, dir) : nd
  }
  if (cmd ~ /(^|\/)(ba|z|da|k)?sh$/) {
    for (j = i + 1; j <= nw; j++) if (W[j] ~ /^-[A-Za-z]*c[A-Za-z]*$/) { if (j < nw) xparse(W[j + 1], dir); break }
    return dir
  }
  if (cmd == "eval") { x = ""; for (j = i + 1; j <= nw; j++) x = x " " W[j]; nparse(x, dir); LASTCD = "?"; return union("?", dir) }
  if (cmd == "source" || cmd == ".") { LASTCD = "?"; return union("?", dir) }
  if (cmd != "git" && cmd !~ /\/git$/) return dir
  # git global options: -C moves the tree, --work-tree names it, the rest are skipped.
  g = dir
  for (i++; i <= nw; i++) {
    x = W[i]
    if (x == "-C") { i++; g = joindir(g, (i <= nw) ? W[i] : ""); continue }
    # Codex round 17: --work-tree moves only the TREE — the index and repository stay where git
    # finds them, so the current directory stays a candidate; --git-dir names a repository we
    # cannot place, so it is unknown.
    if (x == "--work-tree") { i++; g = union(joindir(g, (i <= nw) ? W[i] : ""), g); continue }
    if (x ~ /^--work-tree=/) { g = union(joindir(g, substr(x, 13)), g); continue }
    if (x == "--git-dir") { i++; g = union("?", g); continue }
    if (x ~ /^--git-dir=/) { g = union("?", g); continue }
    if (x == "-c" || x == "--namespace" || x == "--config-env" || x == "--super-prefix") { i++; continue }
    if (x ~ /^-/) continue
    break
  }
  if (i > nw) return dir
  na = 0; split("", A)
  for (j = i + 1; j <= nw; j++) A[++na] = W[j]
  classify(W[i], A, na, g)
  return dir
}

# <<DELIM at s[i]: records the delimiter, returns the index of its last character.
function heredoc(s, i, PD, PT, k,    c, d) {
  PT[k] = 0
  if (substr(s, i, 1) == "-") { PT[k] = 1; i++ }
  while (substr(s, i, 1) == " " || substr(s, i, 1) == "\t") i++
  d = ""
  for (; i <= length(s); i++) {
    c = substr(s, i, 1)
    if (c ~ /[ \t\n;&|<>()]/) break
    if (c != "\047" && c != "\"" && c != "\\") d = d c
  }
  PD[k] = d
  return i - 1
}

# s[i] is a newline that ends a line with pending heredocs: skip their bodies, parsing any body
# fed to a shell (PS[k]). Returns the index of the last newline consumed.
function bodies(s, i, PD, PT, PS, np, dir,    k, e, n, line, body) {
  n = length(s)
  for (k = 1; k <= np; k++) {
    body = ""
    while (i < n) {
      e = index(substr(s, i + 1), "\n")
      line = e ? substr(s, i + 1, e - 1) : substr(s, i + 1)
      i = e ? i + e : n
      if (PT[k]) sub(/^\t+/, "", line)
      if (line == PD[k]) break
      body = body line "\n"
    }
    if (PS[k]) xparse(body, dir)
  }
  return i
}

# Index of the `)` closing a `(` whose contents start at s[i]. Quotes and heredocs are skipped.
function matchclose(s, i,    n, d, c, k, PD, PT, PS, np) {
  n = length(s); d = 1; np = 0
  for (; i <= n; i++) {
    c = substr(s, i, 1)
    if (c == "\\") { i++; continue }
    if (c == "\047") { k = index(substr(s, i + 1), "\047"); if (!k) return n + 1; i += k; continue }
    if (c == "\"") { i = skipdq(s, i + 1); continue }
    if (c == "<" && substr(s, i + 1, 2) != "<<" && substr(s, i + 1, 1) == "<") { np++; PS[np] = 0; i = heredoc(s, i + 2, PD, PT, np); continue }
    if (c == "\n" && np) { i = bodies(s, i, PD, PT, PS, np, ""); np = 0; continue }
    if (c == "(") d++
    else if (c == ")" && --d == 0) return i
  }
  return n + 1
}
function skipdq(s, i,    n, c, k) {
  n = length(s)
  for (; i <= n; i++) {
    c = substr(s, i, 1)
    if (c == "\\") { i++; continue }
    if (c == "\"") return i
    if (c == "$" && substr(s, i + 1, 1) == "(") { i = matchclose(s, i + 2); continue }
    if (c == "`") { k = index(substr(s, i + 1), "`"); if (!k) return n + 1; i += k }
  }
  return n + 1
}

# Double-quoted text from s[i]: sets DQ to its value, runs any $(...) / `...` inside it, returns
# the index of the closing quote.
function dq(s, i, dir,    n, c, e, k, out) {
  n = length(s); out = ""
  for (; i <= n; i++) {
    c = substr(s, i, 1)
    if (c == "\\") { i++; c = substr(s, i, 1); if (c !~ /[$`"\\\n]/) out = out "\\"; out = out lit(c); continue }
    if (c == "\"") break
    if (c == "$" && substr(s, i + 1, 1) == "(") { e = matchclose(s, i + 2); nparse(substr(s, i + 2, e - i - 2), dir); out = out sub_word(substr(s, i + 2, e - i - 2)); i = e; continue }
    if (c == "`") { k = index(substr(s, i + 1), "`"); if (!k) k = n - i + 1; nparse(substr(s, i + 1, k - 1), dir); out = out "$(...)"; i += k; continue }
    out = out (c == "~" ? "\002" : c)   # no tilde expansion inside double quotes
  }
  DQ = out
  return i
}

# E2E-3: in `cd X && a && b`, a and b run only if that cd SUCCEEDED, so they run in X — CHAIN, for
# the rest of the && list. Whatever follows a `;`, `||`, `|` or newline is back to the union in dir.
function parse(s, dir,    n, i, c, w, inw, W, nw, PD, PT, PS, np, e, k, op, last, depth, j, chain, nd2, inchain) {
  n = length(s); nw = 0; w = ""; inw = 0; np = 0; split("", W); last = ""; depth = 0
  for (i = 1; i <= n + 1; i++) {
    c = (i <= n) ? substr(s, i, 1) : "\n"
    if (c == "\\") { i++; if (i <= n && substr(s, i, 1) != "\n") { w = w lit(substr(s, i, 1)); inw = 1 } continue }
    if (c == "\047") { k = index(substr(s, i + 1), "\047"); if (!k) k = n - i + 1; w = w lit(substr(s, i + 1, k - 1)); i += k; inw = 1; continue }
    if (c == "\"") { i = dq(s, i + 1, dir); w = w DQ; inw = 1; continue }
    if (c == "$" && substr(s, i + 1, 1) == "(") { e = matchclose(s, i + 2); nparse(substr(s, i + 2, e - i - 2), dir); w = w sub_word(substr(s, i + 2, e - i - 2)); i = e; inw = 1; continue }
    if (c == "`") { k = index(substr(s, i + 1), "`"); if (!k) k = n - i + 1; nparse(substr(s, i + 1, k - 1), dir); w = w "$(...)"; i += k; inw = 1; continue }
    if (c == "#" && !inw) { while (i <= n && substr(s, i, 1) != "\n") i++; i--; continue }
    if (c == "<" && substr(s, i + 1, 1) == "<" && substr(s, i + 2, 1) != "<") {
      if (inw) { W[++nw] = w; w = ""; inw = 0 }
      np++; PS[np] = (cmdat(W, nw) <= nw && W[cmdat(W, nw)] ~ /(^|\/)(ba|z|da|k)?sh$/)
      i = heredoc(s, i + 2, PD, PT, np); continue
    }
    if (c == " " || c == "\t") { if (inw) { W[++nw] = w; w = ""; inw = 0 } continue }
    if (c == "(" && !inw) { e = matchclose(s, i + 1); nparse(substr(s, i + 1, e - i - 1), dir); i = e; continue }
    if (c == "\n" || c == ";" || c == "|" || c == ")" || (c == "&" && substr(s, i - 1, 1) !~ /[<>]/ && substr(s, i + 1, 1) != ">")) {
      if (inw) { W[++nw] = w; w = ""; inw = 0 }
      op = c; if ((c == "&" || c == "|") && substr(s, i + 1, 1) == c) { op = c c; i++ }
      for (j = 1; j <= nw; j++) { if (W[j] in OPEN) depth++; else if (W[j] in CLOSE) { if (depth) depth-- } else if (!(W[j] in SKIP)) break }
      if (nw) {
        inchain = (last == "&&" && chain != "")
        nd2 = seg(W, nw, inchain ? chain : dir, depth > 0 || last == "&&" || last == "||" || last == "|" || op == "|" || op == "||" || op == "&")
        # a chain starts only at a cd that surely ran: not after `||` (skippable) or `|` (a subshell)
        if (op == "&&" && depth == 0 && LASTCD != "" && !index(SEP LASTCD SEP, SEP "?" SEP) && (inchain || (last != "||" && last != "|"))) chain = LASTCD
        else if (LASTCD != "" || !(op == "&&" && inchain)) chain = ""   # a cd we cannot resolve ends it
        dir = inchain ? union(nd2, dir) : nd2
        nw = 0; split("", W)
      } else if (op != "&&") chain = ""   # `( … );` has no words here, but the list still ends
      last = op
      if (c == "\n" && np) { i = bodies(s, i, PD, PT, PS, np, dir); np = 0 }
      continue
    }
    w = w c; inw = 1
  }
}

BEGIN {
  SEP = "\034"
  split("then do else elif if while until ! { }", t, " "); for (k in t) SKIP[t[k]] = 1
  split("REPLY OPTARG OPTIND PWD OLDPWD HOME CDPATH IFS _ MAPFILE BASH_REMATCH COPROC TMPDIR PATH", t, " "); for (k in t) IMPLICIT[t[k]] = 1
  split("if while until for select case function {", t, " "); for (k in t) OPEN[t[k]] = 1
  split("fi done esac }", t, " "); for (k in t) CLOSE[t[k]] = 1
  # G7-8: the wrapper table is hooks/wrappers.txt, shared with contract-hooks.mjs — name, the
  # operands before the command (WP), the flags that take a separate value (WV).
  while ((getline line < wrapfile) > 0) {
    if (line ~ /^#/ || line !~ /[^ \t]/) continue
    nf = split(line, F, /[ \t]+/); WRAP[F[1]] = 1; WP[F[1]] = F[2] + 0; WV[F[1]] = " "
    for (k = 3; k <= nf; k++) WV[F[1]] = WV[F[1]] F[k] " "
  }
  close(wrapfile)
}
{ s = s (NR > 1 ? "\n" : "") $0 }
END {
  # A command that defines its own cd/pushd/popd: no cd in it can be trusted to have moved.
  SHADOW = (s ~ /(^|[^A-Za-z0-9_-])(cd|pushd|popd)[ \t]*\([ \t]*\)/ || s ~ /function[ \t]+(cd|pushd|popd)([^A-Za-z0-9_-]|$)/)
  if (s ~ /[A-Za-z0-9_-][ \t]*\([ \t]*\)[ \t\n]*[{(]/ || s ~ /(^|[;&|( \t\n])function[ \t]/) SHADOW = 1
  gsub(/[\001\002]/, "?", s); gsub(/@TMP/, "@TMP?", s)
  if (s ~ /CDPATH/) SHADOW = 1
  if (s ~ /(^|[^A-Za-z0-9_])HOME([^A-Za-z0-9_]|$)/) home = ""   # a command that touches HOME: a bare cd and ~ are unknown
  # `set -P` / `set -o physical` make every later cd physical (symlinks first): no cd is trusted
  if (s ~ /physical|SHELLOPTS/ || s ~ /(^|[;&|({ \t\n])set[ \t]+([^;&|\n]*[ \t])?[-+][A-Za-z]*P/) SHADOW = 1
  CMDALL = s
  parse(s, base)
}
')
[ -n "$SEGS" ] || exit 0

# G7-11: the declared branch comes from scripts/integration-branch.sh itself — ONE parser. A copy
# here drifted (it kept the `.` of "Integration branch: main.", so main went unprotected). The script
# is found beside this hook (its own plugin root), never through $CLAUDE_PLUGIN_ROOT. When it cannot
# resolve (exit 2: a doc that declares nothing, a declared branch that does not exist), EVERY
# candidate is protected — main, master, develop and whatever the doc names (PR47-3: falling back to
# `main` alone left a develop-model project's real integration branch open to a raw merge or push).
# Resolved per repository, because a segment's `cd`/`-C` can name a different one. Prints a
# space-separated list; `pick_declared` sets DECLARED to the member a ref or HEAD matches.
declared_for() {
  if d=$(sh "$PLUGIN/scripts/integration-branch.sh" "$1" 2>/dev/null); then printf '%s' "${d:-main}"; return; fi
  printf 'main master develop %s' "$(printf '%s\n' "$d" | sed -n "s/.* declares '\([^']*\)'.*/\1/p" | head -n 1)"
}
pick_declared() {   # pick_declared <ref> <list> — 0 and DECLARED=<member> when ref is one of them
  for c in $2; do same_ref "$1" "$c" && { DECLARED=$c; return 0; }; done
  return 1
}

# C5G-6: macOS ref storage folds case — `refs/heads/Develop` IS develop there, so compare folded on Darwin.
DARWIN=""; [ "$(uname -s 2>/dev/null)" = Darwin ] && DARWIN=1
lc() { printf '%s' "$1" | tr '[:upper:]' '[:lower:]'; }
same_ref() { if [ -n "$DARWIN" ]; then [ "$(lc "$1")" = "$(lc "$2")" ]; else [ "$1" = "$2" ]; fi; }

# W7-9 skips the studio's operational files — but only for commands that leave untracked files alone
# (branch -D, reset --hard, checkout). `git clean` and `git stash -u/-a` DELETE them, and with -x/-X/-a
# they delete the gitignored board log too, which `git status` never shows. Those commands count the
# operational paths, ignored or not (Sprint 7 lead: U3's skip let `git clean -fdx` erase the board).
EXCL0=""; OPS=""
if [ -f "$PLUGIN/scripts/lib/operational-paths.txt" ]; then
  EXCL0=$(sed -e '/^#/d' -e '/^$/d' -e 's/^/:(top,exclude)/' "$PLUGIN/scripts/lib/operational-paths.txt")
  OPS=$(sed -e '/^#/d' -e '/^$/d' -e 's/^/:(top)/' "$PLUGIN/scripts/lib/operational-paths.txt")
fi
# PR47-9: which sweep a segment is comes from its own parsed flags (the REF field of its D line),
# never from a glob over the whole command — see sweep() in the parser above.

TAB=$(printf '\t')
while IFS="$TAB" read -r KIND REF DIR WHY; do
  [ -n "$KIND" ] || continue
  # E2E-3: a tree this command just made under mktemp (a trial merge, a mutation probe) holds no one
  # else's work and is never the integration checkout; a ref write still reaches the shared repo.
  if [ "$DIR" = "@TMP" ]; then
    # ponytail: only the literal `ln` is seen; a link made by tar, cp -s or an interpreter is not
    # (HANDBOOK "the destructive-git hook reads the command, not the filesystem").
    LNW=$(printf '%s\n' "$CMD" | grep -Ec '(^|[^A-Za-z0-9_.-])ln([[:space:]]|$)')
    case $CMD in
      *TMPDIR*) DIR="?" ;;
      *) [ "$LNW" -gt 0 ] && DIR="?" ;;
    esac
    [ "$DIR" = "?" ] || case $CMD in
      *) TD=${TMPDIR:-/tmp}
         if [ ! -d "$TD" ] || [ ! -w "$TD" ] || git -C "$TD" rev-parse --git-dir >/dev/null 2>&1; then DIR="?"
         else [ "$KIND" = "R" ] || continue; DIR="?"; fi ;;
    esac
  fi
  GDIR=$DIR
  [ "$GDIR" = "?" ] && GDIR=""
  ROOT=""
  [ -n "$GDIR" ] && ROOT=$(git -C "$GDIR" rev-parse --show-toplevel 2>/dev/null)

  if [ "$KIND" = "D" ]; then
    # --- is there anything here to destroy? -----------------------------------------------------
    #
    # The first version gated on agent worktrees existing (.agent-wt/, .claude/worktrees/). The
    # security review found the hole by probing both states: DR4-027 — the incident this hook was
    # written for — was two writers in ONE shared checkout with NO worktrees, so the hook stood down
    # in exactly the configuration that caused it. The trigger is the harm, not a proxy for it:
    # **uncommitted work exists in the tree this command runs in.** A clean tree keeps every
    # command, so this still cannot fire on everything — a gate that refuses constantly gets
    # switched off, and a switched-off gate protects nothing.
    # W7-9: the studio's own operational files (scripts/lib/operational-paths.txt — the board log,
    # the register, release candidates) are the loop's bookkeeping, not work this command destroys.
    SWEEP=""; EXCL=$EXCL0
    case $REF in i) SWEEP=1; EXCL="" ;; u) EXCL="" ;; esac
    if [ -n "$ROOT" ]; then
      # Tracked changes always count — reset --hard / checkout discard an edited operational file too
      # (Codex PR #47: an appended, committed messages.jsonl). Only UNTRACKED operational files skip.
      STAT=$( { git -C "$GDIR" status --porcelain -uno -- ':/' 2>/dev/null
                git -C "$GDIR" status --porcelain -uall -- ':/' $EXCL 2>/dev/null | grep '^??'; } )
      DIRTY=$(printf '%s\n' "$STAT" | sed '/^$/d' | head -n 1)
      DIRTY_N=$(printf '%s\n' "$STAT" | grep -c . || echo "?")
      if [ -z "$DIRTY" ] && [ -n "$SWEEP" ] && [ -n "$OPS" ]; then
        DIRTY=$(git -C "$GDIR" status --porcelain -uall --ignored -- $OPS 2>/dev/null | head -n 1)
        [ -n "$DIRTY" ] && DIRTY_N="the studio's operational (board/register)"
      fi
    elif [ -n "$GDIR" ] && [ -d "$GDIR" ]; then
      continue   # a real directory that is not a repository: nothing here to guard
    else
      DIRTY="unknown"; DIRTY_N="an unknown number of"   # cannot tell which tree: fail closed
    fi
    [ -n "$DIRTY" ] || continue
    cat >&2 <<EOF
BLOCKED — repo-wide destructive git command, and the tree it runs in has uncommitted work.

  command : $CMD
  tree    : $DIR
  why     : $WHY
  at risk : $DIRTY_N uncommitted path(s) in that tree

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
  fi

  if [ "$KIND" = "S" ]; then
    # --- R7-7: a SUBAGENT switching branches in a studio project's MAIN checkout ----------------------
    # A subagent's Bash cwd resets to the session cwd — the orchestrator's checkout. An IC told
    # "git checkout -b feat/…" without its slot path switches the branch every other role reads.
    # A path restore (`git checkout src/a.swift`) is not a switch: a lone operand must name a commit.
    [ -n "$AGENT" ] && [ -n "$ROOT" ] && [ -f "$ROOT/docs/31-board-events.jsonl" ] || continue
    [ "$(git -C "$GDIR" rev-parse --absolute-git-dir 2>/dev/null)" = "$(git -C "$GDIR" rev-parse --path-format=absolute --git-common-dir 2>/dev/null)" ] || continue
    [ "$REF" = "-" ] || git -C "$GDIR" rev-parse --verify --quiet "$REF^{commit}" >/dev/null 2>&1 || continue
    cat >&2 <<EOF
BLOCKED — a subagent switching branches in the studio's MAIN checkout ($ROOT).

  command : $CMD
  why     : your Bash cwd resets to the orchestrator's checkout on every call; a checkout or switch
            here moves the branch the orchestrator and every other role are reading (R7-7).

Instead: work in the slot your prompt names, by its absolute path, on every call —
  git -C <absolute slot path> checkout -b feat/<TICKET>-<slug>
  cd <absolute slot path> && <command>
EOF
    exit 2
  fi

  # Merge and ref checks need a repository; a segment whose tree is unknown is judged in the
  # caller's own tree, since that is the integration branch it can reach.
  if [ -z "$ROOT" ]; then
    [ -n "$GDIR" ] && continue
    GDIR=$BASE
    ROOT=$(git -C "$GDIR" rev-parse --show-toplevel 2>/dev/null) || continue
  fi
  DECLARED_ALL=$(declared_for "$ROOT"); DECLARED=${DECLARED_ALL%% *}

  if [ "$KIND" = "M" ]; then
    # --- a raw `git merge` INTO the integration branch, by anyone at all -------------------------
    #
    # FOUND BY RUNNING A REAL SPRINT (H6, 2026-08-07). A `qa-engineer` agent, told in its own role
    # file "you never merge your own work — tech-manager merges", ran `git merge --no-ff` directly
    # onto `main` anyway. No board event backed it, so the work landed on the branch every other
    # ticket builds from with zero provenance and zero review. THIS IS NOT A ROLE CHECK — the
    # payload carries a command, not an identity. It refuses a pattern this repository has decided
    # is always wrong now, for anyone: merging directly into the checked-out integration branch.
    #
    # `--ff-only` IS SPECIFICALLY EXEMPT: wave-integrate.mjs prints exactly one documented manual
    # fallback — `git checkout $BASE && git merge --ff-only $WAVE_BRANCH && git push origin $BASE` —
    # and a fast-forward cannot fabricate a merge commit or lose history. `--abort/--continue/--quit`
    # finish or unwind a merge rather than fabricating one. The exemption is PER SEGMENT: v1–v3 let
    # `--ff-only` anywhere in the command exempt every merge in it. `git merge-base/-tree/-file`
    # and `git mergetool` are different subcommands and never reach this. `git pull --no-ff`, or a
    # pull of some OTHER branch, is the same merge spelled differently.
    HEAD=$(git -C "$GDIR" rev-parse --abbrev-ref HEAD 2>/dev/null || echo "")
    if [ -n "$HEAD" ] && pick_declared "$HEAD" "$DECLARED_ALL"; then
      if [ "$REF" = "-" ] || [ "$REF" != "$DECLARED" ]; then
        cat >&2 <<EOF
BLOCKED — a raw \`git $WHY\` directly onto the integration branch (\`$DECLARED\`).

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
    continue
  fi

  # --- ref-writing bypasses of the merge check above ----------------------------------------------
  #
  # FOUND BY ADVERSARIAL RE-REVIEW (2026-08-08): commands that move the integration branch's REF
  # without ever calling `git merge`, and without needing it checked out in this tree at all:
  #   git push origin HEAD:main / feat:refs/heads/main / +main / main --force / --delete main
  #   git fetch . feat/x:main        wave-integrate.mjs's own `git fetch . src:dst`, run by hand
  #   git branch -f|--force|-M|-C main …
  #   git update-ref [-d] refs/heads/main …
  # Each reproduces H6's exact class: unreviewed code lands on the branch every ticket builds
  # from, with no board event — without the word "merge" ever appearing. A plain
  # `git push origin main` (local main to remote main, no force) is the documented landing step.
  REFBLOCK=""
  if pick_declared "$REF" "$DECLARED_ALL"; then
    case "$WHY" in
      push)  REFBLOCK="a push that rewrites or forces $DECLARED on the remote (a refspec ending :$DECLARED, +$DECLARED, --force, or --delete) — no merge, no board event" ;;
      fetch) REFBLOCK="a fetch refspec ending :$DECLARED moves the integration branch's LOCAL ref directly — this is wave-integrate.mjs's own mechanism, run by hand instead of through it" ;;
      branch) REFBLOCK="git branch -f/--force/-M/-C force-moves $DECLARED's pointer directly — no merge object, no history check" ;;
      update-ref|symbolic-ref) REFBLOCK="git $WHY moves $DECLARED's pointer at the plumbing layer — the same effect as branch -f" ;;
    esac
  fi
  if [ -n "$REFBLOCK" ]; then
    cat >&2 <<EOF
BLOCKED — a git command that moves the integration branch's ref (\`$DECLARED\`) without a merge,
a review, or wave-integrate.mjs.

  command : $CMD
  why     : $REFBLOCK
            Measured live (H6, 2026-08-07) for the merge form of this; this is the same class
            reached through a different git verb — found by adversarial re-review, not by an
            incident, which is the point of looking before one happens.

Instead:
  - land a whole wave         node scripts/wave-integrate.mjs --wave <N> [--push]
  - move it by hand?          git checkout $DECLARED && git merge --ff-only <wave-branch> && git push origin $DECLARED
EOF
    exit 2
  fi
done <<EOF
$SEGS
EOF

exit 0
