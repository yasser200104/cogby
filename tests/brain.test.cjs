'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { ROOT, sandbox, cogby, json, newBrain, hook, git } = require('./helpers.cjs');

test('init lays out a brain as its own repository and makes it the default', (t) => {
  const box = sandbox(t);
  const made = json(box, ['init', '--brain', box.brain, '--no-plugin', '--no-sources']);
  assert.equal(made.code, 0, made.err);
  assert.equal(made.data.created, true);
  assert.equal(made.data.default, true);
  for (const entry of ['projects', 'areas', 'resources', 'archive', 'AGENTS.md', '.cogby/brain.json', '.cogby/self/SOUL.md', '.git']) {
    assert.ok(fs.existsSync(path.join(box.brain, entry)), `${entry} is missing`);
  }
  assert.match(git(box.brain, ['log', '--oneline']), /new brain/i);
});

test('the default brain is reached from any other folder', (t) => {
  const box = newBrain(t);
  const elsewhere = path.join(box.dir, 'some-repo');
  fs.mkdirSync(elsewhere);
  const found = cogby(box, ['sources'], { cwd: elsewhere });
  assert.equal(found.code, 0, found.err);
  assert.match(found.out, /brain\s+writable/);
});

test('with no brain at all, a command says how to make one', (t) => {
  const box = sandbox(t);
  const result = cogby(box, ['search', 'anything']);
  assert.equal(result.code, 1);
  assert.match(result.err, /No brain found/);
});

test('log appends a sourced timeline line, commits it, and is refused without a source', (t) => {
  const box = newBrain(t);
  const refused = cogby(box, ['log', 'projects/demo', 'Kickoff held', '--create', '--brain', box.brain]);
  assert.notEqual(refused.code, 0);
  assert.match(refused.err, /source/i);

  const logged = json(box, ['log', 'projects/demo', 'Kickoff held', '--source', 'call 2026-11-11', '--create', '--brain', box.brain]);
  assert.equal(logged.code, 0, logged.err);
  const page = cogby(box, ['get', 'projects/demo', '--brain', box.brain]).out;
  assert.match(page, /<!-- timeline -->/);
  assert.match(page, /call 2026-11-11 — Kickoff held/);
  assert.equal(git(box.brain, ['status', '--porcelain']), '', 'the write was not committed');
});

test('remember inserts, spots a duplicate, and supersedes without deleting', (t) => {
  const box = newBrain(t);
  const base = ['--brain', box.brain];
  const refused = cogby(box, ['remember', 'projects/demo', 'Budget is 10k', '--create', ...base]);
  assert.notEqual(refused.code, 0);

  const first = json(box, ['remember', 'projects/demo', 'Budget is 10k', '--source', 'email', '--create', ...base]);
  assert.equal(first.data.status, 'inserted');
  const again = json(box, ['remember', 'projects/demo', 'Budget is 10k', '--source', 'email', ...base]);
  assert.equal(again.data.status, 'duplicate');
  const replaced = json(box, ['remember', 'projects/demo', 'Budget is 12k', '--source', 'call', '--replaces', '1', ...base]);
  assert.equal(replaced.data.status, 'superseded');

  const page = cogby(box, ['get', 'projects/demo', ...base]).out;
  assert.match(page, /Budget is 10k/, 'the replaced fact must stay on the page');
  assert.match(page, /Budget is 12k/);
  assert.match(page, /superseded/);
});

