# defect-hunting §1b — prove the new code is reachable, and its required companions exist

Loaded from `defect-hunting` SKILL.md when a diff adds a function, component, type, constant or route.

### The question that does the work

> **"Who calls this, outside its own definition?"**

Applied to every function, component, type, constant, or route the diff introduces.

### Procedure

1. For each new symbol the diff adds, search for a real call/reference site **outside the file that
   defines it** (or outside its own declaration, for a symbol used only within one file). `export`ed
   with zero importers is the specific, mechanical shape to catch — `grep -rn '<Name>' src/ | grep
   -v '<file that defines it>'` at minimum; prefer an AST-aware search (`ast-grep`) over plain
   `grep`/`rg` where the language has one available, since text search false-negatives on a renamed
   reference or a match sitting inside a comment or string.
2. **Missing co-changes** — the same "enumerate" discipline as §1, aimed at what a change like this
   one *always* requires alongside it, not at what it says it changed: an implementation with no
   test file for it, a new database column with no migration, a new API handler with no route
   registration, a changed struct/type with no update to its (de)serialization. Name the class of
   companion this diff's *kind* of change requires, then confirm each one is actually present.
3. Dead code found this way is not a style nit — it is unreviewed, untested surface area sitting in
   the codebase looking finished. Either wire it in or delete it. "Leave it for later" is how it
   becomes permanent.
