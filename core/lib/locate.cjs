'use strict';

// The two roots a session-side script needs (§3), in one place instead of seven copies of a
// marker walk: the ENGINE (the program folder — scripts, hooks, the dashboard) and the BRAIN
// (the substrate — SOUL, goals, the log, projects).
//
// Before the brain existed these were the same folder, so every copy of `findRoot` conflated
// them: walk up from the session's cwd until a folder has AGENTS.md or CLAUDE.md beside a
// `.claude/` directory. `rootsFrom` keeps that walk as the legacy answer and adds the brain
// marker above it, so with no `cogby-brain/.cogby/brain.json` on disk every caller gets exactly
// the root its own `findRoot` returned.

const fs = require('fs');
const path = require('path');
const paths = require('./paths.cjs');

// This program is where THIS FILE is, never where the process was started. A hook is an engine
// script wherever it was invoked from, and a session opened three folders inside the brain must
// still find `core/` and `workspace/` — walking up from the cwd cannot promise that, because a
// brain has no AGENTS.md or CLAUDE.md at its top.
const ENGINE = path.resolve(__dirname, '..', '..');

const WALK_LIMIT = 8;   // the depth every findRoot copy used

function exists(p) {
  try { return fs.existsSync(p); } catch { return false; }
}

// Lexical: a cwd that no longer exists still resolves, and existsSync simply answers false.
function startDir(cwd) {
  const raw = cwd == null ? '' : String(cwd).trim();
  if (!raw) return process.cwd();
  try { return path.resolve(raw); } catch { return process.cwd(); }
}

function walkUp(start, hit) {
  let dir = start;
  for (let i = 0; i < WALK_LIMIT; i++) {
    if (hit(dir)) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

// A session opened on the brain, or in any folder inside it.
function brainAbove(start) {
  return walkUp(start, (dir) => exists(path.join(dir, '.cogby', 'brain.json')));
}

// The pre-brain walk, kept verbatim: AGENTS.md or CLAUDE.md, beside a `.claude/` directory.
function markedAbove(start) {
  return walkUp(start, (dir) =>
    (exists(path.join(dir, 'AGENTS.md')) || exists(path.join(dir, 'CLAUDE.md')))
    && exists(path.join(dir, '.claude')));
}

/**
 * rootsFrom(cwd) → { engine, brain, inTree }
 *
 * Four cases, by what encloses the cwd. "Marked" is the pre-brain walk: AGENTS.md or CLAUDE.md
 * beside a `.claude/` directory.
 *
 *   1. A brain — the nearest ancestor holding `.cogby/brain.json`: a session opened on the brain
 *      or in any folder inside it. brain = that folder; engine = the install ABOVE it, which is
 *      this program for the layout §1 describes. The walk starts at the brain's parent, so a brain
 *      that happens to carry a CLAUDE.md at its top is still not mistaken for its own program; a
 *      brain with no install above it gets this program.
 *   2. A marked tree that is NOT this program — a test fixture, an export, a worktree. It is a
 *      whole install of its own, the legacy layout: one folder that is both engine and substrate,
 *      so both roots are that folder. That is how a fixture's stub `core/runtime/run-job.cjs` or
 *      symlinked `notify.cjs` stands in for the real one, and what every findRoot copy returned.
 *   3. This program (the walk lands on the folder this module lives in). engine = this program,
 *      never found by walking; brain = `paths.brainOf(engine)` (§3 point 2) — the engine root
 *      itself while no brain exists.
 *   4. Nothing marked anywhere. There is no install to speak of, so the cwd is both roots, exactly
 *      the `findRoot(cwd) || cwd` every call site spelled by hand. inTree is false.
 *
 * With no `.cogby/brain.json` on disk, case 1 never fires and every case returns the old single
 * root for both fields — except case 3's engine, which IS that root.
 *
 * `paths.brainOf` throws when two brains sit in the engine root (U1, by design). Let it: silently
 * picking one writes the owner's work into the wrong brain. A caller that must never fail (a
 * SessionStart hook) catches it itself.
 */
function rootsFrom(cwd) {
  const start = startDir(cwd);

  // "Is this this program" compares with `paths.samePath`, never `===`: a cwd spelled `c:\…` against
  // an ENGINE of `C:\…` is the same folder, and a plain compare would read the program as a foreign
  // install (case 3 as case 2) and hand every caller the wrong brain.
  const brain = brainAbove(start);
  if (brain) {
    const above = markedAbove(path.dirname(brain));
    return { engine: above && !paths.samePath(above, ENGINE) ? above : ENGINE, brain, inTree: true };
  }

  const marked = markedAbove(start);
  if (!marked) return { engine: start, brain: start, inTree: false };
  if (!paths.samePath(marked, ENGINE)) return { engine: marked, brain: marked, inTree: true };
  return { engine: ENGINE, brain: paths.brainOf(ENGINE), inTree: true };
}

module.exports = { rootsFrom, ENGINE };
