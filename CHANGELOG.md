# Changelog

All notable changes follow [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). This project uses semantic versioning.

## [Unreleased]

### Fixed

- Claude Code experiments with the default `instructionFile: "AGENTS.md"` never delivered the treatment, because Claude Code reads `CLAUDE.md`; both arms were identical. Every Claude Code arm now gets the same `CLAUDE.md` containing `@AGENTS.md`, recorded per variant as `delivery`, excluded from agent metrics, and refused when `CLAUDE.md` links outside the treatment
- An unrecognized Claude model, a Claude Code exit before its first turn, or a missing agent executable now invalidates the experiment instead of being scored as agent failure
- Claude Code usage is parsed even when diagnostics precede the JSON result, and its turn count is recorded
- `--attempts` crashed on a configuration without a `trials` object, and a value flag given without a value silently became `1`

### Added

- `contexttest doctor` reports how each agent receives the instruction file and warns when a base-ref `CLAUDE.md` reaches every arm
- A report warning panel for instruction files the agent does not load on its own
- A passive treatment-delivery check: each comparison estimates the treatment's size in tokens, compares it with the observed per-request input difference, and labels the evidence `doubtful`—with a prominent warning—when the treatment probably never reached the agent
- Per-variant `instructions` metadata (mode, bytes, SHA-256 digest) and total input tokens, including cache reads and writes, in trial usage
- `agent.isolate`: Claude Code trials run with `--strict-mcp-config --setting-sources project,local`, Codex trials with `--ignore-user-config`, so the experimenter's plugins, hooks, MCP servers, and user settings stay out of the experiment; `doctor` warns when it is off
- Reports record each variant's exact invocation (prompt and worktree as placeholders) and the agent CLI's `--version` output
- Per-variant `agent` overrides for comparing providers or models on the same instructions; validated by the runtime validator and the JSON schema. Reports show each arm's agent and state whether the instructions, the agent, both, or neither differed, with a warning when both did
- Unknown variant keys are rejected, so a misspelled override cannot silently produce an A/A comparison
- `contexttest ablate`: splits an instruction file at a chosen Markdown heading level and measures each section's marginal effect—success, adherence, duration, diff size, and cost—against one shared full-file arm, with exact paired p-values, Holm-adjusted evidence labels, a printed run budget, `--dry-run`, `--sections`, and terminal, JSON, and HTML reports
- A deterministic ablation example with committed golden output, `npm run demo:ablate`, and a clean-install smoke step
- Every report records `kind`; `contexttest report` renders experiment and ablation reports, including reports written before 0.3.0, and refuses unknown kinds or newer schema versions
- Comparisons record the `basis` of their verdict: success, adherence, or duration
- `contexttest aggregate`: pools compatible experiment reports into paired statistics per task and overall, keeps pairs inside their own run, analyzes every source run on its own, and summarizes disagreement between runs. It refuses mismatched variants, variant order, or task sets and repeated runs, and warns about and records differences in configuration, agents, instruction digests, task refs, project, or version. Terminal, JSON (`kind: "aggregate"`), and HTML output, a committed example, `npm run demo:aggregate`, and a clean-install smoke step
- Seeded randomized task order: `trials.seed`, `--seed`, or the Action's `seed` input shuffles task and attempt blocks reproducibly; reports record `experiment.order` and `experiment.seed`

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
