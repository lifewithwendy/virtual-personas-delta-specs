// VPDS core helpers: read/write YAML frontmatter and fingerprint file bodies.
// Zero dependencies. Frontmatter is treated as flat `key: value` lines.
import { createHash } from 'node:crypto';

const FRONTMATTER = /^---\n([\s\S]*?)\n---\n?/;
const KEY_LINE = /^([\w-]+):\s*(.*)$/;

/** Normalise Windows line endings so every regex can assume \n. */
const normalise = (text) => text.replace(/\r\n/g, '\n');

/**
 * Split a Markdown file into frontmatter properties and body.
 * @returns {{ meta: Record<string,string>, body: string }}
 */
export function parseDoc(text) {
  text = normalise(text);
  const match = text.match(FRONTMATTER);
  if (!match) return { meta: {}, body: text };

  const meta = {};
  for (const line of match[1].split('\n')) {
    const kv = line.match(KEY_LINE);
    if (kv) meta[kv[1]] = kv[2].replace(/\s+#.*$/, '').trim();
  }
  return { meta, body: text.slice(match[0].length) };
}

/**
 * Set frontmatter keys, leaving every other line (order, comments, body) untouched.
 * Existing keys are replaced in place; new keys are appended to the end of the frontmatter.
 * @returns {string} the updated file text
 */
export function setMeta(text, updates) {
  text = normalise(text);
  const entries = Object.entries(updates).map(([k, v]) => [k, `${k}: ${v}`]);
  const match = text.match(FRONTMATTER);

  if (!match) {
    return `---\n${entries.map(([, line]) => line).join('\n')}\n---\n${text}`;
  }

  const lines = match[1].split('\n');
  for (const [key, line] of entries) {
    const i = lines.findIndex((l) => l.match(KEY_LINE)?.[1] === key);
    if (i >= 0) lines[i] = line;
    else lines.push(line);
  }
  return `---\n${lines.join('\n')}\n---\n${text.slice(match[0].length)}`;
}

/**
 * 12-character fingerprint of a file body, used to detect edits after approval.
 * Ticked checkboxes are reset first, so the Developer ticking tasks.md
 * does not count as an edit.
 */
export function bodyHash(body) {
  const canonical = normalise(body)
    .replace(/^(\s*[-*] )\[[xX]\]/gm, '$1[ ]')
    .trim();
  return createHash('sha256').update(canonical).digest('hex').slice(0, 12);
}

// ---------------------------------------------------------------------------
// Change folders (step 2b)
// ---------------------------------------------------------------------------
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';

/** Files owned by the phase personas, in pipeline order. */
export const PHASE_FILES = ['proposal.md', 'ux.md', 'design.md', 'tasks.md'];

/** Ids of in-flight changes (sub-folders of changesDir except `archive`), sorted. */
export function listChanges(changesDir) {
  if (!existsSync(changesDir)) return [];
  return readdirSync(changesDir)
    .filter((name) => name !== 'archive' && statSync(join(changesDir, name)).isDirectory())
    .sort();
}

/** Read a file into { path, meta, body }, or null if it doesn't exist. */
function readDocFile(path) {
  if (!existsSync(path)) return null;
  return { path, ...parseDoc(readFileSync(path, 'utf8')) };
}

/**
 * Load one change folder.
 * @returns {{ id, dir, tier, files: Record<string,{path,meta,body}>, pushback: object|null }}
 */
export function loadChange(changesDir, id) {
  const dir = join(changesDir, id);
  if (!existsSync(dir)) throw new Error(`change "${id}" not found in ${changesDir}`);

  const files = {};
  for (const name of PHASE_FILES) {
    const doc = readDocFile(join(dir, name));
    if (doc) files[name] = doc;
  }
  const tier = files['proposal.md']?.meta.tier || files['tasks.md']?.meta.tier || 'medium';
  return { id, dir, tier, files, pushback: readDocFile(join(dir, 'pushback.md')) };
}

/** One-line summary: `id  [tier]  proposal:approved  design:review  PUSHBACK:open` */
export function formatStatus(change) {
  const parts = [change.id, `[${change.tier}]`];
  for (const [name, doc] of Object.entries(change.files)) {
    parts.push(`${name.replace('.md', '')}:${doc.meta.status || 'draft'}`);
  }
  if (change.pushback && change.pushback.meta.status !== 'resolved') {
    parts.push(`PUSHBACK:${change.pushback.meta.status || 'open'}`);
  }
  return parts.join('  ');
}

// ---------------------------------------------------------------------------
// Approval (step 2c)
// ---------------------------------------------------------------------------
import { writeFileSync } from 'node:fs';
import { relative } from 'node:path';

/** All files under <changeDir>/specs, recursively, as sorted absolute paths. */
function specFiles(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .flatMap((e) => (e.isDirectory() ? specFiles(join(dir, e.name)) : [join(dir, e.name)]))
    .sort();
}

/** Fingerprint of every delta spec in a change (paths + contents). */
export function specsHash(changeDir) {
  const specsDir = join(changeDir, 'specs');
  const joined = specFiles(specsDir)
    .map((p) => `${relative(specsDir, p).replace(/\\/g, '/')}\n${normalise(readFileSync(p, 'utf8'))}`)
    .join('\n\0\n');
  return bodyHash(joined);
}

/** 'design' | 'design.md' → 'design.md', or throw if it isn't a phase file. */
function toPhaseFile(name) {
  const file = name.endsWith('.md') ? name : `${name}.md`;
  if (!PHASE_FILES.includes(file)) throw new Error(`${name} is not a phase file (${PHASE_FILES.join(', ')})`);
  return file;
}

/**
 * Mark phase files approved and lock their content with a hash.
 * Default: every file currently in `review`. Pass `files` to approve specific ones.
 * @returns {string[]} names of the files approved
 */
export function approveChange(change, { by, date, files }) {
  let targets;
  if (files && files.length) {
    targets = files.map(toPhaseFile);
    for (const f of targets) if (!change.files[f]) throw new Error(`${f} not found in change "${change.id}"`);
  } else {
    targets = PHASE_FILES.filter((f) => change.files[f]?.meta.status === 'review');
    if (!targets.length) throw new Error(`nothing in review for "${change.id}"`);
  }

  for (const f of targets) {
    const doc = change.files[f];
    const updates = { status: 'approved', approved_by: by, approved_at: date, approved_hash: bodyHash(doc.body) };
    if (f === 'design.md') updates.specs_hash = specsHash(change.dir);
    writeFileSync(doc.path, setMeta(readFileSync(doc.path, 'utf8'), updates));
  }
  return targets;
}

// ---------------------------------------------------------------------------
// Phase checks (step 2d)
// ---------------------------------------------------------------------------

/** Which persona phase each check name gates. */
export const PHASES = ['design', 'architect', 'build'];

/**
 * Is `file` approved and unchanged since approval?
 * @returns {{ reason?: string, warning?: string }}
 */
function approvalState(change, file) {
  const doc = change.files[file];
  if (!doc) return { reason: `${file} missing` };
  const { status, approved_hash, specs_hash } = doc.meta;
  if (status !== 'approved') return { reason: `${file} is "${status || 'draft'}", needs your approval` };
  if (!approved_hash) {
    return { warning: `${file} was approved by hand with no hash lock; run "node vpds/gate.mjs approve ${change.id} ${file}" to lock it` };
  }
  if (approved_hash !== bodyHash(doc.body)) return { reason: `${file} changed after approval; review it, then approve again` };
  if (file === 'design.md' && specs_hash && specs_hash !== specsHash(change.dir)) {
    return { reason: `specs/ changed after approval; review them, then approve design.md again` };
  }
  return {};
}

/** Files that must be approved before `phase` can start, for a given tier. */
function requiredApprovals(phase, tier) {
  if (phase === 'architect') return tier === 'large' ? ['proposal.md', 'ux.md'] : [];
  if (phase === 'build') {
    if (tier === 'small') return [];
    return tier === 'large'
      ? ['proposal.md', 'ux.md', 'design.md', 'tasks.md']
      : ['proposal.md', 'design.md', 'tasks.md'];
  }
  return [];
}

/**
 * May the persona for `phase` start work on this change?
 * @returns {{ ok: boolean, reasons: string[], warnings: string[] }}
 */
export function checkPhase(change, phase) {
  if (!PHASES.includes(phase)) throw new Error(`unknown phase "${phase}" (use ${PHASES.join(', ')})`);
  const { tier, files, pushback } = change;
  const reasons = [];
  const warnings = [];

  // Phase-specific preconditions
  if (phase === 'design') {
    if (!files['proposal.md']) reasons.push('proposal.md missing; run /vp:pm first');
    else if (tier !== 'large') reasons.push(`tier is "${tier}"; the Designer only runs for large changes`);
  }
  if (phase === 'architect') {
    if (tier === 'small') reasons.push('tier is "small"; small changes go straight to /vp:build');
    else if (!files['proposal.md']) reasons.push('proposal.md missing; run /vp:pm first');
  }
  if (phase === 'build' && tier === 'small' && !files['tasks.md']) {
    reasons.push('tasks.md missing; write it first (see developer.md, small tier)');
  }

  // Approvals required by the tier
  if (!(phase === 'architect' && tier === 'small')) {
    for (const file of requiredApprovals(phase, tier)) {
      const { reason, warning } = approvalState(change, file);
      if (reason) reasons.push(reason);
      if (warning) warnings.push(warning);
    }
  }

  // An open pushback blocks building until the Architect resolves it
  if (phase === 'build' && pushback && pushback.meta.status !== 'resolved') {
    reasons.push('pushback.md is open; run /vp:architect to resolve it, then approve again');
  }

  return { ok: reasons.length === 0, reasons, warnings };
}
