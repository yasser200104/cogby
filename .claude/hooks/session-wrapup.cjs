#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { forRoot: R, samePath, isLaunchableBrain, engineCmd, promptRelOr } = require(path.join(__dirname, '..', '..', 'core', 'lib', 'paths.cjs'));
const { spawn, spawnSync, isAlive } = require('../../core/lib/spawn.cjs');
const { projectDirs, transcriptIn } = require('../../core/lib/transcript-store.cjs');
const wrapupScope = require('../../core/lib/wrapup-scope.cjs');
const { flagsFrom } = require('../../core/lib/headless.cjs');
const { rootsFrom, crossesPrivate } = require('../../core/lib/locate.cjs');

const WRAPUP_DEBOUNCE_MS = 3 * 60 * 1000; // don't spawn two wrap-ups within 3 minutes

// The lane list lives in the permission policy; if it cannot load, fall back to wrapping up.
function unattendedLane(lane) {
  try { return require('../../core/runtime/permission-policy.cjs').isUnattended(lane); }
  catch { return false; }
}

const SPAWN_MARK = '--- spawn ';            // delimiter this hook writes into wrapup.log per spawn
const HEALTH_FAIL_THRESHOLD = 3;            // consecutive dead spawns before ONE Inbox card
const DEAD_EMPTY_AFTER_MS = 30 * 60 * 1000;
const AUTH_ERROR = /Failed to authenticate|OAuth session expired|could not be refreshed/i;
const HEALTH_TAIL_BYTES = 64 * 1024;        // enough to hold one child's output; the log is MBs

const WRAPUP_OPENING =
  'You are Cogby, running an AUTOMATIC end-of-session wrap-up in the BACKGROUND. This is headless ' +
  'and non-interactive: there is no owner to answer questions, so NEVER ask anything — use sensible ' +
  'defaults and proceed. Run the wrap-up skill to close out the session that just ended. ';

// The paths and commands in the prompt are spelled from the folder the child starts in (`from`,
// §4.5): `engineCmd` for Cogby's scripts, `promptRelOr` for the substrate files the legacy text
// named bucket-relative. With no brain on disk the child starts at the engine root and every
// string below is byte-identical to what it was.
function spelling(plan) {
  const s = plan.spell || {};
  const engine = s.engine || path.resolve(__dirname, '..', '..');
  const from = s.from || engine;
  const resolver = s.root ? R(s.root) : null;
  return {
    sub: !samePath(from, engine),   // the child is in a subfolder of the repository: the brain
    cmd: (rel) => engineCmd(rel, { from, engine }),
    file: (legacy, ...seg) => (resolver
      ? promptRelOr(legacy, resolver.ctx(...seg), { from, layout: resolver.LAYOUT }) : legacy),
  };
}

function closingClause(sp, plan) {
  // The plugin on its own ships no goal inductor: what waits on the owner is a notification.
  if (plan && plan.local) {
    return 'Leave a notification only for something that waits on the owner\'s decision, per ' +
      'the wrap-up skill; work still open with nothing to decide is a timeline line on the project\'s card.';
  }
  return 'GOAL INDUCTION is handled separately by core/ops/induce-goals.cjs (spawned by this same hook for ' +
  'the exact session that ended) — do NOT create, rename, delete, or guess goal files here. You may ' +
  'only fill `- task:` receipts and route delegable `- open:` items for goals THIS session already ' +
  'appears in (by its session id in ' + sp.file('self/goals/.induct.json', 'self', 'goals', '.induct.json') +
  '), per the wrap-up skill.';
}

