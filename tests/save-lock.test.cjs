'use strict';

// The save lock. On 24 and 25 Nov 2026 the brain's .git/index.lock was left behind five times, each
// within seconds of the app closing a chat: the session-end hook was stopped in the middle of a git
// command, and every later save was refused until the lock was removed by hand. Held here:
//
//   - the read-only looks (`git status`) never take git's index lock;
//   - the session-end hook runs no git: it hands the work to a detached helper and returns well
//     inside its 1.5 seconds, and a hook stopped at any moment leaves no lock;
//   - the net: a lock that is old with no git program running is removed before a save, and a
//     fresh one, or one with a git running, is never touched.
//
// tests/manual/lock-sweep.cjs is the same sweep with as many runs as wanted.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn, spawnSync } = require('child_process');
const { ROOT, newBrain, cogby, json, hook, git } = require('./helpers.cjs');
const sweep = require('./manual/lock-sweep.cjs');
const indexLock = require(path.join(ROOT, 'core', 'lib', 'index-lock.cjs'));

const HOOK_BUDGET_MS = 1500;   // what Claude Code gives a SessionEnd hook that asks for nothing more
const base = (box) => ['--brain', box.brain];
const lockOf = (box) => path.join(box.brain, '.git', 'index.lock');
const traceOf = (box) => path.join(box.brain, ...indexLock.TRACE);
const subject = (box) => git(box.brain, ['log', '-1', '--format=%s']);
const commits = (box) => Number(git(box.brain, ['rev-list', '--count', 'HEAD']));

// A lock as a stopped git leaves it: empty, and last touched `minutes` ago.
function leaveLock(box, minutes) {
  fs.writeFileSync(lockOf(box), '');
  const when = new Date(Date.now() - minutes * 60 * 1000);
  fs.utimesSync(lockOf(box), when, when);
}

test('a look at what changed never writes git\'s index, so it takes no lock', (t) => {
  const box = newBrain(t);
  assert.equal(cogby(box, ['wrapup', 'review', ...base(box)]).code, 0);
  const index = path.join(box.brain, '.git', 'index');
  const sum = () => crypto.createHash('sha1').update(fs.readFileSync(index)).digest('hex');
  // A tracked file whose time changed and whose content did not: a plain `git status` takes the
  // index lock to write the new time down. That is the write a stopped hook left half done.
  const touch = () => { const when = new Date(Date.now() - 3600 * 1000 - Math.floor(Math.random() * 1e6)); fs.utimesSync(path.join(box.brain, 'AGENTS.md'), when, when); };
  touch();
  const before = sum();
  // Session start (the baseline), a turn, the scope script, and session end with nothing to commit.
  hook(box, 'brain-context', { session_id: 's1', hook_event_name: 'SessionStart', source: 'startup' });
  const scope = spawnSync(process.execPath, [path.join(ROOT, 'core', 'ops', 'wrapup-scope.cjs'), '--session', 's1', '--root', box.brain], { env: box.env, cwd: box.brain, encoding: 'utf8' });
  assert.equal(scope.status, 0, scope.stderr);
  const end = hook(box, 'session-wrapup', { session_id: 's1', hook_event_name: 'SessionEnd', reason: 'exit' }, { env: { BRAIN_WRAPUP_DRYRUN: '1' } });
  assert.match(end.out, /baseline=found/);
  assert.equal(sum(), before, 'a read-only look rewrote .git/index');
  // The check itself: the plain command does rewrite it.
  git(box.brain, ['status', '--porcelain']);
  assert.notEqual(sum(), before, 'this git no longer refreshes the index on status: the test above proves nothing');
});

