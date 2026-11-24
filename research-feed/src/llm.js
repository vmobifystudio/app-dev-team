'use strict';
// LLM LAYER. The model drafts. It never decides the license or the score.
// Two providers:
//   recorded  : replays a saved structured draft (used for the two demo papers and for tests; no network).
//   anthropic : live call with structured output (tool use). Needs ANTHROPIC_API_KEY. NOT exercised in this build.
const fs = require('node:fs');
const path = require('node:path');
const { sha256, ROOT } = require('./db');

const DAILY_CALL_CAP = Number(process.env.RF_DAILY_CALL_CAP || 25);
const DAILY_USD_CAP = Number(process.env.RF_DAILY_USD_CAP || 10);
const PROMPT_VERSION = 'draft-prompt-1.0.0';

const TIER_RULES = {
  FULL_REUSE_WITH_CREDIT: 'Paper is CC BY or CC0. Short verbatim quotes are allowed only if listed in "reuse" and credited. Still write in your own words by default.',
  IDEAS_ONLY: 'Ideas and facts only. Own words, own structure. No copied sentences. No section-by-section mirroring. Never describe a figure or table design; give numbers only.',
};

function buildPrompt({ meta, tier, sourceSha, factsLocators }) {
  return [
    `PROMPT ${PROMPT_VERSION}`,
    'You write one Vizmaya story: vertical cards, ONE point per card, plain English a 12-year-old follows.',
    'Structure: hook, open questions that pull to the next card, climax, payoff. Add a "contested" card when a headline claim and the paper\'s own tables disagree.',
    `LICENSE TIER: ${tier}. ${TIER_RULES[tier]}`,
    'RULES: every sentence that states a fact or a number must list claim ids. Every claim needs a locator from this list only: ' + factsLocators.join('; '),
    'Numbers you compute must be kind "computed" with a formula over quoted inputs. If you cannot source a claim, leave the sentence out.',
    'Sentences: at most 24 words. No investing language. No hype. Do not review the authors; explain what the research shows.',
    `PAPER: ${meta.title} (arXiv:${meta.arxiv_id}${meta.version}). Source text sha256: ${sourceSha || 'not supplied'}`,
  ].join('\n');
}

// JSON schema for structured output (shape matches content/drafts/*.json).
const DRAFT_SCHEMA = {
  type: 'object',
  required: ['schema', 'title', 'deck', 'claims', 'cards'],
  properties: {
    schema: { const: 'vizmaya-story/1' }, title: { type: 'string' }, deck: { type: 'string' }, slug: { type: 'string' },
    reuse: { type: 'array', items: { type: 'object' } },
    claims: { type: 'object', additionalProperties: { type: 'object', required: ['kind', 'display'] } },
    cards: { type: 'array', items: { type: 'object', required: ['id', 'type', 'headline', 'sentences'] } },
  },
};

function today(clock) { return (clock ? clock() : new Date()).toISOString().slice(0, 10); }

function takeBudget(db, estUsd, clock) {
  const day = today(clock);
  db.prepare('INSERT OR IGNORE INTO ai_budget (day) VALUES (?)').run(day);
  const row = db.prepare('SELECT calls, usd FROM ai_budget WHERE day=?').get(day);
  if (row.calls + 1 > DAILY_CALL_CAP) throw new Error(`AI cap reached: ${row.calls}/${DAILY_CALL_CAP} calls today`);
  if (row.usd + estUsd > DAILY_USD_CAP) throw new Error(`AI cap reached: $${row.usd.toFixed(2)} + $${estUsd.toFixed(2)} > $${DAILY_USD_CAP} today`);
  db.prepare('UPDATE ai_budget SET calls=calls+1, usd=usd+? WHERE day=?').run(estUsd, day);
}

const recorded = {
  name: 'recorded',
  model: 'claude-sonnet-5-5 (drafted in a Claude Code session, replayed from file)',
  async draft({ meta }) {
    const file = path.join(ROOT, meta.draft);
    const text = fs.readFileSync(file, 'utf8');
    return { draft: JSON.parse(text), outputText: text, costUsd: 0.4 }; // 0.4 = the story-cost assumption, for budgeting tests
  },
};

const anthropic = {
  name: 'anthropic',
  model: process.env.RF_MODEL || 'claude-sonnet-5-5',
  async draft({ prompt, sourceText }) {
    const key = process.env.ANTHROPIC_API_KEY;
    if (!key) throw new Error('ANTHROPIC_API_KEY is not set');
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: this.model, max_tokens: 8000,
        tools: [{ name: 'submit_story', description: 'Submit the finished story.', input_schema: DRAFT_SCHEMA }],
        tool_choice: { type: 'tool', name: 'submit_story' },
        messages: [{ role: 'user', content: `${prompt}\n\n--- PAPER TEXT ---\n${sourceText}` }],
      }),
    });
    if (!res.ok) throw new Error(`Anthropic API ${res.status}`);
    const j = await res.json();
    const tool = (j.content || []).find((b) => b.type === 'tool_use');
    if (!tool) throw new Error('model returned no structured output');
    const usd = ((j.usage?.input_tokens || 0) * 3 + (j.usage?.output_tokens || 0) * 15) / 1e6; // assumption: $3/$15 per million tokens
    return { draft: tool.input, outputText: JSON.stringify(tool.input), costUsd: usd };
  },
};

// Run a provider with the budget guard and write the audit row.
async function runDraft(db, provider, args, clock) {
  const prompt = buildPrompt(args);
  takeBudget(db, args.estUsd ?? 0.4, clock);
  const out = await provider.draft({ ...args, prompt });
  const run = db.prepare(
    `INSERT INTO llm_runs (story_id, provider, model, prompt_sha, prompt_text, output_sha, cost_usd, created_at)
     VALUES (NULL,?,?,?,?,?,?,?)`,
  ).run(provider.name, provider.model, sha256(prompt), prompt, sha256(out.outputText), out.costUsd, (clock ? clock() : new Date()).toISOString());
  return { draft: out.draft, runId: Number(run.lastInsertRowid) };
}

module.exports = { recorded, anthropic, runDraft, buildPrompt, DRAFT_SCHEMA, PROMPT_VERSION };
