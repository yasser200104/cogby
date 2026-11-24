#!/usr/bin/env node
'use strict';

// Forwarder: <brain>/.claude/hooks/wrapup-guard.cjs -> <program>/.claude/hooks/wrapup-guard.cjs.
//
// The automatic wrap-up child starts in the brain, and `.claude/wrapup-policy.json` spells this
// hook from the folder the session started in (`node "$CLAUDE_PROJECT_DIR"/.claude/hooks/
// wrapup-guard.cjs`), so from the brain it lands here. This file runs the real guard as a CHILD,
// the same shape as the lane-policy forwarder beside it: the payload in on stdin, the decision JSON
// out on stdout, the exit code passed back, and exit 2 — a block — when the guard cannot run at
// all. Not require(): it would happen to work for this guard, which has no require.main check, and
// would hide the bug in the forwarder where it matters.
//
// The program is found as the lane-policy forwarder finds it: (a) the folder above the brain when
// it holds the real guard and core/lib/spawn.cjs; (b) otherwise the install record's root, only when
// its "brain" is this brain; (c) nothing else, exit 2. The folder above comes first so the record,
// which sits outside the repository, can never redirect the guard of a brain inside a program.
// Identical on every install: do not edit.

const fs = require('fs');
const os = require('os');
const path = require('path');

const BRAIN = path.resolve(__dirname, '..', '..');
const ABOVE = path.dirname(BRAIN);

function refuse(why) {
  process.stderr.write(`Refused: Cogby's wrap-up guard could not run (${why}). Nothing can be authorized until it does.\n`);
  process.exit(2);
}

// The per-machine config folder, exactly as cli/lib/runtime-paths.cjs configDirectory computes it
// (brain-harness.test holds the two to one answer). Inline: this file loads nothing from a program
// it has not found yet.
function configDir(env) {
  const home = path.resolve(env.HOME || os.homedir());
  if (env.COGBY_CONFIG_DIR) return path.resolve(env.COGBY_CONFIG_DIR);
  if (process.platform === 'win32') return path.join(env.APPDATA || path.join(home, 'AppData', 'Roaming'), 'Cogby');
  if (process.platform === 'darwin') return path.join(home, 'Library', 'Application Support', 'Cogby');
  return path.join(env.XDG_CONFIG_HOME || path.join(home, '.config'), 'cogby');
}

// By real location: Node runs this file from its real path, so BRAIN is the real folder, while the
// record may name the brain through a junction or symlink (or macOS's /var for /private/var), and
// paths.cjs accepts that spelling. Read lexically, such a brain would be refused on every call.
const real = (p) => { try { return fs.realpathSync.native(p); } catch { return path.resolve(p); } };
const samePath = (a, b) => {
  const x = real(a);
  const y = real(b);
  return process.platform === 'win32' ? x.toLowerCase() === y.toLowerCase() : x === y;
};

function program() {
  const needs = [path.join(ABOVE, '.claude', 'hooks', 'wrapup-guard.cjs'), path.join(ABOVE, 'core', 'lib', 'spawn.cjs')];
  if (needs.every((p) => fs.existsSync(p))) return ABOVE;
  let record = null;
  try { record = JSON.parse(fs.readFileSync(path.join(configDir(process.env), 'install.json'), 'utf8').replace(/^﻿/, '')); }
  catch { /* no record: no program */ }
  if (record && typeof record.root === 'string' && record.root && typeof record.brain === 'string'
    && path.isAbsolute(record.brain) && samePath(record.brain, BRAIN)) return path.resolve(record.root);
  const missing = needs.filter((p) => !fs.existsSync(p));
  refuse(`no Cogby program for this brain: ${missing.join(' and ')} not found, and no install record names ${BRAIN}`);
}

const ENGINE = program();
const HOOK = path.join(ENGINE, '.claude', 'hooks', 'wrapup-guard.cjs');

if (!fs.existsSync(HOOK)) refuse(`no guard at ${HOOK}`);
let spawnSync;
try { ({ spawnSync } = require(path.join(ENGINE, 'core', 'lib', 'spawn.cjs'))); }
catch (e) { refuse(`the engine's spawn module did not load: ${String(e && e.message).slice(0, 120)}`); }

const r = spawnSync(process.execPath, [HOOK, ...process.argv.slice(2)], { stdio: 'inherit' });
if (r.status === null) refuse(r.error ? `it did not start: ${r.error.message}` : `it was stopped by ${r.signal}`);
process.exit(r.status);
