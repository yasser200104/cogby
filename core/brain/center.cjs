'use strict';

// The command center page: the brain's snapshot poured into one fixed template.
//
// The look is the template's (core/templates/command-center.html); nothing here or in a session
// designs anything. `build` takes the snapshot `cogby view --json` returns, adds today's meetings
// when a session read them from a calendar, and writes the page twice inside the brain:
//   output/brain-view.html                       a whole document, to open from disk
//   .cogby/self/.gateway/command-center.html     the same page in the shape an artifact is published
//                                                in (no doctype, head or body of its own)
// The page has four tabs (today, tasks and notes, projects, the brain) and a basic view of each project
// (#/project/<name>), all in the one file: one snapshot, one link, one store behind it. A project's
// dashboard is a page of its own, built from the same template when the person asks for one (`build`
// with a project) and linked from the project's card and view.
// The page never writes the brain. What a person presses on it reaches a session through the
// published page's own store, written at once, or as text they copy from a file opened from disk.

const fs = require('fs');
const path = require('path');
const { BrainError, ensureIgnored } = require('./db.cjs');
const { oneLine } = require('./page.cjs');

const TEMPLATE = path.join(__dirname, '..', 'templates', 'command-center.html');
const SLOT = '__COGBY_DATA__';
const LOCAL = ['output', 'brain-view.html'];
const PUBLISHED = ['.cogby', 'self', '.gateway', 'command-center.html'];
const MEETINGS_MAX = 20;
const https = (value) => (typeof value === 'string' && /^https:\/\/[^\s"'<>]+$/.test(value) ? value : '');

const line = (value, max) => oneLine(String(value == null ? '' : value)).slice(0, max);

// The clock times in a line, in minutes after midnight: "11:00 – 11:45", "9:30am-10:15am", "14h30",
// "9 – 10am". A bare hour counts only beside one that says am or pm, and takes its half of the day.
function clocks(text) {
  const found = [];
  for (const m of String(text || '').matchAll(/(\d{1,2})(?:[:.](\d{2})|(h)(\d{2})?)?\s*(?:([ap])\.?\s?m\b\.?)?/gi)) {
    const min = m[2] || m[4];
    found.push({ h: Number(m[1]), min: min ? Number(min) : 0, half: (m[5] || '').toLowerCase(), bare: !min && !m[3] && !m[5] });
  }
  const half = (found.find((one) => one.half) || {}).half || '';
  return found.filter((one) => !one.bare || half).map((one, i, all) => {
    let h = one.h;
    const own = one.half || (all[i + 1] && all[i + 1].half) || half;
    if (own === 'p' && h < 12) h += 12;
    if (own === 'a' && h === 12) h = 0;
    return h < 24 && one.min < 60 ? h * 60 + one.min : null;
  }).filter((minutes) => minutes !== null);
}

// When a meeting starts and ends, in minutes after midnight, for the day's calendar on the page. From
// `start` and `end` when the session gives them (an ISO date and time, read in this machine's time zone,
// or a clock time), otherwise from the `time` line as shown. A meeting with no end gets half an hour;
// one whose time cannot be read has none, and the page lists it apart.
function span(raw) {
  const one = (value) => {
    if (typeof value !== 'string' || !value.trim()) return null;
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value)) { const at = new Date(value); return isNaN(at) ? null : at.getHours() * 60 + at.getMinutes(); }
    const found = clocks(value); return found.length ? found[0] : null;
  };
  let start = one(raw.start); let end = one(raw.end);
  if (start === null) { const found = clocks(raw.time); start = found.length ? found[0] : null; if (end === null && found.length > 1) end = found[1]; }
  if (start === null) return { start: null, end: null };
  // "11:00 – 1:00 PM": the start took the afternoon from the end it was written beside.
  if (end !== null && start > end && start >= 12 * 60 && start - 12 * 60 < end) start -= 12 * 60;
  if (end === null || end <= start) end = Math.min(start + 30, 24 * 60);
  return { start, end };
}

