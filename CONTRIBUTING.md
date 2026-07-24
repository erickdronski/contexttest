# Contributing to ContextTest

ContextTest should earn trust through reproducibility, restraint, and clear evidence. Contributions that improve those qualities are welcome.

## Before opening a pull request

1. Search existing issues and discussions.
2. For substantial behavior or configuration changes, open an issue describing the use case first.
3. Keep the change focused. Avoid combining refactors with new behavior.
4. Add tests that fail without the change.
5. Run `npm run check` and `npm run demo`.
6. Update the README, schema, and changelog for user-visible changes.

## Local setup

```bash
git clone https://github.com/erickdronski/contexttest.git
cd contexttest
npm test
npm run demo
```

The project intentionally has no runtime or development dependencies. Node.js 20.11+ and Git are sufficient.

## Design principles

- Evidence before narrative
- Deterministic assertions before model-based judging
- Safe defaults before convenience flags
- Provider-neutral core with thin adapters
- Honest uncertainty instead of overstated conclusions

## Commit and PR guidance

Use clear imperative commit subjects. Explain why the change is needed, how it was verified, and any security or compatibility implications in the pull request.

By participating, you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md).
