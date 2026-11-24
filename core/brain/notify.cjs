'use strict';

// `cogby notify`: what Cogby leaves for its owner, kept in the brain.
//
// One file, <brain>/.cogby/notifications/store.json, in the shape the Console's Inbox reads
// ({ version, updated, items[] }, the same field names), so a brain that later gets a Console or a
// hosted server shows the same notifications with nothing to convert. This is the brain's own small
// writer: no push channel, no Telegram, no task. It adds, lists and changes a status; it never
// deletes, and a dismissed entry stays in the file. Like the to-dos and the notes, the file is not
// ignored: it travels with the brain, and every write to it ends in a commit of that one file,
// behind the lock page writes take (see core/brain/todo.cjs for the whole of it). Nothing here pushes.
//
// Who writes here: the automatic wrap-up, the nightly pass and sync, when they leave something for
// the owner or did something without asking, and a session when the owner says "flag this for me".
// The command center page shows the unread ones and what was done unattended.

const fs = require('fs');
const path = require('path');
const { BrainError, ensureIgnored } = require('./db.cjs');
const { oneLine } = require('./page.cjs');

const STORE = ['.cogby', 'notifications', 'store.json'];
// unread: waits for the owner. read: seen, or answered. dismissed: cleared. acted: something Cogby
// did without asking, kept so the owner can see it and undo it.
const STATUSES = Object.freeze(['unread', 'read', 'dismissed', 'acted']);
const PRIORITIES = Object.freeze(['normal', 'high']);
const TITLE_MAX = 140;
const TEXT_MAX = 2000;
const OPTIONS_MAX = 6;
const ACTED_DAYS = 7;

const storeFile = (brain) => path.join(brain, ...STORE);
const pad = (n) => String(n).padStart(2, '0');
// Local time, as the Inbox writes it: "YYYY-MM-DD HH:MM:SS".
const stamp = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
const newId = () => `ntf-${Date.now()}-${Math.floor(Math.random() * 0x10000).toString(16).padStart(4, '0')}`;
const text = (value, max = TEXT_MAX) => String(value == null ? '' : value).replace(/\r\n?/g, '\n').trim().slice(0, max);
const line = (value, max = TITLE_MAX) => oneLine(String(value == null ? '' : value)).slice(0, max);

// A store that is not there yet is empty. One that is there and cannot be read (not JSON, no
// `items` list) is not empty: taking it for empty lets the next write replace everything in it. So
// `read` says so (`unreadable`: the file and why), a list shows nothing and passes that on, and a
// write goes through `load`, which refuses, names the file and leaves it exactly as it is.
function read(brain) {
  const file = storeFile(brain);
  const unreadable = (why) => ({ version: 1, updated: '', items: [], unreadable: { file, why } });
  let raw;
  try { raw = fs.readFileSync(file, 'utf8'); } catch (error) { return error.code === 'ENOENT' ? { version: 1, updated: '', items: [], unreadable: null } : unreadable(error.message); }
  let parsed;
  try { parsed = JSON.parse(raw.replace(/^\uFEFF/, '')); } catch (error) { return unreadable(`it is not JSON: ${error.message}`); }
  if (!parsed || !Array.isArray(parsed.items)) return unreadable('it has no "items" list');
  const items = parsed.items.filter((item) => item && typeof item === 'object' && typeof item.id === 'string');
  return { version: 1, updated: typeof parsed.updated === 'string' ? parsed.updated : '', items, unreadable: null };
}

function load(brain) {
  const store = read(brain);
  if (store.unreadable) {
    throw new BrainError('STORE_UNREADABLE', `The notification store cannot be read, so nothing was written: ${store.unreadable.file} (${store.unreadable.why}).`,
      'The file is left as it is. Repair it, or move it aside to start an empty one.');
  }
  return store;
}

