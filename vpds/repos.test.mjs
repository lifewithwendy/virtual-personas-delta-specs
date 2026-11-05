// Single- vs multi-repo projects: config, task repo tags, gate checks.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { loadConfig, isMultiRepo, parseTasks, changeRepos, loadChange, approveChange, checkPhase, formatStatus } from './lib.mjs';
import { makeRepo, run } from './test-helpers.mjs';

const TASKS = (lines) => `---\nstatus: review\n---\n# Tasks\n\n## 1. Work\n\n${lines.join('\n')}\n`;
const WHO = { by: 'wendt', date: '2026-11-05' };

/** Planning repo with an approved medium change whose tasks are `lines`, plus sibling code repos. */
function planning(lines, { repos = { api: '../api', web: '../web' }, create = ['api', 'web'] } = {}) {
  const { root, base } = makeRepo({ x: {
    'proposal.md': { tier: 'medium', status: 'review' },
    'design.md': { status: 'review' },
    'tasks.md': TASKS(lines),
  } });
  approveChange(loadChange(base, 'x'), WHO);
  writeFileSync(join(root, 'vpds.config.json'), JSON.stringify({ repos }));
  for (const r of create) mkdirSync(join(root, '..', r), { recursive: true });
  const config = loadConfig(root);
  return { root, base, config, check: () => checkPhase(loadChange(base, 'x'), 'build', { config, root }) };
}

// ---------- config ----------

test('no config file means single-repo', () => {
  const { root } = makeRepo({});
  assert.deepEqual(loadConfig(root), { repos: {} });
  assert.equal(isMultiRepo(loadConfig(root)), false);
});

test('config with repos means multi-repo', () => {
  const { root } = makeRepo({});
  writeFileSync(join(root, 'vpds.config.json'), '{"repos":{"api":"../api"}}');
  assert.equal(isMultiRepo(loadConfig(root)), true);
});

test('invalid config is reported clearly', () => {
  const { root } = makeRepo({});
  writeFileSync(join(root, 'vpds.config.json'), '{ nope');
  assert.throws(() => loadConfig(root), /not valid JSON/);
  writeFileSync(join(root, 'vpds.config.json'), '{"repos":{"bad name":"../x"}}');
  assert.throws(() => loadConfig(root), /repo name "bad name"/);
});

// ---------- parseTasks ----------

test('parseTasks reads id, repo tag, text and done state', () => {
  assert.deepEqual(parseTasks('- [ ] 1.1 [api] Test: export\n- [x] 1.2 Implement it\n* [X] [web] no id\n'), [
    { id: '1.1', repo: 'api', text: 'Test: export', done: false },
    { id: '1.2', repo: null, text: 'Implement it', done: true },
    { id: null, repo: 'web', text: 'no id', done: true },
  ]);
});

test('changeRepos lists the repos a change touches', () => {
  const { base } = makeRepo({ x: { 'tasks.md': TASKS(['- [ ] 1.1 [web] a', '- [ ] 1.2 [api] b', '- [ ] 1.3 [api] c']) } });
  assert.deepEqual(changeRepos(loadChange(base, 'x')), ['api', 'web']);
});

// ---------- gate: build check ----------

test('single-repo: untagged tasks are fine', () => {
  const { base } = makeRepo({ x: {
    'proposal.md': { tier: 'medium', status: 'review' }, 'design.md': { status: 'review' },
    'tasks.md': TASKS(['- [ ] 1.1 Test: thing']),
  } });
  approveChange(loadChange(base, 'x'), WHO);
  assert.equal(checkPhase(loadChange(base, 'x'), 'build').ok, true);
});

test('multi-repo: tagged tasks for existing repos pass', () => {
  assert.equal(planning(['- [ ] 1.1 [api] Test: a', '- [ ] 1.2 [web] Test: b']).check().ok, true);
});

test('multi-repo: an untagged task blocks the build', () => {
  const r = planning(['- [ ] 1.1 [api] Test: a', '- [ ] 1.2 Implement b']).check();
  assert.equal(r.ok, false);
  assert.match(r.reasons.join(), /task 1\.2 has no \[repo\] tag \(known repos: api, web\)/);
});

test('multi-repo: an unknown repo tag blocks the build', () => {
  assert.match(planning(['- [ ] 1.1 [mobile] Test: a']).check().reasons.join(), /unknown repo \[mobile\]/);
});

test('multi-repo: a repo missing on disk blocks the build', () => {
  const r = planning(['- [ ] 1.1 [api] Test: a'], { repos: { api: '../no-such-api-repo' }, create: [] }).check();
  assert.match(r.reasons.join(), /repo "api" not found at \.\.\/no-such-api-repo/);
});

test('status shows the repos a change touches', () => {
  const { base } = planning(['- [ ] 1.1 [web] a', '- [ ] 1.2 [api] b']);
  assert.match(formatStatus(loadChange(base, 'x')), /^x {2}\[medium\] {2}\{api,web\} {2}proposal:approved/);
});

// ---------- CLI ----------

test('CLI repos: single-repo message without config', () => {
  const { root } = makeRepo({});
  assert.match(run(root, 'repos'), /^Single-repo project/);
});

test('CLI repos: lists each repo and whether it exists', () => {
  const { root } = planning(['- [ ] 1.1 [api] a'], { repos: { api: '../api', gone: '../definitely-missing-repo' }, create: ['api'] });
  const out = run(root, 'repos');
  assert.match(out, /^Multi-repo project/);
  assert.match(out, /api {3}\.\.\/api {23}(ok \(not a git repo\)|branch )/);
  assert.match(out, /gone {2}\.\.\/definitely-missing-repo {2}MISSING/);
});

test('CLI check uses vpds.config.json from the project root', () => {
  const { root } = planning(['- [ ] 1.1 Test: untagged']);
  assert.throws(() => run(root, 'check', 'x', 'build'), (e) => e.status === 1 && /no \[repo\] tag/.test(e.stderr));
});
