// End-to-end: real OpenSpec CLI + templates + gate, for each tier.
// Skipped automatically when `openspec` isn't installed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, cpSync, readFileSync, writeFileSync, appendFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execSync } from 'node:child_process';
import { loadChange, approveChange } from './lib.mjs';
import { run } from './test-helpers.mjs';

const REPO = resolve(import.meta.dirname, '..');
const env = { ...process.env, OPENSPEC_TELEMETRY: '0' };
const sh = (cwd, cmd) => execSync(cmd, { cwd, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

let hasOpenspec = true;
try { sh(REPO, 'openspec --version'); } catch { hasOpenspec = false; }
const skip = hasOpenspec ? false : 'openspec CLI not installed (npm i -g @fission-ai/openspec)';

function project() {
  const root = mkdtempSync(join(tmpdir(), 'vpds-e2e-'));
  mkdirSync(join(root, 'openspec', 'specs'), { recursive: true });
  mkdirSync(join(root, 'openspec', 'changes', 'archive'), { recursive: true });
  writeFileSync(join(root, 'openspec', 'config.yaml'), 'schema: spec-driven\n');
  cpSync(join(REPO, 'openspec', '_templates'), join(root, 'openspec', '_templates'), { recursive: true });
  return root;
}

/** Fill a template the way a persona would: set status, replace placeholders. */
function fromTemplate(root, tpl, dest, replacements = {}) {
  let text = readFileSync(join(root, 'openspec', '_templates', tpl), 'utf8').replace(/^status: draft$/m, 'status: review');
  for (const [a, b] of Object.entries(replacements)) text = text.replace(a, b);
  mkdirSync(resolve(dest, '..'), { recursive: true });
  writeFileSync(dest, text);
}

const SPEC = {
  'Requirement name': 'Invoice CSV export',
  'The system SHALL …': 'The system SHALL export invoices in a date range as CSV.',
  'Scenario name': 'Date range export',
  '**WHEN** …': '**WHEN** the user exports March',
  '**THEN** …': '**THEN** the CSV contains only March invoices',
  '<!-- NEW capability only: 1–2 sentences (50+ chars). Delete this section for an existing capability. -->':
    'Lets users take invoice data out of the product as CSV files.',
};
const PROPOSAL = { '`capability-name`: what it covers': '`invoice-export`: export invoices as CSV', '- `existing-capability`: which requirement changes\n': '' };

function architect(root, dir) {
  fromTemplate(root, 'tpl-design.md', join(dir, 'design.md'));
  fromTemplate(root, 'tpl-tasks.md', join(dir, 'tasks.md'));
  fromTemplate(root, 'tpl-spec.md', join(dir, 'specs', 'invoice-export', 'spec.md'), SPEC);
}

test('medium tier: PM → Architect → approve → build → archive', { skip }, () => {
  const root = project();
  const base = join(root, 'openspec', 'changes');
  const dir = join(base, 'add-invoice-export');
  sh(root, 'openspec new change add-invoice-export');

  fromTemplate(root, 'tpl-proposal.md', join(dir, 'proposal.md'), PROPOSAL);
  assert.match(run(root, 'check', 'add-invoice-export', 'architect'), /^OK/);
  architect(root, dir);
  sh(root, 'openspec validate add-invoice-export --strict');

  assert.throws(() => run(root, 'check', 'add-invoice-export', 'build'), /BLOCKED/);
  approveChange(loadChange(base, 'add-invoice-export'), { by: 'e2e', date: '2026-01-01' });
  sh(root, 'openspec validate add-invoice-export --strict'); // approval fields don't break OpenSpec
  assert.match(run(root, 'check', 'add-invoice-export', 'build'), /^OK/);

  const tasks = join(dir, 'tasks.md');
  writeFileSync(tasks, readFileSync(tasks, 'utf8').replace('- [ ] 1.1', '- [x] 1.1'));
  assert.match(run(root, 'check', 'add-invoice-export', 'build'), /^OK/);

  sh(root, 'openspec archive add-invoice-export -y');
  assert.match(readFileSync(join(root, 'openspec', 'specs', 'invoice-export', 'spec.md'), 'utf8'), /Requirement: Invoice CSV export/);
});

test('large tier: Designer only after PM; Architect only after gate 1', { skip }, () => {
  const root = project();
  const base = join(root, 'openspec', 'changes');
  const dir = join(base, 'add-billing-portal');
  sh(root, 'openspec new change add-billing-portal');

  fromTemplate(root, 'tpl-proposal.md', join(dir, 'proposal.md'), { ...PROPOSAL, 'tier: medium': 'tier: large' });
  assert.match(run(root, 'check', 'add-billing-portal', 'design'), /^OK/);
  fromTemplate(root, 'tpl-ux.md', join(dir, 'ux.md'));
  assert.throws(() => run(root, 'check', 'add-billing-portal', 'architect'), /BLOCKED/);

  approveChange(loadChange(base, 'add-billing-portal'), { by: 'e2e', date: '2026-01-01' }); // gate 1
  assert.match(run(root, 'check', 'add-billing-portal', 'architect'), /^OK/);
  architect(root, dir);
  sh(root, 'openspec validate add-billing-portal --strict');
  approveChange(loadChange(base, 'add-billing-portal'), { by: 'e2e', date: '2026-01-01' }); // gate 2
  assert.match(run(root, 'check', 'add-billing-portal', 'build'), /^OK/);

  appendFileSync(join(dir, 'specs', 'invoice-export', 'spec.md'), '\n<!-- sneaky -->\n');
  assert.throws(() => run(root, 'check', 'add-billing-portal', 'build'), /specs\/ changed after approval/);
});

test('small tier: tasks.md + skip_specs validates and builds with no gate', { skip }, () => {
  const root = project();
  const dir = join(root, 'openspec', 'changes', 'fix-csv-header');
  sh(root, 'openspec new change fix-csv-header');
  fromTemplate(root, 'tpl-tasks.md', join(dir, 'tasks.md'), { 'persona: architect': 'persona: developer', 'tier: medium': 'tier: small' });
  appendFileSync(join(dir, '.openspec.yaml'), 'skip_specs: true\n');
  sh(root, 'openspec validate fix-csv-header --strict');
  assert.match(run(root, 'check', 'fix-csv-header', 'build'), /^OK/);
  assert.ok(existsSync(join(dir, 'tasks.md')));
});
