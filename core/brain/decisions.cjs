'use strict';

// The decision log. There is no decisions file and no decisions table: a decision is a timeline line
// whose summary starts with `decision:`, on the page it is about, and this file reads those lines
// back out of the index. Who made the call, what was expected and when to look again are in the
// line itself (page.cjs parseDecision), so an index built before any of this lists its decisions
// too, with who made the call "not recorded".
//
// How a decision turned out is a second line on the same page (`reviewed: …`), which points at the
// first by its date and id. The first line is never edited. A decision whose newest review says
// `reversed` is no longer current: it leaves the list and stays in the record (`--all`).
//
// Who made a call can be said later the same way, for a decision logged without it: a line
// `who: accepted, decision of <date> #<id>` on the same page, written with `cogby log` (the weekly
// check-in asks once and writes it). It counts only for a decision whose own line names nobody.
//
// `list` is a read: it answers from the index as it is and never syncs first. `review` is a write
// through the same path as `cogby log`.

const crypto = require('crypto');
const { BrainError } = require('./db.cjs');
const { withIndex, lookup } = require('./brain.cjs');
const page = require('./page.cjs');

const DEFAULT_LIMIT = 30;
const norm = (text) => String(text || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const isoDay = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

// A decision's id: six hex digits from its date and its words. It is worked out, never stored on
// the decision's own line, so a line written by hand has one too; a review line carries it. Two
// pages may hold the same decision on the same day: a review is matched on its own page only.
const decisionId = (date, text) => crypto.createHash('sha1').update(`${date}\n${norm(text)}`).digest('hex').slice(0, 6);

// The id of a parsed timeline line, or null when the line is not a decision.
function idOf(entry) {
  const parsed = page.parseDecision(entry);
  return parsed ? decisionId(entry.date, parsed.text) : null;
}

// The pages a name means: a project by its folder name (every page in the folder), else one page.
function scopePages(db, ref) {
  const name = String(ref || '').trim().replace(/\\/g, '/').replace(/\.md$/i, '').replace(/^\/+|\/+$/g, '');
  const like = name.replace(/[\\%_]/g, '\\$&');
  const folder = db.prepare("SELECT id FROM pages WHERE source_id = 'brain' AND (slug = ? COLLATE NOCASE OR slug LIKE ? ESCAPE '\\')")
    .all(`projects/${name}`, `projects/${like}/%`);
  if (folder.length) return folder.map((row) => row.id);
  const one = lookup(db, name);
  if (one) return [one.id];
  throw new BrainError('NOT_FOUND', `No project or page "${ref}".`, 'Pass a project\'s folder name or a page slug; `cogby search "<words>"` finds one.');
}

// Every decision in the brain and the day logs, newest first, each with how it turned out.
function collect(db, options = {}) {
  const pages = options.scope ? scopePages(db, options.scope) : null;
  const rows = db.prepare(
    `SELECT t.date, t.source, t.summary, t.author, t.actor, t.confirmed, p.id AS page_id, p.slug, p.title, p.source_id
       FROM timeline_entries t JOIN pages p ON p.id = t.page_id
      WHERE p.source_id IN ('brain', 'log') AND t.retracted = 0 AND (t.summary LIKE 'decision:%' OR t.summary LIKE 'reviewed:%' OR t.summary LIKE 'who:%')
        ${pages ? `AND p.id IN (${pages.map(() => '?').join(', ')})` : ''}
      ORDER BY t.date DESC, t.rowid DESC`,
  ).all(...(pages || []));
  // The newest review of each decision is the one that stands.
  const reviews = new Map();
  for (const row of rows) {
    const review = page.parseReview(row.summary);
    if (!review) continue;
    const key = `${row.page_id}|${review.date}|${review.id}`;
    if (!reviews.has(key)) reviews.set(key, { ...review, on: row.date, source: row.source });
  }
  // Who made a call, said after the fact: the newest such line for each decision.
  const said = new Map();
  for (const row of rows) {
    const who = page.parseWho(row.summary);
    if (!who) continue;
    const key = `${row.page_id}|${who.date}|${who.id}`;
    if (!said.has(key)) said.set(key, { who: who.who, on: row.date });
  }
  const today = options.today || isoDay(new Date());
  const out = [];
  for (const row of rows) {
    const parsed = page.parseDecision(row.summary);
    if (!parsed) continue;
    const id = decisionId(row.date, parsed.text);
    const review = reviews.get(`${row.page_id}|${row.date}|${id}`) || null;
    // What the decision's own line says stands; a later line fills in only what it left out.
    const later = parsed.who ? null : said.get(`${row.page_id}|${row.date}|${id}`) || null;
    out.push({
      id, date: row.date, page: row.source_id === 'brain' ? row.slug : `${row.source_id}:${row.slug}`, title: row.title,
      text: parsed.text, source: row.source, who: parsed.who || (later ? later.who : null), who_recorded_on: later ? later.on : null,
      expect: parsed.expect || null, review: parsed.review || null,
      outcome: review ? review.outcome : null, reviewed_on: review ? review.on : null, review_note: review && review.note ? review.note : null,
      status: review && review.outcome === 'reversed' ? 'reversed' : 'current',
      due: !!parsed.review && parsed.review <= today && !review,
      author: row.author, actor: row.actor, confirmed: !!row.confirmed,
    });
  }
  return out;
}

const OUTCOME_WORDS = { 'as-expected': 'as expected', 'not-as-expected': 'not as expected', reversed: 'reversed' };
const outcomeOf = (value) => {
  const key = String(value || '').trim().toLowerCase().replace(/[\s_]+/g, '-');
  return OUTCOME_WORDS[key] || null;
};

// `outcome_by_who` crosses who made each call with how it turned out: for each of the four, how many
// there are, how many were reviewed, and the newest review of each. A decision with no one recorded
// is in `by_who` only: there is no call to cross.
function counts(all) {
  const by = { owner: 0, accepted: 0, overrode: 0, agent: 0, not_recorded: 0 };
  const cross = {};
  for (const who of page.WHO) cross[who] = { total: 0, reviewed: 0, as_expected: 0, not_as_expected: 0, reversed: 0 };
  for (const entry of all) {
    by[entry.who || 'not_recorded']++;
    const row = entry.who ? cross[entry.who] : null;
    if (!row) continue;
    row.total++;
    if (!entry.outcome) continue;
    row.reviewed++;
    row[entry.outcome.replace(/ /g, '_')]++;
  }
  return {
    total: all.length, by_who: by, due: all.filter((entry) => entry.due).length,
    not_as_expected: all.filter((entry) => entry.outcome === 'not as expected').length,
    reversed: all.filter((entry) => entry.status === 'reversed').length,
    outcome_by_who: cross,
  };
}

// The cross in words, one sentence for each kind of call with at least one review: "Overrode Claude
// 4 times: 3 as expected, 1 not." Empty when nothing was reviewed. It counts and gives no verdict.
const WHO_WORDS = { owner: 'Decided alone', accepted: 'Accepted from Claude', overrode: 'Overrode Claude', agent: 'Decided by an agent alone' };
function outcomeLine(tally) {
  const cross = (tally && tally.outcome_by_who) || {};
  const sentences = [];
  for (const who of page.WHO) {
    const row = cross[who];
    if (!row || !row.reviewed) continue;
    const how = [[row.as_expected, 'as expected'], [row.not_as_expected, row.as_expected ? 'not' : 'not as expected'], [row.reversed, 'reversed']]
      .filter(([count]) => count).map(([count, word]) => `${count} ${word}`).join(', ');
    sentences.push(`${WHO_WORDS[who]} ${row.total} time${row.total === 1 ? '' : 's'}${row.reviewed < row.total ? `, ${row.reviewed} reviewed` : ''}: ${how}.`);
  }
  return sentences.join(' ');
}

// `cogby decisions`. Filters: scope (a project's folder name or a page), since, who, due, outcome.
// A reversed decision is left out unless `all` or `outcome: reversed` asks for it. `counts` is over
// everything in the scope and the period, reversed ones included, and for the calls asked for when
// `who` names one (`--who none` counts the ones with nobody recorded, not the whole scope). The
// other filters (due, outcome) narrow the list only.
function list(brain, options = {}) {
  if (options.since && !page.isDate(options.since)) throw new BrainError('BAD_DATE', `"${options.since}" is not a date.`, 'Use --since YYYY-MM-DD.');
  const who = options.who ? String(options.who).toLowerCase() : null;
  if (who && !page.WHO.includes(who) && who !== 'none') throw new BrainError('BAD_WHO', `"${options.who}" is not who made a call.`, `Use --who ${page.WHO.join(' | ')}, or none for the ones with nothing recorded.`);
  const outcome = options.outcome ? (String(options.outcome).toLowerCase() === 'none' ? 'none' : outcomeOf(options.outcome)) : null;
  if (options.outcome && !outcome) throw new BrainError('BAD_OUTCOME', `"${options.outcome}" is not an outcome.`, 'Use --outcome as-expected | not-as-expected | reversed | none.');
  const limit = options.limit == null ? DEFAULT_LIMIT : Number.parseInt(options.limit, 10);
  if (!Number.isInteger(limit) || limit < 1) throw new BrainError('BAD_LIMIT', `"${options.limit}" is not a count.`, 'Use --limit with a whole number.');
  const today = options.today || isoDay(new Date());
  // The day logs are searched only when named, so with the index off they are read here on purpose.
  return withIndex(brain, (db, stats) => {
    const scoped = collect(db, { scope: options.scope, today }).filter((entry) => !options.since || entry.date >= options.since)
      .filter((entry) => !who || (who === 'none' ? !entry.who : entry.who === who));
    const matching = scoped.filter((entry) => {
      if (entry.status === 'reversed' && !options.all && outcome !== 'reversed') return false;
      if (options.due && !entry.due) return false;
      if (outcome && (outcome === 'none' ? entry.outcome : entry.outcome !== outcome)) return false;
      return true;
    });
    return {
      decisions: matching.slice(0, limit), shown: Math.min(limit, matching.length), matching: matching.length,
      counts: counts(scoped), today, index: stats.index, index_as_of: stats.synced_at || null,
    };
  }, { everySource: true });
}

// The current decisions of one page, newest first: what a session about to work on a project is
// shown, so it does not propose again what was decided against.
function forPage(db, pageId, limit = 5, today) {
  const row = db.prepare('SELECT slug FROM pages WHERE id = ?').get(pageId);
  if (!row) return [];
  return collect(db, { today }).filter((entry) => entry.page === row.slug && entry.status === 'current').slice(0, limit);
}

// Records how a decision turned out, as a new line on the decision's own page. The decision is
// found in the index by its id, then checked again in the file the line is written to.
function review(brain, id, outcomeGiven, options = {}) {
  const key = String(id || '').trim().replace(/^#/, '').toLowerCase();
  if (!/^[0-9a-f]{6}$/.test(key)) throw new BrainError('BAD_ID', `"${id}" is not a decision's id.`, 'The ids are the first column of `cogby decisions`.');
  const outcome = outcomeOf(outcomeGiven);
  if (!outcome) throw new BrainError('BAD_OUTCOME', `"${outcomeGiven}" is not an outcome.`, 'Use as-expected, not-as-expected or reversed.');
  const found = withIndex(brain, (db) => collect(db, { scope: options.scope }).filter((entry) => entry.id === key), { everySource: true });
  if (!found.length) throw new BrainError('NOT_FOUND', `No decision #${key}.`, 'List them with `cogby decisions --all`. A line written outside Cogby is indexed by the next sync; `cogby sync` does it now.');
  const pages = [...new Set(found.map((entry) => entry.page))];
  if (pages.length > 1) throw new BrainError('AMBIGUOUS', `Decision #${key} is on ${pages.length} pages: ${pages.join(', ')}.`, 'Name the one you mean with --project <page>.');
  const decision = found[0];
  const summary = page.renderReview({ outcome, date: decision.date, id: key, quote: decision.text.length > 60 ? `${decision.text.slice(0, 60).trimEnd()}…` : decision.text, note: options.note });
  const written = require('./write.cjs').appendLine(brain, decision.page, summary, {
    ...options, date: options.date || isoDay(new Date()), command: 'decisions review',
    check: (parsed) => {
      if (!parsed.timeline.some((entry) => entry.date === decision.date && idOf(entry) === key)) {
        throw new BrainError('NOT_FOUND', `Decision #${key} is no longer on ${decision.page}.`, 'The page changed since the index last read it; run `cogby sync` and look again.');
      }
    },
  });
  return { ...written, decision: { id: key, date: decision.date, page: decision.page, text: decision.text }, outcome };
}

// What the view shows: the decisions whose review date has come, and the
// counts for the last seven days. One read of an index that is already open.
function forView(db, today) {
  const all = collect(db, { today });
  const since = new Date(Date.parse(`${today}T00:00:00Z`) - 7 * 86400000).toISOString().slice(0, 10);
  return {
    due: all.filter((entry) => entry.due && entry.status === 'current').slice(0, 10).map(({ id, date, page: where, text, who, expect, review: on }) => ({ id, date, page: where, text, who, expect, review: on })),
    today: all.filter((entry) => entry.date === today).length,
    week: { since, ...counts(all.filter((entry) => entry.date >= since)) },
  };
}

module.exports = { decisionId, idOf, scopePages, collect, list, forPage, forView, review, outcomeOf, outcomeLine, DEFAULT_LIMIT };
