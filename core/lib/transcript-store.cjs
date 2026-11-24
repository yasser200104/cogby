'use strict';


const fs = require('fs');
const os = require('os');
const path = require('path');

function projectSlug(root) {
  return String(root).replace(/[^A-Za-z0-9]/g, '-');
}

function storeRoot(home = os.homedir()) {
  return path.join(home, '.claude', 'projects');
}

function projectDir(root, opts = {}) {
  const override = opts.override === undefined ? process.env.BRAIN_TRANSCRIPT_DIR : opts.override;
  if (String(override || '').trim()) return String(override).trim();
  return path.join(storeRoot(opts.home), projectSlug(root));
}

function isOwnProjectDir(name, root) {
  return String(name) === projectSlug(root);
}

// The two roots a program's transcripts are filed under: its brain, where Cogby's sessions start
// (§4.3), and the program itself, where everything before that move sits and where a developer
// still opens sessions. With no brain on disk they are one folder, spelled as the caller spelled
// it, so its slug is byte for byte the one projectDir(root) always produced.
function rootsOf(root) {
  const engine = String(root);
  let brain = engine;
  // Loaded here, not at the top: this module is a leaf every hook loads, and paths.cjs stops a
  // process on two brains — reading the program's own folder is still right then.
  try {
    const paths = require('./paths.cjs');
    const found = paths.brainOf(engine);
    if (!paths.samePath(found, engine)) brain = found;
  } catch { /* two brains: the engine's own folder */ }
  return { brain, engine };
}

// Every folder this install's chat history is in: the brain's first, then the engine's (§4.4).
// Read both, permanently: Claude Code owns ~/.claude/projects, so the old folder can never be
// migrated, and "this install's sessions" really is the union. `roots` is a program root (its
// brain is found for it), `{ brain, engine }`, or a list. BRAIN_TRANSCRIPT_DIR still collapses it
// to one folder, exactly as projectDir honours it; `override: ''` ignores the env, as there.
function projectDirs(roots, opts = {}) {
  const override = opts.override === undefined ? process.env.BRAIN_TRANSCRIPT_DIR : opts.override;
  if (String(override || '').trim()) return [String(override).trim()];
  const r = typeof roots === 'string' ? rootsOf(roots) : roots;
  const list = Array.isArray(r) ? r : [r && r.brain, r && r.engine];
  const out = [];
  const seen = new Set();
  for (const root of list) {
    if (!root) continue;
    const dir = path.join(storeRoot(opts.home), projectSlug(root));
    const key = process.platform === 'win32' ? dir.toLowerCase() : dir;   // one folder, two spellings
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(dir);
  }
  return out;
}

// The transcript of one session: the first folder that holds it, else where the first folder
// would hold it — so a caller's existsSync answers exactly as it did with one folder.
function transcriptIn(dirs, sessionId) {
  const list = Array.isArray(dirs) ? dirs : [dirs];
  const name = String(sessionId) + '.jsonl';
  for (const dir of list) {
    const file = path.join(dir, name);
    if (fs.existsSync(file)) return file;
  }
  return list.length ? path.join(list[0], name) : '';
}

module.exports = { projectSlug, storeRoot, projectDir, projectDirs, rootsOf, transcriptIn, isOwnProjectDir };
