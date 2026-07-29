#!/bin/sh
# repo-controls — the GitHub half of the studio's controls, as a command rather than a paragraph.
#
# Everything else in this repo enforces policy INSIDE the loop: the board CLI refuses a merge with
# no external approval, capabilities refuse a designer writing one, the audit chain notices a
# rewritten log. All of it runs in a process an agent controls. An agent with `Bash` can
# `git push --force`, and no amount of internal policy survives that.
#
# The controls that DO survive it live on the server: protected branches, required status checks,
# required non-self review, and an environment gate that holds production credentials until a human
# approves. Those back the internal policy instead of duplicating it in prompts — and they are the
# only controls in this system an autonomous agent cannot switch off.
#
# Usage:
#   sh scripts/repo-controls.sh --check  [--repo owner/name] [--branch main]
#   sh scripts/repo-controls.sh --print  [--repo owner/name] [--branch main]
#
#   --check  read the live settings and report each control as SET / NOT SET
#   --print  print the exact `gh` commands that set them. It does NOT run them: this changes a
#            repository's protection rules, which is an owner's decision, and a script that
#            silently applies them is the same trust problem it exists to solve.
#
# Exit codes:
#   0  every control is set (--check), or the commands were printed (--print)
#   1  at least one control is NOT SET
#   2  cannot evaluate — no `gh`, not authenticated, no repo, or the API refused

set -u

MODE=""
REPO=""
BRANCH="main"

need() { [ "$1" -ge 2 ] || { echo "repo-controls: $2 needs a value" >&2; exit 2; }; }

while [ $# -gt 0 ]; do
  case "$1" in
    --check) MODE=check; shift ;;
    --print) MODE=print; shift ;;
    --repo)   need $# "--repo";   REPO="$2";   shift 2 ;;
    --branch) need $# "--branch"; BRANCH="$2"; shift 2 ;;
    -h|--help) sed -n '1,30p' "$0"; exit 0 ;;
    *) echo "repo-controls: unknown argument '$1'" >&2; exit 2 ;;
  esac
done

[ -n "$MODE" ] || { echo "repo-controls: pass --check or --print" >&2; exit 2; }

if [ -z "$REPO" ]; then
  REPO=$(git remote get-url origin 2>/dev/null |
    sed -e 's#^git@github.com:##' -e 's#^https://github.com/##' -e 's#\.git$##') || REPO=""
fi

if [ "$MODE" = "print" ]; then
  R=${REPO:-OWNER/REPO}
  cat <<EOF
# Run these as a repository admin. Each one is a control an autonomous agent cannot switch off.

# 1. Protected branch: no force-push, no deletion, no direct push. This is the one that survives an
#    agent with a shell — everything else in this studio is policy inside a process the agent runs.
gh api -X PUT "repos/$R/branches/$BRANCH/protection" \\
  -H "Accept: application/vnd.github+json" \\
  -F "required_status_checks[strict]=true" \\
  -F "required_status_checks[contexts][]=checks" \\
  -F "required_status_checks[contexts][]=mutation" \\
  -F "enforce_admins=true" \\
  -F "required_pull_request_reviews[required_approving_review_count]=1" \\
  -F "required_pull_request_reviews[require_code_owner_reviews]=false" \\
  -F "required_pull_request_reviews[dismiss_stale_reviews]=true" \\
  -F "restrictions=" \\
  -F "allow_force_pushes=false" \\
  -F "allow_deletions=false" \\
  -F "required_linear_history=true" \\
  -F "required_conversation_resolution=true"

# 2. Required NON-SELF review. GitHub enforces "an approval from someone other than the author" by
#    never counting the author's own review — the required count above is what makes it bite. The
#    board CLI enforces the same rule on the event log; this enforces it on the code.
#    (There is no API flag literally named "non-self": the guarantee comes from the review count
#    plus dismiss_stale_reviews, and pretending otherwise would be a control nobody can verify.)

# 3. Production credentials behind an environment approval. This is the mechanical answer to
#    "a developer cannot reach production credentials" — the studio cannot sandbox an agent's
#    environment, but it can make sure the secret is never in one until a human says so.
gh api -X PUT "repos/$R/environments/production" \\
  -F "reviewers[][type]=User" -F "reviewers[][id]=<YOUR-USER-ID>" \\
  -F "deployment_branch_policy[protected_branches]=true" \\
  -F "deployment_branch_policy[custom_branch_policies]=false"
