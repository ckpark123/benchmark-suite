import { describe, it, expect } from 'vitest';
import { JudgeClient, type AnthropicLike } from '../src/judge-llm.js';
import { JUDGE_MODEL_ID } from '../src/types.js';
import type { Case, Rubric } from '../src/types.js';

const rubric: Rubric = {
  category: 'classification',
  version: '0.1.0',
  deterministic_checks: [],
  judge_prompt: 'grade this',
  dimension_weights: { technical_reliability: 0.5, latency: 0.2, cost_efficiency: 0.2, consistency: 0.1 },
};
const caseObj: Case = {
  case_id: 'cl-001',
  category: 'classification',
  input: {},
  expected: {},
  rubric_ref: 'rubrics/classification.json',
  weight: 1,
};

function makeMock(text: string, fail = false): AnthropicLike {
  return {
    messages: {
      create: async () => {
        if (fail) throw new Error('boom');
        return { content: [{ type: 'text', text }] };
      },
    },
  };
}

describe('JudgeClient', () => {
  it('pins the Haiku model id', () => {
    const j = new JudgeClient(makeMock('{"score":1}'));
    expect(j.model).toBe('claude-haiku-4-5-20251001');
    expect(JUDGE_MODEL_ID).toBe('claude-haiku-4-5-20251001');
  });

  it('parses valid JSON response', async () => {
    const j = new JudgeClient(makeMock('{"score": 0.8, "reason": "ok"}'));
    const r = await j.scoreCase(caseObj, rubric, { x: 1 });
    expect(r.score).toBeCloseTo(0.8, 5);
    expect(r.skipped).toBeNull();
  });

  it('malformed response → fallback 0.5', async () => {
    const j = new JudgeClient(makeMock('not json at all'));
    const r = await j.scoreCase(caseObj, rubric, {});
    expect(r.score).toBe(0.5);
  });

  it('error → score null, skipped=error', async () => {
    const j = new JudgeClient(makeMock('', true));
    const r = await j.scoreCase(caseObj, rubric, {});
    expect(r.score).toBeNull();
    expect(r.skipped).toBe('error');
  });

  it('cost cap skips once exceeded', async () => {
    const j = new JudgeClient(makeMock('{"score":1}'));
    // Manually push cost past cap.
    (j as unknown as { costSoFar: number }).costSoFar = 4.9999;
    const r = await j.scoreCase(caseObj, rubric, {});
    expect(r.skipped).toBe('cost_cap');
    expect(r.score).toBeNull();
  });

  it('buildPrompt embeds case input, output, expected', () => {
    const j = new JudgeClient(makeMock('{"score":1}'));
    const p = j.buildPrompt(caseObj, rubric, { hello: 'world' });
    expect(p).toContain('CASE INPUT');
    expect(p).toContain('AGENT OUTPUT');
    expect(p).toContain('"score"');
  });
});
