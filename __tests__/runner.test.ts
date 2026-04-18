import { describe, it, expect } from 'vitest';
import { runCase } from '../src/runner.js';
import type { Case, Rubric } from '../src/types.js';

const rubric: Rubric = {
  category: 'classification',
  version: '0.1.0',
  deterministic_checks: [{ kind: 'schema_valid', shape: { label: 'string' }, weight: 1 }],
  judge_prompt: 'grade',
  dimension_weights: { technical_reliability: 0.5, latency: 0.2, cost_efficiency: 0.2, consistency: 0.1 },
};

const caseObj: Case = {
  case_id: 'cl-001',
  category: 'classification',
  input: { text: 'x' },
  expected: {},
  rubric_ref: 'rubrics/classification.json',
  weight: 1,
};

function mockFetch(responder: (body: unknown) => Response): typeof fetch {
  return (async (_url: unknown, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(init.body as string) : {};
    return responder(body);
  }) as unknown as typeof fetch;
}

describe('runCase', () => {
  it('happy path: 200 with output + usage', async () => {
    const f = mockFetch(() =>
      new Response(JSON.stringify({ output: { label: 'finance' }, usage: { cost_usd: 0.002 } }), { status: 200 })
    );
    const r = await runCase(caseObj, rubric, { endpoint: 'http://x', dryRun: true, fetchImpl: f });
    expect(r.ok).toBe(true);
    expect(r.cost_usd).toBe(0.002);
    expect(r.judge_skipped_reason).toBe('dry_run');
    expect(r.deterministic_pass_rate).toBe(1);
  });

  it('500 → case failure recorded', async () => {
    const f = mockFetch(() => new Response('err', { status: 500 }));
    const r = await runCase(caseObj, rubric, { endpoint: 'http://x', dryRun: true, fetchImpl: f });
    expect(r.ok).toBe(false);
    expect(r.error).toContain('500');
  });

  it('malformed JSON (missing output) → failure', async () => {
    const f = mockFetch(() => new Response(JSON.stringify({ nope: 1 }), { status: 200 }));
    const r = await runCase(caseObj, rubric, { endpoint: 'http://x', dryRun: true, fetchImpl: f });
    expect(r.ok).toBe(false);
  });

  it('passthrough of context.case_id in request body', async () => {
    let capturedBody: Record<string, unknown> = {};
    const f = mockFetch((body) => {
      capturedBody = body as Record<string, unknown>;
      return new Response(JSON.stringify({ output: { label: 'a' } }), { status: 200 });
    });
    await runCase(caseObj, rubric, { endpoint: 'http://x', dryRun: true, fetchImpl: f });
    expect((capturedBody['context'] as Record<string, unknown>)?.['case_id']).toBe('cl-001');
    expect(capturedBody['task']).toBe('classification');
  });

  it('usage absent → cost_usd null', async () => {
    const f = mockFetch(() =>
      new Response(JSON.stringify({ output: { label: 'x' } }), { status: 200 })
    );
    const r = await runCase(caseObj, rubric, { endpoint: 'http://x', dryRun: true, fetchImpl: f });
    expect(r.cost_usd).toBeNull();
  });

  it('dry run skips judge', async () => {
    const f = mockFetch(() =>
      new Response(JSON.stringify({ output: { label: 'x' } }), { status: 200 })
    );
    const r = await runCase(caseObj, rubric, { endpoint: 'http://x', dryRun: true, fetchImpl: f });
    expect(r.judge_skipped_reason).toBe('dry_run');
    expect(r.llm_judge_score).toBeNull();
  });
});
