# Changelog

All notable changes follow [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). This project uses semantic versioning.

## [Unreleased]

## [0.2.0] - 2026-07-24

### Added

- Per-trial setup commands recorded outside agent-change metrics
- Exact paired pass/fail analysis, task-level breakdowns, and reproducibility metadata
- Deep doctor checks for Git state, refs, variant files, and required executables
- Clean-tarball installation smoke test in CI

### Fixed

- Reject invalid overrides, duplicate names, slug collisions, unsafe paths, and malformed assertions before agent execution
- Parse staged renames correctly and stop counting phantom lines in untracked or binary files
- Record handled subprocess timeouts truthfully
- Terminate timed-out subprocess groups and reject symlink traversal in state, instruction, and file-assertion paths
- Redact assertion-command diagnostics and avoid echoing sensitive command arguments
- Escape GitHub Action outputs and workflow-command errors safely
- Prevent report output from being placed inside temporary worktree storage

## [0.1.0] - 2026-07-24

### Added

- Provider-neutral experiment engine with Codex and Claude Code adapters
- Detached Git worktree isolation and per-variant baselines
- Alternating paired-trial order to reduce time-order bias
- Eleven deterministic assertion types
- Repeated-trial summaries and Wilson pass-rate intervals
- Standalone HTML and machine-readable JSON reports
- GitHub Action, doctor command, JSON schema, deterministic demo, and security policy
