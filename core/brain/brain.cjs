'use strict';

// A brain is a folder of markdown (the record) and the index generated from it. This file finds the
// brain, knows its sources, and reads files into the index. It never writes a page: write.cjs does.
//
// A source is a folder registered into the brain. The brain's own folder is the source `brain`, the
// only writable one. Its session log (.cogby/self/log) is the source `log`: read-only, and searched
// only when named, because a day of raw session text would bury every other hit. Named, it is
// searched by entry, and an entry is found by the card it is about (search.cjs). Any other source
// is a folder the owner registered: indexed where it is, never copied, never written. Only markdown
// and plain text are read.

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { BrainError, open, transaction, indexEnabled, removeIndex, ensureIgnored, syncedAt, stampSynced } = require('./db.cjs');
const page = require('./page.cjs');

const MARKER = ['.cogby', 'brain.json'];
const LOCAL = ['.cogby', 'local.json'];
const LOG_DIR = ['.cogby', 'self', 'log'];
const WALK_UP = 12;
const MAX_BYTES = 2 * 1024 * 1024;
const TEXT_EXT = new Set(['.md', '.markdown', '.txt']);
const SKIP_DIRS = new Set(['node_modules', '__pycache__']);
// The program's own rule files at the top of a brain: generated, and about Cogby, not the owner.
const BRAIN_ROOT_SKIP = new Set(['agents.md', 'claude.md']);
// Never opened, by name alone (the list core/ops/import-brain.cjs refuses by).
const SECRET_FILE_RE = new RegExp([
  '^\\.env(\\..+)?$', '^\\.(npmrc|netrc|pgpass|htpasswd)$', '^credentials?(\\.(json|ya?ml|txt|csv|md))?$',
  '^secrets?\\.(json|ya?ml|env|txt|md)$', '^client_secret.*\\.json$', '^token_cache\\.json$',
  '^service[-_]?account.*\\.json$', '^id_(rsa|dsa|ecdsa|ed25519)(\\.pub)?$',
  '.*\\.(pem|ppk|p12|pfx|kdbx|keystore|jks|asc|gpg)$',
].join('|'), 'i');
const SECRET_DIR_RE = /^(\.ssh|\.gnupg|\.aws|\.sfdx|secrets?|credentials?)$/i;

const fwd = (p) => p.split(path.sep).join('/');
const fold = (p) => (process.platform === 'win32' ? path.resolve(p).toLowerCase() : path.resolve(p));
const isInside = (child, parent) => { const rel = path.relative(fold(parent), fold(child)); return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel)); };
const readJson = (file) => { try { return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, '')); } catch { return null; } };
const isBrain = (dir) => fs.existsSync(path.join(dir, ...MARKER));

// ---- which brain ------------------------------------------------------------------------------

// The per-machine config folder, by the rule of cli/lib/runtime-paths.cjs configDirectory.
function configDir(env) {
  const home = path.resolve(env.HOME || os.homedir());
  if (env.COGBY_CONFIG_DIR) return path.resolve(env.COGBY_CONFIG_DIR);
  if (process.platform === 'win32') return path.join(env.APPDATA || path.join(home, 'AppData', 'Roaming'), 'Cogby');
  if (process.platform === 'darwin') return path.join(home, 'Library', 'Application Support', 'Cogby');
  return path.join(env.XDG_CONFIG_HOME || path.join(home, '.config'), 'cogby');
}

