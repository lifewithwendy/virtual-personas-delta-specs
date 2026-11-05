#!/usr/bin/env node
// VPDS gate: phase checks and human approval over OpenSpec change folders.
// Run from the repo root:  node vpds/gate.mjs <command> [...]
import { execSync } from 'node:child_process';
import { userInfo } from 'node:os';
import { createInterface } from 'node:readline/promises';
import { listChanges, loadChange, formatStatus, approveChange, checkPhase } from './lib.mjs';

const CHANGES_DIR = 'openspec/changes';

const USAGE = `Usage:
  node vpds/gate.mjs status                                list open changes
  node vpds/gate.mjs approve <id> [files...]               approve files in review (human only)
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

function whoAmI() {
  try {
    const name = execSync('git config user.name', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    if (name) return name;
  } catch { /* no git or no user.name */ }
  return userInfo().username;
}

async function cmdApprove(id, files) {
  if (!id) usage();
  // AI tools run commands without an interactive terminal; humans have one.
  if (!process.stdin.isTTY) {
    throw new Error('approve must be run by a human in an interactive terminal. AI personas never approve.');
  }
  const change = loadChange(CHANGES_DIR, id);
  console.log(formatStatus(change));

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question(`Approve ${files.length ? files.join(', ') : 'all files in review'} for "${id}"? [y/N] `);
  rl.close();
  if (answer.trim().toLowerCase() !== 'y') return console.log('Not approved.');

  const approved = approveChange(change, { by: whoAmI(), date: new Date().toISOString().slice(0, 10), files });
  console.log(`Approved: ${approved.join(', ')}`);
  console.log('Next: start a fresh AI session (/clear) before the next persona.');
}

function cmdCheck(id, phase) {
  if (!id || !phase) usage();
  const { ok, reasons, warnings } = checkPhase(loadChange(CHANGES_DIR, id), phase);
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
    case 'approve': await cmdApprove(args[0], args.slice(1)); break;
    case 'check': cmdCheck(args[0], args[1]); break;
    default: usage();
  }
} catch (err) {
  console.error(`gate: ${err.message}`);
  process.exit(1);
}