test('every git status Cogby runs asks for no lock', () => {
  const files = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.cjs$/.test(entry.name)) files.push(full);
    }
  };
  for (const dir of ['core', path.join('.claude', 'hooks'), 'bin']) walk(path.join(ROOT, dir));
  const unlocked = [];
  let seen = 0;
  for (const file of files) {
    fs.readFileSync(file, 'utf8').split('\n').forEach((line, at) => {
      // A git command spelled as arguments: 'status', … or 'diff', …
      if (!/['"](status|diff)['"]\s*,\s*['"]-/.test(line)) return;
      seen++;
      if (!line.includes('--no-optional-locks')) unlocked.push(`${path.relative(ROOT, file)}:${at + 1}`);
    });
  }
  assert.ok(seen >= 3, 'the scan no longer finds the status calls it is there to hold');
  assert.deepEqual(unlocked, [], 'a read-only git call without --no-optional-locks: stopped half-way it leaves .git/index.lock behind');
});

test('the manifest asks for more time for the session-end hook, as an extra', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, '.claude-plugin', 'plugin.json'), 'utf8'));
  const [entry] = manifest.hooks.SessionEnd[0].hooks;
  assert.match(entry.command, /plugin-hook\.cjs" session-wrapup$/);
  assert.ok(Number.isInteger(entry.timeout) && entry.timeout >= 10 && entry.timeout <= 60, 'SessionEnd declares no usable timeout (seconds, 60 at most)');
});

test('the session-end hook hands the save to a helper, returns inside its time, and the log is committed', { timeout: 120000 }, async (t) => {
  const box = sweep.makeBrain(t);
  const took = [];
  // Left alone, three times: the automatic wrap-up off, then on (review), then off again.
  for (const [n, mode] of [['a', 'off'], ['b', 'review'], ['c', 'off']]) {
    const before = commits(box);
    const run = await sweep.trial(box, { n, mode, kill: 'none' });
    took.push(run.ranMs);
    assert.ok(run.helper, `the hook named no helper: ${run.out}`);
    assert.equal(run.out, `[wrapup] helper started: pid ${run.helper}`, 'in a dry run the hook says one thing: which helper has the work');
    assert.equal(run.helperDone, true, 'the helper never finished');
    assert.equal(run.committed, true, 'the helper did not commit the day\'s log');
    assert.equal(commits(box), before + 1);
    assert.equal(subject(box), `day log: ${path.basename(box.dayLog, '.md')}`);
    assert.deepEqual(run.left, [], 'a lock was left behind');
  }
  // The middle of three, so one slow start on a busy machine does not fail it.
  const median = [...took].sort((a, b) => a - b)[1];
  t.diagnostic(`the hook returned after ${took.join(', ')} ms (budget ${HOOK_BUDGET_MS})`);
  assert.ok(median < HOOK_BUDGET_MS, `the hook took ${took.join(', ')} ms: Claude Code stops it at ${HOOK_BUDGET_MS}`);
  // The dry run reached the helper: with the wrap-up on, it planned the child and started none.
  const gateway = path.join(box.brain, '.cogby', 'self', '.gateway');
  assert.equal(fs.existsSync(path.join(gateway, 'wrapup.log')), false, 'BRAIN_WRAPUP_DRYRUN=1 did not keep the helper from starting a wrap-up child');
  assert.equal(fs.existsSync(path.join(gateway, 'wrapup.lock')), false);
  // A headless child ends too: nothing to commit, and nothing is.
  sweep.dirtyLog(box, 'headless');
  const before = commits(box);
  const child = hook(box, 'session-wrapup', { session_id: 'child', hook_event_name: 'SessionEnd', reason: 'exit' }, { env: { COGBY_SESSION_END_INLINE: '0', BRAIN_WRAPUP_DRYRUN: '1', BRAIN_HEADLESS: '1' } });
  const pid = Number((/pid (\d+)/.exec(child.out) || [])[1]);
  assert.ok(pid, child.out);
  assert.equal(await sweep.waitGone(pid), true);
  assert.equal(commits(box), before);
});

