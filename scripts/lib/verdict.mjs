/**
 * review-verdict/v1 — the output contract for a review gate, enforced at the append.
 *
 * WHY THIS EXISTS
 *
 * `team-doctor` enforces an output contract on the fourteen roles that OWN tickets: a code-tier
 * owner that omits `Second-path check:` fails the build, because every /app-build gate that reads
 * that field would otherwise silently do nothing. The roles that JUDGE — code-reviewer,
 * security-reviewer, tech-lead, cto, tech-manager — were in neither tier, so nothing anywhere
 * checked what a review returns.
 *
 * The measured consequence: `board.mjs move APP-001 approved --by code-reviewer` succeeded with no
 * document, no scope and no evidence. The approval was a WORD. `agents/code-reviewer.md` mandates a
 * literal `## Not checked` heading and says so itself — "Dry run 6 measured a reviewer doing this
 * beautifully unprompted, and also measured that nothing anywhere verified it had." The only
 * assertion about that heading greps the INSTRUCTION FILE. A rule whose only test is that the rule
 * is written down is the exact class this plugin exists to refuse.
 *
 * WHAT THIS IS NOT. It is not a new place to put review documents. `commands/app-build.md` has told
 * reviewers to write `docs/53-reviews/APP-NNN-cycle-N.md` and pass it in `--detail` for a long time;
 * the path convention is unchanged. What changes is that the path moves from free text nothing
 * reads into an input that is opened, parsed, hashed and recorded — the same promotion `--bind` made
 * for the approval's commit range.
 *
 * THE THREE REQUIRED FIELDS, and why each one and no more:
 *
 *   REVIEW VERDICT: APPROVE | REQUEST CHANGES
 *       The verdict in the document must MATCH the event being appended. A document saying REQUEST
 *       CHANGES attached to an `approved` event is the single highest-value thing this can catch:
 *       it is a reviewer, or an orchestrator reading a reviewer, getting the outcome backwards.
 *
 *   Scope: <base>..<head>
 *       What was actually reviewed. This is the field that makes "a PR reviewer reviews the diff,
 *       not the whole app" a recorded fact instead of an instruction. It is deliberately NOT
 *       re-derived from git here — `--bind` already does that, verifies it, and is the authority on
 *       the candidate's true range. This field is the reviewer's own CLAIM about what they read, so
 *       that a later reader can compare the two. Two independent statements that can disagree are
 *       worth more than one that cannot.
 *
 *   ## Not checked
 *       Present always, even when nothing was skipped (then it says so). An omitted section is
 *       indistinguishable from a thorough review, which is how five product defects reached a human
 *       across six dry runs. A fixed heading is what lets a gate, a tech-manager or a founder grep
 *       for the gap rather than trusting its absence.
 *
 * Dimensions covered/N-A are deliberately NOT parsed. `code-reviewer.md` already requires an
 * `N/A: <auditor> — not installed` line per skipped dimension, and a free-form list is a fragile
 * thing to make load-bearing. The `## Not checked` section carries it. If a later run measures a
 * dimension going missing anyway, that is the evidence for parsing it — not this comment.
 *
 * FALSE-POSITIVE BEHAVIOUR, stated plainly: every existing caller that appended `approved` or
 * `changes` without a document now fails. That is the change, not a side effect of it. The exit is
 * one file the reviewer was already told to write.
 */

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

/** The events that assert a review happened, and therefore owe a document. */
export const VERDICT_EVENTS = new Set(['approved', 'changes']);

/** The word each event requires in the document. Keyed by event so the two cannot drift apart. */
const REQUIRED_WORD = { approved: 'APPROVE', changes: 'REQUEST CHANGES' };

