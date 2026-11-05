#!/usr/bin/env node
// VPDS gate: phase checks and human approval over OpenSpec change folders.
// Run from the repo root:  node vpds/gate.mjs <command> [...]
import { execSync } from 'node:child_process';
import { userInfo } from 'node:os';
import { createInterface } from 'node:readline/promises';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { listChanges, loadChange, formatStatus, approveChange, checkPhase, loadConfig, isMultiRepo, CONFIG_FILE } from './lib.mjs';

const CHANGES_DIR = 'openspec/changes';

const USAGE = `Usage:
  node vpds/gate.mjs status                                list open changes
  node vpds/gate.mjs repos                                 single repo, or the code repos this project plans for
  node vpds/gate.mjs approve <id> [files...] [--yes]       approve files in review (human only;
                                                           --yes skips the prompt; from an AI tool
                                                           only when vpds.config.json has "approval": "chat")
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

function whoAmI() {
  try {
    const name = execSync('git config user.name', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    if (name) return name;
  } catch { /* no git or no user.name */ }
  return userInfo().username;
}

async function cmdApprove(id, files, yes) {
  if (!id) usage();
  const interactive = process.stdin.isTTY;
  // AI tools run commands without an interactive terminal; humans have one.
  // Chat mode is the opt-in exception: /vp:approve runs `approve --yes` behind the tool's permission prompt.
  if (!interactive) {
    const { approval } = loadConfig('.');
    if (!yes || approval !== 'chat') {
      throw new Error(
        approval === 'chat'
          ? 'approve from an AI tool needs --yes and must come from the human typing /vp:approve. AI personas never approve on their own.'
          : 'approve must be run by a human in an interactive terminal. AI personas never approve. ' +
            '(To approve from chat with /vp:approve, set "approval": "chat" in vpds.config.json.)',
      );
    }
  }
  const change = loadChange(CHANGES_DIR, id);
  console.log(formatStatus(change));

  if (!yes) {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const answer = await rl.question(`Approve ${files.length ? files.join(', ') : 'all files in review'} for "${id}"? [y/N] `);
    rl.close();
    if (answer.trim().toLowerCase() !== 'y') return console.log('Not approved.');
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
    default: usage();
  }
} catch (err) {
  console.error(`gate: ${err.message}`);
  process.exit(1);
}
