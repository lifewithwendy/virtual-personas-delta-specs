#!/usr/bin/env node
// npx vpds init | update   (run inside your project)
import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { install } from './install.mjs';

const USAGE = `Usage: npx vpds <init|update> [dir] [options]

  init      add VPDS to a project (dir defaults to the current folder)
  update    refresh personas, commands, templates and gate scripts; never touches your specs or changes

Options:
  --tools claude,cursor   which AI tools to install commands for (default: both)
  --no-obsidian           skip the Obsidian dashboard, canvas and vault settings
  --no-openspec           don't run \`openspec init\` (init only)
  --force                 replace files you've edited
  --dry-run               show what would change, write nothing`;

const SYMBOL = { create: '+', update: '~', merge: '~', unchanged: '=', skip: '!' };

function parse(argv) {
  const opts = { obsidian: true, openspec: true, force: false, dryRun: false };
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--tools') opts.tools = argv[++i]?.split(',').map((s) => s.trim()).filter(Boolean);
    else if (a.startsWith('--tools=')) opts.tools = a.slice(8).split(',').map((s) => s.trim()).filter(Boolean);
    else if (a === '--no-obsidian') opts.obsidian = false;
    else if (a === '--no-openspec') opts.openspec = false;
    else if (a === '--force') opts.force = true;
    else if (a === '--dry-run') opts.dryRun = true;
    else if (a === '-h' || a === '--help') positional.unshift('help');
    else positional.push(a);
  }
  return { cmd: positional[0], dir: resolve(positional[1] ?? '.'), opts };
}

function runOpenspecInit(dir, tools) {
  if (existsSync(join(dir, 'openspec', 'config.yaml'))) return console.log('= openspec already initialised');
  try {
    execSync('openspec --version', { stdio: 'ignore', shell: true });
  } catch {
    return console.log(`\nNext: install OpenSpec and initialise it:\n  npm i -g @fission-ai/openspec\n  openspec init --tools ${tools.join(',')}`);
  }
  console.log(`\nRunning: openspec init --tools ${tools.join(',')}`);
  execSync(`openspec init . --tools ${tools.join(',')}`, { cwd: dir, stdio: 'inherit', shell: true });
}

const { cmd, dir, opts } = parse(process.argv.slice(2));
if (!['init', 'update'].includes(cmd)) {
  console.error(USAGE);
  process.exit(cmd === 'help' ? 0 : 1);
}

try {
  const { actions, manifest } = install(dir, { mode: cmd, ...opts });
  for (const { path, action, note } of actions) {
    if (action === 'unchanged' && !opts.dryRun) continue;
    console.log(`${SYMBOL[action]} ${path}${note ? `  (${note})` : ''}`);
  }
  const skipped = actions.filter((a) => a.action === 'skip').length;
  console.log(`\n${opts.dryRun ? 'Dry run: nothing written.' : `VPDS ${manifest.version} ${cmd === 'init' ? 'installed' : 'updated'}.`}${skipped ? ` ${skipped} file(s) skipped.` : ''}`);
  if (cmd === 'init' && opts.openspec && !opts.dryRun) runOpenspecInit(dir, manifest.tools);
  if (cmd === 'init' && !opts.dryRun) {
    console.log(`\nStart your first change:  /vp:pm <idea>   (Cursor: /vp-pm)\nSee where things stand:   node vpds/gate.mjs status`);
  }
} catch (err) {
  console.error(`vpds: ${err.message}`);
  process.exit(1);
}
