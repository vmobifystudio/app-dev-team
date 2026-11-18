# Repository controls

The controls in this document are the only ones in the studio an autonomous agent cannot switch off.

Everything else — the board CLI refusing an unapproved merge, the capability matrix refusing a
designer who writes one, the audit chain noticing a rewritten event log, the kill switch — runs
inside a process that an agent with `Bash` also controls. That is not a reason to remove them; a
control that stops the *ordinary* failure is worth more than one that only stops the adversarial
one, and every incident this studio has actually had was ordinary. But it means the internal
controls are **backed by**, not equal to, the server-side ones below.

Set these once, per repository, as an admin:

```bash
sh "${CLAUDE_PLUGIN_ROOT}/scripts/repo-controls.sh" --check    # what is set today
sh "${CLAUDE_PLUGIN_ROOT}/scripts/repo-controls.sh" --print    # the gh commands that set it
```

`--print` deliberately does not run anything. Changing a repository's protection rules is an
owner's decision, and a script that applies them silently is the same trust problem it exists to
solve. `--check` exits `2` — **CANNOT EVALUATE, which is not a pass** — when `gh` is missing or
unauthenticated, because "I could not look" and "it is fine" are different answers.

## The five controls, and what each one backs

| # | Control | What it backs internally | What it stops that nothing internal can |
|---|---|---|---|
| 1 | **Protected branch** — no force-push, no deletion, no direct push, linear history | the whole event log and review ledger, which are append-only files in git | `git push --force` erasing a review, a merge, or the audit chain wholesale |
| 2 | **Required status checks** (`checks`, `mutation`) | `scripts/test.sh`, `team-doctor`, `mutate.sh` | a red suite reaching the default branch because nobody looked |
| 3 | **Required non-self review** | the board's "no merge without an `approved` by a role other than the owner" | the same agent authoring and approving, at the *code* level rather than the ledger level |
| 4 | **Production environment approval** | nothing — this is the *only* mechanism for it | a developer agent reaching production credentials at all |
| 5 | **Secret scanning + push protection** | `scripts/lib/redact.mjs` and the artifact scan | a credential that redaction's patterns did not know about |

## Control 3, stated precisely

GitHub has no API flag named "non-self review". The guarantee comes from two settings together:
GitHub never counts a pull request author's own review toward the required count, so
`required_approving_review_count: 1` **is** "someone other than the author approved", and
`dismiss_stale_reviews: true` stops an approval from surviving a later push.

Written out because the alternative is a row in a table claiming a control that no setting
implements — the shape this repo calls a rule that cannot fail.

## Control 4 is the answer to "a developer cannot reach production credentials"

This studio cannot sandbox an agent's environment. A developer agent runs `Bash` in the operator's
shell with the operator's environment, so any policy of the form "this role may not read that
variable" is a request, not a control, and the honest classification is **not enforceable here**.

The enforceable version moves the credential instead of the agent: production secrets live in a
GitHub **environment** with a required reviewer, so they exist only inside a job a human approved.
No agent, of any role, ever has them — which is a stronger statement than any per-role rule.

`release-manager` is the role that ships, and it is deliberately absent from every evidence-writing
row of the capability matrix (`scripts/lib/capabilities.mjs`): the role that decides a build ships
cannot author the evidence that it is shippable. The environment approval is the same separation,
one layer down.

## What this does not fix

- An agent can still commit a credential to a **branch**; push protection rejects it at the push,
  but only for patterns GitHub recognises.
- Branch protection does not protect a fork, a new branch, or a repository the operator has not set
  it up on. `--check` tells you which; nothing makes it happen for you.
- None of it applies to a local-only repository, which is how most projects start. Until a remote
  exists, the internal controls are all there is — and that is exactly the window in which the
  `.studio-stop` kill switch and the audit chain earn their place.
