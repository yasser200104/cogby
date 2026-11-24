'use strict';

// Whether a folder is the TOP of its own git repository, and how a brain gets one (brain-split
// SETUP's rule, read from core). The brain is the owner's version history; the program folder is
// replaced whole by every update and holds no history of the owner's work. So every commit Cogby
// makes on its own runs with the brain as git's directory, and only when the brain is its own
// repository — a brain sitting inside someone else's clone keeps that clone's history, and a
// commit made there recorded the brain as a gitlink nobody can fetch.
//
// `git rev-parse --show-prefix` answers both questions at once: it fails outside a repository, and
// inside one it prints the path from the top down to this folder, so an empty answer means "this
// folder IS the top". No path comparison: a junction, a macOS /tmp symlink or a worktree makes
// string equality the wrong test, and git already knows the answer.
//
// Node built-ins and core/lib/spawn.cjs only: core never loads the CLI, so cli/lib/installation.cjs
// ensureRepository (which does this for a brain setup lays out) is a sibling implementation of the
// same discipline, not a dependency. workspace/tests/brain-commits.test.mjs holds this one to the
// rule, from the engine's side.

const fs = require('fs');
const path = require('path');

const TIMEOUT_MS = 60000;

// `run(args)` is the caller's git, handed the whole argv including `-C <dir>`, which is how
// brain-migration.cjs spells its own. Nothing here throws: a machine without git still works.
function gitIn(dir, options = {}) {
  const run = options.run || ((args) => require('./spawn.cjs').spawnSync('git', args,
    { cwd: dir, encoding: 'utf8', timeout: TIMEOUT_MS, windowsHide: true }));
  return (...args) => {
    let result;
    try { result = run(['-C', dir, ...args]); } catch (error) { result = { status: null, error }; }
    result = result || { status: null };
    return {
      ok: result.status === 0 && !result.error,
      out: String(result.stdout || '').trim(),
      err: String(result.stderr || '').trim() || (result.error ? String(result.error.message) : ''),
    };
  };
}

// true only when `dir` is the top of a repository of its own.
function ownRepository(dir, options = {}) {
  const prefix = gitIn(dir, options)('rev-parse', '--show-prefix');
  return { repo: prefix.ok && prefix.out === '', prefix: prefix.ok ? prefix.out : null, why: prefix.ok ? null : prefix.err };
}

// Gives `dir` a repository and one baseline commit, the way setup does for a brain it lays out: the
// repository it already has is kept, a repository it sits inside is left as the history it is, and
// a failure is reported rather than thrown — degrading beats refusing to finish a move.
function ensureRepository(dir, options = {}) {
  const io = options.fs || fs;
  const git = gitIn(dir, options);
  // A .git that is THERE is not the same as a repository. git packs its loose refs away on its own
  // (`gc --auto` runs pack-refs), which leaves .git/refs an empty folder, and a .git may be a
  // gitlink FILE a worktree left; either way git refuses the folder while existsSync says yes. An
  // "already a repository" answer there is the worst of both: never inited, never committed in, and
  // reported as a success, so the brain keeps a history nothing can read and can never get one.
  if (io.existsSync(path.join(dir, '.git'))) {
    const own = ownRepository(dir, options);
    if (own.repo) return { ok: true, already: true };
    return { ok: false, already: true, why: `${path.join(dir, '.git')} is there but git cannot read it (${own.why || 'not a repository'})` };
  }
  const top = git('rev-parse', '--show-toplevel');
  if (top.ok && top.out) return { ok: true, already: true, nested: true, toplevel: top.out };

  const init = git('init', '-q');
  if (!init.ok) return { ok: false, why: `git init: ${init.err || 'failed'}` };
  // Not `init -b main`, which needs git >= 2.28.
  git('symbolic-ref', 'HEAD', 'refs/heads/main');
  // Repo-local, and only when the machine has none: the owner's global config is theirs.
  let identity = 'global';
  if (!git('config', 'user.name').out || !git('config', 'user.email').out) {
    identity = 'repo-local';
    if (!git('config', 'user.name').out) git('config', 'user.name', 'Cogby');
    if (!git('config', 'user.email').out) git('config', 'user.email', 'cogby@localhost');
  }
  const add = git('add', '-A');
  if (!add.ok) return { ok: false, why: `git add: ${add.err || 'failed'}`, identity };
  // No Co-Authored-By trailer (artifacts-scan.cjs reads exactly that to spot a deliverable Cogby
  // made), and no hook or signing key of the owner's may fail this.
  const commit = git('-c', 'user.name=Cogby', '-c', 'user.email=cogby@localhost', '-c', 'commit.gpgsign=false',
    'commit', '-q', '--no-verify', '-m', options.message || 'Cogby: the brain as it was');
  if (!commit.ok) return { ok: false, why: `git commit: ${commit.err || 'failed'}`, identity };
  return { ok: true, created: true, identity, head: git('rev-parse', 'HEAD').out };
}

module.exports = { ownRepository, ensureRepository, gitIn };