// `git status --porcelain` prints paths relative to the repository's top level, and so does
// wrapup-scope, which reads it. A child in the brain is one folder below that, where git would
// read a plain path from the cwd; `:/<path>` is git's own root-relative pathspec. Both arms say
// so (§4.5): the no-baseline arm reads its paths off `git status` exactly the same way.
function scopeClause(sessionId, scope, sp, brain) {
  // `brain` is set when the child does not start in the brain (elsewhereClause): the scope script
  // is then told which tree to answer for, since it would otherwise read the folder it runs in.
  const scopeCmd = sp.cmd('core/ops/wrapup-scope.cjs --session ' + sessionId) + (brain ? ' --root "' + brain + '"' : '');
  if (scope.baseline !== 'found') {
    if (sp.sub) {
      return 'There is NO baseline snapshot for the session that just ended (it opened before scoping ' +
        'shipped, or its SessionStart hook did not run), so its scope is UNKNOWN — which is NOT the ' +
        'same as empty. Review `git status --porcelain` by hand — its paths are relative to the ' +
        'repository root, and you are one folder below it — commit only what plainly belongs to the ' +
        'session that just ended, naming each as git\'s root-relative pathspec ' +
        '(`git commit -F <message-file> -- :/<path> :/<path> …`), and write ' +
        '`scope: unscoped, no session baseline` in the commit message body so the commit is ' +
        'identifiable afterwards. ';
    }
    return 'There is NO baseline snapshot for the session that just ended (it opened before scoping ' +
      'shipped, or its SessionStart hook did not run), so its scope is UNKNOWN — which is NOT the ' +
      'same as empty. Review `git status` by hand, commit only what plainly belongs to the session ' +
      'that just ended, and write `scope: unscoped, no session baseline` in the commit message body ' +
      'so the commit is identifiable afterwards. ';
  }
  if (sp.sub) {
    return 'COMMIT ONLY THE PATHS THAT SESSION DIRTIED. Run ' +
      '`' + scopeCmd + '`: it prints one ' +
      'repo-relative path per line, computed by subtracting a `git status` snapshot taken when the ' +
      'session opened. Those paths are relative to the repository root and you are one folder below ' +
      'it, so commit exactly those as git\'s root-relative pathspecs: ' +
      '`git commit -F <message-file> -- :/<path> :/<path> …`. If it ' +
      'prints nothing, commit NOTHING and finish cleanly — an empty scope is a real answer, not an ' +
      'error. Anything else dirty in this tree belongs to the owner or to a session still open: leave ' +
      'it exactly as it is. ';
  }
  return 'COMMIT ONLY THE PATHS THAT SESSION DIRTIED. Run ' +
    '`' + scopeCmd + '`' + (brain ? '' : ' from the repo root') + ': it prints one ' +
    'repo-relative path per line, computed by subtracting a `git status` snapshot taken when the ' +
    'session opened. Commit exactly those, with `git commit -F <message-file> -- <paths>`. If it ' +
    'prints nothing, commit NOTHING and finish cleanly — an empty scope is a real answer, not an ' +
    'error. Anything else dirty in this tree belongs to the owner or to a session still open: leave ' +
    'it exactly as it is. ';
}

// With a baseline the scope script prints the brain's shared working state with the rest. With
// none, nothing tells the child those files are in scope whichever session changed them, so the
// prompt names the ones that are dirty. Nothing is added when there are none.
function sharedClause(scope) {
  const shared = scope && scope.baseline !== 'found' && Array.isArray(scope.shared) ? scope.shared : [];
  if (!shared.length) return '';
  return 'The brain\'s shared working state is in scope whichever session changed it (the owner\'s to-dos, ' +
    'notes and notifications, and the day\'s log), so commit these too: ' + shared.map((p) => '`' + p + '`').join(', ') + '. ';
}

function trailerClause(sessionId) {
  return 'Make the LAST line of the commit message `Cogby-Wrapup: ' + sessionId + '`, below the ' +
    'Co-Authored-By agent trailer AGENTS.md requires, so the owner can trace an automatic commit ' +
    'back to the session it closed. ';
}

const NO_ROUTE_AROUND =
  'NEVER `git add -A`, `git add .` or `git commit -a`, and never `git reset --hard`, ' +
  '`git checkout -- …`, `git restore`, `git clean` or `git stash` — a dirty tree is the correct ' +
  'outcome here, not something to tidy away before committing. A PreToolUse hook refuses all of ' +
  'those, so there is nothing to work around and no point trying a different tool. ';

// A plugin brain's child starts in the plugin's own folder, where the guard the policy file names
// is (a brain made by the plugin has no program above it for its forwarder to find). Every git
// command in the prompt would then read that folder, so the child is told where the brain is.
function elsewhereBrain(plan) {
  const s = plan.spell || {};
  return plan.local && s.root && s.from && !samePath(s.from, s.root) ? s.root : '';
}

function elsewhereClause(brain) {
  if (!brain) return '';
  return 'The brain is the folder "' + brain + '", and it is its own git repository. You did NOT ' +
    'start in it: run every git command below as `git -C "' + brain + '" …`, never as a bare ' +
    '`git …`, and read and write the brain\'s files by their full path. Commit nothing in the ' +
    'folder you started in. ';
}

