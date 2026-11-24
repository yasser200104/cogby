#!/usr/bin/env node
'use strict';

// The cogby plugin's one hook entry point: `node "${CLAUDE_PLUGIN_ROOT}/hooks/plugin-hook.cjs" <hook>`
// runs <program>/.claude/hooks/<hook>.cjs. Every hook plugin.json declares goes through here.
//
// The plugin's root is the program's root: .claude/ holds the skills and these hooks, core/ sits
// beside it. Claude Code loads a plugin in place or from a copy in its own cache,
// <config>/plugins/cache/cogby/cogby/<version>, and CLAUDE_PLUGIN_ROOT names whichever it is. Either
// is a whole program, so a machine with only the plugin has working hooks. A brain that has an
// installed program is still served by THAT program, found below, because its .env, its settings and
// its data are there and not in a cache. This file needs nothing beside it: Node's fs, os and path
// find the program, and the program's own spawn module runs the hook from there, as a child.
//
// The brain is the folder holding .cogby/brain.json at or above CLAUDE_PROJECT_DIR. A session in a
// folder that is not a brain hears nothing, but for the two hooks named further down that also serve
// the person's default brain: exit 0, no output. For a brain, which program, in this
// order. (a) The folder this file sits two levels inside, when it is a git checkout: a developer's
// --plugin-dir. (b) The folder above the brain, when it holds the hook and
// core/lib/spawn.cjs: a brain inside its program. (c) The root of the install record (install.json in
// Cogby's config folder), only when its "brain" is this brain. (b) and (c) are the brain forwarders'
// own rules, and like them compare real locations, so a brain reached through a link is one brain.
//
// When no program is found, one line on stderr and exit 1, which Claude Code reports and goes on
// from: exit 2 would block a prompt or a tool call over a hook that only reads and records. stdio is
// inherited, so the payload reaches the hook on stdin and its output reaches Claude Code unchanged;
// the hook's exit code is passed back. Not require(): a hook run as main and a hook loaded as a
// module are not the same program.
//
// Two hooks also start the background sync that keeps the brain's index up to date: brain-context
// (a session starts) and capture-log (a turn ended in the brain). It is a detached process this file does not
// wait for (core/brain/background.cjs), started after the hook has run, so the turn just logged is
// in it. Searches answer from the index as it is; this is what brings in files changed elsewhere.

const fs = require('fs');
const os = require('os');
const path = require('path');

const HOOK = process.argv[2] || '';
const WALK_LIMIT = 8;

function fail(why) {
  process.stderr.write(`Cogby's ${HOOK || 'plugin'} hook did not run: ${why}.\n`);
  process.exit(1);
}

if (!/^[a-z][a-z0-9-]*$/.test(HOOK)) fail(`"${HOOK}" is not a hook name`);

// The per-machine config folder, exactly as cli/lib/runtime-paths.cjs configDirectory computes it
// (brain-harness.test holds them to one answer). Inline: this file loads nothing from a program it
// has not found yet.
function configDir(env) {
  const home = path.resolve(env.HOME || os.homedir());
  if (env.COGBY_CONFIG_DIR) return path.resolve(env.COGBY_CONFIG_DIR);
  if (process.platform === 'win32') return path.join(env.APPDATA || path.join(home, 'AppData', 'Roaming'), 'Cogby');
  if (process.platform === 'darwin') return path.join(home, 'Library', 'Application Support', 'Cogby');
  return path.join(env.XDG_CONFIG_HOME || path.join(home, '.config'), 'cogby');
}

const real = (p) => { try { return fs.realpathSync.native(p); } catch { return path.resolve(p); } };
const samePath = (a, b) => {
  const x = real(a);
  const y = real(b);
  return process.platform === 'win32' ? x.toLowerCase() === y.toLowerCase() : x === y;
};
const isProgram = (dir) => fs.existsSync(path.join(dir, '.claude', 'hooks', `${HOOK}.cjs`))
  && fs.existsSync(path.join(dir, 'core', 'lib', 'spawn.cjs'));

