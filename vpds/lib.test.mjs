// Step 2a tests. Run:  node --test vpds/
// Your job: create vpds/lib.mjs and export parseDoc, setMeta, bodyHash until all pass.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDoc, setMeta, bodyHash } from './lib.mjs';

const SAMPLE = [
  '---',
  'persona: pm',
  'tier: medium        # small | medium | large',
  'status: review',
  'approved_by:',
  '---',
  '# Proposal',
  '',
  '- [ ] 1.1 Do a thing',
  '',
].join('\n');

// ---------- parseDoc(text) -> { meta, body } ----------

test('parseDoc reads frontmatter keys', () => {
  const { meta } = parseDoc(SAMPLE);
  assert.equal(meta.persona, 'pm');
  assert.equal(meta.status, 'review');
});

test('parseDoc strips trailing # comments', () => {
  assert.equal(parseDoc(SAMPLE).meta.tier, 'medium');
});

test('parseDoc turns empty values into empty strings', () => {
  assert.equal(parseDoc(SAMPLE).meta.approved_by, '');
});

test('parseDoc returns the body without the frontmatter', () => {
  assert.equal(parseDoc(SAMPLE).body, '# Proposal\n\n- [ ] 1.1 Do a thing\n');
});

test('parseDoc handles Windows line endings', () => {
  const { meta, body } = parseDoc(SAMPLE.replace(/\n/g, '\r\n'));
  assert.equal(meta.status, 'review');
  assert.equal(body, '# Proposal\n\n- [ ] 1.1 Do a thing\n');
});

test('parseDoc on a file with no frontmatter', () => {
  const { meta, body } = parseDoc('# Just a body\n');
  assert.deepEqual(meta, {});
  assert.equal(body, '# Just a body\n');
});

// ---------- setMeta(text, updates) -> new text ----------

test('setMeta replaces an existing key', () => {
  const out = setMeta(SAMPLE, { status: 'approved' });
  assert.equal(parseDoc(out).meta.status, 'approved');
});

test('setMeta fills an empty key', () => {
  const out = setMeta(SAMPLE, { approved_by: 'wendt' });
  assert.equal(parseDoc(out).meta.approved_by, 'wendt');
});

test('setMeta appends a missing key at the end of the frontmatter', () => {
  const out = setMeta(SAMPLE, { approved_hash: 'abc123' });
  assert.equal(parseDoc(out).meta.approved_hash, 'abc123');
  assert.match(out, /approved_by:\napproved_hash: abc123\n---/);
});

test('setMeta keeps other keys, their order, and the body untouched', () => {
  const out = setMeta(SAMPLE, { status: 'approved' });
  const keys = Object.keys(parseDoc(out).meta);
  assert.deepEqual(keys, ['persona', 'tier', 'status', 'approved_by']);
  assert.equal(parseDoc(out).body, parseDoc(SAMPLE).body);
});

test('setMeta adds frontmatter to a file that has none', () => {
  const out = setMeta('# Body\n', { status: 'review' });
  assert.equal(out, '---\nstatus: review\n---\n# Body\n');
});

// ---------- bodyHash(body) -> 12 hex chars ----------

test('bodyHash is 12 lowercase hex characters', () => {
  assert.match(bodyHash('hello'), /^[0-9a-f]{12}$/);
});

test('bodyHash ignores ticked checkboxes (the Developer ticks tasks)', () => {
  assert.equal(bodyHash('- [ ] 1.1 Task\n'), bodyHash('- [x] 1.1 Task\n'));
  assert.equal(bodyHash('- [ ] 1.1 Task\n'), bodyHash('- [X] 1.1 Task\n'));
});

test('bodyHash ignores surrounding whitespace and line-ending style', () => {
  assert.equal(bodyHash('# A\nB\n'), bodyHash('\n# A\r\nB\r\n\n'));
});

test('bodyHash changes when any word changes', () => {
  assert.notEqual(bodyHash('- [ ] 1.1 Task'), bodyHash('- [ ] 1.1 Tasks'));
});
