# Use cases and decision guide

ContextTest is useful when a repository-instruction change creates a falsifiable prediction about agent behavior. The best experiments connect that prediction to deterministic checks that represent mergeability.

## What teams can answer

| Question | Experimental treatment | Representative tasks | Evidence to collect |
|---|---|---|---|
| Does a new `AGENTS.md` help? | Current file versus candidate file | bug fix, test addition, constrained refactor | task success, assertion adherence, per-task regressions |
| Is a long section earning its context cost? | Full file versus file with one section removed | tasks governed by that section | success, tokens, duration, diff size |
| Do nested instructions work? | root-only rules versus root + nested rules | changes inside the nested subtree | allowed paths, protected files, targeted tests |
| Is an instruction too restrictive? | restrictive wording versus relaxed wording | tasks requiring legitimate cross-boundary edits | task success, forbidden-path failures, changed files |
| Does a migration guide reduce mistakes? | no migration guidance versus concise checklist | repeated API or framework migrations | command tests, file-content checks, bounded diffs |
| Did an instruction edit regress CI behavior? | released instructions versus proposed instructions | a stable CI task portfolio | baseline-leads exit code and report artifact |
| Do two agents need different guidance? | same two variants, separate provider runs | identical task set and refs | compare two independent ContextTest reports |
| Does a shorter file perform as well? | current instructions versus compressed candidate | representative repository tasks | non-inferior success with lower tokens or latency |

## Strong first experiments

### Historical bug replay

Use the parent of a real bug-fix commit as the task ref. Write the prompt from the issue and assertions from the regression test. This gives you a realistic failure mode without leaking the original patch into the evaluated worktree.

### Public API preservation

Ask for an internal behavior change while forbidding edits to public entrypoints. Combine targeted tests, `forbiddenPaths`, and a diff-size limit. This measures whether instructions help the agent find the narrow solution.

### Repository convention adherence

Choose a task where the code can work while still violating a local convention—for example, bypassing a shared helper or putting tests in the wrong directory. Encode the convention with allowed paths, file-content checks, or a small repository-owned verification script.

### Instruction subtraction

Remove one section rather than rewriting the whole file. If behavior does not change across a representative task set, the section may be redundant. If behavior regresses only on one task family, the task breakdown reveals where it earns its cost.

## What ContextTest can and cannot establish

| It can provide evidence about… | It cannot prove… |
|---|---|
| behavior on the configured tasks and commits | universal behavior across every repository or future model version |
| deterministic pass/fail constraints | subjective code quality unless you encode it as a check |
| changed files, diff size, duration, tokens, and reported cost | causal attribution when multiple treatment variables changed together |
| paired pass/fail disagreements | statistical certainty from a tiny sample |
| task-specific regressions | security isolation from an untrusted autonomous process |
| reproducibility inputs recorded in the report | identical provider responses across time, accounts, caches, or network state |

## When not to use it

Do not use ContextTest as a leaderboard built from unrelated tasks, as a one-run marketing benchmark, or as a substitute for code review. It is also the wrong tool when the desired outcome cannot be checked reproducibly or when the candidate changes the prompt, model, dependencies, and instruction file simultaneously.

## Adoption ladder

1. Run the deterministic [calculator demonstration](../examples/calculator/README.md) to understand the artifact flow without spending model tokens.
2. Replay one historical bug with one attempt per variant to debug your harness.
3. Expand to three to ten representative tasks and at least five paired attempts.
4. Repeat material conclusions on another commit or day.
5. Add the GitHub Action only after the local experiment is stable and affordable.
6. Treat a baseline win as a regression gate; treat a candidate win as evidence to review, not an automatic policy change.

The detailed task-authoring and interpretation workflow lives in the [experiment playbook](EXPERIMENT-PLAYBOOK.md).
