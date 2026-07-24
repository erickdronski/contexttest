# Roadmap

ContextTest follows evidence, not feature volume.

## 0.1 — trustworthy experiment core

- [x] Codex, Claude Code, custom command, and deterministic mock adapters
- [x] Detached worktree isolation and per-variant baselines
- [x] Deterministic filesystem, diff, process, and output assertions
- [x] Repeated trials, Wilson intervals, and cautious verdicts
- [x] Standalone HTML and versioned JSON reports
- [x] GitHub Action and safe environment defaults

## Next

- [x] Paired task ordering with alternated variant order
- [ ] Seeded randomized task order
- [ ] Instruction-section ablation experiments
- [ ] Historical task harvesting from issues and fixing commits
- [ ] Container executor with network policy
- [ ] Comparison across agent providers and models
- [ ] JSON Schema validation inside the CLI
- [ ] Report aggregation across commits

## Explicit non-goals

- A hosted prompt or source-code collection service
- A single opaque “agent quality” score
- Claims of statistical significance from tiny samples
- Model judging as a substitute for executable repository checks
