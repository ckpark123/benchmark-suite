/**
 * LLM-judge wrapper for Claude Haiku (pinned model id).
 * Cost cap enforced at $5/invocation; exceeding cap → remaining cases
 * skip LLM-judge with reason `cost_cap`.
 */
import Anthropic from '@anthropic-ai/sdk';
import type { Case, Rubric } from './types.js';
import {
  JUDGE_COST_CAP_USD,
  JUDGE_COST_PER_CASE_USD,
  JUDGE_MODEL_ID,
} from './types.js';

export interface JudgeResult {
  score: number | null;
  skipped: 'cost_cap' | 'error' | null;
}

/** Minimal surface we use — matches the real SDK so tests can inject a mock. */
export interface AnthropicLike {
  messages: {
    create: (args: {
      model: string;
      max_tokens: number;
      messages: Array<{ role: string; content: string }>;
    }) => Promise<{
      content: Array<{ type: string; text?: string }>;
    }>;
  };
}

export class JudgeClient {
  private costSoFar = 0;
  private readonly client: AnthropicLike;
  readonly model = JUDGE_MODEL_ID;

  constructor(client?: AnthropicLike, apiKey?: string) {
    if (client) {
      this.client = client;
    } else {
      const key = apiKey ?? process.env.ANTHROPIC_API_KEY;
      if (!key) {
        throw new Error(
          'ANTHROPIC_API_KEY is required to use the LLM judge. Use --dry-run to skip LLM-judge locally.'
        );
      }
      this.client = new Anthropic({ apiKey: key }) as unknown as AnthropicLike;
    }
  }

  get totalCostUsd(): number {
    return this.costSoFar;
  }

  buildPrompt(c: Case, rubric: Rubric, output: unknown): string {
    // The rubric.judge_prompt is a template; we inject structured sections
    // so the model has a deterministic surface to grade.
    return [
      rubric.judge_prompt,
      '',
      '--- CASE INPUT ---',
      JSON.stringify(c.input, null, 2),
      '',
      '--- AGENT OUTPUT ---',
      typeof output === 'string' ? output : JSON.stringify(output, null, 2),
      '',
      c.expected
        ? ['--- EXPECTED (reference) ---', JSON.stringify(c.expected, null, 2), ''].join('\n')
        : '',
      'Respond with ONLY a JSON object of shape {"score": <float 0..1>, "reason": "<one sentence>"}.',
    ]
      .filter(Boolean)
      .join('\n');
  }

  async scoreCase(c: Case, rubric: Rubric, output: unknown): Promise<JudgeResult> {
    if (this.costSoFar + JUDGE_COST_PER_CASE_USD > JUDGE_COST_CAP_USD) {
      return { score: null, skipped: 'cost_cap' };
    }
    const prompt = this.buildPrompt(c, rubric, output);
    try {
      const resp = await this.client.messages.create({
        model: this.model,
        max_tokens: 256,
        messages: [{ role: 'user', content: prompt }],
      });
      this.costSoFar += JUDGE_COST_PER_CASE_USD;
      const text = resp.content
        .map((b) => (b.type === 'text' ? (b.text ?? '') : ''))
        .join('');
      const parsed = extractJson(text);
      if (parsed && typeof parsed.score === 'number') {
        return { score: clamp01(parsed.score), skipped: null };
      }
      // Malformed → fallback score 0.5 (docs note: "with warning")
      return { score: 0.5, skipped: null };
    } catch {
      return { score: null, skipped: 'error' };
    }
  }
}

function extractJson(text: string): { score: number; reason?: string } | null {
  // Try full parse first; if that fails, try to find first {...} block.
  try {
    return JSON.parse(text);
  } catch {
    /* fall through */
  }
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    return JSON.parse(m[0]);
  } catch {
    return null;
  }
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}