test('a session-end hook stopped at any moment leaves no git lock behind', { timeout: 180000 }, async (t) => {
  const box = sweep.makeBrain(t, { files: 150 });
  // How long the hook lives on this machine, left alone: the moments to stop it at are set by that.
  const calm = await sweep.trial(box, { n: 'calm', mode: 'review', kill: 'none' });
  assert.equal(calm.committed, true);
  // Stopped from its first moment to after it has gone, and the instant it says the helper has the
  // work (the one moment a helper exists while the hook is still there): the whole tree, then the
  // hook alone.
  const moments = [0, 0.6, 'handoff', 0.9, 'handoff', 1.1, 'handoff', 'handoff'].map((part) => (typeof part === 'number' ? Math.round(part * calm.ranMs) : part));
  const runs = [];
  // Eight runs, most with the wrap-up off (a shorter helper), so the test stays near half a minute.
  for (const [at, delay] of moments.entries()) runs.push(await sweep.trial(box, { n: at, mode: at % 3 ? 'off' : 'review', kill: Math.floor(at / 2) % 2 ? 'top' : 'tree', delay }));
  const last = await sweep.trial(box, { n: 'last', mode: 'review', kill: 'none' });
  const when = (run) => (typeof run.delay === 'number' ? `${run.delay}ms` : 'the hand-over');
  t.diagnostic(`left alone the hook ran ${calm.ranMs} ms; stopped at ${runs.map((run) => `${when(run)} ${run.kill}${run.killed ? '' : ' (already gone)'}${run.helper ? ' helper' : ''}`).join(', ')}`);
  const left = [calm, ...runs, last].filter((run) => run.left.length).map((run) => `${when(run)} ${run.kill}: ${run.left.join(' ')}`);
  assert.deepEqual(left, [], 'a lock was left behind');
  // A helper always comes to its end. When the hook had gone by itself, or only the hook was
  // stopped, the helper finished the save. Stopped with the whole tree in the instant after the
  // hand-over, the helper may go too, before it has run any git: the log then waits for the next end.
  for (const run of runs.filter((entry) => entry.helper)) {
    assert.equal(run.helperDone, true, `the helper of the run stopped at ${when(run)} never finished`);
    if (!run.killed || run.kill === 'top') assert.equal(run.committed, true, `the helper of the run stopped at ${when(run)} (${run.kill}) did not commit the day's log`);
  }
  assert.ok(runs.some((run) => run.killed), 'no run was stopped while the hook was running: the moments are too late for this machine');
  // And a run left alone picks up what a hook stopped before it could hand over had left.
  assert.equal(last.committed, true);
  assert.deepEqual(sweep.locks(box), []);
  assert.equal(git(box.brain, ['--no-optional-locks', 'status', '--porcelain', '--', '.cogby/self/log']), '');
});

test('a git program is told from a launcher by its name', () => {
  for (const name of ['git', 'git.exe', 'GIT.EXE', '/usr/bin/git', 'C:\\Program Files\\Git\\cmd\\git.exe', 'git-remote-https.exe', 'git-lfs']) assert.equal(indexLock.isGit(name), true, name);
  for (const name of ['git-bash.exe', 'git-cmd.exe', 'github.exe', 'GitHubDesktop.exe', 'gitk', 'legit.exe', 'bash.exe', 'node.exe', '']) assert.equal(indexLock.isGit(name), false, name);
});

test('an old lock with no git running is removed before a save, and it says so', (t) => {
  const box = newBrain(t);
  assert.deepEqual(indexLock.clearLeftover(box.brain, { gits: () => [] }), { removed: false, why: 'none' });
  leaveLock(box, 11);
  assert.deepEqual(indexLock.clearLeftover(box.brain, { gits: () => [] }), { removed: true, why: 'removed' });
  assert.equal(fs.existsSync(lockOf(box)), false);
  assert.match(fs.readFileSync(traceOf(box), 'utf8'), /^\d{4}-\d\d-\d\dT[^ ]+ removed: \.git\/index\.lock, not touched for 11 min, 0 bytes, no git program running\n$/);
  // The trace is this machine's: never in the brain's history.
  assert.equal(git(box.brain, ['--no-optional-locks', 'status', '--porcelain']), '');
  // And the save that follows goes through.
  const made = json(box, ['log', 'projects/demo', 'Kickoff held', '--source', 'call', '--create', ...base(box)]);
  assert.equal(made.data.commit.committed, true, made.out);
});