// One meeting, as a session hands it over from a calendar: text only, and a link only when it is https.
function meeting(raw, projects) {
  if (!raw || typeof raw !== 'object') return null;
  const title = line(raw.title, 160);
  const id = line(raw.id, 120).replace(/[^A-Za-z0-9_.:@-]/g, '-');
  if (!title || !id) return null;
  const url = typeof raw.url === 'string' && /^https:\/\/[^\s"'<>]+$/.test(raw.url) ? raw.url : '';
  // A meeting is about a project when its title holds the project's name.
  const about = projects.find((project) => project.name.length > 2 && title.toLowerCase().includes(project.name.toLowerCase().replace(/-/g, ' ')))
    || projects.find((project) => project.title.length > 2 && title.toLowerCase().includes(project.title.toLowerCase()));
  const last = about && about.parking_spot[0] ? about.parking_spot[0].summary : '';
  // The attendees, as a line or a list of names: the meeting's card lists each one.
  const people = Array.isArray(raw.people) ? raw.people.map((name) => line(name, 80)).filter(Boolean).join(', ') : raw.people;
  return { id, title, time: line(raw.time, 40), ...span(raw), people: line(people, 600), url, project: about ? about.title : '', project_name: about ? about.name : '', last: line(last, 160) };
}

// One open chat, as a session read it from the Claude app: text only. `state` is who has to act next:
// 'needs' (it waits for the owner), 'working' (it is running), 'finished' (it ended and was not looked at),
// anything else 'idle'. The link is Claude's own address for a session, or a claude.ai page.
const SESSIONS_MAX = 60;
const SESSION_STATES = ['needs', 'working', 'finished', 'idle'];
const SESSION_LINK = /^(claude:\/\/claude\.ai\/epitaxy\/local_[0-9a-f-]{8,64}|https:\/\/claude\.ai\/[^\s"'<>]+)$/i;
function session(raw, projects) {
  if (!raw || typeof raw !== 'object') return null;
  const title = line(raw.title, 140);
  if (!title) return null;
  const state = SESSION_STATES.includes(raw.state) ? raw.state : 'idle';
  const link = typeof raw.link === 'string' && SESSION_LINK.test(raw.link.trim()) ? raw.link.trim() : '';
  const named = line(raw.project, 80).toLowerCase();
  const about = named ? projects.find((project) => project.name.toLowerCase() === named || project.title.toLowerCase() === named) : null;
  return { id: line(raw.id, 80).replace(/[^A-Za-z0-9_.:-]/g, '-'), title, state, where: line(raw.where, 300), needs: line(raw.needs, 300), at: line(raw.at, 40), link, project: about ? about.title : line(raw.project, 80), project_name: about ? about.name : '' };
}

// A task that lives in the owner's own tool (Notion, Google Tasks, a tracker), as a session read it
// there (`options.tasks`): shown on the page with where it lives and a link to it, never copied into
// the brain. One with no words or no tool named is left out.
const TASKS_MAX = 200;
function outsideTask(raw, projects, at) {
  if (!raw || typeof raw !== 'object') return null;
  const text = line(raw.text || raw.title, 200);
  const tool = line(raw.tool, 30);
  if (!text || !tool) return null;
  const day = String(raw.due || '').slice(0, 10);
  const named = line(raw.project, 80).toLowerCase();
  const about = named ? projects.find((project) => project.name.toLowerCase() === named || project.title.toLowerCase() === named) : null;
  return {
    id: `ext:${line(raw.id, 80).replace(/[^A-Za-z0-9_.:-]/g, '-') || at}`, text, due: /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : '', done: raw.done === true,
    tool, link: https(typeof raw.link === 'string' ? raw.link.trim() : ''), project: about ? about.name.toLowerCase() : '',
  };
}

// The skills a brain can use: Cogby's own and the ones kept in the brain, each with its first sentence.
// One of Cogby's own that Claude is not told of (`disable-model-invocation: true`, an extra such as the
// Notion mirror, started only by typing its name) is left out: the list is what to ask for in a chat.
function skillsOf(brain) {
  const out = []; const seen = new Set();
  const from = (dir, own) => {
    let names = []; try { names = fs.readdirSync(dir); } catch (error) { return; }
    names.sort().forEach((name) => {
      if (seen.has(name)) return;
      let text = ''; try { text = fs.readFileSync(path.join(dir, name, 'SKILL.md'), 'utf8'); } catch (error) { return; }
      const front = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
      if (!own && front && /^disable-model-invocation:\s*true\s*$/m.test(front[1])) return;
      const found = /^description:\s*(.+)$/m.exec(text.slice(0, 4000));
      const about = found ? found[1].trim().replace(/^["'>|-]+\s*/, '').split(/(?<=[.!?])\s/)[0] : '';
      seen.add(name); out.push({ name: line(name, 60), about: line(about, 200), own });
    });
  };
  if (brain) from(path.join(brain, '.claude', 'skills'), true);
  from(path.join(__dirname, '..', '..', '.claude', 'skills'), false);
  return out.slice(0, 80);
}

// A scheduled task's last run, as a session read it from Claude's scheduler: a link to the chat it ran in
// (Claude's own address for a session, or a claude.ai page), when it ran and its one-line summary. Text only.
const CHAT = /^(claude:\/\/claude\.ai\/epitaxy\/local_[0-9a-f-]{8,64}|https:\/\/claude\.ai\/[^\s"'<>]+)$/i;
function runOf(runs, task) {
  if (!runs || typeof runs !== 'object' || Array.isArray(runs) || !task) return null;
  const key = Object.keys(runs).find((name) => name.toLowerCase() === String(task).toLowerCase());
  const raw = key ? runs[key] : null;
  if (!raw || typeof raw !== 'object') return null;
  const link = typeof raw.link === 'string' && CHAT.test(raw.link.trim()) ? raw.link.trim() : '';
  return { link, at: line(raw.at, 40), summary: line(raw.summary, 300) };
}

function pageData(snapshot, options = {}) {
  const given = options.meetings;
  if (given !== undefined && given !== null && !Array.isArray(given)) throw new BrainError('BAD_MEETINGS', 'Meetings are a list.', 'Pass a JSON array of { id, title, time, people, url }.');
  return {
    // Set on a project's own dashboard page: the folder name of the one project it shows.
    only: options.project || '',
    generated_at: snapshot.generated_at, owner: line(options.owner, 60),
    // Which Cogby made the page, from its plugin.json, shown as written at the page's foot.
    version: require('../lib/version.cjs').pluginVersion(),
    // How much the brain holds (`unconfirmed`: what an agent wrote that the owner has not confirmed, one
    // row of "Needs you"), whether its index is kept, and whether this page is made unasked.
    counts: snapshot.counts, index: snapshot.index, stale_after_days: snapshot.stale_after_days, auto: snapshot.auto,
    notifications: snapshot.notifications,
    // The owner's routines that are due today or late, also in "Needs you": only what the row shows.
    routines: ((snapshot.routines && snapshot.routines.due) || []).map((routine) => ({ title: routine.title, rhythm: routine.rhythm, state: routine.state, days_overdue: routine.days_overdue })),
    // Every active routine and what its last run found, for the Routines part of Today: the result is
    // shown as written, broken into lines on the page, so the owner reads it without opening anything.
    // A routine opens on the page: its last five runs, and the chat its scheduled task last ran in when a
    // session read that from Claude's scheduler (`options.runs`, keyed by the task's name).
    routine_runs: ((snapshot.routines && snapshot.routines.all) || []).map((routine) => {
      const ran = runOf(options.runs, routine.scheduled_as);
      return {
        title: line(routine.title, 80), runs: line(routine.runs, 120), rhythm: line(routine.rhythm, 60), scheduled: !!routine.scheduled, scheduled_as: line(routine.scheduled_as, 80),
        state: routine.state, days_overdue: routine.days_overdue || 0,
        last_date: routine.last_run ? routine.last_run.date : '', last_result: routine.last_run ? line(routine.last_run.result, 700) : '',
        history: (routine.history || []).map((one) => ({ date: one.date, source: line(one.source, 160), result: line(one.result, 700) })),
        chat: ran ? ran.link : '', chat_at: ran ? ran.at : '', chat_summary: ran ? ran.summary : '',
      };
    }),
    // The owner's own to-dos and notes. On the page a tick or a new line is saved to the page's store
    // at once; a session applies it to the brain's files later.
    // A to-do opens on the page too: its details (`body`), the day it was added and where it came from.
    todos: snapshot.todos.items.map((item) => ({ id: item.id, text: item.text, body: String(item.body || '').slice(0, 4000), due: item.due, project: item.project, done: item.status === 'done', done_at: item.status === 'done' ? String(item.done_at || '').slice(11, 16) : '', added: String(item.created || '').slice(0, 10), source: line(item.source, 60), by: item.by === 'cogby' ? 'cogby' : '', plan: String(item.plan || '').slice(0, 4000) })),
    // The owner's open chats with Claude, as a session read them from the app (`options.sessions`): null
    // says none were read for this page.
    sessions: Array.isArray(options.sessions) ? options.sessions.map((raw) => session(raw, snapshot.projects)).filter(Boolean).slice(0, SESSIONS_MAX) : null,
    // The tasks the owner keeps in a tool of their own, when a session read them for this page.
    tasks: Array.isArray(options.tasks) ? options.tasks.map((raw, at) => outsideTask(raw, snapshot.projects, at)).filter(Boolean).slice(0, TASKS_MAX) : [],
    // Cogby's own skills and the brain's, by name, for My Cogby.
    skills: skillsOf(options.brain),
    // `body`: the longer text kept with a note, shown when the note is opened on the page.
    notes: snapshot.notes.map((item) => ({ id: item.id, text: item.text, body: String(item.body || '').slice(0, 4000), date: item.created.slice(0, 10), project: item.project })),
    // null says no calendar was read; an empty list says there is nothing today.
    meetings: Array.isArray(given) ? given.map((raw) => meeting(raw, snapshot.projects)).filter(Boolean).slice(0, MEETINGS_MAX) : null,
    meetings_read_at: Array.isArray(given) ? line(options.meetingsReadAt, 40) : '',
    projects: snapshot.projects.map((project) => ({
      // `name` is the project's folder name: what its dashboard's address and a meeting's `project_name` use.
      title: project.title, slug: project.slug, name: project.name, dashboard: https((snapshot.dashboards || {})[project.name.toLowerCase()]), truth: project.truth, stale: project.stale, days_since: project.days_since,
      // As the old Console showed a project: its status, the project it is part of, when it last moved and
      // the files in its folder (paths inside the folder only, never where the brain sits on this machine).
      status: project.status || '', parent: project.parent || '', updated: project.updated || '',
      files: { count: (project.files || {}).count || 0, items: ((project.files || {}).items || []).map((file) => ({ path: line(file.path, 200), size: file.size, modified: file.modified })) },
      waiting: project.waiting, parking_spot: project.parking_spot.slice(0, 1), now: project.now, next: project.next,
      commitments: project.commitments.map((fact) => ({ claim: fact.claim, source: fact.source })),
      // A line an agent wrote and the owner has not confirmed is tagged on the page (`confirmed` false).
      timeline: project.timeline.map((entry) => ({ date: entry.date, source: entry.source, summary: entry.summary, actor: entry.actor, confirmed: !!entry.confirmed })),
    })),
    recent: snapshot.recent.map((entry) => ({ date: entry.date, source: entry.source, summary: entry.summary, actor: entry.actor, confirmed: !!entry.confirmed, slug: entry.slug, title: entry.title })),
    // A folder's place on this machine names its user: the published page gets the folder's name only.
    // `builtin`: the brain itself and its day log, listed after the owner's own folders.
    sources: snapshot.sources.map((source) => ({ id: source.id, name: line(path.basename(String(source.path || '').replace(/[\\/]+$/, '')) || source.id, 80), path: options.published ? '' : source.path, mode: source.mode, files: source.files, last_sync: source.last_sync, missing: source.missing, builtin: !!source.builtin })),
  };
}

// JSON inside a script element: nothing in it may end the element or start a comment.
// The two line separators JSON allows raw and a script does not.
const SEPARATORS = new RegExp(`[${String.fromCharCode(0x2028)}${String.fromCharCode(0x2029)}]`, 'g');
const embed = (data) => JSON.stringify(data).replace(/</g, '\\u003c').replace(SEPARATORS, (ch) => `\\u${ch.charCodeAt(0).toString(16)}`);

function render(data, published = data, title = '') {
  const escaped = String(title).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const template = fs.readFileSync(TEMPLATE, 'utf8').replace(/\r\n/g, '\n').replace(/<title>[^<]*<\/title>/, (found) => (title ? `<title>${escaped}</title>` : found));
  if (template.split(SLOT).length !== 2) throw new BrainError('BAD_TEMPLATE', 'The command center template has no single data slot.', '');
  const fill = (what) => template.replace(SLOT, () => embed(what));
  const page = fill(published);
  const whole = `<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n</head>\n<body>\n${fill(data)}</body>\n</html>\n`;
  return { page, whole };
}

function build(brain, options = {}) {
  const snapshot = require('./view.cjs').view(brain, { now: options.now });
  // With a project, the page is that project's own dashboard: its own files, its own link, no store.
  let project = null;
  if (options.project !== undefined && options.project !== null && options.project !== '') {
    const key = String(options.project).trim().toLowerCase();
    project = snapshot.projects.find((one) => one.name.toLowerCase() === key) || snapshot.projects.find((one) => one.title.toLowerCase() === key);
    if (!project) throw new BrainError('NO_PROJECT', `This brain has no project "${options.project}".`, snapshot.projects.length ? `Name one by its folder: ${snapshot.projects.map((one) => one.name).join(', ')}.` : 'It has no projects yet.');
  }
  const given = { ...options, brain, project: project ? project.name : '' };
  const { page, whole } = render(pageData(snapshot, given), pageData(snapshot, { ...given, published: true }), project ? `${line(project.title, 60)} dashboard` : '');
  ensureIgnored(brain);   // the copy kept for publishing is this machine's, never committed
  const put = (parts, text) => { const file = path.join(brain, ...parts); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); return file; };
  const name = project ? `dashboard-${project.name.replace(/[^A-Za-z0-9_.-]/g, '-')}.html` : '';
  return {
    file: put(project ? ['output', name] : LOCAL, whole), publish: put(project ? [...PUBLISHED.slice(0, -1), name] : PUBLISHED, page),
    ...(project ? { project: project.name } : {}),
    generated_at: snapshot.generated_at, artifact: project ? https((snapshot.dashboards || {})[project.name.toLowerCase()]) || null : snapshot.artifact, auto: snapshot.auto,
    waiting: snapshot.notifications.count, meetings: Array.isArray(options.meetings) ? options.meetings.length : null,
    // What the published page must declare. The command center keeps its own small store, so that what
    // the owner presses on it reaches a session; a project's dashboard keeps none, and what is chosen
    // on it leaves as copied text.
    capabilities: project ? {} : { db: {} },
  };
}

module.exports = { build, render, pageData, meeting, session, skillsOf, span, embed, runOf, TEMPLATE };
