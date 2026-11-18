/**
 * One argument parser for every Node script in this repo.
 *
 * `board.mjs` was fixed alone: `--detail "--board=/tmp/x"` set `detail` to `true` and `board` to an
 * arbitrary path, so the CLI rendered the board OVER AN ARBITRARY FILE. The fix landed in that one
 * file, and `round-journal.mjs` shipped a byte-identical copy of the hole — `--note "--journal=..."`
 * has the same shape and writes the loop's budget ledger somewhere nobody looks. The review
 * question dry run 4 ends on ("who else touches this value between the fix and the human?") answers
 * itself here: three other scripts hand-rolled the same loop.
 *
 * The rule this enforces, in one sentence: **a token in a value position is a value, whatever it
 * looks like.** Declare which flags take values and a `--`-shaped value can never become a flag.
 *
 * This is a shared *validator*, not a layer: the four callers delete their own copy of the loop, so
 * the file count goes up by one and the parser count goes down by three.
 */

/**
 * @param {string[]} argv          arguments after the script name
 * @param {object}   spec
 * @param {Set<string>} spec.valueFlags  flags that consume the next token as a value
 * @param {Set<string>} [spec.knownFlags] every legal flag; an unknown one is a usage error.
 *                                        Omit to accept anything (board.mjs's historical behaviour).
 * @param {(code:number, message:string)=>never} spec.die  how this caller reports and exits
 * @param {Record<string,string>} [spec.listFlags] C4W-7: list-valued flags and their separator. A
 *                                        repeated one ACCUMULATES (`--file a --file b` is `a,b`) —
 *                                        last-wins silently dropped every file but the last.
 * @returns {{flags: Record<string, string|true>, positional: string[]}}
 */
export function parseArgs(argv, { valueFlags, knownFlags = null, die, listFlags = {} }) {
  const flags = {};
  const set = (name, value) => {
    const prev = flags[name];
    flags[name] = Object.hasOwn(listFlags, name) && typeof prev === 'string' && typeof value === 'string'
      ? `${prev}${listFlags[name]}${value}` : value;
  };
  const positional = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) {
      positional.push(arg);
      continue;
    }
    const [name, inline] = arg.slice(2).split(/=(.*)/s);
    if (knownFlags && !knownFlags.has(name)) die(1, `unknown flag --${name}`);
    if (inline !== undefined) {
      set(name, inline);
    } else if (valueFlags.has(name)) {
      // Not `argv[i+1] && !argv[i+1].startsWith('--')`. A value-taking flag whose value is missing
      // is a usage error, never a silent `true` and never a silent fallback to the default — both
      // of those are how "the operator asked for X" becomes "the tool did Y and said nothing".
      if (i + 1 >= argv.length) die(2, `--${name} needs a value`);
      set(name, argv[(i += 1)]);
    } else if (argv[i + 1] && !argv[i + 1].startsWith('--')) {
      set(name, argv[(i += 1)]);
    } else {
      flags[name] = true;
    }
  }
  return { flags, positional };
}
