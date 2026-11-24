#!/usr/bin/env node
'use strict';

// Forwarder: <brain>/.claude/hooks/lane-policy.cjs -> <program>/.claude/hooks/lane-policy.cjs.
//
// Cogby's sessions start in the brain, and `.claude/lane-policy.json` and
// `.claude/floor-policy.json` spell this hook from the folder the session started in
// (`node "$CLAUDE_PROJECT_DIR"/.claude/hooks/lane-policy.cjs`), so from the brain they land
// here. This file runs the real hook as a CHILD — never through require(): under require() the
// real hook exports four helpers, reads no stdin, writes no decision and exits 0, and the CLI
// reads that silence as "no opinion", which in an unattended --print child is a refusal of every
// tool call, and in an attended one is no gate at all.
//
// Which program, in this order. (a) The folder above the brain, when it holds both the real hook
// and core/lib/spawn.cjs: a brain inside its program, a dev checkout, a test fixture. (b) Otherwise
// the root of the install record (install.json in Cogby's config folder), and only when that
// record's "brain" is this brain. (c) Nothing else: exit 2. The folder above comes first on purpose:
// the record sits outside the repository, where an unattended lane may write, so it must never be
// able to redirect the gate of a brain that sits inside a program.
//
// stdio is inherited, so the tool payload reaches the real hook on stdin and its decision JSON
// reaches the CLI on stdout unchanged; the arguments (--floor, --provider=codex) are passed on; the
// hook's exit code is passed back. When the hook cannot run at all — no program found, its spawn
// module missing, no exit status — this exits 2, which the CLI reads as a BLOCK, so a broken
// forwarder refuses the call instead of leaving it undecided. The real hook resolves the program
// from its own location, so this file needs nothing from the brain. Identical on every install:
// do not edit.

const fs = require('fs');
const os = require('os');
const path = require('path');

const BRAIN = path.resolve(__dirname, '..', '..');
const ABOVE = path.dirname(BRAIN);

function refuse(why) {
  process.stderr.write(`Refused: Cogby's permission hook could not run (${why}). Nothing can be authorized until it does.\n`);
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
  const needs = [path.join(ABOVE, '.claude', 'hooks', 'lane-policy.cjs'), path.join(ABOVE, 'core', 'lib', 'spawn.cjs')];
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
const HOOK = path.join(ENGINE, '.claude', 'hooks', 'lane-policy.cjs');

if (!fs.existsSync(HOOK)) refuse(`no hook at ${HOOK}`);
let spawnSync;
try { ({ spawnSync } = require(path.join(ENGINE, 'core', 'lib', 'spawn.cjs'))); }
catch (e) { refuse(`the engine's spawn module did not load: ${String(e && e.message).slice(0, 120)}`); }

const r = spawnSync(process.execPath, [HOOK, ...process.argv.slice(2)], { stdio: 'inherit' });
if (r.status === null) refuse(r.error ? `it did not start: ${r.error.message}` : `it was stopped by ${r.signal}`);
process.exit(r.status);
