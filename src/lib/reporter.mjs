import { escapeHtml, formatDuration, formatMoney } from './utils.mjs';

const colors = { reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m', blue: '\x1b[38;5;27m', green: '\x1b[38;5;35m', red: '\x1b[38;5;160m', amber: '\x1b[38;5;172m' };
const paint = (code, value, enabled) => enabled ? `${code}${value}${colors.reset}` : value;
const percent = (value) => `${Math.round((value ?? 0) * 100)}%`;
const number = (value) => Number.isFinite(value) ? Math.round(value).toLocaleString('en-US') : '—';

export function renderTerminalReport(report, options = {}) {
  const color = options.color ?? process.stdout.isTTY;
  const [baseline, candidate] = report.variants;
  const verdictColor = report.comparison.winner === 'candidate' ? colors.green : report.comparison.winner === 'baseline' ? colors.red : colors.amber;
  const lines = [
    '',
    paint(colors.bold, 'CONTEXTTEST / EXPERIMENT RESULT', color),
    paint(colors.dim, `${report.project} · ${report.runId}`, color),
    '',
    `                         ${baseline.name.padEnd(14)} ${candidate.name.padEnd(14)}`,
    `Task success             ${percent(baseline.summary.passRate).padEnd(14)} ${percent(candidate.summary.passRate).padEnd(14)}`,
    `Assertion adherence      ${percent(baseline.summary.meanAssertionScore).padEnd(14)} ${percent(candidate.summary.meanAssertionScore).padEnd(14)}`,
    `Median duration          ${formatDuration(baseline.summary.medianDurationMs).padEnd(14)} ${formatDuration(candidate.summary.medianDurationMs).padEnd(14)}`,
    `Median changed files     ${number(baseline.summary.medianChangedFiles).padEnd(14)} ${number(candidate.summary.medianChangedFiles).padEnd(14)}`,
    `Median diff lines        ${number(baseline.summary.medianDiffLines).padEnd(14)} ${number(candidate.summary.medianDiffLines).padEnd(14)}`,
    `Median cost              ${formatMoney(baseline.summary.medianCostUsd).padEnd(14)} ${formatMoney(candidate.summary.medianCostUsd).padEnd(14)}`,
    '',
    `${paint(colors.bold, 'VERDICT', color)}  ${paint(verdictColor, report.comparison.winner.toUpperCase(), color)}`,
    report.comparison.reason,
    `Signal: ${report.comparison.signal}; ${report.comparison.minimumAttempts} paired attempt(s) per variant.`,
    '',
    paint(colors.dim, `JSON  ${report.artifacts?.json ?? 'pending'}`, color),
    paint(colors.dim, `HTML  ${report.artifacts?.html ?? 'pending'}`, color),
    '',
  ];
  return lines.join('\n');
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

export function renderHtmlReport(report) {
  const [baseline, candidate] = report.variants;
  const verdict = report.comparison.winner === 'candidate' ? `${candidate.name} leads` : report.comparison.winner === 'baseline' ? `${baseline.name} leads` : 'No clear winner';
  const verdictTone = report.comparison.winner === 'candidate' ? 'positive' : report.comparison.winner === 'baseline' ? 'negative' : 'neutral';
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>${escapeHtml(report.project)} · ContextTest</title>
<style>
:root{--paper:#f7f8fb;--ink:#101828;--muted:#667085;--line:#d8dee9;--blue:#174ea6;--blue-soft:#eaf1ff;--green:#08775c;--green-soft:#e2f6ef;--red:#b42318;--red-soft:#feecea;--amber:#9a6700;--white:#fff;--shadow:0 16px 50px rgba(16,24,40,.08)}*{box-sizing:border-box}html{background:var(--paper);color:var(--ink);font-family:Inter,ui-sans-serif,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;line-height:1.5}body{margin:0}.shell{max-width:1180px;margin:0 auto;padding:48px 28px 80px}.masthead{display:flex;justify-content:space-between;align-items:center;padding-bottom:18px;border-bottom:1px solid var(--ink)}.wordmark{font:700 13px/1 ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.14em}.run-meta{font:500 12px/1.2 ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--muted)}.hero{display:grid;grid-template-columns:minmax(0,1.25fr) minmax(300px,.75fr);gap:70px;align-items:end;padding:72px 0 62px}.eyebrow{font:700 11px/1 ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.14em;color:var(--blue);text-transform:uppercase}.hero h1{font-family:"Iowan Old Style","Palatino Linotype",Georgia,serif;font-size:clamp(52px,8vw,104px);font-weight:400;line-height:.88;letter-spacing:-.055em;margin:18px 0 0;max-width:760px}.hero h1 em{font-style:italic;color:var(--blue)}.verdict{border-left:3px solid var(--blue);padding:3px 0 3px 24px}.verdict.positive{border-color:var(--green)}.verdict.negative{border-color:var(--red)}.verdict-label{font:700 11px/1 ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--muted);letter-spacing:.12em}.verdict h2{font:700 28px/1.1 ui-sans-serif,sans-serif;margin:12px 0 10px}.verdict p{margin:0;color:var(--muted);max-width:36ch}.signal{display:inline-block;margin-top:16px;padding:5px 8px;border:1px solid var(--line);font:600 11px/1 ui-monospace,monospace;text-transform:uppercase}.comparison{background:var(--white);border:1px solid var(--line);box-shadow:var(--shadow)}table{width:100%;border-collapse:collapse}th,td{padding:18px 22px;border-bottom:1px solid var(--line);text-align:right;font-variant-numeric:tabular-nums}thead th{background:#f0f3f8;font:700 11px/1 ui-monospace,monospace;letter-spacing:.09em;text-transform:uppercase;color:var(--muted)}thead th:first-child,tbody th{text-align:left}tbody th{font-size:13px;font-weight:600;color:var(--muted)}tbody td{font:650 16px/1 ui-monospace,monospace}.winner{color:var(--green);background:var(--green-soft)}.loser{color:var(--muted)}.section{margin-top:72px}.section-head{display:flex;align-items:baseline;justify-content:space-between;border-bottom:1px solid var(--ink);padding-bottom:12px;margin-bottom:24px}.section h3{font-family:"Iowan Old Style",Georgia,serif;font-size:35px;font-weight:400;letter-spacing:-.025em;margin:0}.section-note{color:var(--muted);font-size:13px}.trial-grid{display:grid;grid-template-columns:1fr 1fr;gap:22px}.lane-label{font:700 12px/1 ui-monospace,monospace;text-transform:uppercase;letter-spacing:.1em;margin:0 0 13px;color:var(--blue)}.trial{background:var(--white);border:1px solid var(--line);margin-bottom:10px}.trial summary{display:grid;grid-template-columns:32px 1fr auto;gap:10px 12px;align-items:center;padding:16px 18px;cursor:pointer;list-style:none}.trial summary::-webkit-details-marker{display:none}.trial-index{font:600 11px/1 ui-monospace,monospace;color:var(--muted)}.trial summary strong{font:750 11px/1 ui-monospace,monospace;color:var(--green)}.trial.fail summary strong{color:var(--red)}.trial summary small{grid-column:2/4;color:var(--muted);font:500 11px/1.3 ui-monospace,monospace}.trial-body{border-top:1px solid var(--line);padding:18px}.trial-body h4{font-size:12px;text-transform:uppercase;letter-spacing:.08em;margin:18px 0 8px}.trial-body h4:first-child{margin-top:0}.trial-body ul{list-style:none;margin:0;padding:0}.trial-body li{display:flex;gap:8px;font-size:13px;padding:6px 0}.trial-body .ok span{color:var(--green)}.trial-body .bad span{color:var(--red)}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#111827;color:#e5e7eb;padding:14px;font:11px/1.55 ui-monospace,SFMono-Regular,Menlo,monospace;max-height:340px;overflow:auto}.method{display:grid;grid-template-columns:1fr 1fr;gap:40px}.method p{color:var(--muted);margin:0}.method code{font:600 12px ui-monospace,monospace;color:var(--blue)}footer{margin-top:80px;padding-top:20px;border-top:1px solid var(--line);display:flex;justify-content:space-between;color:var(--muted);font:500 11px ui-monospace,monospace}@media(max-width:780px){.shell{padding:28px 16px 52px}.hero{grid-template-columns:1fr;gap:36px;padding:52px 0 44px}.hero h1{font-size:58px}.trial-grid,.method{grid-template-columns:1fr}.comparison{overflow-x:auto}th,td{padding:14px 13px}.run-meta{display:none}footer{display:block}footer span{display:block;margin-top:8px}}@media(prefers-reduced-motion:no-preference){.hero>*{animation:rise .55s ease-out both}.hero>*:nth-child(2){animation-delay:.08s}.comparison{animation:rise .55s .14s ease-out both}@keyframes rise{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:none}}}@media print{.shell{max-width:none;padding:20px}.comparison{box-shadow:none}.trial{break-inside:avoid}}
</style></head><body><main class="shell">
<header class="masthead"><div class="wordmark">CONTEXTTEST</div><div class="run-meta">${escapeHtml(report.runId)} · ${escapeHtml(report.commit.slice(0, 10))}</div></header>
<section class="hero"><div><div class="eyebrow">Instruction experiment / ${escapeHtml(report.project)}</div><h1>Measure the <em>instructions</em>, not the intuition.</h1></div><div class="verdict ${verdictTone}"><div class="verdict-label">RESULT</div><h2>${escapeHtml(verdict)}</h2><p>${escapeHtml(report.comparison.reason)}</p><span class="signal">${escapeHtml(report.comparison.signal)} signal · ${report.comparison.minimumAttempts} paired runs</span></div></section>
<section class="comparison" aria-label="Variant comparison"><table><thead><tr><th>Measured outcome</th><th>${escapeHtml(baseline.name)}</th><th>${escapeHtml(candidate.name)}</th></tr></thead><tbody>
${metricRow('Task success', baseline.summary.passRate, candidate.summary.passRate, percent, true)}
${metricRow('Assertion adherence', baseline.summary.meanAssertionScore, candidate.summary.meanAssertionScore, percent, true)}
${metricRow('Median duration', baseline.summary.medianDurationMs, candidate.summary.medianDurationMs, formatDuration, false)}
${metricRow('Median changed files', baseline.summary.medianChangedFiles, candidate.summary.medianChangedFiles, number, false)}
${metricRow('Median diff lines', baseline.summary.medianDiffLines, candidate.summary.medianDiffLines, number, false)}
${metricRow('Median input tokens', baseline.summary.medianInputTokens, candidate.summary.medianInputTokens, number, false)}
${metricRow('Median cost', baseline.summary.medianCostUsd, candidate.summary.medianCostUsd, formatMoney, false)}
</tbody></table></section>
<section class="section"><div class="section-head"><h3>Trial record</h3><span class="section-note">Open any run to inspect its evidence.</span></div><div class="trial-grid"><div><div class="lane-label">${escapeHtml(baseline.name)}</div>${baseline.trials.map(trialCard).join('')}</div><div><div class="lane-label">${escapeHtml(candidate.name)}</div>${candidate.trials.map(trialCard).join('')}</div></div></section>
<section class="section"><div class="section-head"><h3>How to read this</h3><span class="section-note">Evidence before narrative.</span></div><div class="method"><p>Each variant received the same tasks from the same Git commit in detached worktrees. A run passes only when the agent exits cleanly and every configured assertion passes.</p><p>Agent behavior is stochastic. Treat fewer than five paired runs as exploratory. ContextTest reports a Wilson interval in JSON and avoids claiming statistical significance from tiny samples.</p></div></section>
<footer><span>Generated locally by ContextTest ${escapeHtml(report.version)}</span><span>Inspect diagnostics for sensitive code or paths before sharing.</span></footer>
</main></body></html>`;
}
