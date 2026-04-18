# Contributing

Thank you for considering a contribution. The highest-leverage way to help is
to add high-quality test cases or improve rubrics.

## Dev setup

```bash
git clone https://github.com/ckpark123/benchmark-suite.git
cd benchmark-suite
npm install
npm run type-check
npm test
npm run validate-cases
```

## Adding a test case

1. Pick a category from `cases/<category>/`.
2. Create `cases/<category>/<prefix>-<NNN>.json`. Follow the format of existing
   files. Use the next available numeric id (5 digits, zero-padded).
3. Shape:
   ```json
   {
     "case_id": "ls-006",
     "category": "legal-summarization",
     "input": { "document": "..." },
     "expected": { "summary_contains": ["..."] },
     "rubric_ref": "rubrics/legal-summarization.json",
     "weight": 1.0,
     "notes": "Why this case matters: which failure mode does it catch?"
   }
   ```
4. Run `npm run validate-cases` locally — must pass.
5. Open a PR. CI will re-run validation + lint + type-check. The LLM judge is
   NOT called in CI.

## Case-quality bar

- **Realistic input** — no toy examples. Draw from public sources,
  your own anonymized real-world data, or domain docs.
- **Deterministic expected output where possible.** If the answer is
  inherently subjective, add checks the judge prompt can rule on.
- **Rationale in `notes`.** Which failure mode does this catch? Why is it
  interesting?
- **No PII.** Strip names, phone numbers, addresses, etc.
- **No copyrighted material.** Paraphrase or write your own.

Cases under `cases/**` and rubrics under `rubrics/**` require 2-person review
(CODEOWNERS).

## Running locally with the judge

```bash
export ANTHROPIC_API_KEY=sk-ant-...
npm run build
node dist/cli.js --category classification \
  --endpoint http://your-endpoint \
  --judge-on \
  --yes
```

Default mode is `--dry-run` (judge off). This avoids burning credits during
iteration. Use `--dry-run` in documentation examples.

## Reporting bugs

Open a GitHub issue with a minimal repro. For schema regressions, include the
full `benchlytix-results.json` output if it parses.

## Code of Conduct

See [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md).
