# Reading ContextTest reports

Every valid run produces the same evidence in two forms:

- `report.json` is the complete machine-readable record for CI, audit, or downstream analysis.
- `report.html` is a standalone, responsive view for humans. It has no remote assets or server dependency.

Open the committed [example HTML report](../examples/calculator/output/report.html) or inspect its [JSON source](../examples/calculator/output/report.json) before installing ContextTest.

## Terminal result

The deterministic demonstration prints a summary like this:

```text
CONTEXTTEST / EXPERIMENT RESULT
calculator-demo · calculator-demo-example

                           without-instructions   with-instructions
Agent                      mock                   mock
Task success               0%                     100%
95% confidence interval    0%–56%                 44%–100%
Assertion adherence        80%                    100%
Median duration            314ms                  294ms
Median changed files       1                      1
Median diff lines          4                      4
Median cost                —                      —

VERDICT  WITH-INSTRUCTIONS
100 percentage-point difference in task success.
Only the instructions differ; both arms use mock.
Evidence: early; 3 paired run(s); exact p=0.250.
```

This demo uses a deterministic mock adapter so it costs no model tokens. The candidate's win proves that the runner, worktrees, assertions, pairing, statistics, and reporters execute together; it does not prove anything about Codex, Claude Code, or an instruction-writing technique.

## Aggregate comparison

The top table answers the quickest questions:

| Field | Interpretation |
|---|---|
| Agent | each arm's provider, model, and whether it ran isolated |
| Task success | fraction of trials where the agent exited successfully and every assertion passed |
| 95% confidence interval | Wilson interval around the observed pass rate |
| Assertion adherence | mean fraction of individual assertions passed; useful for diagnosis, not the final gate |
| Median duration | wall-clock agent execution time, excluding setup and assertions |
| Median changed files | breadth of the agent's patch after setup |
| Median diff lines | added plus deleted text lines |
| Median input tokens | provider-reported input usage when available |
| Median cost | provider-reported or calculated cost when available; otherwise `—` |
| Instruction delivery | how each arm's agent receives the instruction file: `native`, `via CLAUDE.md @import` (bridged for Claude Code), or `unverified`; omitted for `command` and `mock` agents |

A warning panel above the table appears whenever ContextTest has a reason to doubt the result—for example an instruction file the agent does not load on its own. Read it before the numbers.

The verdict prioritizes a material task-success difference, then assertion adherence, then duration only when success is equal. It is a practical comparison rule, not a claim of universal superiority.

Under the reason, the verdict states what differed between the arms, from the `treatment` record: only the instructions, only the agent (naming the providers and models, or the settings that changed), both, or neither. `treatment.differs` lists `instructions` and/or `agent`; `treatment.agentSettings` names every agent setting that differs. Two arms count as the same agent only when every setting matches—each variant's `agent.digest` covers them all. When both instructions and agent change, the report adds a warning: the result cannot be attributed to either one alone.

## Paired evidence

Trials are paired by task and attempt. The report records:

- `leftWins`: baseline passed while candidate failed;
- `rightWins`: candidate passed while baseline failed;
- `bothPass` and `bothFail`;
- `discordant`: the total one-sided disagreements;
- a two-sided exact p-value over those disagreements.

Pairs where both variants behave the same do not tell you which instruction set is better. That is why a large-looking pass-rate difference can still have weak evidence at a small sample size.

## Evidence labels

| Label | Rule |
|---|---|
| anecdotal | one or two paired runs |
| early | three or four paired runs |
| directional | at least five pairs without `p ≤ 0.05` |
| convincing | paired `p ≤ 0.05` |
| strong | paired `p ≤ 0.01` |
| doubtful | token usage suggests the treatment never reached the agent; overrides every other label |

Always interpret the label with task coverage, interval width, and replication. Statistical significance cannot rescue an unrepresentative task suite.

## Treatment delivery check

A comparison is only meaningful if the agent read the instructions. Every comparison carries `treatmentDelivery` and a `deliveryCheck` object with the evidence:

| Field | Meaning |
|---|---|
| `status` | `consistent`, `doubtful`, or `unknown` |
| `basis` | `request` when the agent reports its turn count (Claude Code), otherwise `trial` (Codex) |
| `instructionBytes` | bytes each arm wrote to the instruction file |
| `expectedTokens` | about one token per four bytes of difference |
| `observedTokens` | median input tokens per request (or per trial) in the arm with more instructions, minus the other arm |
| `ratio` | observed divided by expected |
| `spreadTokens` | the larger within-arm median absolute deviation |
| `reason` | the same finding in one sentence |

