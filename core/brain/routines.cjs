'use strict';

// Routines: what the owner does on a rhythm with Claude (a morning check-in, a weekly review, the
// nightly `dream`), kept in the brain so the record is theirs and travels with it. Claude has its
// own scheduler; Cogby builds none. The brain holds what the routine is, why it exists and when it
// last ran, and a pointer to where it is scheduled in Claude. What is scheduled there is read there.
//
// Where they live: ONE PAGE PER ROUTINE, `areas/routines/<name>.md`, not one page for all of them.
//   - a run is a dated timeline line, and a page has one timeline: with a page each, "when did this
//     last run and what came of it" is that page's own last line, with no parsing of a shared list;
//   - each has its own revision and its own commits, so pausing one never conflicts with a run
//     recorded on another;
//   - search finds one by its name, and `cogby get areas/routines/<name>` shows it whole;
//   - a routine the owner stops is paused on its page and stays there: nothing is deleted.
//
// The page follows the page model. Above the timeline marker is the current truth, as five lines a
// person can read and edit by hand:
//
//   ---
//   type: routine
//   title: Weekly review
//   revision: 3
//   ---
//   # Weekly review
//
//   - Runs: check-in, weekly
//   - Rhythm: weekly on friday at 16:00
//   - Why: nothing stays stale for more than a week
//   - Scheduled in Claude: scheduled task "cogby-weekly-review"
//   - Status: active
//
//   <!-- timeline -->
//   - **2026-11-06** | cogby routines add — added: runs "check-in, weekly", weekly on friday at 16:00 [yasser · human · record]
//   - **2026-11-13** | check-in 2026-11-13 — ran: 2 stale pages named, 1 decision due [yasser · agent · record]
//
// Those lines are the definition, and it changes only through the owner's own commands (`add`,
// `edit`, `pause`, `resume`), each of which also leaves a timeline line saying what changed. A run
// is a line that starts with `ran`. Every line written here is the record of a command, not a claim:
// it ends in `record` and is never listed as unconfirmed (page.cjs). Nothing here calls a model, and nothing here runs a
// routine: running one is Claude's, in a session.
//
// Reads (`list`, `due`, the session-start block) answer from the index as it is and never sync first.

const { BrainError } = require('./db.cjs');
const brainLib = require('./brain.cjs');
const page = require('./page.cjs');

const FOLDER = 'areas/routines';
const DAY_NAMES = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const FIELDS = { runs: 'Runs', rhythm: 'Rhythm', why: 'Why', scheduled: 'Scheduled in Claude', status: 'Status' };
const FIELD_RE = /^\s*[-*]\s*(runs|rhythm|why|scheduled(?: in claude)?|status)\s*:\s*(.*)$/i;
const NOT_SCHEDULED = 'not scheduled';
const RAN_RE = /^ran\b:?\s*(.*)$/i;
const CONTEXT_LINES = 4;

const pad = (n) => String(n).padStart(2, '0');
const isoDay = (date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
const clock = (date) => `${pad(date.getHours())}:${pad(date.getMinutes())}`;
// Calendar days are moved as dates, never as milliseconds of local time: a day with 23 or 25 hours
// is still one day.
const parts = (day) => day.split('-').map(Number);
const addDays = (day, n) => { const [y, m, d] = parts(day); return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10); };
const weekday = (day) => { const [y, m, d] = parts(day); return new Date(Date.UTC(y, m - 1, d)).getUTCDay(); };
const monthLength = (day) => { const [y, m] = parts(day); return new Date(Date.UTC(y, m, 0)).getUTCDate(); };
const daysBetween = (from, to) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000);

