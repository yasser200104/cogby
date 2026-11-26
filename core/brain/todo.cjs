'use strict';

// `cogby todo` and `cogby note`: the owner's own lists, kept in the brain.
//
// Two files, each in the shape of the notifications store ({ version, updated, items[] }):
//   <brain>/.cogby/todos/store.json   one line to do, with a date and a project when it has them
//   <brain>/.cogby/notes/store.json   a quick note, in the Console's own field names, so a brain that
//                                     had a Console keeps its notes with nothing to convert
// These are the owner's, not Cogby's: what Cogby wants from the owner is a notification. Nothing is
// deleted: a to-do is done or dropped, a note is dismissed, and both stay in the file.
//
// Both files travel with the brain, and so does the notifications store: none of the three is
// ignored. Every write to one ends in a commit of that one file, as a page write does, so a to-do
// added from a linked folder is in the brain's history at once and waits for no wrap-up. The read,
// the change and the save happen behind the lock page writes take (write.cjs withLock), so two
// sessions adding at the same moment both keep their item. A change that is refused (no words, no
// such id, a store that cannot be read) writes nothing. A commit that fails does not undo the
// write: the result says `committed: false` and why, and the file stays changed for the next write
// to it or the wrap-up, whose scope holds the stores whenever they are dirty
// (core/lib/wrapup-scope.cjs). Nothing here pushes.
//
// Until 2026-11-13 the starter .gitignore ignored the note store (and the notifications), so notes
// stayed on the machine they were written on; `save` below takes that rule out of an older brain.
// Two machines that both change a store between pulls meet as an ordinary git conflict in its JSON.
//
// Who writes here: a session when the owner says "add a to-do" or "note this", and the session that
// applies what the owner did on the command center page.

const fs = require('fs');
const path = require('path');
const { BrainError, ensureIgnored } = require('./db.cjs');
const { oneLine } = require('./page.cjs');

const FILES = { todo: ['.cogby', 'todos', 'store.json'], note: ['.cogby', 'notes', 'store.json'] };
const TODO_STATUSES = Object.freeze(['open', 'done', 'dropped']);
const NOTE_STATUSES = Object.freeze(['open', 'dismissed', 'spun', 'deleted']);
const TEXT_MAX = 200;
const NOTE_MAX = 400;
const BODY_MAX = 4000;

const storeFile = (brain, kind) => path.join(brain, ...FILES[kind]);
const pad = (n) => String(n).padStart(2, '0');
// Local time, as the notifications store writes it: "YYYY-MM-DD HH:MM:SS".
const stamp = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
const localDay = (d = new Date()) => stamp(d).slice(0, 10);
const newId = (prefix) => `${prefix}-${Date.now()}-${Math.floor(Math.random() * 0x10000).toString(16).padStart(4, '0')}`;
const line = (value, max) => oneLine(String(value == null ? '' : value)).slice(0, max);

// A store that is not there yet is empty. One that is there and cannot be read (not JSON, no
// `items` list) is not empty: taking it for empty lets the next save write over everything in it.
// So `read` says so (`unreadable`: the file and why), a list shows nothing and passes that on, and
// a write goes through `load`, which refuses, names the file and leaves it exactly as it is.
function read(brain, kind) {
  const file = storeFile(brain, kind);
  const unreadable = (why) => ({ items: [], unreadable: { file, why } });
  let raw;
  try { raw = fs.readFileSync(file, 'utf8'); } catch (error) { return error.code === 'ENOENT' ? { items: [], unreadable: null } : unreadable(error.message); }
  let parsed;
  try { parsed = JSON.parse(raw.replace(/^\uFEFF/, '')); } catch (error) { return unreadable(`it is not JSON: ${error.message}`); }
  if (!parsed || !Array.isArray(parsed.items)) return unreadable('it has no "items" list');
  return { items: parsed.items.filter((item) => item && typeof item === 'object' && typeof item.id === 'string'), unreadable: null };
}

function load(brain, kind) {
  const store = read(brain, kind);
  if (store.unreadable) {
    throw new BrainError('STORE_UNREADABLE', `The ${kind === 'todo' ? 'to-do' : 'note'} store cannot be read, so nothing was written: ${store.unreadable.file} (${store.unreadable.why}).`,
      `The file is left as it is. Repair it, or move it aside to start an empty one; an earlier version may be in the brain's git history (git log -- ${FILES[kind].join('/')}).`);
  }
  return store;
}

// The file replaced whole, then committed alone. Returns the commit: { committed, sha } or
// { committed: false, why }.
function save(brain, kind, items, message) {
  const file = storeFile(brain, kind);
  ensureIgnored(brain);   // an older brain stops ignoring the note store before the next note lands
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(tmp, `${JSON.stringify({ version: 1, updated: stamp(), items }, null, 2)}\n`);
    fs.renameSync(tmp, file);
  } catch (error) { try { fs.rmSync(tmp, { force: true }); } catch { /* nothing left behind */ } throw error; }
  return require('./write.cjs').commitFile(brain, FILES[kind].join('/'), message);
}

