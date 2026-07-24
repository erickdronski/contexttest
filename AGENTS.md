# ContextTest contributor instructions

## Purpose

ContextTest measures whether repository instructions improve coding-agent outcomes. Preserve its central promise: identical tasks, isolated worktrees, deterministic assertions, and cautious interpretation.

## Engineering rules

- Support Node.js 20.11 and newer.
- Keep the runtime dependency-free unless a dependency removes substantially more risk than it adds.
- Spawn commands with argument arrays. Do not interpolate prompts into a shell command.
- Treat worktree removal, environment inheritance, and report contents as security-sensitive.
- Never enable agent permission bypasses by default.
- Keep reports standalone and free of external network dependencies.
- Add or update tests for behavior changes.

## Verification

Run from the repository root:

```bash
npm run check
npm run demo
```

Inspect the generated demo HTML at `.contexttest/reports/<run>/report.html` when changing report markup or styles.

## Documentation

Update `README.md`, `CHANGELOG.md`, and the JSON schema when changing user-facing configuration or CLI behavior.
