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
  const repos = changeRepos(change);
  if (repos.length) parts.push(`{${repos.join(',')}}`);
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
export function approveChange(change, { by, date, files, via }) {
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
    if (via) updates.approved_via = via;
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
export function checkPhase(change, phase, { config = { repos: {} }, root = '.' } = {}) {
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

  // Multi-repo: every task must say which repo it belongs to
  if (phase === 'build') reasons.push(...repoProblems(change, config, root));

  // An open pushback blocks building until the Architect resolves it
  if (phase === 'build' && pushback && pushback.meta.status !== 'resolved') {
    reasons.push('pushback.md is open; run /vp:architect to resolve it, then approve again');
  }

  return { ok: reasons.length === 0, reasons, warnings };
}

// ---------------------------------------------------------------------------
// Single- vs multi-repo projects
// ---------------------------------------------------------------------------
// No vpds.config.json (or no repos in it) → single repo: code lives next to openspec/.
// With repos → this is a planning repo; code lives in the listed repos and every task
// in tasks.md is tagged with the repo it belongs to: `- [ ] 1.1 [api] Test: …`.
import { resolve } from 'node:path';

export const CONFIG_FILE = 'vpds.config.json';

/** terminal: approve only from an interactive terminal (default).
 *  chat: also allow `approve --yes` from the AI tool, behind its permission prompt (/vp:approve). */
export const APPROVAL_MODES = ['terminal', 'chat'];

/** @returns {{ repos: Record<string,string> }} repo name → path (relative to the project root) */
export function loadConfig(root = '.') {
  const path = join(root, CONFIG_FILE);
  if (!existsSync(path)) return { repos: {}, approval: 'terminal' };
  let config;
  try {
    config = JSON.parse(readFileSync(path, 'utf8'));
  } catch (err) {
    throw new Error(`${CONFIG_FILE} is not valid JSON: ${err.message}`);
  }
  const repos = config.repos ?? {};
  for (const [name, p] of Object.entries(repos)) {
    if (!/^[\w-]+$/.test(name)) throw new Error(`${CONFIG_FILE}: repo name "${name}" must be letters, digits, - or _`);
    if (typeof p !== 'string' || !p) throw new Error(`${CONFIG_FILE}: repo "${name}" needs a path string`);
  }
  const approval = config.approval ?? 'terminal';
  if (!APPROVAL_MODES.includes(approval)) {
    throw new Error(`${CONFIG_FILE}: approval must be one of ${APPROVAL_MODES.join(', ')} (got "${approval}")`);
  }
  return { ...config, repos, approval };
}

export const isMultiRepo = (config) => Object.keys(config?.repos ?? {}).length > 0;

/** Checkbox tasks in a tasks.md body → [{ id, repo, text, done }] */
export function parseTasks(body) {
  const tasks = [];
  for (const m of normalise(body).matchAll(/^\s*[-*] \[([ xX]?)\]\s+(.*)$/gm)) {
    let text = m[2];
    const id = text.match(/^(\d+(?:\.\d+)*)\s+/);
    if (id) text = text.slice(id[0].length);
    const repo = text.match(/^\[([\w-]+)\]\s*/);
    if (repo) text = text.slice(repo[0].length);
    tasks.push({ id: id?.[1] ?? null, repo: repo?.[1] ?? null, text, done: /x/i.test(m[1]) });
  }
  return tasks;
}

/** Repos a change touches, from its task tags (sorted, unique). */
export function changeRepos(change) {
  const body = change.files['tasks.md']?.body ?? '';
  return [...new Set(parseTasks(body).map((t) => t.repo).filter(Boolean))].sort();
}

/** In a multi-repo project, every task needs a known [repo] tag and that repo must exist on disk. */
export function repoProblems(change, config, root = '.') {
  if (!isMultiRepo(config) || !change.files['tasks.md']) return [];
  const known = Object.keys(config.repos);
  const reasons = [];
  for (const t of parseTasks(change.files['tasks.md'].body)) {
    const label = t.id ? `task ${t.id}` : `task "${t.text.slice(0, 40)}"`;
    if (!t.repo) reasons.push(`${label} has no [repo] tag (known repos: ${known.join(', ')})`);
    else if (!config.repos[t.repo]) reasons.push(`${label} uses unknown repo [${t.repo}] (known repos: ${known.join(', ')})`);
  }
  for (const name of changeRepos(change)) {
    const p = config.repos[name];
    if (p && !existsSync(resolve(root, p))) reasons.push(`repo "${name}" not found at ${p} (fix the path in ${CONFIG_FILE})`);
  }
  return reasons;
}

// ---------------------------------------------------------------------------
// Finishing a change: merge feat/<id> into main in every repo it touched
// ---------------------------------------------------------------------------
import { execFileSync } from 'node:child_process';

/** Run git in `cwd`, returning trimmed stdout (throws on non-zero exit). */
export const git = (cwd, args) =>
  execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

const gitOk = (cwd, args) => {
  try { git(cwd, args); return true; } catch { return false; }
};

/** `main`, or `master`, or null. */
export function mainBranchOf(dir) {
  return ['main', 'master'].find((b) => gitOk(dir, ['rev-parse', '--verify', '--quiet', `refs/heads/${b}`])) ?? null;
}

/**
 * Everything that must be true before `finish` touches any repo.
 * @returns {{ ok: boolean, reasons: string[], branch: string,
 *             repos: { name: string, dir: string, main?: string, ahead?: number }[] }}
 */
export function finishPreflight(change, config, root = '.') {
  const reasons = [];
  const branch = `feat/${change.id}`;

  if (!change.files['tasks.md']) reasons.push('tasks.md missing');
  const open = parseTasks(change.files['tasks.md']?.body ?? '').filter((t) => !t.done);
  if (open.length) reasons.push(`${open.length} task(s) not ticked: ${open.map((t) => t.id ?? t.text.slice(0, 30)).join(', ')}`);

  // Same rules as starting the build: approvals intact, no open pushback, repo tags valid.
  reasons.push(...checkPhase(change, 'build', { config, root }).reasons);

  const multi = isMultiRepo(config);
  const repos = multi
    ? changeRepos(change).filter((n) => config.repos[n]).map((n) => ({ name: n, dir: resolve(root, config.repos[n]) }))
    : [{ name: 'this repo', dir: resolve(root) }];
  if (multi && !changeRepos(change).length) reasons.push('no [repo]-tagged tasks, so nothing to merge');

  for (const r of repos) {
    if (!existsSync(r.dir)) continue; // already reported by the repo checks above
    if (!gitOk(r.dir, ['rev-parse', '--git-dir'])) { reasons.push(`${r.name}: not a git repo`); continue; }
    r.main = mainBranchOf(r.dir);
    if (!r.main) reasons.push(`${r.name}: no main or master branch`);
    if (!gitOk(r.dir, ['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`])) {
      reasons.push(`${r.name}: branch ${branch} not found`);
    } else if (r.main) {
      r.ahead = Number(git(r.dir, ['rev-list', '--count', `${r.main}..${branch}`]));
    }
    if (git(r.dir, ['status', '--porcelain'])) reasons.push(`${r.name}: uncommitted changes (commit or stash them first)`);
  }

  if (multi) {
    if (!gitOk(root, ['rev-parse', '--git-dir'])) reasons.push('planning repo is not a git repo');
    else if (git(root, ['status', '--porcelain'])) reasons.push('planning repo: uncommitted changes (commit or stash them first)');
  }
  return { ok: reasons.length === 0, reasons, branch, repos };
}