test('one page is "1 page" and one project "1 project", where a session and the owner read the count', (t) => {
  const box = newBrain(t);
  const base = ['--brain', box.brain];
  assert.equal(cogby(box, ['log', 'projects/acme/card', 'Kickoff held', '--source', 'call', '--create', ...base]).code, 0);
  assert.match(cogby(box, ['context', ...base]).out, /\(1 page; sources:/);
  assert.match(cogby(box, ['view', ...base]).out, / · 1 page · 1 project · index /);
  // From another folder, the two-line form says it the same way.
  const elsewhere = path.join(box.dir, 'elsewhere');
  fs.mkdirSync(elsewhere);
  assert.match(hook(box, 'brain-context', { source: 'startup' }, { cwd: elsewhere }).out, /\(1 page\)\. Look there first/);
  assert.equal(cogby(box, ['log', 'areas/health/card', 'Started running', '--source', 'chat', '--create', ...base]).code, 0);
  assert.match(cogby(box, ['context', ...base]).out, /\(2 pages; sources:/);
});

test('search finds a passage, stems words, and ranks a title match', (t) => {
  const box = newBrain(t);
  const base = ['--brain', box.brain];
  cogby(box, ['log', 'projects/acme', 'Two sandboxes were refreshed', '--source', 'standup', '--create', ...base]);
  cogby(box, ['log', 'projects/website', 'Homepage copy approved', '--source', 'email', '--create', ...base]);

  const stemmed = json(box, ['search', 'sandbox', ...base]);
  assert.equal(stemmed.data.results[0].slug, 'projects/acme');
  const title = json(box, ['search', 'acme', ...base]);
  assert.match(title.data.results[0].match, /title/);
  const nothing = json(box, ['search', 'zebra', ...base]);
  assert.equal(nothing.data.results.length, 0);
});

// A file edited by hand, and how it reaches a search: tests/index.test.cjs.

test('a mounted folder is searched where it is and never written to', (t) => {
  const box = newBrain(t);
  const notes = path.join(box.dir, 'old-notes');
  fs.mkdirSync(notes);
  fs.writeFileSync(path.join(notes, 'recipes.md'), '# Recipes\n\nHarira needs chickpeas.\n');
  const before = fs.readdirSync(notes).join();
  assert.equal(cogby(box, ['sources', 'add', notes, '--id', 'notes', '--brain', box.brain]).code, 0);
  const found = json(box, ['search', 'chickpeas', '--brain', box.brain]);
  assert.equal(found.data.results.length, 1);
  assert.equal(fs.readdirSync(notes).join(), before);
});

test('to-dos, notes and notifications are kept, never deleted', (t) => {
  const box = newBrain(t);
  const base = ['--brain', box.brain];
  const todo = json(box, ['todo', 'add', 'Send proposal', '--due', '2026-11-15', '--project', 'demo', ...base]).data.todo;
  assert.equal(todo.status, 'open');
  cogby(box, ['todo', 'drop', todo.id, ...base]);
  assert.equal(json(box, ['todo', ...base]).data.todos.length, 0);
  assert.equal(json(box, ['todo', '--all', ...base]).data.todos[0].status, 'dropped');

  assert.equal(json(box, ['note', 'add', 'An idea', ...base]).code, 0);
  assert.equal(json(box, ['note', ...base]).data.notes.length, 1);

  const ask = ['notify', 'add', '--source', 'wrap-up', '--context', 'demo · scope'];
  const first = json(box, [...ask, '--title', 'Approve the scope?', '--option', 'yes', '--option', 'no', '--recommend', 'yes', ...base]).data.notification;
  const same = json(box, [...ask, '--title', 'Approve the new scope?', ...base]).data.notification;
  assert.equal(same.id, first.id, 'the same source and context must refresh the one waiting');
  cogby(box, ['notify', 'dismiss', first.id, ...base]);
  assert.equal(json(box, ['notify', ...base]).data.notifications.length, 0);
  assert.equal(json(box, ['notify', '--all', ...base]).data.notifications.length, 1);
});

test('the command center page is built from the brain', (t) => {
  const box = newBrain(t);
  const base = ['--brain', box.brain];
  cogby(box, ['log', 'projects/demo', 'Kickoff held', '--source', 'call', '--create', ...base]);
  cogby(box, ['todo', 'add', 'Send proposal', ...base]);
  cogby(box, ['note', 'add', 'Harbor wants SSO first', '--body', 'Check with Karim.\nThen quote both phases.', ...base]);
  const built = json(box, ['view', '--html', ...base]);
  assert.equal(built.code, 0, built.err);
  const html = fs.readFileSync(built.data.file, 'utf8');
  assert.match(html, /Send proposal/);
  assert.match(html, /Demo/);
  // A note opens on the page, with the longer text kept with it.
  const data = JSON.parse(/<script type="application\/json" id="cogby-data">([\s\S]*?)<\/script>/.exec(html)[1]);
  assert.equal(data.notes[0].body, 'Check with Karim.\nThen quote both phases.', 'a note carries its longer text, lines and all');
  assert.match(html, /function drawNote\(\)/, 'a note opens in a panel over the page');
  // A to-do opens too, with its details, the day it was added and where it came from.
  const todo = data.todos.find((item) => item.text === 'Send proposal');
  assert.deepEqual([todo.body, todo.source, /^\d{4}-\d{2}-\d{2}$/.test(todo.added)], ['', 'session', true]);
  assert.match(html, /function drawTask\(\)/, 'a to-do opens in a panel over the page');
});

test('the Brain tab lists the sources, the owner\'s own apart from the built-in ones, and the published page carries no local path', (t) => {
  const box = newBrain(t);
  const base = ['--brain', box.brain];
  const notes = path.join(box.dir, 'Meeting notes');
  fs.mkdirSync(notes);
  fs.writeFileSync(path.join(notes, 'call.md'), '# Call\n');
  assert.equal(cogby(box, ['sources', 'add', notes, '--id', 'notes', ...base], { env: { COGBY_NO_SOURCES: '' } }).code, 0);

  const built = json(box, ['view', '--html', ...base]);
  assert.equal(built.code, 0, built.err);
  const data = (file) => JSON.parse(/<script type="application\/json" id="cogby-data">([\s\S]*?)<\/script>/.exec(fs.readFileSync(file, 'utf8'))[1]);
  const published = data(built.data.publish);
  const local = data(built.data.file);

  // The folders on disk are no longer drawn: nothing walks the brain for them.
  assert.equal(published.layout, undefined);
  const mounted = published.sources.find((source) => source.id === 'notes');
  assert.equal(mounted.name, 'Meeting notes');
  assert.equal(mounted.builtin, false, 'a folder the owner mounted is theirs');
  assert.deepEqual(published.sources.filter((source) => source.builtin).map((source) => source.id).sort(), ['brain', 'log'], 'the brain and its day log are built in');
  assert.ok(published.sources.every((source) => source.path === ''), 'no path on the published page');
  assert.ok(!fs.readFileSync(built.data.publish, 'utf8').includes(JSON.stringify(box.dir).slice(1, -1)), 'the machine\'s folders are nowhere in the published page');
  assert.equal(local.sources.find((source) => source.id === 'notes').path, notes, 'the copy on disk keeps the path');

  const html = fs.readFileSync(built.data.publish, 'utf8');
  // No Send bar: each choice is written to the page's store as a send of its own when it is pressed.
  assert.doesNotMatch(html, /Send my answers|id="tray"/);
  assert.match(html, /db\.collection\('sends'\)\.add\(doc\)/);
  assert.match(html, /<button class="btn small" id="copy" type="button" hidden>Copy my answers<\/button>/, 'a file opened from disk offers Copy at the top');
  assert.doesNotMatch(html, /suggested: true/, 'Cogby\'s suggested answer is never chosen for the owner');
  assert.doesNotMatch(html, /(Send to|Copy for) Cogby/);
  // What the owner's review took off the page.
  for (const gone of ['Copy resume line', 'Moving this week', 'Gone quiet', 'Your folders', 'days old', 'id="foot"', 'No calendar was connected']) {
    assert.ok(!html.includes(gone), `the page still has "${gone}"`);
  }
});

test('the command center\'s "Needs you" gets the routines that are due; the page never shows what is unconfirmed, and each line has a Fix', (t) => {
  const box = newBrain(t);
  const base = ['--brain', box.brain];
  assert.equal(cogby(box, ['routines', 'add', 'Weekly review', '--run', 'check-in, weekly', '--rhythm', 'weekly on friday', '--date', '2020-01-06', ...base]).code, 0);
  assert.equal(cogby(box, ['routines', 'ran', 'weekly-review', '--source', 's', '--result', 'r', '--date', '2020-01-10', ...base]).code, 0);
  // One line a person wrote, one an agent wrote (inside a Claude session), which stays unconfirmed.
  assert.equal(cogby(box, ['log', 'projects/demo', 'Kickoff held', '--source', 'call with Sara', '--create', ...base]).code, 0);
  assert.equal(cogby(box, ['log', 'projects/demo', 'Scope drafted', '--source', 'session notes', ...base], { env: { CLAUDECODE: '1' } }).code, 0);

  const built = json(box, ['view', '--html', ...base]);
  assert.equal(built.code, 0, built.err);
  const data = JSON.parse(/<script type="application\/json" id="cogby-data">([\s\S]*?)<\/script>/.exec(fs.readFileSync(built.data.publish, 'utf8'))[1]);

  assert.deepEqual(data.routines, [{ title: 'Weekly review', rhythm: 'weekly on friday', state: 'overdue', days_overdue: data.routines[0].days_overdue }], 'only what the row shows');
  assert.ok(data.routines[0].days_overdue > 0);
  assert.equal(data.counts.unconfirmed, 1);
  const line = (list, words) => list.find((entry) => entry.summary === words);
  assert.deepEqual([line(data.recent, 'Scope drafted').confirmed, line(data.recent, 'Scope drafted').actor, line(data.recent, 'Scope drafted').source], [false, 'agent', 'session notes']);
  assert.equal(line(data.recent, 'Kickoff held').confirmed, true);
  const demo = data.projects.find((project) => project.name === 'demo');
  assert.equal(line(demo.timeline, 'Scope drafted').confirmed, false, 'a project\'s timeline marks it too');
  assert.equal(line(demo.timeline, 'Kickoff held').confirmed, true);
  // The data still says it; the page does not draw it (owner, 2026-11-18): nobody confirms lines one by one.
  const html = fs.readFileSync(require('../core/brain/center.cjs').TEMPLATE, 'utf8');
  assert.doesNotMatch(html, /unconfirmed|wait for your confirmation/i, 'the page draws nothing about confirming');
  assert.match(html, /commentable\('line', page, entry\.summary, \{ fix: true/, 'each line on a timeline has a Fix');
  assert.doesNotMatch(html, /not applied yet|not in your brain yet/, 'what left the page says "sent", with the when in its tooltip');
});

test('a meeting\'s start and end are read for the day\'s calendar, from start/end or from the time as shown', () => {
  const { span, meeting } = require('../core/brain/center.cjs');
  const at = (h, m = 0) => h * 60 + m;
  assert.deepEqual(span({ time: '11:00 – 11:45' }), { start: at(11), end: at(11, 45) });
  assert.deepEqual(span({ time: '9:30am - 10:15am' }), { start: at(9, 30), end: at(10, 15) });
  assert.deepEqual(span({ time: '2pm-3:30pm' }), { start: at(14), end: at(15, 30) });
  assert.deepEqual(span({ time: '9 – 10am' }), { start: at(9), end: at(10) }, 'a bare hour takes the half of the day beside it');
  assert.deepEqual(span({ time: '11:00 – 1:00 PM' }), { start: at(11), end: at(13) });
  assert.deepEqual(span({ time: '14h30 - 16h' }), { start: at(14, 30), end: at(16) });
  assert.deepEqual(span({ time: '16:00' }), { start: at(16), end: at(16, 30) }, 'no end: half an hour');
  assert.deepEqual(span({ time: 'All day' }), { start: null, end: null }, 'no time it can read: listed apart');
  assert.deepEqual(span({ time: 'ignored', start: '08:15', end: '09:00' }), { start: at(8, 15), end: at(9) }, 'start and end win over the time line');
  const iso = new Date(2026, 10, 18, 13, 5);
  assert.deepEqual(span({ start: iso.toISOString(), end: new Date(2026, 10, 18, 14, 0).toISOString() }), { start: at(13, 5), end: at(14) }, 'an ISO time is read in this machine\'s time zone');
  const one = meeting({ id: 'e1', title: 'Weekly call', time: '10:00 – 10:30', people: ['Sara', 'Tom'] }, []);
  assert.equal(one.people, 'Sara, Tom', 'a list of attendees becomes one line the card splits');
  assert.equal(one.start, at(10));
});

test('a project dashboard is a page of its own, linked from the command center once it is published', (t) => {
  const box = newBrain(t);
  const base = ['--brain', box.brain];
  cogby(box, ['log', 'projects/harbor', 'Kickoff held', '--source', 'call', '--create', ...base]);
  const data = (file) => JSON.parse(/<script type="application\/json" id="cogby-data">([\s\S]*?)<\/script>/.exec(fs.readFileSync(file, 'utf8'))[1]);

  const before = json(box, ['view', '--html', ...base]);
  assert.equal(data(before.data.publish).projects[0].dashboard, '', 'no dashboard until one is made');

  const own = json(box, ['view', '--html', '--project', 'harbor', ...base]);
  assert.equal(own.code, 0, own.err);
  assert.match(own.data.file, /dashboard-harbor\.html$/);
  assert.deepEqual(own.data.capabilities, {}, 'a project dashboard keeps no store');
  assert.equal(data(own.data.publish).only, 'harbor');
  assert.match(fs.readFileSync(own.data.publish, 'utf8'), /^<title>Harbor dashboard<\/title>/);
  assert.notEqual(json(box, ['view', '--html', '--project', 'nope', ...base]).code, 0, 'an unknown project is refused');

  const link = 'https://claude.ai/artifact/example';
  assert.equal(cogby(box, ['view', '--artifact', link, '--project', 'harbor', ...base]).code, 0);
  const after = json(box, ['view', '--html', ...base]);
  assert.equal(data(after.data.publish).projects[0].dashboard, link);
  assert.equal(after.data.artifact, null, 'the command center\'s own link is a different one');

  const html = fs.readFileSync(after.data.publish, 'utf8');
  assert.match(html, /views\.notes = views\.todos;/, 'notes share one tab with the to-dos, and their old address still works');
  assert.match(html, /\['todos', 'Tasks & notes', /, 'the tabs are Today, Tasks & notes, Projects and Brain');
  // No page Cogby builds asks the network for anything: no font, no stylesheet, no script, no image.
  for (const file of [after.data.publish, after.data.file, own.data.publish, own.data.file]) {
    assert.doesNotMatch(fs.readFileSync(file, 'utf8'), /<link\b|@import|@font-face|fonts\.googleapis|fonts\.gstatic|<script[^>]*\bsrc=|<img\b|url\(\s*['"]?https?:/i, `${path.basename(file)} loads something`);
  }
  assert.doesNotMatch(html, /prefers-color-scheme: dark|data-theme="dark"/, 'the page is light in every theme');
});

test('the Projects tab lists projects as the old Console did: status and parent from the card, the files in its folder', (t) => {
  const box = newBrain(t);
  const base = ['--brain', box.brain];
  cogby(box, ['log', 'projects/harbor/card', 'Kickoff held', '--source', 'call', '--create', ...base]);
  const card = path.join(box.brain, 'projects', 'harbor', 'card.md');
  fs.writeFileSync(card, fs.readFileSync(card, 'utf8').replace(/^---\r?\n/, '---\nstatus: On hold\nparent: projects/platform\n'));
  fs.mkdirSync(path.join(box.brain, 'projects', 'harbor', 'output'), { recursive: true });
  fs.writeFileSync(path.join(box.brain, 'projects', 'harbor', 'output', 'quote.md'), '# Quote\n');
  assert.equal(cogby(box, ['sync', ...base]).code, 0, 'the hand edit reaches the index');
  const built = json(box, ['view', '--html', ...base]);
  assert.equal(built.code, 0, built.err);
  const html = fs.readFileSync(built.data.publish, 'utf8');
  const listed = JSON.parse(/<script type="application\/json" id="cogby-data">([\s\S]*?)<\/script>/.exec(html)[1]).projects.find((p) => p.name === 'harbor');
  assert.deepEqual([listed.status, listed.parent, listed.files.count, listed.files.items[0].path], ['on-hold', 'platform', 1, 'output/quote.md'], 'the card itself is not one of its files');
  assert.doesNotMatch(JSON.stringify(listed.files), /[A-Za-z]:[\\/]|\/Users\/|\\\\/, 'a file is named inside its folder, never where the brain sits');
  assert.match(html, /\['__open', 'Anything not done'\]/, 'the Console\'s status chips, "Anything not done" first');
  // The Tasks tab is the Console's tasks view, and Today puts today's tasks under what waits for the owner.
  assert.match(html, /function tasksBoard\(\)/);
  assert.match(html, /left\.appendChild\(needs\);\s+\/\/ 2\. Just below: today's tasks/);
});

// ---- notes and notifications travel with the brain (owner, 2026-11-13) --------------------------

const STORES = ['.cogby/todos/store.json', '.cogby/notes/store.json', '.cogby/notifications/store.json'];
const STILL_IGNORED = ['.cogby/notes/.outbox-1.txt', '.cogby/notes/.n8n-health-check-card.json', '.cogby/notifications/push-subs.json', '.cogby/local.json', '.cogby/index.db', '.cogby/self/.gateway/x.json'];
const TRAVEL_MARK = '# To-dos, notes and notifications are not ignored: they travel with the brain';
const ignored = (brain, rel) => spawnSync('git', ['-C', brain, 'check-ignore', '-q', rel]).status === 0;
const commit = (brain, message) => spawnSync('git', ['-C', brain, '-c', 'user.name=T', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', 'commit', '-q', '-am', message]);
// The .gitignore as a brain made before 2026-11-13 has it: the two stores ignored, by the starter.
function asOlderBrain(box, eol = '\n') {
  const file = path.join(box.brain, '.gitignore');
  const text = fs.readFileSync(file, 'utf8');
  assert.ok(text.includes(`${TRAVEL_MARK}\n`), 'the starter says the stores travel');
  fs.writeFileSync(file, text.replace(`${TRAVEL_MARK}\n`, '.cogby/notifications/store.json\n.cogby/notes/store.json\n').replace(/\n/g, eol));
  assert.equal(commit(box.brain, 'the .gitignore of an older Cogby').status, 0);
  return file;
}

test('a new brain does not ignore the note and notification stores, and the wrap-up scope always holds them', (t) => {
  const box = newBrain(t);
  const base = ['--brain', box.brain];
  for (const rel of STORES) assert.ok(!ignored(box.brain, rel), `${rel} is ignored in a new brain`);
  for (const rel of STILL_IGNORED) assert.ok(ignored(box.brain, rel), `${rel} is no longer ignored`);
  assert.doesNotMatch(fs.readFileSync(path.join(box.brain, '.gitignore'), 'utf8'), /^\.cogby\/(notes|notifications)\/store\.json\s*$/m);

  // Each write to a store is a commit of its own (tests/stores.test.cjs), so nothing is left over.
  assert.equal(cogby(box, ['todo', 'add', 'Send proposal', ...base]).code, 0);
  assert.equal(cogby(box, ['note', 'add', 'Sara prefers Fridays', ...base]).code, 0);
  assert.equal(cogby(box, ['notify', 'add', '--title', 'Approve the scope?', ...base]).code, 0);
  assert.equal(git(box.brain, ['status', '--porcelain', '--untracked-files=all']), '');
  assert.equal(fs.readFileSync(path.join(box.brain, '.gitignore'), 'utf8').includes('store.json'), false, 'writing a store adds no ignore rule for it');
  // A store whose commit did not go through (a hook, a lock) is left changed in the working tree,
  // written before the session opens, as a session in a linked folder would have left it.
  for (const rel of STORES) fs.appendFileSync(path.join(box.brain, ...rel.split('/')), '\n');
  assert.deepEqual(git(box.brain, ['status', '--porcelain', '--untracked-files=all']).split('\n').map((line) => line.trim().slice(2)).sort(), [...STORES].sort());

  const scopeScript = path.join(ROOT, 'core', 'ops', 'wrapup-scope.cjs');
  const scope = (session) => spawnSync(process.execPath, [scopeScript, '--session', session, '--root', box.brain], { env: box.env, cwd: box.brain, encoding: 'utf8' });
  // No baseline: the scope is unknown, and the shared stores are still named.
  const unknown = scope('never-started');
  assert.equal(unknown.status, 3);
  assert.deepEqual(unknown.stdout.trim().split('\n').sort(), [...STORES].sort());
  assert.match(unknown.stderr, /UNKNOWN, not empty[\s\S]*shared to-dos, notes, notifications and day's log: commit those too/);

  // A session opens with the stores already dirty: they are in its scope all the same, with the
  // day's log and the file it made, and not the owner's own unfinished file from before.
  fs.writeFileSync(path.join(box.brain, 'draft-of-the-owner.md'), '# Mine\n');
  hook(box, 'brain-context', { session_id: 's1', hook_event_name: 'SessionStart', source: 'startup' });
  hook(box, 'capture-log', { session_id: 's1', hook_event_name: 'Stop', last_assistant_message: 'Wrote the plan.' });
  fs.writeFileSync(path.join(box.brain, 'projects', 'plan.md'), '# Plan\n');
  const scoped = scope('s1');
  assert.equal(scoped.status, 0, scoped.stderr);
  const paths = scoped.stdout.trim().split('\n');
  for (const rel of STORES) assert.ok(paths.includes(rel), `${rel} is not in the wrap-up's scope`);
  assert.ok(paths.includes('projects/plan.md'));
  assert.ok(paths.some((rel) => /^\.cogby\/self\/log\/\d{4}-\d\d-\d\d\.md$/.test(rel)), 'the day\'s log is not in scope');
  assert.ok(!paths.includes('draft-of-the-owner.md'), 'what was dirty before the session is the owner\'s');
  // Committed, they are in the brain's history, and no longer in scope.
  assert.equal(spawnSync('git', ['-C', box.brain, 'add', '--', ...STORES]).status, 0);
  assert.equal(spawnSync('git', ['-C', box.brain, '-c', 'user.name=T', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'wrap', '--', ...STORES]).status, 0);
  assert.deepEqual(git(box.brain, ['ls-files', '--', ...STORES]).split('\n').sort(), [...STORES].sort());
  assert.ok(!scope('s1').stdout.includes('store.json'), 'a committed store is no longer in scope');
  assert.match(fs.readFileSync(path.join(ROOT, '.claude', 'skills', 'wrap-up', 'SKILL.md'), 'utf8').replace(/\r\n/g, '\n'), /the to-do, note and notification stores and the\n\s*day's log whenever they changed/);
});

test('an existing brain stops ignoring the two stores on its next run, once, and keeps every other rule', (t) => {
  const box = newBrain(t);
  const base = ['--brain', box.brain];
  const file = asOlderBrain(box);
  assert.ok(ignored(box.brain, '.cogby/notes/store.json') && ignored(box.brain, '.cogby/notifications/store.json'));
  const before = fs.readFileSync(file, 'utf8');
  const commits = Number(git(box.brain, ['rev-list', '--count', 'HEAD']));

  // The next run: a sync, which is what a session start begins in the background.
  assert.equal(cogby(box, ['sync', '--quick', ...base]).code, 0);
  for (const rel of STORES) assert.ok(!ignored(box.brain, rel), `${rel} is still ignored`);
  for (const rel of STILL_IGNORED) assert.ok(ignored(box.brain, rel), `${rel} is no longer ignored`);
  const after = fs.readFileSync(file, 'utf8');
  assert.equal(after, before.replace('.cogby/notifications/store.json\n.cogby/notes/store.json\n', `${TRAVEL_MARK}\n`), 'only the two rules changed');
  // One commit of one file, and nothing left over.
  assert.equal(Number(git(box.brain, ['rev-list', '--count', 'HEAD'])), commits + 1);
  assert.equal(git(box.brain, ['show', '--name-only', '--format=%s', 'HEAD']), 'Cogby: notes and notifications travel with the brain\n\n.gitignore');
  assert.equal(git(box.brain, ['status', '--porcelain']), '');
  // Again: nothing to do.
  assert.equal(cogby(box, ['sync', ...base]).code, 0);
  assert.equal(Number(git(box.brain, ['rev-list', '--count', 'HEAD'])), commits + 1);

  // A rule the owner puts back afterwards is theirs: it is kept.
  fs.appendFileSync(file, '.cogby/notes/store.json\n');
  assert.equal(cogby(box, ['sync', ...base]).code, 0);
  assert.equal(cogby(box, ['note', 'add', 'Kept on this machine', ...base]).code, 0);
  assert.match(fs.readFileSync(file, 'utf8'), /^\.cogby\/notes\/store\.json$/m);
  assert.ok(ignored(box.brain, '.cogby/notes/store.json'));
});

test('the two rules are taken out by the first write to a store too, around the owner\'s own edits', (t) => {
  const box = newBrain(t);
  const base = ['--brain', box.brain];
  const file = asOlderBrain(box, '\r\n');
  // The owner has an uncommitted rule of their own in the file.
  fs.appendFileSync(file, 'private-drafts/\r\n');
  const head = git(box.brain, ['rev-parse', 'HEAD']);
  assert.equal(cogby(box, ['note', 'add', 'Sara prefers Fridays', ...base]).code, 0);
  const text = fs.readFileSync(file, 'utf8');
  assert.doesNotMatch(text, /^\.cogby\/(notes|notifications)\/store\.json\r?$/m);
  assert.match(text, /^private-drafts\/\r$/m, 'the owner\'s rule is kept');
  assert.ok(!/[^\r]\n/.test(text), 'the file keeps its line endings');
  assert.ok(text.includes(`${TRAVEL_MARK}\r\n`));
  assert.ok(!ignored(box.brain, '.cogby/notes/store.json') && !ignored(box.brain, '.cogby/notifications/store.json'));
  assert.ok(ignored(box.brain, 'private-drafts/x.md') && ignored(box.brain, '.cogby/notes/.outbox-1.txt'));
  // Their edit is not committed for them: the file is left changed in the working tree. The note
  // itself is: one commit, of the store alone.
  assert.equal(git(box.brain, ['rev-parse', 'HEAD~1']), head);
  assert.equal(git(box.brain, ['show', '--name-only', '--format=', 'HEAD']), '.cogby/notes/store.json');
  const status = spawnSync('git', ['-C', box.brain, 'status', '--porcelain', '--untracked-files=all'], { encoding: 'utf8' }).stdout;
  assert.equal(status, ' M .gitignore\n');
});
