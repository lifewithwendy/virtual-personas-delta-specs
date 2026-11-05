// Step 2d tests: phase gate checks.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadChange, approveChange, checkPhase } from './lib.mjs';
import { makeRepo, run } from './test-helpers.mjs';

const WHO = { by: 'wendt', date: '2026-11-05' };

/** Build a change, optionally approve everything in review, return a loader. */
function setup(files, { approve = false } = {}) {
  const repo = makeRepo({ x: files });
  if (approve) approveChange(loadChange(repo.base, 'x'), WHO);
  return { ...repo, check: (phase) => checkPhase(loadChange(repo.base, 'x'), phase) };
}
const append = (base, f, text) => {
  const p = join(base, 'x', f);
  writeFileSync(p, readFileSync(p, 'utf8') + text);
};

const MEDIUM = {
  'proposal.md': { tier: 'medium', status: 'review' },
  'design.md': { status: 'review' },
  'tasks.md': { status: 'review' },
  'specs/a/spec.md': '## ADDED Requirements\n',
};
const LARGE = { ...MEDIUM, 'proposal.md': { tier: 'large', status: 'review' }, 'ux.md': { status: 'review' } };

// ---------- design phase (Designer) ----------

test('design: allowed for a large change with a proposal', () => {
  assert.equal(setup({ 'proposal.md': { tier: 'large', status: 'review' } }).check('design').ok, true);
});

test('design: blocked for medium tier', () => {
  const r = setup({ 'proposal.md': { tier: 'medium', status: 'review' } }).check('design');
  assert.equal(r.ok, false);
  assert.match(r.reasons.join(), /only runs for large/);
});

test('design: blocked without a proposal', () => {
  const r = setup({ 'tasks.md': { tier: 'large' } }).check('design');
  assert.match(r.reasons.join(), /proposal\.md missing/);
});

// ---------- architect phase ----------

test('architect: medium only needs a proposal (gate comes after the Architect)', () => {
  assert.equal(setup({ 'proposal.md': { tier: 'medium', status: 'review' } }).check('architect').ok, true);
});

test('architect: large needs proposal and ux approved (gate 1)', () => {
  const r = setup({ 'proposal.md': { tier: 'large', status: 'review' }, 'ux.md': { status: 'review' } }).check('architect');
  assert.equal(r.ok, false);
  assert.match(r.reasons.join('\n'), /proposal\.md is "review"/);
  assert.match(r.reasons.join('\n'), /ux\.md is "review"/);
});

test('architect: large passes once gate 1 is approved', () => {
  const s = setup({ 'proposal.md': { tier: 'large', status: 'review' }, 'ux.md': { status: 'review' } }, { approve: true });
  assert.equal(s.check('architect').ok, true);
});

test('architect: small tier has no Architect phase', () => {
  assert.match(setup({ 'tasks.md': { tier: 'small' } }).check('architect').reasons.join(), /small/);
});

test('architect: an open pushback does not block (the Architect resolves it)', () => {
  assert.equal(setup({ 'proposal.md': { tier: 'medium' }, 'pushback.md': { status: 'open' } }).check('architect').ok, true);
});

// ---------- build phase (Developer) ----------

test('build: medium blocked until proposal, design and tasks are approved', () => {
  const r = setup(MEDIUM).check('build');
  assert.equal(r.ok, false);
  assert.equal(r.reasons.length, 3);
});

test('build: medium passes after approval', () => {
  assert.deepEqual(setup(MEDIUM, { approve: true }).check('build'), { ok: true, reasons: [], warnings: [] });
});

test('build: large also needs ux.md approved', () => {
  const s = setup(LARGE);
  approveChange(loadChange(s.base, 'x'), { ...WHO, files: ['proposal', 'design', 'tasks'] });
  assert.match(s.check('build').reasons.join(), /ux\.md is "review"/);
});

test('build: missing file is reported', () => {
  const s = setup({ 'proposal.md': { tier: 'medium', status: 'review' }, 'tasks.md': { status: 'review' } }, { approve: true });
  assert.match(s.check('build').reasons.join(), /design\.md missing/);
});

test('build: small tier only needs tasks.md, no approval', () => {
  assert.equal(setup({ 'tasks.md': { tier: 'small', status: 'draft' } }).check('build').ok, true);
});

test('build: blocked when an approved file is edited afterwards', () => {
  const s = setup(MEDIUM, { approve: true });
  append(s.base, 'design.md', 'sneaky edit\n');
  assert.match(s.check('build').reasons.join(), /design\.md changed after approval/);
});

test('build: blocked when specs/ change after approval', () => {
  const s = setup(MEDIUM, { approve: true });
  append(s.base, 'specs/a/spec.md', '### Requirement: new\n');
  assert.match(s.check('build').reasons.join(), /specs\/ changed after approval/);
});

test('build: ticking task checkboxes is not an edit', () => {
  const s = setup({ ...MEDIUM, 'tasks.md': '---\nstatus: review\n---\n- [ ] 1.1 Task\n' }, { approve: true });
  const p = join(s.base, 'x', 'tasks.md');
  writeFileSync(p, readFileSync(p, 'utf8').replace('- [ ]', '- [x]'));
  assert.equal(s.check('build').ok, true);
});

test('build: open pushback blocks; resolved does not', () => {
  const s = setup({ ...MEDIUM, 'pushback.md': { status: 'open' } }, { approve: true });
  assert.match(s.check('build').reasons.join(), /pushback\.md is open/);
  writeFileSync(join(s.base, 'x', 'pushback.md'), '---\nstatus: resolved\n---\n');
  assert.equal(s.check('build').ok, true);
});

test('build: hand-approved (no hash, e.g. in Obsidian) passes with a warning', () => {
  const s = setup({
    'proposal.md': { tier: 'medium', status: 'approved' },
    'design.md': { status: 'approved' },
    'tasks.md': { status: 'approved' },
  });
  const r = s.check('build');
  assert.equal(r.ok, true);
  assert.equal(r.warnings.length, 3);
  assert.match(r.warnings[0], /no hash lock/);
});

test('unknown phase throws', () => {
  assert.throws(() => setup(MEDIUM).check('deploy'), /unknown phase "deploy"/);
});

// ---------- CLI: node vpds/gate.mjs check ----------

test('CLI check exits 0 with OK when the gate is open', () => {
  const { root } = setup(MEDIUM, { approve: true });
  assert.match(run(root, 'check', 'x', 'build'), /^OK: "x" is ready for build/);
});

test('CLI check exits 1 and lists every reason when blocked', () => {
  const { root } = setup(MEDIUM);
  assert.throws(() => run(root, 'check', 'x', 'build'), (e) =>
    e.status === 1 && /BLOCKED/.test(e.stderr) && (e.stderr.match(/^ {2}- /gm) || []).length === 3);
});

test('CLI check with missing arguments prints usage', () => {
  const { root } = setup(MEDIUM);
  assert.throws(() => run(root, 'check', 'x'), (e) => e.status === 1 && /Usage:/.test(e.stderr));
});
