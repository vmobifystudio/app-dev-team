# Journey declarations — what this product must actually do

`scripts/journey-gate.mjs` reads every `*.json` in this directory and proves the declared journeys
complete on a running app.

## Why this exists

Six dry runs of this studio measured the same result: the gates caught **every** process defect and
**zero** product defects.

| What the user did | What the product did | Why every gate passed |
|---|---|---|
| picked a date | saved `System.currentTimeMillis()` | the picker rendered; the save succeeded; the test tested the formatter |
| expected a 56dp target | got 24dp | the spec said 56dp; it compiled; nothing measured the built UI |
| changed the count via TalkBack | heard the **previous** count | state updated; the announcement never re-read |
| had corrupt stored data | saw an empty list | the parse "succeeded" into `[]` |

`runtime-gate.sh` proves the app **built, installed, launched and was still alive after 3 seconds**.
That is true, useful, and entirely compatible with an app that shows a splash screen and does
nothing the user asked for. A journey proves something different: **this flow works.**

## The contract

**Three states, like every gate here.** `0` PASS · `1` FAIL (the product is wrong) · `2` CANNOT
EVALUATE (it was not exercised — never a pass). An unrun journey and a passing journey are
different facts; conflating them is the defect this gate exists to end.

## Writing one

```json
{
  "schema": "journey/v1",
  "id": "record-a-reading",
  "priority": "P0",
  "steps": [
    { "action": "launch" },
    { "assert": "screen",           "id": "dashboard" },
    { "action": "tap",              "id": "add-entry" },
    { "action": "enter",            "id": "date",     "value": "1999-01-02" },
    { "action": "enter",            "id": "systolic", "value": "137" },
    { "action": "tap",              "id": "save" },
    { "assert": "value_equals",     "id": "row-0-date", "value": "1999-01-02" },
    { "assert": "text_visible",     "value": "137" },
    { "assert": "min_touch_target", "id": "add-entry",  "dp": 56 },
    { "assert": "announces",        "id": "row-0",      "value": "137 on 2 January 1999" }
  ]
}
```

### Two rules the gate enforces at load, before anything runs

**1. Assert something a user would notice.** A journey whose only assertion is `screen` is refused.
It proves a screen rendered — which `runtime-gate` already proves — and would be liveness theatre
wearing a journey's clothes.

**2. Use distinguishable values.** `enter` with `""`, `"0"`, or **today's date** is refused. A date
picker that discards your selection and writes `System.currentTimeMillis()` passes a test that
enters today's date. That exact defect survived three separate reviews of the same fixture. Use
`1999-01-02`, `137`, `"zzTest"` — values the product could not have produced by accident.

### Vocabulary

Actions: `launch` · `tap {id}` · `enter {id, value}` · `back` · `wait_for {id}`
Asserts: `screen {id}` · `text_visible {value}` · `text_absent {value}` · `value_equals {id, value}` ·
`min_touch_target {id, dp}` · `announces {id, value}`

`announces` is the accessibility round trip — the stale-TalkBack defect. `min_touch_target` is the
measurement one — a spec saying 56dp is a claim about the **built UI**, not the source.

## Drivers

Executing steps against a device needs a platform driver. **None ship yet.** With no `--driver`,
every declared journey is CANNOT EVALUATE and is listed by name — the honest state, and the reason
this gate cannot currently be mistaken for proof.

A driver is any executable:

```
<driver> --root <project> --journey <path/to/journey.json>
```

It emits **one** `journey-result/v1` JSON object on stdout:

```json
{
  "schema": "journey-result/v1",
  "result": "PASS",
  "journey_id": "record-a-reading",
  "failed_step": null,
  "detail": "10 steps, all assertions held",
  "evidence": ["docs/evidence/journey-record-a-reading-2026-08-04.png"]
}
```

Rules the gate enforces on any driver:

- **`PASS` with an empty `evidence` array is rejected as UNKNOWN.** A pass nobody can inspect is not
  a pass — the same rule that made `runtime-gate` stop returning PASS when its screenshot failed.
- **A driver that crashes is UNKNOWN, not FAIL.** A broken harness must never read as a broken app;
  that is how a developer gets sent to fix a defect that does not exist (DR4-001).
- **A report that is not `journey-result/v1` is UNKNOWN.** Unparseable output is not a verdict.

Suggested first drivers: Android `adb shell uiautomator dump` + `input tap/text` (semantic ids from
`resource-id` / `content-desc`); iOS `xcrun simctl` + an XCUITest runner.

## Where it runs

Declare the journeys during planning — they are the acceptance criteria in executable form, and
`ux-architect`'s screen-and-state inventory is where the ids come from. Run the gate in QA, and
before `/app-ship`. A P0 journey with no declaration is a P0 flow nobody has stated the shape of.
