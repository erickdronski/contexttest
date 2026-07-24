export { loadConfig, validateConfig, createStarterConfig } from './lib/config.mjs';
export { runExperiment } from './lib/engine.mjs';
export { renderHtmlReport, renderTerminalReport } from './lib/reporter.mjs';
export { compareVariants, exactPairedPValue, pairTrials, summarizeTrials, wilsonInterval } from './lib/stats.mjs';
