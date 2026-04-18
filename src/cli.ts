#!/usr/bin/env node
/**
 * CLI entry.
 *   npx @benchlytix/benchmark-suite --category <slug> --endpoint <url>
 *     [--dry-run] [--output <path>] [--judge-on] [--yes]
 */
import { Command } from 'commander';
import chalk from 'chalk';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import {
  CATEGORIES,
  CaseSchema,
  JUDGE_COST_PER_CASE_USD,
  JUDGE_MODEL_ID,
  RubricSchema,
  RunReportSchema,
  type Case,
  type Category,
  type Rubric,
  type RunReport,
} from './types.js';
import { aggregate } from './scorer.js';
import { runAll } from './runner.js';
import { JudgeClient } from './judge-llm.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// When installed, layout is dist/cli.js; cases/ and rubrics/ sit at package root.
const PKG_ROOT = path.resolve(__dirname, '..');

async function loadCasesFor(category: Category): Promise<Case[]> {
  const dir = path.join(PKG_ROOT, 'cases', category);
  const files = await fs.readdir(dir).catch(() => []);
  const cases: Case[] = [];
  for (const f of files) {
    if (!f.endsWith('.json')) continue;
    const raw = await fs.readFile(path.join(dir, f), 'utf8');
    const parsed = CaseSchema.parse(JSON.parse(raw));
    cases.push(parsed);
  }
  return cases;
}

async function loadRubricFor(category: Category): Promise<Rubric> {
  const p = path.join(PKG_ROOT, 'rubrics', `${category}.json`);
  const raw = await fs.readFile(p, 'utf8');
  return RubricSchema.parse(JSON.parse(raw));
}

function printTable(report: RunReport): void {
  console.log('');
  console.log(chalk.bold(`BenchLytix benchmark — ${report.category}`));
  console.log(chalk.gray(`  run_id: ${report.run_id}`));
  console.log(chalk.gray(`  endpoint: ${report.endpoint}`));
  console.log(chalk.gray(`  cases: ${report.case_count}  dry_run: ${report.dry_run}`));
  console.log('');
  console.log(chalk.bold('Per-case:'));
  for (const c of report.cases) {
    const status = c.ok ? chalk.green('OK') : chalk.red('FAIL');
    const score =
      c.case_score == null ? 'n/a' : c.case_score.toFixed(3);
    console.log(
      `  ${status}  ${c.case_id.padEnd(14)} score=${score} det=${c.deterministic_pass_rate.toFixed(2)} judge=${c.llm_judge_score ?? 'skip'} ${c.latency_ms}ms`
    );
  }
  console.log('');
  console.log(chalk.bold('Aggregate:'));
  const s = report.scores;
  console.log(`  technical_reliability: ${fmt(s.technical_reliability)}`);
  console.log(`  latency:               ${fmt(s.latency)}`);
  console.log(`  cost_efficiency:       ${fmt(s.cost_efficiency)}`);
  console.log(`  consistency:           ${fmt(s.consistency)}`);
  console.log(chalk.bold(`  overall:               ${fmt(s.overall)}`));
  console.log('');
}

function fmt(n: number | null): string {
  return n == null ? 'n/a' : n.toFixed(3);
}

export async function main(argv: string[]): Promise<number> {
  const program = new Command();
  program
    .name('benchlytix-benchmark')
    .description('Run the BenchLytix benchmark test suite against an agent endpoint.')
    .requiredOption('--category <slug>', `Category slug (one of: ${CATEGORIES.join(', ')})`)
    .requiredOption('--endpoint <url>', 'HTTP(S) endpoint accepting POST { task, input, context }')
    .option('--output <path>', 'Output JSON path', 'benchlytix-results.json')
    .option('--dry-run', 'Skip LLM-judge (default: on). Use --judge-on to enable.', true)
    .option('--judge-on', 'Enable the LLM judge (requires ANTHROPIC_API_KEY). Default: off.')
    .option('--yes', 'Skip interactive cost confirmation.')
    .parse(argv);

  const opts = program.opts();
  const category = opts['category'] as Category;
  if (!CATEGORIES.includes(category)) {
    console.error(chalk.red(`Unknown category: ${category}`));
    return 2;
  }

  const dryRun = !opts['judge-on'];
  const cases = await loadCasesFor(category);
  const rubric = await loadRubricFor(category);
  const rubrics = new Map<Category, Rubric>([[category, rubric]]);

  if (!dryRun) {
    const est = cases.length * JUDGE_COST_PER_CASE_USD;
    console.log(
      chalk.yellow(
        `LLM-judge enabled. Estimated cost: $${est.toFixed(3)} (${cases.length} cases × $${JUDGE_COST_PER_CASE_USD}).`
      )
    );
    if (est > 1 && !opts['yes']) {
      console.error(chalk.red('Estimated cost > $1. Re-run with --yes to confirm.'));
      return 3;
    }
  }

  const judge = dryRun ? undefined : new JudgeClient();

  const startedAt = new Date().toISOString();
  const results = await runAll(cases, rubrics, {
    endpoint: opts['endpoint'],
    dryRun,
    judge,
  });
  const finishedAt = new Date().toISOString();

  const scores = aggregate(results);
  const report: RunReport = {
    schema_version: '0.1.0',
    run_id: randomUUID(),
    started_at: startedAt,
    finished_at: finishedAt,
    endpoint: opts['endpoint'],
    category,
    model_judge: JUDGE_MODEL_ID,
    dry_run: dryRun,
    cost_usd_total: judge?.totalCostUsd ?? 0,
    case_count: results.length,
    cases: results,
    scores,
  };

  const validated = RunReportSchema.parse(report);
  await fs.writeFile(opts['output'], JSON.stringify(validated, null, 2), 'utf8');
  printTable(validated);
  console.log(chalk.gray(`Results written to ${opts['output']}`));
  return 0;
}

// Direct execution guard.
const isMain =
  import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith('cli.js') === true;
if (isMain) {
  main(process.argv).then(
    (code) => process.exit(code),
    (err) => {
      console.error(chalk.red(err instanceof Error ? err.message : String(err)));
      process.exit(1);
    }
  );
}
