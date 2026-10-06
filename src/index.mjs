export { loadConfig, validateConfig, createStarterConfig, resolveVariantAgent, variantAgents } from './lib/config.mjs';
export { analyzeExperiment, runExperiment, scheduleTrials } from './lib/engine.mjs';
export { analyzeAblation, planAblation, runAblation } from './lib/ablation.mjs';
export { aggregateReports, loadReports, writeAggregate } from './lib/aggregate.mjs';
export { selectSections, splitSections, withoutSection } from './lib/sections.mjs';
export { renderAblationHtml, renderAblationTerminal, renderAggregateHtml, renderAggregateTerminal, renderHtmlReport, renderReport, renderReportTerminal, renderTerminalReport, reportKind } from './lib/reporter.mjs';
export { assessTreatmentDelivery, compareVariants, exactPairedPValue, holmAdjust, pairTrials, signalFor, summarizeTrials, wilsonInterval } from './lib/stats.mjs';
