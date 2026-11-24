'use strict';

// `cogby dream`: the nightly pass over a personal brain. Everything here is mechanical and calls
// no model: it re-reads the files, counts what the index now holds, checks the facts tables, reads
// what was committed in the linked code repos, and flags the pages nothing new has been said about.
// It writes no page of what the owner knows. What it learned goes to the report and to
// .cogby/state.json. The one line it does write is its own run, on the page of a routine that runs
// it ("dream"), when the owner keeps one: that is how "when did the nightly pass last run" is answered.
//
// The one judgment step, rewriting a page's current truth when its timeline has changed the
// picture, is left to the owner: rewriteTruth below only names the pages that are candidates.

const fs = require('fs');
const path = require('path');
const brainLib = require('./brain.cjs');
const { gitIn } = require('../lib/brain-repo.cjs');

const STALE_DAYS = 14;
const STATE = ['.cogby', 'state.json'];
const DAY_MS = 86400000;

const isoDay = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
const daysBetween = (from, to) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);

function readState(brain) {
  try { const data = JSON.parse(fs.readFileSync(path.join(brain, ...STATE), 'utf8')); return data && typeof data === 'object' ? data : {}; }
  catch { return {}; }
}

// The newest dated evidence on a page: a timeline line, or the day a fact was recorded. Not the day a
// fact became true: a fact written today about something true since last year is new evidence today.
// A row from before facts carried a recorded day has only its valid_from, which stands in for it.
function newestEvidence(db, pageId) {
  const row = db.prepare(
    `SELECT MAX(d) AS newest FROM (
       SELECT MAX(date) AS d FROM timeline_entries WHERE page_id = ? AND retracted = 0
       UNION ALL SELECT MAX(COALESCE(recorded, valid_from)) AS d FROM facts WHERE page_id = ? AND retracted_at IS NULL)`,
  ).get(pageId, pageId);
  return row && row.newest ? row.newest : null;
}

