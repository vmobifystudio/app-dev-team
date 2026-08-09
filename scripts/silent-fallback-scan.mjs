#!/usr/bin/env node
/**
 * silent-fallback-scan — PF-002: a corrupt-data fallback indistinguishable from empty.
 *
 * THE DEFECT. Malformed persisted data is caught and returned as an empty list. The user whose file
 * was corrupted sees exactly what a brand-new user sees: nothing. No error, no telemetry, no way for
 * support to tell "you have no data" from "we lost your data".
 *
 * It survives review because it READS AS CARE. The `catch` is there, the crash it prevents is real,
 * and the diff looks defensive. What it destroys is the distinction between two states that must
 * never be conflated — and it destroys it silently, which is why six dry runs never caught it.
 *
 * THE PRODUCT FAILURE CORPUS DID NOT EXIST UNTIL 2026-08-06. Every product defect our own reports
 * kept listing was written down and never mechanised, while `failure-corpus.md` sat alongside with
 * seven STUDIO classes each carrying a working Tell. This is the first class taken through that bar
 * in the other direction. See knowledge/product-failure-corpus.md.
 *
 * WHAT IT REPORTS, AND WHY IT IS A WARNING RATHER THAN A BLOCK BY DEFAULT.
 *
 * The pattern is a strong smell, not a proof: some empty-on-failure returns are correct (an optional
 * cache, a best-effort lookup where absence and failure genuinely mean the same thing to the
 * caller). A scan that BLOCKED on all of them would be refused-everything theatre and would be
 * switched off within a week — and a switched-off gate protects nothing. So it names each site and
 * asks the one question that decides it:
 *
 *     can the caller tell this from a legitimately empty result?
 *
 * `--strict` turns findings into a block, for projects that have decided the answer is always no.
 *
 * Exit codes:
 *   0  no sites found, or sites found in warn mode
 *   1  sites found and --strict
 *   2  cannot evaluate — the root does not exist or holds no source this scan understands
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const root = process.argv[2];
const strict = process.argv.includes('--strict');
if (!root || !existsSync(root)) {
  process.stderr.write('silent-fallback-scan: project root is missing\n');
  process.exit(2);
}

const SKIP = new Set(['.git', 'node_modules', 'Pods', 'dist', 'build', '.gradle', 'DerivedData', '.agent-wt']);
const EXT = /\.(swift|kt|java|ts|tsx|js|jsx)$/;

function files(path, out = []) {
  let info;
  try { info = statSync(path); } catch { return out; }
  if (info.isDirectory()) {
    for (const name of readdirSync(path)) if (!SKIP.has(name)) files(join(path, name), out);
  } else if (EXT.test(path)) out.push(path);
  return out;
}

const sources = files(root);
if (!sources.length) {
  // NOT APPLICABLE, NOT CANNOT-EVALUATE — and the difference is not pedantry.
  //
  // The first version exited 2 here, reasoning that "nothing scanned" must never read as clean.
  // That is right about a project whose source could not be READ, and wrong about one that has no
  // source of these languages at all: a docs-only or backend-service project has nothing for this
  // class to be true of. It poisoned six ship-gate fixtures immediately — the gate went CANNOT
  // EVALUATE on projects that were genuinely fine, which is the false-block half of the
  // false-positive problem and gets a gate switched off just as fast.
  //
  // The studio's five states already carry this distinction (readiness: NOT_APPLICABLE, "the gate
  // has nothing to say about this project"). Using it is what keeps exit 2 meaning something.
  process.stdout.write('SILENT FALLBACK SCAN: N/A — no Swift/Kotlin/Java/TS source under this root.\n');
  process.stdout.write('  Nothing to scan is not the same as a clean sweep; this class simply cannot apply here.\n');
  process.exit(0);
}

/**
 * An empty/default value returned from a failure path.
 *
 * Deliberately narrow. `return null` alone would fire on half of every codebase; what makes this
 * class is an empty COLLECTION or a default instance handed back where a READ of persisted data
 * failed, because that is the value a caller cannot distinguish from "there genuinely is none".
 */
