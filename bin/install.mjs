// VPDS installer: copy the kit into a project and keep it updated safely.
//
// Every installed file is recorded in <project>/.vpds.json with a hash of what we wrote.
// On update, a file is replaced only if it still matches that hash, so your edits are never
// overwritten (unless --force). AGENTS.md, CLAUDE.md and .gitignore are merged, never replaced.
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { createHash } from 'node:crypto';

export const KIT_ROOT = resolve(import.meta.dirname, '..');
export const MANIFEST = '.vpds.json';
const START = '<!-- vpds:start (managed by `npx vpds update`; edit outside this block) -->';
const END = '<!-- vpds:end -->';
const GITIGNORE_START = '# vpds:start';
const GITIGNORE_END = '# vpds:end';

const normalise = (t) => t.replace(/\r\n/g, '\n');
export const hash = (t) => createHash('sha256').update(normalise(t)).digest('hex').slice(0, 12);
const version = () => JSON.parse(readFileSync(join(KIT_ROOT, 'package.json'), 'utf8')).version;

const list = (dir, test = () => true) =>
  existsSync(join(KIT_ROOT, dir)) ? readdirSync(join(KIT_ROOT, dir)).filter(test).sort().map((f) => `${dir}/${f}`) : [];

/** Kit files to copy, filtered by options. Paths are relative and use forward slashes. */
export function kitFiles({ tools = ['claude', 'cursor'], obsidian = true } = {}) {
  return [
    ...list('vpds/personas', (f) => f.endsWith('.md')),
    'vpds/gate.mjs',
    'vpds/lib.mjs',
    ...list('openspec/_templates', (f) => f.endsWith('.md')),
    ...(tools.includes('claude') ? list('.claude/commands/vp', (f) => f.endsWith('.md')) : []),
    ...(tools.includes('cursor') ? list('.cursor/commands', (f) => /^vp-.*\.md$/.test(f)) : []),
    ...(obsidian
      ? ['openspec/changes.base', 'openspec/pipeline.canvas', 'openspec/.obsidian/templates.json', 'openspec/.obsidian/app.json']
      : []),
  ];
}

/** Replace (or append) a marked block inside existing text. */
export function upsertBlock(existing, block, start = START, end = END) {
  const wrapped = `${start}\n${block.trim()}\n${end}`;
  const text = normalise(existing);
  const i = text.indexOf(start);
  const j = text.indexOf(end);
  if (i >= 0 && j > i) return text.slice(0, i) + wrapped + text.slice(j + end.length);
  return text.trim() ? `${text.trimEnd()}\n\n${wrapped}\n` : `${wrapped}\n`;
}

/** The .gitignore lines VPDS needs. */
const GITIGNORE_BLOCK = [
  'openspec/.obsidian/workspace*.json',
  'openspec/.obsidian/cache',
  'openspec/.trash/',
].join('\n');

/**
 * Plan (and optionally apply) an install or update.
 * @param {string} target project directory
 * @param {{ mode: 'init'|'update', tools?: string[], obsidian?: boolean, force?: boolean, dryRun?: boolean }} opts
 * @returns {{ actions: { path: string, action: 'create'|'update'|'unchanged'|'skip'|'merge' , note?: string }[] }}
 */
export function install(target, { mode = 'init', tools, obsidian = true, force = false, dryRun = false } = {}) {
  const manifestPath = join(target, MANIFEST);
  const hasManifest = existsSync(manifestPath);
  if (mode === 'init' && hasManifest) throw new Error('VPDS is already installed here. Run `npx vpds update` instead.');
  if (mode === 'update' && !hasManifest) throw new Error('VPDS is not installed here (no .vpds.json). Run `npx vpds init` first.');

  const manifest = hasManifest ? JSON.parse(readFileSync(manifestPath, 'utf8')) : { files: {} };
  // On update, keep the options chosen at init unless overridden.
  tools ??= manifest.tools ?? ['claude', 'cursor'];
  if (mode === 'update' && manifest.obsidian === false) obsidian = false;

  const actions = [];
  const writes = [];
  const next = { version: version(), tools, obsidian, files: {} };

  for (const rel of kitFiles({ tools, obsidian })) {
    const content = normalise(readFileSync(join(KIT_ROOT, rel), 'utf8'));
    const dest = join(target, rel);
    const newHash = hash(content);

    if (!existsSync(dest)) {
      actions.push({ path: rel, action: 'create' });
      writes.push([dest, content]);
      next.files[rel] = newHash;
      continue;
    }
    const current = hash(readFileSync(dest, 'utf8'));
    const installed = manifest.files[rel];
    if (current === newHash) {
      actions.push({ path: rel, action: 'unchanged' });
      next.files[rel] = newHash;
    } else if (force || (installed && current === installed)) {
      actions.push({ path: rel, action: 'update' });
      writes.push([dest, content]);
      next.files[rel] = newHash;
    } else {
      actions.push({ path: rel, action: 'skip', note: installed ? 'you edited it; --force to replace' : 'file already exists; --force to replace' });
      if (installed) next.files[rel] = installed; // keep tracking the version we last wrote
    }
  }

  // AGENTS.md: managed block, rest of the file is yours.
  const agentsPath = join(target, 'AGENTS.md');
  const agentsOld = existsSync(agentsPath) ? readFileSync(agentsPath, 'utf8') : '';
  const agentsNew = upsertBlock(agentsOld, readFileSync(join(KIT_ROOT, 'AGENTS.md'), 'utf8'));
  pushMerge(actions, writes, 'AGENTS.md', agentsPath, agentsOld, agentsNew);

  // CLAUDE.md: make sure it imports AGENTS.md.
  if (tools.includes('claude')) {
    const claudePath = join(target, 'CLAUDE.md');
    const old = existsSync(claudePath) ? normalise(readFileSync(claudePath, 'utf8')) : '';
    const updated = /^@AGENTS\.md\s*$/m.test(old) ? old : `@AGENTS.md\n${old ? `\n${old}` : ''}`;
    pushMerge(actions, writes, 'CLAUDE.md', claudePath, old, updated);
  }

  // .gitignore: managed block.
  if (obsidian) {
    const giPath = join(target, '.gitignore');
    const old = existsSync(giPath) ? readFileSync(giPath, 'utf8') : '';
    pushMerge(actions, writes, '.gitignore', giPath, old, upsertBlock(old, GITIGNORE_BLOCK, GITIGNORE_START, GITIGNORE_END));
  }

  if (!dryRun) {
    for (const [dest, content] of writes) {
      mkdirSync(dirname(dest), { recursive: true });
      writeFileSync(dest, content);
    }
    writeFileSync(manifestPath, `${JSON.stringify(next, null, 2)}\n`);
  }
  return { actions, manifest: next };
}

function pushMerge(actions, writes, rel, dest, oldText, newText) {
  if (normalise(oldText) === normalise(newText)) return actions.push({ path: rel, action: 'unchanged' });
  actions.push({ path: rel, action: oldText ? 'merge' : 'create' });
  writes.push([dest, newText]);
}