function brainAt(start) {
  let dir = path.resolve(start);
  for (let i = 0; i < WALK_LIMIT; i++) {
    if (fs.existsSync(path.join(dir, '.cogby', 'brain.json'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

function program(brain) {
  const own = path.resolve(__dirname, '..', '..');
  // A checkout a developer loaded with --plugin-dir runs its own hooks, whatever is installed.
  if (isProgram(own) && fs.existsSync(path.join(own, '.git'))) return own;
  const above = path.dirname(real(brain));
  if (isProgram(above)) return above;
  let record = null;
  try { record = JSON.parse(fs.readFileSync(path.join(configDir(process.env), 'install.json'), 'utf8').replace(/^\uFEFF/, '')); }
  catch { /* no record: no program */ }
  if (record && typeof record.root === 'string' && record.root && typeof record.brain === 'string'
    && path.isAbsolute(record.brain) && samePath(record.brain, brain) && isProgram(path.resolve(record.root))) return path.resolve(record.root);
  // (d) A brain `cogby init` laid out, with no installed program: brains.json, beside the install
  // record, names the program it was made from (core/lib/brain-harness.cjs recordProgram).
  let known = null;
  try { known = JSON.parse(fs.readFileSync(path.join(configDir(process.env), 'brains.json'), 'utf8').replace(/^\uFEFF/, '')); }
  catch { /* no list: no program */ }
  for (const entry of (known && Array.isArray(known.brains) ? known.brains : [])) {
    if (entry && typeof entry.brain === 'string' && typeof entry.root === 'string' && path.isAbsolute(entry.brain)
      && samePath(entry.brain, brain) && isProgram(path.resolve(entry.root))) return path.resolve(entry.root);
  }
  // (e) No program is installed for this brain: the plugin is one. Its root holds core/ beside these
  // hooks, whether Claude Code loaded it in place or from a copy in its cache.
  if (isProgram(own)) return own;
  return null;
}

// Cogby's hooks are a brain's: a session in any other folder hears nothing from them, with three
// exceptions. brain-context runs anywhere: outside a brain it names the person's default brain (the
// one brains.json records, set by `/cogby:onboarding`) in a line or two, and when there is no brain at all
// it says so once and names the command that makes one. capture-log runs anywhere there is a default
// brain, and is told which one (`--place-of`): it writes the day's log only when the folder is a
// place of that brain with a role that works on its page, and is silent everywhere else.
// session-wrapup is told the same way, and outside a brain does one thing: in such a place it commits
// the day's log to the brain, a plain git commit with no model, and starts no wrap-up. For all three
// the program is the default brain's, or this plugin itself.
const here = brainAt(process.env.CLAUDE_PROJECT_DIR || process.cwd());
let usual = null;
if (!here && (HOOK === 'brain-context' || HOOK === 'capture-log' || HOOK === 'session-wrapup')) {
  try {
    const named = JSON.parse(fs.readFileSync(path.join(configDir(process.env), 'brains.json'), 'utf8').replace(/^\uFEFF/, '')).default;
    if (typeof named === 'string' && path.isAbsolute(named) && fs.existsSync(path.join(named, '.cogby', 'brain.json'))) usual = path.resolve(named);
  } catch { /* none recorded */ }
}
const brain = here || usual;
if (!brain && HOOK !== 'brain-context') process.exit(0);
const own = path.resolve(__dirname, '..', '..');
const engine = brain ? program(brain) : (isProgram(own) ? own : null);
if (!brain && !engine) process.exit(0);
if (!engine) fail(`no Cogby program for the brain at ${brain} (none above it, and no install record names it; \`cogby init\` in that folder records one)`);

// The program's own spawn module, the one door to child_process (spawn-chokepoint.test), and the only
// thing this file loads from the program it found.
let spawnSync;
try { ({ spawnSync } = require(path.join(engine, 'core', 'lib', 'spawn.cjs'))); }
catch (e) { fail(`the program's spawn module did not load: ${String(e && e.message).slice(0, 120)}`); }

// Outside a brain, capture-log is handed the default brain by name. It never works one out itself:
// a code repository with a CLAUDE.md beside a .claude/ folder would otherwise pass for an install,
// and the log would be planted in it.
const placeOf = (HOOK === 'capture-log' || HOOK === 'session-wrapup') && !here && usual ? ['--place-of', usual] : [];
const r = spawnSync(process.execPath, [path.join(engine, '.claude', 'hooks', `${HOOK}.cjs`), ...process.argv.slice(3), ...placeOf], { stdio: 'inherit' });
// The sync after a turn is for a session in the brain. A turn in a linked folder changes nothing
// the index answers from (the day's log is not in default search), so it starts none.
if (brain && (HOOK === 'brain-context' || (HOOK === 'capture-log' && here))) {
  try { require(path.join(engine, 'core', 'brain', 'background.cjs')).start(brain); } catch { /* a hook never fails on this */ }
}
if (r.status === null) fail(r.error ? `it did not start: ${r.error.message}` : `it was stopped by ${r.signal}`);
process.exit(r.status);
