export { loadConfig, validateConfig, createStarterConfig } from './lib/config.mjs';
export { analyzeExperiment, runExperiment } from './lib/engine.mjs';
export { renderHtmlReport, renderTerminalReport } from './lib/reporter.mjs';
export { assessTreatmentDelivery, compareVariants, exactPairedPValue, pairTrials, signalFor, summarizeTrials, wilsonInterval } from './lib/stats.mjs';
