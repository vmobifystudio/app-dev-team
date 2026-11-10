'use strict';
// SCORE ENGINE. Deterministic and versioned. The LLM extracts, these rules score.
// Same inputs + same rules version = same output, always. See test/score.test.js.
const fs = require('node:fs');
const path = require('node:path');
const RULES = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'rules', 'score_rules_v1.json'), 'utf8'));

const round1 = (x) => Math.round(x * 10) / 10;
const DAY = 86400000;

function ageDays(submittedOn, asOf) {
  return Math.floor((new Date(asOf) - new Date(submittedOn + 'T00:00:00Z')) / DAY);
}

// Each component returns {points, max, status, note, formula, source}. status 'unavailable' removes it from the denominator.
function component(id, sig, ctx) {
  const def = RULES.components.find((c) => c.id === id);
  const base = { id, title: def.title, max: def.max, formula: def.formula };
  if (!sig || sig.status !== 'ok') {
    return { ...base, status: 'unavailable', points: 0, note: (sig && sig.note) || 'Signal not collected.', source: sig && sig.source };
  }
  let pts = 0;
  let note = '';
  switch (id) {
    case 'citations': {
      const fa = RULES.field_average_citations_per_month[ctx.field] ?? RULES.field_average_citations_per_month.default;
      const cpm = sig.citations / Math.max(ctx.ageMonths, 0.1);
      const ratio = cpm / fa;
      pts = def.max * Math.min(1, ratio / RULES.full_points_at_multiple_of_field_average);
      note = `${sig.citations} citations over ${round1(ctx.ageMonths)} months = ${round1(cpm * 100) / 100} per month. Field average used: ${fa} per month (assumption). Ratio ${round1(ratio * 100) / 100}.`;
      break;
    }
    case 'patents':
      pts = sig.count >= 3 ? 15 : sig.count >= 1 ? 8 : 0;
      note = `${sig.count} patent citations.`;
      break;
    case 'code_data':
      pts = Math.min(15, (sig.code_released ? 10 : 0) + (sig.data_released ? 5 : 0));
      note = `Code released: ${sig.code_released ? 'yes' : 'no'}. Data released: ${sig.data_released ? 'yes' : 'no'}${sig.promised ? ' (promised, not yet public)' : ''}.`;
      break;
    case 'industry': {
      const share = sig.total_authors ? sig.industry_authors / sig.total_authors : 0;
      pts = sig.industry_authors === 0 ? 0 : share >= 0.25 ? 15 : 8;
      note = `${sig.industry_authors} of ${sig.total_authors} authors at industry institutions.`;
      break;
    }
    case 'funder':
      pts = sig.type === 'government' || sig.type === 'nonprofit' ? 10 : sig.type === 'industry' ? 6 : 0;
      note = `Funder type stated in the paper: ${sig.type}.`;
      break;
    case 'readiness': {
      const ok = (sig.cues || []).filter((c) => RULES.components.find((x) => x.id === 'readiness').closed_list.includes(c.cue) && c.locator);
      pts = Math.min(15, ok.length * 3);
      note = `${ok.length} cue(s): ${ok.map((c) => `${c.cue} (${c.locator})`).join('; ') || 'none'}.`;
      break;
    }
    default:
      throw new Error(`unknown component ${id}`);
  }
  return { ...base, status: 'ok', points: round1(pts), note, source: sig.source };
}

// signals: {citations, patents, code_data, industry, funder, readiness}; each {status:'ok'|'unavailable', ...}
function score({ submittedOn, field, signals, asOf }) {
  const age = ageDays(submittedOn, asOf);
  const ctx = { field, ageMonths: age / 30.4375 };
  const parts = RULES.components.map((c) => component(c.id, signals[c.id], ctx));
  const available = parts.filter((p) => p.status === 'ok');
  const availMax = available.reduce((a, p) => a + p.max, 0);
  const earned = round1(available.reduce((a, p) => a + p.points, 0));
  const confidence =
    availMax >= 90 && age >= 180 ? 'high' : availMax >= 60 && age >= RULES.min_age_days_to_score ? 'medium' : 'low';
  const out = {
    rules_version: RULES.version, label: RULES.label, as_of: asOf, age_days: age,
    components: parts, available_weight: availMax, earned_points: earned,
    formula: 'score = round(100 x earned_points / available_weight). Unavailable signals are removed from both sides, never counted as 0.',
  };
  if (age < RULES.min_age_days_to_score) {
    return {
      ...out, status: 'too_new', score: null, confidence: 'low',
      headline: 'Too new to score',
      explain: `Paper is ${age} days old. Scoring starts at ${RULES.min_age_days_to_score} days (assumption). Confidence: low. Check back after ${new Date(new Date(submittedOn + 'T00:00:00Z').getTime() + RULES.min_age_days_to_score * DAY).toISOString().slice(0, 10)}.`,
    };
  }
  if (availMax === 0) return { ...out, status: 'no_signals', score: null, confidence: 'low', headline: 'Not enough signals', explain: 'No outside signal could be collected.' };
  return {
    ...out, status: 'scored', score: Math.round((100 * earned) / availMax), confidence,
    headline: `${Math.round((100 * earned) / availMax)} / 100`,
    explain: `${earned} of ${availMax} available points. Confidence: ${confidence}.`,
  };
}

module.exports = { score, RULES, ageDays };
