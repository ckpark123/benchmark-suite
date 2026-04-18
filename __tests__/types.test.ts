import { describe, it, expect } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CaseSchema, CATEGORIES, RubricSchema } from '../src/types.js';

const __filename = fileURLToPath(import.meta.url);
const ROOT = path.resolve(path.dirname(__filename), '..');

describe('data files parse under Zod', () => {
  it('every rubric parses', async () => {
    for (const cat of CATEGORIES) {
      const raw = JSON.parse(await fs.readFile(path.join(ROOT, 'rubrics', `${cat}.json`), 'utf8'));
      expect(() => RubricSchema.parse(raw)).not.toThrow();
    }
  });

  it('every case parses', async () => {
    let count = 0;
    for (const cat of CATEGORIES) {
      const dir = path.join(ROOT, 'cases', cat);
      const files = await fs.readdir(dir);
      for (const f of files) {
        if (!f.endsWith('.json')) continue;
        const raw = JSON.parse(await fs.readFile(path.join(dir, f), 'utf8'));
        expect(() => CaseSchema.parse(raw)).not.toThrow();
        count++;
      }
    }
    expect(count).toBe(50);
  });
});
