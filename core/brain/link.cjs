'use strict';

// A place is a folder the owner works in. It belongs to one project or area page, with a role and a
// one-line description. Nothing is added to the folder itself.
//
// The shared half is on the page, in its frontmatter, one line per place:
//
//   places:
//     - {repo: "github.com/globex/acme", role: code, about: "The service and its tests"}
//     - {name: "contracts", role: reference, about: "Signed SOW and change requests"}
//
// A place is named by its git remote when it has one a teammate could reach, normalized so every
// clone resolves to the same page and no credential in a URL is kept; otherwise by a short name.
// Why the frontmatter: it is where `repo:` already lived, the index already holds it, so a session
// start resolves a folder without opening a file, and it is not the current truth, so linking a
// folder never touches the summary the owner acts from. An older page with a single `repo:` field
// reads as one `code` place, as it is, with nothing to convert.
//
// The private half is the folder's path on this machine, kept in .cogby/local.json under `folders`
// (never committed), beside two other things known about a folder here: that the owner said it is
// not a brain project, and how many sessions were started in it and how often it was asked about.
//
// Linking and unlinking each add a timeline line to the page, with a source, in the same one-file
// commit. That line is the record of the command, not a claim: it ends in `record`, so it is never
// listed as unconfirmed and never shown as where work stopped (page.cjs). An unlinked place stays in
// the list, marked with its date.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { BrainError } = require('./db.cjs');
const brainLib = require('./brain.cjs');
const page = require('./page.cjs');
const { gitIn } = require('../lib/brain-repo.cjs');
const { redact } = require('../lib/redact.cjs');

const ROLES = ['code', 'workspace', 'environment', 'reference', 'scratch'];
// What each role is, for a person choosing one.
const ROLE_ABOUT = {
  code: 'the main repo', workspace: 'deliverables or working files', environment: 'a dev setup or sandbox',
  reference: 'contracts, docs: read only', scratch: 'experiments',
};
// A session in one of these opens on the page; in the others it gets the short brief.
const OPENS_ON_PAGE = new Set(['code', 'workspace', 'environment']);
const HOMES = ['project', 'area'];
const MAX_ASKS = 2;
const ABOUT_MAX = 160;

const { fold, isInside } = brainLib;
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

