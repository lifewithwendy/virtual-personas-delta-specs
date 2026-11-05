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

/** Line endings for VPDS files: hashes ignore CRLF, but LF keeps diffs clean across Windows/macOS/Linux. */
const GITATTRIBUTES_BLOCK = ['openspec/** text eol=lf', 'vpds/** text eol=lf', 'AGENTS.md text eol=lf'].join('\n');

/** The .gitignore lines VPDS needs. */
const GITIGNORE_BLOCK = [
  'openspec/.obsidian/workspace*.json',
  'openspec/.obsidian/cache',
  'openspec/.trash/',
].join('\n');

/**
 * Plan (and optionally apply) an install or update.
 * @param {string} target project directory
 * @param {{ mode: 'init'|'update', tools?: string[], obsidian?: boolean, force?: boolean, dryRun?: boolean,
 *           repos?: Record<string,string> }} opts  repos: code repos for a multi-repo (planning repo) setup
 * @returns {{ actions: { path: string, action: 'create'|'update'|'unchanged'|'skip'|'merge' , note?: string }[] }}
 */
export function install(target, { mode = 'init', tools, obsidian = true, force = false, dryRun = false, repos = {}, approval } = {}) {
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

  // .gitattributes: LF for VPDS-managed files only (never your code).
  const gaPath = join(target, '.gitattributes');
  const gaOld = existsSync(gaPath) ? readFileSync(gaPath, 'utf8') : '';
  pushMerge(actions, writes, '.gitattributes', gaPath, gaOld, upsertBlock(gaOld, GITATTRIBUTES_BLOCK, GITIGNORE_START, GITIGNORE_END));

  // Multi-repo: vpds.config.json is the source of truth; tool settings are synced from it.
  syncConfig(target, { repos, approval }, tools, actions, writes);

  if (!dryRun) {
    for (const [dest, content] of writes) {
      mkdirSync(dirname(dest), { recursive: true });
      writeFileSync(dest, content);
    }
    writeFileSync(manifestPath, `${JSON.stringify(next, null, 2)}\n`);
  }
  return { actions, manifest: next };
}

const readJson = (path, fallback) => (existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : fallback);
const json = (value) => `${JSON.stringify(value, null, 2)}\n`;

/** Parse `api=../api,web=../web` into { api: '../api', web: '../web' }. */
export function parseRepos(spec) {
  const repos = {};
  for (const part of (spec ?? '').split(',').map((s) => s.trim()).filter(Boolean)) {
    const [name, path] = part.split('=').map((s) => s?.trim());
    if (!name || !path || !/^[\w-]+$/.test(name)) throw new Error(`--repos: expected name=path, got "${part}"`);
    repos[name] = path.replace(/\\/g, '/');
  }
  return repos;
}

/** Claude Code asks the human before any human-only gate command (approve, finish) runs, in every approval mode. */
export const HUMAN_ONLY_ASK_RULES = ['approve', 'finish'].flatMap((c) => [`Bash(node vpds/gate.mjs ${c}:*)`, `Bash(node vpds/gate.mjs ${c} *)`]);

function syncConfig(target, { repos: newRepos, approval }, tools, actions, writes) {
  if (approval && !['terminal', 'chat'].includes(approval)) throw new Error(`--approval must be terminal or chat (got "${approval}")`);
  const configPath = join(target, 'vpds.config.json');
  const config = readJson(configPath, {});
  const repos = { ...(config.repos ?? {}), ...newRepos };
  const next = { ...config, ...(Object.keys(repos).length ? { repos } : {}), ...(approval ? { approval } : {}) };

  // vpds.config.json only exists once there is something non-default to say.
  if (Object.keys(next).length) {
    const old = existsSync(configPath) ? readFileSync(configPath, 'utf8') : '';
    pushMerge(actions, writes, 'vpds.config.json', configPath, old, json(next));
  }

  if (tools.includes('claude')) {
    // Claude Code: always ask before approving; let the session reach sibling repos.
    const settingsPath = join(target, '.claude', 'settings.json');
    const settings = readJson(settingsPath, {});
    const perms = { ...settings.permissions };
    perms.ask = [...new Set([...(perms.ask ?? []), ...HUMAN_ONLY_ASK_RULES])];
    if (Object.keys(repos).length) {
      perms.additionalDirectories = [...new Set([...(perms.additionalDirectories ?? []), ...Object.values(repos)])];
    }
    const old = existsSync(settingsPath) ? readFileSync(settingsPath, 'utf8') : '';
    pushMerge(actions, writes, '.claude/settings.json', settingsPath, old, json({ ...settings, permissions: perms }));
  }
  if (tools.includes('cursor') && Object.keys(repos).length) {
    // Cursor / VS Code: one multi-root workspace with the planning repo and every code repo.
    const wsPath = join(target, 'vpds.code-workspace');
    const ws = readJson(wsPath, { folders: [{ name: 'planning', path: '.' }] });
    const have = new Set(ws.folders.map((f) => f.path));
    for (const [name, p] of Object.entries(repos)) if (!have.has(p)) ws.folders.push({ name, path: p });
    const old = existsSync(wsPath) ? readFileSync(wsPath, 'utf8') : '';
    pushMerge(actions, writes, 'vpds.code-workspace', wsPath, old, json(ws));
  }
}

function pushMerge(actions, writes, rel, dest, oldText, newText) {
  if (normalise(oldText) === normalise(newText)) return actions.push({ path: rel, action: 'unchanged' });
  actions.push({ path: rel, action: oldText ? 'merge' : 'create' });
  writes.push([dest, newText]);
}
