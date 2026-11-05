#!/usr/bin/env node
// VPDS gate: phase checks and human approval over OpenSpec change folders.
// Run from the repo root:  node vpds/gate.mjs <command> [...]
import { execSync } from 'node:child_process';
import { userInfo } from 'node:os';
import { createInterface } from 'node:readline/promises';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  listChanges, loadChange, formatStatus, approveChange, checkPhase, loadConfig, isMultiRepo, CONFIG_FILE,
  finishPreflight, git,
} from './lib.mjs';

const CHANGES_DIR = 'openspec/changes';

const USAGE = `Usage:
  node vpds/gate.mjs status                                list open changes
  node vpds/gate.mjs repos                                 single repo, or the code repos this project plans for
  node vpds/gate.mjs approve <id> [files...] [--yes]       approve files in review (human only;
                                                           --yes skips the prompt; from an AI tool
                                                           only when vpds.config.json has "approval": "chat")
  node vpds/gate.mjs finish <id> [--dry-run] [--yes]       merge feat/<id> into main in every repo it touched,
                                                           archive the change, commit the planning repo (human only)
  node vpds/gate.mjs check <id> <design|architect|build>   may this persona start? (exit 0 = yes)`;

function usage() {
  console.error(USAGE);
  process.exit(1);
}

function cmdStatus() {
  const ids = listChanges(CHANGES_DIR);
  if (ids.length === 0) return console.log('No open changes.');
  for (const id of ids) console.log(formatStatus(loadChange(CHANGES_DIR, id)));
}

function cmdRepos() {
  const config = loadConfig('.');
  if (!isMultiRepo(config)) {
    return console.log(`Single-repo project: code lives in this repo (no repos in ${CONFIG_FILE}).`);
  }
  console.log('Multi-repo project. Tag every task with its repo: - [ ] 1.1 [name] ...');
  const width = Math.max(...Object.keys(config.repos).map((n) => n.length));
  const pathWidth = Math.max(...Object.values(config.repos).map((p) => p.length));
  for (const [name, p] of Object.entries(config.repos)) {
    const abs = resolve(p);
    let state = 'MISSING';
    if (existsSync(abs)) {
      try {
        state = `branch ${execSync('git branch --show-current', { cwd: abs, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()}`;
      } catch { state = 'ok (not a git repo)'; }
    }
    console.log(`  ${name.padEnd(width)}  ${p.padEnd(pathWidth)}  ${state}`);
  }
}

function openspecAvailable() {
  try {
    execSync('openspec --version', { stdio: 'ignore', shell: true });
    return true;
  } catch {
    return false;
  }
}

async function cmdFinish(id, { yes, dryRun }) {
  if (!id) usage();
  requireHuman('finish', yes);
  const config = loadConfig('.');
  const change = loadChange(CHANGES_DIR, id);
  const pre = finishPreflight(change, config, '.');
  if (!openspecAvailable()) pre.reasons.push('openspec CLI not found (npm i -g @fission-ai/openspec)');

  if (pre.reasons.length) {
    console.error(`BLOCKED: "${id}" can't be finished yet (nothing was changed):`);
    for (const r of pre.reasons) console.error(`  - ${r}`);
    process.exit(1);
  }

  console.log(`Finish "${id}":`);
  for (const r of pre.repos) {
    console.log(r.ahead
      ? `  - ${r.name}: merge ${pre.branch} into ${r.main} (${r.ahead} commit${r.ahead === 1 ? '' : 's'})`
      : `  - ${r.name}: ${pre.branch} is already in ${r.main}, skip`);
  }
  console.log(`  - archive the change (openspec archive ${id}) and commit the planning repo`);
  if (dryRun) return console.log('Dry run: nothing changed.');
  if (!yes && !(await confirm('Go ahead?'))) return console.log('Not finished.');

  for (const r of pre.repos) {
    if (!r.ahead) continue;
    git(r.dir, ['checkout', r.main]);
    try {
      git(r.dir, ['merge', '--no-ff', pre.branch, '-m', `Merge ${pre.branch} (${id})`]);
      console.log(`Merged ${pre.branch} into ${r.main} in ${r.name}.`);
    } catch {
      try { git(r.dir, ['merge', '--abort']); } catch { /* nothing to abort */ }
      throw new Error(
        `${r.name}: merge conflict, merge aborted (${r.name} is unchanged).\n` +
        `  Resolve it by hand there: git merge ${pre.branch}, fix, commit. Then run finish again; repos already merged are skipped.`,
      );
    }
  }

  execSync(`openspec archive ${id} -y`, { stdio: 'inherit', shell: true });
  git('.', ['add', '--', 'openspec']);
  git('.', ['commit', '-m', `archive ${id}`]);
  console.log(`\nDone: "${id}" merged and archived. Nothing was pushed. Push each repo when you're ready.`);
}