test('a fresh lock is never touched', (t) => {
  const box = newBrain(t);
  for (const minutes of [0, 1, 9]) {
    leaveLock(box, minutes);
    let asked = false;
    assert.deepEqual(indexLock.clearLeftover(box.brain, { gits: () => { asked = true; return []; } }), { removed: false, why: 'fresh' });
    assert.equal(asked, false, 'a fresh lock costs no look at the running programs');
    assert.equal(fs.existsSync(lockOf(box)), true);
  }
  assert.ok(indexLock.INDEX_LOCK_STALE_MS >= 5 * 60 * 1000, 'old means minutes, not seconds');
  assert.equal(fs.existsSync(traceOf(box)), false, 'a fresh lock is ordinary: nothing is written about it');
  // Through a real save: git refuses, the write stands, the lock is still there.
  const made = json(box, ['log', 'projects/demo', 'Kickoff held', '--source', 'call', '--create', ...base(box)]);
  assert.equal(made.data.commit.committed, false);
  assert.equal(fs.existsSync(lockOf(box)), true);
});

test('an old lock is left alone while a git is running, or when that cannot be told', (t) => {
  const box = newBrain(t);
  leaveLock(box, 30);
  assert.deepEqual(indexLock.clearLeftover(box.brain, { gits: () => ['git.exe', 'git.exe'] }), { removed: false, why: 'git-running' });
  assert.deepEqual(indexLock.clearLeftover(box.brain, { gits: () => null }), { removed: false, why: 'unknown' });
  assert.equal(fs.existsSync(lockOf(box)), true);
  const lines = fs.readFileSync(traceOf(box), 'utf8').trim().split('\n');
  assert.equal(lines.length, 2);
  assert.match(lines[0], /left alone: \.git\/index\.lock, not touched for 30 min: a git program is running \(git\.exe\)$/);
  assert.match(lines[1], /left alone: \.git\/index\.lock, not touched for 30 min: the running programs could not be listed$/);
  // The owner of the lock finished during the look and another git took a new one: not that one.
  const replaced = indexLock.clearLeftover(box.brain, { gits: () => { fs.rmSync(lockOf(box)); fs.writeFileSync(lockOf(box), 'new'); return []; } });
  assert.deepEqual(replaced, { removed: false, why: 'changed' });
  assert.equal(fs.readFileSync(lockOf(box), 'utf8'), 'new');
});

test('with a real git at work in the brain, an old lock stays and the save says why', { timeout: 60000 }, async (t) => {
  const box = newBrain(t);
  // A git that stays: it waits for object names on its input until that is closed.
  const busy = spawn('git', ['-C', box.brain, 'cat-file', '--batch'], { stdio: ['pipe', 'ignore', 'ignore'], windowsHide: true });
  const gone = new Promise((resolve) => { busy.once('exit', resolve); busy.once('error', resolve); });
  try {
    await new Promise((resolve, reject) => { busy.once('spawn', resolve); busy.once('error', reject); });
    const running = indexLock.runningGits();
    assert.ok(Array.isArray(running), 'the running programs could not be listed on this machine');
    assert.ok(running.length >= 1, 'a running git was not seen');
    leaveLock(box, 30);
    assert.deepEqual(indexLock.clearLeftover(box.brain), { removed: false, why: 'git-running' });
    const made = json(box, ['log', 'projects/demo', 'Kickoff held', '--source', 'call', '--create', ...base(box)]);
    assert.equal(made.code, 0, made.err || made.out);
    assert.equal(made.data.commit.committed, false);
    assert.match(made.data.commit.why, /^git (add|commit): /);
    assert.equal(fs.existsSync(lockOf(box)), true, 'a lock in use was removed');
    assert.match(fs.readFileSync(traceOf(box), 'utf8'), /left alone: [^\n]*a git program is running/);
  } finally {
    // Before the brain's folder is removed: a git still in it holds it on Windows.
    try { busy.stdin.end(); } catch { /* closed */ }
    busy.kill();
    await gone;
  }
});
