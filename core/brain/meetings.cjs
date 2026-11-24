'use strict';

// `cogby meetings`: the record of each debriefed meeting, and the way back to it.
//
// A meeting often touches several pages at once (a project, an area, a person), so its record does
// not live on any of them. It is one file in one flat folder, `resources/meetings/<date>-<slug>.md`,
// and every page the meeting touched gets one timeline line linking to it. The record keeps the
// pointer to the transcript, which stays where it lives (a Google Doc, a Granola note, a local file),
// a short summary written from it, and what the debrief wrote where. It holds no current truth: the
// decisions, facts and to-dos the meeting produced go to their one home, as they always did, and
// the record only lists them.
//
//   ---
//   type: meeting
//   title: 'Sam / Dana : 1 on 1, 2026-11-12'
//   date: 2026-11-12
//   with: [Sam Rivera, Dana Whitfield]
//   pages:
//     - "[[areas/people/sam]]"
//   transcript: https://docs.google.com/document/d/…/edit
//   revision: 1
//   ---
//   # Sam / Dana : 1 on 1, 2026-11-12
//   …summary, then "Written to"…
//   <!-- timeline -->
//   - **2026-11-12** | Sam / Dana : 1 on 1 2026-11-12, https://docs… — meeting record: … [yasser · agent · unconfirmed]
//
// The one timeline line on the record says who wrote it, the same way every other line does: an
// agent's is unconfirmed until the owner confirms it (`cogby confirm`), and retracting it says the
// record is wrong. It is written once and never edited; confirming changes only that line's tag.
// A record is never stale (dream.cjs) and is not "the latest evidence": the lines on the pages it
// touched are.
//
// Cogby reads no meeting tool itself. The session finds the transcript through the connectors it
// has (the meeting-notes skill says how) and passes the links here; nothing but links and the
// summary is stored.

const fs = require('fs');
const path = require('path');
const { BrainError } = require('./db.cjs');
const brainLib = require('./brain.cjs');
const page = require('./page.cjs');
const write = require('./write.cjs');
const { redact } = require('../lib/redact.cjs');

const FOLDER = 'resources/meetings';
const SUMMARY_LINES = 15;
const SUMMARY_CHARS = 4000;
const LINE_CHARS = 400;
const WRITTEN_MAX = 60;
const WITH_MAX = 30;
const LINK_FIELDS = ['transcript', 'recording', 'notes', 'event'];
const DEFAULT_LIMIT = 10;

const usage = (message, hint = 'cogby meetings add --data FILE (a JSON object: title, date, with, pages, transcript, summary, line, written).') => new BrainError('USAGE', message, hint);
const flat = (value) => page.oneLine(value);
const clip = (text, max) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text);
const asList = (value) => (Array.isArray(value) ? value : value == null || value === '' ? [] : String(value).split(/\r?\n|,(?![^[]*\])/));

// A name for a file: lowercase words joined by hyphens, accents dropped, at most 60 characters.
function slugify(text) {
  const words = String(text).normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return words.slice(0, 60).replace(/-+$/, '') || 'meeting';
}