// null when the page is fresh, or has never carried evidence and is not a project.
function staleness(db, row, today) {
  // Archived work is finished, not quiet. A meeting record is written once and never added to
  // (core/brain/meetings.cjs): it is a record, not a page that has gone quiet.
  if (/^archive\//i.test(row.slug) || row.type === 'meeting') return null;
  const newest = newestEvidence(db, row.id);
  // A project with no dated evidence at all is flagged. A brain from before projects had one card may still
  // hold a project's old second file: part of the project, not a page of its own.
  if (!newest) return row.type === 'project' && !/(^|\/)progress$/i.test(row.slug) ? { slug: row.slug, newest: null, days: null } : null;
  const days = daysBetween(newest, today);
  return days > STALE_DAYS ? { slug: row.slug, newest, days } : null;
}

function checkFacts(db, today) {
  const problems = [];
  const rows = db.prepare(
    `SELECT p.slug, f.row_num, f.claim, f.valid_until, f.superseded_by, f.expired_at, f.retracted_at FROM facts f JOIN pages p ON p.id = f.page_id
      WHERE p.source_id = 'brain' ORDER BY p.slug, f.row_num`,
  ).all();
  const have = new Set(rows.map((row) => `${row.slug}#${row.row_num}`));
  for (const row of rows) {
    if (row.superseded_by && !have.has(`${row.slug}#${row.superseded_by}`)) {
      problems.push({ slug: row.slug, row: row.row_num, problem: `superseded by #${row.superseded_by}, which is not in the table` });
    }
    if (!row.superseded_by && !row.expired_at && !row.retracted_at && row.valid_until && row.valid_until < today) {
      problems.push({ slug: row.slug, row: row.row_num, problem: `valid until ${row.valid_until}, still marked active` });
    }
  }
  return problems;
}

function repoCommits(brain, since) {
  const out = [];
  const sinceMs = Date.parse(since);
  // Every linked folder of this machine that is a git repository, whatever its role.
  for (const { page: slug, ...entry } of require('./link.cjs').linkedFolders(brain)) {
    if (!fs.existsSync(entry.path)) { out.push({ slug, folder: entry.path, missing: true, commits: [] }); continue; }
    if (!gitIn(entry.path)('rev-parse', '--git-dir').ok) continue;
    // The cut is made here, on the commit's own clock time, not by git's reading of a date string.
    const log = gitIn(entry.path)('log', '-n', '300', '--date=short', '--format=%h%x09%ct%x09%ad%x09%an%x09%s');
    const commits = (log.ok && log.out ? log.out.split('\n') : []).map((line) => {
      const [sha, time, date, author, ...subject] = line.split('\t');
      return { sha, time: Number(time) * 1000, date, author, subject: subject.join('\t') };
    }).filter((commit) => commit.time > sinceMs).slice(0, 30).map(({ time, ...commit }) => commit);
    out.push({ slug, folder: entry.path, commits });
  }
  return out;
}

// Rewriting a page's current truth takes a model and the owner's say, so this pass does not do it.
// It lists the pages with evidence newer than the last pass and touches none of them.
function rewriteTruth(db, since) {
  const candidates = db.prepare(
    `SELECT DISTINCT p.slug FROM pages p JOIN timeline_entries t ON t.page_id = p.id
      WHERE p.source_id = 'brain' AND p.type NOT IN ('routine', 'meeting') AND t.retracted = 0 AND t.record = 0 AND t.date >= ? ORDER BY p.slug`,
  ).all(since.slice(0, 10)).map((row) => row.slug);
  return { built: false, rewritten: 0, candidates, note: 'No page was changed: the summary at the top of a page changes with the owner.' };
}

function dream(brain, options = {}) {
  const now = options.now ? new Date(options.now) : new Date();
  const today = isoDay(now);
  const state = readState(brain);
  const last = state.dream && typeof state.dream.last === 'string' ? state.dream.last : null;
  const since = last || new Date(now.getTime() - STALE_DAYS * DAY_MS).toISOString();

  // One pass: every file hashed, into the kept index when there is one and into memory when not.
  let sync = null;
  const report = brainLib.withIndex(brain, (db, stats) => {
    sync = stats;
    const one = (sql) => db.prepare(sql).get().n;
    // A routine is quiet when it is not due; whether it is overdue is `cogby routines`, not staleness.
    const pages = db.prepare("SELECT id, slug, type FROM pages WHERE source_id = 'brain' AND type != 'routine' ORDER BY slug").all();
    return {
      index: {
        pages: one('SELECT COUNT(*) AS n FROM pages'),
        links: one('SELECT COUNT(*) AS n FROM links WHERE to_page IS NOT NULL'),
        unresolved_links: db.prepare(
          'SELECT p.slug, l.target FROM links l JOIN pages p ON p.id = l.from_page WHERE l.to_page IS NULL ORDER BY p.slug, l.target',
        ).all().map((row) => ({ ...row })),
        timeline_lines: one('SELECT COUNT(*) AS n FROM timeline_entries'),
        facts_active: one('SELECT COUNT(*) AS n FROM facts WHERE superseded_by IS NULL AND expired_at IS NULL AND retracted_at IS NULL'),
        facts_retired: one('SELECT COUNT(*) AS n FROM facts WHERE superseded_by IS NOT NULL OR expired_at IS NOT NULL OR retracted_at IS NOT NULL'),
      },
      facts: checkFacts(db, today),
      stale: pages.map((row) => staleness(db, row, today)).filter(Boolean),
      rewrite: rewriteTruth(db, since),
    };
  }, { sync: true, quick: false });
  const repos = repoCommits(brain, since);

  const file = path.join(brain, ...STATE);
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify({ ...state, dream: { last: now.toISOString(), stale: report.stale.map((entry) => entry.slug) } }, null, 2)}\n`);
  fs.renameSync(tmp, file);
  require('./db.cjs').ensureIgnored(brain);
  // Recorded after the pass, so the run's own line is not part of what the pass read. Never fails it.
  let routines = [];
  if (options.record !== false) {
    try {
      const result = `${report.stale.length} stale page${report.stale.length === 1 ? '' : 's'}, ${report.facts.length} fact${report.facts.length === 1 ? '' : 's'} to look at`;
      routines = require('./routines.cjs').ran(brain, 'dream', { source: 'cogby dream', result, date: today, ifAny: true, env: options.env }).recorded.map((entry) => entry.name);
    } catch { /* the pass is what matters */ }
  }
  return { brain, ran_at: now.toISOString(), since, sync, ...report, repos, routines_recorded: routines };
}

module.exports = { dream, staleness, newestEvidence, rewriteTruth, STALE_DAYS, isoDay };
