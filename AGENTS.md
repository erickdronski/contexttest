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
- Keep the record of which instruction files each agent loads (`src/lib/adapters.mjs`) in step with the README; a treatment the agent never reads makes every result noise.

## Verification

Run from the repository root:

```bash
npm run check
npm run demo
npm run demo:ablate
npm run demo:aggregate
```

Inspect the generated HTML under `.contexttest/` when changing report markup or styles, and run `npm run demo:update` to regenerate the committed example reports.

## Documentation

Update `README.md`, `CHANGELOG.md`, and the JSON schema when changing user-facing configuration or CLI behavior.