Input tokens include cache reads and writes, since Claude Code reports cached prompt text separately. The check reports `doubtful` when the observed difference is below a quarter of the expected one and trial-to-trial variation is small enough to trust that. It reports `unknown` when the agent gives no usage, when the arms differ by fewer than about 25 tokens of instructions, or when usage varies more between trials than the treatment could explain. A `consistent` result means usage moved as it should—it does not prove the agent followed the instructions.

The check exists because a real Claude Code experiment once compared two arms whose only difference was an `AGENTS.md` that Claude Code never loaded: about 500 bytes of rules, and only 25 more input tokens across three turns. That is a ratio near 0.07, and today it is labeled `doubtful`.

## Task breakdown

When an experiment has multiple tasks, the HTML report adds one row per task with both pass rates, the local leader, and exact p-value. Review this before accepting an aggregate winner. An instruction file that helps bug fixes but damages migrations may require narrower nested guidance rather than repository-wide adoption.

## Trial evidence

Each trial records:

- pass/fail and assertion score;
- agent duration and exit state;
- every assertion result;
- changed paths and diff counts;
- token/cost usage when the provider exposes it, including Claude Code's turn count;
- for bridged Claude Code arms, how the bridge was applied (`created`, `appended`, `already-imported`, or `symlinked`);
- bounded, redacted diagnostics for failures.

The JSON also records resolved commits per task, configuration digest, runner version, runtime metadata, setup-command count, and the comparison data needed to reproduce the terminal verdict.

`experiment.order` is `sequential` or `seeded`; `experiment.seed` is the seed that reproduces a seeded order, and the HTML footer shows it.

Two fields make agent runs reproducible across machines and releases:

- `runtime.agents[]` lists each agent's provider, configured executable, and the first line of its `--version` output (Codex and Claude Code only; custom commands are never probed);
- `variants[].invocation` is the exact command line each arm ran, with `[PROMPT]` and `[WORKTREE]` placeholders and redaction applied—so isolation flags such as `--strict-mcp-config` are visible.

## Sharing safely

Reports omit the configured task prompts and instruction contents, and ContextTest redacts common credential patterns plus explicitly configured secret values. Redaction is defense in depth—not a guarantee. Failed commands or agents can repeat source excerpts, paths, or private values in surprising forms. Inspect both JSON and expanded HTML trial diagnostics before publishing a report.

## Report kinds and versions

Every report carries `kind` and `schemaVersion`. A kind's fields can grow within a schema version; a breaking change increments it. Reports written before 0.3.0 have no `kind` and are experiment reports.

| `kind` | Written by | `schemaVersion` |
|---|---|---|
| `experiment` | `contexttest run` and the GitHub Action | 1 |
| `ablation` | `contexttest ablate` | 1 |

`contexttest report` reads the kind and refuses an unknown kind, or a schema version newer than it understands, rather than rendering something misleading.

## Ablation reports

An ablation report answers "which sections earn their context?" Open the committed [ablation example](../examples/ablation/output/report.html) or its [JSON](../examples/ablation/output/report.json).

Its top-level keys are `schemaVersion`, `kind`, `version`, `runId`, `generatedAt`, `project`, `commit`, `taskRefs`, `instructionFile`, `agent`, `delivery`, `invocation`, `ablation`, `experiment`, `runtime`, `tasks`, `arms`, `effects`, `warnings`, and `artifacts`.

- `ablation` describes the file: the ablated variant and source, the heading level, total bytes and digest, the preamble, and every section's number, title, starting line, line and byte counts, and whether it was selected.
- `arms` holds one entry per arm—`full`, then `without-<n>`—with its instruction bytes and digest, trials, and summary.
- `effects` holds one entry per selected section: `deltas` (full minus without, for success, adherence, duration, diff lines, changed files, input tokens, and cost), the paired `comparison` with its exact p-value and delivery check, `adjustedPValue` (Holm), `signal`, `reading`, and per-task `taskResults`.

Read an ablation in this order:

1. **Warnings** — doubtful delivery for a section means its removal barely changed token usage.
2. **Full-file success** — if the full file rarely succeeds, every section's effect is measured near a floor.
3. **Reading and evidence per section** — `helps` and `hurts` require a difference in success or adherence; labels use the Holm-adjusted p-value, because testing many sections at once produces chance findings.
4. **Deltas** — duration, diff size, and cost show what a section costs or saves, without a verdict.
5. **Task breakdown** — a section can help one task family and hurt another.

Absence of evidence is not evidence of absence: "no clear effect" after three attempts means untested. Sections can also interact—two rules that duplicate each other each look useless alone. Ablation reports include section headings, which come from your instruction file, but never section bodies.

## Regenerating the HTML

The JSON record is sufficient to reproduce the presentation:

```bash
contexttest report path/to/report.json
```

It works for every report kind, including reports written by earlier versions. The committed examples are guarded by tests that render their JSON again and require byte-for-byte equality with the checked-in HTML.
