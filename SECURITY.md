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

Safe defaults reduce accidental exposure; they do not convert an agent into trusted code. Use an external container or VM when any of these are untrusted:

- Repository content
- Task prompts
- Instruction files
- Agent provider or model
- MCP servers and tools
- Package installation scripts

Avoid passing production credentials to experiments. Prefer short-lived, least-privilege credentials scoped to a disposable environment.
