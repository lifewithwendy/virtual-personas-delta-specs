// Shared helpers for VPDS tests (not a test file itself).
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

export const GATE = resolve(import.meta.dirname, 'gate.mjs');

/** Frontmatter + body text from a meta object. */
export const fm = (meta, body = '# Body\n') =>
  `---\n${Object.entries(meta).map(([k, v]) => `${k}: ${v}`).join('\n')}\n---\n${body}`;

/** Throwaway repo: { 'change-id': { 'file.md': {meta} | 'raw text' } } → { root, base } */
export function makeRepo(changes) {
  const root = mkdtempSync(join(tmpdir(), 'vpds-'));
  const base = join(root, 'openspec', 'changes');
  mkdirSync(join(base, 'archive', '2026-01-01-old'), { recursive: true });
  for (const [id, files] of Object.entries(changes)) {
    for (const [name, content] of Object.entries(files)) {
      const path = join(base, id, name);
      mkdirSync(resolve(path, '..'), { recursive: true });
      writeFileSync(path, typeof content === 'string' ? content : fm(content));
    }
    mkdirSync(join(base, id), { recursive: true });
  }
  return { root, base };
}

/** Run the gate CLI non-interactively (stdin is a pipe, never a TTY). */
export const run = (root, ...args) =>
  execFileSync(process.execPath, [GATE, ...args], { cwd: root, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