// git@github.com:globex/acme.git and https://github.com/globex/acme are one repo.
function normalizeRemote(url) {
  let text = String(url || '').trim().toLowerCase();
  if (!text) return '';
  text = text.replace(/^[a-z][a-z0-9+.-]*:\/\//, '').replace(/^[^@/]+@/, '');
  if (!/^[a-z]:[\\/]/.test(text)) text = text.replace(':', '/');
  return text.replace(/\\/g, '/').replace(/\.git$/, '').replace(/\/+$/, '');
}

// The remote as a name a page can carry: empty for none, and for one that is a path on this machine
// (a bare repo in a folder, file://), which would mean nothing on another and is not for the brain's
// history.
function sharedRemote(url) {
  const raw = String(url || '').trim();
  if (!raw || /^file:/i.test(raw) || /^[./\\~]/.test(raw) || /^[a-z]:[\\/]/i.test(raw)) return '';
  const id = normalizeRemote(raw);
  return id.includes('/') ? id : '';
}

const nameId = (value) => String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
// One line, no secret-looking value, nothing a timeline line would read as its own punctuation.
const cleanAbout = (value) => page.cleanSource(redact(page.oneLine(value))).replace(/\[/g, '(').replace(/\]/g, ')').slice(0, ABOUT_MAX).trim();

// The repository a folder is in: its top folder, its origin and its main checkout (the same as the
// top, except in a worktree), any of which may be missing.
function repoInfo(dir) {
  const none = { top: null, remote: null, main: null };
  if (!fs.existsSync(dir)) return none;
  const git = gitIn(dir);
  const found = git('rev-parse', '--show-toplevel', '--git-common-dir');
  const [top, common] = found.ok ? found.out.split(/\r?\n/) : [];
  if (!top) return none;
  const remote = git('remote', 'get-url', 'origin');
  const shared = common ? path.resolve(dir, common) : '';
  return {
    top: path.resolve(top), remote: remote.ok && remote.out ? remote.out : null,
    main: shared && path.basename(shared) === '.git' ? path.dirname(shared) : path.resolve(top),
  };
}

// Where a folder is: the unit that is linked, marked or counted is its repository (the main
// checkout, so every worktree of it is the same place), or the folder itself when it is in none.
function locate(dir) {
  const here = path.resolve(dir);
  const info = repoInfo(here);
  return { dir: here, git: !!info.top, top: info.top, remote: info.remote, unit: info.main || info.top || here };
}

// ---- the shared half: places on a page -----------------------------------------------------------

function parseItem(line) {
  const body = /^\s*-\s*\{(.*)\}\s*$/.exec(line);
  if (!body) return null;
  const fields = {};
  for (const pair of body[1].matchAll(/([A-Za-z_]+)\s*:\s*("(?:[^"\\]|\\.)*"|[^,]*)\s*(?:,|$)/g)) {
    let value = pair[2].trim();
    if (value.startsWith('"')) { try { value = JSON.parse(value); } catch { value = value.slice(1, -1); } }
    fields[pair[1].toLowerCase()] = String(value);
  }
  const kind = fields.repo ? 'repo' : fields.name ? 'name' : null;
  const id = kind === 'repo' ? normalizeRemote(fields.repo) : nameId(fields.name);
  if (!kind || !id) return null;
  return { kind, id, role: ROLES.includes(fields.role) ? fields.role : 'code', about: page.oneLine(fields.about), unlinked: page.isDate(fields.unlinked || '') ? fields.unlinked : '' };
}

const renderItem = (place) => `{${place.kind}: ${JSON.stringify(place.id)}, role: ${place.role}, about: ${JSON.stringify(place.about || '')}${place.unlinked ? `, unlinked: ${place.unlinked}` : ''}}`;

// Every place a page's frontmatter names. A `repo:` field from before places is a `code` place
// (`legacy`), unless the list already names that repo.
function readPlaces(frontmatter) {
  const fm = frontmatter || {};
  const listed = typeof fm.places === 'string' ? fm.places.split('\n').map(parseItem).filter(Boolean) : [];
  const old = typeof fm.repo === 'string' ? normalizeRemote(fm.repo) : '';
  if (old && !listed.some((place) => place.kind === 'repo' && place.id === old)) listed.unshift({ kind: 'repo', id: old, role: 'code', about: '', unlinked: '', legacy: true });
  return listed;
}

const frontmatterOf = (row) => { try { return JSON.parse(row.frontmatter) || {}; } catch { return {}; } };
const pagesWithPlaces = (db) => db.prepare("SELECT * FROM pages WHERE source_id = 'brain' AND (frontmatter LIKE '%\"repo\"%' OR frontmatter LIKE '%\"places\"%') ORDER BY slug").all();
const shown = (place) => ({ id: place.id, kind: place.kind, role: place.role, about: place.about });

// ---- the private half: folders on this machine ---------------------------------------------------

const folderMap = (local) => (local.folders && typeof local.folders === 'object' && !Array.isArray(local.folders) ? local.folders : (local.folders = {}));
const keyFor = (local, dir) => Object.keys(folderMap(local)).find((key) => fold(key) === fold(dir)) || null;

// Every folder of this machine that is linked: { path, page, place }. The `repos` map is how a link
// was kept before places; it is read as it is.
function localLinks(local) {
  const out = [];
  for (const [dir, entry] of Object.entries(folderMap(local))) {
    if (entry && typeof entry.page === 'string' && entry.page) out.push({ path: dir, page: entry.page, place: String(entry.place || ''), linked: entry.linked || '' });
  }
  for (const [slug, entry] of Object.entries(local.repos || {})) {
    if (!entry || typeof entry.path !== 'string' || out.some((link) => fold(link.path) === fold(entry.path))) continue;
    out.push({ path: entry.path, page: slug, place: normalizeRemote(entry.remote), linked: entry.linked || '', legacy: true });
  }
  return out;
}

const linkedFolders = (brain) => localLinks(brainLib.readLocal(brain));

// ---- which place a folder is ---------------------------------------------------------------------

// What the brain knows about a folder:
//   brain    it is inside the brain itself
//   linked   a place of a page: { row, place, via: 'remote' | 'folder', at: the linked folder }
//   none     the owner said it is not a brain project
//   source   it is inside a folder mounted as a read-only source
//   broken   linked here to a page that is no longer there
//   unknown  nothing is known
// By remote first, so any clone resolves; then by the deepest folder this machine linked that holds
// it. A "not a brain project" mark is about that one folder (or repository), never what is under it.
function resolve(db, brain, dir) {
  // Before git is asked anything: a session in the brain itself is the common case.
  if (isInside(path.resolve(dir), brain)) return { kind: 'brain', folder: brain, git: false };
  const where = locate(dir);
  const base = { folder: where.unit, git: where.git };
  const wanted = normalizeRemote(where.remote);
  if (wanted) {
    for (const row of pagesWithPlaces(db)) {
      const place = readPlaces(frontmatterOf(row)).find((entry) => entry.kind === 'repo' && !entry.unlinked && entry.id === wanted);
      if (place) return { kind: 'linked', ...base, row, place, via: 'remote', at: where.unit };
    }
  }
  const local = brainLib.readLocal(brain);
  const link = localLinks(local)
    .filter((entry) => isInside(where.dir, entry.path) || fold(entry.path) === fold(where.unit))
    .sort((a, b) => fold(b.path).length - fold(a.path).length)[0] || null;
  const key = keyFor(local, where.unit);
  const marked = !!(key && folderMap(local)[key] && folderMap(local)[key].none);
  if (marked && (!link || fold(where.unit).length >= fold(link.path).length)) return { kind: 'none', ...base };
  if (link) {
    const row = brainLib.lookup(db, link.page, { source: 'brain' });
    if (!row) return { kind: 'broken', ...base, page: link.page, at: link.path };
    const places = readPlaces(frontmatterOf(row)).filter((entry) => !entry.unlinked);
    const place = places.find((entry) => entry.id === link.place) || (link.legacy ? places.find((entry) => entry.kind === 'repo') : null);
    if (place) return { kind: 'linked', ...base, row, place, via: 'folder', at: link.path };
  }
  for (const [id, entry] of Object.entries(local.sources)) {
    if (entry && typeof entry.path === 'string' && isInside(where.dir, entry.path)) return { kind: 'source', ...base, source: id };
  }
  return { kind: 'unknown', ...base };
}

// The page a folder belongs to, or null.
function projectFor(db, brain, dir) {
  const state = resolve(db, brain, dir);
  return state.kind === 'linked' ? state.row : null;
}

// The project a to-do or a note made in this folder belongs to: the linked page's, or none.
function defaultProject(brain, cwd) {
  if (!cwd || isInside(cwd, brain)) return '';
  try {
    return brainLib.withIndex(brain, (db) => {
      const state = resolve(db, brain, cwd);
      return state.kind === 'linked' ? require('./todo.cjs').projectName(state.row.slug) : '';
    });
  } catch { return ''; }
}

// The place a session's turns are logged from, or null. Only a place that works on its page keeps
// the day's log: a code repo, a workspace, an environment. A reference or scratch folder, one marked
// "not a brain project", one the brain does not know and the brain itself answer null. What comes
// back names the place as its page does (a normalized remote or a short name) and the page, never
// the folder's path on this machine: the log is committed with the brain. Asked after every turn and
// when a session ends, so it reads the index as it is and starts nothing. Never throws.
function logPlace(brain, cwd) {
  try {
    if (!brainLib.isBrain(brain) || isInside(cwd, brain)) return null;
    return brainLib.withIndex(brain, (db) => {
      const state = resolve(db, brain, cwd);
      if (state.kind !== 'linked' || !OPENS_ON_PAGE.has(state.place.role)) return null;
      return { id: state.place.id, role: state.place.role, page: state.row.slug };
    }, { create: false, kick: false });
  } catch { return null; }   // a Node without SQLite, a brain that cannot be read
}

// A session has started in a folder the brain knows nothing about. Counts it, and says whether this
// is a start at which the owner is asked if the folder should be saved: the first one in a git
// repository, the second one anywhere else, at most MAX_ASKS times for one folder, and never when
// the owner asked to hear nothing (`quiet`).
function arrive(brain, folder, options = {}) {
  const local = brainLib.readLocal(brain);
  const map = folderMap(local);
  const key = keyFor(local, folder) || folder;
  const entry = map[key] && typeof map[key] === 'object' ? map[key] : {};
  const sessions = (Number.isInteger(entry.sessions) ? entry.sessions : 0) + 1;
  const asked = Number.isInteger(entry.asked) ? entry.asked : 0;
  const ask = !options.quiet && asked < MAX_ASKS && (!!options.git || sessions >= 2);
  map[key] = { ...entry, sessions, asked: ask ? asked + 1 : asked, seen: new Date().toISOString() };
  brainLib.writeLocal(brain, local);
  return { ask, sessions, asked: map[key].asked };
}

// ---- writing -------------------------------------------------------------------------------------

// The folder a command is about: the one it names (`folder`; `repo` is the older name of the same
// option), or the one it was run in.
const HOW = 'Name the folder first, then the card: `cogby link <folder> <card>`.';
function folderOf(options) {
  const dir = path.resolve(options.cwd || process.cwd(), options.folder || options.repo || '.');
  let isDir = false;
  try { isDir = fs.statSync(dir).isDirectory(); } catch { /* not there */ }
  if (!isDir) throw new BrainError('NO_FOLDER', `${dir} is not a folder.`, options.hint || HOW);
  return locate(dir);
}

// Both sides of a link in one line: said before the page is written, and carried by the result.
const linkingLine = (folder, slug, role) => `Linking folder ${folder} to card ${slug} as ${role}`;

// A whole home folder or a whole drive is not one place: every folder under it would become the page's.
function tooBroad(folder, env) {
  const homes = [os.homedir(), env.HOME, env.USERPROFILE].filter(Boolean).map((dir) => fold(dir));
  return path.parse(folder).root === folder || homes.includes(fold(folder));
}

const docsId = (slug) => {
  const parts = slug.split('/').filter((part) => !['card', 'progress', 'index'].includes(part.toLowerCase()));
  return `${parts.at(-1) || 'repo'}-docs`;
};

// One timeline line added to a page that is being written anyway.
function addLine(parsed, summary, source, by) {
  const date = today();
  const text = page.renderTimelineLine({ date, source: page.cleanSource(source), summary, ...by });
  parsed.timelineText = page.insertTimelineLine(parsed.timelineText, text, date);
  parsed.hasMarker = true;
  return text;
}

// Ties a folder to a page as one of its places: `cogby link <folder> <card>`. Both sides are said in
// one line (`options.announce`) once everything is checked and before the page is written.
function link(brain, pageRef, options = {}) {
  const write = require('./write.cjs');
  const env = options.env || process.env;
  const where = folderOf(options);
  const folder = where.unit;
  if (isInside(folder, brain) || isInside(brain, folder)) throw new BrainError('OVERLAP', `${folder} is the brain's own folder.`, `Link a folder you work in. ${HOW}`);
  if (tooBroad(folder, env)) throw new BrainError('TOO_BROAD', `${folder} is a whole home folder or drive, not one place.`, `Link the folder you work in. ${HOW}`);
  const role = options.role == null || options.role === '' ? '' : String(options.role).toLowerCase();
  if (role && !ROLES.includes(role)) throw new BrainError('BAD_ROLE', `"${options.role}" is not a role.`, `Use one of: ${ROLES.map((name) => `${name} (${ROLE_ABOUT[name]})`).join(', ')}.`);
  const remote = sharedRemote(where.remote);
  const id = remote || nameId(options.name || path.basename(folder));
  if (!id) throw new BrainError('BAD_NAME', `"${options.name || path.basename(folder)}" cannot name a place.`, 'Pass --name with letters and digits.');
  const kind = remote ? 'repo' : 'name';

  // One folder belongs to one page.
  const before = brainLib.withIndex(brain, (db) => {
    const state = resolve(db, brain, where.dir);
    const target = brainLib.lookup(db, pageRef, { source: 'brain' });
    return { state, target: target ? target.slug : null };
  });
  const held = before.state.kind === 'linked' && (before.state.via === 'remote' || fold(before.state.at) === fold(folder)) ? before.state : null;
  if (held && held.row.slug !== before.target) {
    throw new BrainError('ALREADY_LINKED', `${folder} is already a place of ${held.row.slug} (${held.place.id}, ${held.place.role}).`,
      `One folder belongs to one page. Undo that link first: \`cogby link --undo "${folder}"\`.`);
  }

  const by = write.recorder(brain, options);
  const links = linkedFolders(brain);
  const result = write.writePage(brain, pageRef, (parsed) => {
    if (!HOMES.includes(parsed.type)) throw new BrainError('NOT_A_HOME', `${parsed.slug} is a ${parsed.type} page.`, 'A place belongs to a project or an area: link it to that page.');
    const places = readPlaces(parsed.frontmatter);
    const had = places.find((place) => place.kind === kind && place.id === id) || null;
    if (had && kind === 'name' && !had.unlinked) {
      const other = links.find((entry) => entry.page === parsed.slug && entry.place === id && fold(entry.path) !== fold(folder) && fs.existsSync(entry.path));
      if (other) throw new BrainError('NAME_TAKEN', `${parsed.slug} already has a place named "${id}": ${other.path}.`, 'Pass --name <another-name>.');
    }
    const standing = had && !had.unlinked ? had : null;
    const next = {
      kind, id, unlinked: '',
      role: role || (standing ? standing.role : where.git ? 'code' : 'workspace'),
      about: options.about != null ? cleanAbout(options.about) : had ? had.about : '',
    };
    if (standing && standing.role === next.role && standing.about === next.about) return { changed: false, status: 'unchanged', place: shown(next) };
    const list = places.filter((place) => !place.legacy);
    const at = list.indexOf(had);
    if (at === -1) list.push(next); else list[at] = next;
    parsed.fmRaw = page.setBlock(parsed.fmRaw || '', 'places', list.map(renderItem));
    // The old single field said the same thing; the list says it now, with its role.
    if (had && had.legacy) parsed.fmRaw = page.dropField(parsed.fmRaw, 'repo');
    const linking = linkingLine(folder, parsed.slug, next.role);
    if (typeof options.announce === 'function') options.announce(linking);
    const line = addLine(parsed, `linked ${id} as ${next.role}${next.about ? `: ${next.about}` : ''}`, options.source || 'cogby link', by);
    return { changed: true, status: standing ? 'updated' : 'linked', place: shown(next), line, linking, message: `link(${parsed.slug}): ${id} as ${next.role}` };
  }, { ...options, by });

  const local = brainLib.readLocal(brain);
  const map = folderMap(local);
  const old = keyFor(local, folder);
  if (old) delete map[old];
  map[folder] = { page: result.slug, place: id, linked: new Date().toISOString() };
  for (const [slug, entry] of Object.entries(local.repos)) if (entry && typeof entry.path === 'string' && fold(entry.path) === fold(folder)) delete local.repos[slug];
  brainLib.writeLocal(brain, local);

  // The main repo's docs/ folder, where its decision notes live, becomes a read-only source, so
  // those notes are found by search without being copied.
  let docs = null;
  const docsDir = path.join(folder, 'docs');
  if (result.place.role === 'code' && fs.existsSync(docsDir) && fs.statSync(docsDir).isDirectory()) {
    try {
      const added = brainLib.addSource(brain, docsDir, { id: docsId(result.slug) });
      docs = { id: added.id, path: added.path, files: brainLib.refresh(brain, { source: added.id }).sources[0].scanned };
    } catch (error) {
      if (!(error instanceof BrainError)) throw error;
      docs = { id: null, why: error.message };
    }
  }
  return {
    status: result.status, slug: result.slug, place: result.place, repo: remote || null, folder, linking: result.linking || null, line: result.line || null,
    revision: result.revision, commit: result.commit, docs,
    ...(remote && options.name ? { note: 'This folder has a git remote, so the place is named by it; --name was not used.' } : {}),
  };
}

// "This folder is not a brain project": `cogby link --none [<folder>]`. Kept on this machine only.
function setNone(brain, options = {}) {
  const where = folderOf({ ...options, hint: 'Name a folder that is there: `cogby link --none <folder>`.' });
  const folder = where.unit;
  if (isInside(folder, brain)) throw new BrainError('OVERLAP', `${folder} is the brain's own folder.`, '');
  const state = brainLib.withIndex(brain, (db) => resolve(db, brain, where.dir));
  if (state.kind === 'linked' && (state.via === 'remote' || fold(state.at) === fold(folder))) {
    throw new BrainError('LINKED', `${folder} is a place of ${state.row.slug}.`, `Undo the link first: \`cogby link --undo "${folder}"\`.`);
  }
  const local = brainLib.readLocal(brain);
  const map = folderMap(local);
  const key = keyFor(local, folder) || folder;
  const entry = map[key] && typeof map[key] === 'object' ? map[key] : {};
  const already = !!entry.none;
  if (!already) { map[key] = { ...entry, none: true, marked: new Date().toISOString() }; brainLib.writeLocal(brain, local); }
  return { status: already ? 'unchanged' : 'marked', none: true, folder };
}

// Takes back either: a link (the place stays on the page, marked unlinked, with a timeline line) or
// a "not a brain project" mark. `cogby link --undo [<folder>]`.
function undo(brain, options = {}) {
  const write = require('./write.cjs');
  const where = folderOf({ ...options, hint: 'Name a folder that is there: `cogby link --undo <folder>`.' });
  const state = brainLib.withIndex(brain, (db) => resolve(db, brain, where.dir));
  const local = brainLib.readLocal(brain);
  const map = folderMap(local);
  if (state.kind === 'none') {
    const key = keyFor(local, where.unit);
    const { none, marked, ...rest } = map[key];
    map[key] = rest;
    brainLib.writeLocal(brain, local);
    return { status: 'cleared', folder: where.unit };
  }
  if (state.kind === 'broken') {
    const key = keyFor(local, state.at);
    if (key) delete map[key];
    for (const [slug, entry] of Object.entries(local.repos)) if (entry && typeof entry.path === 'string' && fold(entry.path) === fold(state.at)) delete local.repos[slug];
    brainLib.writeLocal(brain, local);
    return { status: 'cleared', folder: state.at };
  }
  if (state.kind !== 'linked') throw new BrainError('NOT_LINKED', `${where.unit} is not linked to a page and not marked "not a brain project".`, 'There is nothing to undo. `cogby places` lists what is linked.');

  const by = write.recorder(brain, options);
  const { kind, id } = state.place;
  const result = write.writePage(brain, state.row.slug, (parsed) => {
    const places = readPlaces(parsed.frontmatter);
    const had = places.find((place) => place.kind === kind && place.id === id && !place.unlinked);
    if (!had) return { changed: false };
    const list = places.filter((place) => !place.legacy || place === had).map((place) => (place === had ? { ...place, unlinked: today() } : place));
    parsed.fmRaw = page.setBlock(parsed.fmRaw || '', 'places', list.map(renderItem));
    if (had.legacy) parsed.fmRaw = page.dropField(parsed.fmRaw, 'repo');
    const line = addLine(parsed, `unlinked ${id}`, options.source || 'cogby link --undo', by);
    return { changed: true, line, message: `unlink(${parsed.slug}): ${id}` };
  }, { ...options, by });

  const key = keyFor(local, state.at);
  if (key) delete map[key];
  for (const [slug, entry] of Object.entries(local.repos)) if (entry && typeof entry.path === 'string' && fold(entry.path) === fold(state.at)) delete local.repos[slug];
  brainLib.writeLocal(brain, local);
  // The docs source the link mounted goes with it; the folder itself is untouched.
  const mounted = brainLib.readLocal(brain).sources[docsId(result.slug)];
  if (mounted && fold(mounted.path) === fold(path.join(state.at, 'docs'))) {
    try { brainLib.removeSource(brain, docsId(result.slug)); brainLib.refresh(brain); } catch { /* the link is undone either way */ }
  }
  return { status: 'unlinked', slug: result.slug, place: shown(state.place), folder: state.at, line: result.line || null, revision: result.revision, commit: result.commit };
}

// `cogby places`: every place, or one page's, with the folder each has on this machine. Reads the
// index as it is.
function places(brain, options = {}) {
  return brainLib.withIndex(brain, (db, stats) => {
    let only = null;
    if (options.page) {
      only = brainLib.lookup(db, options.page, { source: 'brain' });
      if (!only) throw new BrainError('NOT_FOUND', `No page "${options.page}" in the brain.`, 'Find it with `cogby search "<words>"`.');
    }
    const local = brainLib.readLocal(brain);
    const links = localLinks(local);
    const list = [];
    for (const row of pagesWithPlaces(db)) {
      if (only && row.id !== only.id) continue;
      for (const place of readPlaces(frontmatterOf(row))) {
        if (place.unlinked && !options.all) continue;
        const here = place.unlinked ? null : links.find((entry) => entry.page === row.slug && entry.place === place.id) || null;
        list.push({
          page: row.slug, title: row.title, ...shown(place), unlinked: place.unlinked || null,
          folder: here ? here.path : null, missing: here ? !fs.existsSync(here.path) : false,
        });
      }
    }
    const not = only ? [] : Object.entries(folderMap(local)).filter(([, entry]) => entry && entry.none).map(([dir]) => dir);
    return { places: list, not_projects: not, page: only ? only.slug : null, all: !!options.all, index: stats.index, index_as_of: stats.synced_at || null };
  });
}

module.exports = {
  ROLES, ROLE_ABOUT, OPENS_ON_PAGE, MAX_ASKS,
  link, setNone, undo, places, resolve, logPlace, arrive, projectFor, defaultProject, linkedFolders, readPlaces, repoInfo, normalizeRemote, sharedRemote,
};