// The file replaced whole, then committed alone. A brain made when the store was still ignored
// stops ignoring it here. Returns the commit: { committed, sha } or { committed: false, why }.
function write(brain, store, message) {
  const file = storeFile(brain);
  ensureIgnored(brain);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(tmp, `${JSON.stringify({ version: 1, updated: stamp(), items: store.items }, null, 2)}\n`);
    fs.renameSync(tmp, file);
  } catch (error) { try { fs.rmSync(tmp, { force: true }); } catch { /* nothing left behind */ } throw error; }
  return require('./write.cjs').commitFile(brain, STORE.join('/'), message);
}

// One write, whole or not at all: read, change, save and commit behind the brain's write lock.
// `work(store)` refuses by throwing, before anything is written.
const locked = (brain, work) => require('./write.cjs').withLock(brain, () => work(load(brain)));
const subject = (what, title) => `${what}: ${String(title || '').slice(0, 72)}`;

function find(store, id) {
  const item = store.items.find((entry) => entry.id === id);
  if (!item) throw new BrainError('NO_NOTIFICATION', `No notification with id ${id}.`, 'List them with `cogby notify list --all`.');
  return item;
}

// What the page and a person read: the stored entry plus its age in whole days.
function shown(item, now = new Date()) {
  const created = new Date(String(item.created || '').replace(' ', 'T'));
  const days = Number.isNaN(created.getTime()) ? null : Math.max(0, Math.floor((now - created) / 86400000));
  return {
    id: item.id, created: item.created || '', status: item.status, priority: item.priority === 'high' ? 'high' : 'normal',
    title: item.title || '', body: item.body || '', source: item.source || '', context: item.context || '',
    options: Array.isArray(item.options) ? item.options : [], recommend: item.recommend || '', if_ignored: item.if_ignored || '',
    answer: item.answer || '', snoozed: Number.isInteger(item.snoozed) ? item.snoozed : 0,
    reason: item.reason || '', undo: item.undo || '', comments: Array.isArray(item.comments) ? item.comments : [], days_old: days,
  };
}

function add(brain, fields = {}) {
  const title = line(fields.title);
  if (!title) throw new BrainError('NO_TITLE', 'A notification needs a title: one sentence the owner can act on.', 'cogby notify add --title "…"');
  const status = fields.status === undefined ? 'unread' : String(fields.status);
  if (status !== 'unread' && status !== 'acted') throw new BrainError('BAD_STATUS', `A notification is added as unread, or as acted for something done without asking; not "${status}".`, 'Use `cogby notify read|dismiss <id>` to change one.');
  const priority = fields.priority === undefined ? 'normal' : String(fields.priority);
  if (!PRIORITIES.includes(priority)) throw new BrainError('BAD_PRIORITY', `Priority is normal or high, not "${priority}".`, '');
  const options = (Array.isArray(fields.options) ? fields.options : []).map((option) => line(option, 80)).filter(Boolean).slice(0, OPTIONS_MAX);
  const recommend = line(fields.recommend, 80);
  if (recommend && !options.includes(recommend)) throw new BrainError('BAD_RECOMMEND', `The recommended answer "${recommend}" is not one of the options.`, 'Pass it as an --option too.');
  const source = line(fields.source, 60) || 'manual';
  const context = line(fields.context, 200);

  return locked(brain, (store) => {
    const record = {
      title, body: text(fields.body), source, context, priority, status, type: 'info',
      ...(options.length ? { options, recommend } : {}),
      ...(fields.ifIgnored ? { if_ignored: line(fields.ifIgnored, 200) } : {}),
      ...(fields.reason ? { reason: line(fields.reason, 200) } : {}),
      ...(fields.undo ? { undo: line(fields.undo, 200) } : {}),
    };
    // The same source and context is the same matter: one entry refreshed, never a second one. It is
    // what keeps a wrap-up per session from filling the list. Only an entry still waiting is reused.
    const open = context ? store.items.find((item) => item.status === 'unread' && item.source === source && item.context === context && status === 'unread') : null;
    if (open) {
      Object.assign(open, record, { updated: stamp() });
      const commit = write(brain, store, subject('notify refresh', title));
      return { notification: shown(open), refreshed: true, commit };
    }
    const item = { id: newId(), created: stamp(), ...record };
    store.items.push(item);
    const commit = write(brain, store, subject(status === 'acted' ? 'notify acted' : 'notify', title));
    return { notification: shown(item), refreshed: false, commit };
  });
}

