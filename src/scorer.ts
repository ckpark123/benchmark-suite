/**
 * Scoring algebra (plan §D3).
 *
 * case_score      = deterministic_pass_rate * 0.6 + llm_judge_score * 0.4
 * technical_reliability = weighted-average of case_scores
 * latency         = bounded inverse of mean latency
 * cost_efficiency = bounded inverse of mean cost_usd (null when no usage)
 * consistency     = null in v0.1.0 (S7 adds re-run loop)
 * overall         = dimension-weighted mean of present dims
 */
import type { CaseResult, DeterministicCheck, FourDimScore, Rubric } from './types.js';

const DETERMINISTIC_WEIGHT = 0.6;
const JUDGE_WEIGHT = 0.4;

export interface DeterministicResult {
  pass_rate: number;
  checks_run: number;
  checks_passed: number;
}

function getPath(obj: unknown, path: string | undefined): unknown {
  if (!path) return obj;
  const parts = path.split('.').filter(Boolean);
  let cur: unknown = obj;
  for (const p of parts) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[p];
  }
  return cur;
}

function runCheck(check: DeterministicCheck, output: unknown, expected: unknown): boolean {
  if (check.kind === 'regex') {
    const target = getPath(output, check.path);
    const s = typeof target === 'string' ? target : JSON.stringify(target ?? '');
    try {
      return new RegExp(check.pattern).test(s);
    } catch {
      return false;
    }
  }
  if (check.kind === 'exact_match') {
    const a = getPath(output, check.path);
    const b = getPath(expected, check.path);
    return JSON.stringify(a) === JSON.stringify(b);
  }
  if (check.kind === 'schema_valid') {
    if (!output || typeof output !== 'object') return false;
    const rec = output as Record<string, unknown>;
    for (const [field, expectedType] of Object.entries(check.shape)) {
      const v = rec[field];
      if (v === undefined) return false;
      const actual = Array.isArray(v) ? 'array' : typeof v;
      if (actual !== expectedType) return false;
    }
    return true;
  }
  return false;
}

export function scoreDeterministic(
  rubric: Rubric,
  output: unknown,
  expected: unknown
): DeterministicResult {
  const checks = rubric.deterministic_checks;
  if (checks.length === 0) {
    return { pass_rate: 1, checks_run: 0, checks_passed: 0 };
  }
  let totalWeight = 0;
  let passedWeight = 0;
  let passedCount = 0;
  for (const c of checks) {
    const w = c.weight;
    totalWeight += w;
    if (runCheck(c, output, expected)) {
      passedWeight += w;
      passedCount += 1;
    }
  }
  return {
    pass_rate: totalWeight === 0 ? 0 : passedWeight / totalWeight,
    checks_run: checks.length,
    checks_passed: passedCount,
  };
}

export function computeCaseScore(
  detPassRate: number,
  judgeScore: number | null
): number {
  if (judgeScore == null) {
    // No judge (dry-run or cap): renormalize to deterministic only.
    return clamp01(detPassRate);
  }
  return clamp01(detPassRate * DETERMINISTIC_WEIGHT + judgeScore * JUDGE_WEIGHT);
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

/**
 * Aggregate per-case results into the 4-dim BenchLytix scoring shape.
 */
export function aggregate(results: CaseResult[]): FourDimScore {
  if (results.length === 0) {
    return {
      technical_reliability: null,
      latency: null,
      cost_efficiency: null,
      consistency: null,
      overall: null,
    };
  }

  // Technical reliability = weighted avg of case_scores that have a score.
  let sumCaseWeight = 0;
  let sumCaseScore = 0;
  for (const r of results) {
    if (r.case_score == null) continue;
    sumCaseWeight += r.weight;
    sumCaseScore += r.case_score * r.weight;
  }
  const technical_reliability =
    sumCaseWeight > 0 ? clamp01(sumCaseScore / sumCaseWeight) : null;

  // Latency: normalize mean latency_ms via a 10s soft cap → 1.0 when fast, 0 when >=10s.
  const latencies = results.filter((r) => r.ok).map((r) => r.latency_ms);
  const meanLatency =
    latencies.length > 0 ? latencies.reduce((a, b) => a + b, 0) / latencies.length : null;
  const latency =
    meanLatency == null ? null : clamp01(1 - meanLatency / 10000);

  // Cost efficiency: if ANY case returned a cost_usd, compute inverse; else null.
  const costs = results
    .map((r) => r.cost_usd)
    .filter((c): c is number => c != null && c > 0);
  const meanCost =
    costs.length > 0 ? costs.reduce((a, b) => a + b, 0) / costs.length : null;
  const cost_efficiency =
    meanCost == null ? null : clamp01(1 - meanCost / 0.05); // $0.05/case → 0

  // Consistency skipped in v0.1.0 (S7 adds re-run loop)
  const consistency = null;

  // Overall = mean of present dims.
  const present = [technical_reliability, latency, cost_efficiency].filter(
    (d): d is number => d != null
  );
  const overall =
    present.length === 0 ? null : clamp01(present.reduce((a, b) => a + b, 0) / present.length);

  return {
    technical_reliability,
    latency,
    cost_efficiency,
    consistency,
    overall,
  };
}
