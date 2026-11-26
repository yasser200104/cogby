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

test('My view names the Cogby that made it at its foot: plugin.json\'s version, as written, in a quiet line', (t) => {
  // Since 2026-11-25: the owner could not tell which of the three copies of Cogby on their computer they were running.
  const box = newBrain(t);
  const version = JSON.parse(fs.readFileSync(path.join(ROOT, '.claude-plugin', 'plugin.json'), 'utf8')).version;
  const built = json(box, ['view', '--html', '--brain', box.brain]);
  assert.equal(built.code, 0, built.err);
  const data = (file) => JSON.parse(/<script type="application\/json" id="cogby-data">([\s\S]*?)<\/script>/.exec(fs.readFileSync(file, 'utf8'))[1]);
  assert.equal(data(built.data.file).version, version, 'the page opened from disk does not carry the version');
  assert.equal(data(built.data.publish).version, version, 'the published page does not carry the version');
  // A static line after the view, in the page's quiet small text: no mark, no frame. Not the footer the owner's
  // review of 18 Nov took off (the next test keeps it off): the version only.
  const html = fs.readFileSync(require('../core/brain/center.cjs').TEMPLATE, 'utf8');
  assert.match(html, /<main id="view"><\/main>\n  <p class="soft version" id="version" hidden><\/p>\n<\/div>/, 'the version is not one quiet line under the view');
  // It prints the string as it is: a test version stays a test version, and no version shows nothing.
  const source = /\n  function showVersion\(version\) \{[^\n]*\}/.exec(html)[0];
  const shown = { textContent: '', hidden: true };
  const run = (value) => new Function('$', `${source}\nshowVersion(${JSON.stringify(value)});`)(() => shown);
  run('0.4.0-rc1');
  assert.deepEqual(shown, { textContent: 'Cogby 0.4.0-rc1', hidden: false });
  run(version);
  assert.equal(shown.textContent, `Cogby ${version}`);
  run('');
  assert.equal(shown.hidden, true);
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
  assert.match(html, /<button class="btn small accent" id="copy" type="button" hidden>Copy prompt<\/button>/, 'every page offers one Copy prompt at the top');
  assert.doesNotMatch(html, /suggested: true/, 'Cogby\'s suggested answer is never chosen for the owner');
  assert.doesNotMatch(html, /(Send to|Copy for) Cogby/);
  // What the owner's review took off the page.
  for (const gone of ['Copy resume line', 'Moving this week', 'Gone quiet', 'Your folders', 'days old', 'id="foot"', 'This page is a snapshot', 'No calendar was connected']) {
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
  assert.doesNotMatch(html, /function timelineRows?\(|Latest in your brain|What happened last/, 'the page draws no timeline of last changes (owner, 2026-11-25)');
  assert.doesNotMatch(html, /not applied yet|not in your brain yet/, 'nothing says a press is waiting row by row');
  // No row says "sent" (owner, 2026-11-24: "it shows sent everywhere even when it does not make sense"): a
  // press shows as pressed, and the header carries Copy prompt with how many things it holds.
  assert.match(html, /function sentMark\(\) \{ return null; \}/);
  assert.doesNotMatch(html, /tag\('sent'|tag\('sending'/);
  assert.ok(html.includes('copy.dataset.label = \'Copy prompt · \' + n;'), 'the header counts what Copy prompt carries');
  // Every active routine reaches the page with its last five runs, so a routine opens on what it found.
  assert.deepEqual(data.routine_runs, [{
    title: 'Weekly review', runs: 'check-in, weekly', rhythm: 'weekly on friday', scheduled: false, scheduled_as: '', state: 'overdue', days_overdue: data.routines[0].days_overdue,
    last_date: '2020-01-10', last_result: 'r', history: [{ date: '2020-01-10', source: 's', result: 'r' }], chat: '', chat_at: '', chat_summary: '',
  }]);
});

test('a routine scheduled in Claude links to the chat its last run happened in, when a session passes it', () => {
  const { runOf } = require('../core/brain/center.cjs');
  const link = 'claude://claude.ai/epitaxy/local_28cedabc-6528-4c33-8948-6d3e3b48c8be';
  assert.deepEqual(runOf({ 'Work-Morning-Check-In': { link, at: 'Tue 08:13', summary: 'Done' } }, 'work-morning-check-in'), { link, at: 'Tue 08:13', summary: 'Done' }, 'the task is found by its name, in any case');
  assert.equal(runOf({ x: { link: 'javascript:alert(1)' } }, 'x').link, '', 'only Claude\'s own address for a chat, or a claude.ai page, is a link');
  assert.equal(runOf({ x: { link: 'claude://claude.ai/epitaxy/local_not-a-session!' } }, 'x').link, '');
  assert.equal(runOf({ x: { link } }, ''), null, 'a routine not scheduled in Claude has no run to show');
  assert.equal(runOf(null, 'x'), null);
});

test('a routine\'s result is broken into short lines on the page: one per part, a "Label: a, b, c" part into its items', () => {
  const html = fs.readFileSync(require('../core/brain/center.cjs').TEMPLATE, 'utf8');
  const grab = (name) => new RegExp(`function ${name}\\(text\\) \\{[\\s\\S]*?\\n  \\}`).exec(html)[0];
  // eslint-disable-next-line no-new-func
  const resultLines = new Function(`${grab('splitList')}\n${grab('resultLines')}\nreturn resultLines;`)();
  assert.deepEqual(resultLines('Rest of day: send the message to the leads, survey to Sam (due today, at noon), Acme 20:00; 3 overdue to-dos'), [
    { label: 'Rest of day' }, { text: 'send the message to the leads' }, { text: 'survey to Sam (due today, at noon)' }, { text: 'Acme 20:00' }, { text: '3 overdue to-dos', gap: true },
  ], 'a comma inside brackets stays in its item, and what follows the list starts a block of its own');
  assert.deepEqual(resultLines('2 stale pages named'), [{ text: '2 stale pages named', gap: false }], 'a short result stays one line');
  assert.deepEqual(resultLines('Paid 1,200 to Sara'), [{ text: 'Paid 1,200 to Sara', gap: false }], 'a comma inside a number is not a break');
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
  assert.match(html, /\[\['today', 'Inbox', needsCount\(\), true\], \['todos', 'Tasks', dueTodos\(\)\.length, true\], \['sessions', 'Sessions', sessionsIn\('working'\)\.length, false\], \['projects', 'Projects', projects\.length, false\]\]/, 'the tabs are Inbox, Tasks, Sessions and Projects (owner, 2026-11-25)');
  assert.match(html, /<a class="btn small quiet" id="mycogby" href="#\/cogby">My Cogby<\/a>/, 'routines, skills and sources are one link in the corner');
  assert.match(html, /views\.routines = views\.brain = views\.cogby; views\.inbox = views\.today;/, 'the old addresses still open the right view');
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
  fs.writeFileSync(card, fs.readFileSync(card, 'utf8').replace(/^---\r?\n/, '---\nstatus: On hold\nparent: projects/platform\n').replace('<!-- timeline -->', '## Now\n\nBuilding the import.\n\n<!-- timeline -->'));
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
  // The Tasks tab is the Console's tasks view. Today keeps the inbox, with a line under it to ask Cogby for
  // something, and today's tasks just below (owner, 2026-11-24: "I like inbox... tasks can stay where they
  // were"). The inbox has two categories: what waits for the owner, and the routines' latest results.
  assert.match(html, /function tasksBoard\(\)/);
  assert.match(html, /var inbox = section\(1, 'Inbox · ' \+ total\);/);
  // One list (owner, 2026-11-25: routines have "the same design as Inbox, just a tag to say Routine").
  assert.ok(html.includes("var rows = high.map(function (n) { return notifRow(n); }).concat(chats.map(function (x) { return sessionRow(x, { tagged: true }); }), rest.map(function (n) { return notifRow(n); }), results.map(resultRow));"), 'ranked: what is marked high, the chats that wait, the rest, then the routines\' results');
  assert.doesNotMatch(html, /ghead\('Routine results'|ghead\('Waiting for you'/, 'the inbox is one list, with no category heads');
  assert.ok(html.includes("return put(el('div', 'row notif'), put(el('div', 'line'), dot(late ? 'var(--st-needs)' : 'var(--st-scheduled)'), tag('Routine'), put(el('div', 'main'), open, meta), put(el('div', 'acts'), run, clear)));"), 'a routine result is an inbox row, tagged Routine');
  assert.ok(html.includes('inbox.appendChild(card(rows));'));
  assert.doesNotMatch(html, /Ask Cogby to do something|function askCompose/, 'the inbox has no line to ask Cogby for things (owner, 2026-11-25)');
  // Sessions: the owner's open chats by who has to act next, and one line on the inbox that opens them.
  assert.match(html, /views\.sessions = function \(view\)/);
  assert.ok(html.includes("[['needs', 'Needs you', '--st-needs'], ['working', 'Working', '--st-accent'], ['finished', 'Finished, not yet seen', '--st-running']"));
  assert.ok(html.includes("link('#/sessions', 'sstrip',"));
  // A task is handed to Cogby, or to a chat with Claude, from its own window; its notes are its details.
  assert.ok(html.includes("[['', 'Me'], ['cogby', 'Cogby']].forEach"), 'a task is assigned to me or to Cogby');
  assert.ok(html.includes("if ((d.by || '') !== (t.by || '')) c.by = d.by || 'me';"));
  assert.ok(html.includes("el('span', 'kicker', 'Cogby\\'s plan')"), 'Cogby\'s plan shows on the task');
  assert.ok(html.includes("hand = el('button', 'btn', 'Hand to Claude');"));
  assert.ok(html.includes("var top = title('Tasks'); top.style.marginBottom = '24px';"));
  assert.ok(html.includes("section(4, 'Quick notes · ' + noteList().length, 'turn one into a task, or remove it')"), 'quick notes sit under the tasks');
  assert.match(html, /left\.appendChild\(inbox\);\s+\/\/ 2\. Just below: today's tasks[^\n]*\n\s+left\.appendChild\(todayTasks\(\)\);/);
  // Clear takes a notification off at once, and leaves after a few seconds while Undo is offered.
  assert.ok(html.includes('if (away) made.hold = Date.now() + UNDO_MS;'));
  assert.ok(html.includes('if (a.sending || a.failed || (a.hold && Date.now() < a.hold)) return;'), 'nothing leaves before its Undo is over');
  assert.match(html, /var older = live\.filter\(old\);\s+var waiting = live\.filter/, 'what was cleared or put off is gone from the inbox');
  // Routines live in My Cogby, with the skills and the sources (owner, 2026-11-25): each opens on what
  // it found and the chat that ran it; a new routine, a change or Run it now goes into Copy prompt.
  assert.match(html, /views\.cogby = function \(view\)/);
  assert.ok(html.includes("section(0, 'Routines · ' + routineRuns.length, 'open one to see what it found')"));
  assert.ok(html.includes("'Skills · ' + skills.length"));
  assert.match(html, /b\.addEventListener\('click', function \(\) \{ showRoutine\(i\); \}\);/, 'a routine opens');
  assert.ok(html.includes('\'Open the chat that ran it\''), 'and links to the chat that ran it');
  assert.ok(html.includes('addRequest(\'Run my routine "\' + r.title + \'" now, then record the run in Cogby.\''), 'Run it now goes into Copy prompt');
  assert.ok(html.includes('addRequest(\'Set up a new routine for me: \' + text'), 'so does a new routine');
  // A project's page opens on where it stands (owner, 2026-11-23): Now and Next from its card, where work
  // stopped, the chats on it, its open tasks and its documents. No timeline, and no line about wrapping up.
  assert.deepEqual([listed.now, listed.next, listed.parking_spot.length, listed.timeline[0].summary], ['Building the import.', '', 1, 'Kickoff held'], 'the page has what Where it stands shows');
  assert.match(html, /var tab = ptabs\[p\.key\] \|\| 'stands';/, 'a project opens on Where it stands');
  assert.ok(html.includes("'Chats on it · ' + chatsHere.length"));
  assert.match(html, /\[\['stands', 'Where it stands'\], \['tasks', 'Tasks'\], \['docs', 'Documents'[^\]]*\], \['subs', 'Sub-projects'[^\]]*\]\]/, 'then Tasks, then Documents');
  assert.doesNotMatch(html, /Project context/);
  assert.match(html, /var LAST = 5;/);
  assert.ok(html.includes('p.now || p.next'), 'Now and Next are drawn only when one of them is written');
  assert.doesNotMatch(html, /Say "wrap up"/, 'nothing on a project tells the owner to wrap up (owner, 2026-11-25)');
});

test('a notification opens on the page and can be acted on: its answers, Copy prompt, Later, Clear, and the owner\'s own words', (t) => {
  const box = newBrain(t);
  const base = ['--brain', box.brain];
  assert.equal(cogby(box, ['log', 'projects/harbor/card', 'Kickoff held', '--source', 'call', '--create', ...base]).code, 0);
  // One that asks a question, about a project and a thread of it; one with one thing to go ahead with.
  const asked = json(box, ['notify', 'add', '--title', 'Approve the scope?', '--context', 'harbor · scope', '--option', 'yes', '--option', 'no', '--recommend', 'yes', '--if-ignored', 'The quote waits.', ...base]);
  assert.equal(asked.code, 0, asked.err);
  const todo = json(box, ['notify', 'add', '--title', 'Two fields have no home', '--recommend', 'Keep both as text fields.', ...base]);
  assert.equal(todo.code, 0, todo.err);

  const built = json(box, ['view', '--html', ...base]);
  assert.equal(built.code, 0, built.err);
  const html = fs.readFileSync(built.data.publish, 'utf8');
  const data = JSON.parse(/<script type="application\/json" id="cogby-data">([\s\S]*?)<\/script>/.exec(html)[1]);
  const waiting = data.notifications.waiting;
  assert.deepEqual(waiting.map((n) => n.title), ['Two fields have no home', 'Approve the scope?'], 'the newest first');
  assert.deepEqual([waiting[0].options, waiting[0].recommend, waiting[0].if_ignored], [[], 'Keep both as text fields.', ''], 'with no answers, what Cogby suggests is a sentence');
  assert.deepEqual([waiting[1].options, waiting[1].recommend, waiting[1].if_ignored], [['yes', 'no'], 'yes', 'The quote waits.']);
  assert.ok(waiting.every((n) => n.days_old === 0 && /^\d{4}-\d{2}-\d{2} /.test(n.created)), 'each one says when it was left');
  assert.equal(data.projects.find((p) => p.name === 'harbor').waiting, 1, '"<project> · <thread>" is about that project');

  // It opens the way a to-do does, with everything it carries and every way to answer it.
  assert.match(html, /function drawNotif\(\)/, 'a notification opens in a panel over the page');
  assert.match(html, /open\.addEventListener\('click', function \(\) \{ showNotif\(n\.id\); \}\);/, 'its title opens it');
  for (const part of ['\'What Cogby suggests\'', '\'If nothing is done\'', '\'Your answer\'', '\'Or in your own words\'']) assert.ok(html.includes(part), `the opened notification has no ${part}`);
  assert.match(html, /commentable\('notification', n\.id, n\.title, \{ say: REPLY/, 'the owner\'s own words leave as a comment on it');
  // The answer Cogby already thought of is on the row, with one press to take it (owner, 2026-11-24).
  assert.match(html, /var sug = suggestion\(n\);\s+if \(sug\) row\.appendChild\(sug\);/);
  assert.ok(html.includes('el(\'span\', \'kicker\', \'Cogby suggests\')'));
  assert.ok(html.includes('choice(n.id, n.title, \'Yes, do that\', \'do\', \'chip\')'), 'one press takes the suggestion');
  // The page cannot start Claude: what is pressed is saved, and one Copy prompt at the top hands all of it
  // over, asking for a session of its own (owner, 2026-11-24: "my copy prompt tells the AI ... create a
  // subsession to handle this").
  assert.ok(html.includes('Start a new session for this and let it handle everything below on its own, end to end'));
  assert.ok(html.includes('out.push(\'Cogby asked \' + name + \'. My answer: \' + quote(a.option) + \'. Carry it out.\');'), 'the prompt carries the answer pressed on the page');
  assert.ok(html.includes('if (kind === \'request\') out.push(\'Do this for me: \' + text);'), 'and what was asked under the inbox');
  assert.ok(html.includes('choice(id, m.title, \'Prepare me\', \'prepare\', \'btn\')'), 'Prepare me is saved like any press and goes into the prompt');
  assert.ok(html.includes('if (copyOld(text)) { done(); return; }'), 'the copy works in a frame with no clipboard permission');
  assert.ok(html.includes('function promptBox(text)'), 'and shows the prompt to copy by hand when nothing else works');
  // Older than two weeks: folded under "Older" with its count, never dropped. What is marked high stays in sight.
  assert.match(html, /var OLD_DAYS = 14;/);
  assert.match(html, /n\.priority !== 'high' && n\.days_old != null && n\.days_old > OLD_DAYS/);
  assert.match(html, /el\('span', 'slug', 'Older'\)/);
  const later = require('../core/brain/notify.cjs').forView(box.brain, new Date(Date.now() + 20 * 86400000));
  assert.deepEqual(later.waiting.map((n) => n.days_old), [20, 20], 'an old one is still in the list the page gets');
  assert.doesNotMatch(html.replace(/<script type="application\/json"[\s\S]*?<\/script>/, ''), /[—–]/, 'a long dash on the page');

  // Whoever writes a notification is told what one is, where they write it; a session is told what a press means.
  const tool = require('../core/brain/mcp.cjs').TOOLS.find((one) => one.name === 'notify');
  assert.match(tool.description, /a notification carries a question and its answers \(options, recommend\) or one thing to do \(recommend alone\), or it is not one/);
  assert.match(tool.description, /what needs nothing from the owner is added with status "acted"/);
  const help = require('../core/brain/cli.cjs').HELP.replace(/\s+/g, ' ');
  assert.ok(help.includes('A notification carries a question and its answers') && help.includes('or it is not a notification') && help.includes('shown under "Done without you"'), 'the help does not say what a notification is');
  const skill = path.join(ROOT, '.claude', 'skills', 'my-view');
  assert.match(fs.readFileSync(path.join(skill, 'SKILL.md'), 'utf8'), /\| action `do`, an id \(the owner pressed \*\*Yes, do that\*\*, once \*\*Do this\*\*\) \| carry out what that notification suggests, as `from-the-page\.md` beside this file says\. Still ask first/);
  const side = fs.readFileSync(path.join(skill, 'from-the-page.md'), 'utf8').replace(/\s+/g, ' ');
  assert.ok(side.includes('Ask first, in chat, before any part of it that sends a message, deletes something, spends money, pushes or deploys code, or touches anything outside the brain.'));
  assert.ok(side.includes('It is the owner\'s reply to that notification'), 'an answer in the owner\'s own words is their reply');
  assert.ok(side.includes('If its status is no longer `unread`, the owner settled it already'), 'a press is not carried out twice');
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

test('the 25 Nov notes: chats by project that open, a status changed from the page, tasks that say where they live', (t) => {
  const box = newBrain(t);
  const base = ['--brain', box.brain];
  cogby(box, ['log', 'projects/harbor/card', 'Kickoff held', '--source', 'call', '--create', ...base]);
  cogby(box, ['todo', 'add', 'Call the port', '--project', 'harbor', ...base]);

  // A project's status is changed with one command: the card's own line, and the old one in its timeline.
  const set = json(box, ['project', 'status', 'harbor', 'On hold', '--source', 'command center', ...base]);
  assert.equal(set.code, 0, set.err);
  assert.deepEqual([set.data.status, set.data.was, set.data.now], ['changed', 'active', 'on-hold']);
  const card = fs.readFileSync(path.join(box.brain, 'projects', 'harbor', 'card.md'), 'utf8');
  assert.match(card, /^status: on-hold$/m);
  assert.match(card, /\| command center — status: active → on-hold \[[^\]]*record\]/, 'the change is a record on the card, with the old status');
  assert.equal(json(box, ['project', 'status', 'harbor', 'on-hold', ...base]).data.status, 'unchanged', 'the same status again writes nothing');
  assert.equal(cogby(box, ['project', 'status', 'nowhere', 'done', ...base]).code, 1, 'a project that is not there is refused');
  assert.equal(cogby(box, ['project', 'status', 'harbor', ...base]).code, 2, 'a status must be named');

  // Tasks read from the owner's own tool reach the page with where they live; nothing is copied into the brain.
  const tasks = path.join(box.dir, 'tasks.json');
  fs.writeFileSync(tasks, JSON.stringify([
    { id: 'n-1', text: 'Renew the berth', due: '2026-12-01', tool: 'Notion', link: 'https://www.notion.so/berth', project: 'harbor' },
    { id: 'g 2', title: 'Pay the pilot', tool: 'Google Tasks', link: 'javascript:alert(1)', done: true },
    { id: 'x', text: 'No tool named' }, 'not a task',
  ]));
  const built = json(box, ['view', '--html', '--tasks', tasks, ...base]);
  assert.equal(built.code, 0, built.err);
  const html = fs.readFileSync(built.data.publish, 'utf8');
  const data = JSON.parse(/<script type="application\/json" id="cogby-data">([\s\S]*?)<\/script>/.exec(html)[1]);
  assert.deepEqual(data.tasks, [
    { id: 'ext:n-1', text: 'Renew the berth', due: '2026-12-01', done: false, tool: 'Notion', link: 'https://www.notion.so/berth', project: 'harbor' },
    { id: 'ext:g-2', text: 'Pay the pilot', due: '', done: true, tool: 'Google Tasks', link: '', project: '' },
  ], 'a task keeps its tool and an https link only; one with no tool is left out');
  assert.equal(data.projects.find((p) => p.name === 'harbor').status, 'on-hold');
  assert.equal(json(box, ['todo', ...base]).data.todos.length, 1, 'the brain\'s own list is untouched');
  assert.equal(cogby(box, ['view', '--html', '--tasks', path.join(box.dir, 'none.json'), ...base]).code, 1, 'a file that is not there is an error');
  assert.ok(html.includes("var sourceTag = function (t) {"), 'a task says where it lives');
  assert.ok(html.includes("put(row, check, mark, name, mixedTasks() ? sourceTag(t) : null, t.changed ? notYet() : null);"), 'on its row when tasks come from more than one place');
  assert.ok(html.includes("var words = t.link ? outside(link(t.link, 'tname', t.text)) : el('span', 'tname', t.text);"), 'a task from a tool opens there');

  // The page: a status menu on a project's view, saved as a change a session applies.
  assert.ok(html.includes("top.appendChild(put(el('div', 'pfacts'), statusPicker(p),"), 'a project\'s status is a menu on its view');
  assert.ok(html.includes("change({ kind: 'project-status', project: p.name, status: pick.value });"));
  assert.ok(html.includes("['id', 'client_id', 'text', 'due', 'project', 'body', 'by', 'status'].forEach"), 'the store keeps the status, and who a task is for');
  // Chats: grouped by project first, and a chat's title opens it on the page.
  assert.ok(html.includes("var sby = 'project';"), 'Sessions open grouped by project');
  assert.ok(html.includes("[['project', 'By project'], ['state', 'By who acts next']]"));
  assert.ok(html.includes("open.addEventListener('click', function () { showSession(x); });"), 'a chat\'s title opens it');
  assert.match(html, /function showSession\(x\) \{/);
});

test('a to-do handed to Cogby keeps who it is for and its plan; the chats, the scheduled runs and the skills read for the page reach it as text only', (t) => {
  const box = newBrain(t);
  const base = ['--brain', box.brain];
  cogby(box, ['log', 'projects/harbor/card', 'Kickoff held', '--source', 'call', '--create', ...base]);

  // Whose a to-do is, and the plan Cogby wrote on it: two fields of the to-do, set and taken off by `cogby todo`.
  const added = json(box, ['todo', 'add', 'Draft the berth letter', '--project', 'harbor', '--by', 'Cogby', ...base]);
  assert.equal(added.code, 0, added.err);
  assert.deepEqual([added.data.todo.by, added.data.todo.plan], ['cogby', '']);
  const id = added.data.todo.id;
  const planned = json(box, ['todo', 'edit', id, '--plan', '1. Read the card\n2. Draft it', ...base]);
  assert.deepEqual([planned.data.todo.by, planned.data.todo.plan], ['cogby', '1. Read the card\n2. Draft it'], 'the plan keeps its lines');
  const back = json(box, ['todo', 'edit', id, '--by', 'me', '--plan', 'none', ...base]);
  assert.deepEqual([back.data.todo.by, back.data.todo.plan], ['', ''], 'given back to the owner, with the plan taken off');
  assert.equal(json(box, ['todo', 'add', 'Mine', '--by', 'someone', ...base]).data.todo.by, '', 'anyone but Cogby is the owner');
  assert.equal(json(box, ['todo', 'edit', id, '--by', 'cogby', '--plan', 'Draft it', ...base]).code, 0);
  const help = require('../core/brain/cli.cjs').HELP.replace(/\s+/g, ' ');
  assert.ok(help.includes('[--by cogby|me] [--plan "…"|none]') && help.includes('view --html [--meetings FILE] [--runs FILE] [--sessions FILE] [--tasks FILE]'), 'the help names every option the page and the skill use');

  // A routine scheduled in Claude, a skill of the brain's own, and what a session read from the Claude app.
  assert.equal(cogby(box, ['routines', 'add', 'Morning check-in', '--run', 'check-in, morning', '--rhythm', 'daily', '--scheduled', 'work-morning-check-in', ...base]).code, 0);
  assert.equal(cogby(box, ['routines', 'ran', 'morning-check-in', '--source', 'scheduled task', '--result', 'Nothing waits', ...base]).code, 0);
  const own = path.join(box.brain, '.claude', 'skills', 'berth-letters');
  fs.mkdirSync(own, { recursive: true });
  fs.writeFileSync(path.join(own, 'SKILL.md'), '---\nname: berth-letters\ndescription: Write a berth letter. Use when the port asks.\n---\n');
  const link = 'claude://claude.ai/epitaxy/local_28cedabc-6528-4c33-8948-6d3e3b48c8be';
  const file = (name, data) => { const where = path.join(box.dir, name); fs.writeFileSync(where, JSON.stringify(data)); return where; };
  const runs = file('runs.json', { 'Work-Morning-Check-In': { link, at: 'Tue 08:13', summary: 'Done' } });
  const sessions = file('sessions.json', [
    { id: 's 1', title: 'Berth letter', state: 'needs', needs: 'Approve the draft?', where: 'Draft written', project: 'harbor', at: '10:02', link },
    { id: 's2', title: 'Loose chat', state: 'asleep', project: 'Not in the brain', link: 'javascript:alert(1)' },
    { id: 's3', state: 'working' }, 'not a chat',
  ]);
  const built = json(box, ['view', '--html', '--runs', runs, '--sessions', sessions, ...base]);
  assert.equal(built.code, 0, built.err);
  const read = (from) => JSON.parse(/<script type="application\/json" id="cogby-data">([\s\S]*?)<\/script>/.exec(fs.readFileSync(from, 'utf8'))[1]);
  const data = read(built.data.publish);
  const harbor = data.projects.find((p) => p.name === 'harbor');
  assert.deepEqual(data.sessions, [
    { id: 's-1', title: 'Berth letter', state: 'needs', where: 'Draft written', needs: 'Approve the draft?', at: '10:02', link, project: harbor.title, project_name: 'harbor' },
    { id: 's2', title: 'Loose chat', state: 'idle', where: '', needs: '', at: '', link: '', project: 'Not in the brain', project_name: '' },
  ], 'a chat keeps its title, who acts next and Claude\'s own link; one with no title is left out');
  const routine = data.routine_runs.find((r) => r.title === 'Morning check-in');
  assert.deepEqual([routine.scheduled, routine.scheduled_as, routine.last_result, routine.chat, routine.chat_at, routine.chat_summary], [true, 'work-morning-check-in', 'Nothing waits', link, 'Tue 08:13', 'Done'], 'the routine links to the chat its scheduled task last ran in');
  const mine = data.todos.find((one) => one.id === id);
  assert.deepEqual([mine.by, mine.plan], ['cogby', 'Draft it'], 'the page has who the to-do is for, and the plan');
  assert.deepEqual(data.skills[0], { name: 'berth-letters', about: 'Write a berth letter.', own: true }, 'the brain\'s own skills come first, each with its first sentence');
  const builtIn = data.skills.find((skill) => skill.name === 'my-view');
  assert.ok(builtIn && builtIn.own === false && builtIn.about.length > 10, 'Cogby\'s own skills follow');
  assert.ok(!data.skills.some((skill) => skill.name === 'notion-mirror'), 'an extra Claude is not told of, started only by typing its name, is not listed');
  // Nothing read for the page: the chats are null (not read), not an empty list (none open).
  const bare = read(json(box, ['view', '--html', ...base]).data.publish);
  assert.deepEqual([bare.sessions, bare.tasks, bare.routine_runs[0].chat], [null, [], '']);
  assert.equal(cogby(box, ['view', '--html', '--sessions', path.join(box.dir, 'none.json'), ...base]).code, 1, 'a sessions file that is not there is an error');
  assert.equal(cogby(box, ['view', '--html', '--runs', path.join(box.dir, 'none.json'), ...base]).code, 1, 'and so is a runs file');
});

test('Copy prompt names a to-do or a note made on the page by its words, never by the page\'s own key', () => {
  const html = fs.readFileSync(require('../core/brain/center.cjs').TEMPLATE, 'utf8');
  const grab = (name) => new RegExp(`\\n  var ${name} = function [^\\n]*`).exec(html)[0];
  const source = `${['quote', 'flat', 'notifById', 'meetById', 'todoById'].map(grab).join('')}${/\n  function handoffItems\(\) \{[\s\S]*?\n  \}/.exec(html)[0]}\nreturn handoffItems();`;
  // eslint-disable-next-line no-new-func
  const items = (changes, todos) => new Function('pending', 'notes', 'meetings', 'baseTodos', source)({ actions: {}, sent: {}, comments: {}, sentComments: {}, changes }, { waiting: [] }, [], todos || []);
  assert.deepEqual(items([
    { kind: 'todo-add', client_id: 'page-1', text: 'Call the port', due: '2026-12-01' },
    { kind: 'todo-done', client_id: 'page-1' },
    { kind: 'todo-edit', client_id: 'page-1', text: 'Call the harbour' },
    { kind: 'todo-drop', client_id: 'page-1' },
    { kind: 'todo-done', id: 'todo-9' },
    { kind: 'note-add', client_id: 'page-2', text: 'A thought' },
    { kind: 'note-dismiss', client_id: 'page-2' },
    { kind: 'note-dismiss', id: 'note-3' },
    { kind: 'project-status', project: 'harbor', status: 'on-hold' },
  ], [{ id: 'todo-9', text: 'Renew the berth' }]), [
    'Add a to-do: "Call the port", due 2026-12-01.',
    'Tick off the to-do "Call the port", the one I added on this page.',
    'Change the to-do "Call the port", the one I added on this page: its words to "Call the harbour".',
    'Remove the to-do "Call the port", the one I added on this page.',
    'Tick off the to-do "Renew the berth" (todo-9).',
    'Keep a note: A thought.',
    'Remove the note "A thought", the one I added on this page.',
    'Remove the note note-3.',
    'Set the status of my project "harbor" to "on-hold" (cogby project status).',
  ]);
  // The owner's notes and Cogby's plan end on a full stop inside "Hand to Claude", so the next sentence stands apart.
  assert.ok(html.includes("(notes_ ? ' My notes: ' + ended(flat(notes_)) : '') + (t.plan ? ' Cogby\\'s plan: ' + ended(flat(t.plan)) : '') + ' Read the project in my brain first"));
  const side = fs.readFileSync(path.join(ROOT, '.claude', 'skills', 'my-view', 'from-the-page.md'), 'utf8').replace(/\s+/g, ' ');
  assert.ok(side.includes('A to-do or a note named as "the one I added on this page" has no id yet: add it first, from its own line, then apply the line to it.'), 'the skill says how to apply such a line');
  assert.ok(side.includes('## The prompt pasted into a chat') && side.includes('`Do this for me: <text>` | a comment on a `request`'), 'and reads the lines of Copy prompt, which replaced the one line per notification');
});
