// Step 2c tests: human approval.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadChange, approveChange, bodyHash, specsHash, parseDoc } from './lib.mjs';
import { makeRepo, run } from './test-helpers.mjs';

const WHO = { by: 'wendt', date: '2026-11-05' };
const read = (base, id, f) => parseDoc(readFileSync(join(base, id, f), 'utf8'));

// ---------- approveChange(change, { by, date, files? }) ----------

test('approves every file in review by default and returns their names', () => {
  const { base } = makeRepo({ x: {
    'proposal.md': { status: 'review' }, 'design.md': { status: 'review' }, 'tasks.md': { status: 'draft' },
  } });
  const approved = approveChange(loadChange(base, 'x'), WHO);
  assert.deepEqual(approved, ['proposal.md', 'design.md']);
  assert.equal(read(base, 'x', 'tasks.md').meta.status, 'draft');
});

test('writes status, approved_by, approved_at and approved_hash', () => {
  const { base } = makeRepo({ x: { 'proposal.md': { status: 'review' } } });
  approveChange(loadChange(base, 'x'), WHO);
  const { meta, body } = read(base, 'x', 'proposal.md');
  assert.equal(meta.status, 'approved');
  assert.equal(meta.approved_by, 'wendt');
  assert.equal(meta.approved_at, '2026-11-05');
  assert.equal(meta.approved_hash, bodyHash(body));
});

test('leaves the body byte-for-byte unchanged', () => {
  const { base } = makeRepo({ x: { 'proposal.md': '---\nstatus: review\n---\n# P\n\n- [ ] keep me\n' } });
  approveChange(loadChange(base, 'x'), WHO);
  assert.equal(read(base, 'x', 'proposal.md').body, '# P\n\n- [ ] keep me\n');
});

test('design.md approval also locks specs/ with specs_hash', () => {
  const { base } = makeRepo({ x: {
    'design.md': { status: 'review' },
    'specs/billing/spec.md': '## ADDED Requirements\n',
  } });
  approveChange(loadChange(base, 'x'), WHO);
  assert.equal(read(base, 'x', 'design.md').meta.specs_hash, specsHash(join(base, 'x')));
});

test('specsHash changes when any spec file changes', () => {
  const { base } = makeRepo({ x: { 'specs/a/spec.md': 'one\n' } });
  const before = specsHash(join(base, 'x'));
  writeFileSync(join(base, 'x', 'specs/a/spec.md'), 'two\n');
  assert.notEqual(specsHash(join(base, 'x')), before);
});

test('explicit files are approved whatever their status, with or without .md', () => {
  const { base } = makeRepo({ x: { 'proposal.md': { status: 'draft' }, 'ux.md': { status: 'review' } } });
  assert.deepEqual(approveChange(loadChange(base, 'x'), { ...WHO, files: ['proposal'] }), ['proposal.md']);
  assert.equal(read(base, 'x', 'ux.md').meta.status, 'review');
});

test('explicit re-approval re-locks the hash after an edit', () => {
  const { base } = makeRepo({ x: { 'design.md': { status: 'review' } } });
  approveChange(loadChange(base, 'x'), WHO);
  const p = join(base, 'x', 'design.md');
  writeFileSync(p, readFileSync(p, 'utf8') + 'edited\n');
  approveChange(loadChange(base, 'x'), { ...WHO, files: ['design.md'] });
  const { meta, body } = read(base, 'x', 'design.md');
  assert.equal(meta.approved_hash, bodyHash(body));
});

test('throws when nothing is in review', () => {
  const { base } = makeRepo({ x: { 'proposal.md': { status: 'draft' } } });
  assert.throws(() => approveChange(loadChange(base, 'x'), WHO), /nothing in review/);
});

test('throws for an unknown or missing phase file', () => {
  const { base } = makeRepo({ x: { 'proposal.md': { status: 'review' } } });
  assert.throws(() => approveChange(loadChange(base, 'x'), { ...WHO, files: ['design'] }), /design\.md not found/);
  assert.throws(() => approveChange(loadChange(base, 'x'), { ...WHO, files: ['notes'] }), /not a phase file/);
});

test('never touches pushback.md', () => {
  const { base } = makeRepo({ x: { 'design.md': { status: 'review' }, 'pushback.md': { status: 'open' } } });
  approveChange(loadChange(base, 'x'), WHO);
  assert.equal(read(base, 'x', 'pushback.md').meta.status, 'open');
});

// ---------- CLI: node vpds/gate.mjs approve ----------

test('CLI approve refuses when not run from an interactive terminal (e.g. by an AI)', () => {
  const { root, base } = makeRepo({ x: { 'proposal.md': { status: 'review' } } });
  assert.throws(() => run(root, 'approve', 'x'), (e) => e.status === 1 && /interactive terminal/.test(e.stderr));
  assert.equal(read(base, 'x', 'proposal.md').meta.status, 'review');
});

test('CLI approve without an id prints usage', () => {
  const { root } = makeRepo({});
  assert.throws(() => run(root, 'approve'), (e) => e.status === 1 && /Usage:/.test(e.stderr));
});