function change(brain, id, what, how) {
  return locked(brain, (store) => {
    const item = find(store, id);
    how(item);
    item.updated = stamp();
    const commit = write(brain, store, subject(`notify ${what}`, item.title));
    return { notification: shown(item), commit };
  });
}

const setStatus = (brain, id, status) => change(brain, id, status, (item) => { item.status = status; });
// "Later" is an answer too, and a counted one: the entry stays unread and says how often it was put off.
// A dismissed entry is refused: the owner cleared it, and a "later" sent before that (from the command
// center, applied late or twice) must not bring it back.
const later = (brain, id) => change(brain, id, 'later', (item) => {
  if (item.status === 'dismissed') throw new BrainError('DISMISSED', `Notification ${id} was dismissed, so it cannot be put off.`, 'A dismissed notification stays cleared. If it needs the owner again, add a new one.');
  item.snoozed = (Number.isInteger(item.snoozed) ? item.snoozed : 0) + 1;
  item.status = 'unread';
});

function answer(brain, id, option) {
  const chosen = line(option, 80);
  return change(brain, id, 'answer', (item) => {
    const options = Array.isArray(item.options) ? item.options : [];
    if (!options.length) throw new BrainError('NO_QUESTION', 'This notification asks no question, so it has no answer to give.', 'Mark it read or dismiss it.');
    if (!options.includes(chosen)) throw new BrainError('BAD_ANSWER', `"${chosen}" is not one of this notification's answers.`, `Its answers: ${options.join(' | ')}`);
    item.answer = chosen;
    item.status = 'read';
  });
}

// The owner's words on an entry, kept with who said them and where.
function comment(brain, id, words, by = {}) {
  const said = text(words, 1000);
  if (!said) throw new BrainError('NO_COMMENT', 'A comment needs words.', '');
  return change(brain, id, 'comment', (item) => {
    const comments = Array.isArray(item.comments) ? item.comments : [];
    comments.push({ at: stamp(), author: line(by.author, 60) || 'owner', source: line(by.source, 60) || 'session', text: said });
    item.comments = comments;
  });
}

function list(brain, options = {}) {
  const now = options.now ? new Date(options.now) : new Date();
  const store = read(brain);
  const items = store.items.filter((item) => STATUSES.includes(item.status) && (options.all || item.status === 'unread'));
  // `unreadable` ({ file, why }) only when the store could not be read: empty is then not "nothing waits".
  return { notifications: items.map((item) => shown(item, now)), all: !!options.all, ...(store.unreadable ? { unreadable: store.unreadable } : {}) };
}

// What the command center page needs, in the order it shows it.
function forView(brain, now = new Date()) {
  const store = read(brain);
  const all = store.items.filter((item) => STATUSES.includes(item.status)).map((item) => shown(item, now));
  const rank = (item) => (item.priority === 'high' ? 0 : 1);
  const waiting = all.filter((item) => item.status === 'unread')
    .sort((a, b) => rank(a) - rank(b) || (a.created < b.created ? -1 : a.created > b.created ? 1 : 0));
  const acted = all.filter((item) => item.status === 'acted' && item.days_old !== null && item.days_old <= ACTED_DAYS)
    .sort((a, b) => (a.created < b.created ? 1 : -1)).slice(0, 8);
  const oldest = waiting.reduce((max, item) => (item.days_old !== null && item.days_old > max ? item.days_old : max), 0);
  return { waiting, acted, count: waiting.length, oldest_days: waiting.length ? oldest : null, ...(store.unreadable ? { unreadable: store.unreadable } : {}) };
}

module.exports = { add, list, later, answer, comment, setStatus, forView, read, storeFile, STATUSES, PRIORITIES };
