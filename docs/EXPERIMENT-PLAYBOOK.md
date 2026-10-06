# Experiment playbook

This playbook turns a repository-instruction opinion into a controlled, reviewable experiment. Use it for `AGENTS.md`, nested instruction files, agent-specific guidance, migration checklists, or any prose intended to change coding-agent behavior.

## 1. Write the decision before the treatment

Start with a decision statement:

> We will adopt the candidate caching instructions if they improve task success without increasing protected-file violations or median diff size by more than 20%.

This prevents post-hoc storytelling. Name the primary outcome, guardrails, and what result would change the decision.

## 2. Change one instruction idea

A useful treatment is attributable. Prefer:

- one new rule;
- one removed section;
- one shorter rewrite of a specific section;
- root-only versus root + nested rules;
- an explicit example versus the same rule without an example.

Avoid changing the model, task prompts, dependencies, agent permissions, and instruction file in the same experiment.

Comparing agents is the mirror image: hold the instructions fixed and let a per-variant `agent` override change only the provider or model. The report states which of the two changed and warns when both did.

Whatever the treatment, prefer `agent.isolate: true` so the experimenter's own plugins, hooks, and MCP servers do not ride along in every trial.

## 3. Build a representative task portfolio

Choose three to ten recurring jobs, not ten variations of the same easy edit.

| Task family | Example | Why it belongs |
|---|---|---|
| bug fix | pagination fails after a deleted cursor | tests diagnosis and narrow correction |
| constrained refactor | replace internal cache without public API edits | tests boundaries and architecture guidance |
| test addition | add regression coverage for malformed input | tests discovery of test conventions |
| dependency or framework migration | update one deprecated API | tests procedural and compatibility guidance |
| documentation with executable checks | update examples while keeping snippets valid | tests cross-file consistency |

Historical bugs are excellent fixtures. Set `ref` to the parent of the fixing commit, derive the prompt from the issue, and derive assertions from the regression behavior. Do not include the original fix in the evaluated ref.

## 4. Write prompts that describe the job

Both variants receive the exact same prompt. State the user-visible problem and constraints that a normal issue would contain. Do not describe the intended patch or mention the instruction treatment.

Weak:

> Edit `cursor.mjs` line 42 to skip missing rows and add this exact test.

Stronger:

> Fix pagination when the supplied cursor references a record that was deleted. Preserve the public API and add regression coverage.

## 5. Encode mergeability as assertions

Layer checks from behavior to blast radius:

```json
"assertions": [
  { "type": "command", "label": "pagination regression", "command": ["npm", "test", "--", "pagination"] },
  { "type": "allowedPaths", "patterns": ["src/pagination/**", "test/pagination/**"] },
  { "type": "forbiddenPaths", "patterns": ["src/public-api/**"] },
  { "type": "maxChangedFiles", "value": 8 },
  { "type": "maxDiffLines", "value": 250 }
]
```

Use repository-owned verification scripts for conventions that are difficult to express with built-in assertions. Give command checks a safe `label` when arguments could expose secrets or noisy values.

## 6. Debug cheaply, then measure

Run one paired attempt first:

```bash
contexttest doctor
contexttest run --attempts 1
```

Use that run to find broken setup, invalid refs, flaky assertions, missing executables, or impossible tasks. Do not treat it as evidence.

Once the harness is trustworthy:

```bash
contexttest run --attempts 5
```

For runs long enough that providers or caches might drift, add `--seed <n>`: task and attempt blocks then run in a random order that the recorded seed reproduces.

Five pairs can provide directional evidence. More pairs may be needed when disagreements are rare, outcomes are noisy, or the decision is expensive. Replicate important results on another day or commit.

## 7. Read the evidence in the right order

1. **Infrastructure validity** — any setup/worktree failure invalidates the experiment.
2. **Treatment delivery** — a `doubtful` warning means the agent probably never read the instructions; fix delivery before reading anything else.
3. **Task success** — every configured assertion must pass.
4. **Task breakdown** — check that an aggregate win does not hide a local regression.
5. **Paired table and exact p-value** — inspect disagreements, not just independent percentages.
6. **Confidence intervals** — wide intervals mean the success rate remains uncertain.
7. **Assertion adherence** — shows partial compliance but does not override failed tasks.
8. **Efficiency** — compare duration, tokens, cost, changed files, and diff lines after success.
9. **Trial diagnostics** — explain failures; do not cherry-pick them into a different metric.

## 8. Classify failures before changing instructions

| Failure | Meaning | Response |
|---|---|---|
| infrastructure error | worktree, setup, configuration, or executable failed, or the agent stopped before its first turn | fix the harness; discard the run |
| doubtful treatment delivery | token usage barely changed between arms | confirm the agent loads the instruction file (see `contexttest doctor`); discard the run |
| assertion failure | agent completed but outcome was not mergeable | valid negative evidence |
| agent timeout or nonzero exit | agent did not complete successfully | valid outcome if the infrastructure was healthy |
| flaky repository check | measurement is unreliable | stabilize or replace the assertion |
| impossible task at selected ref | neither variant has a fair path to success | redesign the task |
| secret or private data in diagnostics | report is unsafe to share | rotate if necessary, redact source, rerun, inspect again |

## 9. Use an experiment review checklist

Before sharing or acting on a result, confirm:

- [ ] one instruction idea changed;
- [ ] both variants used the same prompt, task ref, setup, agent, and permissions—or the report says that only the agent differed, by design;
- [ ] tasks represent recurring repository work;
- [ ] assertions are deterministic and approximate mergeability;
- [ ] no infrastructure failures occurred;
- [ ] treatment delivery is not `doubtful`, and the agent loads the instruction file natively or through the recorded bridge;
- [ ] the report's task-level outcomes agree with the aggregate story;
- [ ] the sample size and exact p-value support the strength of the claim;
- [ ] diagnostics were inspected for sensitive source, paths, and agent output;
- [ ] material conclusions were replicated;
- [ ] the decision and caveats are recorded with the report.

## 10. Keep experiments reviewable

Commit the config, candidate instruction file, and repository-owned verification scripts. Keep raw reports private by default because diagnostics may contain code or paths. Share a sanitized report only when its contents have been inspected.

The deterministic [calculator example](../examples/calculator/README.md) demonstrates the complete pipeline. Its committed output is normalized for portability and is explicitly not evidence about a real model.
