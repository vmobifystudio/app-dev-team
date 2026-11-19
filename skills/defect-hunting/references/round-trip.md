# defect-hunting §4b — follow the user's value across the boundary (the round trip)

Loaded from `defect-hunting` SKILL.md for any change touching a value a user supplies, sees, or is told.

§1 asks who else *writes* the value. This asks a different question: **does the value the user
supplied actually arrive?**

Six dry runs of this studio produced a consistent, humiliating result. The gates caught version
mismatches, illegal board transitions, fake test commands, an unspawnable owner — every one a
*process* defect. They caught **none** of these:

| What the user did | What the product did | Why every gate passed |
|---|---|---|
| picked a date in the date picker | saved `System.currentTimeMillis()` | the picker rendered; the save succeeded; the unit test tested the formatter |
| expected a 56dp touch target | got 24dp | the spec said 56dp; the composable compiled; nothing measured the built UI |
| changed the count, using TalkBack | heard the **previous** count | the state updated; the announcement was never re-read |
| had corrupt stored data | saw an empty list | the parse "succeeded" into `[]`; empty state is indistinguishable from data loss |
| ran the device test | exercised the test's own stub | the test passed. It tested itself. |

Every one was found by a reviewer who **went and looked**, or by a human reading the app afterwards.
Not one was found by a gate. That is the single most important measured fact about this system, and
it is why this section exists.

### The shape

**A value crosses a boundary and does not arrive, and nothing on either side notices.** The
collecting surface is correct. The storing code is correct. The test is correct *about the helper it
tests*. The defect lives in the seam, which is exactly where nobody's unit test is.

### The question that does the work

> **"Where is the value the user supplied read, and where is it written — and are they the same value?"**

Not "does the save path work". Not "does the picker render". Name the **line** that reads the user's
input and the **line** that persists it, and put them next to each other. If a literal, a clock call,
a default, or a different variable appears between them, that is the finding.

### Procedure

For any change touching a value a user supplies, sees, or is told:

1. **Name the value** — the date, the count, the label, the announcement, the measurement.
2. **Find the collection site.** The control, the argument, the sensor read.
3. **Find the persistence/render site.** The write, the DAO call, the announced string.
4. **Read the path between them.** Not the function names — the actual assignments.
5. **Execute the round trip.** Supply a distinguishable value (never `0`, never today's date, never
   the default — those are indistinguishable from the bug). Read it back through the product's own
   surface. `1999-01-02` survives; `System.currentTimeMillis()` does not.
6. **Measure what the spec quantifies.** A spec that says 56dp is a claim about the built UI, not
   about the source. Measure it on-device (`uiautomator dump`, accessibility inspector) or state
   plainly that you did not.

### The corollary that costs a product defect to learn

**An empty result and a lost result look identical.** A parse that falls back to `[]`, a fetch that
returns no rows, a restore that finds nothing — each is either "there is nothing" or "there was
something and it is gone." If the code cannot tell those apart, neither can the user, and neither
can you. Make the failure branch say which one it is; that is a three-state contract applied to
data instead of to gates.

### The adversarial obligation

The most valuable behaviour observed in any dry run was a reviewer who, unprompted:

- **re-measured on-device** rather than accepting the developer's stated numbers; and
- **reintroduced the bug** in a scratch edit to prove the new regression test actually caught it.

That was one reviewer having a good day. It is now the contract — see §3's "prove the rule can fail",
of which this is the product-facing half. A regression test nobody watched fail is a regression test
nobody has any reason to trust, and a number you did not measure is a number the developer measured.
