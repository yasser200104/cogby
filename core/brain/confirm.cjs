'use strict';

// What the confirmed/unconfirmed tag is for. Every timeline line and every fact ends with who wrote
// it; anything an agent writes is `unconfirmed`. Three things are done with that here:
//
//   - `list`: the lines and facts an agent wrote that the owner has not confirmed, from the index;
//   - `confirm`: the owner says a line is right. Only the state in its tail changes, to `confirmed`;
//     the words, the author and the actor stay as they were written;
//   - `retract`: the owner says a line is wrong. It stays in the file, marked `retracted` (a fact:
//     `retracted <date>` in its status cell), and is left out of the session context, the decision
//     log, the unconfirmed list and the active facts. Nothing is deleted.
//
// Confirming and retracting are the owner's. A person at a terminal does either. An agent (the tool
// server, or any command run inside a Claude session, whatever `--human` says: the same reading as
// `writer()` in write.cjs) is refused unless it passes `confirmedByOwner: true`, which a skill sets
// only after the owner said yes to those exact lines. That flag is a statement: nothing here can
// check it, and the commit message says the yes came through an agent.
//
// How a line is named. A fact is its row number, `#3`. A timeline line has no number, so it gets an
// id the same way a decision does (decisions.cjs): six hex digits worked out from its date, its
// source and its words, never stored on the line, so a line typed by hand has one too. A decision's
// own id from `cogby decisions` names its line as well.
//
// Both writes go through writePage: one page, one commit of one file. Only the brain's own pages:
// the day's log is the hook's file, appended and never rewritten, so a line there cannot be confirmed.

const crypto = require('crypto');
const { BrainError } = require('./db.cjs');
const { withIndex, lookup } = require('./brain.cjs');
const page = require('./page.cjs');