gh secret set APP_STORE_CONNECT_KEY --env production --repo "$R"

# 4. Secret scanning + push protection: a credential that reaches a commit is rejected at the push,
#    which is the only point where rejecting it still helps.
gh api -X PATCH "repos/$R" \\
  -F "security_and_analysis[secret_scanning][status]=enabled" \\
  -F "security_and_analysis[secret_scanning_push_protection][status]=enabled"

# 5. Least-privilege tokens for Actions: read-only by default, and no agent-authored workflow can
#    grant itself write. Settings -> Actions -> Workflow permissions -> "Read repository contents".
gh api -X PUT "repos/$R/actions/permissions/workflow" \\
  -F "default_workflow_permissions=read" \\
  -F "can_approve_pull_request_reviews=false"
EOF
  exit 0
fi

# --- check ---------------------------------------------------------------------------------------

if ! command -v gh >/dev/null 2>&1; then
  echo "CANNOT EVALUATE: the GitHub CLI (gh) is not installed, so the server-side controls are UNKNOWN."
  echo "  UNKNOWN is not 'set'. Install gh and re-run, or verify them by hand in Settings."
  exit 2
fi
if ! gh auth status >/dev/null 2>&1; then
  echo "CANNOT EVALUATE: gh is not authenticated. The controls are UNKNOWN, not absent."
  exit 2
fi
if [ -z "$REPO" ]; then
  echo "CANNOT EVALUATE: no GitHub repository found. Pass --repo owner/name."
  exit 2
fi

PROT=$(gh api "repos/$REPO/branches/$BRANCH/protection" 2>/dev/null) || PROT=""
if [ -z "$PROT" ]; then
  echo "REPOSITORY CONTROLS: $REPO ($BRANCH)"
  echo "  NOT SET  branch protection — the branch is unprotected, or this token cannot read it."
  echo "           Every other control below is moot while a force-push is legal."
  echo "  Run: sh scripts/repo-controls.sh --print"
  exit 1
fi

FAIL=0
say() { # say <label> <json-true-or-count-expression>
  if [ "$2" = "true" ] || { [ "$2" -ge 1 ] 2>/dev/null; }; then
    echo "  SET      $1"
  else
    echo "  NOT SET  $1"
    FAIL=1
  fi
}

jqish() { # read a value out of the protection JSON without jq (zero dependencies)
  printf '%s' "$PROT" | node -e '
let raw = ""; process.stdin.on("data", (d) => (raw += d)).on("end", () => {
  const path = process.argv[1].split(".");
  let v = JSON.parse(raw);
  for (const k of path) v = v === undefined || v === null ? undefined : v[k];
  process.stdout.write(String(Array.isArray(v) ? v.length : v));
});' "$1"
}

echo "REPOSITORY CONTROLS: $REPO ($BRANCH)"
say "no force-push"                 "$([ "$(jqish allow_force_pushes.enabled)" = "false" ] && echo true || echo false)"
say "no branch deletion"            "$([ "$(jqish allow_deletions.enabled)" = "false" ] && echo true || echo false)"
say "required status checks"        "$(jqish required_status_checks.contexts)"
say "required review (non-self)"    "$(jqish required_pull_request_reviews.required_approving_review_count)"
say "stale reviews dismissed"       "$(jqish required_pull_request_reviews.dismiss_stale_reviews)"
say "rules apply to admins"         "$(jqish enforce_admins.enabled)"

ENVS=$(gh api "repos/$REPO/environments" 2>/dev/null | node -e '
let raw = ""; process.stdin.on("data", (d) => (raw += d)).on("end", () => {
  try { const j = JSON.parse(raw);
    const prod = (j.environments || []).find((e) => /prod/i.test(e.name));
    process.stdout.write(prod && (prod.protection_rules || []).some((r) => r.type === "required_reviewers") ? "true" : "false");
  } catch { process.stdout.write("false"); }
});') || ENVS=false
say "production environment requires approval" "$ENVS"

if [ "$FAIL" -eq 0 ]; then
  echo
  echo "RESULT: every server-side control is set."
  exit 0
fi
echo
echo "RESULT: at least one control is NOT SET."
echo "These are the controls an autonomous agent cannot switch off, which is why they are the ones"
echo "worth having. Print the commands that set them:  sh scripts/repo-controls.sh --print"
exit 1
