'use strict';

// The brain a new install starts with, and the doctor's checks on one that exists (brain-subfolder
// U8, §4.13, §4.17). Node built-ins only, on purpose: the doctor runs brainChecks BEFORE it loads
// paths.cjs, which throws at module load when two brains sit in the program folder (§4.1), or when
// the install record names a brain that has no marker. A hook that dies on that throw is
// invisible; a doctor row that names it is not.

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
// Built-ins only as well, so it loads here before paths.cjs ever could.
const harness = require('./brain-harness.cjs');

const ENGINE = path.resolve(__dirname, '..', '..');
const STARTER = ['core', 'templates', 'starter-brain'];
const BRAIN_NAME = 'cogby-brain';
const MARKER = ['.cogby', 'brain.json'];
// The two policy-hook forwarders (paths.cjs GATE_FORWARDERS) and the settings beside them: the
// three files isLaunchableBrain needs before a session may start in the brain.
const FORWARDERS = Object.freeze(['lane-policy.cjs', 'wrapup-guard.cjs']);
// The sha256 of each forwarder as shipped before the brain-split harness, which looked for the
// program only one folder up. Those still run correctly in a brain inside its program, and an update
// never refreshes a file inside the brain: until the migration refreshes them, such a copy is the
// program's previous forwarder, not an edited one.
const FORWARDER_HASHES = Object.freeze({
  'lane-policy.cjs': Object.freeze(['21d49dbe62982e4dc3e5e144017cc592929f2d91c1fede15215fa6252f361e5a']),
  'wrapup-guard.cjs': Object.freeze(['7b3226373a83a9bb6f53ad8f494ba4cf1562c0aa7c1da8793bddb4b34833e3d2']),
});
// Hidden by attribute on Windows; Mac and Linux hide dot-names already (§4.13 step 3). Folders only:
// Windows refuses a truncating write to a FILE with the hidden attribute (EPERM), and .mcp.json is
// rewritten in place by the Console's Connections view (connections-lib.cjs) and by `claude mcp add`.
// A file inside a hidden folder is not hidden itself, so the three folders cost nothing.
const HIDDEN = Object.freeze(['.cogby', '.claude']);
// What legacy setup creates under context/ that the starter template holds no file for.
const EXTRA_DIRS = Object.freeze([]);
const EMPTY_MCP = '{\n  "mcpServers": {}\n}\n';
// The brain's own .gitignore, written as a string for the reason EMPTY_MCP is: npm drops every
// .gitignore from a package, so the starter template cannot carry one. The brain is its own git
// repository (brain-split SETUP), and its first commit is `git add -A`: without this file, that
// commit and every wrap-up after it would put push-subs.json's bearer endpoints, the permission
// audit and the runtime caches into history. The to-do, note and notification stores are NOT in
// it: they are the owner's working state and travel with the brain (owner, 2026-11-13; the comment
// line that says so is the one core/brain/db.cjs ensureIgnored looks for, TRAVEL_MARK, so keep the
// two the same). It holds every rule of the program's .gitignore that
// reached into a brain inside the program: each `cogby-brain*/` rule with that prefix dropped, and
// each rule with no slash but a trailing one, which git matches at any depth (node_modules/,
// .playwright-mcp/, *.pyc, the credential files, OS junk). brain-setup.test holds the two files to one
// list. Leaving the second kind out once put Playwright page snapshots and a project's node_modules
// into a new brain's history.
const BRAIN_GITIGNORE = `# What stays on this machine and out of this brain's version history. Cogby wrote this file
# when the brain was created, because the brain had none; it never rewrites it, so a rule added here is kept.

# Credentials (an example file is shared on purpose)
.env
.env.*
!.env.example

# Dependencies, caches and indexes any folder can grow: rebuildable, machine-specific, often large
node_modules/
__pycache__/
*.pyc
.memsearch/

# Browser-automation captures: a page snapshot holds whatever the page showed, signed in or not
.playwright-mcp/
diag-*.png

# Per-machine Claude Code settings, skill telemetry and agent worktrees
.claude/settings.local.json
.claude/skill-usage.json
.claude/worktrees/

# Heartbeat and gateway runtime state
.cogby/self/.heartbeat-state.json
.cogby/self/.heartbeat.pid
.cogby/self/.gateway/

# Goal inductor state (the goals themselves are tracked)
.cogby/self/goals/.seen.json
.cogby/self/goals/.seen.json.tmp
.cogby/self/goals/.induct.json
.cogby/self/goals/.induct.json.tmp

# Caches and runtime files that hold private text
.cogby/tasks/cache/notion.json
.cogby/tasks/prep-*/
.cogby/tasks/prep-*/transcript.md
# To-dos, notes and notifications are not ignored: they travel with the brain
.cogby/notes/.outbox-*.txt
.cogby/notes/.n8n-health-check-card.json
.cogby/apps/
.cogby/self/chats/
.cogby/usage/

# The permission audit trail
.cogby/self/log/permission-decisions.jsonl

# Web Push devices: each endpoint is a bearer credential
.cogby/notifications/push-subs.json
.cogby/notifications/push-subs.json.tmp

# Routine run captures and per-task runtime files
.cogby/routines/_runs/
.cogby/tasks/**/run.pid
.cogby/tasks/**/run.log
.cogby/tasks/**/run-state.json

# Import proposals, spent once applied
/brain-import-*.md
/import-proposal-*.md

# Patch and merge residue
*.orig
*.rej

# OS junk
Thumbs.db
.DS_Store
desktop.ini
`;

