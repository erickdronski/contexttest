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
Task success               0%                     100%
95% confidence interval    0%–56%                 44%–100%
Assertion adherence        80%                    100%
Median duration            314ms                  294ms
Median changed files       1                      1
Median diff lines          4                      4
Median cost                —                      —

VERDICT  WITH-INSTRUCTIONS
100 percentage-point difference in task success.
Evidence: early; 3 paired run(s); exact p=0.250.
```

This demo uses a deterministic mock adapter so it costs no model tokens. The candidate's win proves that the runner, worktrees, assertions, pairing, statistics, and reporters execute together; it does not prove anything about Codex, Claude Code, or an instruction-writing technique.

## Aggregate comparison

The top table answers the quickest questions:

| Field | Interpretation |
|---|---|
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

Always interpret the label with task coverage, interval width, and replication. Statistical significance cannot rescue an unrepresentative task suite.

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

## Sharing safely

Reports omit the configured task prompts and instruction contents, and ContextTest redacts common credential patterns plus explicitly configured secret values. Redaction is defense in depth—not a guarantee. Failed commands or agents can repeat source excerpts, paths, or private values in surprising forms. Inspect both JSON and expanded HTML trial diagnostics before publishing a report.

## Regenerating the HTML

The JSON record is sufficient to reproduce the presentation:

```bash
contexttest report path/to/report.json
```

The committed example is guarded by a test that renders its JSON again and requires byte-for-byte equality with the checked-in HTML.
