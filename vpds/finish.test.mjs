// finish: merge feat/<id> into main in every repo the change touched, then archive.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync, execSync } from 'node:child_process';
import { loadChange, approveChange, git } from './lib.mjs';
import { GATE, fm } from './test-helpers.mjs';

const ENV = {
  ...process.env, OPENSPEC_TELEMETRY: '0',
  GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t',
};
Object.assign(process.env, ENV); // git() in lib inherits these
let hasOpenspec = true;
try { execSync('openspec --version', { stdio: 'ignore', env: ENV }); } catch { hasOpenspec = false; }
const needsOpenspec = hasOpenspec ? false : 'openspec CLI not installed';

const gate = (cwd, ...args) => execFileSync(process.execPath, [GATE, ...args], { cwd, env: ENV, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
const gitInit = (dir) => { mkdirSync(dir, { recursive: true }); git(dir, ['init', '-q', '-b', 'main']); };
const commitAll = (dir, msg) => { git(dir, ['add', '-A']); git(dir, ['commit', '-q', '--allow-empty', '-m', msg]); };

const TASKS = (lines) => `---\nstatus: review\n---\n# Tasks\n\n## 1. Work\n\n${lines.join('\n')}\n`;
const SPEC = '# Spec Delta\n\n## Purpose\n\nLets users export invoices as CSV files for their accountant.\n\n## ADDED Requirements\n\n' +
  '### Requirement: Export\nThe system SHALL export invoices as CSV.\n\n#### Scenario: Export\n- **WHEN** the user exports\n- **THEN** a CSV is returned\n';

/**
 * Workspace with a planning repo (and code repos when `repos` is given), an approved change `x`,
 * and a feat/x branch with one commit in each code repo.
 */
function workspace({ repos = ['api', 'web'], tasks, chat = true } = {}) {
  const ws = mkdtempSync(join(tmpdir(), 'vpds-finish-'));
  const planning = join(ws, 'planning');
  gitInit(planning);
  mkdirSync(join(planning, 'openspec', 'specs'), { recursive: true });
  mkdirSync(join(planning, 'openspec', 'changes', 'archive'), { recursive: true });
  writeFileSync(join(planning, 'openspec', 'config.yaml'), 'schema: spec-driven\n');
  const config = { approval: chat ? 'chat' : 'terminal' };
  if (repos.length) config.repos = Object.fromEntries(repos.map((r) => [r, `../${r}`]));
  writeFileSync(join(planning, 'vpds.config.json'), JSON.stringify(config));

  const dir = join(planning, 'openspec', 'changes', 'x');
  mkdirSync(join(dir, 'specs', 'export'), { recursive: true });
  writeFileSync(join(dir, '.openspec.yaml'), 'schema: spec-driven\n');
  writeFileSync(join(dir, 'proposal.md'), fm({ tier: 'medium', status: 'review' }, '# Proposal\n\n## Why\nAccountants need CSV exports of invoices.\n\n## What Changes\n- CSV export\n'));
  writeFileSync(join(dir, 'design.md'), fm({ status: 'review' }));
  writeFileSync(join(dir, 'specs', 'export', 'spec.md'), SPEC);
  const tag = (r) => (repos.length ? `[${r}] ` : '');
  writeFileSync(join(dir, 'tasks.md'), TASKS(tasks ?? (repos.length ? repos : ['code']).map((r, i) => `- [x] 1.${i + 1} ${tag(r)}Task`)));
  approveChange(loadChange(join(planning, 'openspec', 'changes'), 'x'), { by: 't', date: '2026-01-01' });

  const codeDirs = repos.length ? repos.map((r) => join(ws, r)) : [planning];
  commitAll(planning, 'planning');
  for (const d of codeDirs) {
    if (d !== planning) { gitInit(d); writeFileSync(join(d, 'README.md'), 'x\n'); commitAll(d, 'init'); }
    git(d, ['checkout', '-q', '-b', 'feat/x']);
    writeFileSync(join(d, 'feature.txt'), 'feature\n');
    commitAll(d, 'x 1.1: feature');
    git(d, ['checkout', '-q', 'main']);
  }
  return { ws, planning, codeDirs };
}
const blocked = (cwd, args, pattern) =>
  assert.throws(() => gate(cwd, 'finish', 'x', ...args), (e) => e.status === 1 && pattern.test(e.stderr));

// ---------- refusals (nothing changes) ----------

test('terminal mode: finish from an AI tool is refused', () => {
  const { planning } = workspace({ chat: false });
  blocked(planning, ['--yes'], /finish must be run by a human in an interactive terminal/);
});

test('blocked when a task is not ticked', () => {
  const { planning, codeDirs } = workspace({ tasks: ['- [x] 1.1 [api] a', '- [ ] 1.2 [web] b'] });
  blocked(planning, ['--yes'], /1 task\(s\) not ticked: 1\.2/);
  assert.ok(!existsSync(join(codeDirs[0], 'feature.txt')), 'api untouched');
});

test('blocked when a repo has uncommitted changes', () => {
  const { planning, codeDirs } = workspace();
  writeFileSync(join(codeDirs[1], 'wip.txt'), 'wip\n');
  blocked(planning, ['--yes'], /web: uncommitted changes/);
});

test('blocked when the feature branch is missing', () => {
  const { planning, codeDirs } = workspace();
  git(codeDirs[0], ['branch', '-D', 'feat/x']);
  blocked(planning, ['--yes'], /api: branch feat\/x not found/);
});

test('blocked when an approved file changed', () => {
  const { planning } = workspace();
  const p = join(planning, 'openspec/changes/x/design.md');
  writeFileSync(p, `${readFileSync(p, 'utf8')}edit\n`);
  commitAll(planning, 'edit');
  blocked(planning, ['--yes'], /design\.md changed after approval/);
});

test('--dry-run lists the plan and changes nothing', { skip: needsOpenspec }, () => {
  const { planning, codeDirs } = workspace();
  const out = gate(planning, 'finish', 'x', '--yes', '--dry-run');
  assert.match(out, /api: merge feat\/x into main \(1 commit\)/);
  assert.match(out, /web: merge feat\/x into main \(1 commit\)/);
  assert.match(out, /Dry run/);
  assert.ok(!existsSync(join(codeDirs[0], 'feature.txt')));
  assert.ok(existsSync(join(planning, 'openspec/changes/x')));
});

// ---------- the real thing ----------

test('multi-repo: merges every touched repo, archives, commits planning', { skip: needsOpenspec }, () => {
  const { planning, codeDirs } = workspace();
  const out = gate(planning, 'finish', 'x', '--yes');
  assert.match(out, /Done: "x" merged and archived/);
  for (const d of codeDirs) {
    assert.equal(git(d, ['branch', '--show-current']), 'main');
    assert.ok(existsSync(join(d, 'feature.txt')));
    assert.match(git(d, ['log', '-1', '--format=%s']), /^Merge feat\/x \(x\)$/);
  }
  assert.ok(!existsSync(join(planning, 'openspec/changes/x')));
  assert.ok(existsSync(join(planning, 'openspec/specs/export/spec.md')));
  assert.equal(git(planning, ['log', '-1', '--format=%s']), 'archive x');
  assert.equal(git(planning, ['status', '--porcelain']), '');
});

test('only repos tagged in tasks.md are merged', { skip: needsOpenspec }, () => {
  const { planning, codeDirs } = workspace({ tasks: ['- [x] 1.1 [api] only api'] });
  gate(planning, 'finish', 'x', '--yes');
  assert.ok(existsSync(join(codeDirs[0], 'feature.txt')));
  assert.ok(!existsSync(join(codeDirs[1], 'feature.txt')), 'web not merged');
});

test('single repo: merges feat/x into main in the same repo, then archives', { skip: needsOpenspec }, () => {
  const { planning } = workspace({ repos: [] });
  gate(planning, 'finish', 'x', '--yes');
  assert.equal(git(planning, ['branch', '--show-current']), 'main');
  assert.ok(existsSync(join(planning, 'feature.txt')));
  assert.ok(!existsSync(join(planning, 'openspec/changes/x')));
  assert.equal(git(planning, ['log', '-1', '--format=%s']), 'archive x');
});

test('merge conflict: aborts cleanly, archives nothing, and a rerun skips repos already merged', { skip: needsOpenspec }, () => {
  const { planning, codeDirs } = workspace();
  const [api, web] = codeDirs;
  writeFileSync(join(web, 'feature.txt'), 'conflicting main\n');
  commitAll(web, 'conflict on main');

  blocked(planning, ['--yes'], /web: merge conflict, merge aborted/);
  assert.ok(existsSync(join(api, 'feature.txt')), 'api was merged before the conflict');
  assert.equal(git(web, ['status', '--porcelain']), '', 'web left clean');
  assert.ok(existsSync(join(planning, 'openspec/changes/x')), 'not archived');

  // Resolve by hand, then finish again.
  git(web, ['checkout', '-q', 'feat/x']);
  execSync('git merge -q main -X ours -m resolve', { cwd: web, env: ENV, stdio: 'ignore' });
  git(web, ['checkout', '-q', 'main']);
  const out = gate(planning, 'finish', 'x', '--yes');
  assert.match(out, /api: feat\/x is already in main, skip/);
  assert.match(out, /Done/);
});
