'use strict';


const fs = require('fs');
const path = require('path');
const { forRoot } = require('./paths.cjs');
const { spawnSync } = require('./spawn.cjs');

const MODES = new Set(['auto', 'review', 'off']);
// Off until the owner turns it on: an automatic wrap-up starts a background Claude that commits on
// its own, and that is asked for, never assumed (`cogby wrapup auto`).
const DEFAULT_MODE = 'off';
const BASELINE_KEEP_DAYS = 7;

function safeId(sessionId) {
  const id = String(sessionId || '').trim();
  if (!id) return '';
  return id.replace(/[^A-Za-z0-9._-]/g, '-').slice(0, 120);
}

function baselineDir(root) {
  return forRoot(root).ctx('self', '.gateway', 'session-baseline');
}

function baselineFile(root, sessionId) {
  const id = safeId(sessionId);
  return id ? path.join(baselineDir(root), `${id}.json`) : null;
}

function git(root, args) {
  try {
    return spawnSync('git', ['-C', root, ...args], {
      encoding: 'utf8', timeout: 15000, maxBuffer: 16 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch { return { status: 1 }; }
}

// A look at the whole tree, at session start (the baseline) and at session end (the scope). Without
// `--no-optional-locks` git holds its index lock for the length of the scan, and a hook stopped in
// the middle of it left the lock behind: every later save in the brain was then refused.
function dirtyPaths(root) {
  const r = git(root, ['--no-optional-locks', 'status', '--porcelain=v1', '-z', '--untracked-files=all']);
  if (!r || r.status !== 0 || r.error) return null;
  return parsePorcelainZ(r.stdout);
}

function parsePorcelainZ(out) {
  const fields = String(out || '').split('\0');
  const paths = [];
  for (let i = 0; i < fields.length; i++) {
    const entry = fields[i];
    if (!entry || entry.length < 4) continue;
    const xy = entry.slice(0, 2);
    const file = entry.slice(3);
    if (file) paths.push(file);
    if (xy[0] === 'R' || xy[0] === 'C') {
      const origin = fields[++i];
      if (origin) paths.push(origin);
    }
  }
  return paths;
}

// The brain's shared working state: the owner's to-dos, their notes and what waits on them, plus
// the day's log. Every session writes these, from the brain and from any folder linked to it, so
// none of them belongs to one session and a snapshot taken when this session opened says nothing
// about them: a store an earlier session left changed would be "dirty before" and never committed,
// and would never reach the owner's other machine. They are in scope whenever they are dirty.
//
// They are rarely dirty. A write to a store is a commit of that one file (core/brain/todo.cjs,
// notify.cjs), and the session-end hook commits the day's log (write.cjs commitDayLogs). What is
// left for the wrap-up is the log of a session that is still open, and a store whose own commit did
// not go through (a hook of the owner's, a lock). A file that is committed is not dirty, so it is
// simply not listed: an empty scope stays a real answer.
const SHARED_STORES = Object.freeze(['.cogby/todos/store.json', '.cogby/notes/store.json', '.cogby/notifications/store.json']);
const DAY_LOG = /^\d{4}-\d{2}-\d{2}\.md$/;

// Which of the dirty paths are that shared state. `dirty` is what git status printed: relative to
// the top of the repository, which is the brain itself or, for a brain inside its program, above it.
function sharedPaths(root, dirty) {
  if (!Array.isArray(dirty) || !dirty.length) return [];
  const asked = git(root, ['rev-parse', '--show-prefix']);
  if (!asked || asked.status !== 0 || asked.error) return [];
  const prefix = String(asked.stdout || '').trim();
  const stores = new Set(SHARED_STORES.map((rel) => prefix + rel));
  let logDir = '';
  try { logDir = `${prefix}${path.relative(forRoot(root).BASE, forRoot(root).ctx('self', 'log')).split(path.sep).join('/')}/`; } catch { logDir = ''; }
  return dirty.filter((p) => stores.has(p) || (logDir && p.startsWith(logDir) && DAY_LOG.test(p.slice(logDir.length)))).sort();
}

function recordBaseline(root, sessionId, { force = false } = {}) {
  const file = baselineFile(root, sessionId);
  if (!file) return null;
  try {
    if (!force && fs.existsSync(file)) return file;
    const dirty = dirtyPaths(root);
    if (dirty === null) return null;                    // not a repo / no git → nothing to scope
    const head = git(root, ['rev-parse', 'HEAD']);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({
      at: new Date().toISOString(),
      head: head && head.status === 0 ? String(head.stdout || '').trim() : null,
      dirty: dirty.sort(),
    }, null, 2) + '\n');
    fs.renameSync(tmp, file);
    pruneBaselines(root);
    return file;
  } catch { return null; }                              // a hook must never fail on this
}

function scopeFor(root, sessionId) {
  const file = baselineFile(root, sessionId);
  let base = null;
  try { base = file ? JSON.parse(fs.readFileSync(file, 'utf8')) : null; } catch { base = null; }
  const now = dirtyPaths(root);
  // `shared` is in scope with or without a baseline; `paths` already holds it when there is one.
  const shared = sharedPaths(root, now);
  if (!base || !Array.isArray(base.dirty)) return { paths: [], shared, baseline: 'missing', head: null, at: null };
  if (now === null) return { paths: [], shared, baseline: 'missing', head: base.head || null, at: base.at || null };
  const before = new Set(base.dirty);
  const paths = [...new Set([...now.filter((p) => !before.has(p)), ...shared])].sort();
  return { paths, shared, baseline: 'found', head: base.head || null, at: base.at || null };
}

function pruneBaselines(root, days = BASELINE_KEEP_DAYS) {
  const dir = baselineDir(root);
  const cutoff = Date.now() - days * 86400000;
  try {
    for (const name of fs.readdirSync(dir)) {
      if (!name.endsWith('.json')) continue;
      const p = path.join(dir, name);
      try { if (fs.statSync(p).mtimeMs < cutoff) fs.unlinkSync(p); } catch { /* raced */ }
    }
  } catch { /* no dir yet */ }
}

function configDir(root) {
  // Beside the session baselines, in the part of the brain that is never committed: the setting is
  // this machine's, not the brain's.
  return process.env.COGBY_WRAPUP_DIR || forRoot(root).ctx('self', '.gateway', 'wrapup');
}
function configFile(root) { return path.join(configDir(root), 'config.json'); }
function readConfig(root) {
  try {
    const c = JSON.parse(fs.readFileSync(configFile(root), 'utf8'));
    return c && typeof c === 'object' ? c : {};
  } catch { return {}; }
}

function readMode(root) {
  const env = String(process.env.BRAIN_WRAPUP_MODE || '').trim().toLowerCase();
  if (MODES.has(env)) return env;
  const file = String(readConfig(root).mode || '').trim().toLowerCase();
  return MODES.has(file) ? file : DEFAULT_MODE;
}

function setMode(root, next) {
  const mode = String(next || '').trim().toLowerCase();
  if (!MODES.has(mode)) throw new Error(`wrapup: unknown mode "${next}" (want auto|review|off)`);
  const dir = configDir(root);
  fs.mkdirSync(dir, { recursive: true });
  const file = configFile(root);
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify({ ...readConfig(root), mode }, null, 2) + '\n');
  fs.renameSync(tmp, file);
  return mode;
}

function status(root) {
  const env = String(process.env.BRAIN_WRAPUP_MODE || '').trim().toLowerCase();
  return {
    mode: readMode(root),
    envForced: MODES.has(env),
    modes: [...MODES],
    baselineDir: baselineDir(root),
  };
}

module.exports = {
  MODES, DEFAULT_MODE,
  baselineDir, baselineFile, dirtyPaths, parsePorcelainZ,
  SHARED_STORES, sharedPaths,
  recordBaseline, scopeFor, pruneBaselines,
  readMode, setMode, status, configFile,
};
