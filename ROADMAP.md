# Roadmap

ContextTest follows evidence, not feature volume.

## 0.1 — trustworthy experiment core

- [x] Codex, Claude Code, custom command, and deterministic mock adapters
- [x] Detached worktree isolation and per-variant baselines
- [x] Deterministic filesystem, diff, process, and output assertions
- [x] Repeated trials, Wilson intervals, and cautious verdicts
- [x] Standalone HTML and versioned JSON reports
- [x] GitHub Action and safe environment defaults
- [x] Paired task ordering with alternated variant order

## 0.2 — measurement hardening

- [x] Exact paired pass/fail analysis and task-level breakdowns
- [x] Per-trial setup commands excluded from agent metrics
- [x] Runtime validation aligned with the documented schema
- [x] Clean-install tarball smoke test
- [x] Reproducibility metadata and resolved task commits

## 0.3 — sharper questions

- [x] Treatment delivery to Claude Code and a passive delivery check
- [x] Isolation from the experimenter's own agent setup
- [x] Seeded randomized task order
- [x] Instruction-section ablation experiments
- [x] Comparison across agent providers and models
- [x] Schema-versioned report aggregation across commits

## Next

- [ ] Historical task harvesting from issues and fixing commits
- [ ] Container executor with network policy
- [ ] Aggregation of ablation reports
- [ ] Canary checks that each supported agent still loads its instruction file

## Explicit non-goals

- A hosted prompt or source-code collection service
- A single opaque “agent quality” score
- Claims of statistical significance from tiny samples
- Model judging as a substitute for executable repository checks
