#!/usr/bin/env node
/**
 * Credential redaction — one pattern set, used by everything that writes text an agent produced.
 *
 * The threat is not a clever exfiltration. It is an agent pasting a working `.env` line into a
 * blocker message "so the reviewer can reproduce it", and that message being a Markdown ledger
 * committed to git, rendered into a dashboard and quoted in a standup. Four artifacts, one paste,
 * and the credential is now in history where deleting it does nothing.
 *
 * So redaction happens at the WRITE, not at review time. `team-message.sh` filters through this
 * before appending; `board.mjs` filters `--detail` and every free-text ticket field; the dashboard
 * filters what it renders. Each one says out loud that it redacted, because silent redaction means
 * an operator debugging a truncated string never learns why.
 *
 * PATTERN CHOICE: shape-specific over generic. `AKIA…`, `ghp_…`, `xox[bp]-…`, a PEM header, a JWT
 * — these have almost no false-positive surface. The one generic rule (`password=` / `api_key=` /
 * `secret:` followed by 8+ non-space characters) is the one that will occasionally fire on prose,
 * and it is worth it: an assignment with a real value next to it is what a leaked credential looks
 * like in every incident this studio can produce.
 *
 * FALSE POSITIVE BEHAVIOUR, per caller:
 *   - team-message / board: the field is redacted and the write proceeds. Nobody is blocked; the
 *     text loses a token. An operator who needed that token verbatim did not need it in a ledger.
 *   - the scanner (`--scan`) exits 1 and names file:line. That one can block, so it is deliberately
 *     pointed at GENERATED ARTIFACTS only, never the whole repo — a threat model doc that quotes a
 *     token shape must not fail the build.
 *   - `PLACEHOLDER` values (`api_key=<your-key>`, `token=xxx`, `secret=REDACTED`) are skipped, which
 *     is the single most common shape in documentation.
 *
 * Usage as a CLI:
 *   node scripts/lib/redact.mjs --filter          stdin -> redacted stdout (exit 0)
 *   node scripts/lib/redact.mjs --scan <file...>  report file:line:kind; exit 1 if any found
 */

import { readFileSync } from 'node:fs';

/**
 * Each entry: [kind, regex]. The regexes are written so this file does not match itself — a scanner
 * that flags its own pattern list is a scanner people delete.
 */
const PATTERNS = [
  ['aws-access-key-id', /\bAKIA[0-9A-Z]{16}\b/g],
  ['github-token', /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36,}\b/g],
  ['github-fine-grained-token', /\bgithub_pat_[A-Za-z0-9_]{22,}\b/g],
  ['slack-token', /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g],
  ['google-api-key', /\bAIza[0-9A-Za-z_-]{35}\b/g],
  ['stripe-key', /\b[sr]k_(?:live|test)_[0-9A-Za-z]{16,}\b/g],
  ['openai-key', /\bsk-(?:proj-)?[A-Za-z0-9_-]{32,}\b/g],
  ['private-key-block', /-----BEGIN (?:RSA |EC |OPENSSH |PGP |DSA )?PRIVATE KEY-----/g],
  ['jwt', /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g],
  ['bearer-token', /\bBearer\s+[A-Za-z0-9._~+/-]{20,}=*/g],
  // DELIBERATELY ABSENT: Apple app-specific passwords (`abcd-efgh-ijkl-mnop`). The shape is four
  // lowercase quads, which also matches ordinary hyphenated English ("this-that-when-then") and
  // every kebab-case identifier of that length. A pattern that fires on prose gets the whole
  // scanner switched off, and this one has no distinguishing prefix to anchor on.
  // The generic rule, last so a shape-specific match wins the label.
  ['credential-assignment', /\b(?:password|passwd|api[_-]?key|secret|access[_-]?token|auth[_-]?token|client[_-]?secret)\b\s*[:=]\s*["']?([^\s"'`,;]{8,})/gi],
];

/**
 * Values that look like a credential assignment but are documentation. This list is the difference
 * between a check people keep and a check people switch off.
 */
const PLACEHOLDER = /^(?:<|\{\{|\$\{|\$[A-Z_]|x{3,}|\*{3,}|\.{3,}|your[_-]|my[_-]|example|placeholder|redacted|changeme|todo|null|none|true|false)/i;
const PLACEHOLDER_EXACT = new Set(['[REDACTED]', 'REDACTED', 'undefined']);

const isPlaceholder = (value) =>
  !value || PLACEHOLDER.test(value) || PLACEHOLDER_EXACT.has(value) || value.includes('REDACTED');

/**
 * @returns {{kind: string, match: string, index: number}[]}
 */
export function findSecrets(text) {
  const found = [];
  const source = String(text ?? '');
  for (const [kind, pattern] of PATTERNS) {
    pattern.lastIndex = 0;
    let m;
    while ((m = pattern.exec(source)) !== null) {
      const value = m[1] !== undefined ? m[1] : m[0];
      if (isPlaceholder(value)) continue;
      if (found.some((f) => m.index < f.index + f.match.length && f.index < m.index + m[0].length)) continue;
      found.push({ kind, match: m[0], index: m.index });
      if (m[0].length === 0) pattern.lastIndex += 1;
    }
  }
  return found.sort((a, b) => a.index - b.index);
}

/**
 * Replace every credential-shaped run with `[REDACTED:<kind>]`.
 * Returns `{text, redacted}` — `redacted` is the kinds found, so the caller can SAY it redacted.
 */
export function redact(text) {
  const source = String(text ?? '');
  const found = findSecrets(source);
  if (!found.length) return { text: source, redacted: [] };
  let out = '';
  let cursor = 0;
  for (const f of found) {
    if (f.index < cursor) continue;
    out += source.slice(cursor, f.index) + `[REDACTED:${f.kind}]`;
    cursor = f.index + f.match.length;
  }
  out += source.slice(cursor);
  return { text: out, redacted: [...new Set(found.map((f) => f.kind))] };
}

// --- CLI ----------------------------------------------------------------------------------------

const isMain = process.argv[1] && process.argv[1].endsWith('redact.mjs');

if (isMain) {
  const argv = process.argv.slice(2);
  if (argv[0] === '--filter') {
    const input = readFileSync(0, 'utf8');
    const { text, redacted } = redact(input);
    process.stdout.write(text);
    if (redacted.length) process.stderr.write(`redact: removed ${redacted.join(', ')}\n`);
    process.exit(0);
  }
  if (argv[0] === '--scan') {
    const files = argv.slice(1);
    if (!files.length) {
      process.stderr.write('redact: --scan needs at least one path\n');
      process.exit(2);
    }
    let hits = 0;
    for (const file of files) {
      let text;
      try {
        text = readFileSync(file, 'utf8');
      } catch {
        continue; // a generated artifact that was not generated is not this check's finding
      }
      text.split('\n').forEach((line, i) => {
        for (const f of findSecrets(line)) {
          hits += 1;
          process.stdout.write(`${file}:${i + 1}: ${f.kind}\n`);
        }
      });
    }
    if (hits) {
      process.stdout.write(
        `\nSECRETS: ${hits} credential-shaped string(s) reached a generated artifact.\n` +
          '  These files are committed and rendered. Rotate anything real, then remove it at the\n' +
          '  source that wrote it — deleting it here leaves it in git history.\n'
      );
      process.exit(1);
    }
    process.stdout.write(`SECRETS: none in ${files.length} artifact(s)\n`);
    process.exit(0);
  }
  process.stderr.write('usage: redact.mjs --filter | --scan <file...>\n');
  process.exit(2);
}
