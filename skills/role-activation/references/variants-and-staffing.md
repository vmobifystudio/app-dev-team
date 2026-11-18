# role-activation — backend variants, staffing, and the roster template

Loaded from `role-activation` SKILL.md when you record a `backend-developer` variant, meet an unstaffed product type, add an IC, or write `docs/02-team-roster.md`.

### `backend-developer` activation variants

`ai-engineer`, `data-engineer` and `integration-engineer` are **not roles and get no agent file.**
They are `backend-developer` activated with a different conventions pack and a different set of
review dimensions. The workflow — `ic-workflow`, the CODE contract, the gates — is identical, which
is the whole reason they are variants: three more agent files would be three more things that can
drift from each other.

Record the variant in the roster row's reason, so a reader knows which pack was loaded:

| Variant | Trigger | Conventions delta | Extra review dimension |
|---|---|---|---|
| **ai-engineer** | the architecture names a model, embedding store, or prompt-driven feature | prompt and model versioning, token/cost budget, eval set before rollout, deterministic fallback when the model is unavailable | non-determinism: what does this do when the model returns nonsense, refuses, or times out |
| **data-engineer** | the architecture names a pipeline, warehouse, or scheduled transform | schema contracts, idempotent and replayable jobs, backfill plan, late and duplicate data | `database-migration`, plus: what happens when yesterday's job is re-run today |
| **integration-engineer** | the architecture names a third-party API the product depends on | contract test against the real API, versioning and deprecation policy, secret handling, rate limits | the vendor being down, slow, or breaking its contract without telling you |

`board-doctor` still sees `backend-developer` as the owner — the variant is a roster annotation, not
a new spawnable name.

### Every product type must name an IC — or it is unstaffed

A product type is **staffed** only if at least one of `ios-developer`, `android-developer`,
`backend-developer`, `web-developer` is `on` or `?` for it. Those four are the roles that can own an
implementation ticket and actually build the thing; the rest review, coordinate, design, test, or
ship it.

`cli` is **recognised but unstaffed**. Detection can identify it — a `main.go` with no UI is a real
answer — but **activation then refuses and writes no roster**:

```
ACTIVATION REFUSED — product type `cli` is recognised but unstaffed.
No IC role on this team can own a cli implementation ticket:
there is no cli-developer in agents/, and backend-developer builds services, not command-line tools.
To proceed, either: (a) build this as a different product type, or
(b) add the missing IC role — see below — and add it to the activation matrix.
```

Refusing is the correct outcome. Assembling a team that cannot build the product is not: `/app-build`
spawns strictly by a ticket's `Owner`, and `board-doctor` rejects an owner the loop cannot spawn — so
a web UI ticket either strands with no valid owner or goes to `backend-developer`, who builds it
against the wrong conventions. Declared, never picked up, never reported: the exact failure this
repo keeps finding.

`team-doctor` enforces the rule mechanically, both ways: a `staffed` type with no IC is a
configuration error, and an `unstaffed` type whose column names an IC is worse — it would activate.

**Adding an IC is cheap and well-defined**, which is what makes "unstaffed" a costed decision rather
than an accident. `ic-workflow` already holds the whole ticket lifecycle and is product-agnostic by
design (its own description names web, CLI and library). `web-developer` is exactly that: the skill,
plus a conventions delta for the stack, plus one matrix column flipped to `yes` — and it is what
moved `web-app` from unstaffed to staffed. A `cli-developer` would be the same three things. Do it
deliberately, when a real CLI product is on the table — not to make this table look complete.

## Writing the roster — `docs/02-team-roster.md`

Written once, by `/app-init` or `/app-onboard`, after both axes are fixed. It is the manifest every
later command reads instead of re-deriving activation — it survives agent death and makes the
decision auditable. Exactly this shape:

```markdown
# Team roster

Generated: <YYYY-MM-DD> by /app-init | /app-onboard
Tier: flagship | utility  (source: --utility flag | docs/01-intake.md §Scope | detected: <signal>)
Product type: <one of the seven>  (source: docs/01-intake.md §Product type | detected: <marker>)

| Role | State | Reason / trigger |
|---|---|---|
| ceo | active | founder pass — also covers the cpo charter (utility) |
| cpo | off | merged-into: ceo — utility founder pass |
| aso-specialist | off | product type backend-service has no app-store listing |
| backend-developer | conditional | trigger: docs/20-architecture.md names a server component |
| monetization-engineer | conditional | trigger: product sells IAP/subscriptions or serves ads |
| backend-developer | active | variant: data-engineer — architecture names a scheduled transform |
| product-validator | conditional | trigger: docs/00-founder-intent/ holds a record to validate against |
| privacy-reviewer | off | merged-into: security-reviewer — privacy MODE (utility) |
| ...one row per role in the matrix, none omitted |
```

Three states only: `active`, `conditional`, `off`. **Every role gets a row.** A role missing from
this file is not "off" — it is unaccounted for, which is the silent-drop class this codebase keeps
finding. `team-doctor` enforces the same completeness on the matrix above.

A `conditional` role flips to `active` the moment its trigger is met — amend the row, keep the
reason, and note the round it flipped. Never delete a row.
