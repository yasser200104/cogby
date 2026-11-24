'use strict';

// Keyword search, no model. Two questions are put to the one full-text table: which passages hold
// the words, and which page titles do. The two ranked lists are merged into one by reciprocal rank,
// and every hit says how strong its match is, so an agent can tell "this is the page" from "these
// words appear somewhere":
//
//   exact-title   the title is the query
//   title         the query's words are in the title
//   all-words     one passage holds every word
//   some-words    only some of the words were found (the fallback when little else matched)
//
//   card          day log only: the entry's `Card:` line names the page the query names
//
// Stemmed (porter), so "sandboxes" finds "sandbox".

const path = require('path');
const { withIndex, lookup } = require('./brain.cjs');

const RRF_K = 60;
const POOL = 60;
const STOP = new Set(('a an and are as at be but by did do does for from how i in is it me my of on or our that the this to was we '
  + 'were what when where which who why with you your about').split(' '));

const norm = (text) => String(text || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

function terms(query) {
  const all = (String(query || '').match(/[\p{L}\p{N}]+/gu) || []).map((word) => word.toLowerCase());
  const kept = all.filter((word) => word.length > 1 && !STOP.has(word));
  return [...new Set(kept.length ? kept : all)];
}

const matchExpr = (column, words, joiner) => `${column} : (${words.map((word) => `"${word}"`).join(joiner)})`;

// The day log, searched by entry: one result is one `### HH:MM` entry of one day, not a day's file.
// When the query names a page of the brain (its slug, its folder, its title), the entries about it
// come first, newest first, marked `card`: the ones whose `Card:` line holds that page's slug. Then
// the entries that hold the words, as in any search.
function searchLog(db, query, words, limit) {
  const folder = (db.prepare("SELECT path FROM sources WHERE id = 'log'").get() || {}).path || '';
  const select = (extra, order, most) => db.prepare(
    `SELECT c.id, c.page_id, c.part, c.heading,${extra} snippet(chunks_fts, 0, '', '', ' … ', 28) AS snippet
       FROM chunks_fts JOIN chunks c ON c.id = chunks_fts.rowid JOIN pages p ON p.id = c.page_id
      WHERE chunks_fts MATCH ? AND p.source_id = 'log' ORDER BY ${order} LIMIT ${most}`,
  );
  const rows = (expr) => select('', 'bm25(chunks_fts)', POOL).all(expr);
  const hits = new Map();
  const take = (list, match) => { for (const row of list) if (!hits.has(row.id)) hits.set(row.id, { ...row, match }); };
  const named = lookup(db, query, { source: 'brain' });
  const card = named && named.source_id === 'brain' ? named : null;
  const slug = card ? (card.slug.match(/[\p{L}\p{N}]+/gu) || []).map((word) => word.toLowerCase()) : [];
  if (slug.length) {
    // The slug as a phrase finds the candidates; the entry counts when the slug is on its `Card:`
    // line, or on the `Place: … · page <slug>` line of an entry written before that line existed.
    // An entry that only mentions the slug is left to the words below.
    const wanted = card.slug.toLowerCase();
    const about = (text) => text.split('\n').some((line) => {
      const lower = line.toLowerCase();
      if (lower.startsWith('card: ')) return lower.slice(6).split(' · ').some((name) => name.trim() === wanted);
      return lower.startsWith('place: ') && lower.endsWith(` · page ${wanted}`);
    });
    const found = select(' c.text,', 'p.slug DESC, c.id DESC', POOL * 5).all(`text : "${slug.join(' ')}"`);
    take(found.filter((row) => about(row.text)).slice(0, limit).map(({ text, ...row }) => row), 'card');
  }
  take(rows(matchExpr('text', words, ' AND ')), 'all-words');
  if (hits.size < limit && words.length > 1) take(rows(matchExpr('text', words, ' OR ')), 'some-words');

  const pageRow = db.prepare('SELECT slug, path, title, type, revision, updated_at FROM pages WHERE id = ?');
  const results = [...hits.values()].slice(0, limit).map((entry, index) => {
    const row = pageRow.get(entry.page_id);
    return {
      source: 'log', slug: row.slug, title: row.title, type: row.type, match: entry.match,
      part: entry.part, heading: entry.heading, snippet: entry.snippet.replace(/\s+/g, ' ').trim(),
      file: path.join(folder, ...row.path.split('/')),
      revision: row.revision, updated_at: row.updated_at, score: Number((1 / (RRF_K + index)).toFixed(5)),
    };
  });
  return { query, results, searched: ['log'], ...(card ? { card: card.slug } : {}) };
}

function searchIndex(db, query, options = {}) {
  const limit = Math.max(1, Math.min(Number(options.limit) || 10, 50));
  const words = terms(query);
  if (!words.length) return { query, results: [], searched: [] };
  if (options.source === 'log') return searchLog(db, query, words, limit);

  const sources = db.prepare('SELECT id, path, in_default_search FROM sources').all();
  const folder = new Map(sources.map((source) => [source.id, source.path]));
  const searched = options.source ? [options.source] : sources.filter((source) => source.in_default_search).map((source) => source.id);
  if (!searched.length) return { query, results: [], searched };
  const scope = `p.source_id IN (${searched.map(() => '?').join(', ')})`;

  const passages = (joiner) => db.prepare(
    `SELECT c.page_id, c.part, c.heading, snippet(chunks_fts, 0, '', '', ' … ', 28) AS snippet
       FROM chunks_fts JOIN chunks c ON c.id = chunks_fts.rowid JOIN pages p ON p.id = c.page_id
      WHERE chunks_fts MATCH ? AND ${scope} ORDER BY bm25(chunks_fts) LIMIT ${POOL}`,
  ).all(matchExpr('text', words, joiner), ...searched);
  const titles = db.prepare(
    `SELECT c.page_id FROM chunks_fts JOIN chunks c ON c.id = chunks_fts.rowid JOIN pages p ON p.id = c.page_id
      WHERE chunks_fts MATCH ? AND ${scope} ORDER BY bm25(chunks_fts) LIMIT ${POOL}`,
  ).all(matchExpr('title', words, ' OR '), ...searched);

  const hits = new Map();
  const hit = (pageId) => { if (!hits.has(pageId)) hits.set(pageId, { score: 0, lead: null, all: false, some: false, title: false }); return hits.get(pageId); };
  // A page votes once per list, at the rank of its best passage.
  const vote = (rows, weight, mark) => {
    let rank = 0;
    const seen = new Set();
    for (const row of rows) {
      const entry = hit(row.page_id);
      if (!entry.lead && row.snippet) entry.lead = row;
      if (seen.has(row.page_id)) continue;
      seen.add(row.page_id);
      entry.score += weight / (RRF_K + rank++);
      entry[mark] = true;
    }
  };
  const strict = passages(' AND ');
  vote(strict, 1, 'all');
  vote(titles, 1, 'title');
  // Any-word matches only fill the list out; they never outrank a page that holds every word.
  if (hits.size < limit && words.length > 1) vote(passages(' OR ').filter((row) => !hits.has(row.page_id) || !hits.get(row.page_id).lead), 0.25, 'some');

  const wanted = norm(query);
  const pageRow = db.prepare('SELECT source_id, slug, path, title, type, truth, revision, updated_at FROM pages WHERE id = ?');
  const results = [];
  for (const [pageId, entry] of hits) {
    const row = pageRow.get(pageId);
    const title = norm(row.title);
    const titleWords = new Set(title.split(' '));
    let match = entry.all ? 'all-words' : 'some-words';
    if (entry.title && words.every((word) => titleWords.has(word))) match = 'title';
    if (title === wanted) match = 'exact-title';
    let score = entry.score;
    if (match === 'exact-title') score *= 2;
    else if (match === 'title') score *= 1.3;
    if (row.source_id === 'brain') score *= 1.1;
    results.push({
      source: row.source_id, slug: row.slug, title: row.title, type: row.type, match,
      part: entry.lead ? entry.lead.part : 'truth', heading: entry.lead ? entry.lead.heading : '',
      snippet: (entry.lead ? entry.lead.snippet : row.truth.slice(0, 220)).replace(/\s+/g, ' ').trim(),
      file: path.join(folder.get(row.source_id) || '', ...row.path.split('/')),
      revision: row.revision, updated_at: row.updated_at, score: Number(score.toFixed(5)),
    });
  }
  results.sort((a, b) => b.score - a.score || (a.slug < b.slug ? -1 : 1));
  return { query, results: results.slice(0, limit), searched };
}

function search(brain, query, options = {}) {
  const { BrainError } = require('./db.cjs');
  const work = (db, stats) => {
    if (options.source && !db.prepare('SELECT 1 AS found FROM sources WHERE id = ?').get(options.source)) {
      throw new BrainError('NO_SOURCE', `No source named "${options.source}".`, 'List them with `cogby sources list`.');
    }
    // `index_as_of`: when the files were last read into the index, so a reader can tell how old the
    // answer may be. `background_sync` is there when a sync is on its way: a file changed outside
    // Cogby since then is found by the next search.
    return { ...searchIndex(db, query, options), index: stats.index, index_as_of: stats.synced_at || null, ...(stats.background ? { background_sync: stats.background } : {}) };
  };
  // The day log grows after every turn, and a turn in a linked folder starts no sync. A search that
  // names it reads the log folder first, so the turn that just ended is found: days that did not
  // change cost one stat each. When the index is busy, it is answered from as it is.
  if (options.source === 'log') {
    try { return withIndex(brain, work, { source: 'log', sync: true, quick: true }); }
    catch (error) { if (error instanceof BrainError) throw error; }
  }
  return withIndex(brain, work, { source: options.source });
}

module.exports = { search, searchIndex, terms };