const starterDir = (engine = ENGINE) => path.join(engine, ...STARTER);
const sha256 = (file, io) => crypto.createHash('sha256').update(io.readFileSync(file)).digest('hex');
const isBrain = (dir, io = fs) => io.existsSync(path.join(dir, ...MARKER));
// paths.cjs samePath, which this file may not load: Windows compares folders without case.
const samePath = (a, b) => { const x = path.resolve(a); const y = path.resolve(b); return process.platform === 'win32' ? x.toLowerCase() === y.toLowerCase() : x === y; };

// The per-machine config folder, by the rules of cli/lib/runtime-paths.cjs configDirectory: the one
// core implementation (paths.cjs and the brain's forwarders keep inline copies, each for a reason
// given there). Core does not load the CLI.
function configDir(env = process.env) {
  const home = path.resolve(env.HOME || os.homedir());
  if (env.COGBY_CONFIG_DIR) return path.resolve(env.COGBY_CONFIG_DIR);
  return process.platform === 'win32' ? path.join(env.APPDATA || path.join(home, 'AppData', 'Roaming'), 'Cogby')
    : process.platform === 'darwin' ? path.join(home, 'Library', 'Application Support', 'Cogby')
      : path.join(env.XDG_CONFIG_HOME || path.join(home, '.config'), 'cogby');
}

