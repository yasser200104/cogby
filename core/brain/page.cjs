'use strict';

// One page: a markdown file with two halves.
//
//   ---
//   type: project
//   title: Acme
//   revision: 4
//   ---
//   Current truth: what an agent acts from. Never written by `log` or `remember`.
//
//   ## Facts
//   | # | claim | kind | valid_from | valid_until | recorded | source | by | status |
//   |---|-------|------|------------|-------------|----------|--------|----|--------|
//   | 1 | UAT starts 18 Nov | commitment | 2026-11-05 | | 2026-11-06 | meeting 2026-11-05 | yasser · human · confirmed | active |
//
//   <!-- timeline -->
//   - **2026-11-05** | Meeting — UAT moved to 18 Nov [yasser · human · confirmed]
//   - **2026-11-06** | call with Sara — decision: go live in December, the audit comes first [yasser · human · confirmed]
//
// A timeline line whose summary starts with `decision:` is a decision: the same line as any other,
// written through the same path, and found again by that prefix (isDecision). It may end with one
// group in round brackets saying who made the call, what is expected of it and when to look again:
//   - **2026-11-06** | call with Sara — decision: go live in December (who: accepted · expect: no rework after the audit · review: 2027-01-15) [yasser · agent · unconfirmed]
// How one turned out is a later line on the same page that points back at it (`reviewed:`). So is
// who made the call, when the decision was logged without it (`who:`): the first line is never edited.
//
// The square tail of a line ends in one of three states. `unconfirmed`: an agent wrote it and the
// owner has not said it is right. `confirmed`: a person wrote it, or the owner confirmed it later
// (core/brain/confirm.cjs rewrites that one word). `retracted`: the owner said it is wrong; the line
// stays in the file and is left out of everything read from the index. A fact is retracted in its
// status cell, `retracted 2026-11-13`, next to `superseded by #4` and `expired …`.
//
// A fourth state is not about a claim at all. `record`: Cogby wrote the line itself, as the record of
// a command the owner ran or approved (a folder linked or unlinked, a routine added, edited, paused,
// resumed or run):
//   - **2026-11-14** | cogby link — linked github.com/globex/acme as code [yasser · agent · record]
// There is nothing in it to confirm, so it is never listed or counted as unconfirmed, and it is not
// shown where a session reads what the brain last learned. Only Cogby's own commands write that
// word: `log` and `remember` cannot. The same lines written before the word existed end in
// `unconfirmed` or `confirmed`; they are known by their shape (isLegacyRecord) and read the same
// way, so a brain made earlier needs nothing converted.
//
// The middle of the tail says a person or an agent wrote the line, and which agent when Cogby knows:
//   - **2026-11-18** | session — Kickoff held [yasser · agent claude-code · unconfirmed]
// The name comes from the tool server's connection or from the shell the command ran in
// (write.cjs writer), never from what the agent says about itself. It is lowercase, of
// `a-z 0-9 . _ -`, at most 40 characters (agentName). A line with `agent` alone, as every line was
// before the name existed, reads as it always did: the actor is `agent` either way.
//
// A fact has two days. `valid_from` is the day it became true, which the writer may set to any day.
// `recorded` is the day it was written down, set by `remember` and never by the caller: it is what
// says the page heard something new (dream.cjs, staleness). A table written before the column existed
// is read as it is, its rows with no recorded day, and gains the column on its next write.
//
// Above the marker is the current truth (the facts table sits in it). Below is the timeline: dated,
// append-only, one line per event, each naming its source and who wrote it. A file with no marker
// is all current truth, which is how a card.md or a plain note indexes as it is.
//
// Pure: strings in, objects and strings out. No fs, no database. The frontmatter is read for the
// index and edited one field at a time, never re-serialized, so a field this file does not
// understand (a nested `authority:` block) survives a write byte for byte.