const VERDICT_LINE = /^REVIEW VERDICT:[ \t]*(APPROVE|REQUEST CHANGES)[ \t]*$/m;
// A scope of `a..b` with both sides non-empty and neither containing whitespace. `main..HEAD` and a
// sha pair both satisfy it; `Scope: the login screen` does not, and that refusal is the point —
// a scope you cannot resolve to a range is a scope nobody can check you against.
const SCOPE_LINE = /^Scope:[ \t]*(\S+)\.\.(\S+)[ \t]*$/m;
const NOT_CHECKED_HEADING = /^## Not checked[ \t]*$/m;

/**
 * @param {unknown} path   the `--verdict` value, exactly as parsed
 * @param {string}  event  'approved' or 'changes'
 * @param {string}  ticket the ticket the event is about, for the message only
 * @returns {{ok: true, detail: object} | {ok: false, reason: string, code?: number}}
 */
export function readVerdict(path, event, ticket) {
  const word = REQUIRED_WORD[event];
  const how =
    `\n  A review verdict is a file, not a word: ${event} must name the document the review produced.` +
    `\n  Write it at docs/53-reviews/${ticket}-cycle-N.md and pass --verdict <path>. It must contain:` +
    `\n    REVIEW VERDICT: ${word}` +
    '\n    Scope: <base>..<head>          the range you actually read' +
    '\n    ## Not checked                 always present; write "Nothing" when it is empty';

  // `true` is what parseArgs yields for a flag whose value was swallowed. Naming that case is not
  // pedantry: it is the tell for an argument-injection attempt, and "no verdict file at true" is
  // the message that told us `--evidence` had the same hole.
  if (path === true) return { ok: false, reason: `--verdict was given no value (got a bare flag).${how}` };
  if (typeof path !== 'string' || !path.trim()) {
    return { ok: false, reason: `${event} requires --verdict <path>.${how}` };
  }

  const full = resolve(process.cwd(), path);
  // CANNOT EVALUATE, not refused. A missing file is an input this gate never got to read, and the
  // three-state contract says that is exit 2 — the caller's fix is to supply it, which is a
  // different action from "the review said the wrong thing".
  if (!existsSync(full)) return { ok: false, code: 2, reason: `no verdict file at ${path}.${how}` };
  if (!statSync(full).isFile()) return { ok: false, code: 2, reason: `${path} is not a file.${how}` };

  const text = readFileSync(full, 'utf8');

  const verdictMatch = text.match(VERDICT_LINE);
  if (!verdictMatch) {
    return { ok: false, reason: `${path} has no "REVIEW VERDICT: ${word}" line — the verdict is UNKNOWN, which is never an approval.${how}` };
  }
  if (verdictMatch[1] !== word) {
    return {
      ok: false,
      reason:
        `${path} says "REVIEW VERDICT: ${verdictMatch[1]}" but the event being appended is "${event}", which asserts ${word}.` +
        '\n  The document and the board disagree about the outcome of the same review. Fix whichever is wrong;' +
        '\n  do not append the other one.',
    };
  }

  const scope = text.match(SCOPE_LINE);
  if (!scope) {
    return { ok: false, reason: `${path} has no "Scope: <base>..<head>" line — what was reviewed is UNKNOWN, so nobody can tell a one-file review from a whole-app one.${how}` };
  }

  if (!NOT_CHECKED_HEADING.test(text)) {
    return {
      ok: false,
      reason:
        `${path} has no "## Not checked" heading.` +
        '\n  It is required even when the list is empty — write the heading and "Nothing" under it.' +
        '\n  A verdict that silently omits the section is indistinguishable from a thorough one, which is' +
        '\n  how five product defects reached a human across six dry runs.',
    };
  }

  return {
    ok: true,
    detail: {
      verdict: verdictMatch[1],
      verdict_path: path,
      // Content-addressed for the same reason the approval's evidence is: the row records WHICH
      // document was read, so editing the review after the fact is visible rather than silent.
      verdict_hash: createHash('sha256').update(text).digest('hex'),
      reviewed_scope: `${scope[1]}..${scope[2]}`,
    },
  };
}