function wrapupPrompt(state, plan) {
  const sp = spelling(plan);
  const brain = elsewhereBrain(plan);
  const todayLog = sp.file('self/log', 'self', 'log') + '/';
  if (!state.repo) {
    return WRAPUP_OPENING +
      (brain ? 'The brain is the folder "' + brain + '": read and write its files by their full path. ' : '') +
      'Since you hold none of that session\'s conversation, reconstruct what changed from today\'s ' +
      todayLog + ' entry. This install has NO version history, so do NOT run any git command and do ' +
      'NOT create a repository — a repository is created by `cogby init`, not here. Fold any ' +
      'durable lessons into the right place' + (plan.local ? '' : ', make sure the skill registry is in sync') + ', and stop: ' +
      'there is nothing to commit and nothing to push. If there is nothing to fold, do nothing. ' +
      closingClause(sp, plan);
  }
  // A plugin brain has no Inbox, so its review card is a notification in the brain. Checked before
  // the remote: in review mode nothing is pushed, remote or not.
  const notifyAdd = plan.local ? sp.cmd('core/brain/cli.cjs notify add') + ' --brain "' + plan.spell.root + '"' : '';
  const sync = plan.local
    ? (plan.mode === 'review'
      ? 'This brain is in REVIEW mode: commit locally and do NOT push' +
        (state.remote ? ', even though it has a remote: the owner looks first and pushes when they choose' : '') +
        '. Never add a remote. Then leave exactly one notification in the brain so the owner can look ' +
        'before anything leaves this machine — `' + notifyAdd + ' --title "<one plain sentence the owner can act on>" ' +
        '--body "<the commit hash, the branch, the files>" --source wrap-up --context wrapup-review`. ' +
        'The fixed `--context` refreshes the one still waiting, so a close per session never adds a ' +
        'second. If you committed nothing, leave no notification. Say "committed for review, not pushed" ' +
        'in the summary line. Nothing leaves this machine: push nothing, send no message, call no ' +
        'connector and publish no page. '
      : (state.remote
        ? 'Then PUSH the current branch to the remote it already tracks, as the wrap-up skill describes, so ' +
          'the owner never has to save their brain by hand, and VERIFY it landed with ' +
          '`git rev-list --count @{u}..HEAD` (non-zero means it did not land: say so in one line of ' +
          'the summary and finish cleanly). Push to that one remote only: never add a remote, never ' +
          'push anywhere else, never force-push. '
        : 'This brain has NO remote, so do NOT push and do NOT add one: a missing remote is not an ' +
          'error. Say "local only, no remote" in the summary line. ') +
        'That push is the only thing that leaves this machine: send no message, call no connector ' +
        'and publish no page. ') +
      'There is no Inbox here: where these instructions or the wrap-up skill say ' +
      'to raise an Inbox card, leave a notification in the brain instead, with `' + notifyAdd +
      ' --title "<one sentence the owner can act on>" --body "<the detail>" ' +
      '--source wrap-up --context <the project it is about>`; and record anything you did that the ' +
      'owner did not ask for the same way with `--status acted --reason "<why>" --undo "<how>"`. ' +
      'The command center is rebuilt as the local file only, with `' +
      sp.cmd('core/brain/cli.cjs view --html') + ' --brain "' + plan.spell.root + '"`: you cannot read ' +
      'what the owner sent from the published page, so leave that to their next open session. '
    : plan.mode === 'review'
    ? 'This install is in REVIEW mode: commit locally and do NOT push. Then raise exactly one Inbox ' +
      'card so the owner can look before anything leaves the box — `' + sp.cmd('core/ops/notify.cjs create') + ' ' +
      '--title "<one plain sentence he can act on>" --body "<the commit hash, the branch, the files>" ' +
      '--type review --source wrap-up --context wrapup-review`. The fixed `--context` makes it ' +
      'an upsert, so a card per close refreshes one card instead of spraying the Inbox. '
    : state.remote
      ? 'Then PUSH the current branch as the wrap-up skill describes and VERIFY it landed with ' +
        '`git rev-list --count @{u}..HEAD` (non-zero means it did not land: raise the Inbox card Step 4d-7 ' +
        'specifies, then finish cleanly). Never force-push. '
      : 'This install has NO remote, so do NOT push — a missing remote is not an error ' +
        'Say "local only, no remote" in the summary line. ';
  return WRAPUP_OPENING +
    elsewhereClause(brain) +
    'Since ' +
    'you hold none of that session\'s conversation, reconstruct what changed from `git status`, ' +
    '`git diff`, and today\'s ' + todayLog + ' entry. Fold any durable lessons into the right place' +
    (plan.local ? '. ' : ', make sure the skill registry is in sync. ') +
    scopeClause(plan.sessionId, plan.scope, sp, brain) +
    sharedClause(plan.scope) +
    NO_ROUTE_AROUND +
    trailerClause(plan.sessionId) +
    'Do NOT edit any file under `.claude/skills/`, nor ' + sp.file('context/self/SOUL.md', 'self', 'SOUL.md') + ' or ' +
    sp.file('context/self/USER.md', 'self', 'USER.md') + ': a correction that belongs in a skill\'s `## Rules` goes to the owner ' +
    'as a proposal (' + (plan.local ? 'a notification' : 'the Inbox') + '), never straight into the file. ' +
    sync +
    'Do NOT switch branches. If there is nothing ' +
    'in scope and nothing to fold, do nothing. ' +
    closingClause(sp, plan);
}

