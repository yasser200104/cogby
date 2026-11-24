'use strict';

// Where a root is, and what a pointer written in a goal or a note points at. These were part of the
// Console's scanner (workspace/server/scan.cjs), which still exports them; they live here because
// the brain side needs them too (the graph scanner, autolink, the calendar sync) and core/ does not
// import the Console.

const fs = require('fs');
const path = require('path');
const { forRoot: R, wireFromLegacy, GROUP } = require('./paths.cjs');

function exists(p) { try { return fs.existsSync(p); } catch { return false; } }

function hasMarker(dir) {
  return fs.existsSync(path.join(dir, 'AGENTS.md')) || fs.existsSync(path.join(dir, 'CLAUDE.md'));
}

// NOT `core/lib/locate.cjs`'s rootsFrom, deliberately (§4.2, which lists this file as "keeps
// meaning engine"). This one answers BRAIN_DIR first and ELEVEN modules take it as their own root
// — index.cjs, task-store.cjs, workspace-paths.cjs, turn-spawner.cjs, meeting-notes.cjs,
// graph-scan.cjs, the two calendar libs, autolink.cjs, sync-google-calendar.cjs — which is how
// route-harness.mjs points the whole Console at a fixture. `rootsFrom` has no BRAIN_DIR branch,
// by design: it resolves the ENGINE from its own file location. Swapping it in here would take
// the fixture root away from twenty-odd route suites and from find-root.test.mjs's own
// "BRAIN_DIR still wins outright" case. The brain is reached from here through paths.forRoot(ROOT).
function findRoot(start) {
  if (process.env.BRAIN_DIR && fs.existsSync(process.env.BRAIN_DIR)) {
    return path.resolve(process.env.BRAIN_DIR);
  }
  const marked = [];
  let dir = path.resolve(start);
  for (let i = 0; i < 10; i++) {
    if (hasMarker(dir)) marked.push(dir);
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  if (marked.length) {
    const outward = marked.slice().reverse();
    const packaged = outward.find((d) => fs.existsSync(path.join(d, 'package.json')));
    if (packaged) return packaged;
    return outward[0];
  }
  return path.resolve(__dirname, '..', '..');
}

function resolvePointer(root, pointer) {
  const p = String(pointer || '').trim();
  if (!p || /^commit\b/i.test(p)) return null;
  const token = p.split(/,| ## | Step | \(/)[0].trim();
  if (!token || token.includes('*')) return null;
  const hit = resolveToken(root, token)
    || (token.includes('\\') ? resolveToken(root, token.split('\\').join('/')) : null);
  return hit || resolveInBrain(root, token);
}

// A pointer the install root cannot place, in the brain layout only: written in a session that
// started in the brain (`projects/x`, §4.3), or before the move (`context/realms/work/projects/x`,
// whose folder the finalize renamed). Read it as wire and resolve it through its bucket. Before the
// brain every session starts at the install root, so resolveToken alone is today's answer and this
// adds nothing. The href stays install-relative, like every other (deriveEntities reads it).
function resolveInBrain(root, token) {
  const r = R(root);
  if (r.LAYOUT !== 'brain') return null;
  const parts = wireFromLegacy(token).split('/').filter(Boolean);
  if (!parts.length || !GROUP[parts[0]] || parts.includes('..')) return null;
  const abs = r.ctx(...parts);
  if (!abs.startsWith(root + path.sep) || !exists(abs)) return null;
  return path.relative(root, abs).split(path.sep).join('/');
}

function resolveToken(root, token) {
  const abs = path.resolve(root, token);
  if (abs !== path.normalize(abs)) return null;
  if (!(abs === root || abs.startsWith(root + path.sep))) return null;
  if (!exists(abs)) return null;
  return path.relative(root, abs).split(path.sep).join('/') || token;
}

function deriveEntities(hrefs) {
  const seen = new Map(); // key -> { type, slug, path, n }
  for (const href of hrefs) {
    if (!href) continue;
    // An href is root-relative: `context/realms/work/projects/x` before the brain,
    // `cogby-brain/projects/x` after it, or already wire. wireFromLegacy owns those prefixes.
    const rel = wireFromLegacy(href);
    const m = /^(areas|projects)\/([^/]+)(?:\/|$)/.exec(rel);
    if (!m) continue;
    const type = m[1] === 'areas' ? 'area' : 'project';
    const slug = m[2];
    const key = type + ':' + slug;
    const prev = seen.get(key);
    if (prev) prev.n++;
    else seen.set(key, { type, slug, path: `${m[1]}/${slug}`, n: 1 });
  }
  return [...seen.values()].sort((a, b) => b.n - a.n).map(({ n, ...e }) => e);
}

module.exports = { hasMarker, findRoot, resolvePointer, resolveInBrain, resolveToken, deriveEntities };
