'use strict';

// The index is a switch: `cogby index on | off | status`, kept in the brain's machine-local
// settings, on unless turned off. Off, nothing is kept: each command reads the files into an index
// held in memory and throws it away, which is enough for a few hundred files. A large brain and
// the session log want it on.
//
// The kept index: one SQLite file per brain at <brain>/.cogby/index.db, opened with Node's own
// node:sqlite. Every row in it is read out of a file, so it is never backed up and never migrated:
// a schema change bumps SCHEMA_VERSION and the next open drops the tables, and the next sync fills
// them again.
//
// How it is kept up to date. A read (search, get, context, view) answers from index.db as it is and
// never waits for the files to be walked. Three things bring it up to date:
//   - a write through Cogby (log, remember) indexes the page it touched in the same step;
//   - a background sync: a detached `cogby sync --quick --background` that nobody waits for, started
//     when a session starts, after each turn, and by any read that finds the last sync older than a
//     minute (core/brain/background.cjs; one at a time, behind .cogby/sync.lock);
//   - `cogby sync`, the explicit full pass, which `cogby dream` also runs.
// So a file edited outside Cogby is found a moment later, not in the same command, and every search
// result says when the index was last synced (`index_as_of`). The time is the row `synced_at` of
// the table `meta`. The file is in WAL mode, so the background writer does not block a reader.
// Only two cases still sync before they answer, because there is nothing else to read from: an
// index.db that is not there yet (or was just dropped for a new schema), and the index switched off.

const fs = require('fs');
const path = require('path');

// 3: no table changed. Timeline lines are read differently (a dash in a line's source no longer
// hides the decision behind it, page.cjs parseTimelineLine), and a page whose file did not change
// is never read again, so the rows are rebuilt once from the files.
// 4: a timeline line and a fact can be retracted (`retracted`, `retracted_at`): kept in the file, and
// left out of what is read from here.
// 5: a timeline line can be the record of a command Cogby ran (`record`), told from a claim: left out
// of the unconfirmed list and count and of what a session start shows as last learned. The lines
// written before that state existed are recognised when a file is read (page.cjs), so the rows are
// rebuilt once from the files and nothing in a brain is converted.
// 6: a fact has the day it was recorded (`recorded`), apart from the day it became true (`valid_from`).
// Staleness counts from the first, so a fact written today about something true since last year is
// new evidence. A row written before the column existed has none, and its valid_from stands in.
// 7: a timeline line and a fact say which agent wrote them, when their tail does (`agent_name`, ''
// when it names none). Read from the files like every other column, so the rows are rebuilt once.
const SCHEMA_VERSION = 7;
const INDEX_FILE = ['.cogby', 'index.db'];
const TABLES = ['sources', 'pages', 'chunks', 'chunks_fts', 'links', 'timeline_entries', 'facts', 'meta'];
// Made on open when missing, so an index built before the table existed was not rebuilt for it.
const META = 'CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT)';

