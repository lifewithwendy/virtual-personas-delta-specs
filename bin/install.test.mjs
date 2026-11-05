// Installer tests: init, update, merges, and never overwriting your edits.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { install, kitFiles, upsertBlock, hash, MANIFEST, KIT_ROOT } from './install.mjs';

const project = () => mkdtempSync(join(tmpdir(), 'vpds-install-'));
const read = (dir, rel) => readFileSync(join(dir, rel), 'utf8');
const byPath = (actions) => Object.fromEntries(actions.map((a) => [a.path, a.action]));
const CLI = resolve(import.meta.dirname, 'vpds.mjs');

// ---------- kitFiles ----------

test('kit includes personas, gate scripts, templates and both tools by default', () => {
  const files = kitFiles();
  for (const f of ['vpds/personas/pm.md', 'vpds/gate.mjs', 'vpds/lib.mjs', 'openspec/_templates/tpl-proposal.md',
    '.claude/commands/vp/build.md', '.cursor/commands/vp-build.md', 'openspec/changes.base']) {
    assert.ok(files.includes(f), f);
  }
});

test('kit never includes tests, OpenSpec\'s own commands, or package.json', () => {
  const files = kitFiles().join('\n');
  assert.doesNotMatch(files, /\.test\.mjs|test-helpers|opsx|package\.json/);
});

test('kit respects --tools and --no-obsidian', () => {
  const files = kitFiles({ tools: ['cursor'], obsidian: false });
  assert.ok(!files.some((f) => f.startsWith('.claude/')));
  assert.ok(files.some((f) => f.startsWith('.cursor/')));
  assert.ok(!files.includes('openspec/changes.base'));
});

// ---------- upsertBlock ----------

test('upsertBlock appends a block to existing text, then replaces it in place', () => {
  const once = upsertBlock('# Mine\n', 'v1', '<s>', '<e>');
  assert.equal(once, '# Mine\n\n<s>\nv1\n<e>\n');
  const twice = upsertBlock(`${once}after\n`, 'v2', '<s>', '<e>');
  assert.equal(twice, '# Mine\n\n<s>\nv2\n<e>\nafter\n');
});

// ---------- init ----------

test('init copies the kit into an empty project and writes a manifest', () => {
  const dir = project();
  install(dir, { mode: 'init' });
  for (const f of kitFiles()) assert.ok(existsSync(join(dir, f)), f);
  const m = JSON.parse(read(dir, MANIFEST));
  assert.equal(Object.keys(m.files).length, kitFiles().length);
  assert.deepEqual(m.tools, ['claude', 'cursor']);
});

test('init creates AGENTS.md with a managed block and CLAUDE.md importing it', () => {
  const dir = project();
  install(dir, { mode: 'init' });
  assert.match(read(dir, 'AGENTS.md'), /vpds:start[\s\S]*Virtual Personas over Delta Specs[\s\S]*vpds:end/);
  assert.equal(read(dir, 'CLAUDE.md'), '@AGENTS.md\n');
});

