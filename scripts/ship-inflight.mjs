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
 * It also carries the `verified_static` flag through, which nothing in the release path could see:
 * lib/board.mjs split `qa (static only)` into `status` + `staticOnly`, and then board-doctor, this
 * file and ship-gate.sh all keyed on the bare status. A ticket verified WITHOUT ITS SUITE EVER
 * RUNNING therefore reached `qa`, passed every release precondition, and shipped CLEAR — the state
 * was added to the state machine and the consumer that decides whether to release could not reach
 * it. `qa`/`done` are not in IN_FLIGHT_STATUS on purpose, so the flag needs its own line.
 *
 * Usage:  node scripts/ship-inflight.mjs <path/to/31-board.md>
 * Output: one `ID(status)` per line on stdout, `ID(status,static-only)` for a ticket verified
 *         without running its suite (nothing at all means nothing is in flight and nothing is
 *         static-only)
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

const reported = board.rows
  .filter((row) => IN_FLIGHT_STATUS.has((row.status || '').toLowerCase().trim()) || row.staticOnly)
  .map((row) => `${row.id}(${row.status.toLowerCase().trim()}${row.staticOnly ? ',static-only' : ''})`);

if (reported.length > 0) process.stdout.write(`${reported.join('\n')}\n`);
