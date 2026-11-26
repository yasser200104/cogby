'use strict';

// `cogby mirror`: a copy of the brain in Notion, for a person who wants to see it there. An extra,
// off until the owner turns it on (`cogby mirror on --parent <page>`).
//
// The brain stays the one home. Under one Notion page the owner chose, the mirror keeps a page for
// every project card, every area card, every page of a container area (people, organizations,
// threads), the open to-dos and the decisions. Each mirrored page opens by saying it is a copy and
// that an edit made in Notion is overwritten. Not mirrored: resources, the archive, the day log,
// meeting records, notes, notifications, routines and .cogby/self. A page whose frontmatter says
// `mirror: false` stays out. What looks like a secret is blanked before it leaves (lib/redact.cjs).
//
// Why this is code and not a skill's instructions (CLAUDE.local.md, rule 1):
//   - it reads across many pages at once (what to mirror, and which pages changed since the last push);
//   - the push happens with no model in the loop, through Notion's own CLI (`ntn`);
//   - three trust rules must hold even if a session forgets them: nothing is handed out or recorded
//     while the mirror is off; nothing is ever deleted in Notion; and the only thing that comes back
//     is a to-do ticked or added on the mirrored To-dos page.
//
// Two ways a page reaches Notion, the same plan behind both:
//   - `cogby mirror push`: Cogby runs `ntn` itself, always through `ntn api`: the one door a plain
//     `ntn login` opens (`ntn pages` asks for an integration token). Create is POST v1/pages (title
//     and parent; the new id is read from the JSON it prints). The body is PATCH v1/pages/<id>/markdown
//     with `replace_content`. The To-dos page is read back with GET v1/pages/<id>/markdown.
//   - an agent with its own Notion connection: `cogby mirror plan` lists what to write,
//     `cogby mirror page <key>` prints one page, and `cogby mirror done <key> --id <notion page>`
//     records that it was written.
//
// A section page (Projects, Areas, People) is created with a title and no body, and is never
// written again: Notion lists the pages under it by itself, and a rewrite of a page that has pages
// under it is the one edit that could remove them. `allow_deleting_content` is never sent.
//
// What Cogby remembers (which Notion page is which, and the hash of what it last wrote there) is
// machine-local, in .cogby/local.json under `mirror`, beside the index switch and the view's link.
// So a mirror is kept from one machine: a second machine does not know the first one's pages.
// Nothing here schedules anything: a session runs the push, on request or at its wrap-up.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const brainLib = require('./brain.cjs');
const page = require('./page.cjs');
const { BrainError } = brainLib;
const { CONTAINER_AREAS } = require('../lib/card-summary.cjs');
const { redact } = require('../lib/redact.cjs');

const TIMELINE = 30;
const DECISIONS = 200;
const SOURCE_CHARS = 160;
const TODO_KEY = 'todos';
const DECISIONS_KEY = 'decisions';
// Routines are pages of their own kind (what runs, on what rhythm): the owner's, and not part of the copy.
const CONTAINERS = [...CONTAINER_AREAS].filter((name) => name !== 'routines').sort();

const COPY_NOTE = '> Mirrored from Cogby. Edit it in Cogby: a change made on this page is overwritten at the next update.';
const TODO_NOTE = '> Mirrored from Cogby. Tick a to-do here, or add a new line, and Cogby picks it up at the next update. Any other edit is overwritten.';
const NO_PROJECT = 'No project';
// A line that is only a bracketed hint, as a card's template leaves them: nobody wrote it.
const HINT_RE = /^(?:[-*+]\s+)?\([^()]*\)$/;
const MARKED_RE = /^(decision|reviewed|who):/i;

const sha = (text, length = 16) => crypto.createHash('sha256').update(text).digest('hex').slice(0, length);
const capital = (name) => name.charAt(0).toUpperCase() + name.slice(1);
const clip = (text, max) => (text.length > max ? `${text.slice(0, max).replace(/\s+\S*$/, '')} …` : text);

// ---- which Notion page ------------------------------------------------------------------------