function repositoryState(root) {
  const ask = (args) => {
    try { return spawnSync('git', ['-C', root, ...args], { encoding: 'utf8', timeout: 10000 }); }
    catch { return { status: 1 }; }
  };
  const dir = ask(['rev-parse', '--git-dir']);
  const repo = !!dir && dir.status === 0 && !dir.error;
  if (!repo) return { repo: false, remote: false };
  const remotes = ask(['remote']);
  return { repo: true, remote: !!remotes && remotes.status === 0 && String(remotes.stdout || '').trim() !== '' };
}

// Run by plugin-hook.cjs as a detached helper (`--helper`), never inside the SessionEnd hook itself:
// Claude Code gives that hook 1.5 seconds and then stops it wherever it is, and on Windows the git
// it started is stopped with it. A git stopped while it holds .git/index.lock leaves the lock
// behind, and every later save in the brain was then refused (five times on 24 and 25 Nov 2026,
// each within seconds of the app closing a chat). The helper belongs to nobody, so nothing stops it
// half-way; it is handed the same payload on stdin and does everything below in the same order: the
// day-log commit, the scope, the wrap-up child. Run without `--helper` (by hand, or by the tests
// with COGBY_SESSION_END_INLINE=1) this file still does the work in its own process.
const HELPER = process.argv.includes('--helper');
const HOOK_GONE_WAIT_MS = 2000;

// The helper runs its git only once the hook that started it is gone: whatever stops that hook
// together with everything below it then finds nothing of the helper left to stop.
function awaitHookGone() {
  const hook = process.ppid;
  const pause = new Int32Array(new SharedArrayBuffer(4));
  for (const until = Date.now() + HOOK_GONE_WAIT_MS; Date.now() < until;) {
    if (!isAlive(hook)) return;
    Atomics.wait(pause, 0, 0, 20);
  }
}

let input = '';
const stdinTimeout = setTimeout(() => process.exit(0), 4000);
process.stdin.setEncoding('utf8');
process.stdin.on('data', (c) => (input += c));
process.stdin.on('end', () => {
  clearTimeout(stdinTimeout);
  try {
    if (HELPER) {
      // Nothing came through: the hook was stopped before it could hand the payload over. Half of
      // one is refused by main() itself. Either way nothing is done, as when the hook never ran.
      if (!input.trim()) process.exit(0);
      awaitHookGone();
    }
    main();
  } catch {
  }
  process.exit(0);
});

// Set by plugin-hook.cjs for a session that is not in a brain: the person's default brain.
const PLACE_OF = (() => { const at = process.argv.indexOf('--place-of'); return at >= 0 ? String(process.argv[at + 1] || '') : ''; })();

// The day's log reaches the brain's history here, whatever the automatic wrap-up is set to: a plain
// git commit of the day's file, no model, no push. For a session that ran in the brain, or in a
// place that keeps the log (a code repo, a workspace, an environment); a session whose turns were
// not logged (a headless child) has nothing to commit. Never fails the hook.
function commitDayLog(flags, cwd) {
  if (!flags.capture) return;
  const dryRun = process.env.BRAIN_WRAPUP_DRYRUN === '1';
  try {
    let brain;
    if (PLACE_OF) {
      brain = path.resolve(PLACE_OF);
      if (!require('../../core/brain/link.cjs').logPlace(brain, cwd)) return;
    } else {
      const where = rootsFrom(cwd);
      if (!where.inTree) return;
      brain = where.brain;
    }
    if (!fs.existsSync(path.join(brain, '.cogby', 'brain.json'))) return;
    const done = require('../../core/brain/write.cjs').commitDayLogs(brain, R(brain).ctx('self', 'log'));
    if (dryRun) for (const entry of done) process.stdout.write(`[wrapup] day log: ${entry.file} ${entry.committed ? `committed ${entry.sha}` : `not committed (${entry.why})`}\n`);
  } catch { /* the log stays in the working tree for the next session end, or the wrap-up */ }
}