const MARKER = '<!-- timeline -->';
const FACT_COLUMNS = ['#', 'claim', 'kind', 'valid_from', 'valid_until', 'recorded', 'source', 'by', 'status'];
const KINDS = ['fact', 'commitment', 'decision', 'preference', 'risk', 'pointer'];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
// How a line's square tail ends (see the header).
const STATES = ['confirmed', 'unconfirmed', 'retracted', 'record'];
const TIMELINE_RE = /^-\s+\*\*(\d{4}-\d{2}-\d{2})\*\*\s*(?:\|\s*)?(.*)$/;
const DECISION_RE = /^decision:\s*/i;
// Who made the call: the owner on their own, the owner accepting Claude's suggestion, the owner
// overriding it, or an agent alone, on something the owner did not see. A decision line with no
// group, or none of these, is "not recorded".
const WHO = ['owner', 'accepted', 'overrode', 'agent'];
const OUTCOMES = ['as expected', 'not as expected', 'reversed'];
const DECISION_META_RE = /\s*\(((?:who|expect|review):[^()]*)\)\s*$/i;
const WHO_LINE_RE = /^who:\s*(owner|accepted|overrode|agent),\s*decision of (\d{4}-\d{2}-\d{2}) #([0-9a-f]{6})(?:\s+"[^"]*")?\.?\s*(.*)$/i;
const REVIEW_RE = /^reviewed:\s*(as expected|not as expected|reversed),\s*decision of (\d{4}-\d{2}-\d{2}) #([0-9a-f]{6})(?:\s+"[^"]*")?\.?\s*(.*)$/i;
const BY_RE = /\s*\[([^[\]]*·[^[\]]*)\]\s*$/;
const WIKILINK_RE = /\[\[([^\]|#\n]+)(?:#[^\]|\n]*)?(?:\|[^\]\n]*)?\]\]/g;
const TYPE_BY_FOLDER = {
  projects: 'project', areas: 'area', people: 'person', clients: 'client', deals: 'deal',
  meetings: 'meeting', decisions: 'decision', resources: 'resource', archive: 'archive',
};
const GENERIC_NAMES = new Set(['card', 'progress', 'index', 'readme', 'notes']);

const lf = (text) => String(text).replace(/^﻿/, '').replace(/\r\n?/g, '\n');
const isDate = (value) => DATE_RE.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
const oneLine = (value) => String(value == null ? '' : value).replace(/\s*[\r\n]+\s*/g, ' ').trim();

// ---- frontmatter ------------------------------------------------------------------------------

function splitFrontmatter(text) {
  const m = /^---[ \t]*\n([\s\S]*?)\n---[ \t]*(?:\n|$)/.exec(text);
  if (!m) return { fmRaw: null, body: text };
  return { fmRaw: m[1], body: text.slice(m[0].length) };
}

function unquote(value) {
  const v = value.trim();
  if (v.length >= 2 && ((v[0] === '"' && v.at(-1) === '"') || (v[0] === "'" && v.at(-1) === "'"))) return v.slice(1, -1);
  return v;
}

// Top-level `key: value` lines. A value in [a, b] is a list; indented lines under a key with no
// value are kept as that key's raw text. Enough for the index, deliberately not YAML.
function parseFrontmatter(fmRaw) {
  const out = {};
  if (!fmRaw) return out;
  let open = null;
  for (const line of fmRaw.split('\n')) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const top = /^([A-Za-z0-9_-]+):(.*)$/.exec(line);
    if (!top) {
      if (open && /^\s/.test(line)) out[open] = out[open] ? `${out[open]}\n${line}` : line;
      continue;
    }
    const value = top[2].trim();
    open = value ? null : top[1];
    if (/^\[.*\]$/.test(value) && !/^\[\[/.test(value)) out[top[1]] = value.slice(1, -1).split(',').map(unquote).filter(Boolean);
    else out[top[1]] = unquote(value);
  }
  return out;
}

function setField(fmRaw, key, value) {
  const text = oneLine(value);
  const lines = fmRaw ? fmRaw.split('\n') : [];
  const at = lines.findIndex((line) => new RegExp(`^${key}:`).test(line));
  if (at === -1) lines.push(`${key}: ${text}`);
  else lines[at] = `${key}: ${text}`;
  return lines.join('\n');
}

// A key that holds a list, one indented line per item (`places:`), replaced whole. The lines under
// the key are the only ones touched; no item left takes the key out.
function setBlock(fmRaw, key, items) {
  const lines = fmRaw ? fmRaw.split('\n') : [];
  const at = lines.findIndex((line) => new RegExp(`^${key}:`).test(line));
  let end = at + 1;
  if (at !== -1) while (end < lines.length && (/^\s+\S/.test(lines[end]) || !lines[end].trim()) && !/^[A-Za-z0-9_-]+:/.test(lines[end])) end++;
  // Blank lines after the block belong to what follows it.
  while (at !== -1 && end > at + 1 && !lines[end - 1].trim()) end--;
  const block = items.length ? [`${key}:`, ...items.map((item) => `  - ${oneLine(item)}`)] : [];
  if (at === -1) lines.push(...block); else lines.splice(at, end - at, ...block);
  return lines.join('\n');
}

// One top-level `key: value` line taken out (a field that moved into a list).
function dropField(fmRaw, key) {
  return (fmRaw ? fmRaw.split('\n') : []).filter((line) => !new RegExp(`^${key}:`).test(line)).join('\n');
}

// ---- timeline ---------------------------------------------------------------------------------

// The name of an agent as a tail holds it: lowercase, spaces as hyphens, only `a-z 0-9 . _ -`, at
// most 40 characters. Anything else is taken out; nothing left means no name.
const AGENT_NAME_MAX = 40;
const agentName = (value) => String(value == null ? '' : value).toLowerCase().trim().replace(/\s+/g, '-').replace(/[^a-z0-9._-]/g, '').slice(0, AGENT_NAME_MAX);
const NAMED_AGENT_RE = /^agent\s+([a-z0-9._-]{1,40})$/;

// `actor` is 'human', 'agent' or '' as it always was; `agent_name` is which agent, '' when the tail
// does not say. The bare word is looked for first, so a tail written before names existed reads
// exactly as before; a named agent is looked for after the first field, which is the author's.
function parseBy(text) {
  const parts = String(text || '').split('·').map((part) => part.trim());
  let at = parts.findIndex((part) => part === 'human' || part === 'agent');
  if (at === -1) at = parts.findIndex((part, index) => index > 0 && NAMED_AGENT_RE.test(part));
  if (at === -1 && NAMED_AGENT_RE.test(parts[0])) at = 0;
  const named = at === -1 ? null : NAMED_AGENT_RE.exec(parts[at]);
  const actor = at === -1 ? '' : named ? 'agent' : parts[at];
  const state = parts.find((part) => STATES.includes(part)) || '';
  const author = parts.find((part, index) => part && index !== at && part !== actor && part !== state) || '';
  return { author, actor, agent_name: named ? named[1] : '', confirmed: state === 'confirmed', retracted: state === 'retracted', record: state === 'record' };
}

const renderActor = (by) => (by.actor !== 'agent' ? 'human' : agentName(by.agent_name) ? `agent ${agentName(by.agent_name)}` : 'agent');
const renderBy = (by) => `${by.author || 'unknown'} · ${renderActor(by)} · ${by.retracted ? 'retracted' : by.record ? 'record' : by.confirmed ? 'confirmed' : 'unconfirmed'}`;

// A line Cogby wrote for one of its own commands before the `record` state existed. Told by both
// halves at once: the source Cogby gives itself for that command, and the words that command writes.
// A link or a routine change recorded with a source of the caller's own is not matched, and stays
// what its tail says. The run of a routine has no fixed source, so it is known by its page
// (parsePage: a line that starts with "ran" on a page of type routine).
const LEGACY_RECORDS = [
  [/^cogby link$/, /^linked \S+ as (?:code|workspace|environment|reference|scratch)(?::\s|$)/],
  [/^cogby link --undo$/, /^unlinked \S+$/],
  [/^cogby routines add$/, /^added: runs "/],
  [/^cogby routines edit$/, /^edited: /],
  [/^cogby routines pause$/, /^paused: /],
  [/^cogby routines resume$/, /^resumed: /],
];
const isLegacyRecord = (source, summary) => LEGACY_RECORDS.some(([from, words]) => from.test(source) && words.test(summary));
const RAN_RE = /^ran\b/i;

// A line's source is everything before the first ` — ` or ` -- `, so a source must not hold one
// itself: "call with Sara -- 2026-11-12" would end at "Sara", and a decision behind it would no
// longer start its summary. cleanSource writes a dash that stands alone as a hyphen, on the way in
// (renderTimelineLine, and write.cjs before it compares a new line with the ones on the page), so
// every line rendered here reads back as it was written.
const cleanSource = (value) => oneLine(value).replace(/(^|\s)(?:—|--)(?=\s|$)/g, '$1-');
const isMarked = (summary) => DECISION_RE.test(summary) || REVIEW_RE.test(summary);

function parseTimelineLine(line) {
  const m = TIMELINE_RE.exec(line.trimEnd());
  if (!m || !isDate(m[1])) return null;
  let rest = m[2];
  let by = { author: '', actor: '', agent_name: '', confirmed: false, retracted: false, record: false };
  const tail = BY_RE.exec(rest);
  if (tail) { by = parseBy(tail[1]); rest = rest.slice(0, tail.index); }
  const cut = /\s(?:—|--)\s/.exec(rest);
  let source = cut ? rest.slice(0, cut.index).trim() : '';
  let summary = (cut ? rest.slice(cut.index + cut[0].length) : rest).trim();
  // A line written before sources were cleaned may hold a dash in its source. When the line carries
  // the writer's tail (so it came through `log`, not a person's hand), what follows the first dash
  // is neither a decision nor a review, and a later dash is followed by one, the later dash is the
  // separator: the decision is found again. Any other line is cut at the first dash, as always.
  if (cut && tail && !isMarked(summary)) {
    const later = /\s(?:—|--)\s/g;
    later.lastIndex = cut.index + 1;
    for (let next = later.exec(rest); next; next = later.exec(rest)) {
      const after = rest.slice(next.index + next[0].length).trim();
      if (isMarked(after)) { source = rest.slice(0, next.index).trim(); summary = after; break; }
      later.lastIndex = next.index + 1;
    }
  }
  // Only a line that carries the writer's tail came through Cogby: one typed by hand is never a record.
  const record = by.record || (!!tail && isLegacyRecord(source, summary));
  return { date: m[1], source, summary, decision: DECISION_RE.test(summary), ...by, record };
}

// A decision is a timeline line whose summary starts with `decision:`. asDecision gives a summary
// that prefix once; isDecision reads it back, from a parsed line or from an index row.
const isDecision = (entry) => DECISION_RE.test(String(entry && entry.summary != null ? entry.summary : entry || ''));

// Where the three extra things about a decision are carried: in one trailing group of the summary,
// `(who: accepted · expect: … · review: 2027-01-15)`. Why there and in that form:
//   - the summary still starts with `decision:`, so isDecision, the index row and every search that
//     already finds decisions keep working, and nothing in the index has to change;
//   - the square tail `[author · actor · confirmed]` says who WROTE the line, which for most
//     decisions is an agent. Who made the call is a different fact, so it does not go in that tail;
//   - round brackets, because BY_RE reads any final `[… · …]` as the writer: a hand-written line
//     with no writer tail would have a square group mistaken for one;
//   - each field is named, so any of them can be left out, a line written before this existed (no
//     group at all) parses as it always did, and a person can read and type it without a manual.
// The group is recognised only at the very end of the summary and only when it opens with one of the
// three names, so an ordinary sentence that ends in brackets is left alone.
const metaValue = (text) => oneLine(text).replace(/\(/g, '[').replace(/\)/g, ']').replace(/\s*·\s*/g, ', ').trim();

// A decision's summary taken apart: { text, who, expect, review }. `text` is what was decided, with
// no prefix and no group. null when the summary is not a decision.
function parseDecision(summary) {
  const full = String(summary && summary.summary != null ? summary.summary : summary || '').trim();
  if (!DECISION_RE.test(full)) return null;
  const out = { text: full.replace(DECISION_RE, ''), who: '', expect: '', review: '' };
  const group = DECISION_META_RE.exec(out.text);
  if (!group) return out;
  out.text = out.text.slice(0, group.index).trim();
  for (const part of group[1].split('·')) {
    const field = /^\s*(who|expect|review):\s*(.*?)\s*$/i.exec(part);
    if (!field) continue;
    const key = field[1].toLowerCase();
    if (key === 'who') out.who = WHO.includes(field[2].toLowerCase()) ? field[2].toLowerCase() : '';
    else if (key === 'review') out.review = isDate(field[2]) ? field[2] : '';
    else out.expect = field[2];
  }
  return out;
}

// `meta` ({ who, expect, review }) is written as the trailing group; a field it leaves out keeps what
// the summary already carried.
function asDecision(summary, meta = {}) {
  const had = parseDecision(`decision: ${oneLine(summary).replace(DECISION_RE, '')}`);
  const who = meta.who || had.who;
  const expect = metaValue(meta.expect || had.expect);
  const review = meta.review || had.review;
  const group = [who && `who: ${who}`, expect && `expect: ${expect}`, review && `review: ${review}`].filter(Boolean).join(' · ');
  return `decision: ${had.text}${group ? ` (${group})` : ''}`.trim();
}

// How a decision turned out is a later line on the same page, never an edit of the first one:
//   reviewed: reversed, decision of 2026-11-06 #3fa2c1 "go live in December". We went live in January.
// It points at the decision by its date and id (core/brain/decisions.cjs decisionId); the quoted
// start of the decision is there for a person reading the page. parseReview gives
// { outcome, date, id, note }, or null when the summary is not one.
function parseReview(summary) {
  const m = REVIEW_RE.exec(String(summary && summary.summary != null ? summary.summary : summary || '').trim());
  return m ? { outcome: m[1].toLowerCase(), date: m[2], id: m[3].toLowerCase(), note: m[4].trim() } : null;
}

// Who made a call that was logged without saying so, added later and never by editing the decision:
//   who: accepted, decision of 2026-11-06 #3fa2c1 "go live in December".
// The same shape as a review, and found the same way. It is read only for a decision whose own line
// names nobody: what the decision says about itself stands. parseWho gives { who, date, id, note },
// or null when the summary is not one.
function parseWho(summary) {
  const m = WHO_LINE_RE.exec(String(summary && summary.summary != null ? summary.summary : summary || '').trim());
  return m ? { who: m[1].toLowerCase(), date: m[2], id: m[3].toLowerCase(), note: m[4].trim() } : null;
}

const renderWho = (said) => `who: ${said.who}, decision of ${said.date} #${said.id}`
  + `${said.quote ? ` "${oneLine(said.quote).replace(/"/g, "'")}"` : ''}.`;

const renderReview = (review) => `reviewed: ${review.outcome}, decision of ${review.date} #${review.id}`
  + `${review.quote ? ` "${oneLine(review.quote).replace(/"/g, "'")}"` : ''}.${review.note ? ` ${oneLine(review.note)}` : ''}`;

// A timeline line with its writer's tail replaced, and every other character left as it is. This is
// the one edit ever made to a line that is already on a page: its state, never its words. Which
// agent wrote the line is kept from the tail it had, unless `by` names one itself.
function retagLine(line, by) {
  const text = String(line).trimEnd();
  const tail = BY_RE.exec(text);
  const agent_name = by.agent_name !== undefined ? by.agent_name : tail ? parseBy(tail[1]).agent_name : '';
  return `${tail ? text.slice(0, tail.index) : text} [${renderBy({ ...by, agent_name })}]`;
}

const renderTimelineLine = (entry) => `- **${entry.date}** | ${cleanSource(entry.source)} — ${oneLine(entry.summary)} [${renderBy(entry)}]`;

// Date order, after the last line of the same or an earlier date; every existing line is left as it is.
function insertTimelineLine(timelineText, line, date) {
  const lines = timelineText.replace(/\s+$/, '').split('\n');
  if (lines.length === 1 && lines[0] === '') lines.pop();
  let after = -1;
  let firstDated = -1;
  lines.forEach((existing, index) => {
    const parsed = parseTimelineLine(existing);
    if (!parsed) return;
    if (firstDated === -1) firstDated = index;
    if (parsed.date <= date) after = index;
  });
  if (after !== -1) lines.splice(after + 1, 0, line);
  else if (firstDated !== -1) lines.splice(firstDated, 0, line);
  else lines.push(line);
  return lines.join('\n');
}

// ---- facts ------------------------------------------------------------------------------------

const splitRow = (line) => line.trim().replace(/^\|/, '').replace(/\|$/, '').split(/(?<!\\)\|/).map((cell) => cell.trim().replace(/\\\|/g, '|'));
const cell = (value) => oneLine(value).replace(/\|/g, '\\|');

// The lines of the `## Facts` section: the heading, and the table under it.
function factsSpan(lines) {
  const start = lines.findIndex((line) => /^##\s+Facts\s*$/i.test(line));
  if (start === -1) return null;
  let end = start + 1;
  while (end < lines.length && !lines[end].trim()) end++;
  const tableStart = end;
  while (end < lines.length && lines[end].trim().startsWith('|')) end++;
  return { start, tableStart, end: end === tableStart ? start + 1 : end };
}

function parseFacts(truth) {
  const lines = truth.split('\n');
  const span = factsSpan(lines);
  if (!span) return [];
  const rows = lines.slice(span.tableStart, span.end).filter((line) => line.trim().startsWith('|'));
  if (!rows.length) return [];
  const header = splitRow(rows[0]).map((name) => name.toLowerCase());
  const facts = [];
  for (const line of rows.slice(1)) {
    const cells = splitRow(line);
    if (cells.every((value) => /^:?-*:?$/.test(value))) continue;
    const get = (name) => { const at = header.indexOf(name); return at === -1 ? '' : (cells[at] || ''); };
    const row = Number.parseInt(get('#'), 10);
    if (!Number.isInteger(row) || !get('claim')) continue;
    const status = get('status').toLowerCase();
    const superseded = /superseded by #?(\d+)/.exec(status);
    const expired = /expired\s+(\d{4}-\d{2}-\d{2})/.exec(status);
    const retracted = /retracted\s+(\d{4}-\d{2}-\d{2})/.exec(status);
    const by = parseBy(get('by'));
    facts.push({
      row, claim: get('claim'), kind: get('kind') || 'fact', valid_from: get('valid_from'), valid_until: get('valid_until'),
      source: get('source'), author: by.author, actor: by.actor, agent_name: by.agent_name, confirmed: by.confirmed, recorded: get('recorded'),
      superseded_by: superseded ? Number(superseded[1]) : null, expired_at: expired ? expired[1] : null,
      retracted_at: retracted ? retracted[1] : null,
    });
  }
  return facts;
}

const factStatus = (fact) => (fact.superseded_by ? `superseded by #${fact.superseded_by}` : fact.expired_at ? `expired ${fact.expired_at}`
  : fact.retracted_at ? `retracted ${fact.retracted_at}` : 'active');
const isActive = (fact) => !fact.superseded_by && !fact.expired_at && !fact.retracted_at;

function renderFacts(facts) {
  const rows = facts.map((fact) => `| ${[fact.row, cell(fact.claim), cell(fact.kind), fact.valid_from || '', fact.valid_until || '',
    cell(fact.recorded || ''), cell(fact.source), fact.author || fact.actor ? renderBy(fact) : '', factStatus(fact)].join(' | ')} |`);
  return ['## Facts', `| ${FACT_COLUMNS.join(' | ')} |`, `|${FACT_COLUMNS.map(() => '---').join('|')}|`, ...rows].join('\n');
}

// The facts section rewritten in place, or added at the end of the current truth.
function replaceFacts(truth, facts) {
  const lines = truth.split('\n');
  const span = factsSpan(lines);
  const block = renderFacts(facts).split('\n');
  if (span) { lines.splice(span.start, span.end - span.start, ...block); return lines.join('\n'); }
  const head = truth.replace(/\s+$/, '');
  return head ? `${head}\n\n${block.join('\n')}` : block.join('\n');
}

// The current truth as prose: the facts table taken out.
function truthText(truth) {
  const lines = truth.split('\n');
  const span = factsSpan(lines);
  if (span) lines.splice(span.start, span.end - span.start);
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

// ---- links, title, type -----------------------------------------------------------------------

const maskCode = (text) => text.replace(/^```[\s\S]*?^```/gm, (block) => block.replace(/[^\n]/g, ' '));

function extractLinks(frontmatter, truth, timelineText) {
  const links = [];
  const seen = new Set();
  const add = (target, type, foundIn) => {
    const clean = target.trim().replace(/\.md$/i, '').replace(/^\/+|\/+$/g, '');
    const key = `${clean.toLowerCase()}|${type}`;
    if (!clean || seen.has(key)) return;
    seen.add(key);
    links.push({ target: clean, type, found_in: foundIn });
  };
  for (const [key, value] of Object.entries(frontmatter)) {
    for (const item of Array.isArray(value) ? value : [value]) {
      for (const m of String(item).matchAll(WIKILINK_RE)) add(m[1], key, 'frontmatter');
    }
  }
  for (const m of maskCode(truth).matchAll(WIKILINK_RE)) add(m[1], 'mentions', 'truth');
  for (const m of maskCode(timelineText).matchAll(WIKILINK_RE)) add(m[1], 'mentions', 'timeline');
  return links;
}

function slugOf(relPath) {
  const rel = String(relPath).replace(/\\/g, '/').replace(/^\/+/, '');
  return rel.replace(/\.(md|markdown)$/i, '');
}

function titleOf(frontmatter, truth, slug) {
  if (typeof frontmatter.title === 'string' && frontmatter.title) return frontmatter.title;
  const heading = /^#\s+(.+)$/m.exec(maskCode(truth));
  if (heading) return heading[1].trim();
  const parts = slug.split('/');
  const last = parts.at(-1).replace(/\.[a-z0-9]+$/i, '');
  const name = GENERIC_NAMES.has(last.toLowerCase()) && parts.length > 1 ? `${parts.at(-2)} ${last}` : last;
  return name.replace(/[-_]+/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
}

function typeOf(frontmatter, slug, fallback) {
  if (typeof frontmatter.type === 'string' && frontmatter.type) return frontmatter.type.toLowerCase();
  return TYPE_BY_FOLDER[slug.split('/')[0].toLowerCase()] || fallback;
}

// ---- page -------------------------------------------------------------------------------------

// `document: true` is a file from a read-only source with no marker: one part, called "document".
function parsePage(relPath, rawText, options = {}) {
  const text = lf(rawText);
  const { fmRaw, body } = splitFrontmatter(text);
  const frontmatter = parseFrontmatter(fmRaw);
  const at = maskCode(body).indexOf(MARKER);
  const hasMarker = at !== -1;
  const truth = (hasMarker ? body.slice(0, at) : body).replace(/^\n+/, '').replace(/\s+$/, '');
  const timelineText = hasMarker ? body.slice(at + MARKER.length).replace(/^\n+/, '').replace(/\s+$/, '') : '';
  const slug = slugOf(relPath);
  const revision = Number.parseInt(frontmatter.revision, 10);
  const type = typeOf(frontmatter, slug, options.document ? 'document' : 'note');
  const timeline = timelineText.split('\n').map(parseTimelineLine).filter(Boolean);
  // A run recorded on a routine's page before `record` existed: bookkeeping, like the ones written now.
  if (type === 'routine') for (const line of timeline) if (line.actor && RAN_RE.test(line.summary)) line.record = true;
  return {
    slug, fmRaw, frontmatter, hasMarker, truth, timelineText,
    document: !!options.document && !hasMarker,
    type,
    title: titleOf(frontmatter, truth, slug),
    revision: Number.isInteger(revision) && revision > 0 ? revision : 0,
    timeline,
    facts: parseFacts(truth),
    links: extractLinks(frontmatter, truth, timelineText),
  };
}

function renderPage(page) {
  const head = page.fmRaw != null ? `---\n${page.fmRaw}\n---\n` : '';
  const truth = page.truth.replace(/\s+$/, '');
  const timeline = page.timelineText.replace(/\s+$/, '');
  if (!page.hasMarker && !timeline) return `${head}${truth}\n`;
  return `${head}${truth}${truth ? '\n\n' : '\n'}${MARKER}\n${timeline}${timeline ? '\n' : ''}`;
}

// ---- passages ---------------------------------------------------------------------------------

const TARGET_WORDS = 300;
const words = (text) => (text.match(/\S+/g) || []).length;

// Cut at headings first, so a hit can name its section; a long section is cut again at paragraphs.
function sections(text) {
  const out = [];
  let current = { heading: '', lines: [] };
  let fenced = false;
  for (const line of text.split('\n')) {
    if (/^```/.test(line)) fenced = !fenced;
    const heading = !fenced && /^#{1,6}\s+(.+?)\s*#*$/.exec(line);
    if (heading) {
      if (current.lines.join('').trim()) out.push(current);
      current = { heading: heading[1], lines: [line] };
    } else current.lines.push(line);
  }
  if (current.lines.join('').trim()) out.push(current);
  return out;
}

// `whole` keeps every section in one piece, however long: the day log is searched by entry, and an
// entry's `Card:` line must stay in the same passage as its words.
function chunkText(text, part, whole) {
  const chunks = [];
  for (const section of sections(text)) {
    const body = section.lines.join('\n').trim();
    if (whole || words(body) <= TARGET_WORDS * 1.5) { chunks.push({ part, heading: section.heading, text: body }); continue; }
    let buffer = [];
    let count = 0;
    const flush = () => { if (buffer.length) chunks.push({ part, heading: section.heading, text: buffer.join('\n\n') }); buffer = []; count = 0; };
    for (const paragraph of body.split(/\n\s*\n/)) {
      const size = words(paragraph);
      if (count && count + size > TARGET_WORDS) flush();
      // A single paragraph far over the target (a long log line, a pasted table) is cut by lines.
      if (size > TARGET_WORDS * 2) {
        for (const line of paragraph.split('\n')) {
          if (count && count + words(line) > TARGET_WORDS) flush();
          buffer.push(line); count += words(line);
        }
        flush();
        continue;
      }
      buffer.push(paragraph); count += size;
    }
    flush();
  }
  return chunks;
}

function chunkPage(page, options = {}) {
  if (page.document) return chunkText(page.truth, 'document', options.whole);
  return [...chunkText(page.truth, 'truth', options.whole), ...chunkText(page.timelineText, 'timeline', options.whole)];
}

module.exports = {
  MARKER, FACT_COLUMNS, KINDS, lf, isDate, oneLine,
  splitFrontmatter, parseFrontmatter, setField, setBlock, dropField,
  parseTimelineLine, renderTimelineLine, cleanSource, insertTimelineLine, parseBy, renderBy, retagLine, agentName, isDecision, asDecision, isLegacyRecord,
  WHO, OUTCOMES, parseDecision, parseReview, renderReview, parseWho, renderWho,
  parseFacts, renderFacts, replaceFacts, factStatus, isActive, truthText,
  extractLinks, slugOf, parsePage, renderPage, chunkPage,
};
