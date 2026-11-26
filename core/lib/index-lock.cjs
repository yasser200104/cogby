'use strict';

// The safety net for a save lock nobody holds (the owner's yes of 2026-11-25).
//
// git takes <brain>/.git/index.lock for the length of a change to its index and removes it when it
// is done. A git that is stopped half-way (its process ended, the machine switched off) cannot
// remove it, and from then on every commit in the brain is refused until somebody deletes the file.
// Before a save (write.cjs commitFile) Cogby looks, and removes the lock itself only when all of
// this holds:
//
//   - it is old: not touched for INDEX_LOCK_STALE_MS, minutes and not seconds. No save of Cogby's
//     holds the lock for longer than a moment;
//   - no git program is running on this machine. The list gives names, not the folder each one
//     works in, so any git at all counts as "may be using the brain": a `git commit` waiting on
//     its editor holds the lock for as long as the editor is open;
//   - it is still that same old file after the look at the running programs.
//
// A fresh lock, a lock with a git running, and a machine whose programs cannot be listed: never
// touched. The commit then fails the way git reports it, the write stands (write.cjs), and the next
// save looks again. A removal, and an old lock that was left alone, each leave one line in
// <brain>/.cogby/self/.gateway/save-lock.log, a file of this machine that is never committed.
//
// This is the net, not the fix: the session-end hook no longer runs git where it can be stopped
// (.claude/hooks/plugin-hook.cjs), and the read-only looks no longer take the lock at all.

const fs = require('fs');
const path = require('path');

const INDEX_LOCK_STALE_MS = 10 * 60 * 1000;
const LIST_TIMEOUT_MS = 15000;
const TRACE = ['.cogby', 'self', '.gateway', 'save-lock.log'];

const lockFile = (brain) => path.join(brain, '.git', 'index.lock');

// A process that is git: `git`, `git.exe`, or one of its own helpers (`git-remote-https`). Git for
// Windows also ships two launchers that only open a terminal, `git-bash.exe` and `git-cmd.exe`: a
// git run inside one is a `git.exe` of its own, so the launchers are not counted.
function isGit(name) {
  const base = String(name || '').trim().replace(/^.*[\\/]/, '').replace(/\.exe$/i, '').toLowerCase();
  return /^git(-[\w.-]+)?$/.test(base) && base !== 'git-bash' && base !== 'git-cmd';
}

// The git programs running on this machine, by name: an empty list when there are none, null when
// that cannot be told. Names only: they are there for every process, also one of another user,
// where a command line is not. On Windows the list is asked for by name (`git*`): the whole list
// takes many seconds on a busy machine, and this runs inside a save.
function runningGits() {
  try {
    const { spawnSync, systemBinary } = require('./spawn.cjs');
    const options = { encoding: 'utf8', timeout: LIST_TIMEOUT_MS, maxBuffer: 16 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] };
    if (process.platform === 'win32') {
      const listed = spawnSync(systemBinary('tasklist.exe'), ['/FI', 'IMAGENAME eq git*', '/FO', 'CSV', '/NH'], options);
      // With none running it still prints one line saying so. No output at all is no answer.
      if (!listed || listed.error || listed.status !== 0 || !String(listed.stdout || '').trim()) return null;
      return String(listed.stdout).split(/\r?\n/).map((line) => (/^"([^"]+)"/.exec(line) || [])[1]).filter(Boolean).filter(isGit);
    }
    const listed = spawnSync('ps', ['-A', '-o', 'comm='], options);
    if (!listed || listed.error || listed.status !== 0) return null;
    const names = String(listed.stdout || '').split('\n').map((line) => line.trim()).filter(Boolean);
    // A list with nothing in it is a list that did not work: this process at least is running.
    return names.length ? names.filter(isGit) : null;
  } catch { return null; }
}

function trace(brain, text, now) {
  try {
    const file = path.join(brain, ...TRACE);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, `${new Date(now).toISOString()} ${text}\n`);
  } catch { /* the trace never fails a save */ }
}

const minutes = (ms) => `${Math.floor(ms / 60000)} min`;

// Looks at the brain's index lock and removes it when it is old and no git is running. Returns
// { removed, why }: why is 'none' (no lock), 'fresh', 'git-running', 'unknown' (the running programs
// could not be listed), 'changed' (it is not the same file any more), 'failed' or 'removed'. Never
// throws. `deps` is for the tests: now(), gits() and staleMs.
function clearLeftover(brain, deps = {}) {
  const now = deps.now || Date.now;
  const staleMs = deps.staleMs || INDEX_LOCK_STALE_MS;
  const file = lockFile(brain);
  const look = () => { try { const stat = fs.statSync(file); return stat.isFile() ? stat : null; } catch { return null; } };
  try {
    const first = look();
    if (!first) return { removed: false, why: 'none' };
    const age = now() - first.mtimeMs;
    if (!(age > staleMs)) return { removed: false, why: 'fresh' };
    const gits = (deps.gits || runningGits)();
    if (!Array.isArray(gits)) {
      trace(brain, `left alone: .git/index.lock, not touched for ${minutes(age)}: the running programs could not be listed`, now());
      return { removed: false, why: 'unknown' };
    }
    if (gits.length) {
      trace(brain, `left alone: .git/index.lock, not touched for ${minutes(age)}: a git program is running (${[...new Set(gits)].join(', ')})`, now());
      return { removed: false, why: 'git-running' };
    }
    // The look at the programs took a moment. The owner of the lock may have finished in it and
    // another git taken a new one: only the file first seen is removed.
    const again = look();
    if (!again || again.mtimeMs !== first.mtimeMs || again.size !== first.size || again.ino !== first.ino) return { removed: false, why: 'changed' };
    try { fs.rmSync(file); } catch (error) {
      trace(brain, `could not remove .git/index.lock, not touched for ${minutes(age)}: ${error.code || error.message}`, now());
      return { removed: false, why: 'failed' };
    }
    trace(brain, `removed: .git/index.lock, not touched for ${minutes(age)}, ${first.size} bytes, no git program running`, now());
    return { removed: true, why: 'removed' };
  } catch { return { removed: false, why: 'failed' }; }
}

module.exports = { clearLeftover, runningGits, isGit, lockFile, INDEX_LOCK_STALE_MS, TRACE };
