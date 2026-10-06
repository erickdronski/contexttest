# Security policy

## Supported versions

Security fixes are applied to the latest release. Before `1.0`, upgrade to the most recent minor release before reporting a reproducibility issue.

## Reporting a vulnerability

Do not open a public issue for vulnerabilities involving command execution, path traversal, credential exposure, report redaction, or unsafe worktree cleanup.

Use GitHub's private vulnerability reporting feature for this repository. Include:

- Affected version and platform
- Minimal reproduction
- Expected and observed behavior
- Potential impact
- Suggested mitigation, if known

You should receive an acknowledgment within five business days.

## Threat model

ContextTest orchestrates autonomous coding tools that can execute commands. Detached Git worktrees isolate repository changes but do not isolate the host filesystem, network, credentials, or external MCP tools.

Configured setup and assertion commands are trusted code and execute with the same host-level access as ContextTest. Commands are spawned as argument arrays without a shell, but the executable itself can perform arbitrary actions. Review configuration changes with the same care as workflow changes.

Safe defaults reduce accidental exposure; they do not convert an agent into trusted code. Use an external container or VM when any of these are untrusted:

- Repository content
- Task prompts
- Instruction files
- Agent provider or model
- MCP servers and tools
- Package installation scripts

Avoid passing production credentials to experiments. Prefer short-lived, least-privilege credentials scoped to a disposable environment.

ContextTest redacts recognized token formats and values stored in secret-named environment variables from agent and assertion diagnostics. Redaction is defense in depth: inspect generated reports before sharing them, and never use a report as a secret-storage boundary.

Generated state directories and configured file paths are checked for containment and unsafe symlink traversal before ContextTest reads, writes, or removes them. The same checks guard the `CLAUDE.md` bridge written into Claude Code trial worktrees: a `CLAUDE.md` that links anywhere other than the instruction file is refused rather than written through. `contexttest aggregate` writes under `.contexttest/aggregates` by default and refuses to write into a directory that holds one of its source reports.

`agent.isolate` keeps user-level agent plugins, hooks, settings, and MCP servers out of trials. It reduces accidental exposure; it is not a sandbox. Treat any containment error as a configuration or repository-integrity problem; do not work around it with a broader path.
