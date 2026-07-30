# iOS implementation spec (fixture)

Small on purpose. It exists so the dashboard's artifact sweep has a spec to read requirements out
of, and it reproduces DR4-019 exactly: one artifact the build cannot start without, sitting between
two charters, named by no ticket.

## 4.2 The calculation model

`TipJar/TipCalculation.swift` — owned by APP-001, which names it.

## 4.1 The screen

`TipJar/CalculatorView.swift` — owned by APP-002, which names it.

## 6 Project generation — the race note

The Xcode project is generated from `/project.yml`. devops-engineer owns "plumbing"; the iOS
developer needs it to compile. Whoever needs it first creates it. **No ticket on the board names
it**, which is the whole point of this fixture: it is required here, it does not exist, and it
belongs to nobody.

## 8 Tests

`TipJarTests/TipCalculationTests.swift` — named by no ticket either, and equally missing.
