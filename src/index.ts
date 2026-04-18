/**
 * Library entry — exported for programmatic use (S7 Tier 2 ingestion
 * imports types from here).
 */
export * from './types.js';
export { aggregate, computeCaseScore, scoreDeterministic } from './scorer.js';
export { runAll, runCase } from './runner.js';
export { JudgeClient } from './judge-llm.js';