function main() {
  const flags = flagsFrom(process.env);

  let data = {};
  try { data = JSON.parse(input || '{}'); } catch { return; }

  const cwd = data.cwd || process.env.CLAUDE_PROJECT_DIR || process.cwd();
  // A private brain is sealed both ways: a session that ends in another brain than the one it was
  // opened in, with a private brain among them, saves nothing (core/lib/locate.cjs crossesPrivate).
  if (crossesPrivate(cwd)) return;
  commitDayLog(flags, cwd);
  // Outside a brain there is nothing else to do: the automatic wrap-up is a brain session's.
  if (PLACE_OF) return;
  if (!flags.wrapup && !flags.induct) return;

  const reason = String(data.reason || '').toLowerCase();
  if (reason === 'clear') return;

  // `root` is the brain: the substrate, the git tree it is scoped against, every child's cwd.
  // `engine` is where the files this hook RUNS live — the policy file, claude-auth, notify, the
  // inductor. With no brain on disk the two are the same folder.
  const { engine, brain: root, inTree } = rootsFrom(cwd);
  // Not a brain and not an install: nothing here is Cogby's to lock, log, commit or wrap up.
  if (!inTree) {
    if (process.env.BRAIN_WRAPUP_DRYRUN === '1') process.stdout.write('[wrapup] skip: this folder is not a brain or an install\n');
    return;
  }

  const dryRun = process.env.BRAIN_WRAPUP_DRYRUN === '1';

  // Both children below run with nobody watching, and what they may do is decided by the policy
  // files beside this hook. The plugin ships them unchanged (.claude-plugin/ship.json); a plugin
  // folder that somehow lacks them starts neither child: an unattended child with no gate is not a
  // smaller feature, it is a different one.
  const pluginOnly = require('../../core/lib/plugin-only.cjs').isPluginOnly(engine);
  if (pluginOnly && !PLUGIN_GATES.every((file) => fs.existsSync(path.join(engine, '.claude', file)))) {
    if (dryRun) process.stdout.write('[wrapup] skip: the plugin carries no wrap-up policy, so no unattended child is started\n');
    return;
  }

  if (flags.induct) induceEndedSession(root, engine, String(data.session_id || '').trim());
  else if (dryRun) process.stdout.write('[wrapup] skip induction: BRAIN_NO_INDUCT\n');

  if (!flags.wrapup) {
    if (dryRun) process.stdout.write('[wrapup] skip: BRAIN_NO_WRAPUP\n');
    return;
  }

  const repoState = repositoryState(root);

  const mode = wrapupScope.readMode(root);
  if (mode === 'off') {
    if (dryRun) process.stdout.write('[wrapup] skip: mode=off (automatic wrap-up disabled by the owner)\n');
    return;
  }

  if (process.env.BRAIN_TASK_CHILD === '1') {
    if (dryRun) process.stdout.write('[wrapup] skip: run-task plan/execute child (BRAIN_TASK_CHILD=1)\n');
    return;
  }

  // A routine, heartbeat or other unattended run is not a session anyone closed. Wrapping it up
  // spent a model call per fire and, on Windows, opened a terminal window for every command the
  // detached wrap-up child ran (reproduced 2026-09-30).
  const lane = String(process.env.BRAIN_LANE || '').trim();
  if (lane && unattendedLane(lane)) {
    if (dryRun) process.stdout.write(`[wrapup] skip: unattended lane (${lane})\n`);
    return;
  }

  if (!sessionProducedWork(root, engine, data)) {
    if (dryRun) process.stdout.write('[wrapup] skip: session produced no transcript content\n');
    return;
  }

  const lockDir = R(root).ctx('self', '.gateway');
  const lockPath = path.join(lockDir, 'wrapup.lock');
  const now = Date.now();
  try {
    const last = Number(fs.readFileSync(lockPath, 'utf8').trim());
    if (Number.isFinite(last) && now - last < WRAPUP_DEBOUNCE_MS) return;
  } catch { /* no lock yet → proceed */ }

  const logPath = R(root).ctx('self', '.gateway', 'wrapup.log');
  const health = gradeLastSpawn(root, engine, logPath, dryRun);

  const sessionId = String(data.session_id || '').trim();
  const scope = repoState.repo
    ? wrapupScope.scopeFor(root, sessionId)
    : { paths: [], baseline: 'missing', head: null };

  const policyFile = path.join(engine, '.claude', 'wrapup-policy.json');
  const settingsArgs = fs.existsSync(policyFile) ? ['--settings', policyFile] : [];

  // The child starts in the brain (§4.3), but only where the policy file's hook command — spelled
  // from the folder the session starts in, so in the brain it names the brain's forwarder
  // (`.claude/hooks/wrapup-guard.cjs`) — reaches the engine's guard: the same test every
  // other spawner asks (paths.isLaunchableBrain). Anywhere else this auto-mode, commit-and-push
  // child would run with no gate at all, so it starts at the engine. Started in the brain, it
  // names the engine as an extra folder, as every other session does. `--add-dir` sits before a
  // flag, never last: it takes every operand that follows it.
  const childCwd = samePath(root, engine) || isLaunchableBrain(root, engine) ? root : engine;
  const inEngine = path.relative(engine, childCwd);
  const addDirArgs = inEngine && !inEngine.startsWith('..') && !path.isAbsolute(inEngine) ? ['--add-dir', engine] : [];

  // A plugin brain has no Console and no Inbox. In auto mode its wrap-up saves the brain to the
  // brain's own remote when it has one (owner, 2026-11-10: people should not have to manage their
  // memory by hand); in review mode it commits and leaves a notification. It reaches nothing else
  // (see PLUGIN_CHILD below).
  const plan = { mode, scope, sessionId, local: pluginOnly, spell: { from: childCwd, engine, root } };
  const prompt = wrapupPrompt(repoState, plan);
  const healthFile = spelling(plan).file('context/self/.gateway/wrapup-health.json', 'self', '.gateway', 'wrapup-health.json');
  const args = [...settingsArgs, ...addDirArgs, ...(pluginOnly ? PLUGIN_CHILD.args : []), '--print', '--permission-mode', 'auto',
    health.fails > 0
      ? prompt + ' NOTE: the previous wrap-up child did not run (' + health.verdict + ', ' +
        health.fails + ' in a row), so the session it should have closed was never closed and its ' +
        'changes are still in this working tree. Scope the commit for both. ' +
        healthFile + ' and the tail of wrapup.log carry the detail.'
      : prompt];

  if (dryRun) {
    process.stdout.write(
      `[wrapup] would spawn: claude ${args.slice(0, -1).join(' ')} ${process.env.BRAIN_WRAPUP_SHOW_PROMPT === '1' ? args[args.length - 1] : '<prompt>'}\n` +
      `[wrapup] cwd=${childCwd} reason=${reason || '(none)'} log=${logPath}\n` +
      `[wrapup] repo=${repoState.repo ? 'yes' : 'no'} remote=${repoState.remote ? 'yes' : 'no'}\n` +
      `[wrapup] mode=${mode} baseline=${scope.baseline} paths=${scope.paths.length}\n` +
      (pluginOnly ? `[wrapup] plugin brain: ${mode === 'review' ? 'review, commit only, no push, one notification' : repoState.remote ? 'push to its own remote' : 'no remote, no push'}, no connectors (${PLUGIN_CHILD.args.join(' ')})\n` : '') +
      `[wrapup] last spawn: ${health.verdict} · consecutive dead: ${health.fails}` +
      `${health.carded ? ' · card raised' : ''}\n`
    );
    return;
  }

  if (!repoState.repo) raiseNoRepoCard(root, engine);

  try {
    const authPath = path.join(engine, 'core', 'runtime', 'claude-auth.cjs');
    if (fs.existsSync(authPath)) require(authPath).hydrate();
  } catch { /* fail-open */ }

  try { fs.mkdirSync(lockDir, { recursive: true }); fs.writeFileSync(lockPath, String(now)); } catch { /* fail-open */ }

  const stamp = new Date(now).toISOString();
  try { fs.appendFileSync(logPath, `\n${SPAWN_MARK}${stamp} ---\n`); } catch { /* fail-open */ }
  recordSpawn(root, health, stamp);

  let out = 'ignore';
  try { out = fs.openSync(logPath, 'a'); } catch { out = 'ignore'; }
  try {
    // Not the outer session's CLAUDE_PROJECT_DIR/CLAUDECODE: they describe the session that just
    // ended, never the child's own (§4.3).
    const childEnv = { ...process.env, BRAIN_HEADLESS: '1' }; // the child's own hooks: no capture, wrap-up or goal
    delete childEnv.CLAUDE_PROJECT_DIR;
    delete childEnv.CLAUDECODE;
    // The real executable, not the npm shim. On Windows the shim is claude.cmd, which spawn.cjs has
    // to run through cmd.exe, and a child started that way dies the moment this hook exits: every
    // automatic wrap-up on Windows ended with an empty log (measured 2026-11-10, 48 in a row).
    // claude.exe started directly and detached outlives the hook.
    let binary = 'claude';
    try { binary = require('../../core/lib/claude-bin.cjs').claudeBinary(childEnv); } catch { /* fall back to the name on PATH */ }
    const child = spawn(binary, args, {
      cwd: childCwd,
      detached: true,
      stdio: ['ignore', out, out],
      env: childEnv,
    });
    child.on('error', () => {}); // claude missing / spawn failure → never surface onto the session
    child.unref();
  } catch { /* fail-open */ }
}

