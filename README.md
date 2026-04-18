# @benchlytix/benchmark-suite

> Independent, reproducible benchmark test suite for AI agents. Apache 2.0.
> Powers the scoring you see on [BenchLytix.com](https://benchlytix.com).

**Status**: v0.1.0-rc.1 — MVP seed release. 50 test cases across 10 categories.
Expansion to 200 cases is tracked in [GitHub issues](https://github.com/ckpark123/benchmark-suite/issues).

## Why this exists

BenchLytix scores are only credible if the methodology is public and forkable.
This repo IS the methodology. Anyone can run the same suite against any agent
endpoint and reproduce our scores. No account. No gate. No closed scoring box.

## Quickstart

```bash
# Dry run (no LLM-judge calls, free). Default mode.
npx @benchlytix/benchmark-suite \
  --category legal-summarization \
  --endpoint https://your-agent.example.com/benchmark

# With LLM-judge enabled (Haiku, ~$0.001/case).
export ANTHROPIC_API_KEY=sk-ant-...
npx @benchlytix/benchmark-suite \
  --category legal-summarization \
  --endpoint https://your-agent.example.com/benchmark \
  --judge-on
```

Results are printed to stdout and written to `benchlytix-results.json`.

## Endpoint contract

Your agent must accept:

```
POST <endpoint>
Content-Type: application/json

{
  "task": "legal-summarization",
  "input": { ... },
  "context": { "case_id": "ls-001" }
}
```

Respond with:

```
200 OK
{
  "output": <string | object>,
  "usage": { "tokens": 1234, "cost_usd": 0.0042 }  // optional
}
```

## Categories

| Slug | Focus |
|---|---|
| `legal-summarization` | Summarize a legal document faithfully. |
| `code-generation` | Produce correct runnable code for a task. |
| `contract-review` | Identify risky or missing clauses. |
| `data-extraction` | Extract structured fields from unstructured text. |
| `customer-support` | Answer a support ticket helpfully and accurately. |
| `content-moderation` | Classify content against policy categories. |
| `research-synthesis` | Synthesize multiple sources into one answer. |
| `translation` | Translate preserving tone and terminology. |
| `classification` | Assign a label from a fixed taxonomy. |
| `structured-output` | Produce JSON matching a declared schema. |

## Scoring

Each case is scored `deterministic * 0.6 + llm_judge * 0.4`. If judge is skipped
(dry-run, cost cap, or error) the score renormalizes to deterministic-only.
Aggregate output matches the BenchLytix 4-dimension shape:
`technical_reliability`, `latency`, `cost_efficiency`, `consistency` (null in
v0.1.0; added in later releases), plus an `overall` average.

## LLM judge

Pinned model: `claude-haiku-4-5-20251001`. Hard cost cap: **$5/invocation**.
CI never calls the judge — all judge coverage is mocked in unit tests.

## Contributing

New test cases and improved rubrics are the highest-value contribution. See
[CONTRIBUTING.md](./CONTRIBUTING.md). Each case file is one tiny JSON blob —
reviews are easy, diffs are obvious, CI validates schema on every PR.

## License

Apache 2.0. See [LICENSE](./LICENSE).
