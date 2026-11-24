'use strict';

// One flag per mechanism, each read by the one hook it names (FL-1, review B6/B9/B10).
//
//   BRAIN_NO_POINTERS=1  prompt-pointers adds no "Named in that ask" line
//   BRAIN_NO_CAPTURE=1   capture-log journals nothing to context/self/log/
//   BRAIN_NO_WRAPUP=1    session-wrapup spawns no wrap-up agent
//   BRAIN_NO_INDUCT=1    the session opens no goal: wrap-up does not induce it, and the
//                        UserPromptSubmit hook marks it so the heartbeat sweep never does either
//
//   BRAIN_HEADLESS=1     the preset for a spawn nobody is talking to: capture, wrap-up and
//                        induction off, pointers ON (a headless run reads the substrate like any
//                        other). An explicit BRAIN_NO_<X>=0 turns that one mechanism back on.
//
// Old names, kept for one release: BRAIN_NO_GOAL=1 is BRAIN_HEADLESS (doctor warns),
// BRAIN_WRAPUP=1 is BRAIN_NO_WRAPUP.
//
// Children get these in their spawn env. A process never sets them on its own process.env: the
// Console did that at boot and every chat it spawned inherited pointers-off.

const fs = require('fs');
const path = require('path');
const { forRoot } = require('./paths.cjs');

const MARK_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function value(env, name) { return String(env[name] == null ? '' : env[name]).trim(); }

// '1' turns the mechanism off, '0' keeps it on whatever the preset says, anything else defers.
function off(env, name, fallback) {
  const v = value(env, name);
  if (v === '1') return true;
  if (v === '0') return false;
  return fallback;
}

function flagsFrom(env = process.env) {
  const headless = value(env, 'BRAIN_HEADLESS') === '1' || value(env, 'BRAIN_NO_GOAL') === '1';
  return {
    headless,
    pointers: !off(env, 'BRAIN_NO_POINTERS', false),
    capture: !off(env, 'BRAIN_NO_CAPTURE', headless),
    wrapup: !off(env, 'BRAIN_NO_WRAPUP', headless || value(env, 'BRAIN_WRAPUP') === '1'),
    induct: !off(env, 'BRAIN_NO_INDUCT', headless),
  };
}

// One empty file per session, named by its id: concurrent headless spawns never race on a shared
// file, and the sweep's question is a single existsSync.
function marksDir(root) { return forRoot(root).ctx('self', '.gateway', 'headless-sessions'); }

function cleanId(sessionId) {
  return String(sessionId || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64);
}

function markSession(root, sessionId, now = Date.now()) {
  const id = cleanId(sessionId);
  if (!id) return false;
  const dir = marksDir(root);
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, id), '');
    for (const name of fs.readdirSync(dir)) {
      const file = path.join(dir, name);
      try { if (now - fs.statSync(file).mtimeMs > MARK_TTL_MS) fs.rmSync(file, { force: true }); } catch { /* raced */ }
    }
    return true;
  } catch { return false; }
}

function isMarked(root, sessionId) {
  const id = cleanId(sessionId);
  return !!id && fs.existsSync(path.join(marksDir(root), id));
}

module.exports = { flagsFrom, markSession, isMarked, marksDir, MARK_TTL_MS };