// The gate files the plugin must hold before it starts an unattended child.
// The policy file the child is started under and the guard that file names: the two that hold it.
const PLUGIN_GATES = Object.freeze(['wrapup-policy.json', path.join('hooks', 'wrapup-guard.cjs')]);

// What a plugin brain's automatic wrap-up may reach. It commits, and in auto mode pushes the brain to
// the remote the brain already tracks: that is the save, and the guard refuses a force push. Nothing else goes
// out: no MCP server is loaded, and the person's mail, drive and chat connectors are MCP servers. The
// brain view is refreshed as the local file, since a headless child cannot publish it.
const PLUGIN_CHILD = Object.freeze({ args: Object.freeze(['--strict-mcp-config']) });

function healthPath(root) { return R(root).ctx('self', '.gateway', 'wrapup-health.json'); }

function gradeLastSpawn(root, engine, logPath, dryRun) {
  const st = { fails: 0, carded: false, lastSpawn: null, verdict: 'unknown' };
  try { Object.assign(st, JSON.parse(fs.readFileSync(healthPath(root), 'utf8'))); } catch { /* first run */ }
  st.verdict = 'unknown';
  if (!st.lastSpawn) return st;            // nothing graded yet (first fire after this shipped)

  const seg = segmentSinceMark(logPath);
  if (seg === null) return st;             // no mark in the tail → nothing gradeable

  const startedMs = Date.parse(st.lastSpawn);
  const lines = seg.split('\n').map((l) => l.trim()).filter(Boolean);
  const authDead = lines.length > 0 && lines.every((l) => AUTH_ERROR.test(l));
  const silent = lines.length === 0 && Number.isFinite(startedMs)
    && Date.now() - startedMs > DEAD_EMPTY_AFTER_MS;

  if (authDead || silent) {
    st.fails = (Number.isFinite(st.fails) ? st.fails : 0) + 1;
    st.verdict = authDead ? 'dead (credential)' : 'dead (silent)';
    if (st.fails >= HEALTH_FAIL_THRESHOLD && !st.carded && !dryRun) {
      st.carded = raiseWrapCard(root, engine, st, logPath);
    }
  } else if (lines.length) {
    st.verdict = 'ok';
    st.fails = 0;
    st.carded = false;
  } else {
    st.verdict = 'running';                // empty but young — the child is probably still working
  }
  return st;
}