const SCHEMA = `
CREATE TABLE sources (
  id TEXT PRIMARY KEY, path TEXT NOT NULL, remote TEXT, mode TEXT NOT NULL,
  in_default_search INTEGER NOT NULL DEFAULT 1, synced_at TEXT);
CREATE TABLE pages (
  id INTEGER PRIMARY KEY, source_id TEXT NOT NULL, slug TEXT NOT NULL, path TEXT NOT NULL,
  type TEXT NOT NULL, title TEXT NOT NULL, truth TEXT NOT NULL DEFAULT '', frontmatter TEXT NOT NULL DEFAULT '{}',
  content_hash TEXT NOT NULL, size INTEGER NOT NULL DEFAULT 0, mtime_ms REAL NOT NULL DEFAULT 0,
  revision INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL,
  UNIQUE (source_id, slug));
CREATE TABLE chunks (
  id INTEGER PRIMARY KEY, page_id INTEGER NOT NULL, part TEXT NOT NULL, heading TEXT NOT NULL DEFAULT '', text TEXT NOT NULL);
CREATE INDEX chunks_page ON chunks (page_id);
CREATE VIRTUAL TABLE chunks_fts USING fts5 (text, title, tokenize = 'porter unicode61');
CREATE TABLE links (
  from_page INTEGER NOT NULL, to_page INTEGER, target TEXT NOT NULL, type TEXT NOT NULL, found_in TEXT NOT NULL);
CREATE INDEX links_from ON links (from_page);
CREATE INDEX links_to ON links (to_page);
CREATE TABLE timeline_entries (
  page_id INTEGER NOT NULL, date TEXT NOT NULL, source TEXT NOT NULL DEFAULT '', summary TEXT NOT NULL,
  author TEXT NOT NULL DEFAULT '', actor TEXT NOT NULL DEFAULT '', confirmed INTEGER NOT NULL DEFAULT 0,
  retracted INTEGER NOT NULL DEFAULT 0, record INTEGER NOT NULL DEFAULT 0, agent_name TEXT NOT NULL DEFAULT '');
CREATE INDEX timeline_page ON timeline_entries (page_id);
CREATE INDEX timeline_date ON timeline_entries (date);
CREATE TABLE facts (
  page_id INTEGER NOT NULL, row_num INTEGER NOT NULL, claim TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'fact',
  valid_from TEXT, valid_until TEXT, source TEXT NOT NULL DEFAULT '',
  author TEXT NOT NULL DEFAULT '', actor TEXT NOT NULL DEFAULT '', confirmed INTEGER NOT NULL DEFAULT 0,
  superseded_by INTEGER, expired_at TEXT, retracted_at TEXT, recorded TEXT, agent_name TEXT NOT NULL DEFAULT '',
  UNIQUE (page_id, row_num));
`;

class BrainError extends Error {
  constructor(code, message, hint) {
    super(message);
    this.name = 'BrainError';
    this.code = code;
    this.hint = hint || null;
  }
}

// node:sqlite prints an ExperimentalWarning on the Node versions that still call it experimental.
// A hook's stderr is shown to the owner, so that one warning is dropped and every other is kept.
function loadSqlite() {
  const emit = process.emitWarning;
  process.emitWarning = function quiet(warning, ...rest) {
    const type = warning && warning.name ? warning.name : (rest[0] && rest[0].type) || rest[0];
    if (type === 'ExperimentalWarning' && /sqlite/i.test(String((warning && warning.message) || warning))) return undefined;
    return emit.call(process, warning, ...rest);
  };
  try { return require('node:sqlite'); }
  catch (error) {
    throw new BrainError('NO_SQLITE', `This Node (${process.version}) has no built-in SQLite.`,
      'The brain commands need Node 22.13 or newer (node:sqlite). Run `node -v`, then update Node.');
  } finally { process.emitWarning = emit; }
}

const indexPath = (brain) => path.join(brain, ...INDEX_FILE);

// The index and the machine-local files stay out of the brain's history. Rules are only ever
// appended, and only when the brain already keeps a .gitignore: a rule the owner removed is theirs
// to remove. The copy of the page kept for publishing (under .gateway/) is this machine's too.
const IGNORE_RULES = ['.cogby/index.db', '.cogby/index.db-*', '.cogby/local.json', '.cogby/state.json', '.cogby/write.lock', '.cogby/sync.lock',
  '.cogby/self/.gateway/'];

// The note and notification stores travel with the brain, as the to-dos always did (owner,
// 2026-11-13). Cogby itself wrote these two rules into every brain's .gitignore until then, so an
// existing brain has them taken out here, once: exactly these lines and no other (the outbox and
// health-check files beside the notes, the push subscriptions, local.json and the index stay
// ignored). The line left in their place is the record that it was done: with it there, a rule the
// owner puts back afterwards is the owner's and is kept.
const TRAVEL_RULES = ['.cogby/notifications/store.json', '.cogby/notes/store.json'];
const TRAVEL_MARK = '# To-dos, notes and notifications are not ignored: they travel with the brain';

