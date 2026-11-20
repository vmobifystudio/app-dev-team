/**
 * Risk routing — ONE implementation, read by risk-router.mjs (planning time, from --file) and by
 * board.mjs at `merged` (from the ticket's actual diff, G-F7). Planning-time risk is a guess about
 * which files a ticket will touch; the diff is what it did touch, and a ticket planned "medium"
 * that edits auth/ must not merge on a medium ticket's approvals.
 */
export const RANK = { low: 0, medium: 1, high: 2, critical: 3 };

/** `policy` is risk-policy/v1. Returns the selected route for one input string, or null. */
// G7-5: every rule at the winning tier contributes its approvals and evidence (a billing rule's
// security review and a migration rule's plan are both owed when one diff touches both).
const union = (rules, k) => [...new Set(rules.flatMap((r) => r[k] || []))];
export function route(policy, input) {
  const matched = policy.rules.filter((rule) => new RegExp(rule.pattern).test(input));
  const selected = [...matched].sort((a, b) => RANK[b.risk] - RANK[a.risk])[0] || policy.default;
  if (!selected || !selected.model || !selected.risk) return null;
  const tier = matched.length ? matched.filter((r) => r.risk === selected.risk) : [selected];
  return { risk: selected.risk, model: selected.model, approvals: union(tier, 'approvals'), required_evidence: union(tier, 'required_evidence'), matched_rules: matched.length };
}

/**
 * The route for a set of changed files: each file is routed on its own (a regex must not match
 * across two file names), the highest tier wins, and the winning tier's approvals and evidence are
 * what it demands. `files` empty -> null (nothing to say).
 */
export function routeFiles(policy, files) {
  let best = null;
  for (const f of files) {
    const r = route(policy, f);
    if (!r) continue;
    if (!best || RANK[r.risk] > RANK[best.risk]) best = { ...r, because: f };
    else if (r.risk === best.risk) {
      best.approvals = [...new Set([...best.approvals, ...r.approvals])];
      best.required_evidence = [...new Set([...best.required_evidence, ...r.required_evidence])];
    }
  }
  return best;
}
