# Changelog

All notable changes follow [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). This project uses semantic versioning.

## [Unreleased]

### Fixed

- Close a channel between trials: Claude Code keys auto-memory by repository, and every trial worktree belongs to the same repository, so all trials shared one memory directory. Isolated Claude Code trials now run with `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1`, added after the configured environment so it holds with `environment.inherit` true or false, and recorded in each variant's `invocation.env`
- `contexttest doctor` names the shared auto-memory directory when a Claude Code experiment is not isolated, and lists the isolation variable when it is

## [0.3.0] — 2026-10-06

### Added

- `contexttest ablate`: each instruction section's marginal effect against one shared full-file arm, with a printed run budget, `--dry-run`, `--sections`, `--level`, and Holm-adjusted evidence labels
- `contexttest aggregate`: pooled paired statistics across compatible experiment reports, with pairs kept inside their own run, a per-run breakdown, and a heterogeneity summary
- Per-variant `agent` overrides for comparing providers or models on the same instructions, and verdicts that state whether the instructions, the agent, both, or neither differed
- Passive treatment-delivery check from token usage; doubtful delivery withholds every confident evidence label and adds a prominent warning
- `agent.isolate`, keeping user-level plugins, hooks, settings, and MCP servers out of Claude Code and Codex trials
- Seeded randomized task order through `trials.seed`, `--seed`, or the Action's `seed` input
- Report `kind`, plus per-variant agent, instruction size and digest, delivery method, invocation, and agent CLI version
- `contexttest report` for every report kind, including reports written before 0.3.0
- Doctor checks for instruction delivery, base-ref `CLAUDE.md` files, and isolation
- Deterministic ablation and aggregation examples with committed golden output, `npm run demo:ablate`, `npm run demo:aggregate`, and clean-install smoke steps

### Fixed

- Deliver `AGENTS.md` treatments to Claude Code, which reads `CLAUDE.md`: every Claude Code arm now gets the same `CLAUDE.md` import, and the arm without instructions gets an empty `AGENTS.md` so the import never dangles (recorded as `emptyTargetForDisabledArm`), both excluded from agent metrics. Earlier Claude Code experiments with the default instruction file compared identical arms
- Invalidate experiments whose agent never started—an unrecognized Claude model, a Claude Code exit before its first turn, or a missing executable—instead of scoring them as agent failures
- Parse Claude Code usage when diagnostics precede the JSON result, and count cache reads and writes toward total input
- Reject unknown variant and trial keys, so a misspelled override cannot silently produce an A/A comparison
- Stop `--attempts` from crashing on a configuration without `trials`, and reject value flags given without a value instead of treating them as `1`

## [0.2.0] - 2026-07-24

### Added

- Per-trial setup commands recorded outside agent-change metrics
- Exact paired pass/fail analysis, task-level breakdowns, and reproducibility metadata
- Deep doctor checks for Git state, refs, variant files, and required executables
- Clean-tarball installation smoke test in CI
- Architecture, use-case, experiment-design, and report-reading guides
- Tested, portable JSON and HTML outputs for the deterministic demonstration

### Fixed

- Reject invalid overrides, duplicate names, slug collisions, unsafe paths, and malformed assertions before agent execution
- Parse staged renames correctly and stop counting phantom lines in untracked or binary files
- Record handled subprocess timeouts truthfully
- Terminate timed-out subprocess groups and reject symlink traversal in state, instruction, and file-assertion paths
- Redact assertion-command diagnostics and avoid echoing sensitive command arguments
- Escape GitHub Action outputs and workflow-command errors safely
- Prevent report output from being placed inside temporary worktree storage
- Serialize Git worktree registry mutations while keeping agent trials concurrent

## [0.1.0] - 2026-07-24

### Added

- Provider-neutral experiment engine with Codex and Claude Code adapters
- Detached Git worktree isolation and per-variant baselines
- Alternating paired-trial order to reduce time-order bias
- Eleven deterministic assertion types
- Repeated-trial summaries and Wilson pass-rate intervals
- Standalone HTML and machine-readable JSON reports
- GitHub Action, doctor command, JSON schema, deterministic demo, and security policy