// One value of the frontmatter, quoted only when a reader would otherwise take it apart.
function yaml(value) {
  const text = flat(value);
  if (/^[A-Za-z0-9_./~\\-]/.test(text) && !/:\s|\s#|:$/.test(text)) return text;
  return `'${text.replace(/'/g, "''")}'`;
}

// "none", "no", an empty value: there is no transcript.
const nothing = (value) => !flat(value) || /^(none|no|n\/a|-)$/i.test(flat(value));
const linkOf = (value) => (nothing(value) ? null : clip(flat(value), 500));

// A page the meeting touched, as the brain names it: the index first, then the file itself, for a
// page made a moment ago (a person's page made in the same debrief) that no sync has read yet.
function resolvePage(db, brain, ref) {
  const row = brainLib.lookup(db, ref, { source: 'brain' });
  if (row && row.source_id === 'brain') return row.slug;
  const slug = String(ref || '').trim().replace(/\\/g, '/').replace(/\.md$/i, '').replace(/^\/+|\/+$/g, '');
  if (!slug || slug.split('/').some((part) => !part || part === '..' || part.startsWith('.'))) return null;
  for (const rel of [`${slug}.md`, `${slug}/card.md`]) if (fs.existsSync(path.join(brain, ...rel.split('/')))) return rel.replace(/\.md$/i, '');
  return null;
}

// The record's words, checked before anything is written. Every refusal leaves the brain as it was.
function normalise(brain, data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw usage('The meeting record needs an object.');
  const title = clip(flat(data.title).replace(/[[\]|·]+/g, ' ').replace(/\s+/g, ' ').trim(), 120);
  if (!title) throw usage('The meeting record needs a title: the meeting\'s name, as the calendar or the notes call it.');
  const date = flat(data.date);
  if (!page.isDate(date)) throw new BrainError('BAD_DATE', `"${date}" is not the meeting's date.`, 'Pass date as YYYY-MM-DD: the day the meeting was held.');
  const people = asList(data.with).map((name) => clip(flat(name).replace(/[,[\]{}:#|]+/g, ' ').replace(/\s+/g, ' ').trim(), 80)).filter(Boolean).slice(0, WITH_MAX);

  const summary = asList(Array.isArray(data.summary) ? data.summary : String(data.summary == null ? '' : data.summary).split(/\r?\n/))
    .map((line) => redact(flat(line).replace(/^(?:[-*+]|\d+[.)])\s+/, ''))).filter(Boolean);
  if (!summary.length) throw usage('The meeting record needs a summary: 5 to 15 lines written from the transcript.');
  if (summary.length > SUMMARY_LINES) throw new BrainError('TOO_LONG', `The summary has ${summary.length} lines; a record holds at most ${SUMMARY_LINES}.`, 'Keep what matters. The transcript stays where it lives: the record points at it, it does not copy it.');
  const long = summary.find((line) => line.length > LINE_CHARS);
  if (long || summary.join(' ').length > SUMMARY_CHARS) throw new BrainError('TOO_LONG', 'A summary line is longer than a summary line should be.', `Each line at most ${LINE_CHARS} characters, ${SUMMARY_CHARS} in all: write what happened, never paste the transcript.`);

  const line = redact(clip(flat(data.line), 300));
  if (page.isDecision(line)) throw usage('The line linking a page to the record says what happened; it is not a decision.', 'Log the decision on its page (`cogby log <page> "<what and why>" --decision --who …`) and list it under `written`.');

  const links = Object.fromEntries(LINK_FIELDS.map((key) => [key, linkOf(data[key])]));
  const source = clip(flat(data.source) || `${title}${title.includes(date) ? '' : ` ${date}`}${links.transcript ? `, ${links.transcript}` : ''}`, 700);

  const written = (Array.isArray(data.written) ? data.written : []).slice(0, WRITTEN_MAX).map((item) => (item && typeof item === 'object'
    ? { kind: clip(flat(item.kind), 20) || 'Item', text: redact(clip(flat(item.text), 300)), page: flat(item.page || item.where) }
    : { kind: 'Item', text: redact(clip(flat(item), 300)), page: '' })).filter((item) => item.text);

  const wanted = [...new Set(asList(data.pages).map(flat).filter(Boolean))];
  if (!wanted.length) throw usage('The meeting record needs pages: every project, area or person page the meeting touched.', 'Each gets a line linking to the record. A person with no page yet: make one first (`node core/ops/new.cjs person <name>`).');
  return { title, date, people, summary, line, links, source, written, wanted };
}

// The record as it is written: frontmatter, the summary, what was written where, its one line.
function render(record, by) {
  const fm = [
    'type: meeting',
    `title: ${yaml(record.heading)}`,
    `date: ${record.date}`,
    ...(record.people.length ? [`with: [${record.people.join(', ')}]`] : []),
    'pages:', ...record.pages.map((slug) => `  - "[[${slug}]]"`),
    `transcript: ${record.links.transcript ? yaml(record.links.transcript) : 'none'}`,
    ...LINK_FIELDS.slice(1).filter((key) => record.links[key]).map((key) => `${key}: ${yaml(record.links[key])}`),
  ].join('\n');
  const where = (item) => (item.slug ? ` → [[${item.slug}]]` : item.page ? ` → ${item.page}` : '');
  const others = LINK_FIELDS.slice(1).filter((key) => record.links[key]).map((key) => `${key[0].toUpperCase()}${key.slice(1)}: ${record.links[key]}`);
  const truth = [
    `# ${record.heading}`,
    '',
    `${record.date}${record.people.length ? ` · with ${record.people.join(', ')}` : ''}. `
      + (record.links.transcript ? `Transcript: ${record.links.transcript}` : 'No transcript: written from notes or what the owner said.'),
    ...(others.length ? ['', others.join(' · ')] : []),
    '',
    'Written by Claude from the meeting, once, and never edited. The transcript stays where it lives; what the meeting decided and established lives on the pages below.',
    '',
    '## Summary',
    '',
    ...record.summary.map((line) => `- ${line}`),
    '',
    '## Written to',
    '',
    ...(record.written.length ? record.written.map((item) => `- ${item.kind}: ${item.text}${where(item)}`) : ['- Nothing beyond this record and the lines linking to it.']),
  ].join('\n');
  const from = record.links.transcript ? 'the transcript' : 'notes, no transcript';
  const summary = `meeting record: a ${record.summary.length}-line summary and ${record.written.length} item${record.written.length === 1 ? '' : 's'} written, from ${from}`;
  const line = page.renderTimelineLine({ date: record.date, source: record.source, summary, ...by });
  return { fm, truth, line };
}

// The transcript a record already there points at, to tell the same meeting from another of the
// same name on the same day.
function transcriptOf(file) {
  try {
    const fm = page.parseFrontmatter(page.splitFrontmatter(page.lf(fs.readFileSync(file, 'utf8'))).fmRaw);
    return nothing(fm.transcript) ? null : flat(fm.transcript);
  } catch { return undefined; }
}

// `cogby meetings add`: the record, then one line on each page it touched. Run twice with the same
// meeting, it writes no second record and no second line: a debrief that stopped halfway is finished
// by running it again.
function add(brain, data, options = {}) {
  const record = normalise(brain, data);
  // Every page is found before anything is written: one that is not there refuses the whole call.
  const found = brainLib.withIndex(brain, (db) => {
    const pages = [];
    const missing = [];
    for (const ref of record.wanted) { const slug = resolvePage(db, brain, ref); if (slug) { if (!pages.includes(slug)) pages.push(slug); } else missing.push(ref); }
    const written = record.written.map((item) => ({ ...item, slug: item.page ? resolvePage(db, brain, item.page) : null }));
    return { pages, missing, written };
  }, { kick: false });
  if (found.missing.length) {
    throw new BrainError('NOT_FOUND', `No page ${found.missing.map((ref) => `"${ref}"`).join(', ')} in the brain; nothing was written.`,
      'Make the page first (`node core/ops/new.cjs person <name>`, `project <name>`, `area <name>`), or leave it out of pages.');
  }
  Object.assign(record, { pages: found.pages, written: found.written, heading: record.title.includes(record.date) ? record.title : `${record.title}, ${record.date}` });

  // Where it goes: the date and the meeting's name. The same name on the same day with another
  // transcript is another meeting, and gets -2; with the same transcript it is this one, written already.
  const base = `${FOLDER}/${record.date}-${slugify(record.title.replace(record.date, ''))}`;
  let slug = null;
  let duplicate = false;
  for (let n = 1; n <= 20 && !slug; n++) {
    const candidate = n === 1 ? base : `${base}-${n}`;
    const file = path.join(brain, ...`${candidate}.md`.split('/'));
    if (!fs.existsSync(file)) { slug = candidate; break; }
    if (transcriptOf(file) === (record.links.transcript || null)) { slug = candidate; duplicate = true; }
  }
  if (!slug) throw new BrainError('TOO_MANY', `Twenty records of "${record.title}" on ${record.date} already.`, 'Give the meeting a more specific title.');

  const by = write.writer(brain, options);
  let made = { status: 'duplicate', revision: null, commit: { committed: false, why: 'the record was written already' } };
  if (!duplicate) {
    const out = render(record, by);
    const saved = write.writePage(brain, slug, (parsed) => {
      if (parsed.truth.trim() || parsed.timeline.length) throw new BrainError('CONFLICT', `${slug} was written while this record was being made.`, 'Run `cogby meetings` to see it; a record is written once.');
      parsed.fmRaw = out.fm;
      parsed.truth = out.truth;
      parsed.timelineText = out.line;
      parsed.hasMarker = true;
      return { changed: true, message: `meeting(${slug}): ${record.title.slice(0, 60)}` };
    }, { create: true, by });
    made = { status: 'written', revision: saved.revision, commit: saved.commit, path: saved.path };
  }

  // One line on each page the meeting touched, dated the day it was held, linking to the record.
  const said = record.line || `Meeting "${record.title}"${record.people.length ? ` with ${record.people.join(', ')}` : ''}`;
  const links = record.pages.map((target) => {
    try {
      const done = write.log(brain, target, `${said} → [[${slug}]]`, { source: record.source, date: record.date, author: options.author, actor: options.actor, env: options.env });
      return { page: done.slug, status: done.status, line: done.line, commit: done.commit };
    } catch (error) {
      if (!(error instanceof BrainError)) throw error;
      return { page: target, status: 'failed', error: error.message };
    }
  });
  return {
    status: made.status, slug, path: made.path || path.join(brain, ...`${slug}.md`.split('/')), revision: made.revision, commit: made.commit,
    source: record.source, transcript: record.links.transcript, pages: record.pages, links,
  };
}

// `cogby meetings`: the records, newest first. With a page, the ones that link to it or that it
// links to: what meeting-prep reads before a meeting with that person or about that project.
function list(brain, options = {}) {
  const limit = options.limit == null ? DEFAULT_LIMIT : Number.parseInt(options.limit, 10);
  if (!Number.isInteger(limit) || limit < 1) throw new BrainError('BAD_LIMIT', `"${options.limit}" is not a count.`, 'Use --limit with a whole number.');
  return brainLib.withIndex(brain, (db, stats) => {
    let rows = db.prepare("SELECT id, slug, path, title, frontmatter FROM pages WHERE source_id = 'brain' AND type = 'meeting'").all();
    let about = null;
    if (options.page) {
      const target = brainLib.lookup(db, options.page, { source: 'brain' });
      if (!target) throw new BrainError('NOT_FOUND', `No page "${options.page}" in the brain.`, '`cogby search "<words>"` finds one.');
      about = target.slug;
      const near = new Set(db.prepare('SELECT from_page AS a, to_page AS b FROM links WHERE (from_page = ? OR to_page = ?) AND to_page IS NOT NULL').all(target.id, target.id)
        .map((link) => (link.a === target.id ? link.b : link.a)));
      rows = rows.filter((row) => near.has(row.id));
    }
    const records = rows.map((row) => {
      let fm = {};
      try { fm = JSON.parse(row.frontmatter) || {}; } catch { /* a record with a broken head is still listed */ }
      const pages = [...String(Array.isArray(fm.pages) ? fm.pages.join('\n') : fm.pages || '').matchAll(/\[\[([^\]|#\n]+)/g)].map((m) => m[1].trim());
      return {
        slug: row.slug, title: row.title, date: page.isDate(fm.date) ? fm.date : (/(\d{4}-\d{2}-\d{2})/.exec(row.slug) || [])[1] || '',
        with: Array.isArray(fm.with) ? fm.with : fm.with ? [fm.with] : [], pages,
        transcript: nothing(fm.transcript) ? null : fm.transcript, recording: fm.recording || null, notes: fm.notes || null, event: fm.event || null,
        file: brainLib.pageFile(db, { source_id: 'brain', path: row.path }),
      };
    }).sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.slug < b.slug ? 1 : -1));
    return { page: about, meetings: records.slice(0, limit), shown: Math.min(limit, records.length), total: records.length, index: stats.index, index_as_of: stats.synced_at || null };
  });
}

function addText(result) {
  const commit = (c) => (c.committed ? `commit ${c.sha}` : `not committed: ${c.why}`);
  const lines = [result.status === 'duplicate' ? `Already recorded: ${result.slug}; no second record written.` : `Meeting record written: ${result.slug} (${commit(result.commit)})`,
    `  source: ${result.source}`];
  for (const link of result.links) {
    lines.push(`  ${link.page}: ${link.status === 'inserted' ? `linked (${commit(link.commit)})` : link.status === 'duplicate' ? 'already linked' : `NOT linked: ${link.error}`}`);
  }
  if (!result.transcript) lines.push('  No transcript: the record says so, and the source is the meeting\'s name and date.');
  return lines.join('\n');
}

function listText(result) {
  const asOf = result.index === 'off' ? 'Index off: the files were read just now.' : `Index as of ${result.index_as_of ? `${result.index_as_of.slice(0, 19).replace('T', ' ')} UTC` : 'no full sync yet'}.`;
  if (!result.total) return `${result.page ? `No meeting record links to ${result.page}.` : 'No meeting records yet. A debrief writes one (meeting-notes).'}\n${asOf}`;
  const lines = [];
  for (const m of result.meetings) {
    lines.push(`${m.date}  ${m.slug}`, `            ${m.title}${m.with.length ? ` · with ${m.with.join(', ')}` : ''}`,
      `            transcript: ${m.transcript || 'none'}${m.pages.length ? ` · pages: ${m.pages.join(', ')}` : ''}`);
  }
  if (result.total > result.shown) lines.push(`… ${result.total - result.shown} more (--limit N)`);
  lines.push(asOf);
  return lines.join('\n');
}

module.exports = { add, list, addText, listText, slugify, FOLDER, SUMMARY_LINES };
