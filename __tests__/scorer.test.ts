import { describe, it, expect } from 'vitest';
import { aggregate, computeCaseScore, scoreDeterministic } from '../src/scorer.js';
import type { CaseResult, Rubric } from '../src/types.js';

const rubric: Rubric = {
  category: 'classification',
  version: '0.1.0',
  deterministic_checks: [
    { kind: 'regex', pattern: '^label:', weight: 1.0 },
    { kind: 'schema_valid', shape: { label: 'string' }, weight: 1.0 },
  ],
  judge_prompt: 'grade this',
  dimension_weights: {
    technical_reliability: 0.5,
    latency: 0.2,
    cost_efficiency: 0.2,
    consistency: 0.1,
  },
};

describe('scoreDeterministic', () => {
  it('100% pass when all checks match', () => {
    const r = scoreDeterministic(rubric, { label: 'label: finance' }, {});
    expect(r.pass_rate).toBeGreaterThan(0);
  });

  it('0% pass when nothing matches', () => {
    const r = scoreDeterministic(
      { ...rubric, deterministic_checks: [{ kind: 'regex', pattern: 'ZZZ', weight: 1 }] },
      'hello',
      {}
    );
    expect(r.pass_rate).toBe(0);
  });

  it('empty checks → pass_rate 1', () => {
    const r = scoreDeterministic({ ...rubric, deterministic_checks: [] }, {}, {});
    expect(r.pass_rate).toBe(1);
  });

  it('schema_valid detects missing fields', () => {
    const r = scoreDeterministic(
      { ...rubric, deterministic_checks: [{ kind: 'schema_valid', shape: { name: 'string' }, weight: 1 }] },
      {},
      {}
    );
    expect(r.pass_rate).toBe(0);
  });
});

describe('computeCaseScore', () => {
  it('60/40 split applied when judge present', () => {
    expect(computeCaseScore(1, 0)).toBeCloseTo(0.6, 5);
    expect(computeCaseScore(0, 1)).toBeCloseTo(0.4, 5);
    expect(computeCaseScore(1, 1)).toBeCloseTo(1.0, 5);
  });

  it('renormalizes to deterministic only when judge is null', () => {
    expect(computeCaseScore(0.75, null)).toBeCloseTo(0.75, 5);
  });

  it('clamps to [0,1]', () => {
    expect(computeCaseScore(2, 2)).toBe(1);
    expect(computeCaseScore(-1, -1)).toBe(0);
  });
});

describe('aggregate', () => {
  const base = (over: Partial<CaseResult>): CaseResult => ({
    case_id: 'x',
    category: 'classification',
    ok: true,
    latency_ms: 1000,
    cost_usd: null,
    deterministic_pass_rate: 1,
    llm_judge_score: 1,
    judge_skipped_reason: null,
    case_score: 1,
    weight: 1,
    ...over,
  });

  it('empty results → all nulls', () => {
    const s = aggregate([]);
    expect(s.overall).toBeNull();
    expect(s.technical_reliability).toBeNull();
  });

  it('technical_reliability is weighted case mean', () => {
    const s = aggregate([base({ case_score: 1 }), base({ case_score: 0, weight: 3 })]);
    expect(s.technical_reliability).toBeCloseTo(0.25, 5);
  });

  it('latency inversely proportional to mean ms', () => {
    const s = aggregate([base({ latency_ms: 1000 }), base({ latency_ms: 1000 })]);
    expect(s.latency).toBeCloseTo(0.9, 5);
  });

  it('cost_efficiency null when no usage present', () => {
    const s = aggregate([base({ cost_usd: null })]);
    expect(s.cost_efficiency).toBeNull();
  });

  it('consistency is null in v0.1.0', () => {
    const s = aggregate([base({})]);
    expect(s.consistency).toBeNull();
  });

  it('overall = mean of present dims', () => {
    const s = aggregate([base({ case_score: 0.5, latency_ms: 5000 })]);
    expect(s.overall).not.toBeNull();
    expect(s.overall!).toBeGreaterThan(0);
    expect(s.overall!).toBeLessThanOrEqual(1);
  });
});