function whoAmI() {
  try {
    const name = execSync('git config user.name', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    if (name) return name;
  } catch { /* no git or no user.name */ }
  return userInfo().username;
}

/**
 * Human-only commands (approve, finish). AI tools run commands without an interactive terminal; humans have one.
 * Chat mode is the opt-in exception: /vp:<cmd> runs `<cmd> --yes` behind the tool's permission prompt.
 */
function requireHuman(cmd, yes) {
  if (process.stdin.isTTY) return;
  const { approval } = loadConfig('.');
  if (yes && approval === 'chat') return;
  throw new Error(
    approval === 'chat'
      ? `${cmd} from an AI tool needs --yes and must come from the human typing /vp:${cmd}. AI personas never ${cmd} on their own.`
      : `${cmd} must be run by a human in an interactive terminal. AI personas never ${cmd}. ` +
        `(To ${cmd} from chat with /vp:${cmd}, set "approval": "chat" in ${CONFIG_FILE}.)`,
  );
}

async function confirm(question) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question(`${question} [y/N] `);
  rl.close();
  return answer.trim().toLowerCase() === 'y';
}

async function cmdApprove(id, files, yes) {
  if (!id) usage();
  const interactive = process.stdin.isTTY;
  requireHuman('approve', yes);
  const change = loadChange(CHANGES_DIR, id);
  console.log(formatStatus(change));

  if (!yes && !(await confirm(`Approve ${files.length ? files.join(', ') : 'all files in review'} for "${id}"?`))) {
    return console.log('Not approved.');
  }

  const approved = approveChange(change, {
    by: whoAmI(),
    date: new Date().toISOString().slice(0, 10),
    files,
    via: interactive ? 'terminal' : 'chat',
  });
  console.log(`Approved: ${approved.join(', ')}`);
  console.log('Next: start a fresh AI session (/clear) before the next persona.');
}

function cmdCheck(id, phase) {
  if (!id || !phase) usage();
  const { ok, reasons, warnings } = checkPhase(loadChange(CHANGES_DIR, id), phase, { config: loadConfig('.'), root: '.' });
  for (const w of warnings) console.log(`warning: ${w}`);
  if (ok) return console.log(`OK: "${id}" is ready for ${phase}.`);
  console.error(`BLOCKED: "${id}" is not ready for ${phase}:`);
  for (const r of reasons) console.error(`  - ${r}`);
  process.exit(1);
}

const [cmd, ...args] = process.argv.slice(2);
try {
  switch (cmd) {
    case 'status': cmdStatus(); break;
    case 'repos': cmdRepos(); break;
    case 'approve': {
      const yes = args.includes('--yes');
      const rest = args.filter((a) => a !== '--yes');
      await cmdApprove(rest[0], rest.slice(1), yes);
      break;
    }
    case 'check': cmdCheck(args[0], args[1]); break;
    case 'finish': {
      const rest = args.filter((a) => !a.startsWith('--'));
      await cmdFinish(rest[0], { yes: args.includes('--yes'), dryRun: args.includes('--dry-run') });
      break;
    }
    default: usage();
  }
} catch (err) {
  console.error(`gate: ${err.message}`);
  process.exit(1);
}