const DEFAULT_LIMIT = 50;
const norm = (text) => String(text || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const isoDay = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

const lineId = (entry) => crypto.createHash('sha1').update(`${entry.date}\n${norm(entry.source)}\n${norm(entry.summary)}`).digest('hex').slice(0, 6);

// What counts as unconfirmed: written by an agent, not confirmed, not retracted, and for a fact still
// active (a superseded one is out of use already). A line that is the record of a command (a folder
// linked, a routine added, paused or run: `record` in the index, page.cjs) is never one: it claims
// nothing, so there is nothing to confirm, on any page. A routine's page is also left out of the
// whole-brain list and count; a claim an agent logged there is listed when the page is named.
const LINES = "t.actor = 'agent' AND t.confirmed = 0 AND t.retracted = 0 AND t.record = 0";
const FACTS = "f.actor = 'agent' AND f.confirmed = 0 AND f.retracted_at IS NULL AND f.superseded_by IS NULL AND f.expired_at IS NULL";
const EVERYWHERE = "p.source_id = 'brain' AND p.type != 'routine'";

// How many there are in the brain, from an index that is already open: what a session is told at its
// start, and what the view counts.
function count(db) {
  const one = (sql) => db.prepare(sql).get().n;
  const lines = one(`SELECT COUNT(*) AS n FROM timeline_entries t JOIN pages p ON p.id = t.page_id WHERE ${EVERYWHERE} AND ${LINES}`);
  const facts = one(`SELECT COUNT(*) AS n FROM facts f JOIN pages p ON p.id = f.page_id WHERE ${EVERYWHERE} AND ${FACTS}`);
  return { lines, facts, total: lines + facts };
}

// `cogby unconfirmed`, newest first. `page` narrows it to one page, `project` to a project's folder
// (or one page, as `cogby decisions --project` reads it). A read: the index as it is.
function list(brain, options = {}) {
  const limit = options.limit == null ? DEFAULT_LIMIT : Number.parseInt(options.limit, 10);
  if (!Number.isInteger(limit) || limit < 1) throw new BrainError('BAD_LIMIT', `"${options.limit}" is not a count.`, 'Use --limit with a whole number.');
  if (options.page && options.project) throw new BrainError('USAGE', 'Name a page or a project, not both.', 'cogby unconfirmed [--page <slug>] [--project <name>]');
  return withIndex(brain, (db, stats) => {
    let ids = null;
    if (options.page) {
      const row = lookup(db, options.page, { source: 'brain' });
      if (!row) throw new BrainError('NOT_FOUND', `No page "${options.page}" in the brain.`, '`cogby search "<words>"` finds one.');
      ids = [row.id];
    } else if (options.project) ids = require('./decisions.cjs').scopePages(db, options.project);
    const scope = ids ? `p.source_id = 'brain' AND p.id IN (${ids.map(() => '?').join(', ')})` : EVERYWHERE;
    const lines = db.prepare(
      `SELECT t.date, t.source, t.summary, t.author, p.slug FROM timeline_entries t JOIN pages p ON p.id = t.page_id
        WHERE ${scope} AND ${LINES} ORDER BY t.date DESC, t.rowid DESC`,
    ).all(...(ids || []));
    const facts = db.prepare(
      `SELECT f.row_num, f.claim, f.kind, f.valid_from, f.source, f.author, p.slug FROM facts f JOIN pages p ON p.id = f.page_id
        WHERE ${scope} AND ${FACTS} ORDER BY f.valid_from DESC, f.row_num DESC`,
    ).all(...(ids || []));
    const all = [
      ...lines.map((row) => ({ page: row.slug, kind: 'line', ref: lineId(row), date: row.date, text: row.summary, source: row.source, author: row.author })),
      ...facts.map((row) => ({ page: row.slug, kind: 'fact', ref: `#${row.row_num}`, row: row.row_num, date: row.valid_from || '', text: row.claim, source: row.source, author: row.author, fact_kind: row.kind })),
    ].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
    return {
      unconfirmed: all.slice(0, limit), shown: Math.min(limit, all.length), total: all.length,
      counts: { lines: lines.length, facts: facts.length }, index: stats.index, index_as_of: stats.synced_at || null,
    };
  });
}

// `#3` or `3` is a fact's row; six hex digits is a timeline line. A row number is never six digits
// long here, so the two cannot be mistaken for each other.
function parseRefs(refs, command) {
  const given = (Array.isArray(refs) ? refs : [refs]).map((ref) => String(ref == null ? '' : ref).trim()).filter(Boolean);
  if (!given.length) throw new BrainError('USAGE', `${command} needs what to ${command}: a fact's row or a line's id.`, `cogby ${command} <page> <ref> [<ref> …]; \`cogby unconfirmed\` lists them.`);
  const seen = new Map();
  for (const ref of given) {
    const fact = /^#?(\d{1,5})$/.exec(ref);
    const line = /^#?([0-9a-f]{6})$/i.exec(ref);
    if (fact) seen.set(`#${Number(fact[1])}`, { kind: 'fact', row: Number(fact[1]), ref: `#${Number(fact[1])}` });
    else if (line) seen.set(line[1].toLowerCase(), { kind: 'line', id: line[1].toLowerCase(), ref: line[1].toLowerCase() });
    else throw new BrainError('BAD_REF', `"${ref}" names neither a fact nor a line.`, 'A fact is its row number (#3); a timeline line is its six-character id. `cogby unconfirmed` prints both.');
  }
  return [...seen.values()];
}

// Who is asking. A person may; an agent only with the owner's yes.
function asOwner(brain, options, command) {
  const by = require('./write.cjs').writer(brain, options);
  if (by.actor === 'agent' && options.confirmedByOwner !== true) {
    throw new BrainError('NEEDS_OWNER', `Only the owner can ${command} what is in the brain, and this call comes from an agent.`,
      `Show the owner these exact lines and ask. After their yes, pass --confirmed-by-owner (tool: confirmed_by_owner: true). Never on your own reading.`);
  }
  return by;
}

// The one write behind confirm and retract. All or nothing: a ref that names nothing on the page, or
// names two different lines, refuses the whole call before anything is written.
function mark(brain, ref, refs, options, command) {
  const wanted = parseRefs(refs, command);
  const by = asOwner(brain, options, command);
  const retract = command === 'retract';
  const day = options.date || isoDay(new Date());
  const reason = page.oneLine(options.reason);
  const { idOf } = require('./decisions.cjs');
  const written = require('./write.cjs').writePage(brain, ref, (parsed) => {
    const done = [];
    const already = [];
    const lines = parsed.timelineText.split('\n');
    let factsChanged = false;
    let linesChanged = false;
    for (const want of wanted) {
      if (want.kind === 'fact') {
        const fact = parsed.facts.find((entry) => entry.row === want.row);
        if (!fact) throw new BrainError('NOT_FOUND', `No fact ${want.ref} on ${parsed.slug}.`, 'See the rows with `cogby get`, or `cogby unconfirmed --page`.');
        const item = { ref: want.ref, kind: 'fact', text: fact.claim };
        if (retract) {
          if (fact.retracted_at) { already.push(item); continue; }
          if (!page.isActive(fact)) throw new BrainError('NOT_ACTIVE', `Fact ${want.ref} on ${parsed.slug} is ${page.factStatus(fact)}: it is out of use already.`, 'Only an active fact is retracted.');
          fact.retracted_at = day;
        } else {
          if (fact.retracted_at) throw new BrainError('RETRACTED', `Fact ${want.ref} on ${parsed.slug} was retracted on ${fact.retracted_at}.`, 'A retracted fact is not confirmed. If it holds after all, save it again with `cogby remember`.');
          // A row with no writer in its `by` cell was typed by hand: there is no tag to change.
          if (fact.confirmed || (!fact.author && !fact.actor)) { already.push(item); continue; }
          fact.confirmed = true;
        }
        factsChanged = true;
        done.push(item);
        continue;
      }
      const hits = [];
      lines.forEach((text, index) => {
        const entry = page.parseTimelineLine(text);
        if (entry && (lineId(entry) === want.id || idOf(entry) === want.id)) hits.push({ index, entry });
      });
      if (!hits.length) throw new BrainError('NOT_FOUND', `No timeline line ${want.ref} on ${parsed.slug}.`, 'The ids are in `cogby unconfirmed --page`. A line edited by hand has a new id.');
      const live = hits.filter((hit) => !hit.entry.retracted);
      const item = { ref: want.ref, kind: 'line', date: hits[0].entry.date, text: hits[0].entry.summary };
      if (!live.length) {
        if (retract) { already.push(item); continue; }
        throw new BrainError('RETRACTED', `The line ${want.ref} on ${parsed.slug} was retracted.`, 'A retracted line is not confirmed. If it holds after all, log it again.');
      }
      const first = live[0].entry;
      if (live.some((hit) => hit.entry.date !== first.date || hit.entry.source !== first.source || hit.entry.summary !== first.summary)) {
        throw new BrainError('AMBIGUOUS', `${want.ref} names ${live.length} different lines on ${parsed.slug}.`, 'Two lines share that id. Change the tail of the one you mean by hand, in the file.');
      }
      let changed = false;
      for (const hit of live) {
        // A line with no tail was typed by hand: confirming it changes nothing; retracting it adds the tail.
        // The record of a command claims nothing, so there is nothing to confirm; it can be retracted.
        if (!retract && (hit.entry.confirmed || !hit.entry.actor || hit.entry.record)) continue;
        lines[hit.index] = page.retagLine(lines[hit.index], { author: hit.entry.author, actor: hit.entry.actor, agent_name: hit.entry.agent_name, confirmed: !retract, retracted: retract });
        changed = true;
      }
      Object.assign(item, { date: first.date, text: first.summary });
      if (changed) { linesChanged = true; done.push(item); } else already.push(item);
    }
    if (linesChanged) parsed.timelineText = lines.join('\n');
    if (factsChanged) parsed.truth = page.replaceFacts(parsed.truth, parsed.facts);
    const how = by.actor === 'agent' ? 'the owner said so, through an agent' : `by ${by.author}`;
    return {
      changed: linesChanged || factsChanged, action: command, [retract ? 'retracted' : 'confirmed']: done, already,
      message: `${command}(${parsed.slug}): ${done.map((item) => item.ref).join(', ')}${retract && reason ? `: ${reason.slice(0, 120)}` : ''} (${how})`,
    };
  }, { expectedRevision: options.expectedRevision });
  return written;
}

const confirm = (brain, ref, refs, options = {}) => mark(brain, ref, refs, options, 'confirm');
const retract = (brain, ref, refs, options = {}) => mark(brain, ref, refs, options, 'retract');

// The suffix a reader of the index is shown on an agent's unconfirmed line (the session context).
const tag = (row) => (row && row.actor === 'agent' && !row.confirmed && !row.record ? ' (agent, unconfirmed)' : '');

module.exports = { lineId, count, list, confirm, retract, tag, DEFAULT_LIMIT };
