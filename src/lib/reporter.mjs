import { escapeHtml, formatDuration, formatMoney, VERSION } from './utils.mjs';

const STYLES = ':root{--paper:#f7f8fb;--ink:#101828;--muted:#667085;--line:#d8dee9;--blue:#174ea6;--blue-soft:#eaf1ff;--green:#08775c;--green-soft:#e2f6ef;--red:#b42318;--red-soft:#feecea;--amber:#9a6700;--white:#fff;--shadow:0 16px 50px rgba(16,24,40,.08)}*{box-sizing:border-box}html{background:var(--paper);color:var(--ink);font-family:Inter,ui-sans-serif,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;line-height:1.5}body{margin:0}.sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}.shell{max-width:1180px;margin:0 auto;padding:48px 28px 80px}.masthead{display:flex;justify-content:space-between;align-items:center;padding-bottom:18px;border-bottom:1px solid var(--ink)}.wordmark{font:700 13px/1 ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.14em}.run-meta{font:500 12px/1.2 ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--muted)}.hero{display:grid;grid-template-columns:minmax(0,1.25fr) minmax(300px,.75fr);gap:70px;align-items:end;padding:72px 0 62px}.eyebrow{font:700 11px/1 ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.14em;color:var(--blue);text-transform:uppercase}.hero h1{font-family:"Iowan Old Style","Palatino Linotype",Georgia,serif;font-size:clamp(52px,8vw,104px);font-weight:400;line-height:.88;letter-spacing:-.055em;margin:18px 0 0;max-width:760px}.hero h1 em{font-style:italic;color:var(--blue)}.verdict{border-left:3px solid var(--blue);padding:3px 0 3px 24px}.verdict.positive{border-color:var(--green)}.verdict.negative{border-color:var(--red)}.verdict-label{font:700 11px/1 ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--muted);letter-spacing:.12em}.verdict h2{font:700 28px/1.1 ui-sans-serif,sans-serif;margin:12px 0 10px}.verdict p{margin:0;color:var(--muted);max-width:36ch}.verdict p.treatment{margin-top:10px;color:var(--ink);font-size:14px}.signal{display:inline-block;margin-top:16px;padding:5px 8px;border:1px solid var(--line);font:600 11px/1 ui-monospace,monospace;text-transform:uppercase}.comparison{background:var(--white);border:1px solid var(--line);box-shadow:var(--shadow)}table{width:100%;border-collapse:collapse}th,td{padding:18px 22px;border-bottom:1px solid var(--line);text-align:right;font-variant-numeric:tabular-nums}thead th{background:#f0f3f8;font:700 11px/1 ui-monospace,monospace;letter-spacing:.09em;text-transform:uppercase;color:var(--muted)}thead th:first-child,tbody th{text-align:left}tbody th{font-size:13px;font-weight:600;color:var(--muted)}tbody td{font:650 16px/1 ui-monospace,monospace}.winner{color:var(--green);background:var(--green-soft)}.loser{color:var(--muted)}.section{margin-top:72px}.section-head{display:flex;align-items:baseline;justify-content:space-between;border-bottom:1px solid var(--ink);padding-bottom:12px;margin-bottom:24px}.section h2{font-family:"Iowan Old Style",Georgia,serif;font-size:35px;font-weight:400;letter-spacing:-.025em;margin:0}.section-note{color:var(--muted);font-size:13px}.trial-grid{display:grid;grid-template-columns:1fr 1fr;gap:22px}.lane-label{font:700 12px/1 ui-monospace,monospace;text-transform:uppercase;letter-spacing:.1em;margin:0 0 13px;color:var(--blue)}.trial{background:var(--white);border:1px solid var(--line);margin-bottom:10px}.trial summary{display:grid;grid-template-columns:32px 1fr auto;gap:10px 12px;align-items:center;padding:16px 18px;cursor:pointer;list-style:none}.trial summary::-webkit-details-marker{display:none}.trial-index{font:600 11px/1 ui-monospace,monospace;color:var(--muted)}.trial summary strong{font:750 11px/1 ui-monospace,monospace;color:var(--green)}.trial.fail summary strong{color:var(--red)}.trial summary small{grid-column:2/4;color:var(--muted);font:500 11px/1.3 ui-monospace,monospace}.trial-body{border-top:1px solid var(--line);padding:18px}.trial-body h4{font-size:12px;text-transform:uppercase;letter-spacing:.08em;margin:18px 0 8px}.trial-body h4:first-child{margin-top:0}.trial-body ul{list-style:none;margin:0;padding:0}.trial-body li{display:flex;gap:8px;font-size:13px;padding:6px 0}.trial-body .ok span{color:var(--green)}.trial-body .bad span{color:var(--red)}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#111827;color:#e5e7eb;padding:14px;font:11px/1.55 ui-monospace,SFMono-Regular,Menlo,monospace;max-height:340px;overflow:auto}.method{display:grid;grid-template-columns:1fr 1fr;gap:40px}.method p{color:var(--muted);margin:0}.method code{font:600 12px ui-monospace,monospace;color:var(--blue)}footer{margin-top:80px;padding-top:20px;border-top:1px solid var(--line);display:flex;justify-content:space-between;color:var(--muted);font:500 11px ui-monospace,monospace}.alert{border:1px solid var(--amber);border-left-width:4px;background:#fff8e6;padding:16px 22px;margin:0 0 28px}.alert strong{font:700 12px/1.2 ui-monospace,monospace;letter-spacing:.08em;text-transform:uppercase;color:var(--amber)}.alert ul{margin:8px 0 0;padding-left:18px}.alert li{margin:4px 0}.up{color:var(--green)}.down{color:var(--red)}.text{text-align:left}td.text{font:500 13px/1.4 ui-sans-serif,sans-serif}th.section-name{font-weight:650;color:var(--ink)}.reading{font:700 11px/1 ui-monospace,monospace;text-transform:uppercase;letter-spacing:.06em}.reading.helps{color:var(--green)}.reading.hurts{color:var(--red)}.lanes{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:22px}.wide{overflow-x:auto}.wide th,.wide td{white-space:nowrap;padding:14px 12px}.wide tbody td{font-size:14px}@media(max-width:780px){.shell{padding:28px 16px 52px}.hero{grid-template-columns:1fr;gap:36px;padding:52px 0 44px}.hero h1{font-size:58px}.trial-grid,.method{grid-template-columns:1fr}.comparison{overflow-x:auto}th,td{padding:14px 13px}.run-meta{display:none}footer{display:block}footer span{display:block;margin-top:8px}}@media(prefers-reduced-motion:no-preference){.hero>*{animation:rise .55s ease-out both}.hero>*:nth-child(2){animation-delay:.08s}.comparison{animation:rise .55s .14s ease-out both}@keyframes rise{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:none}}}@media print{.shell{max-width:none;padding:20px}.comparison{box-shadow:none}.trial{break-inside:avoid}}';

