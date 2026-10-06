# Verification and test map

ContextTest evaluates other systems, so its own evidence path must be inspectable. The repository publishes the unit, integration, security-regression, documentation, packaging, and GitHub Action checks used for release decisions.

## Test layers

| Layer | Public test | What it establishes |
|---|---|---|
| provider contracts | [`test/adapters.test.mjs`](../test/adapters.test.mjs) | Codex/Claude/custom command construction, no bypass flags, isolation flags, portable invocation records, version capture, usage parsing, output redaction |
| assertion engine | [`test/assertions.test.mjs`](../test/assertions.test.mjs) | every assertion family, unknown-type failure, safe diagnostics, symlink resistance |
| configuration | [`test/config.test.mjs`](../test/config.test.mjs) | starter validity, bounds, duplicates, unsafe paths, provider-specific validation, per-variant agent merge and replacement, unknown variant keys, schema-to-validator key alignment |
| Git/worktrees | [`test/git.test.mjs`](../test/git.test.mjs) | rename and binary metrics, symlink defenses, serialized registry mutations under parallel trials |
| path globs | [`test/glob.test.mjs`](../test/glob.test.mjs) | `*`, `**`, and `?` path semantics |
| end-to-end engine | [`test/integration.test.mjs`](../test/integration.test.mjs) | real temporary repository, paired worktrees, setup baseline, assertions, artifacts, cleanup, cross-agent comparisons and their treatment wording |
| treatment delivery | [`test/delivery.test.mjs`](../test/delivery.test.mjs) | a fake Claude Code that reads only `CLAUDE.md` receives `AGENTS.md` through the bridge in every arm; the bridge is excluded from metrics; existing `CLAUDE.md` rules are kept; unrecognized models and missing executables invalidate the experiment; `doctor` warns |
| reporters | [`test/reporter.test.mjs`](../test/reporter.test.mjs) | standalone escaped HTML, terminal verdict, multi-ref task handling |
| statistics | [`test/stats.test.mjs`](../test/stats.test.mjs) | medians, Wilson intervals, paired exact p-values, pairing keys, verdict rules, evidence labels, and the treatment-delivery check against a measured failure |
| process and secrets | [`test/utils.test.mjs`](../test/utils.test.mjs) | environment minimization, secret patterns, path containment, timeout truthfulness |
| public documentation | [`test/documentation.test.mjs`](../test/documentation.test.mjs) | no broken local links, portable example data, JSON-to-HTML byte equality |
| installed package | [`scripts/smoke-install.mjs`](../scripts/smoke-install.mjs) | packed tarball installs in a clean consumer repository and completes an experiment |
| GitHub Action | [`.github/workflows/ci.yml`](https://github.com/erickdronski/contexttest/blob/main/.github/workflows/ci.yml) | Action entrypoint executes from the repository and emits report artifacts |

## Run the same gates locally

```bash
npm ci --ignore-scripts
npm run check
npm run test:coverage
npm run smoke:install
npm run demo
npm audit --audit-level=low
```

`npm run check` runs the zero-dependency syntax/JSON linter and all Node tests. `npm run smoke:install` packs exactly what npm will receive, installs it into a fresh temporary consumer, initializes a Git repository, runs the installed binary, and verifies its outputs.

## Public CI matrix

Every push and pull request runs the same check and clean-install smoke test on current Node 20, 22, and 24. A separate job invokes `action.yml` directly against the deterministic fixture and verifies the Action outputs and copied JSON/HTML artifacts.

This catches two different release failures:

- source tests passing while the npm tarball omits a required file;
- the CLI working while the GitHub Action wrapper or output protocol is broken.

## Treatment delivery

A passing suite says nothing if the agent never read the instruction file. ContextTest knows which files Codex and Claude Code load on their own and bridges the gap for Claude Code, which reads `CLAUDE.md` rather than `AGENTS.md`. The bridge was confirmed with a canary rule on Claude Code 2.1.272: the rule placed only in `AGENTS.md` was ignored, the same rule imported through `CLAUDE.md` was followed.

The test suite cannot call a paid agent, so [`test/delivery.test.mjs`](../test/delivery.test.mjs) uses a fake `claude` executable that loads memory the way Claude Code does—`CLAUDE.md` plus `@imports`, never `AGENTS.md`. It establishes that:

- the candidate's instructions reach that agent, and the arm without instructions gets an identical bridge;
- the bridge never appears in changed files or diff counts;
- an existing `CLAUDE.md` keeps its rules and gains the import, and a `CLAUDE.md` link to `AGENTS.md` is used as-is;
- a `CLAUDE.md` link that points anywhere else is refused rather than written through;
- an unrecognized model, a zero-turn exit, or a missing executable invalidates the experiment instead of becoming a scored failure;
- `contexttest doctor` warns about the bridge and about a base-ref `CLAUDE.md` whose rules reach the baseline;
- an agent that reads nothing produces a `doubtful` delivery warning and label.

Isolation is verified the same way. The adapter tests pin the exact flags (`--strict-mcp-config --setting-sources project,local` for Claude Code, `--ignore-user-config` for Codex), and the fake agent confirms they arrive while project instructions still do. On Claude Code 2.1.272 those flags cut per-request input in a canary from about 51,000 to about 27,600 tokens, with the `CLAUDE.md` treatment still delivered.

A future agent release could change which files it loads. The fake cannot detect that, so every report also runs a passive delivery check over recorded token usage. [`test/stats.test.mjs`](../test/stats.test.mjs) pins it to the pattern a real failed experiment produced—about 500 bytes of instructions, 51,177 versus 51,202 input tokens over three turns—which must be labeled `doubtful`, and checks that noisy or missing usage yields `unknown` rather than a false alarm. The check can raise doubt; it cannot prove delivery. A periodic canary run against the real agent remains the strongest evidence.

## Demonstration golden files

The committed [calculator JSON](../examples/calculator/output/report.json) and [HTML](../examples/calculator/output/report.html) are generated by `npm run demo:update`. The script executes six real detached-worktree trials before normalizing machine-specific metadata. A test then requires:

- mock-provider labeling;
- the expected 0% versus 100% task outcome;
- three valid pairs;
- no local home or temporary worktree paths;
- byte-for-byte equality between the checked-in HTML and `renderHtmlReport(report.json)`.

## Security verification

The tests exercise known high-risk boundaries: symlink traversal (including through an existing `CLAUDE.md`), state-directory escapes, unsafe cleanup targets, command interpolation avoidance, secret-value redaction, process-group timeouts, malformed configs, GitHub multiline output escaping, and diagnostic truncation.

These checks reduce known failure modes; they do not make an autonomous process safe. The agent still operates with the permissions of its containing machine. See [SECURITY.md](../SECURITY.md).

## Release evidence

A release is accepted only when:

- the working tree matches the reviewed commit;
- all local checks and clean-install smoke pass;
- the deterministic demo produces the expected outcome;
- the npm vulnerability audit has no findings;
- Node 20/22/24 and Action smoke jobs are green on the merged commit;
- the release archive digest matches the uploaded asset;
- a clean registry install works after npm publication.

The last item cannot be simulated by a local tarball: it is verified against the actual registry package after publication.

## Honest limits

Tests cannot prove that every Git version, filesystem, agent release, model, network state, or repository shape behaves identically. In particular, the arm without instructions receives a `CLAUDE.md` import whose target is absent; that Claude Code treats a dangling import as harmless has not been verified against a real release. If it ever stopped Claude Code before its first turn, ContextTest would report an infrastructure failure rather than a result. The provider CLIs and models evolve independently. ContextTest therefore records runtime metadata, exposes raw trial evidence, avoids claiming universal model quality, and recommends replication for important decisions.