function segmentSinceMark(logPath) {
  try {
    const size = fs.statSync(logPath).size;
    const start = Math.max(0, size - HEALTH_TAIL_BYTES);
    const len = size - start;
    if (len <= 0) return null;
    const fd = fs.openSync(logPath, 'r');
    const buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, start);
    fs.closeSync(fd);
    const text = buf.toString('utf8');
    const at = text.lastIndexOf(SPAWN_MARK);
    if (at < 0) return null;
    const nl = text.indexOf('\n', at);
    return nl < 0 ? '' : text.slice(nl + 1);
  } catch { return null; }
}

function recordSpawn(root, health, stamp) {
  try {
    fs.mkdirSync(path.dirname(healthPath(root)), { recursive: true });
    fs.writeFileSync(healthPath(root), JSON.stringify({
      fails: health.fails || 0,
      carded: !!health.carded,
      lastSpawn: stamp,
      lastVerdict: health.verdict,
    }, null, 2) + '\n');
  } catch { /* fail-open */ }
}

// Where the program has no Inbox script (the plugin on its own), the card is a notification kept in
// the brain, which the command center shows. False when there is no brain to keep it in.
function brainCard(root, title, body, context) {
  try {
    if (!fs.existsSync(path.join(root, '.cogby', 'brain.json'))) return false;
    require('../../core/brain/notify.cjs').add(root, { title, body, source: 'wrapup-hook', context });
    return true;
  } catch { return false; }
}

