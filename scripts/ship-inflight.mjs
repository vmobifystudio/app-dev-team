#!/usr/bin/env node
/**
 * ship-inflight — list the tickets that mean "this sprint is not finished yet".
 *
 * The board-reading half of scripts/ship-gate.sh, split out because it was an inline `awk` — a
 * THIRD parser of the board next to lib/board.mjs and the doctor, and the weakest of the three.
 * Every one of its divergences failed the gate OPEN, which is the only direction that matters for
 * a release gate:
 *
 *   - no Status column (absent, or renamed by a hand-edited board) -> awk left `col` unset, read
 *     an empty cell, matched nothing, and the gate printed CLEAR on a board it had not read
 *   - a backticked status cell (`` `todo` ``) -> never equal to "todo", so an in-flight ticket was
 *     invisible; lib/board.mjs strips backticks, awk did not
 *   - `blocked` was not counted as in flight, so a sprint with a blocked ticket shipped silently
 *   - `id = $2` hardcoded the ID column, which is the field-index mistake the ship gate's own
 *     header comment records as having already happened once
 *
 * Usage:  node scripts/ship-inflight.mjs <path/to/31-board.md>
 * Output: one `ID(status)` per line on stdout (nothing at all means nothing is in flight)
 * Exit:   0 evaluated · 2 CANNOT EVALUATE (reason on stderr) — never 0-with-no-output on a board
 *         that could not be parsed.
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { parseBoard, IN_FLIGHT_STATUS } from './lib/board.mjs';

const cannot = (reason) => {
  process.stderr.write(`ship-inflight: CANNOT EVALUATE — ${reason}\n`);
  process.exit(2);
};

const pathArg = process.argv[2];
if (!pathArg) cannot('no board path given');

const boardPath = resolve(process.cwd(), pathArg);
if (!existsSync(boardPath)) cannot(`no board at ${boardPath}`);

const board = parseBoard(readFileSync(boardPath, 'utf8'));

// parseBoard anchors on the ticket table's own columns (id + status + owner). No rows therefore
// means "I could not find the ticket table", NOT "the sprint is empty" — the two are
// indistinguishable from the output alone, so the difference has to be the exit code.
if (board.rows.length === 0) {
  cannot(
    `no ticket table in ${boardPath} with ID, Owner and Status columns. ` +
      'A renamed or missing Status column makes "is anything still in flight?" unanswerable.'
  );
}

const inFlight = board.rows
  .filter((row) => IN_FLIGHT_STATUS.has((row.status || '').toLowerCase().trim()))
  .map((row) => `${row.id}(${row.status.toLowerCase().trim()})`);

if (inFlight.length > 0) process.stdout.write(`${inFlight.join('\n')}\n`);
