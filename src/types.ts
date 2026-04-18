/**
 * Shared types and Zod schemas for the benchmark suite.
 * This is the type contract imported by S7 Tier 2 ingestion in the
 * main BenchLytix repo via `@benchlytix/benchmark-suite`.
 */
import { z } from 'zod';

export const CATEGORIES = [
  'legal-summarization',
  'code-generation',
  'contract-review',
  'data-extraction',
  'customer-support',
  'content-moderation',
  'research-synthesis',
  'translation',
  'classification',
  'structured-output',
] as const;

export const CategorySchema = z.enum(CATEGORIES);
export type Category = z.infer<typeof CategorySchema>;

/** A single test case. One file: cases/<category>/<id>.json */
export const CaseSchema = z.object({
  case_id: z.string().min(1),
  category: CategorySchema,
  input: z.record(z.unknown()),
  expected: z.record(z.unknown()).optional(),
  rubric_ref: z.string().min(1),
  weight: z.number().positive().default(1.0),
  notes: z.string().optional(),
});
export type Case = z.infer<typeof CaseSchema>;

/** Deterministic sub-check: one of regex | exact_match | schema_valid. */
export const DeterministicCheckSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('regex'),
    pattern: z.string(),
    path: z.string().optional(), // JSON path into output; default: full stringified output
    weight: z.number().positive().default(1.0),
  }),
  z.object({
    kind: z.literal('exact_match'),
    path: z.string().optional(),
    weight: z.number().positive().default(1.0),
  }),
  z.object({
    kind: z.literal('schema_valid'),
    // Simple shape descriptor: { field_name: 'string' | 'number' | 'boolean' | 'array' | 'object' }
    shape: z.record(z.enum(['string', 'number', 'boolean', 'array', 'object'])),
    weight: z.number().positive().default(1.0),
  }),
]);
export type DeterministicCheck = z.infer<typeof DeterministicCheckSchema>;

/** A rubric file: rubrics/<category>.json */
export const RubricSchema = z.object({
  category: CategorySchema,
  version: z.string(),
  deterministic_checks: z.array(DeterministicCheckSchema),
  judge_prompt: z.string(),
  dimension_weights: z.object({
    technical_reliability: z.number().min(0).max(1),
    latency: z.number().min(0).max(1),
    cost_efficiency: z.number().min(0).max(1),
    consistency: z.number().min(0).max(1),
  }),
});
export type Rubric = z.infer<typeof RubricSchema>;

/** Per-case result emitted by the runner. */
export const CaseResultSchema = z.object({
  case_id: z.string(),
  category: CategorySchema,
  ok: z.boolean(),
  error: z.string().optional(),
  latency_ms: z.number().nonnegative(),
  cost_usd: z.number().nonnegative().nullable(),
  deterministic_pass_rate: z.number().min(0).max(1),
  llm_judge_score: z.number().min(0).max(1).nullable(),
  judge_skipped_reason: z.enum(['dry_run', 'cost_cap', 'error']).nullable(),
  case_score: z.number().min(0).max(1).nullable(),
  weight: z.number().positive(),
});
export type CaseResult = z.infer<typeof CaseResultSchema>;

/** 4-dimension summary matching BenchLytix internal scoring surface. */
export const FourDimScoreSchema = z.object({
  technical_reliability: z.number().min(0).max(1).nullable(),
  latency: z.number().min(0).max(1).nullable(),
  cost_efficiency: z.number().min(0).max(1).nullable(),
  consistency: z.number().min(0).max(1).nullable(),
  overall: z.number().min(0).max(1).nullable(),
});
export type FourDimScore = z.infer<typeof FourDimScoreSchema>;

/** Full run report written to `benchlytix-results.json`. */
export const RunReportSchema = z.object({
  schema_version: z.literal('0.1.0'),
  run_id: z.string(),
  started_at: z.string(), // ISO 8601
  finished_at: z.string(),
  endpoint: z.string().url(),
  category: CategorySchema,
  model_judge: z.string(), // pinned model id
  dry_run: z.boolean(),
  cost_usd_total: z.number().nonnegative(),
  case_count: z.number().int().nonnegative(),
  cases: z.array(CaseResultSchema),
  scores: FourDimScoreSchema,
});
export type RunReport = z.infer<typeof RunReportSchema>;

/** The fixed Haiku model used for LLM-judge. */
export const JUDGE_MODEL_ID = 'claude-haiku-4-5-20251001';

/** Hard cost cap per invocation (USD). Plan D6. */
export const JUDGE_COST_CAP_USD = 5.0;

/** Approximate cost per case (for pre-run estimate + cost cap). Plan line 52. */
export const JUDGE_COST_PER_CASE_USD = 0.001;