// A Notion page named by its id (with or without dashes) or by its link. Returned as a dashed id.
function notionId(value) {
  const text = String(value == null ? '' : value).trim().split(/[?#]/)[0];
  const dashed = text.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi);
  const bare = text.match(/(?<![0-9a-f])[0-9a-f]{32}(?![0-9a-f])/gi);
  const found = dashed ? dashed.at(-1).replace(/-/g, '') : bare ? bare.at(-1) : null;
  if (!found) throw new BrainError('BAD_NOTION_PAGE', `"${text}" does not name a Notion page.`, 'Pass the page\'s link, as Notion\'s "Copy link" gives it, or its id.');
  const hex = found.toLowerCase();
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

// ---- what this machine remembers --------------------------------------------------------------

function state(brain) {
  const kept = brainLib.readLocal(brain).mirror;
  const mirror = kept && typeof kept === 'object' ? kept : {};
  const pages = {};
  for (const [key, entry] of Object.entries(mirror.pages && typeof mirror.pages === 'object' ? mirror.pages : {})) {
    if (entry && typeof entry.id === 'string') pages[key] = { id: entry.id, hash: typeof entry.hash === 'string' ? entry.hash : '', at: entry.at || null };
  }
  return { on: mirror.on === true, parent: typeof mirror.parent === 'string' ? mirror.parent : null, pushed_at: mirror.pushed_at || null, pages };
}

function save(brain, next) {
  const local = brainLib.readLocal(brain);
  local.mirror = { on: !!next.on, parent: next.parent, pushed_at: next.pushed_at, pages: next.pages };
  brainLib.writeLocal(brain, local);
}

const off = () => new BrainError('MIRROR_OFF', 'The Notion mirror is off for this brain, so nothing was sent or recorded.',
  'It is the owner\'s to turn on, after hearing what leaves the computer: cogby mirror on --parent <notion page link>.');

// ---- what the mirror holds --------------------------------------------------------------------

const frontmatterOf = (row) => { try { return JSON.parse(row.frontmatter) || {}; } catch { return {}; } };
const keptOut = (row) => ['false', 'no', 'off'].includes(String(frontmatterOf(row).mirror).trim().toLowerCase());

// The current truth of a page as Notion shows it: no title line (the Notion page has the title), no
// facts table (the facts follow as a list), no template hints, no heading left with nothing under it.
function tidy(truth) {
  const lines = page.truthText(truth).split('\n');
  if (/^#\s/.test(lines[0] || '')) lines.shift();
  const kept = lines.filter((line) => !HINT_RE.test(line.trim()));
  const level = (line) => { const found = /^(#{1,6})\s/.exec(line); return found ? found[1].length : 0; };
  const out = [];
  for (let i = 0; i < kept.length; i++) {
    const here = level(kept[i]);
    if (here) {
      let next = i + 1;
      while (next < kept.length && !kept[next].trim()) next++;
      if (next >= kept.length || (level(kept[next]) && level(kept[next]) <= here)) continue;
    }
    out.push(kept[i]);
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

function pageBody(db, row, decisions) {
  const parts = [COPY_NOTE];
  const truth = tidy(row.truth);
  if (truth) parts.push(truth);

  const facts = db.prepare('SELECT claim, kind, valid_from, valid_until, source FROM facts WHERE page_id = ? AND superseded_by IS NULL AND expired_at IS NULL AND retracted_at IS NULL ORDER BY row_num').all(row.id);
  if (facts.length) {
    parts.push(['## Facts', ...facts.map((fact) => {
      const tags = [fact.kind && fact.kind !== 'fact' ? fact.kind : '', fact.valid_from ? `since ${fact.valid_from}` : '', fact.valid_until ? `until ${fact.valid_until}` : ''].filter(Boolean);
      return `- ${page.oneLine(fact.claim)}${tags.length ? ` (${tags.join(', ')})` : ''}${fact.source ? ` · source: ${clip(page.oneLine(fact.source), SOURCE_CHARS)}` : ''}`;
    })].join('\n'));
  }

  const made = decisions.filter((entry) => entry.page === row.slug);
  if (made.length) parts.push(['## Decisions', ...made.map((entry) => decisionLine(entry, false))].join('\n'));

  const lines = db.prepare('SELECT date, source, summary FROM timeline_entries WHERE page_id = ? AND retracted = 0 AND record = 0 ORDER BY date DESC, rowid DESC').all(row.id)
    .filter((line) => !MARKED_RE.test(line.summary));
  if (lines.length) {
    parts.push(['## Timeline', ...lines.slice(0, TIMELINE).map((line) => `- **${line.date}** ${page.oneLine(line.summary)}${line.source ? ` (source: ${clip(page.oneLine(line.source), SOURCE_CHARS)})` : ''}`),
      ...(lines.length > TIMELINE ? [`- ${lines.length - TIMELINE} earlier line${lines.length - TIMELINE === 1 ? '' : 's'}, kept in Cogby.`] : [])].join('\n'));
  }
  return parts.join('\n\n');
}

function decisionLine(entry, withPage) {
  const tail = [
    entry.who ? `call: ${entry.who}` : '', entry.expect ? `expects: ${entry.expect}` : '', entry.review ? `look again: ${entry.review}` : '',
    entry.outcome ? `turned out: ${entry.outcome}` : '',
  ].filter(Boolean);
  return `- **${entry.date}**${withPage ? ` (${entry.title})` : ''} ${entry.status === 'reversed' ? '~~' : ''}${page.oneLine(entry.text)}${entry.status === 'reversed' ? '~~' : ''}${tail.length ? ` · ${tail.join(' · ')}` : ''}`;
}

// Every to-do gets a short tag, shown at the end of its line in Notion, so a line ticked or reworded
// there is still known for the to-do it is. Given in the order the to-dos were made and never
// reused, so a to-do keeps its tag as others are added (nothing is ever removed from the store).
function todoTags(todos) {
  const taken = new Set();
  const tags = new Map();
  for (const item of [...todos].sort((a, b) => a.created.localeCompare(b.created) || a.id.localeCompare(b.id))) {
    const hex = sha(item.id, 12);
    let length = 5;
    while (taken.has(hex.slice(0, length)) && length < hex.length) length++;
    taken.add(hex.slice(0, length));
    tags.set(item.id, hex.slice(0, length));
  }
  return tags;
}

function todosBody(listed) {
  const tags = todoTags(listed.todos);
  const open = listed.todos.filter((item) => item.status === 'open');
  if (!open.length) return `${TODO_NOTE}\n\nNo open to-dos.`;
  const groups = new Map();
  for (const item of open) {
    const name = item.project || '';
    if (!groups.has(name)) groups.set(name, []);
    groups.get(name).push(item);
  }
  const names = [...groups.keys()].sort((a, b) => (a === '' ? -1 : b === '' ? 1 : a.localeCompare(b)));
  return [TODO_NOTE, ...names.map((name) => [`## ${name || NO_PROJECT}`,
    ...groups.get(name).map((item) => `- [ ] ${item.text}${item.due ? ` · due ${item.due}` : ''} \`${tags.get(item.id)}\``)].join('\n'))].join('\n\n');
}

function decisionsBody(all) {
  if (!all.length) return `${COPY_NOTE}\n\nNo decision is logged yet.`;
  return [COPY_NOTE, [...all.slice(0, DECISIONS).map((entry) => decisionLine(entry, true)),
    ...(all.length > DECISIONS ? [`- ${all.length - DECISIONS} earlier decisions, kept in Cogby.`] : [])].join('\n')].join('\n\n');
}

// The pages of the mirror, parents before what sits under them. Each: { key, title, parent, kind,
// markdown, hash }. `parent` is another page's key, or null for a page directly under the owner's.
function build(brain, options = {}) {
  const listed = require('./todo.cjs').listTodos(brain, { all: true });
  return brainLib.withIndex(brain, (db, stats) => {
    const decisions = require('./decisions.cjs').collect(db, { today: options.today }).filter((entry) => !entry.page.includes(':'));
    const sections = [];
    const leaves = [];
    const section = (key, title) => { if (!sections.some((doc) => doc.key === key)) sections.push({ key, title, parent: null, kind: 'section', markdown: '' }); return key; };

    for (const row of db.prepare("SELECT id, slug, path, title, type, truth, frontmatter FROM pages WHERE source_id = 'brain' ORDER BY path").all()) {
      if (!/\.(md|markdown)$/i.test(row.path) || row.type === 'routine') continue;
      const parts = row.path.split('/');
      const bucket = parts[0].toLowerCase();
      if (parts.length < 2 || parts.some((part) => part.startsWith('_') || part.startsWith('.'))) continue;
      const isCard = /^card\.(md|markdown)$/i.test(parts.at(-1));
      // An entry is a folder with a card, or a single file directly in the folder.
      const entry = (depth) => (parts.length === depth + 1 && !isCard) || (parts.length === depth + 2 && isCard);
      let parent = null;
      if (bucket === 'projects' && entry(1)) parent = ['section:projects', 'Projects'];
      else if (bucket === 'areas' && CONTAINERS.includes(parts[1].toLowerCase())) { if (entry(2)) parent = [`section:${parts[1].toLowerCase()}`, capital(parts[1].toLowerCase())]; }
      else if (bucket === 'areas' && entry(1)) parent = ['section:areas', 'Areas'];
      if (!parent || keptOut(row)) continue;
      leaves.push({ key: row.slug, title: row.title, parent: section(...parent), kind: 'page', markdown: pageBody(db, row, decisions) });
    }

    const order = ['section:projects', 'section:areas', ...CONTAINERS.map((name) => `section:${name}`)];
    sections.sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key));
    leaves.sort((a, b) => order.indexOf(a.parent) - order.indexOf(b.parent) || a.key.localeCompare(b.key));
    const docs = [
      ...sections,
      // A to-do store that cannot be read is not an empty list: the page is left as it is in Notion.
      ...(listed.unreadable ? [] : [{ key: TODO_KEY, title: 'To-dos', parent: null, kind: 'todos', markdown: todosBody(listed) }]),
      { key: DECISIONS_KEY, title: 'Decisions', parent: null, kind: 'decisions', markdown: decisionsBody(decisions) },
      ...leaves,
    ].map((doc) => { const markdown = redact(doc.markdown); return { ...doc, markdown, hash: sha(`${doc.title}\n${markdown}`) }; });
    return { docs, index: stats.index, index_as_of: stats.synced_at || null, todos_unreadable: listed.unreadable || null };
  });
}

// What a push would do to each page. A section is made once and never written again.
function actionOf(doc, kept) {
  if (!kept) return 'create';
  if (doc.kind === 'section') return 'unchanged';
  return kept.hash === doc.hash ? 'unchanged' : 'update';
}

function planned(brain, options = {}) {
  const st = state(brain);
  const built = build(brain, options);
  const docs = built.docs.map((doc) => ({ ...doc, notion_id: st.pages[doc.key] ? st.pages[doc.key].id : null, action: actionOf(doc, st.pages[doc.key]) }));
  const counts = { create: 0, update: 0, unchanged: 0 };
  for (const doc of docs) counts[doc.action]++;
  const keys = new Set(docs.map((doc) => doc.key));
  // In Notion, and no longer in the mirror: left there, named to the owner, never deleted. Not a
  // section whose last page left: it holds nothing of the brain's, and is used again if one comes back.
  const left = Object.entries(st.pages).filter(([key]) => !keys.has(key) && !key.startsWith('section:') && !(key === TODO_KEY && built.todos_unreadable)).map(([key, entry]) => ({ key, notion_id: entry.id }));
  return { st, docs, counts, left, index: built.index, index_as_of: built.index_as_of };
}

// ---- the commands -----------------------------------------------------------------------------

function plan(brain, options = {}) {
  const { st, docs, counts, left, index, index_as_of } = planned(brain, options);
  return {
    on: st.on, parent: st.parent, pushed_at: st.pushed_at, counts, left, index, index_as_of,
    pages: docs.map((doc) => ({ key: doc.key, title: doc.title, parent: doc.parent, kind: doc.kind, action: doc.action, notion_id: doc.notion_id, chars: doc.markdown.length })),
  };
}

function findDoc(docs, key) {
  const doc = docs.find((entry) => entry.key === key) || docs.find((entry) => entry.key.toLowerCase() === String(key).toLowerCase());
  if (!doc) throw new BrainError('NOT_MIRRORED', `"${key}" is not a page of the mirror.`, 'List them with `cogby mirror plan`.');
  return doc;
}

// One page as it goes to Notion. Refused while the mirror is off: nothing is handed out before the owner said yes.
function onePage(brain, key, options = {}) {
  const { st, docs } = planned(brain, options);
  if (!st.on) throw off();
  const doc = findDoc(docs, key);
  return {
    key: doc.key, title: doc.title, kind: doc.kind, action: doc.action, notion_id: doc.notion_id,
    parent: doc.parent, parent_notion_id: doc.parent ? (st.pages[doc.parent] ? st.pages[doc.parent].id : null) : st.parent, markdown: doc.markdown,
  };
}

// An agent wrote this page through its own Notion connection: remember which Notion page it is and
// what it now says. `--id none` forgets the page (trashed in Notion, say), so the next update makes
// a new one. The page is recorded as holding what the brain says now: run it right after the write.
function done(brain, key, id, options = {}) {
  const { st, docs } = planned(brain, options);
  if (!st.on) throw off();
  const doc = findDoc(docs, key);
  const forget = String(id == null ? '' : id).trim().toLowerCase() === 'none';
  if (forget) delete st.pages[doc.key];
  else st.pages[doc.key] = { id: notionId(id), hash: doc.hash, at: new Date().toISOString() };
  if (!forget) st.pushed_at = st.pages[doc.key].at;
  save(brain, st);
  const after = planned(brain, options);
  return { key: doc.key, notion_id: forget ? null : st.pages[doc.key].id, forgotten: forget, counts: after.counts };
}

// ---- Notion's own CLI -------------------------------------------------------------------------

// `ntn` on PATH, or the command COGBY_NTN names. Returns { code, out, err }; code null when it could not be started.
function runner(env = process.env) {
  const command = env.COGBY_NTN || 'ntn';
  return (args, input) => {
    const result = require('../lib/spawn.cjs').spawnSync(command, args, { input: input === undefined ? '' : input, encoding: 'utf8', env, timeout: 120000, maxBuffer: 32 * 1024 * 1024 });
    if (result.error) return { code: null, out: '', err: result.error.message };
    return { code: result.status, out: result.stdout || '', err: result.stderr || '' };
  };
}

function engine(run) {
  const result = run(['--version']);
  return result.code === 0 ? (result.out.trim().split('\n')[0] || 'ntn').trim() : null;
}

const noEngine = () => new BrainError('NO_NTN', 'Notion\'s command-line tool (`ntn`) was not found, so Cogby cannot send the pages itself.',
  'Install it and sign in once (winget install Notion.ntn, or npm install --global ntn; then ntn login), or let the session write the pages through its own Notion connection: cogby mirror plan.');
const signedOut = () => new BrainError('NTN_SIGNED_OUT', 'Notion\'s command-line tool is installed but not signed in, so nothing was sent.',
  'Sign in once (ntn login), then run the update again. Signing in is the owner\'s to do.');
const said = (result) => page.oneLine(result.err || result.out || 'no message').slice(0, 300);

// Notion-flavored Markdown: the older syntax is the default today and is refused by the next API version.
const MARKDOWN_VERSION = 'v2';

// One call to Notion's public API through `ntn api`. The body, when there is one, goes in as JSON on
// stdin. A refusal is an exit code, or an error object printed with exit 0: both are a failure here.
function api(run, args, body) {
  const result = run(['api', ...args], body === undefined ? '' : JSON.stringify(body));
  if (result.code === null) throw noEngine();
  if (result.code !== 0 && /ntn login|no token found/i.test(result.err)) throw signedOut();
  let parsed = null;
  try { parsed = JSON.parse(result.out); } catch { /* not one JSON object */ }
  const refused = !!parsed && parsed.object === 'error';
  if (result.code !== 0 || refused) throw new Error(refused ? page.oneLine(`${parsed.code || 'error'}: ${parsed.message || ''}`).slice(0, 300) : said(result));
  return { parsed, out: result.out };
}

function createPage(run, parentId, title) {
  const { parsed, out } = api(run, ['v1/pages'], { parent: { page_id: parentId }, properties: { title: { title: [{ text: { content: title } }] } } });
  let id = parsed && typeof parsed.id === 'string' ? parsed.id : null;
  if (!id) { const found = /"id"\s*:\s*"([0-9a-f-]{32,36})"/i.exec(out); if (found) id = found[1]; }
  if (!id) throw new Error(`the new page's id was not in what ntn printed: ${page.oneLine(out).slice(0, 300)}`);
  return notionId(id);
}

// Replaces the page's whole content. `allow_deleting_content` is left out, so Notion refuses a
// rewrite that would remove a page or a database under this one.
function writeBody(run, id, markdown) {
  api(run, [`v1/pages/${id}/markdown`, '-X', 'PATCH'], { type: 'replace_content', replace_content: { new_str: markdown }, markdown_version: MARKDOWN_VERSION });
}

function readBody(run, id) {
  const { parsed, out } = api(run, [`v1/pages/${id}/markdown`, '-X', 'GET', `markdown_version==${MARKDOWN_VERSION}`]);
  return parsed && typeof parsed.markdown === 'string' ? parsed.markdown : out;
}

// The update, with no model in the loop: what was ticked or added in Notion is read first, then
// every page that is new or changed is written. Each page is recorded as soon as it is written, so
// a run that stops halfway is picked up where it stopped.
function push(brain, options = {}) {
  // `ifOn`: a wrap-up asks on every brain, and on one that never turned the mirror on it gets silence:
  // no refusal to report, no word about Notion, and `ntn` is not even looked for.
  if (!state(brain).on) { if (options.ifOn) return { off: true }; throw off(); }
  const run = options.run || runner(options.env);
  const version = engine(run);
  if (!version) throw noEngine();
  const limit = options.limit === undefined ? Infinity : Number.parseInt(options.limit, 10);
  if (!(limit > 0)) throw new BrainError('USAGE', `"${options.limit}" is not a number of pages.`, 'cogby mirror push [--limit N] [--dry-run]');

  let pulled = null;
  if (state(brain).pages[TODO_KEY] && !options.dryRun) {
    try { pulled = pull(brain, { run }); } catch (error) { if (['NTN_SIGNED_OUT', 'NO_NTN'].includes(error.code)) throw error; pulled = { failed: error.message }; }
  }
  const { st, docs, counts, left } = planned(brain, options);
  const out = { engine: 'ntn', version, dry_run: !!options.dryRun, created: [], updated: [], unchanged: counts.unchanged, failed: [], remaining: 0, pulled, left };
  let written = 0;
  for (const doc of docs) {
    if (doc.action === 'unchanged') continue;
    if (written >= limit || options.dryRun) { out.remaining++; continue; }
    const parentId = doc.parent ? (st.pages[doc.parent] || {}).id : st.parent;
    if (!parentId) { out.failed.push({ key: doc.key, why: `the page above it (${doc.parent}) is not in Notion yet` }); continue; }
    try {
      let kept = st.pages[doc.key];
      if (!kept) {
        // Recorded before its body is written: a body that fails is tried again as an update, never as a second page.
        kept = st.pages[doc.key] = { id: createPage(run, parentId, doc.title), hash: '', at: new Date().toISOString() };
        save(brain, st);
      }
      if (doc.kind !== 'section') writeBody(run, kept.id, doc.markdown);
      st.pages[doc.key] = { id: kept.id, hash: doc.hash, at: new Date().toISOString() };
      st.pushed_at = st.pages[doc.key].at;
      save(brain, st);
      out[doc.action === 'create' ? 'created' : 'updated'].push(doc.key);
      written++;
    } catch (error) {
      // Not signed in, or the tool is gone: no page after this one would go through either.
      if (error instanceof BrainError) throw error;
      out.failed.push({ key: doc.key, why: error.message });
    }
  }
  return out;
}

// ---- what comes back from Notion --------------------------------------------------------------

const unescape = (text) => text.replace(/\\([\\`*_{}[\]()#+\-.!~>|])/g, '$1');

// The To-dos page as Notion gives it back. Two things are taken from it: a line Cogby wrote (it ends
// in its tag) that is now ticked, and a line Cogby did not write (no tag) that is not ticked. Nothing
// else: a reworded line, a deleted line and an unticked one change nothing in the brain. Notion gives
// the tag back in backticks or as <code>…</code>, depending on which door read the page: both are a tag.
const TAG_RE = /\s*(?:`([0-9a-f]{5,12})`|<code>([0-9a-f]{5,12})<\/code>)\s*$/i;
function readTodoPage(markdown) {
  const ticked = [];
  const added = [];
  let project = '';
  for (const raw of String(markdown).replace(/\r\n?/g, '\n').split('\n')) {
    const heading = /^#{1,6}\s+(.*)$/.exec(raw.trim());
    if (heading) { const name = unescape(heading[1]).trim(); project = name.toLowerCase() === NO_PROJECT.toLowerCase() ? '' : name; continue; }
    const box = /^\s*[-*+]\s*\[( |x|X)\]\s*(.*)$/.exec(raw);
    if (!box) continue;
    const checked = box[1] !== ' ';
    let text = box[2].trim();
    const tag = TAG_RE.exec(text);
    if (tag) { if (checked) ticked.push((tag[1] || tag[2]).toLowerCase()); continue; }
    if (checked) continue;
    // Inline marks Notion writes as tags (<b>, <code>, <span …>) are not part of the to-do's words.
    text = unescape(text.replace(/<\/?[a-z][^<>]*>/gi, ''));
    const due = /\s*·\s*due\s+(\d{4}-\d{2}-\d{2})\s*$/i.exec(text);
    if (due) text = text.slice(0, due.index);
    text = page.oneLine(text);
    if (text) added.push({ text, project, due: due ? due[1] : '' });
  }
  return { ticked, added };
}

// `data`: the page's markdown, read by a session through its own Notion connection. Without it the
// page is read through `ntn api`. A to-do ticked there is done here; a line added there is a new
// to-do here, once (a line already taken in since the page was last written is not taken twice).
function pull(brain, options = {}) {
  const st = state(brain);
  if (!st.on) throw off();
  let markdown = options.data;
  if (markdown === undefined) {
    const kept = st.pages[TODO_KEY];
    if (!kept) return { ticked: [], added: [], dry_run: !!options.dryRun, nothing: 'the To-dos page is not in Notion yet' };
    const run = options.run || runner(options.env);
    try { markdown = readBody(run, kept.id); } catch (error) {
      if (error instanceof BrainError) throw error;
      throw new BrainError('PULL_FAILED', `The To-dos page could not be read from Notion: ${error.message}`, 'If it was removed in Notion, forget it and the next update makes a new one: cogby mirror done todos --id none.');
    }
  }
  const todo = require('./todo.cjs');
  const listed = todo.listTodos(brain, { all: true });
  if (listed.unreadable) throw new BrainError('STORE_UNREADABLE', `The to-do store cannot be read, so nothing was taken from Notion: ${listed.unreadable.file} (${listed.unreadable.why}).`, 'The file is left as it is.');
  const tags = todoTags(listed.todos);
  const byTag = new Map(listed.todos.map((item) => [tags.get(item.id), item]));
  const read = readTodoPage(markdown);
  const out = { ticked: [], added: [], dry_run: !!options.dryRun };

  for (const tag of read.ticked) {
    const item = byTag.get(tag);
    if (!item || item.status !== 'open') continue;
    if (!options.dryRun) todo.setTodo(brain, item.id, 'done');
    out.ticked.push({ id: item.id, text: item.text });
  }
  // The page was last written at `since`: a line taken in after that is still on it, untagged.
  const since = st.pages[TODO_KEY] && st.pages[TODO_KEY].at ? Date.parse(st.pages[TODO_KEY].at) : 0;
  const same = (a, b) => a.trim().toLowerCase() === b.trim().toLowerCase();
  const known = listed.todos.filter((item) => item.status === 'open' || (item.source === 'notion' && Date.parse(item.created.replace(' ', 'T')) >= since - 60000));
  for (const line of read.added) {
    if (known.some((item) => same(item.text, line.text)) || out.added.some((item) => same(item.text, line.text))) continue;
    if (options.dryRun) { out.added.push({ id: null, ...line }); continue; }
    const made = todo.addTodo(brain, { text: line.text, project: line.project, due: line.due, source: 'notion' }).todo;
    out.added.push({ id: made.id, text: made.text, project: made.project, due: made.due });
  }
  return out;
}

// ---- on, off, status --------------------------------------------------------------------------

function status(brain, options = {}) {
  const { st, counts, left } = planned(brain, options);
  const run = options.run || runner(options.env);
  return { on: st.on, parent: st.parent, engine: { ntn: engine(run) }, pushed_at: st.pushed_at, in_notion: Object.keys(st.pages).length, counts, left };
}

function setOn(brain, parent, options = {}) {
  const st = state(brain);
  const next = parent !== undefined ? notionId(parent) : st.parent;
  if (!next) throw new BrainError('NO_PARENT', 'The mirror needs the Notion page it lives under.', 'cogby mirror on --parent <notion page link>');
  // Another page to live under is another mirror: what was written under the first one stays there.
  if (st.parent && st.parent !== next) st.pages = {};
  save(brain, { ...st, on: true, parent: next });
  return { ...status(brain, options), switched: 'on' };
}

// Off: nothing more is sent. What is in Notion stays, and so does what Cogby remembers of it, so
// turning it on again carries on where it stopped.
function setOff(brain, options = {}) {
  save(brain, { ...state(brain), on: false });
  return { ...status(brain, options), switched: 'off' };
}

// ---- text for people --------------------------------------------------------------------------

function text(action, result) {
  const count = (n, one, many) => `${n} ${n === 1 ? one : many || `${one}s`}`;
  const leftLines = (left) => (left && left.length ? ['Still in Notion, no longer in the mirror (never deleted by Cogby; remove them there if you want):', ...left.map((entry) => `  ${entry.key}  ${entry.notion_id}`)] : []);
  if (action === 'page') return result.markdown;
  if (action === 'done') return `${result.forgotten ? `Forgotten: ${result.key}. The next update makes a new page for it.` : `Recorded: ${result.key} is Notion page ${result.notion_id}.`} Left to write: ${result.counts.create + result.counts.update}.`;
  if (action === 'pull') {
    if (result.nothing) return `Nothing taken from Notion: ${result.nothing}.`;
    if (!result.ticked.length && !result.added.length) return 'Nothing new on the To-dos page in Notion.';
    return [`From Notion${result.dry_run ? ' (dry run, nothing written)' : ''}: ${count(result.ticked.length, 'to-do')} ticked, ${count(result.added.length, 'to-do')} added.`,
      ...result.ticked.map((item) => `  done: ${item.text}`), ...result.added.map((item) => `  new: ${item.text}${item.project ? ` (${item.project})` : ''}${item.due ? ` · due ${item.due}` : ''}`)].join('\n');
  }
  if (action === 'push') {
    if (result.off) return '';
    const lines = [result.dry_run ? `Dry run, nothing sent: ${count(result.remaining, 'page')} would be written, ${result.unchanged} already up to date.`
      : `Notion updated: ${result.created.length} created, ${result.updated.length} updated, ${result.unchanged} already up to date${result.remaining ? `, ${result.remaining} left for the next run` : ''}.`];
    if (result.pulled && result.pulled.failed) lines.push(`The To-dos page could not be read first: ${result.pulled.failed}`);
    else if (result.pulled && (result.pulled.ticked.length || result.pulled.added.length)) lines.push(text('pull', result.pulled));
    for (const entry of result.failed) lines.push(`  not written: ${entry.key} (${entry.why})`);
    return [...lines, ...leftLines(result.left)].join('\n');
  }
  if (action === 'plan') {
    const lines = [`Notion mirror: ${result.on ? 'on' : 'off'}. ${result.counts.create} to create, ${result.counts.update} to update, ${result.counts.unchanged} up to date.`];
    for (const entry of result.pages) lines.push(`  ${entry.action.padEnd(9)}  ${entry.key}  ${entry.title}`);
    return [...lines, ...leftLines(result.left)].join('\n');
  }
  const head = result.switched === 'on' ? 'Notion mirror: on.' : result.switched === 'off' ? 'Notion mirror: off. Nothing more is sent; what is in Notion stays there.' : `Notion mirror: ${result.on ? 'on' : 'off'}.`;
  return [head,
    `  Lives under Notion page: ${result.parent || 'not chosen yet (cogby mirror on --parent <notion page link>)'}`,
    `  Notion's command-line tool: ${result.engine.ntn ? `found (${result.engine.ntn}); \`cogby mirror push\` sends the pages` : 'not found; a session writes the pages through its own Notion connection (`cogby mirror plan`)'}`,
    `  Pages: ${result.in_notion} in Notion; ${result.counts.create} to create, ${result.counts.update} to update, ${result.counts.unchanged} up to date`,
    `  Last update: ${result.pushed_at ? `${result.pushed_at.slice(0, 16).replace('T', ' ')} UTC` : 'never'}`,
    ...leftLines(result.left)].join('\n');
}

// A file's text, or stdin for "-".
function readData(file, cwd) {
  try { return (file === '-' ? fs.readFileSync(0, 'utf8') : fs.readFileSync(path.resolve(cwd || process.cwd(), file), 'utf8')).replace(/^﻿/, ''); }
  catch (error) { throw new BrainError('BAD_DATA', `Could not read the page from ${file}: ${error.message}`, 'Pass the To-dos page as Notion gives it back, as a file, or "-" for stdin.'); }
}

module.exports = { notionId, state, build, plan, onePage, done, push, pull, readTodoPage, status, setOn, setOff, text, readData, runner, todoTags, tidy, TODO_KEY, DECISIONS_KEY };