function ensureIgnored(brain) {
  const file = path.join(brain, '.gitignore');
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch { return false; }
  const eol = /\r\n/.test(text) ? '\r\n' : '\n';
  let lines = text.split(/\r?\n/);
  let freed = false;
  if (!lines.some((line) => line.trim() === TRAVEL_MARK)) {
    const at = lines.findIndex((line) => TRAVEL_RULES.includes(line.trim()));
    if (at !== -1) {
      lines = lines.filter((line) => !TRAVEL_RULES.includes(line.trim()));
      lines.splice(at, 0, TRAVEL_MARK);
      freed = true;
    }
  }
  const have = new Set(lines.map((line) => line.trim()));
  const missing = IGNORE_RULES.filter((rule) => !have.has(rule));
  if (!freed && !missing.length) return false;
  // Committed on its own when the two rules were taken out and the file held nothing else
  // uncommitted: one file, one commit, like every other change Cogby makes to the brain. With the
  // owner's own edits in it, it is left for them or the wrap-up.
  const clean = freed && unchangedInGit(brain, '.gitignore');
  let next = lines.join(eol);
  if (missing.length) next = `${next.replace(/\s*$/, '')}${eol}${eol}# The search index and this machine's own paths: rebuilt by \`cogby sync\`, never committed${eol}${missing.join(eol)}${eol}`;
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, next);
  fs.renameSync(tmp, file);
  if (clean) { try { require('./write.cjs').commitFile(brain, '.gitignore', 'Cogby: notes and notifications travel with the brain'); } catch { /* left in the working tree */ } }
  return true;
}

// Tracked by the brain's own repository, with nothing uncommitted in it.
function unchangedInGit(brain, rel) {
  try {
    const { gitIn, ownRepository } = require('../lib/brain-repo.cjs');
    if (!ownRepository(brain).repo) return false;
    const git = gitIn(brain);
    // `--no-optional-locks`: a look never takes git's index lock (see write.cjs commitDayLogs).
    return git('ls-files', '--error-unmatch', '--', rel).ok && git('--no-optional-locks', 'status', '--porcelain', '--', rel).out === '';
  } catch { return false; }
}

const indexEnabled = (brain) => fs.existsSync(indexPath(brain));

// Returns { db, fresh, memory }. `fresh` when the tables were just created, so the caller knows this
// sync is a rebuild. `mode` is 'keep' (index.db, made if it is missing), 'memory' (a database that
// lives only for this call) or 'existing' (index.db when it is there, memory when it is not: for a
// caller that must not create a file).
function open(brain, options = {}) {
  const { DatabaseSync } = loadSqlite();
  const file = indexPath(brain);
  const existed = fs.existsSync(file);
  const mode = options.mode || 'keep';
  const memory = mode === 'memory' || (mode === 'existing' && !existed);
  if (!memory) fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(memory ? ':memory:' : file);
  if (!memory) {
    db.exec('PRAGMA busy_timeout = 5000');
    db.exec('PRAGMA journal_mode = WAL');
  }
  const version = db.prepare('PRAGMA user_version').get().user_version;
  let fresh = false;
  if (version !== SCHEMA_VERSION) {
    for (const table of TABLES) db.exec(`DROP TABLE IF EXISTS ${table}`);
    db.exec(SCHEMA);
    db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
    fresh = true;
  }
  if (!db.prepare("SELECT 1 AS found FROM sqlite_master WHERE type = 'table' AND name = 'meta'").get()) db.exec(META);
  if (!memory && !existed) ensureIgnored(brain);
  return { db, fresh, memory };
}

function transaction(db, work) {
  db.exec('BEGIN');
  try { const result = work(); db.exec('COMMIT'); return result; }
  catch (error) { try { db.exec('ROLLBACK'); } catch { /* the first error is the one that matters */ } throw error; }
}

// When the last sync pass over every source finished, as an ISO time, or null when none has.
function syncedAt(db) {
  const row = db.prepare("SELECT value FROM meta WHERE key = 'synced_at'").get();
  return row && row.value ? row.value : null;
}
const stampSynced = (db, iso) => db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('synced_at', ?)").run(iso);

// Turns the kept index off: the files are untouched, and the next command reads them directly.
function removeIndex(brain) {
  const dir = path.dirname(indexPath(brain));
  let removed = 0;
  let names = [];
  try { names = fs.readdirSync(dir); } catch { return 0; }
  for (const name of names) if (name === 'index.db' || name.startsWith('index.db-')) { fs.rmSync(path.join(dir, name), { force: true }); removed++; }
  return removed;
}

module.exports = { SCHEMA_VERSION, BrainError, open, transaction, syncedAt, stampSynced, indexPath, indexEnabled, removeIndex, ensureIgnored, IGNORE_RULES };
