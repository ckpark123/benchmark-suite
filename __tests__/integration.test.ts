import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import type { Server } from 'node:http';
import { runAll } from '../src/runner.js';
import { aggregate } from '../src/scorer.js';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CATEGORIES,
  CaseSchema,
  RubricSchema,
  RunReportSchema,
  type Case,
  type Category,
  type Rubric,
  type RunReport,
} from '../src/types.js';

const __filename = fileURLToPath(import.meta.url);
const ROOT = path.resolve(path.dirname(__filename), '..');

let server: Server;
let endpoint: string;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.post('/', (req, res) => {
    res.json({ output: { label: 'ok', echo: req.body?.input }, usage: { cost_usd: 0.001 } });
  });
  await new Promise<void>((r) => {
    server = app.listen(0, () => r());
  });
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  endpoint = `http://127.0.0.1:${port}/`;
});

afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
});

describe('integration: 3 cases per category against mock endpoint', () => {
  it('produces a valid RunReport for each category', async () => {
    for (const cat of CATEGORIES) {
      const rubricRaw = JSON.parse(await fs.readFile(path.join(ROOT, 'rubrics', `${cat}.json`), 'utf8'));
      const rubric = RubricSchema.parse(rubricRaw) as Rubric;
      const files = (await fs.readdir(path.join(ROOT, 'cases', cat))).slice(0, 3);
      const cases: Case[] = [];
      for (const f of files) {
        const raw = JSON.parse(await fs.readFile(path.join(ROOT, 'cases', cat, f), 'utf8'));
        cases.push(CaseSchema.parse(raw) as Case);
      }

      const results = await runAll(cases, new Map<Category, Rubric>([[cat as Category, rubric]]), {
        endpoint,
        dryRun: true,
      });

      const scores = aggregate(results);
      const report: RunReport = {
        schema_version: '0.1.0',
        run_id: 'test',
        started_at: new Date().toISOString(),
        finished_at: new Date().toISOString(),
        endpoint,
        category: cat as Category,
        model_judge: 'claude-haiku-4-5-20251001',
        dry_run: true,
        cost_usd_total: 0,
        case_count: results.length,
        cases: results,
        scores,
      };
      const validated = RunReportSchema.parse(report);
      expect(validated.cases.length).toBe(3);
      if (validated.scores.overall != null) {
        expect(validated.scores.overall).toBeGreaterThanOrEqual(0);
        expect(validated.scores.overall).toBeLessThanOrEqual(1);
      }
    }
  });
});
