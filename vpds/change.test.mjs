// Step 2b tests: loading change folders and the `status` command.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { listChanges, loadChange, formatStatus } from './lib.mjs';
import { makeRepo, run } from './test-helpers.mjs';

// ---------- listChanges(changesDir) ----------

test('listChanges returns change ids sorted, excluding archive', () => {
  const { base } = makeRepo({ 'b-change': {}, 'a-change': {} });
  assert.deepEqual(listChanges(base), ['a-change', 'b-change']);
});

test('listChanges ignores plain files in the changes folder', () => {
  const { base } = makeRepo({ 'a-change': {} });
  writeFileSync(join(base, 'README.md'), 'x');
  assert.deepEqual(listChanges(base), ['a-change']);
});

test('listChanges returns [] when the folder does not exist', () => {
  assert.deepEqual(listChanges(join(tmpdir(), 'no-such-dir-vpds')), []);
});

// ---------- loadChange(changesDir, id) ----------

test('loadChange reads only the phase files that exist', () => {
  const { base } = makeRepo({ x: { 'proposal.md': { status: 'review' }, 'notes.md': {} } });
  const c = loadChange(base, 'x');
  assert.deepEqual(Object.keys(c.files), ['proposal.md']);
  assert.equal(c.files['proposal.md'].meta.status, 'review');
  assert.ok(c.files['proposal.md'].path.endsWith('proposal.md'));
});

test('loadChange takes tier from proposal.md first', () => {
  const { base } = makeRepo({ x: { 'proposal.md': { tier: 'large' }, 'tasks.md': { tier: 'small' } } });
  assert.equal(loadChange(base, 'x').tier, 'large');
});

test('loadChange falls back to tasks.md tier (small tier has no proposal)', () => {
  const { base } = makeRepo({ x: { 'tasks.md': { tier: 'small' } } });
  assert.equal(loadChange(base, 'x').tier, 'small');
});

test('loadChange defaults tier to medium', () => {
  const { base } = makeRepo({ x: { 'proposal.md': {} } });
  assert.equal(loadChange(base, 'x').tier, 'medium');
});

test('loadChange loads pushback.md separately', () => {
  const { base } = makeRepo({ x: { 'pushback.md': { status: 'open' } } });
  const c = loadChange(base, 'x');
  assert.equal(c.pushback.meta.status, 'open');
  assert.equal(c.files['pushback.md'], undefined);
});

test('loadChange throws a clear error for an unknown change', () => {
  const { base } = makeRepo({});
  assert.throws(() => loadChange(base, 'nope'), /change "nope" not found/);
});

// ---------- formatStatus(change) ----------

test('formatStatus shows id, tier and each existing file status', () => {
  const { base } = makeRepo({ 'add-x': { 'proposal.md': { tier: 'medium', status: 'approved' }, 'design.md': { status: 'review' } } });
  assert.equal(formatStatus(loadChange(base, 'add-x')), 'add-x  [medium]  proposal:approved  design:review');
});

test('formatStatus marks missing status as draft and flags open pushback', () => {
  const { base } = makeRepo({ y: { 'tasks.md': { tier: 'small' }, 'pushback.md': { status: 'open' } } });
  assert.equal(formatStatus(loadChange(base, 'y')), 'y  [small]  tasks:draft  PUSHBACK:open');
});

// ---------- CLI: node vpds/gate.mjs status ----------

test('CLI status prints one line per change', () => {
  const { root } = makeRepo({ a: { 'proposal.md': { status: 'review' } }, b: { 'tasks.md': { tier: 'small' } } });
  assert.equal(run(root, 'status'), 'a  [medium]  proposal:review\nb  [small]  tasks:draft\n');
});

test('CLI status with no changes says so', () => {
  const { root } = makeRepo({});
  assert.equal(run(root, 'status'), 'No open changes.\n');
});

test('CLI unknown command prints usage and exits 1', () => {
  const { root } = makeRepo({});
  assert.throws(() => run(root, 'bogus'), (e) => e.status === 1 && /Usage:/.test(e.stderr));
});