function raiseWrapCard(root, engine, st, logPath) {
  const script = path.join(engine, 'core', 'ops', 'notify.cjs');
  const title = 'Session wrap-ups are failing, so closed sessions are not being committed';
  const about = [
    `The SessionEnd wrap-up spawn has failed ${st.fails} times in a row: ${st.verdict}.`,
    '',
    'Until it runs again, closing a session commits nothing and folds no lessons.',
    `Log: ${logPath}`,
  ];
  if (!fs.existsSync(script)) {
    return brainCard(root, title, [...about, '', 'Check that Claude Code still runs and is signed in on this machine.'].join('\n'), 'wrapup-health');
  }
  const body = [...about, '', 'Check the credential with: node core/runtime/claude-auth.cjs --deep'].join('\n');
  const r = spawnSync(process.execPath, [script, 'create',
    '--title', title,
    '--body', body,
    '--type', 'review',
    '--source', 'wrapup-hook',
    '--context', 'wrapup-health',
  ], { cwd: root, stdio: 'ignore', timeout: 10000 });
  return !r.error && r.status === 0;
}

function raiseNoRepoCard(root, engine) {
  const script = path.join(engine, 'core', 'ops', 'notify.cjs');
  if (!fs.existsSync(script)) {
    return brainCard(root, 'Install git so Cogby can save your work when a session closes',
      `This brain (${root}) is not under version control, so closing a session saves nothing.\n\n`
      + 'Install git, then run `git init` in the brain and make a first commit. Nothing is sent anywhere.',
      'no-version-history');
  }
  const body = [
    `This Cogby install (${root}) is not under version control, so closing a session saves nothing.`,
    '',
    'Install git, then run `cogby init` in this folder: it creates a local repository here and makes one',
    'baseline commit. Nothing is sent anywhere — there is no remote and none is created.',
  ].join('\n');
  const r = spawnSync(process.execPath, [script, 'create',
    '--title', 'Install git so Cogby can save your work when a session closes',
    '--body', body,
    '--type', 'review',
    '--source', 'wrapup-hook',
    '--context', 'no-version-history',
  ], { cwd: root, stdio: 'ignore', timeout: 10000 });
  return !r.error && r.status === 0;
}

const CONTENT_SCAN_MAX_BYTES = 256 * 1024; // anything larger is content by definition; don't parse MBs
function sessionProducedWork(root, engine, data) {
  let file = String(data.transcript_path || '').trim();
  if (!file) {
    const id = String(data.session_id || '').trim();
    if (!id) return true; // nothing identifies the session → wrap
    // The brain's folder and the engine's (§4.4): a session opened in either lands in its own.
    const dirs = projectDirs({ brain: root, engine }, { override: '' }).filter((d) => fs.existsSync(d));
    if (!dirs.length) return true; // can't confirm the convention holds here → wrap
    file = transcriptIn(dirs, id);
  }
  let st;
  try { st = fs.statSync(file); } catch { return false; } // no transcript → the session did nothing
  if (!st.isFile()) return true;
  if (st.size === 0) return false;
  if (st.size > CONTENT_SCAN_MAX_BYTES) return true;
  try {
    for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
      if (!line.trim()) continue;
      let row;
      try { row = JSON.parse(line); } catch { return true; } // malformed → don't risk a real session
      if ((row.type === 'user' || row.type === 'assistant') && row.message) return true;
    }
  } catch { return true; } // unreadable → wrap
  return false; // parsed clean, zero turns
}

const INDUCT_DEBOUNCE_MS = 90 * 1000;
function induceEndedSession(root, engine, sessionId) {
  if (!sessionId) return;
  const script = path.join(engine, 'core', 'ops', 'induce-goals.cjs');
  if (!fs.existsSync(script)) return;
  const gwDir = R(root).ctx('self', '.gateway');
  const lockPath = path.join(gwDir, `induct-${sessionId.slice(0, 8)}.lock`);
  const now = Date.now();
  try {
    const last = Number(fs.readFileSync(lockPath, 'utf8').trim());
    if (Number.isFinite(last) && now - last < INDUCT_DEBOUNCE_MS) return;
  } catch { /* no lock → proceed */ }

  if (process.env.BRAIN_WRAPUP_DRYRUN === '1') {
    process.stdout.write(`[wrapup] would induce: node core/ops/induce-goals.cjs --session ${sessionId}\n`);
    return;
  }
  try { fs.mkdirSync(gwDir, { recursive: true }); fs.writeFileSync(lockPath, String(now)); } catch { /* fail-open */ }
  let out = 'ignore';
  try { out = fs.openSync(path.join(gwDir, 'induct.log'), 'a'); } catch { out = 'ignore'; }
  try {
    const child = spawn(process.execPath, [script, '--session', sessionId], {
      cwd: root,
      detached: true,
      stdio: ['ignore', out, out],
      env: { ...process.env, BRAIN_HEADLESS: '1' },
    });
    child.on('error', () => {});
    child.unref();
  } catch { /* fail-open */ }
}