test('init keeps your existing AGENTS.md, CLAUDE.md and .gitignore content', () => {
  const dir = project();
  writeFileSync(join(dir, 'AGENTS.md'), '# My project rules\nUse pnpm.\n');
  writeFileSync(join(dir, 'CLAUDE.md'), 'Be terse.\n');
  writeFileSync(join(dir, '.gitignore'), 'dist/\n');
  const { actions } = install(dir, { mode: 'init' });
  assert.equal(byPath(actions)['AGENTS.md'], 'merge');
  assert.match(read(dir, 'AGENTS.md'), /^# My project rules\nUse pnpm\.\n\n<!-- vpds:start/);
  assert.equal(read(dir, 'CLAUDE.md'), '@AGENTS.md\n\nBe terse.\n');
  assert.match(read(dir, '.gitignore'), /^dist\/\n\n# vpds:start\n.*workspace/s);
});

test('init does not add @AGENTS.md twice', () => {
  const dir = project();
  writeFileSync(join(dir, 'CLAUDE.md'), '@AGENTS.md\nmore\n');
  install(dir, { mode: 'init' });
  assert.equal(read(dir, 'CLAUDE.md'), '@AGENTS.md\nmore\n');
});

test('init skips a kit file that already exists with different content', () => {
  const dir = project();
  mkdirSync(join(dir, 'vpds/personas'), { recursive: true });
  writeFileSync(join(dir, 'vpds/personas/pm.md'), 'my own PM\n');
  const { actions } = install(dir, { mode: 'init' });
  assert.equal(byPath(actions)['vpds/personas/pm.md'], 'skip');
  assert.equal(read(dir, 'vpds/personas/pm.md'), 'my own PM\n');
});

test('init --force replaces existing files', () => {
  const dir = project();
  mkdirSync(join(dir, 'vpds/personas'), { recursive: true });
  writeFileSync(join(dir, 'vpds/personas/pm.md'), 'my own PM\n');
  install(dir, { mode: 'init', force: true });
  assert.equal(read(dir, 'vpds/personas/pm.md'), read(KIT_ROOT, 'vpds/personas/pm.md'));
});

test('init --dry-run writes nothing', () => {
  const dir = project();
  const { actions } = install(dir, { mode: 'init', dryRun: true });
  assert.ok(actions.length > 0);
  assert.ok(!existsSync(join(dir, MANIFEST)));
  assert.ok(!existsSync(join(dir, 'AGENTS.md')));
});

test('init twice is refused', () => {
  const dir = project();
  install(dir, { mode: 'init' });
  assert.throws(() => install(dir, { mode: 'init' }), /already installed/);
});

// ---------- update ----------

test('update without init is refused', () => {
  assert.throws(() => install(project(), { mode: 'update' }), /not installed/);
});

test('update on an untouched install changes nothing', () => {
  const dir = project();
  install(dir, { mode: 'init' });
  const { actions } = install(dir, { mode: 'update' });
  assert.deepEqual([...new Set(actions.map((a) => a.action))], ['unchanged']);
});

test('update replaces a file you have not edited when the kit changed', () => {
  const dir = project();
  install(dir, { mode: 'init' });
  // Simulate an older installed version: file content and manifest hash agree, but differ from the kit.
  const m = JSON.parse(read(dir, MANIFEST));
  writeFileSync(join(dir, 'vpds/personas/pm.md'), 'old kit version\n');
  m.files['vpds/personas/pm.md'] = hash('old kit version\n');
  writeFileSync(join(dir, MANIFEST), JSON.stringify(m));
  const { actions } = install(dir, { mode: 'update' });
  assert.equal(byPath(actions)['vpds/personas/pm.md'], 'update');
  assert.equal(read(dir, 'vpds/personas/pm.md'), read(KIT_ROOT, 'vpds/personas/pm.md'));
});

test('update never overwrites a file you edited, and keeps tracking it', () => {
  const dir = project();
  install(dir, { mode: 'init' });
  writeFileSync(join(dir, 'vpds/personas/pm.md'), 'customised PM\n');
  const { actions } = install(dir, { mode: 'update' });
  assert.equal(byPath(actions)['vpds/personas/pm.md'], 'skip');
  assert.equal(read(dir, 'vpds/personas/pm.md'), 'customised PM\n');
  assert.ok(JSON.parse(read(dir, MANIFEST)).files['vpds/personas/pm.md']);
});

test('update treats Windows line endings as unchanged', () => {
  const dir = project();
  install(dir, { mode: 'init' });
  const p = join(dir, 'vpds/personas/pm.md');
  writeFileSync(p, readFileSync(p, 'utf8').replace(/\n/g, '\r\n'));
  assert.equal(byPath(install(dir, { mode: 'update' }).actions)['vpds/personas/pm.md'], 'unchanged');
});

test('update refreshes the AGENTS.md block but keeps your text around it', () => {
  const dir = project();
  install(dir, { mode: 'init' });
  const p = join(dir, 'AGENTS.md');
  const edited = readFileSync(p, 'utf8').replace('Virtual Personas over Delta Specs', 'STALE');
  writeFileSync(p, `# Mine\n\n${edited}\n## After\n`);
  install(dir, { mode: 'update' });
  const text = read(dir, 'AGENTS.md');
  assert.match(text, /^# Mine\n/);
  assert.match(text, /## After\n$/);
  assert.doesNotMatch(text, /STALE/);
  assert.equal((text.match(/vpds:start/g) || []).length, 1);
});

test('update never touches specs or changes', () => {
  const dir = project();
  install(dir, { mode: 'init' });
  mkdirSync(join(dir, 'openspec/changes/my-change'), { recursive: true });
  writeFileSync(join(dir, 'openspec/changes/my-change/proposal.md'), 'mine\n');
  const { actions } = install(dir, { mode: 'update', force: true });
  assert.ok(!actions.some((a) => a.path.startsWith('openspec/changes/') || a.path.startsWith('openspec/specs/')));
  assert.equal(read(dir, 'openspec/changes/my-change/proposal.md'), 'mine\n');
});

test('update keeps the tools chosen at init', () => {
  const dir = project();
  install(dir, { mode: 'init', tools: ['claude'] });
  install(dir, { mode: 'update' });
  assert.ok(!existsSync(join(dir, '.cursor')));
});

// ---------- CLI ----------

test('CLI init --no-openspec installs and the gate works in the new project', () => {
  const dir = project();
  const out = execFileSync(process.execPath, [CLI, 'init', dir, '--no-openspec'], { encoding: 'utf8' });
  assert.match(out, /VPDS \d+\.\d+\.\d+ installed/);
  assert.equal(execFileSync(process.execPath, ['vpds/gate.mjs', 'status'], { cwd: dir, encoding: 'utf8' }), 'No open changes.\n');
});

test('CLI with no command prints usage and exits 1', () => {
  assert.throws(() => execFileSync(process.execPath, [CLI], { stdio: 'pipe' }), (e) => e.status === 1 && /Usage:/.test(e.stderr));
});
