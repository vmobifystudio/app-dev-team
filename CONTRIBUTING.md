# Contributing to app-dev-team

Thanks for your interest. This plugin is a team of Claude Code agents, skills, and commands.
Almost everything here is **Markdown** — agents, commands, and skills are prompt files with
YAML frontmatter. No build step.

## Repo layout

```
.claude-plugin/plugin.json   Plugin manifest
agents/                      One Markdown file per role (the system prompt for that agent)
commands/                    Slash commands (/app-init, /app-run, ...)
skills/                      Reusable procedures agents invoke
knowledge/                   Mobify Studio house knowledge base (mined house conventions)
docs/                        Design specs and plugin docs
```

## How to add or change a role

1. Copy an existing file in `agents/` as a template — match the frontmatter shape
   (`name`, `description`, `tools`, `model`).
2. Keep the writing concrete and contract-driven: inputs it reads, deliverables it writes,
   the exact `DONE:` / `BLOCKED:` output contract, and what it must **never** do.
3. If the role does platform work, point it at the right skills under a
   **"Skills you must use"** heading (soft routing — never a hard dependency).
4. Register it in `README.md`'s roster table.

## How to add a command

1. Add a file in `commands/` with frontmatter (`description`, `argument-hint`, `allowed-tools`).
2. Spell out the step list. If it spawns agents in parallel, reference the
   `parallel-orchestrator` skill and launch all agents in a single assistant message.

## Conventions

- Prefer multiple-choice / contract-driven prompts over open-ended prose.
- Agents communicate through files under the target project's `docs/`, never through hidden state.
- Never introduce a hard dependency on an external MCP server — the plugin must run on a
  vanilla Claude Code install.

## Validating

Run the `plugin-dev:plugin-validator` agent (or `/plugin-dev:create-plugin`) to lint structure
before opening a PR.

## Commit style

`type: short summary` (e.g. `agents: add monetization-engineer`). Keep PRs focused.
