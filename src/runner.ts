/**
 * Runner — posts each case to the endpoint, times it, collects responses.
 * Endpoint contract (plan §D4):
 *   POST <endpoint>
 *   { task: category, input, context: { case_id } }
 *   → 200 { output, usage?: { tokens, cost_usd } }
 */
import type { Case, CaseResult, Category, Rubric } from './types.js';
import { computeCaseScore, scoreDeterministic } from './scorer.js';
import { JudgeClient } from './judge-llm.js';

export interface RunnerOptions {
  endpoint: string;
  dryRun: boolean;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  judge?: JudgeClient; // injected for tests
}

export interface EndpointResponseOk {
  output: unknown;
  usage?: { tokens?: number; cost_usd?: number };
}

const DEFAULT_TIMEOUT_MS = 30000;

export async function runCase(
  c: Case,
  rubric: Rubric,
  opts: RunnerOptions
): Promise<CaseResult> {
  const started = Date.now();
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const f = opts.fetchImpl ?? fetch;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let outputBody: EndpointResponseOk | null = null;
  let error: string | undefined;
  try {
    const resp = await f(opts.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        task: c.category,
        input: c.input,
        context: { case_id: c.case_id },
      }),
      signal: controller.signal,
    });
    if (!resp.ok) {
      error = `HTTP ${resp.status}`;
    } else {
      const body = (await resp.json()) as unknown;
      if (!body || typeof body !== 'object' || !('output' in body)) {
        error = 'malformed response: missing output';
      } else {
        outputBody = body as EndpointResponseOk;
      }
    }
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  } finally {
    clearTimeout(timer);
  }

  const latency_ms = Date.now() - started;
  const ok = error == null && outputBody != null;

  if (!ok) {
    return {
      case_id: c.case_id,
      category: c.category,
      ok: false,
      error,
      latency_ms,
      cost_usd: null,
      deterministic_pass_rate: 0,
      llm_judge_score: null,
      judge_skipped_reason: 'error',
      case_score: 0,
      weight: c.weight ?? 1,
    };
  }

  const { pass_rate } = scoreDeterministic(rubric, outputBody!.output, c.expected);

  let judgeScore: number | null = null;
  let judgeSkipped: CaseResult['judge_skipped_reason'] = null;
  if (opts.dryRun) {
    judgeSkipped = 'dry_run';
  } else if (opts.judge) {
    const judgeRes = await opts.judge.scoreCase(c, rubric, outputBody!.output);
    judgeScore = judgeRes.score;
    judgeSkipped = judgeRes.skipped;
  } else {
    // No judge client wired: treat as dry run (safe default — no accidental API calls).
    judgeSkipped = 'dry_run';
  }

  const caseScore = computeCaseScore(pass_rate, judgeScore);

  return {
    case_id: c.case_id,
    category: c.category,
    ok: true,
    latency_ms,
    cost_usd: outputBody!.usage?.cost_usd ?? null,
    deterministic_pass_rate: pass_rate,
    llm_judge_score: judgeScore,
    judge_skipped_reason: judgeSkipped,
    case_score: caseScore,
    weight: c.weight ?? 1,
  };
}

export async function runAll(
  cases: Case[],
  rubrics: Map<Category, Rubric>,
  opts: RunnerOptions
): Promise<CaseResult[]> {
  const results: CaseResult[] = [];
  // Sequential to respect cost cap semantics and keep runs deterministic.
  for (const c of cases) {
    const r = rubrics.get(c.category);
    if (!r) {
      results.push({
        case_id: c.case_id,
        category: c.category,
        ok: false,
        error: `no rubric for ${c.category}`,
        latency_ms: 0,
        cost_usd: null,
        deterministic_pass_rate: 0,
        llm_judge_score: null,
        judge_skipped_reason: 'error',
        case_score: 0,
        weight: c.weight ?? 1,
      });
      continue;
    }
    results.push(await runCase(c, r, opts));
  }
  return results;
}
