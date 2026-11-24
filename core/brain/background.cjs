'use strict';

// The background sync: `cogby sync --quick --background`, started as a detached process that nobody
// waits for. It is what keeps the kept index up to date now that a read answers from index.db as it
// is (see the header of db.cjs). No watcher and no daemon: the process reads what changed and exits.
//
// Who starts one: the session-start hook and the after-each-turn hook (.claude/hooks/plugin-hook.cjs),
// and any read that finds the last sync older than a minute (withIndex in brain.cjs).
//
// One at a time. <brain>/.cogby/sync.lock is made by whoever starts the sync, before the child
// exists, so two readers arriving together start one sync and not two. The starter writes the
// child's process id into it as soon as there is one (the starter itself may be gone a moment
// later), and the child removes the file when it is done. A lock whose process is gone, or that has
// not been touched for LOCK_STALE_MS, is a crashed sync: it is taken over.
//
// COGBY_NO_BACKGROUND_SYNC=1 turns the background sync off: reads then see only what `cogby sync`
// and Cogby's own writes put in the index. The tests set it, so no test leaves a process behind.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { indexPath } = require('./db.cjs');

const LOCK = ['.cogby', 'sync.lock'];
const LOCK_STALE_MS = 10 * 60 * 1000;
const TOKEN_ENV = 'COGBY_SYNC_LOCK';
const CLI = path.join(__dirname, 'cli.cjs');

const lockFile = (brain) => path.join(brain, ...LOCK);
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (error) { return !!(error && error.code === 'EPERM'); } };

// The lock as it stands: null when there is none, else { pid, token, at, stale }.
function lockState(brain, now = Date.now()) {
  const file = lockFile(brain);
  let stat;
  try { stat = fs.statSync(file); } catch { return null; }
  let held = {};
  try { held = JSON.parse(fs.readFileSync(file, 'utf8')) || {}; } catch { /* half written, or not ours: judged by its age */ }
  const pid = Number.isInteger(held.pid) && held.pid > 0 ? held.pid : null;
  const age = now - stat.mtimeMs;
  // A lock a moment old with nothing readable in it is one being written right now.
  const stale = age > LOCK_STALE_MS || (pid ? !alive(pid) : age > 5000);
  return { pid, token: typeof held.token === 'string' ? held.token : null, at: stat.mtimeMs, stale };
}

// Takes the lock, or returns null when a live sync holds it. Returns the token that names this hold.
function acquire(brain, options = {}) {
  const file = lockFile(brain);
  const token = crypto.randomBytes(8).toString('hex');
  const body = JSON.stringify({ pid: options.pid || process.pid, token, started: new Date().toISOString() });
  fs.mkdirSync(path.dirname(file), { recursive: true });
  for (let attempt = 0; attempt < 2; attempt++) {
    try { fs.writeFileSync(file, body, { flag: 'wx' }); return token; }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const held = lockState(brain);
      if (held && !held.stale) return null;
      try { fs.rmSync(file, { force: true }); } catch { return null; }
    }
  }
  return null;
}

// A lock already held under `token` is put in the name of `pid`: the child a starter just made, or
// the child itself.
function adopt(brain, token, pid = process.pid) {
  const held = lockState(brain);
  if (!held || !token || held.token !== token) return false;
  try { fs.writeFileSync(lockFile(brain), JSON.stringify({ pid, token, started: new Date().toISOString() })); return true; }
  catch { return false; }
}

function release(brain, token) {
  const held = lockState(brain);
  if (held && held.token === token) { try { fs.rmSync(lockFile(brain), { force: true }); } catch { /* gone already */ } }
}

const beat = (brain) => { const now = new Date(); try { fs.utimesSync(lockFile(brain), now, now); } catch { /* the lock is gone: the pass still finishes */ } };

const disabled = (env) => String(env.COGBY_NO_BACKGROUND_SYNC || '').trim() === '1';

// Starts a background sync and returns at once: { started: true, pid } or { started: false, why }.
// `why` is 'off' (switched off by the environment), 'no-index' (the index is switched off or not
// built yet: there is nothing to keep up to date, and the next command reads the files itself),
// 'running' (one is already at work) or 'failed'.
function start(brain, options = {}) {
  const env = options.env || process.env;
  if (disabled(env)) return { started: false, why: 'off' };
  const { indexWanted } = require('./brain.cjs');
  if (!indexWanted(brain) || !fs.existsSync(indexPath(brain))) return { started: false, why: 'no-index' };
  let token = null;
  try { token = acquire(brain); } catch { return { started: false, why: 'failed' }; }
  if (!token) return { started: false, why: 'running' };
  try {
    // Detached, with no stdio, so the caller can exit while it works; hidden, so Windows opens no
    // console window for it. The spawn module adds windowsHide to every child.
    const { spawn } = require('../lib/spawn.cjs');
    const child = spawn(process.execPath, [CLI, 'sync', '--quick', '--background', '--brain', brain],
      { detached: true, stdio: 'ignore', windowsHide: true, cwd: brain, env: { ...env, [TOKEN_ENV]: token } });
    child.on('error', () => release(brain, token));
    child.unref();
    if (!child.pid) { release(brain, token); return { started: false, why: 'failed' }; }
    adopt(brain, token, child.pid);
    return { started: true, pid: child.pid };
  } catch {
    release(brain, token);
    return { started: false, why: 'failed' };
  }
}

// The child's side: `cogby sync --quick --background`. Holds the lock for the length of one quick
// pass. Run by hand it takes the lock itself, and says so when another sync has it.
function run(brain, options = {}) {
  const env = options.env || process.env;
  const { sync } = require('./brain.cjs');
  let token = env[TOKEN_ENV] && adopt(brain, env[TOKEN_ENV]) ? env[TOKEN_ENV] : null;
  if (!token) token = acquire(brain);
  if (!token) return { background: true, skipped: 'running' };
  try {
    return { background: true, ...sync(brain, { quick: true, beat: () => beat(brain) }) };
  } finally { release(brain, token); }
}

module.exports = { start, run, acquire, adopt, release, lockState, lockFile, LOCK_STALE_MS, TOKEN_ENV };
