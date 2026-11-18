# defect-hunting — review checklist

Attach to any `code-reviewer` or audit verdict:

- [ ] Ran **every Tell in `${CLAUDE_PLUGIN_ROOT}/knowledge/failure-corpus.md`** against this diff, and cited the class ID
      for each finding it produced

- [ ] Named the data this change touches, and enumerated **every** writer and reader of it
- [ ] Checked the edit / cancel / failure / restore / import paths, not just the happy path
- [ ] **Every new symbol the diff exports has a real caller outside its own definition (§1b)** — or
      is named here as dead code to delete before merge
- [ ] **Missing co-changes checked (§1b)** — new code has its test file, a new column has its
      migration, a new handler is registered, a changed type has its (de)serialization updated
- [ ] **Any new or changed test survives a real mutation of the code it covers (§3b)** — not just
      typechecks or reads as reasonable
- [ ] **Followed each user-supplied or user-visible value across the boundary (§4b)** — named the
      line that reads it and the line that writes it, and confirmed they are the same value
- [ ] **Ran the round trip with a distinguishable value** (never `0`, never today's date, never the
      default) and read it back through the product's own surface
- [ ] **Measured, on-device, anything the spec quantifies** (touch targets, contrast, timings) — or
      stated plainly that it was not measured
- [ ] **An empty result is distinguishable from a lost one** on every failure branch this diff touches
- [ ] Every constant or threshold with a real-world claim was **executed** against reference data
- [ ] Any new rule or test was **watched failing** before being trusted — including **reintroducing
      the defect** in a scratch edit to prove this diff's own regression test catches it
- [ ] No rule in this diff passes by matching a comment
- [ ] Any "not present" claim was made with two different searches
- [ ] Every finding raised has an ID and a non-blank status

Anything unchecked is stated as unchecked in the verdict. Never let a box go unmentioned — an
unstated gap reads as a cleared one.