const EMPTY = String.raw`(\[\]|\{\}|emptyList\(\)|emptyMap\(\)|emptySet\(\)|listOf\(\)|mapOf\(\)|Collections\.empty\w*\(\)|new\s+ArrayList<>\(\)|\[:\])`;
// `return X` OR a bare `X` alone on its line. THE BARE FORM IS NOT OPTIONAL: Kotlin's try-as-
// expression is written `} catch (e: Exception) { emptyList() }` with no `return` keyword at all,
// and requiring `return` missed the very first example this scan was written against — the exact
// shape from the dry run. A detector that misses its own originating incident is FC-006.
const EMPTY_RETURN = new RegExp(String.raw`(\breturn\s+${EMPTY}|^\s*${EMPTY}\s*$)`, 'm');
/** The `try` that matters: a read of persisted user data, not any old failure. */
const PERSISTED_READ = /\b(decode|deserializ|fromJson|JSONDecoder|JSONSerialization|ObjectMapper|readFile|readText|contentsOf|Data\(contentsOf|SharedPreferences|UserDefaults|localStorage|\.parse\(|JSON\.parse)/i;
/** A site that reports is not silent. If any of these appear in the handler, it is not this class. */
const REPORTS = /\b(log|Log\.|logger|print|os_log|assert|analytics|track|report|throw|rethrow|crashlytics|recordError|Sentry)/i;

const findings = [];
for (const file of sources) {
  let text;
  try { text = readFileSync(file, 'utf8'); } catch { continue; }
  const lines = text.split('\n');
  for (const [i, line] of lines.entries()) {
    if (!/\bcatch\b/.test(line)) continue;
    // The handler body: this line plus the next few. Cheap, and the class lives in short handlers —
    // a long handler almost always logs, which takes it out of scope anyway.
    const body = lines.slice(i, i + 6).join('\n');
    if (!EMPTY_RETURN.test(body)) continue;
    if (REPORTS.test(body)) continue;
    // The `try` above it, BOUNDED TO THE ENCLOSING FUNCTION.
    //
    // A flat 12-line lookback crossed function boundaries and reported a plain in-memory cache
    // lookup because the function ABOVE it happened to call readFile — a false positive on this
    // scan's first execution, on a fixture written to prove it would not fire there. This file's
    // own header says a scan that refuses everything gets switched off within a week; shipping it
    // with a boundary bug would have been that, immediately.
    let start = Math.max(0, i - 12);
    for (let j = i - 1; j >= start; j -= 1) {
      if (/^\s*(public\s+|private\s+|internal\s+|suspend\s+|static\s+|override\s+)*(fun|func|function|def)\b/.test(lines[j])) {
        start = j;
        break;
      }
    }
    const before = lines.slice(start, i).join('\n');
    if (!PERSISTED_READ.test(before) && !PERSISTED_READ.test(body)) continue;
    findings.push({ file: file.slice(root.length + 1), line: i + 1, text: line.trim() });
  }
}

if (!findings.length) {
  process.stdout.write(`SILENT FALLBACK SCAN: CLEAR — ${sources.length} source file(s) swept, no silent empty-on-corruption returns.\n`);
  process.exit(0);
}

process.stdout.write(`SILENT FALLBACK SCAN: ${findings.length} site(s) where corrupt data may be indistinguishable from empty\n\n`);
for (const f of findings) {
  process.stdout.write(`  ${f.file}:${f.line}\n      ${f.text}\n`);
}
process.stdout.write(
  '\n  PF-002. For each: CAN THE CALLER TELL THIS FROM A LEGITIMATELY EMPTY RESULT?\n' +
  '  If not, a user whose data was corrupted sees what a new user sees — and nobody can tell\n' +
  '  "you have no data" from "we lost your data", including support, six months from now.\n' +
  '\n' +
  '  Some of these are correct: an optional cache, a best-effort lookup where absence and failure\n' +
  '  genuinely mean the same thing. This names the sites; a reviewer decides. It is a warning\n' +
  '  rather than a block for that reason — a scan that refused everything would be switched off,\n' +
  '  and a switched-off gate protects nothing. Use --strict where the answer is always no.\n'
);
process.exit(strict ? 1 : 0);