const colors = { reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m', blue: '\x1b[38;5;27m', green: '\x1b[38;5;35m', red: '\x1b[38;5;160m', amber: '\x1b[38;5;172m' };
const paint = (code, value, enabled) => enabled ? `${code}${value}${colors.reset}` : value;
const percent = (value) => `${Math.round((value ?? 0) * 100)}%`;
const number = (value) => Number.isFinite(value) ? Math.round(value).toLocaleString('en-US') : '—';
const interval = (value) => Array.isArray(value) ? `${percent(value[0])}–${percent(value[1])}` : '—';
const probability = (value) => Number.isFinite(value) ? (value < 0.001 ? '<0.001' : value.toFixed(3)) : '—';
const deliveryLabel = (delivery) => !delivery || delivery.method === 'unknown' ? '—' : delivery.method === 'bridged' ? `via ${delivery.bridgedVia}` : delivery.method;
const showsDelivery = (variants) => variants.some((variant) => variant.delivery && variant.delivery.method !== 'unknown');
// Reports before 0.3.0 record one agent for the whole experiment.
export const agentLabel = (agent) => agent ? [agent.provider, agent.model, agent.isolate ? 'isolated' : null].filter(Boolean).join(' · ') : '—';
const variantAgent = (report, variant) => variant.agent ?? report.agent;

export function renderTerminalReport(report, options = {}) {
  const color = options.color ?? process.stdout.isTTY;
  const [baseline, candidate] = report.variants;
  const verdictColor = report.comparison.winner === 'candidate' ? colors.green : report.comparison.winner === 'baseline' ? colors.red : colors.amber;
  const labelWidth = 26;
  const variantWidth = Math.max(14, baseline.name.length + 2, candidate.name.length + 2);
  const row = (label, left, right) => `${label.padEnd(labelWidth)} ${String(left).padEnd(variantWidth)} ${String(right).padEnd(variantWidth)}`;
  const verdict = report.comparison.winner === 'candidate' ? candidate.name : report.comparison.winner === 'baseline' ? baseline.name : 'tie';
  const lines = [
    '',
    paint(colors.bold, 'CONTEXTTEST / EXPERIMENT RESULT', color),
    paint(colors.dim, `${report.project} · ${report.runId}`, color),
    '',
    row('', baseline.name, candidate.name),
    row('Agent', agentLabel(variantAgent(report, baseline)), agentLabel(variantAgent(report, candidate))),
    row('Task success', percent(baseline.summary.passRate), percent(candidate.summary.passRate)),
    row('95% confidence interval', interval(baseline.summary.passRateInterval), interval(candidate.summary.passRateInterval)),
    row('Assertion adherence', percent(baseline.summary.meanAssertionScore), percent(candidate.summary.meanAssertionScore)),
    row('Median duration', formatDuration(baseline.summary.medianDurationMs), formatDuration(candidate.summary.medianDurationMs)),
    row('Median changed files', number(baseline.summary.medianChangedFiles), number(candidate.summary.medianChangedFiles)),
    row('Median diff lines', number(baseline.summary.medianDiffLines), number(candidate.summary.medianDiffLines)),
    row('Median cost', formatMoney(baseline.summary.medianCostUsd), formatMoney(candidate.summary.medianCostUsd)),
    ...(showsDelivery(report.variants) ? [row('Instruction delivery', deliveryLabel(baseline.delivery), deliveryLabel(candidate.delivery))] : []),
    '',
    ...(report.warnings ?? []).flatMap((warning) => [`${paint(colors.amber, 'WARNING', color)}  ${warning.message}`, '']),
    `${paint(colors.bold, 'VERDICT', color)}  ${paint(verdictColor, verdict.toUpperCase(), color)}`,
    report.comparison.reason,
    ...(report.treatment ? [report.treatment.summary] : []),
    `Evidence: ${report.comparison.signal}; ${report.comparison.minimumAttempts} paired run(s); exact p=${probability(report.comparison.pValue)}.`,
    '',
    paint(colors.dim, `JSON  ${report.artifacts?.json ?? 'pending'}`, color),
    paint(colors.dim, `HTML  ${report.artifacts?.html ?? 'pending'}`, color),
    '',
  ];
  return lines.join('\n');
}

// Every report kind is one standalone file with the same stylesheet and no
// external requests.
function page(title, body) {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>${escapeHtml(title)} · ContextTest</title>
<style>
${STYLES}
</style></head><body><main class="shell">
${body.trimEnd()}
</main></body></html>`;
}

function masthead(report) {
  return `<header class="masthead"><div class="wordmark">CONTEXTTEST</div><div class="run-meta">${escapeHtml(report.runId ?? report.aggregateId)} · ${escapeHtml((report.commit ?? 'multiple-refs').slice(0, 13))}</div></header>`;
}

function metricRow(label, left, right, formatter = String, higher = null) {
  const leftValue = formatter(left);
  const rightValue = formatter(right);
  let leftClass = '', rightClass = '';
  if (higher !== null && Number.isFinite(left) && Number.isFinite(right) && left !== right) {
    const rightWins = higher ? right > left : right < left;
    leftClass = rightWins ? 'loser' : 'winner'; rightClass = rightWins ? 'winner' : 'loser';
  }
  return `<tr><th>${escapeHtml(label)}</th><td class="${leftClass}">${escapeHtml(leftValue)}</td><td class="${rightClass}">${escapeHtml(rightValue)}</td></tr>`;
}

function trialCard(trial, index) {
  const failed = trial.assertions.filter((item) => !item.pass);
  return `<details class="trial ${trial.passed ? 'pass' : 'fail'}">
    <summary><span class="trial-index">${String(index + 1).padStart(2, '0')}</span><span>${escapeHtml(trial.task)}</span><strong>${trial.passed ? 'PASS' : 'FAIL'}</strong><small>${formatDuration(trial.durationMs)} · ${trial.files.length} files · ${trial.diff.total} lines</small></summary>
    <div class="trial-body">
      <h4>Assertions</h4>
      <ul>${trial.assertions.map((item) => `<li class="${item.pass ? 'ok' : 'bad'}"><span>${item.pass ? '✓' : '×'}</span>${escapeHtml(item.message)}</li>`).join('')}</ul>
      ${failed.length ? `<h4>Agent diagnostics</h4><pre>${escapeHtml((trial.stderr || trial.stdout || 'No diagnostic output.').slice(-6000))}</pre>` : ''}
      <h4>Changed files</h4><pre>${escapeHtml(trial.files.join('\n') || 'No files changed.')}</pre>
    </div>
  </details>`;
}

function warningPanel(report) {
  const warnings = report.warnings ?? [];
  if (!warnings.length) return '';
  return `<section class="alert" role="note"><strong>Check before trusting this result</strong><ul>${warnings.map((warning) => `<li>${escapeHtml(warning.message)}</li>`).join('')}</ul></section>\n`;
}

function taskBreakdown(report) {
  if (!Array.isArray(report.taskResults) || report.taskResults.length < 2) return '';
  const [baseline, candidate] = report.variants;
  const rows = report.taskResults.map((task) => {
    const winner = task.comparison.winner === 'candidate' ? candidate.name : task.comparison.winner === 'baseline' ? baseline.name : 'tie';
    return `<tr><th>${escapeHtml(task.name)}</th><td>${escapeHtml(percent(task.variants[0].summary.passRate))}</td><td>${escapeHtml(percent(task.variants[1].summary.passRate))}</td><td>${escapeHtml(winner)}</td><td>${escapeHtml(probability(task.comparison.pValue))}</td></tr>`;
  }).join('');
  return `<section class="section"><div class="section-head"><h2>Task breakdown</h2><span class="section-note">Aggregates can hide task-specific regressions.</span></div><div class="comparison"><table><caption class="sr-only">Results for each configured task</caption><thead><tr><th>Task</th><th>${escapeHtml(baseline.name)}</th><th>${escapeHtml(candidate.name)}</th><th>Leader</th><th>Exact p</th></tr></thead><tbody>${rows}</tbody></table></div></section>`;
}

export function renderHtmlReport(report) {
  const [baseline, candidate] = report.variants;
  const verdict = report.comparison.winner === 'candidate' ? `${candidate.name} leads` : report.comparison.winner === 'baseline' ? `${baseline.name} leads` : 'No clear winner';
  const verdictTone = report.comparison.winner === 'candidate' ? 'positive' : report.comparison.winner === 'baseline' ? 'negative' : 'neutral';
  return page(report.project, `<header class="masthead"><div class="wordmark">CONTEXTTEST</div><div class="run-meta">${escapeHtml(report.runId)} · ${escapeHtml((report.commit ?? 'multiple-refs').slice(0, 13))}</div></header>
<section class="hero"><div><div class="eyebrow">Instruction experiment / ${escapeHtml(report.project)}</div><h1>Measure the <em>instructions</em>, not the intuition.</h1></div><div class="verdict ${verdictTone}"><div class="verdict-label">RESULT</div><h2>${escapeHtml(verdict)}</h2><p>${escapeHtml(report.comparison.reason)}</p>${report.treatment ? `<p class="treatment">${escapeHtml(report.treatment.summary)}</p>` : ''}<span class="signal">${escapeHtml(report.comparison.signal)} evidence · p=${escapeHtml(probability(report.comparison.pValue))} · ${report.comparison.minimumAttempts} pairs</span></div></section>
${warningPanel(report)}<section class="comparison" aria-label="Variant comparison"><table><caption class="sr-only">Aggregate comparison of instruction variants</caption><thead><tr><th>Measured outcome</th><th>${escapeHtml(baseline.name)}</th><th>${escapeHtml(candidate.name)}</th></tr></thead><tbody>
${metricRow('Agent', agentLabel(variantAgent(report, baseline)), agentLabel(variantAgent(report, candidate)))}
${metricRow('Task success', baseline.summary.passRate, candidate.summary.passRate, percent, true)}
${metricRow('95% confidence interval', baseline.summary.passRateInterval, candidate.summary.passRateInterval, interval)}
${metricRow('Assertion adherence', baseline.summary.meanAssertionScore, candidate.summary.meanAssertionScore, percent, true)}
${metricRow('Median duration', baseline.summary.medianDurationMs, candidate.summary.medianDurationMs, formatDuration, false)}
${metricRow('Median changed files', baseline.summary.medianChangedFiles, candidate.summary.medianChangedFiles, number, false)}
${metricRow('Median diff lines', baseline.summary.medianDiffLines, candidate.summary.medianDiffLines, number, false)}
${metricRow('Median input tokens', baseline.summary.medianInputTokens, candidate.summary.medianInputTokens, number, false)}
${metricRow('Median cost', baseline.summary.medianCostUsd, candidate.summary.medianCostUsd, formatMoney, false)}
${showsDelivery(report.variants) ? `${metricRow('Instruction delivery', deliveryLabel(baseline.delivery), deliveryLabel(candidate.delivery))}\n` : ''}</tbody></table></section>
${taskBreakdown(report)}
<section class="section"><div class="section-head"><h2>Trial record</h2><span class="section-note">Open any run to inspect its evidence.</span></div><div class="trial-grid"><div><div class="lane-label">${escapeHtml(baseline.name)}</div>${baseline.trials.map(trialCard).join('')}</div><div><div class="lane-label">${escapeHtml(candidate.name)}</div>${candidate.trials.map(trialCard).join('')}</div></div></section>
<section class="section"><div class="section-head"><h2>How to read this</h2><span class="section-note">Evidence before narrative.</span></div><div class="method"><p>Each variant received matching tasks from the same Git commit per task in detached worktrees. A run passes only when the agent exits cleanly and every configured assertion passes.</p><p>Agent behavior is stochastic. Pass rates include Wilson 95% intervals; the p-value is a two-sided exact test over paired pass/fail disagreements. Small samples remain exploratory even when the directional effect is large.</p></div></section>
<footer><span>Generated locally by ContextTest ${escapeHtml(report.version)} · config ${escapeHtml(report.experiment?.configDigest?.slice(0, 10) ?? 'legacy')}${report.experiment?.order === 'seeded' ? ` · seed ${escapeHtml(report.experiment.seed)}` : ''}</span><span>Inspect diagnostics for sensitive code or paths before sharing.</span></footer>
`);
}

// ---- Ablation reports -------------------------------------------------------

const signed = (value, format) => !Number.isFinite(value) ? '—' : value === 0 ? format(0) : `${value > 0 ? '+' : '−'}${format(Math.abs(value))}`;
const points = (value) => `${Math.round(value * 100)} pp`;
const sectionName = (section) => section ? `§${section.index} ${section.title}` : 'full file';
const evidence = (effect) => `${effect.signal} · p=${probability(effect.comparison.pValue)}${effect.adjustedPValue !== effect.comparison.pValue ? ` (Holm ${probability(effect.adjustedPValue)})` : ''}`;

function ablationHeadline(report) {
  const changed = report.effects.filter((effect) => effect.reading !== 'no clear effect');
  const total = report.effects.length;
  const headline = !changed.length ? 'No section measurably changed the outcome' : `${changed.length} of ${total} section${total === 1 ? '' : 's'} changed the outcome`;
  const groups = ['helps', 'hurts', 'no clear effect']
    .map((reading) => [reading, report.effects.filter((effect) => effect.reading === reading)])
    .filter(([, effects]) => effects.length)
    .map(([reading, effects]) => `${reading[0].toUpperCase()}${reading.slice(1)}: ${effects.map((effect) => sectionName(effect.section)).join(', ')}.`);
  return { headline, detail: groups.join(' ') };
}

function columns(rows) {
  const widths = rows[0].map((_, index) => Math.max(...rows.map((row) => String(row[index]).length)));
  return rows.map((row) => row.map((cell, index) => String(cell).padEnd(widths[index] + 2)).join('').trimEnd());
}

export function renderAblationTerminal(report, options = {}) {
  const color = options.color ?? process.stdout.isTTY;
  const full = report.arms[0];
  const hasCost = report.effects.some((effect) => Number.isFinite(effect.deltas.medianCostUsd));
  const { headline, detail } = ablationHeadline(report);
  const clip = (text) => text.length > 30 ? `${text.slice(0, 29)}…` : text;
  const table = [
    ['Section', 'Lines', 'Without', 'Δ success', 'Δ adherence', 'Δ duration', 'Δ diff lines', ...(hasCost ? ['Δ cost'] : []), 'Reading', 'Evidence'],
    ...report.effects.map((effect) => [
      clip(sectionName(effect.section)), effect.section.lines, percent(report.arms.find((arm) => arm.name === effect.arm).summary.passRate),
      signed(effect.deltas.passRate, points), signed(effect.deltas.assertionScore, points), signed(effect.deltas.medianDurationMs, formatDuration),
      signed(effect.deltas.medianDiffLines, number), ...(hasCost ? [signed(effect.deltas.medianCostUsd, formatMoney)] : []), effect.reading, evidence(effect),
    ]),
  ];
  const lines = [
    '',
    paint(colors.bold, 'CONTEXTTEST / ABLATION RESULT', color),
    paint(colors.dim, `${report.project} · ${report.runId}`, color),
    `${report.ablation.variant} · ${report.ablation.source ?? 'inline content'} · level-${report.ablation.level} sections · ${agentLabel(report.agent)}`,
    '',
    `Full file: ${percent(full.summary.passRate)} task success (${full.summary.successes}/${full.summary.attempts}), adherence ${percent(full.summary.meanAssertionScore)}, median ${formatDuration(full.summary.medianDurationMs)}.`,
    '',
    ...columns(table),
    '',
    ...(report.warnings ?? []).flatMap((warning) => [`${paint(colors.amber, 'WARNING', color)}  ${warning.message}`, '']),
    `${paint(colors.bold, 'RESULT', color)}  ${headline}`,
    detail,
    'Δ = full file minus the file without that section; positive success means the section helps.',
    'Readings come from task success and assertion adherence; the other deltas are measurements, not verdicts.',
    `Labels use Holm-adjusted p-values across ${report.effects.length} section comparison(s). At anecdotal or early evidence, "no clear effect" means untested, not useless.`,
    '',
    paint(colors.dim, `JSON  ${report.artifacts?.json ?? 'pending'}`, color),
    paint(colors.dim, `HTML  ${report.artifacts?.html ?? 'pending'}`, color),
    '',
  ];
  return lines.join('\n');
}

// Plan text printed before any agent runs, so the cost is visible up front.
export function renderAblationPlan(plan) {
  const outline = [
    ['', 'Lines', 'Bytes', ''],
    ...(plan.split.preamble.lines ? [['preamble', plan.split.preamble.lines, '', 'kept in every arm']] : []),
    ...plan.split.sections.map((section) => [sectionName(section), section.lines, section.bytes, plan.selected.includes(section) ? 'ablated' : 'kept (not selected)']),
  ];
  const { budget } = plan;
  return [
    `Ablating ${plan.variant.name} (${plan.label}) at level-${plan.level} headings`,
    ...columns(outline).map((line) => `  ${line}`),
    '',
    `Budget: ${budget.arms} arms (full + ${budget.arms - 1} without one section) × ${budget.tasks} task(s) × ${budget.attempts} attempt(s) = ${budget.trials} agent runs.`,
    `The full arm is shared by every comparison; running each section as its own A/B experiment would take ${budget.separateExperiments}.`,
  ].join('\n');
}

function effectRow(report, effect) {
  const without = report.arms.find((arm) => arm.name === effect.arm);
  const tone = (value) => !Number.isFinite(value) || value === 0 ? '' : value > 0 ? 'up' : 'down';
  return `<tr><th class="section-name">${escapeHtml(sectionName(effect.section))}</th><td>${escapeHtml(percent(without.summary.passRate))}</td><td class="${tone(effect.deltas.passRate)}">${escapeHtml(signed(effect.deltas.passRate, points))}</td><td>${escapeHtml(signed(effect.deltas.assertionScore, points))}</td><td>${escapeHtml(signed(effect.deltas.medianDurationMs, formatDuration))}</td><td>${escapeHtml(signed(effect.deltas.medianDiffLines, number))}</td><td>${escapeHtml(signed(effect.deltas.medianCostUsd, formatMoney))}</td><td><span class="reading ${effect.reading === 'no clear effect' ? '' : effect.reading}">${escapeHtml(effect.reading)}</span></td><td>${escapeHtml(effect.signal)}</td><td>${escapeHtml(probability(effect.comparison.pValue))} (${escapeHtml(probability(effect.adjustedPValue))})</td></tr>`;
}

function ablationOutline(report) {
  const rows = [
    ...(report.ablation.preamble.lines ? [`<tr><th>Preamble</th><td>${report.ablation.preamble.lines}</td><td class="text">kept in every arm</td></tr>`] : []),
    ...report.ablation.sections.map((section) => `<tr><th>${escapeHtml(sectionName(section))}</th><td>${section.lines}</td><td class="text">${section.selected ? `ablated · ${section.bytes} bytes` : 'kept in every arm (not selected)'}</td></tr>`),
  ].join('');
  return `<section class="section"><div class="section-head"><h2>Instruction outline</h2><span class="section-note">${escapeHtml(report.ablation.source ?? report.ablation.variant)} · ${report.ablation.bytes} bytes · split at level-${report.ablation.level} headings</span></div><div class="comparison"><table><caption class="sr-only">Parts of the instruction file</caption><thead><tr><th>Part</th><th>Lines</th><th class="text">Treatment</th></tr></thead><tbody>${rows}</tbody></table></div></section>`;
}

function ablationTaskMatrix(report) {
  if (report.tasks.length < 2) return '';
  const header = report.tasks.map((task) => `<th>${escapeHtml(task)}</th>`).join('');
  const rows = report.effects.map((effect) => `<tr><th>${escapeHtml(sectionName(effect.section))}</th>${effect.taskResults.map((task) => `<td>${escapeHtml(signed(task.passRates[1] - task.passRates[0], points))}</td>`).join('')}</tr>`).join('');
  return `<section class="section"><div class="section-head"><h2>Task breakdown</h2><span class="section-note">Δ success per task: a section can help one task family and hurt another.</span></div><div class="comparison"><table><caption class="sr-only">Change in task success from each section, per task</caption><thead><tr><th>Section</th>${header}</tr></thead><tbody>${rows}</tbody></table></div></section>`;
}

export function renderAblationHtml(report) {
  const full = report.arms[0];
  const { headline, detail } = ablationHeadline(report);
  const tone = report.effects.some((effect) => effect.reading === 'hurts') ? 'negative' : report.effects.some((effect) => effect.reading === 'helps') ? 'positive' : 'neutral';
  return page(report.project, `${masthead(report)}
<section class="hero"><div><div class="eyebrow">Instruction ablation / ${escapeHtml(report.project)}</div><h1>Which sections <em>earn</em> their context?</h1></div><div class="verdict ${tone}"><div class="verdict-label">RESULT</div><h2>${escapeHtml(headline)}</h2><p>${escapeHtml(detail)}</p><p class="treatment">Every arm used ${escapeHtml(agentLabel(report.agent))}; only the removed section differs from the full file.</p><span class="signal">full file ${escapeHtml(percent(full.summary.passRate))} · ${report.experiment.attemptsPerArm} attempts per arm · ${report.experiment.plannedTrials} runs</span></div></section>
${warningPanel(report)}<section class="comparison wide" aria-label="Section effects"><table><caption class="sr-only">Marginal effect of each instruction section</caption><thead><tr><th>Section</th><th>Without it</th><th>Δ success</th><th>Δ adherence</th><th>Δ duration</th><th>Δ diff lines</th><th>Δ cost</th><th>Reading</th><th>Evidence</th><th>Exact p (Holm)</th></tr></thead><tbody>
${report.effects.map((effect) => effectRow(report, effect)).join('\n')}
</tbody></table></section>
${ablationOutline(report)}
${ablationTaskMatrix(report)}
<section class="section"><div class="section-head"><h2>Trial record</h2><span class="section-note">Open any run to inspect its evidence.</span></div><div class="lanes">${report.arms.map((arm) => `<div><div class="lane-label">${escapeHtml(arm.section ? `without ${sectionName(arm.section)}` : 'full file')}</div>${arm.trials.map(trialCard).join('')}</div>`).join('')}</div></section>
<section class="section"><div class="section-head"><h2>How to read this</h2><span class="section-note">Absence of evidence is not evidence of absence.</span></div><div class="method"><p>Each arm received the same tasks from the same Git commit in detached worktrees, with the instruction file either complete or missing exactly one section. The full arm runs once per task and attempt and is paired with every other arm by task and attempt. Δ is the full file minus the file without that section, so a positive change in success means the section helps. Readings come from task success and assertion adherence only; duration, diff size, and cost are shown as measurements, because medians over a few runs are too noisy to judge a section on their own.</p><p>p-values come from a two-sided exact test over paired disagreements. Testing several sections at once invites chance findings, so evidence labels use Holm-adjusted p-values. With few attempts, "no clear effect" means a section is untested, not that it is useless; a section may also matter only in combination with another.</p></div></section>
<footer><span>Generated locally by ContextTest ${escapeHtml(report.version)} · config ${escapeHtml(report.experiment?.configDigest?.slice(0, 10) ?? 'legacy')}${report.experiment?.order === 'seeded' ? ` · seed ${escapeHtml(report.experiment.seed)}` : ''}</span><span>Section headings appear in this report; section bodies do not.</span></footer>
`);
}

// ---- Dispatch by report kind -------------------------------------------------

// Reports written before 0.3.0 have no `kind`; they are experiment reports.
const RENDERERS = {
  experiment: { schemaVersion: 1, html: renderHtmlReport, terminal: renderTerminalReport },
  ablation: { schemaVersion: 1, html: renderAblationHtml, terminal: renderAblationTerminal },
};

export function reportKind(report) {
  if (!report || typeof report !== 'object' || !Number.isInteger(report.schemaVersion)) throw new Error('This file is not a ContextTest report: it has no schemaVersion.');
  const kind = report.kind ?? 'experiment';
  const renderer = RENDERERS[kind];
  if (!renderer) throw new Error(`Unknown report kind "${kind}". ContextTest ${VERSION} reads ${Object.keys(RENDERERS).join(', ')} reports.`);
  if (report.schemaVersion > renderer.schemaVersion) throw new Error(`This ${kind} report uses schemaVersion ${report.schemaVersion}; ContextTest ${VERSION} reads up to ${renderer.schemaVersion}. Upgrade ContextTest to render it.`);
  return kind;
}

export function renderReport(report) { return RENDERERS[reportKind(report)].html(report); }
export function renderReportTerminal(report, options) { return RENDERERS[reportKind(report)].terminal(report, options); }
