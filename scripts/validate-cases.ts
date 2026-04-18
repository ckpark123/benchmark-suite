/**
 * Validates every case file under cases/**\/*.json and every rubric under
 * rubrics/*.json against the exported Zod schemas. Used in CI on PRs that
 * touch cases/ or rubrics/.
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CaseSchema, RubricSchema, CATEGORIES } from '../src/types.js';

const __filename = fileURLToPath(import.meta.url);
const ROOT = path.resolve(path.dirname(__filename), '..');

async function readJson(p: string): Promise<unknown> {
  return JSON.parse(await fs.readFile(p, 'utf8'));
}

async function walkCases(dir: string): Promise<string[]> {
  const out: string[] = [];
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...(await walkCases(full)));
    else if (e.isFile() && e.name.endsWith('.json')) out.push(full);
  }
  return out;
}

async function main(): Promise<number> {
  let errors = 0;
  const casesRoot = path.join(ROOT, 'cases');
  const caseFiles = await walkCases(casesRoot);
  for (const f of caseFiles) {
    try {
      const data = await readJson(f);
      CaseSchema.parse(data);
    } catch (e) {
      console.error(`CASE FAIL: ${path.relative(ROOT, f)}: ${(e as Error).message}`);
      errors += 1;
    }
  }

  for (const cat of CATEGORIES) {
    const p = path.join(ROOT, 'rubrics', `${cat}.json`);
    try {
      const data = await readJson(p);
      RubricSchema.parse(data);
    } catch (e) {
      console.error(`RUBRIC FAIL: ${cat}: ${(e as Error).message}`);
      errors += 1;
    }
  }

  console.log(`Validated ${caseFiles.length} cases + ${CATEGORIES.length} rubrics. Errors: ${errors}.`);
  return errors === 0 ? 0 : 1;
}

main().then((c) => process.exit(c));
