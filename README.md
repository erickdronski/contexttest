<p align="center">
  <img src="assets/contexttest-mark.svg" width="112" alt="ContextTest mark">
</p>

<h1 align="center">ContextTest</h1>

<p align="center"><strong>Vitest for AGENTS.md.</strong><br>Run the same coding task with two instruction sets. Measure which one actually works.</p>

<p align="center">
  <a href="https://github.com/erickdronski/contexttest/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/erickdronski/contexttest/actions/workflows/ci.yml/badge.svg"></a>
  <a href="https://www.npmjs.com/package/@erickdronski/contexttest"><img alt="npm" src="https://img.shields.io/npm/v/@erickdronski/contexttest?color=174ea6"></a>
  <a href="LICENSE"><img alt="MIT license" src="https://img.shields.io/badge/license-MIT-101828"></a>
  <a href="SECURITY.md"><img alt="Security policy" src="https://img.shields.io/badge/security-policy-08775c"></a>
</p>

---

You changed `AGENTS.md`. Did the agent get better—or did you add 200 lines of expensive reassurance?

ContextTest replaces intuition with an experiment. It gives Codex or Claude Code the same tasks from the same Git commit, runs each attempt in a detached worktree, verifies the result with deterministic assertions, and produces an evidence-backed comparison.

```text
                         without        with
Task success             33%            100%
Assertion adherence      58%            100%
Median duration          6m 42s         4m 18s
Median changed files     9              4
Median diff lines        184            71

VERDICT  WITH LEADS
67 percentage-point difference in task success.
Signal: directional; 5 paired attempts per variant.
```

## Why this exists

Repository instructions are executable infrastructure written in prose. They affect which commands agents run, which files they touch, how much context they consume, and whether the result is mergeable. Yet teams commonly review them by eye.

Linters can tell you whether an instruction file is well formed. ContextTest tells you whether it changes behavior.

Use it to answer:

- Does our new `AGENTS.md` improve task completion?
- Is a long section useful or merely consuming context?
- Does Codex respond differently from Claude Code?
- Did an instruction change broaden diffs or increase cost?
- Do nested repository rules work for the tasks they govern?

## Quick start

Requirements: Node.js 20.11+, Git, and either Codex CLI or Claude Code installed and authenticated.

```bash
npx @erickdronski/contexttest init
```

Edit the generated `contexttest.json` and `AGENTS.candidate.md`, then run:

```bash
npx @erickdronski/contexttest run --attempts 5
```

ContextTest writes two artifacts under `.contexttest/reports/<run>/`:

- `report.html` — a private, standalone experiment report
- `report.json` — the complete machine-readable evidence record

No account, server, database, or telemetry is involved.

## A complete experiment

```json
{
  "$schema": "https://raw.githubusercontent.com/erickdronski/contexttest/main/schema/contexttest.schema.json",
  "version": 1,
  "project": "payments-api",
  "baseRef": "HEAD",
  "instructionFile": "AGENTS.md",
  "agent": {
    "provider": "codex",
    "timeoutMinutes": 20
  },
  "trials": {
    "attempts": 5,
    "concurrency": 2
  },
  "environment": {
    "inherit": false,
    "allow": []
  },
  "variants": [
    { "name": "without", "disabled": true },
    { "name": "with", "source": "AGENTS.candidate.md" }
  ],
  "tasks": [
    {
      "name": "preserve-public-api",
      "prompt": "Fix pagination when the cursor points to a deleted record.",
      "assertions": [
        { "type": "command", "command": ["npm", "test"] },
        { "type": "allowedPaths", "patterns": ["src/**", "test/**"] },
        { "type": "forbiddenPaths", "patterns": ["src/public-api/**"] },
        { "type": "maxChangedFiles", "value": 8 },
        { "type": "maxDiffLines", "value": 250 }
      ]
    }
  ]
}
```

Variant paths are relative to the configuration file. Task commands and assertion paths run from the repository root inside each trial worktree.

## Commands

```bash
contexttest init                         # create a starter experiment
contexttest run                          # run every configured task
contexttest run --task pagination        # run one task
contexttest run --attempts 10             # override repetitions
contexttest run --keep-worktrees          # retain trial worktrees for debugging
contexttest run --json                     # emit the report as one JSON line
contexttest doctor                        # verify Git, config, and agent CLI
contexttest report path/report.json       # regenerate the HTML report
```

Exit codes:

| Code | Meaning |
|---:|---|
| `0` | Candidate leads or there is no clear winner |
| `1` | Configuration or infrastructure failure |
| `2` | Baseline leads; useful as a CI regression gate |

## Assertions

Every run implicitly asserts that the agent exits successfully. Add deterministic checks for the behavior that matters:

| Type | Purpose |
|---|---|
| `command` | Run an argument-array command and check its exit code |
| `maxChangedFiles` / `minChangedFiles` | Bound the size of the change |
| `maxDiffLines` | Bound added and deleted lines |
| `allowedPaths` | Require every changed path to match a glob |
| `forbiddenPaths` | Reject changes matching a glob |
| `requiredFile` / `forbiddenFile` | Check filesystem outcomes |
| `fileContains` | Check a specific file for literal text |
| `stdoutContains` / `stdoutNotContains` | Check the agent's final output |

ContextTest supports `*`, `**`, and `?` in path globs.

## Agent providers

### Codex

```json
{ "provider": "codex", "model": "optional-model", "timeoutMinutes": 20 }
```

ContextTest uses `codex exec --ephemeral --sandbox workspace-write --json`. It never passes Codex's sandbox-bypass flag.

### Claude Code

```json
{
  "provider": "claude",
  "permissionMode": "acceptEdits",
  "maxTurns": 30,
  "timeoutMinutes": 20
}
```

ContextTest uses non-interactive print mode. `acceptEdits` is the default; bypassing permissions requires an explicit configuration change and is strongly discouraged outside an external sandbox.

### Any command

```json
{
  "provider": "command",
  "command": ["my-agent", "run", "--cwd", "{cwd}", "--prompt", "{prompt}"]
}
```

Arguments are spawned directly—not passed through a shell. `{cwd}` and `{prompt}` are substituted as complete arguments.

## GitHub Action

```yaml
name: Agent instruction regression
on:
  pull_request:
    paths:
      - AGENTS.md
      - contexttest.json

jobs:
  contexttest:
    runs-on: ubuntu-latest
    permissions:
      contents: read
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - uses: erickdronski/contexttest@v0
        id: experiment
        with:
          attempts: 5
      - uses: actions/upload-artifact@v4
        if: always()
        with:
          name: contexttest-report
          path: contexttest-report/
```

Authentication must be configured for the selected agent in your workflow. ContextTest intentionally does not invent or persist credentials.

## Safety model

Running an autonomous coding agent executes model-generated actions. A Git worktree protects your working copy from accidental edits, but it is not a security boundary.

ContextTest therefore:

- Uses detached worktrees and removes them after each run
- Never enables permission or sandbox bypass by default
- Strips environment variables except a small runtime allowlist
- Requires explicit opt-in for API keys and other credentials
- Redacts common token formats and allowlisted secret values from reports
- Avoids shell interpolation for agent and assertion commands
- Bounds retained output and subprocess runtime
- Refuses to delete paths outside its generated worktree directory

For untrusted repositories, prompts, models, or MCP servers, run ContextTest inside a disposable VM or container. Read [SECURITY.md](SECURITY.md) before using it in CI with credentials.

## Interpreting results

Coding-agent behavior is stochastic. One run is a story, not a measurement.

- `1–2` paired attempts: anecdotal
- `3–4`: early signal
- `5–9`: directional
- `10+`: stronger evidence

ContextTest includes 95% Wilson intervals for pass rates in JSON. It deliberately does not print “statistically significant” from small experiments. Tasks should represent real repository work, assertions should be deterministic, and conclusions should be replicated across more than one task.

## Deterministic demo

The repository includes a mock-agent experiment so the complete worktree, assertion, statistics, and reporting pipeline can be tested without spending tokens:

```bash
npm run demo
```

The mock is only a product demonstration. It is clearly identified as such and must never be presented as evidence about a real model.

## Project status

ContextTest is an early public release. Its report schema is versioned; the configuration format may gain additive fields before `1.0`. Current priorities are documented in [ROADMAP.md](ROADMAP.md).

If this solves a real problem for you, run an experiment and share the anonymized result—not just a star. Reproducible examples are the fastest way to make this project trustworthy.

## Contributing

Start with [CONTRIBUTING.md](CONTRIBUTING.md). Security issues belong in the private process described in [SECURITY.md](SECURITY.md). The project follows the [Contributor Covenant](CODE_OF_CONDUCT.md).

MIT © Erick Dronski