const slugify = (name) => String(name || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
const norm = (text) => String(text || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
// What a routine runs, compared: `/check-in weekly`, `check-in, weekly` and `cogby dream` are the
// same as `check in weekly` and `dream`.
const runKey = (text) => norm(text).replace(/^cogby /, '').replace(/^check in\b/, 'check-in').replace(/^wrap up\b/, 'wrap-up');

// ---- rhythm -----------------------------------------------------------------------------------

// daily | weekdays | weekly on <day> | monthly on <1-31|last>, each with an optional `at HH:MM`.
// Returns { kind, day, time } or null. Forgiving on the way in ("every friday 16:00" and "monthly on
// the 1st" are understood, "4pm" is not); `renderRhythm` is the one way it is written.
function parseRhythm(text) {
  let rest = norm(String(text || '').replace(/(\d{1,2}):(\d{2})/, ' $1h$2 '));
  let time = '';
  const at = /(?:\bat )?\b(\d{1,2})h(\d{2})\b/.exec(rest);
  if (at) {
    const [h, m] = [Number(at[1]), Number(at[2])];
    if (h > 23 || m > 59) return null;
    time = `${pad(h)}:${pad(m)}`;
    rest = `${rest.slice(0, at.index)} ${rest.slice(at.index + at[0].length)}`.replace(/\s+/g, ' ').trim();
  }
  rest = rest.replace(/^(every|each) /, '').replace(/\b(on|the|of)\b/g, ' ').replace(/\s+/g, ' ').trim();
  if (rest === 'daily' || rest === 'day') return { kind: 'daily', day: null, time };
  if (rest === 'weekdays' || rest === 'weekday') return { kind: 'weekdays', day: null, time };
  const weekly = /^(?:weekly |week )?([a-z]+?)s?$/.exec(rest);
  if (weekly) {
    const found = DAY_NAMES.findIndex((name) => name === weekly[1] || name.slice(0, 3) === weekly[1]);
    return found === -1 ? null : { kind: 'weekly', day: found, time };
  }
  const monthly = /^(?:monthly|month) (?:(\d{1,2})(?:st|nd|rd|th)?|(last)(?: day)?)$/.exec(rest);
  if (monthly) {
    const day = monthly[2] ? 31 : Number(monthly[1]);
    return day >= 1 && day <= 31 ? { kind: 'monthly', day, time } : null;
  }
  return null;
}

function renderRhythm(rhythm) {
  const base = rhythm.kind === 'weekly' ? `weekly on ${DAY_NAMES[rhythm.day]}`
    : rhythm.kind === 'monthly' ? `monthly on ${rhythm.day >= 31 ? 'last' : rhythm.day}` : rhythm.kind;
  return rhythm.time ? `${base} at ${rhythm.time}` : base;
}

function occursOn(rhythm, day) {
  if (rhythm.kind === 'daily') return true;
  if (rhythm.kind === 'weekdays') { const w = weekday(day); return w >= 1 && w <= 5; }
  if (rhythm.kind === 'weekly') return weekday(day) === rhythm.day;
  // A month shorter than the day asked for runs on its last day: the 31st is 28 February.
  return parts(day)[2] === Math.min(rhythm.day, monthLength(day));
}

// The first day the rhythm falls on, `from` included.
function nextOccurrence(rhythm, from) {
  let day = from;
  for (let i = 0; i < 400; i++, day = addDays(day, 1)) if (occursOn(rhythm, day)) return day;
  return null;
}

// When a routine is next due, and whether that has come. Worked out from the rhythm and the last
// run, in local time: the day after the last run is the first day it can be due again, and a
// routine that never ran is due from the day it was added (`since`). So a weekly review done two
// days late is due again on its own day, not a week after the late run.
//   state: paused | unknown (the rhythm line is not one Cogby reads) | upcoming | due | overdue
function dueState(routine, now = new Date()) {
  const today = isoDay(now);
  if (routine.status === 'paused') return { state: 'paused', next_due: null, days_overdue: 0, today };
  const rhythm = parseRhythm(routine.rhythm);
  if (!rhythm) return { state: 'unknown', next_due: null, days_overdue: 0, today };
  const last = routine.last_run && page.isDate(routine.last_run.date) ? routine.last_run.date : null;
  const from = last ? addDays(last, 1) : (page.isDate(routine.since) ? routine.since : today);
  const next = nextOccurrence(rhythm, from);
  if (next < today) return { state: 'overdue', next_due: next, days_overdue: daysBetween(next, today), time: rhythm.time, today };
  if (next === today) return { state: rhythm.time && clock(now) < rhythm.time ? 'upcoming' : 'due', next_due: next, days_overdue: 0, time: rhythm.time, today };
  return { state: 'upcoming', next_due: next, days_overdue: 0, time: rhythm.time, today };
}

// ---- what may run without asking ---------------------------------------------------------------

// With proactivity on `act`, Claude runs a due routine unasked only when the routine is one that
// reads and reports. That is decided here, by a list, and never by the routine's own words: what a
// routine runs is text on a page, and text on a page must not be able to grant itself permission.
// On the list: the check-in at any size (it reads and reports, and changes nothing unless the owner
// picks something) and `dream` (mechanical, writes no page of the owner's). Everything else asks
// first, whatever the setting: the wrap-up (it commits and may push), anything that sends, and any
// free-text prompt, because nobody can say from here what a prompt will touch.
const REPORT_ONLY = new Set(['check-in', 'check-in morning', 'check-in evening', 'check-in weekly', 'dream']);
const unattended = (runs) => (REPORT_ONLY.has(runKey(runs)) ? 'report' : 'ask');

// ---- the proactivity setting --------------------------------------------------------------------

// How far Cogby goes on its own about routines. Machine-local, with the other switches (the index,
// the view page): `proactive` in .cogby/local.json, absent meaning `suggest`.
//   quiet    nothing is said about routines unless asked
//   suggest  the session-start context lists what is due, and Claude offers to run it
//   act      Claude runs a due routine that only reads or reports, records the run and leaves a
//            notification saying so; any other routine still asks first
const MODES = ['quiet', 'suggest', 'act'];
const DEFAULT_MODE = 'suggest';
const readMode = (brain) => { const mode = brainLib.readLocal(brain).proactive; return MODES.includes(mode) ? mode : DEFAULT_MODE; };

function setMode(brain, mode) {
  if (!MODES.includes(mode)) throw new BrainError('USAGE', `"${mode}" is not a proactivity setting.`, `Use one of: ${MODES.join(', ')}.`);
  const local = brainLib.readLocal(brain);
  if (mode === DEFAULT_MODE) delete local.proactive; else local.proactive = mode;
  brainLib.writeLocal(brain, local);
  return mode;
}

// `cogby proactive status`: the three switches for what happens on its own, in one place. The other
// two keep their own commands; this only reads them.
function status(brain, switched = false) {
  const wrapup = require('../lib/wrapup-scope.cjs').status(brain);
  return { proactive: readMode(brain), switched, wrapup: wrapup.mode, wrapup_forced_by_env: wrapup.envForced, view_auto: require('./view.cjs').autoStatus(brain).auto };
}

// ---- reading -----------------------------------------------------------------------------------

// The definition lines of a routine page's current truth.
function parseDefinition(truth) {
  const out = { runs: '', rhythm: '', why: '', scheduled: NOT_SCHEDULED, status: 'active' };
  for (const line of String(truth || '').split('\n')) {
    const field = FIELD_RE.exec(line);
    if (!field) continue;
    const key = field[1].toLowerCase().startsWith('scheduled') ? 'scheduled' : field[1].toLowerCase();
    const value = field[2].trim();
    if (key === 'status') out.status = /^paused\b/i.test(value) ? 'paused' : 'active';
    else if (key === 'scheduled') out.scheduled = value && !/^(none|no|not scheduled)$/i.test(value) ? value : NOT_SCHEDULED;
    else out[key] = value;
  }
  return out;
}

const definitionLines = (def) => [
  `- ${FIELDS.runs}: ${def.runs}`, `- ${FIELDS.rhythm}: ${def.rhythm}`, ...(def.why ? [`- ${FIELDS.why}: ${def.why}`] : []),
  `- ${FIELDS.scheduled}: ${def.scheduled || NOT_SCHEDULED}`, `- ${FIELDS.status}: ${def.status || 'active'}`,
];

// One field's line replaced where it stands, or added after the last definition line. Every other
// line of the page, the owner's own notes included, is left as it is.
function setLine(truth, key, value) {
  const lines = truth.split('\n');
  const is = (line, name) => { const m = FIELD_RE.exec(line); return !!m && (m[1].toLowerCase().startsWith('scheduled') ? 'scheduled' : m[1].toLowerCase()) === name; };
  const at = lines.findIndex((line) => is(line, key));
  const text = `- ${FIELDS[key]}: ${value}`;
  if (at !== -1) { lines[at] = text; return lines.join('\n'); }
  let last = -1;
  lines.forEach((line, index) => { if (FIELD_RE.test(line)) last = index; });
  if (last === -1) { lines.push('', text); return lines.join('\n').replace(/^\n+/, ''); }
  lines.splice(last + 1, 0, text);
  return lines.join('\n');
}

const parseRan = (summary) => { const m = RAN_RE.exec(String(summary || '').trim()); return m ? { result: m[1].trim() } : null; };

// Every routine in the brain, from an index that is already open: its definition, its last run and
// how many runs are on its page.
function collect(db, now = new Date()) {
  const rows = db.prepare("SELECT id, slug, title, truth, revision FROM pages WHERE source_id = 'brain' AND type = 'routine' ORDER BY slug").all();
  const lines = db.prepare('SELECT date, source, summary FROM timeline_entries WHERE page_id = ? AND retracted = 0 ORDER BY date DESC, rowid DESC');
  return rows.map((row) => {
    const def = parseDefinition(row.truth);
    const timeline = lines.all(row.id);
    const runs = timeline.filter((line) => parseRan(line.summary));
    const last = runs[0] || null;
    const first = timeline.at(-1) || null;
    const routine = {
      name: row.slug.split('/').at(-1), slug: row.slug, title: row.title, runs: def.runs, rhythm: def.rhythm, why: def.why,
      scheduled: def.scheduled, status: def.status, since: first ? first.date : null,
      last_run: last ? { date: last.date, source: last.source, result: parseRan(last.summary).result } : null,
      runs_recorded: runs.length, unattended: unattended(def.runs), revision: row.revision,
    };
    const due = dueState(routine, now);
    return { ...routine, state: due.state, next_due: due.next_due, due_time: due.time || null, days_overdue: due.days_overdue };
  });
}

const isDue = (routine) => routine.state === 'due' || routine.state === 'overdue';
// Longest overdue first, then what is due today.
const byUrgency = (a, b) => b.days_overdue - a.days_overdue || (a.slug < b.slug ? -1 : 1);

// `cogby routines` and `cogby routines due`.
function list(brain, options = {}) {
  const now = options.now ? new Date(options.now) : new Date();
  return brainLib.withIndex(brain, (db, stats) => {
    const all = collect(db, now);
    const due = all.filter(isDue).sort(byUrgency);
    return {
      routines: options.due ? due : all, due: due.length, only_due: !!options.due, proactive: readMode(brain),
      today: isoDay(now), index: stats.index, index_as_of: stats.synced_at || null,
    };
  });
}

// ---- the session-start block -------------------------------------------------------------------

const say = (text, max = 80) => { const flat = String(text || '').replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim(); return flat.length > max ? `${flat.slice(0, max)}…` : flat; };
const lateness = (routine) => (routine.state === 'overdue' ? `overdue since ${routine.next_due} (${routine.days_overdue} day${routine.days_overdue === 1 ? '' : 's'})` : 'due today');
const RECORD = '`cogby routines ran "<name>" --source "<this session>" --result "<one line>"`';

// What `cogby context` says about routines: nothing when none is due or the setting is `quiet`,
// else a few lines. A routine's name and what it runs are the owner's notes and are shown as notes,
// cut to one short line each. Under `act`, which routines may run unasked is said per line, from
// the list above, so the instruction never depends on what a page says about itself.
function forContext(db, brain, options = {}) {
  const mode = readMode(brain);
  if (mode === 'quiet') return { mode, due: [], lines: [], brief: '' };
  const due = collect(db, options.now ? new Date(options.now) : new Date()).filter(isDue).sort(byUrgency);
  if (!due.length) return { mode, due, lines: [], brief: '' };
  const act = mode === 'act';
  const tag = (routine) => (act ? (routine.unattended === 'report' ? ' [reads only: run it]' : ' [ask first]') : '');
  const shown = due.slice(0, CONTEXT_LINES);
  const lines = ['', '## Routines due (the owner\'s own, kept in the brain; `cogby routines` lists them all)'];
  for (const routine of shown) lines.push(`- ${say(routine.title)}: runs "${say(routine.runs, 100)}", ${say(routine.rhythm, 40)}, ${lateness(routine)}${tag(routine)}`);
  if (due.length > shown.length) lines.push(`- and ${due.length - shown.length} more: \`cogby routines due\``);
  lines.push(act
    ? `Proactivity is \`act\`: run each one marked [reads only: run it] now, without asking, record it with ${RECORD}, and leave \`cogby notify add --status acted\` saying what you ran and what came of it. One marked [ask first] is offered, and run only on a yes, whatever the setting.`
    : `Proactivity is \`suggest\`: offer, in one line, to run what is due. Run it only on a yes, then record it with ${RECORD}.`);
  const brief = `Routines due in the brain: ${shown.map((routine) => `${say(routine.title, 40)} (${routine.state === 'overdue' ? `overdue ${routine.days_overdue}d` : 'today'}${tag(routine)})`).join(', ')}`
    + `${due.length > shown.length ? `, and ${due.length - shown.length} more` : ''}. `
    + (act ? 'Proactivity is `act`: run the ones marked [reads only: run it] without asking, record each with `cogby routines ran` and leave `cogby notify add --status acted`; the others ask first.'
      : 'Offer to run them; only on a yes, then record each with `cogby routines ran "<name>" --source "…"`.');
  return { mode, due, lines, brief };
}

// What the view snapshot carries: the setting and the routines that are due.
function forView(db, brain, now = new Date()) {
  const all = collect(db, now);
  return {
    proactive: readMode(brain), count: all.length,
    due: all.filter(isDue).sort(byUrgency).map(({ name, title, runs, rhythm, state, next_due, days_overdue, unattended: how }) => ({ name, title, runs, rhythm, state, next_due, days_overdue, unattended: how })),
  };
}

// ---- writing -----------------------------------------------------------------------------------

const write = () => require('./write.cjs');
const clean = (value, max = 300) => page.oneLine(value).slice(0, max);

function requireRhythm(text) {
  const rhythm = parseRhythm(text);
  if (!rhythm) throw new BrainError('BAD_RHYTHM', `"${text || ''}" is not a rhythm.`, 'Use daily, weekdays, "weekly on friday" or "monthly on 1" (or "monthly on last"), each with an optional "at 16:00".');
  return renderRhythm(rhythm);
}

// The routine a name means: its page's file name, its title, or the one routine either starts with.
function find(db, ref) {
  const all = collect(db);
  const key = slugify(String(ref || '').replace(/\\/g, '/').replace(/\.md$/i, '').split('/').at(-1));
  if (!key) return { all, matches: [] };
  const exact = all.filter((routine) => routine.name === key || slugify(routine.title) === key);
  return { all, matches: exact.length ? exact : all.filter((routine) => routine.name.startsWith(key) || slugify(routine.title).startsWith(key)) };
}

function one(brain, ref) {
  const { all, matches } = brainLib.withIndex(brain, (db) => find(db, ref));
  if (matches.length === 1) return matches[0];
  if (matches.length > 1) throw new BrainError('AMBIGUOUS', `"${ref}" names ${matches.length} routines: ${matches.map((routine) => routine.name).join(', ')}.`, 'Use one of those names.');
  throw new BrainError('NOT_FOUND', `No routine "${ref}".`, all.length ? `There are: ${all.map((routine) => routine.name).join(', ')}.` : 'Add one with `cogby routines add "<name>" --run "<skill or prompt>" --rhythm "<rhythm>"`.');
}

// The folder's own card, made with the first routine, so the brain's map says what the folder is.
function ensureFolderCard(brain, options) {
  try {
    write().writePage(brain, `${FOLDER}/card`, (parsed) => {
      if (parsed.truth.trim() || parsed.timeline.length) return { changed: false };
      parsed.fmRaw = page.setField(page.setField(parsed.fmRaw, 'type', 'area'), 'title', 'Routines');
      parsed.truth = '# Routines\n\nWhat the owner does on a rhythm with Claude. One page per routine in this folder: what it runs, its rhythm, why it exists, where it is scheduled in Claude, and a dated line for each run. `cogby routines` lists them.';
      return { changed: true, message: 'routines: the folder\'s card' };
    }, { ...options, create: true });
  } catch { /* the routine itself is what matters */ }
}

// `cogby routines add`. The owner's command: it writes the definition, and one timeline line saying so.
function add(brain, name, options = {}) {
  const title = clean(name, 80);
  const key = slugify(title);
  if (!key || key === 'card') throw new BrainError('USAGE', 'A routine needs a name.', 'cogby routines add "<name>" --run "<skill or prompt>" --rhythm "<rhythm>"');
  const runs = clean(options.run);
  if (!runs) throw new BrainError('USAGE', 'A routine needs what it runs.', 'Add --run "<skill or prompt>", for example --run "check-in, weekly".');
  const rhythm = requireRhythm(options.rhythm);
  const def = { runs, rhythm, why: clean(options.why), scheduled: scheduledValue(options.scheduled), status: 'active' };
  const source = clean(options.source, 120) || 'cogby routines add';
  const by = write().recorder(brain, options);
  const date = options.date || isoDay(new Date());
  if (!page.isDate(date)) throw new BrainError('BAD_DATE', `"${date}" is not a date.`, 'Use YYYY-MM-DD.');
  ensureFolderCard(brain, { by, env: options.env });
  const written = write().writePage(brain, `${FOLDER}/${key}`, (parsed) => {
    if (parsed.truth.trim() || parsed.timeline.length) throw new BrainError('EXISTS', `There is already a routine "${key}".`, 'Change it with `cogby routines edit`, or pick another name.');
    parsed.fmRaw = page.setField(page.setField(parsed.fmRaw, 'type', 'routine'), 'title', title);
    parsed.truth = [`# ${title}`, '', ...definitionLines(def)].join('\n');
    const summary = `added: runs "${runs}", ${rhythm}${def.scheduled === NOT_SCHEDULED ? '' : `, scheduled in Claude as ${def.scheduled}`}`;
    parsed.timelineText = page.insertTimelineLine(parsed.timelineText, page.renderTimelineLine({ date, source, summary, ...by }), date);
    parsed.hasMarker = true;
    return { changed: true, message: `routines add: ${title}` };
  }, { env: options.env, by, create: true, title });
  return { ...written, action: 'added', routine: one(brain, key) };
}

const scheduledValue = (value) => { const text = clean(value, 200); return text && !/^(none|no|not scheduled)$/i.test(text) ? text : NOT_SCHEDULED; };

// One change to a routine's definition and the timeline line that records it, in one write.
function change(brain, ref, command, apply, options = {}) {
  const routine = one(brain, ref);
  const source = clean(options.source, 120) || `cogby routines ${command}`;
  const by = write().recorder(brain, options);
  const date = isoDay(new Date());
  const written = write().writePage(brain, routine.slug, (parsed) => {
    const was = parseDefinition(parsed.truth);
    const changes = apply(was, parsed);
    if (!changes.length) return { changed: false, status: 'unchanged' };
    const summary = `${command === 'edit' ? 'edited' : command === 'pause' ? 'paused' : 'resumed'}: ${changes.join('; ')}`;
    parsed.timelineText = page.insertTimelineLine(parsed.timelineText, page.renderTimelineLine({ date, source, summary, ...by }), date);
    parsed.hasMarker = true;
    return { changed: true, status: 'changed', changes, message: `routines ${command}: ${routine.name}` };
  }, { env: options.env, by });
  return { ...written, action: command, routine: one(brain, routine.name) };
}

// `cogby routines edit`: any of what it runs, its rhythm, why, where it is scheduled, its title.
// The old value goes into the timeline line, so nothing a routine used to be is lost.
function edit(brain, ref, options = {}) {
  const wanted = {};
  if (options.run !== undefined) { wanted.runs = clean(options.run); if (!wanted.runs) throw new BrainError('USAGE', '--run needs a skill or a prompt.', ''); }
  if (options.rhythm !== undefined) wanted.rhythm = requireRhythm(options.rhythm);
  if (options.why !== undefined) wanted.why = clean(options.why);
  if (options.scheduled !== undefined) wanted.scheduled = scheduledValue(options.scheduled);
  const title = options.title !== undefined ? clean(options.title, 80) : null;
  if (!Object.keys(wanted).length && !title) throw new BrainError('USAGE', 'Nothing to change.', 'cogby routines edit <name> [--run "…"] [--rhythm "…"] [--why "…"] [--scheduled "<pointer>"|none] [--title "…"]');
  return change(brain, ref, 'edit', (was, parsed) => {
    const changes = [];
    for (const [key, value] of Object.entries(wanted)) {
      if (was[key] === value) continue;
      parsed.truth = setLine(parsed.truth, key, value);
      changes.push(`${FIELDS[key].toLowerCase()} "${was[key] || 'none'}" → "${value || 'none'}"`);
    }
    if (title && title !== parsed.title) {
      parsed.fmRaw = page.setField(parsed.fmRaw, 'title', title);
      parsed.truth = parsed.truth.replace(/^#\s+.*$/m, `# ${title}`);
      changes.push(`title "${parsed.title}" → "${title}"`);
    }
    return changes;
  }, options);
}

function setStatus(brain, ref, status, options = {}) {
  return change(brain, ref, status === 'paused' ? 'pause' : 'resume', (was, parsed) => {
    if (was.status === status) return [];
    parsed.truth = setLine(parsed.truth, 'status', status);
    const reason = clean(options.reason, 200);
    return [reason || (status === 'paused' ? 'it is not due while paused' : 'active again')];
  }, options);
}

// `cogby routines ran`: one run, as a dated line on the routine's page, with its source and a
// one-line result. Refused without a source, like every other line of evidence.
//
// `ref` is a routine's name, or what it runs: `ran "check-in, weekly"` records the run on every
// routine that runs the weekly check-in, and on one that runs "check-in" at no size in particular.
// That second form is how a skill or a command records its own run without knowing what the owner
// called the routine, and it is the only form those callers get: with `ifAny`, `ref` is what ran
// and is matched against what each routine runs, never against a name. `cogby dream` must not
// write its run on a routine called "Dream journal" that runs something else. `ifAny` also makes
// "no routine runs this" an answer, not an error.
// Without `ifAny` the owner or a session is naming a routine: its name or title, then the one
// routine either starts with, and only when no name fits, what it runs.
function ran(brain, ref, options = {}) {
  const source = clean(options.source, 120);
  if (!source) throw new BrainError('SOURCE_REQUIRED', 'routines ran needs a source: what ran it.', 'Add --source "<evidence>", for example --source "check-in 2026-11-13" or --source "scheduled task weekly-review".');
  const date = options.date || isoDay(new Date());
  if (!page.isDate(date)) throw new BrainError('BAD_DATE', `"${date}" is not a date.`, 'Use YYYY-MM-DD.');
  const { all, matches } = brainLib.withIndex(brain, (db) => find(db, ref));
  let targets = options.ifAny ? [] : matches;
  if (!targets.length) {
    const key = runKey(ref);
    targets = key ? all.filter((routine) => { const runs = runKey(routine.runs); return runs && (runs === key || key.startsWith(`${runs} `)); }) : [];
  } else if (targets.length > 1) {
    throw new BrainError('AMBIGUOUS', `"${ref}" names ${targets.length} routines: ${targets.map((routine) => routine.name).join(', ')}.`, 'Use one of those names.');
  }
  if (!targets.length) {
    if (options.ifAny) return { action: 'ran', recorded: [], asked: String(ref || '') };
    throw new BrainError('NOT_FOUND', `No routine is named "${ref}" or runs it.`, all.length ? `There are: ${all.map((routine) => routine.name).join(', ')}.` : 'Add one with `cogby routines add`.');
  }
  const result = clean(options.result, 240);
  const summary = result ? `ran: ${result}` : 'ran';
  const recorded = targets.map((routine) => {
    const written = write().appendRecord(brain, routine.slug, summary, { ...options, source, date, command: 'routines ran' });
    return { name: routine.name, slug: routine.slug, status: written.status, line: written.line, revision: written.revision, commit: written.commit };
  });
  return { action: 'ran', recorded, asked: String(ref || ''), date };
}

module.exports = {
  FOLDER, MODES, DEFAULT_MODE, NOT_SCHEDULED, REPORT_ONLY,
  parseRhythm, renderRhythm, occursOn, nextOccurrence, dueState, unattended, runKey,
  parseDefinition, parseRan, collect, list, forContext, forView,
  add, edit, setStatus, ran, readMode, setMode, status,
};