// One write to a store, whole or not at all: behind the brain's write lock, the store is read,
// `work(items)` changes the list in place and returns { item, message }, and the file is saved and
// committed. `work` refuses by throwing, before anything is written.
function change(brain, kind, work) {
  return require('./write.cjs').withLock(brain, () => {
    const { items } = load(brain, kind);
    const { item, message } = work(items);
    return { item, commit: save(brain, kind, items, message) };
  });
}
const subject = (what, text) => `${what}: ${String(text || '').slice(0, 72)}`;

// A due date is a day, or nothing.
function day(value) {
  const text = String(value == null ? '' : value).trim();
  if (!text || text === 'none') return '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || Number.isNaN(Date.parse(`${text}T00:00:00Z`))) throw new BrainError('BAD_DATE', `"${text}" is not a day.`, 'Write it as YYYY-MM-DD, or "none" to take the date off.');
  return text;
}
// A project is named by its folder: `harbor`, `projects/harbor` and `projects/harbor/card` are the same.
const projectName = (value) => line(value, 80).toLowerCase().replace(/\\/g, '/').replace(/\/card$/, '').replace(/^projects\//, '').replace(/\/+$/, '');

// `body`: the details kept with a to-do, beyond its one line (what it is for, what done looks like).
const shownTodo = (item) => ({
  id: item.id, text: item.text || '', body: item.body || '', due: item.due || '', project: item.project || '', status: TODO_STATUSES.includes(item.status) ? item.status : 'open',
  created: item.created || '', done_at: item.done_at || '', source: item.source || '',
  // `by`: 'cogby' when the owner handed the to-do to Cogby; `plan`: what Cogby proposes to do about it.
  by: item.by === 'cogby' ? 'cogby' : '', plan: item.plan || '',
});
// Whose a to-do is: Cogby's, or (anything else, "me", "none") the owner's.
const whose = (value) => (/^cogby$/i.test(String(value == null ? '' : value).trim()) ? 'cogby' : '');
// Details are kept as they were written, lines and all; "none" takes them off.
const details = (value) => (String(value).trim() === 'none' ? '' : String(value == null ? '' : value).replace(/\r\n?/g, '\n').trim().slice(0, BODY_MAX));

function findIn(items, id, what) {
  const item = items.find((entry) => entry.id === id);
  if (!item) throw new BrainError('NO_SUCH', `No ${what} with id ${id}.`, `List them with \`cogby ${what === 'to-do' ? 'todo' : 'note'} --all\`.`);
  return item;
}

function addTodo(brain, fields = {}) {
  const text = line(fields.text, TEXT_MAX);
  if (!text) throw new BrainError('NO_TEXT', 'A to-do needs words: one line you can tick.', 'cogby todo add "…"');
  const due = day(fields.due);
  const done = change(brain, 'todo', (items) => {
    const item = { id: newId('todo'), text, due, project: projectName(fields.project), status: 'open', created: stamp(), done_at: '', source: line(fields.source, 60) || 'session' };
    if (fields.body !== undefined && fields.body !== null && details(fields.body)) item.body = details(fields.body);
    if (whose(fields.by)) item.by = 'cogby';
    items.push(item);
    return { item, message: subject('todo', text) };
  });
  return { todo: shownTodo(done.item), commit: done.commit };
}

function changeTodo(brain, id, what, how) {
  const done = change(brain, 'todo', (items) => {
    const item = findIn(items, id, 'to-do');
    how(item);
    item.updated = stamp();
    return { item, message: subject(`todo ${what}`, item.text) };
  });
  return { todo: shownTodo(done.item), commit: done.commit };
}

const TURN = { done: 'done', reopen: 'open', drop: 'dropped' };
function setTodo(brain, id, action) {
  if (!TURN[action]) throw new BrainError('USAGE', `A to-do is marked done, reopen or drop, not "${action}".`, '');
  return changeTodo(brain, id, action, (item) => { item.status = TURN[action]; item.done_at = action === 'done' ? stamp() : ''; });
}

function editTodo(brain, id, fields = {}) {
  if (fields.text === undefined && fields.due === undefined && fields.project === undefined && fields.body === undefined && fields.by === undefined && fields.plan === undefined) throw new BrainError('USAGE', 'Nothing to change.', 'cogby todo edit <id> [--text "…"] [--due YYYY-MM-DD|none] [--project NAME|none] [--body "…"|none] [--by cogby|me] [--plan "…"|none]');
  return changeTodo(brain, id, 'edit', (item) => {
    if (fields.text !== undefined) { const text = line(fields.text, TEXT_MAX); if (!text) throw new BrainError('NO_TEXT', 'A to-do needs words.', ''); item.text = text; }
    if (fields.due !== undefined) item.due = day(fields.due);
    if (fields.project !== undefined) item.project = fields.project === 'none' ? '' : projectName(fields.project);
    if (fields.body !== undefined) { const body = details(fields.body); if (body) item.body = body; else delete item.body; }
    if (fields.by !== undefined) { if (whose(fields.by)) item.by = 'cogby'; else delete item.by; }
    if (fields.plan !== undefined) { const plan = details(fields.plan); if (plan) item.plan = plan; else delete item.plan; }
  });
}

// Open first, by date (the undated last), then what was finished.
const order = (a, b) => (a.status === 'open' ? 0 : 1) - (b.status === 'open' ? 0 : 1)
  || (a.due || '9999').localeCompare(b.due || '9999') || a.created.localeCompare(b.created);

// `unreadable` ({ file, why }) is on a list only when the store could not be read: the list is then
// empty because nothing could be shown, not because there is nothing.
function listTodos(brain, options = {}) {
  const store = read(brain, 'todo');
  const todos = store.items.map(shownTodo).filter((item) => options.all || item.status === 'open').sort(order);
  return { todos, all: !!options.all, ...(store.unreadable ? { unreadable: store.unreadable } : {}) };
}

// The list as text a person can read or paste: a markdown checklist.
function todosText(todos) {
  if (!todos.length) return 'No to-dos.';
  return todos.map((item) => `- [${item.status === 'open' ? ' ' : item.status === 'done' ? 'x' : '-'}] ${item.text}${item.project ? ` (${item.project})` : ''}${item.due ? ` · due ${item.due}` : ''}${item.status === 'dropped' ? ' · dropped' : ''}  \`${item.id}\``).join('\n');
}

const shownNote = (item) => ({
  id: item.id, text: item.text || '', body: item.body || '', created: item.created || '', status: NOTE_STATUSES.includes(item.status) ? item.status : 'open',
  source: item.source || '', project: item.project || '',
});

function addNote(brain, fields = {}) {
  const text = line(fields.text, NOTE_MAX);
  if (!text) throw new BrainError('NO_TEXT', 'A note needs words.', 'cogby note add "…"');
  const done = change(brain, 'note', (items) => {
    const item = { id: newId('note'), text, body: String(fields.body == null ? '' : fields.body).replace(/\r\n?/g, '\n').trim().slice(0, BODY_MAX), created: stamp(), status: 'open', source: line(fields.source, 60) || 'session', project: projectName(fields.project) };
    // Newest first, as the Console kept them.
    items.unshift(item);
    return { item, message: subject('note', text) };
  });
  return { note: shownNote(done.item), commit: done.commit };
}

function setNote(brain, id, action) {
  const status = { dismiss: 'dismissed', reopen: 'open' }[action];
  if (!status) throw new BrainError('USAGE', `A note is dismissed or reopened, not "${action}".`, '');
  const done = change(brain, 'note', (items) => {
    const item = findIn(items, id, 'note');
    item.status = status;
    return { item, message: subject(`note ${action}`, item.text) };
  });
  return { note: shownNote(done.item), commit: done.commit };
}

function listNotes(brain, options = {}) {
  const store = read(brain, 'note');
  const notes = store.items.map(shownNote).filter((item) => (options.all ? item.status !== 'deleted' : item.status === 'open'))
    .sort((a, b) => b.created.localeCompare(a.created));
  return { notes, all: !!options.all, ...(store.unreadable ? { unreadable: store.unreadable } : {}) };
}

// What the command center page needs: every open to-do, what was ticked today, and the newest notes.
const NOTES_ON_PAGE = 30;
function forView(brain, now = new Date()) {
  const today = localDay(now);
  const store = read(brain, 'todo');
  const noteList = listNotes(brain);
  const todos = store.items.map(shownTodo)
    .filter((item) => item.status === 'open' || (item.status === 'done' && item.done_at.slice(0, 10) === today)).sort(order);
  const open = todos.filter((item) => item.status === 'open');
  return {
    today,
    todos: { items: todos, open: open.length, due: open.filter((item) => item.due && item.due <= today).length, ...(store.unreadable ? { unreadable: store.unreadable } : {}) },
    ...(noteList.unreadable ? { notes_unreadable: noteList.unreadable } : {}),
    notes: noteList.notes.slice(0, NOTES_ON_PAGE).map((item) => ({ id: item.id, text: item.text, body: item.body, created: item.created, project: item.project })),
  };
}

module.exports = { projectName, addTodo, setTodo, editTodo, listTodos, todosText, addNote, setNote, listNotes, forView, storeFile, TODO_STATUSES, NOTE_STATUSES };