// A leading BOM is skipped: Windows PowerShell 5.1 writes one when the owner edits the record by hand.
const readJson = (file) => { try { return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')); } catch { return null; } };

// The install record the updater writes after its health check (cli/lib/runtime-paths.cjs). Read
// here with fs alone: core does not load the CLI or the Console.
function installRecord(env = process.env) {
  return readJson(path.join(configDir(env), 'install.json'));
}

// "brain" in this program's install record, by paths.cjs recordedBrain's rule (and the CLI's
// readInstallRecord's): null for no setting (no record, another root's, no "brain" key), otherwise
// { brain, value } where `brain` is the folder, or null for a value that is not an absolute path,
// on which paths.cjs throws. Never throws itself: the doctor asks before it can load paths.cjs.
function brainSetting(engine, env) {
  const record = installRecord(env);
  if (!record || typeof record !== 'object' || record.brain === undefined) return null;
  if (typeof record.root !== 'string' || !record.root || !samePath(record.root, engine)) return null;
  const valid = typeof record.brain === 'string' && path.isAbsolute(record.brain);
  return { brain: valid ? path.resolve(record.brain) : null, value: record.brain };
}

function hasStarter(engine = ENGINE, io = fs) {
  return io.existsSync(path.join(starterDir(engine), '.claude', 'settings.json'));
}

// Every Windows-hidden name in the brain that exists. `run(command, args)` is the caller's spawner
// (the CLI's, or core/lib/spawn.cjs's): a name that cannot be hidden is reported, never fatal.
function markHidden(brain, options = {}) {
  const platform = options.platform || process.platform;
  if (platform !== 'win32') return { hidden: [], failed: [] };
  const io = options.fs || fs;
  const run = options.run || ((cmd, args) => require('./spawn.cjs').spawnSync(cmd, args, { encoding: 'utf8' }));
  const hidden = [];
  const failed = [];
  for (const name of HIDDEN) {
    const target = path.join(brain, name);
    if (!io.existsSync(target)) continue;
    const result = run('attrib', ['+h', target], { encoding: 'utf8' });
    (result && result.status === 0 && !result.error ? hidden : failed).push(name);
  }
  return { hidden, failed };
}

// Writes <brain>/.gitignore from BRAIN_GITIGNORE, only when the brain has none: a brain that already
// has one keeps the owner's rules. createBrain calls it (`cogby init`, and so the /cogby:setup skill).
function writeBrainGitignore(brain, options = {}) {
  const io = options.fs || fs;
  const file = path.join(brain, '.gitignore');
  if (io.existsSync(file)) return { path: file, written: false };
  io.writeFileSync(file, BRAIN_GITIGNORE);
  return { path: file, written: true };
}

const isEmptyDir = (dir, io) => { try { return io.readdirSync(dir).length === 0; } catch { return false; } };

// A layout createBrain started and has not finished. It is written into the folder before anything
// is copied and removed after the marker, so its presence can only mean "a brain was being laid out
// here and the process stopped" (a full disk, a killed setup). Without it, that half-copied folder has
// no marker, holds files, and is refused like any folder of the owner's, so a failed setup could not
// be run again until the owner deleted it by hand. Named like the CLI's own (installation.cjs
// INCOMPLETE_MARKER), which does the same for the program folder; brain-setup.test holds the two
// names to one.
const INCOMPLETE = '.cogby-setup-incomplete';
const isUnfinished = (dir, io = fs) => io.existsSync(path.join(dir, INCOMPLETE)) && !isBrain(dir, io);

// Lays out a new brain at `target`, an absolute folder anywhere, from the starter template of
// `options.engine` (§4.13, brain-split SETUP): never over a folder that holds anything (an empty one
// is used, and one holding only an unfinished layout of ours is cleared and laid out again), the
// connector file and .gitignore the package cannot carry, and the marker LAST, because the marker is
// what makes a folder a brain and a copy that stopped half-way must not count as one. The marker's
// name is the folder's.
function createBrain(target, options = {}) {
  const io = options.fs || fs;
  const engine = options.engine || ENGINE;
  const brain = path.resolve(target);
  const name = path.basename(brain);
  if (!hasStarter(engine, io)) throw new Error(`No starter brain in ${starterDir(engine)}.`);
  if (io.existsSync(brain)) {
    // Ours, and it never finished, so nothing in it is the owner's.
    if (isUnfinished(brain, io)) io.rmSync(brain, { recursive: true, force: true });
    else if (!isEmptyDir(brain, io)) throw new Error(`${brain} already exists and is not empty; a brain is never laid out over a folder.`);
  }
  // Only a parent that is missing: a drive root always exists, and mkdir on one fails on Windows.
  if (!io.existsSync(path.dirname(brain))) io.mkdirSync(path.dirname(brain), { recursive: true });
  if (!io.existsSync(brain)) io.mkdirSync(brain);
  // First into the folder, before the copy can fail half-way.
  io.writeFileSync(path.join(brain, INCOMPLETE), `${JSON.stringify({ startedAt: new Date().toISOString(), pid: process.pid })}\n`);
  io.cpSync(starterDir(engine), brain, { recursive: true, errorOnExist: true, force: false });
  for (const rel of EXTRA_DIRS) io.mkdirSync(path.join(brain, ...rel), { recursive: true });
  // cli/scripts/scan-package.cjs refuses any file named .mcp.json, so the starter cannot ship it,
  // and it has to exist anyway: a sandboxed run could otherwise create it (§4.10, starter-brain.test).
  io.writeFileSync(path.join(brain, '.mcp.json'), EMPTY_MCP);
  writeBrainGitignore(brain, { fs: io });
  // The program's rules, which the brain's .claude/CLAUDE.md imports (brain-split HARNESS). Before
  // the marker, like everything else the brain needs.
  const agents = harness.writeAgents(brain, { engine, version: options.version });
  const visibility = markHidden(brain, options);
  const marker = {
    format: 1, layout: 'brain', name, createdBy: options.createdBy || 'setup', finalized: true,
    createdAt: (options.now || new Date()).toISOString(),
  };
  io.writeFileSync(path.join(brain, ...MARKER), `${JSON.stringify(marker, null, 2)}\n`);
  // After the marker: a process stopped between the two leaves a brain, which setup adopts and
  // clears of this file, never a half-copy.
  io.rmSync(path.join(brain, INCOMPLETE), { force: true });
  return { brain, ...visibility, agents };
}

// ---- the doctor's rows (§4.1, §4.3, §4.17) --------------------------------------------------------

function children(engine, io) {
  try { return io.readdirSync(engine, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort(); }
  catch { return []; }
}

// The brain discovery would pick, without throwing: COGBY_BRAIN when it names a folder that exists,
// then the brain the install record names, otherwise the one child holding the marker. Mirrors
// paths.cjs brainOf for THIS program only. A "brain" setting that is not an absolute path answers
// null, never a child: paths.cjs stops there, so no brain is in use.
function brainInUse(engine, brains, env, io) {
  const want = String(env.COGBY_BRAIN || '').trim();
  if (want && io.existsSync(path.resolve(want))) return path.resolve(want);
  const setting = brainSetting(engine, env);
  if (setting) return setting.brain;
  return brains.length === 1 ? path.join(engine, brains[0]) : null;
}

function forwarderRow(engine, brain, io) {
  const hooks = path.join(brain, '.claude', 'hooks');
  const missing = [];
  const edited = [];
  for (const f of FORWARDERS) {
    const installed = path.join(hooks, f);
    const template = path.join(starterDir(engine), '.claude', 'hooks', f);
    if (!io.existsSync(installed)) { missing.push(f); continue; }
    // A hash, not existence: an update never refreshes a file inside the brain (isPreservedPath),
    // so a stale or edited forwarder is exactly what an existence check cannot see. The previous
    // release's forwarder (FORWARDER_HASHES) is the program's own, not an edit.
    if (!io.existsSync(template)) continue;
    const hash = sha256(installed, io);
    if (hash !== sha256(template, io) && !(FORWARDER_HASHES[f] || []).includes(hash)) edited.push(f);
  }
  const noSettings = !io.existsSync(path.join(brain, '.claude', 'settings.json'));
  const where = path.join(brain, '.claude');
  const how = [];
  if (missing.length || noSettings) {
    const names = [...missing.map((f) => `hooks/${f}`), ...(noSettings ? ['settings.json'] : [])];
    how.push(`${names.join(' and ')} missing from ${where}. Until ${names.length > 1 ? 'they are' : 'it is'} back, every Cogby ` +
      'session starts in the program folder instead of the brain (sessionRoot falls back), so the brain\'s own ' +
      'settings and connectors do not apply to Cogby\'s work');
  }
  if (edited.length) {
    how.push(`hooks/${edited.join(' and hooks/')} in ${where} ${edited.length > 1 ? 'differ' : 'differs'} from the program's ` +
      'template, so the permission gate of every brain session runs that copy, not the program\'s');
  }
  if (how.length) how.push(`copy them from ${path.join(starterDir(engine), '.claude')}`);
  return {
    name: 'brain harness', level: 'core', set: !how.length, proves: 'function',
    unlocks: 'Cogby\'s sessions starting inside the brain, behind the program\'s own permission gate',
    how: how.join('. '),
    detail: how.length ? '' : `${brain}: gate forwarders match the program's, sessions start in the brain`,
  };
}

// Rows for the doctor. Nothing at all for an install with no brain and nothing brain-like beside the
// program, so a legacy install's report is unchanged. `fatal` marks the conditions on which paths.cjs
// brainOf throws for this program: at module load, or, with COGBY_CONTEXT or BRAIN_DIR naming the
// substrate, at the first forRoot(ROOT) or sessionRoot(), which the doctor's own report makes. So the
// doctor prints them and exits before reaching that require, whichever of the two it would be.
function brainChecks(engine = ENGINE, env = process.env, io = fs) {
  const names = children(engine, io);
  const brains = names.filter((n) => !n.startsWith('.') && n !== 'node_modules' && isBrain(path.join(engine, n), io));
  const dotted = names.filter((n) => n.startsWith('.') && isBrain(path.join(engine, n), io));
  const rows = [];

  const chosen = String(env.COGBY_BRAIN || '').trim();
  const chosenExists = !!chosen && io.existsSync(path.resolve(chosen));
  // paths.cjs brainOf, in its order: a COGBY_BRAIN that exists, then the record, and only with
  // neither does discovery (and its two-brain stop) run at all.
  const setting = chosenExists ? null : brainSetting(engine, env);
  const record = path.join(configDir(env), 'install.json');
  const broken = { name: 'the brain install.json names', level: 'core', set: false, proves: 'function', fatal: true,
    unlocks: 'Cogby starting at all: until it is fixed, every hook and the Console stop on the first path lookup' };
  if (setting && !setting.brain) {
    rows.push({ ...broken,
      how: `Point "brain" in ${record} at your brain folder by its absolute path: ${JSON.stringify(setting.value)} is not one` });
  } else if (setting && !isBrain(setting.brain, io)) {
    rows.push({ ...broken,
      how: `Point "brain" in ${record} at your brain folder, or put the brain back: ${setting.brain} holds no .cogby/brain.json` });
  }
  if (brains.length > 1 && !chosenExists && !setting) {
    rows.push({
      name: 'one brain in the program folder', level: 'core', set: false, proves: 'function', fatal: true,
      unlocks: 'Cogby starting at all: with two, every hook and the Console stop on the first path lookup',
      how: `Set COGBY_BRAIN to the one to use, or move the other out of ${engine}: found ${brains.join(' and ')}`,
    });
  }
  if (dotted.length) {
    rows.push({
      name: 'brain folder name', level: brains.length ? 'feature' : 'core', set: false, proves: 'function',
      unlocks: brains.length ? 'a clean program folder' : 'Cogby reading your brain instead of an empty legacy layout',
      how: `${dotted.join(' and ')} ${dotted.length > 1 ? 'hold' : 'holds'} .cogby/brain.json, but Cogby skips folders whose ` +
        `name starts with a dot${brains.length ? '' : ', so it is running without a brain and looks empty'}. ` +
        'Rename it cogby-brain to use it, or move it out of the program folder',
    });
  }
  const explicit = ['COGBY_CONTEXT', 'BRAIN_DIR'].filter((k) => String(env[k] || '').trim());
  if (chosen && explicit.length) {
    rows.push({
      name: 'one setting names the brain', level: 'core', set: false, proves: 'function',
      unlocks: 'Cogby reading and writing the brain you meant',
      how: `COGBY_BRAIN and ${explicit.join(' and ')} are both set. ${explicit[0]} wins and COGBY_BRAIN is ignored; unset one`,
    });
  }
  // Asked even with no child brain: the record or COGBY_BRAIN may name one. The forwarder row stays
  // for a brain directly inside the program; the rows for a brain anywhere else are DOCTOR's.
  const brain = brainInUse(engine, brains, env, io);
  if (brain && isBrain(brain, io) && samePath(path.dirname(brain), engine)) rows.push(forwarderRow(engine, brain, io));
  return rows;
}

module.exports = {
  BRAIN_NAME, FORWARDERS, FORWARDER_HASHES, HIDDEN, EMPTY_MCP, BRAIN_GITIGNORE, INCOMPLETE,
  starterDir, hasStarter, isBrain, createBrain, writeBrainGitignore, markHidden, brainChecks, configDir, installRecord,
};