function brainAbove(start) {
  let dir = path.resolve(start);
  for (let i = 0; i < WALK_UP; i++) {
    if (isBrain(dir)) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

// --brain, then COGBY_BRAIN, then the brain this folder is in, then the person's default brain, then
// the installed one.
function findBrain(options = {}) {
  const env = options.env || process.env;
  const named = options.brain || env.COGBY_BRAIN;
  if (named) {
    const dir = path.resolve(options.cwd || process.cwd(), named);
    if (!isBrain(dir)) throw new BrainError('NOT_A_BRAIN', `${dir} is not a brain (no .cogby/brain.json).`, 'Create one there with `cogby init --brain <path>`.');
    return dir;
  }
  const above = brainAbove(options.cwd || process.cwd());
  if (above) return above;
  const usual = defaultBrain(env);
  if (usual) return usual;
  const record = readJson(path.join(configDir(env), 'install.json'));
  if (record && typeof record.brain === 'string' && path.isAbsolute(record.brain) && isBrain(record.brain)) return path.resolve(record.brain);
  throw new BrainError('NO_BRAIN', 'No brain found from this folder.', 'Create one with `/cogby:onboarding` in Claude Code, or `cogby init` (tool: init); or pass --brain <path>.');
}

// ---- machine-local state ----------------------------------------------------------------------

function readLocal(brain) {
  const data = readJson(path.join(brain, ...LOCAL));
  const local = data && typeof data === 'object' ? data : {};
  if (!local.sources || typeof local.sources !== 'object') local.sources = {};
  if (!local.repos || typeof local.repos !== 'object') local.repos = {};
  return local;
}

// A JSON file replaced whole, so a reader never sees half of one.
function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`);
  fs.renameSync(tmp, file);
}

function writeLocal(brain, local) {
  writeJson(path.join(brain, ...LOCAL), local);
  // A machine's own paths never enter the brain's history.
  ensureIgnored(brain);
}

// The person's default brain on this machine: the one the brain tools and the session-start line use
// from a folder that is not a brain and is not linked to a project. Kept in brains.json in Cogby's
// per-machine config folder, beside the install record, never inside a brain. Setting it up is what
// `/cogby:onboarding` and `cogby init` do; a folder that IS a brain always wins over it.
const BRAINS_FILE = 'brains.json';

function defaultBrain(env = process.env) {
  const data = readJson(path.join(configDir(env), BRAINS_FILE));
  const named = data && typeof data.default === 'string' && path.isAbsolute(data.default) ? path.resolve(data.default) : null;
  return named && isBrain(named) ? named : null;
}

function setDefaultBrain(brain, env = process.env) {
  const file = path.join(configDir(env), BRAINS_FILE);
  const data = readJson(file);
  writeJson(file, { ...(data && typeof data === 'object' && !Array.isArray(data) ? data : {}), default: path.resolve(brain) });
  return path.resolve(brain);
}

// ---- sources ----------------------------------------------------------------------------------

function listSources(brain) {
  const sources = [{ id: 'brain', path: brain, mode: 'write', in_default_search: true, builtin: true }];
  const logDir = path.join(brain, ...LOG_DIR);
  if (fs.existsSync(logDir)) sources.push({ id: 'log', path: logDir, mode: 'read-only', in_default_search: false, builtin: true });
  for (const [id, entry] of Object.entries(readLocal(brain).sources)) {
    if (!entry || typeof entry.path !== 'string' || id === 'brain' || id === 'log') continue;
    sources.push({ id, path: entry.path, mode: 'read-only', in_default_search: entry.in_default_search !== false, builtin: false });
  }
  return sources;
}

const sourceId = (name) => String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);

function addSource(brain, folder, options = {}) {
  const dir = path.resolve(options.cwd || process.cwd(), String(folder || ''));
  if (!folder || !fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) throw new BrainError('NO_FOLDER', `${dir} is not a folder.`, 'Pass an existing folder: cogby sources add <path>.');
  if (isInside(dir, brain) || isInside(brain, dir)) throw new BrainError('OVERLAP', `${dir} overlaps the brain itself.`, 'The brain is already indexed as the source `brain`.');
  const id = sourceId(options.id || path.basename(dir));
  if (!id || id === 'brain' || id === 'log') throw new BrainError('BAD_ID', `"${options.id || path.basename(dir)}" cannot be a source id.`, 'Pass --id with letters and digits.');
  const local = readLocal(brain);
  const taken = local.sources[id];
  if (taken && fold(taken.path) !== fold(dir)) throw new BrainError('ID_TAKEN', `Source "${id}" already points at ${taken.path}.`, 'Pass --id <other-name>, or remove it first.');
  local.sources[id] = { path: dir, in_default_search: options.defaultSearch !== false, added: new Date().toISOString() };
  writeLocal(brain, local);
  return { id, path: dir, mode: 'read-only', in_default_search: options.defaultSearch !== false };
}

function removeSource(brain, id) {
  const local = readLocal(brain);
  if (!local.sources[id]) throw new BrainError('NO_SOURCE', `No source named "${id}".`, 'List them with `cogby sources list`. The sources `brain` and `log` are built in.');
  const removed = local.sources[id];
  delete local.sources[id];
  writeLocal(brain, local);
  return { id, path: removed.path };
}

// ---- reading files into the index -------------------------------------------------------------

// Every indexable file under a source, as { rel, abs, size, mtimeMs }, plus what was passed over.
function walk(source) {
  const files = [];
  const skipped = { credentials: 0, large: 0 };
  const visit = (dir, rel) => {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
      const childRel = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        if (SECRET_DIR_RE.test(entry.name)) { skipped.credentials++; continue; }
        if (entry.name.startsWith('.') || SKIP_DIRS.has(entry.name)) continue;
        visit(path.join(dir, entry.name), childRel);
        continue;
      }
      if (!entry.isFile()) continue;
      if (SECRET_FILE_RE.test(entry.name)) { skipped.credentials++; continue; }
      if (!TEXT_EXT.has(path.extname(entry.name).toLowerCase())) continue;
      if (source.id === 'brain' && !rel && BRAIN_ROOT_SKIP.has(entry.name.toLowerCase())) continue;
      let stat;
      try { stat = fs.statSync(path.join(dir, entry.name)); } catch { continue; }
      if (stat.size > MAX_BYTES) { skipped.large++; continue; }
      files.push({ rel: childRel, abs: path.join(dir, entry.name), size: stat.size, mtimeMs: Math.floor(stat.mtimeMs) });
    }
  };
  visit(source.path, '');
  return { files, skipped };
}

function deletePage(db, pageId) {
  db.prepare('DELETE FROM chunks_fts WHERE rowid IN (SELECT id FROM chunks WHERE page_id = ?)').run(pageId);
  for (const table of ['chunks', 'timeline_entries', 'facts']) db.prepare(`DELETE FROM ${table} WHERE page_id = ?`).run(pageId);
  db.prepare('DELETE FROM links WHERE from_page = ?').run(pageId);
  db.prepare('UPDATE links SET to_page = NULL WHERE to_page = ?').run(pageId);
  db.prepare('DELETE FROM pages WHERE id = ?').run(pageId);
}

// One file's rows, replaced whole. Returns the page id.
function indexFile(db, source, file, text, hash) {
  const parsed = page.parsePage(file.rel, text, { document: source.mode !== 'write' });
  const existing = db.prepare('SELECT id FROM pages WHERE source_id = ? AND slug = ?').get(source.id, parsed.slug);
  const values = [file.rel, parsed.type, parsed.title, parsed.truth, JSON.stringify(parsed.frontmatter), hash, file.size, file.mtimeMs,
    parsed.revision, new Date(file.mtimeMs).toISOString()];
  let pageId;
  if (existing) {
    pageId = existing.id;
    db.prepare('DELETE FROM chunks_fts WHERE rowid IN (SELECT id FROM chunks WHERE page_id = ?)').run(pageId);
    for (const table of ['chunks', 'timeline_entries', 'facts']) db.prepare(`DELETE FROM ${table} WHERE page_id = ?`).run(pageId);
    db.prepare('DELETE FROM links WHERE from_page = ?').run(pageId);
    db.prepare('UPDATE pages SET path = ?, type = ?, title = ?, truth = ?, frontmatter = ?, content_hash = ?, size = ?, mtime_ms = ?, revision = ?, updated_at = ? WHERE id = ?')
      .run(...values, pageId);
  } else {
    pageId = Number(db.prepare('INSERT INTO pages (source_id, slug, path, type, title, truth, frontmatter, content_hash, size, mtime_ms, revision, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(source.id, parsed.slug, ...values).lastInsertRowid);
  }
  // A day of the session log is one passage per entry (search.cjs searchLog).
  const chunks = page.chunkPage(parsed, { whole: source.id === 'log' });
  // A page with no text is still found by its title.
  if (!chunks.length) chunks.push({ part: parsed.document ? 'document' : 'truth', heading: '', text: parsed.title });
  const addChunk = db.prepare('INSERT INTO chunks (page_id, part, heading, text) VALUES (?, ?, ?, ?)');
  const addFts = db.prepare('INSERT INTO chunks_fts (rowid, text, title) VALUES (?, ?, ?)');
  chunks.forEach((chunk, index) => {
    const id = Number(addChunk.run(pageId, chunk.part, chunk.heading, chunk.text).lastInsertRowid);
    // The title rides on the page's first passage only, so a title match is counted once per page.
    addFts.run(id, chunk.text, index === 0 ? parsed.title : '');
  });
  const addLine = db.prepare('INSERT INTO timeline_entries (page_id, date, source, summary, author, actor, confirmed, retracted, record, agent_name) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
  for (const line of parsed.timeline) addLine.run(pageId, line.date, line.source, line.summary, line.author, line.actor, line.confirmed ? 1 : 0, line.retracted ? 1 : 0, line.record ? 1 : 0, line.agent_name || '');
  const addFact = db.prepare('INSERT OR REPLACE INTO facts (page_id, row_num, claim, kind, valid_from, valid_until, source, author, actor, confirmed, superseded_by, expired_at, retracted_at, recorded, agent_name) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
  for (const fact of parsed.facts) {
    addFact.run(pageId, fact.row, fact.claim, fact.kind, fact.valid_from || null, fact.valid_until || null, fact.source,
      fact.author, fact.actor, fact.confirmed ? 1 : 0, fact.superseded_by, fact.expired_at, fact.retracted_at || null,
      page.isDate(fact.recorded || '') ? fact.recorded : null, fact.agent_name || '');
  }
  const addLink = db.prepare('INSERT INTO links (from_page, to_page, target, type, found_in) VALUES (?, NULL, ?, ?, ?)');
  for (const link of parsed.links) addLink.run(pageId, link.target, link.type, link.found_in);
  return pageId;
}

// A name to a page row: `source:slug`, an exact slug, a folder's card, a unique last segment, a
// unique title. The brain's own pages win over a registered folder's.
function lookup(db, ref, options = {}) {
  let name = String(ref || '').trim().replace(/\\/g, '/').replace(/\.md$/i, '').replace(/^\/+|\/+$/g, '');
  if (!name) return null;
  let only = options.source || null;
  const colon = /^([a-z0-9-]+):(.+)$/i.exec(name);
  if (colon && db.prepare('SELECT 1 AS found FROM sources WHERE id = ?').get(colon[1].toLowerCase())) { only = colon[1].toLowerCase(); name = colon[2]; }
  const scope = only ? 'AND source_id = ?' : '';
  const args = only ? [only] : [];
  const order = "ORDER BY (source_id = 'brain') DESC, source_id, slug";
  const exact = (slug) => db.prepare(`SELECT * FROM pages WHERE slug = ? COLLATE NOCASE ${scope} ${order} LIMIT 1`).get(slug, ...args);
  const direct = exact(name) || exact(`${name}/card`);
  if (direct) return direct;
  const like = name.replace(/[\\%_]/g, '\\$&');
  const tail = db.prepare(`SELECT * FROM pages WHERE (slug LIKE ? ESCAPE '\\' OR slug LIKE ? ESCAPE '\\') ${scope} ${order} LIMIT 2`)
    .all(`%/${like}`, `%/${like}/card`, ...args);
  if (tail.length === 1) return tail[0];
  const titled = db.prepare(`SELECT * FROM pages WHERE title = ? COLLATE NOCASE ${scope} ${order} LIMIT 2`).all(name, ...args);
  return titled.length === 1 ? titled[0] : null;
}

function nearest(db, ref) {
  const last = String(ref || '').split('/').filter(Boolean).at(-1) || '';
  if (!last) return [];
  return db.prepare("SELECT source_id, slug FROM pages WHERE slug LIKE ? ESCAPE '\\' OR title LIKE ? ESCAPE '\\' ORDER BY (source_id = 'brain') DESC, length(slug) LIMIT 5")
    .all(`%${last.replace(/[\\%_]/g, '\\$&')}%`, `%${last.replace(/[\\%_]/g, '\\$&')}%`)
    .map((row) => (row.source_id === 'brain' ? row.slug : `${row.source_id}:${row.slug}`));
}

// A project or area that is done moves to archive/ under the same name. A link written while it was
// active (`[[projects/acme/card]]`, from a meeting record, a person's page) still names it: when the
// active name finds nothing, the archived one is tried. Only for links: a write to `projects/acme`
// never lands in the archive.
const ARCHIVED_RE = /^(?:projects|areas)\/(.+)$/i;
const archived = (db, target) => { const m = ARCHIVED_RE.exec(String(target || '').trim()); return m ? lookup(db, `archive/${m[1]}`, { source: 'brain' }) : null; };

function resolveLinks(db) {
  const set = db.prepare('UPDATE links SET to_page = ? WHERE rowid = ?');
  for (const link of db.prepare('SELECT rowid AS id, target FROM links').all()) {
    const target = lookup(db, link.target) || archived(db, link.target);
    set.run(target ? target.id : null, link.id);
  }
}

// Reads changed files into the index. `quick` trusts an unchanged size and modified time and skips
// the read; without it every file is hashed. A missing or outdated index.db makes every file new,
// which is the rebuild.
// Before the index is touched: every source walked once. Returns a Map of source id -> what the walk
// found.
function prepare(sources, options) {
  const walked = new Map();
  for (const source of sources) {
    if (!wanted(source, options)) continue;
    if (!fs.existsSync(source.path)) continue;
    walked.set(source.id, walk(source));
  }
  return walked;
}

// Which sources this pass reads. One that is named, or all of them; with no kept index, only the
// ones a plain search covers, so a year of session logs is not re-read on every command.
// `everySource` is a read that must see the day logs too (the decision log): they are read even then.
const wanted = (source, options) => (options.source ? source.id === options.source : !options.memory || options.everySource || source.in_default_search);

function syncInto(db, brain, fresh, options = {}) {
  const sources = listSources(brain);
  if (options.source && !sources.some((source) => source.id === options.source)) {
    throw new BrainError('NO_SOURCE', `No source named "${options.source}".`, 'List them with `cogby sources list`.');
  }
  const stats = { index: options.memory ? 'off' : 'on', rebuilt: fresh, scanned: 0, changed: 0, unchanged: 0, removed: 0, skipped: { credentials: 0, large: 0, unreadable: [] }, sources: [] };
  const walked = prepare(sources, options);
  // A long pass is committed in steps, so a write (`cogby log`) that arrives while a background sync
  // is reading a large folder waits for one step, not for the whole pass.
  let pending = 0;
  const step = () => { if (!options.memory && ++pending >= SYNC_BATCH) { pending = 0; db.exec('COMMIT'); db.exec('BEGIN'); } };
  transaction(db, () => {
    // When each source was last read. A full pass (`cogby sync`) and a pass that found something
    // changed stamp it; a quick look that found nothing new leaves it, so reading the brain twice does
    // not move the date and the date means "its content was last taken in then".
    const read = new Map(db.prepare('SELECT id, synced_at FROM sources').all().map((row) => [row.id, row.synced_at]));
    const now = new Date().toISOString();
    db.prepare('DELETE FROM sources').run();
    const addSourceRow = db.prepare('INSERT INTO sources (id, path, remote, mode, in_default_search, synced_at) VALUES (?, ?, NULL, ?, ?, ?)');
    for (const source of sources) addSourceRow.run(source.id, source.path, source.mode, source.in_default_search ? 1 : 0, read.get(source.id) || null);
    const stamp = db.prepare('UPDATE sources SET synced_at = ? WHERE id = ?');
    // A source that was removed takes its pages with it.
    const known = new Set(sources.map((source) => source.id));
    for (const row of db.prepare('SELECT id, source_id FROM pages').all()) {
      if (!known.has(row.source_id)) { deletePage(db, row.id); stats.removed++; }
    }
    for (const source of sources) {
      if (!wanted(source, options)) continue;
      const row = { id: source.id, scanned: 0, changed: 0, removed: 0 };
      stats.sources.push(row);
      // A folder that is not there (an unplugged drive) keeps its rows: absent is not deleted.
      if (!fs.existsSync(source.path)) { row.missing = true; continue; }
      if (options.beat) options.beat();
      const indexed = new Map(db.prepare('SELECT id, slug, content_hash, size, mtime_ms FROM pages WHERE source_id = ?').all(source.id).map((r) => [r.slug, r]));
      const { files, skipped } = walked.get(source.id) || walk(source);
      stats.skipped.credentials += skipped.credentials;
      stats.skipped.large += skipped.large;
      const touch = db.prepare('UPDATE pages SET size = ?, mtime_ms = ? WHERE id = ?');
      for (const file of files) {
        row.scanned++;
        const slug = page.slugOf(file.rel);
        const have = indexed.get(slug);
        indexed.delete(slug);
        if (options.quick && have && have.size === file.size && have.mtime_ms === file.mtimeMs) { stats.unchanged++; continue; }
        let buffer;
        try { buffer = fs.readFileSync(file.abs); } catch { continue; }
        const hash = crypto.createHash('sha1').update(buffer).digest('hex');
        if (have && have.content_hash === hash) { touch.run(file.size, file.mtimeMs, have.id); stats.unchanged++; continue; }
        indexFile(db, source, file, buffer.toString('utf8'), hash);
        row.changed++;
        step();
      }
      for (const gone of indexed.values()) { deletePage(db, gone.id); row.removed++; step(); }
      if (!options.quick || row.changed || row.removed || !read.get(source.id)) stamp.run(now, source.id);
      stats.scanned += row.scanned; stats.changed += row.changed; stats.removed += row.removed;
    }
    if (stats.changed || stats.removed || fresh) resolveLinks(db);
    // A pass over every source is what "the index as of" means; a pass over one source is not.
    if (!options.source) stampSynced(db, now);
    stats.synced_at = options.source ? syncedAt(db) : now;
  });
  stats.pages = db.prepare('SELECT COUNT(*) AS n FROM pages').get().n;
  return stats;
}

// Opens the index, runs `work(db, stats)`, closes it. Every read and every write goes through here.
//
// A kept index is answered from as it is: no file is walked, so a read never waits on a sync. When
// its last sync is older than STALE_MS, a background sync is started and not waited for (see the
// header of db.cjs). `stats.synced_at` says when the index was last synced, and `stats.background`
// is 'started' or 'running' when a background sync is on its way.
//
// The files are read first (`syncInto`) only when there is nothing else to answer from: the index
// is switched off (a database in memory, built for this one call, then gone), index.db is not there
// yet or was just dropped for a new schema, or the caller is a sync (`sync: true`).
// `create: false` is for a caller that may read a kept index but must never make one.
const indexWanted = (brain) => readLocal(brain).index !== false;
const STALE_MS = 60 * 1000;
const SYNC_BATCH = 200;

function withIndex(brain, work, options = {}) {
  const mode = !indexWanted(brain) ? 'memory' : options.create === false ? 'existing' : 'keep';
  const { db, fresh, memory } = open(brain, { mode });
  try {
    if (options.sync || memory || fresh) {
      // Every sync, so also the background one a session start begins: an older brain learns here
      // what is and is not ignored (db.cjs ensureIgnored), without waiting for a write.
      try { ensureIgnored(brain); } catch { /* a read is not failed by the .gitignore */ }
      return work(db, { ...syncInto(db, brain, fresh, { quick: options.quick !== false, source: options.source, memory, beat: options.beat, everySource: options.everySource }), synced: true });
    }
    const stats = { index: 'on', rebuilt: false, synced: false, synced_at: syncedAt(db), background: null };
    const age = stats.synced_at ? Date.now() - Date.parse(stats.synced_at) : Infinity;
    // `kick: false` is a caller that runs after every turn in any folder (the day-log hook asking
    // whether a folder is a place): it reads the index as it is and starts nothing.
    if (!(age <= STALE_MS) && options.kick !== false) stats.background = kick(brain);
    return work(db, stats);
  } finally { db.close(); }
}

// Starts the background sync and says what happened, for a caller that reports it. Never throws: a
// read is not failed by the thing that keeps it fresh.
function kick(brain) {
  try {
    const started = require('./background.cjs').start(brain);
    return started.started ? 'started' : started.why === 'running' ? 'running' : null;
  } catch { return null; }
}

// `cogby sync`: every file hashed. Into index.db when the index is on; read and dropped when it is off.
const sync = (brain, options = {}) => withIndex(brain, (db, stats) => stats, { sync: true, quick: !!options.quick, source: options.source, beat: options.beat });
// The same pass trusting unchanged sizes and times, for commands that change what is indexed (a
// source added or removed).
const refresh = (brain, options = {}) => withIndex(brain, (db, stats) => stats, { sync: true, quick: options.quick !== false, source: options.source });

// The switch. On runs a sync, so the index is there when the command returns; off removes the
// file. Nothing else changes either way: the files are the record.
function setIndex(brain, on) {
  const local = readLocal(brain);
  if (on) delete local.index; else local.index = false;
  writeLocal(brain, local);
  if (on) return { ...sync(brain), switched: 'on' };
  return { index: 'off', switched: 'off', removed: removeIndex(brain) };
}

// The sources as a person needs to see them: what is mounted, where, whether the folder is still
// there, how many files of it are indexed and when it was last read. `cogby sources` prints this.
function sourceStatus(brain) {
  return withIndex(brain, (db, stats) => {
    const count = db.prepare('SELECT COUNT(*) AS n FROM pages WHERE source_id = ?');
    const row = db.prepare('SELECT synced_at FROM sources WHERE id = ?');
    return {
      index: stats.index,
      sources: listSources(brain).map((source) => {
        const synced = row.get(source.id);
        return {
          id: source.id, path: source.path, mode: source.mode, searched: !!source.in_default_search, builtin: !!source.builtin,
          missing: !fs.existsSync(source.path), files: count.get(source.id).n, last_sync: synced ? synced.synced_at : null,
        };
      }),
    };
  });
}

function indexStatus(brain) {
  const file = path.join(brain, '.cogby', 'index.db');
  let bytes = null;
  try { bytes = fs.statSync(file).size; } catch { /* not there */ }
  return { index: indexWanted(brain) ? 'on' : 'off', file, exists: bytes !== null, bytes };
}

function pageFile(db, row) {
  const source = db.prepare('SELECT path FROM sources WHERE id = ?').get(row.source_id);
  return path.join(source.path, ...row.path.split('/'));
}

function getPage(brain, ref, options = {}) {
  // `log:2026-11-09` names its source: with no kept index, that is the one source to read.
  const named = /^([a-z0-9-]+):/i.exec(String(ref || ''));
  const source = options.source || (named && listSources(brain).some((entry) => entry.id === named[1].toLowerCase()) ? named[1].toLowerCase() : undefined);
  return withIndex(brain, (db) => {
    const row = lookup(db, ref, options);
    if (!row) {
      const near = nearest(db, ref);
      const hint = near.length ? `Closest: ${near.join(', ')}.` : 'Find it with `cogby search "<words>"`.';
      throw new BrainError('NOT_FOUND', `No page "${ref}".`, `${hint} A page made outside Cogby is indexed by the next sync; \`cogby sync\` does it now.`);
    }
    const file = pageFile(db, row);
    let content;
    try { content = page.lf(fs.readFileSync(file, 'utf8')); }
    catch (error) {
      if (error.code !== 'ENOENT') throw error;
      kick(brain);
      throw new BrainError('NOT_FOUND', `The page "${ref}" is in the index, but its file is gone: ${file}`, 'It was moved or deleted outside Cogby. A background sync has been started; `cogby sync` does it now.');
    }
    const count = (sql) => db.prepare(sql).get(row.id).n;
    return {
      source: row.source_id, slug: row.slug, title: row.title, type: row.type, revision: row.revision,
      path: file, updated_at: row.updated_at,
      facts: count('SELECT COUNT(*) AS n FROM facts WHERE page_id = ? AND superseded_by IS NULL AND expired_at IS NULL AND retracted_at IS NULL'),
      timeline: count('SELECT COUNT(*) AS n FROM timeline_entries WHERE page_id = ? AND retracted = 0'),
      links_in: count('SELECT COUNT(*) AS n FROM links WHERE to_page = ?'),
      content,
    };
  }, { source });
}

module.exports = {
  BrainError, MARKER, SECRET_FILE_RE, SECRET_DIR_RE,
  isBrain, findBrain, defaultBrain, setDefaultBrain, configDir, readLocal, writeLocal, fwd, fold, isInside,
  listSources, addSource, removeSource, walk,
  sync, refresh, setIndex, indexStatus, sourceStatus, indexWanted, indexEnabled, syncInto, withIndex, STALE_MS, indexFile, deletePage, resolveLinks, lookup, nearest, pageFile, getPage,
};
