'use strict';

// A private brain: one its owner marked with `cogby init --private`. It is used only from inside its own
// folder. The owner, 2026-11-22, on keeping a personal brain beside their work brain on one computer: "how can I
// make sure that data from personal brain don't go general brain ?", then "add the private brain option".
// What is held here is what code can hold: which brain a command, a tool or a hook picks, and which folders
// an index reads. An agent copying text by hand is not something a command can stop; the session start says
// that rule in words.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { ROOT, newBrain, sandbox, cogby, json, hook, git } = require('./helpers.cjs');
const sweep = require('./manual/lock-sweep.cjs');

const INIT = ['--no-plugin', '--no-sources'];
const marker = (brain) => JSON.parse(fs.readFileSync(path.join(brain, '.cogby', 'brain.json'), 'utf8'));
const refusal = (result) => JSON.parse(result.out).error;

// A work brain that is the default, a private one beside it, and a folder that is neither.
function two(t) {
  const box = newBrain(t);
  const personal = path.join(box.dir, 'Personal Cogby');
  const made = json(box, ['init', '--brain', personal, '--private', ...INIT]);
  assert.equal(made.code, 0, made.err || made.out);
  const elsewhere = path.join(box.dir, 'some-folder');
  fs.mkdirSync(elsewhere);
  return { box, work: box.brain, personal, elsewhere, made: made.data };
}

function page(brain, rel, text) {
  const file = path.join(brain, ...rel.split('/'));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}

test('init --private marks a new brain in its own first commit, and it is never the default', (t) => {
  const { box, work, personal, elsewhere, made } = two(t);
  assert.equal(made.private, true);
  assert.equal(made.marked, true);
  assert.equal(made.default, false);
  assert.equal(marker(personal).private, true);
  assert.equal(git(personal, ['status', '--porcelain']), '', 'the mark is not in the brain\'s history');
  assert.equal(marker(work).private, undefined, 'the other brain was marked too');
  assert.match(cogby(box, ['init', '--brain', personal, '--private', ...INIT]).out, /Private already: this brain is used only from a chat or a command started in its own folder\. It is never the default brain, and no other brain searches or imports it\./);
  // From a folder that is no brain, the default is still the work brain.
  assert.equal(json(box, ['view'], { cwd: elsewhere }).data.brain, work);
  // A first brain made private is no default either: outside it there is no brain at all.
  const alone = sandbox(t);
  const only = json(alone, ['init', '--brain', alone.brain, '--private', ...INIT]);
  assert.equal(only.data.default, false);
  const none = json(alone, ['view'], { cwd: alone.dir });
  assert.equal(none.code, 1);
  assert.equal(refusal(none).code, 'NO_BRAIN');
  assert.match(hook(alone, 'brain-context', { source: 'startup' }, { cwd: alone.dir }).out, /you have no brain yet/);
  assert.match(cogby(alone, ['help']).out, /init \[--brain PATH\] \[--default\] \[--private\]/);
});

test('a brain that is not private is picked as before, also when its marker cannot be read', (t) => {
  const box = newBrain(t);
  const elsewhere = path.join(box.dir, 'some-folder');
  fs.mkdirSync(elsewhere);
  const start = () => hook(box, 'brain-context', { source: 'startup' }, { cwd: elsewhere }).out;
  assert.equal(marker(box.brain).private, undefined);
  assert.doesNotMatch(start(), /you have no brain yet/);
  assert.equal(json(box, ['view'], { cwd: elsewhere }).data.brain, box.brain);
  // The mark is read from the marker; a marker that says nothing (empty, or not an object) is no mark.
  for (const text of ['', 'null']) {
    fs.writeFileSync(path.join(box.brain, '.cogby', 'brain.json'), text);
    assert.doesNotMatch(start(), /you have no brain yet/, `marker ${JSON.stringify(text)}: the default brain was dropped at the session start`);
    assert.equal(json(box, ['view'], { cwd: elsewhere }).data.brain, box.brain, `marker ${JSON.stringify(text)}: the default brain was dropped by a command`);
  }
});

test('a private brain cannot be made the default, and one that was the default stops being it', (t) => {
  const { box, work, personal, elsewhere } = two(t);
  for (const args of [['init', '--brain', personal, '--default', ...INIT], ['init', '--brain', path.join(box.dir, 'third'), '--default', '--private', ...INIT]]) {
    const refused = json(box, args);
    assert.equal(refused.code, 1, refused.out);
    assert.equal(refusal(refused).code, 'PRIVATE_BRAIN');
    assert.match(refusal(refused).message, /A private brain cannot be the default brain\./);
  }
  assert.equal(fs.existsSync(path.join(box.dir, 'third')), false, 'a refused init left a folder behind');
  assert.equal(json(box, ['view'], { cwd: elsewhere }).data.brain, work);
  // Marking the default brain: it is committed on its own, and no folder falls back to it any more.
  const marked = json(box, ['init', '--brain', work, '--private', ...INIT]);
  assert.equal(marked.code, 0, marked.err || marked.out);
  assert.deepEqual([marked.data.private, marked.data.marked, marked.data.lost_default, marked.data.default], [true, true, true, false]);
  assert.equal(git(work, ['status', '--porcelain', '.cogby/brain.json']), '');
  assert.match(git(work, ['log', '-1', '--format=%s']), /this brain is private/);
  assert.equal(refusal(json(box, ['view'], { cwd: elsewhere })).code, 'NO_BRAIN');
  assert.match(hook(box, 'brain-context', { source: 'startup' }, { cwd: elsewhere }).out, /you have no brain yet/);
  assert.equal(json(box, ['view'], { cwd: work }).data.brain, work, 'the brain no longer works from its own folder');
});

test('a private brain is used only from its own folder, by name or by environment', (t) => {
  const { box, work, personal, elsewhere } = two(t);
  page(personal, 'areas/health/card.md', '# Health\n\nPhysiotherapy on Tuesdays.\n');
  assert.equal(cogby(box, ['sync'], { cwd: personal }).code, 0);
  assert.equal(json(box, ['search', 'physiotherapy'], { cwd: personal }).data.results.length, 1);
  for (const [why, args, options] of [
    ['named from another folder', ['search', 'physiotherapy', '--brain', personal], { cwd: elsewhere }],
    ['named from the work brain', ['search', 'physiotherapy', '--brain', personal], { cwd: work }],
    ['named by COGBY_BRAIN', ['search', 'physiotherapy'], { cwd: elsewhere, env: { COGBY_BRAIN: personal } }],
    ['written to from another folder', ['log', 'areas/health/card', 'A line from elsewhere', '--source', 'test', '--brain', personal], { cwd: elsewhere }],
    ['a shell that moved into it from a session opened in the work brain', ['search', 'physiotherapy'], { cwd: personal, env: { CLAUDE_PROJECT_DIR: work } }],
  ]) {
    const refused = json(box, args, options);
    assert.equal(refused.code, 1, `${why}: ${refused.out}`);
    assert.equal(refusal(refused).code, 'PRIVATE_BRAIN', why);
    assert.match(refusal(refused).message, /is a private brain: it is used only from a chat or a command started in its own folder\./, why);
    assert.doesNotMatch(refused.out, /Physiotherapy/, `${why}: what it holds was shown`);
  }
  assert.doesNotMatch(fs.readFileSync(path.join(personal, 'areas', 'health', 'card.md'), 'utf8'), /A line from elsewhere/);
  // By its own folder it works, also when it is named there.
  assert.equal(json(box, ['search', 'physiotherapy', '--brain', personal], { cwd: path.join(personal, 'areas') }).data.results.length, 1);
});

test('a session opened in a private brain uses no other brain', (t) => {
  const { box, work, personal, elsewhere } = two(t);
  for (const [why, args, options] of [
    ['another brain named from inside it', ['view', '--brain', work], { cwd: personal }],
    ['another brain named by COGBY_BRAIN', ['view'], { cwd: personal, env: { COGBY_BRAIN: work } }],
    ['a shell that moved into the work brain', ['view'], { cwd: work, env: { CLAUDE_PROJECT_DIR: personal } }],
    ['a line written to the work brain', ['log', 'areas/work/card', 'A personal line', '--source', 'test', '--create', '--brain', work], { cwd: personal }],
  ]) {
    const refused = json(box, args, options);
    assert.equal(refused.code, 1, `${why}: ${refused.out}`);
    assert.equal(refusal(refused).code, 'PRIVATE_BRAIN', why);
    assert.match(refusal(refused).message, /what is said here goes to no other brain/, why);
  }
  assert.equal(git(work, ['status', '--porcelain']), '', 'something was written to the work brain');
  // A shell that moved to a folder that is no brain still uses the private brain, never the default.
  assert.equal(json(box, ['view'], { cwd: elsewhere, env: { CLAUDE_PROJECT_DIR: personal } }).data.brain, personal);
  // And its session start says, in words, the rule no command can hold.
  const start = hook(box, 'brain-context', { source: 'startup' }, { cwd: personal }).out;
  assert.match(start, /Private brain: what it holds stays in it\. Copy nothing from it into another brain, a shared page or a message unless the owner asks in so many words\./);
  // Like any other session start, it names which Cogby this is (core/lib/version.cjs).
  assert.match(start, /^This is Cogby version \S+, from "/m, 'the session start in a private brain does not name the version');
  assert.doesNotMatch(hook(box, 'brain-context', { source: 'startup' }, { cwd: work }).out, /Private brain/);
  assert.doesNotMatch(hook(box, 'brain-context', { source: 'startup' }, { cwd: elsewhere }).out, /Personal Cogby/, 'a chat elsewhere is told about the private brain');
});

// The session end saves the day's log in a helper the hook does not wait for (.claude/hooks/plugin-hook.cjs).
// It picks the brain as the hook does: a chat opened in a private brain saves into it, and a chat opened
// anywhere else never does, also when the folder the session ends in is not the one it was opened in.
test('a session end saves a private brain\'s log only for a chat opened in it, through the helper', { timeout: 120000 }, async (t) => {
  const { box, work, personal, elsewhere } = two(t);
  const now = new Date();
  const day = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  let n = 0;
  const dirty = (brain) => page(brain, `.cogby/self/log/${day}.md`, `# ${day}\n\n### turn ${++n}\n`);
  const saved = (brain) => git(brain, ['status', '--porcelain', '--untracked-files=all', '--', '.cogby/self/log']) === '';
  // `opened` is the folder Claude Code says the session is in; `ended` is the folder the payload names.
  const end = async (opened, ended) => {
    const run = hook(box, 'session-wrapup', { cwd: ended, session_id: `s${n}`, hook_event_name: 'SessionEnd', reason: 'exit' },
      { cwd: opened, env: { COGBY_SESSION_END_INLINE: '0', BRAIN_WRAPUP_DRYRUN: '1', BRAIN_WRAPUP_MODE: 'off' } });
    const pid = Number((/helper started: pid (\d+)/.exec(run.out) || [])[1]);
    if (pid) assert.equal(await sweep.waitGone(pid), true, 'the helper never finished');
    return pid;
  };
  dirty(personal);
  assert.ok(await end(personal, personal), 'a session end in the private brain started no helper');
  assert.equal(saved(personal), true, 'the private brain\'s session end did not save its log');
  for (const [why, opened, ended] of [
    ['a chat in a folder that is no brain', elsewhere, elsewhere],
    ['a chat in the work brain that ended in the private one', work, personal],
    ['a chat in a folder that is no brain that ended in the private one', elsewhere, personal],
  ]) {
    dirty(personal);
    await end(opened, ended);
    assert.equal(saved(personal), false, `${why} saved into the private brain`);
  }
  // Closed from inside: a chat opened in the private brain that ends in the work brain saves nothing there.
  const before = git(work, ['rev-list', '--count', 'HEAD']);
  dirty(work);
  await end(personal, work);
  assert.equal(git(work, ['rev-list', '--count', 'HEAD']), before, 'a chat opened in the private brain saved into the work brain');
  // Between two brains that are not private, the session end saves as before: where it ended.
  const other = path.join(box.dir, 'Other');
  assert.equal(cogby(box, ['init', '--brain', other, ...INIT]).code, 0);
  dirty(other);
  await end(work, other);
  assert.equal(saved(other), true, 'a session end between two ordinary brains no longer saves where it ended');
  // The turns themselves, which the session end saves: written in the private brain for a chat opened
  // in it, and never across, either way.
  const log = (brain) => { try { return fs.readFileSync(path.join(brain, '.cogby', 'self', 'log', `${day}.md`), 'utf8'); } catch { return ''; } };
  const turn = (opened, ended, words) => hook(box, 'capture-log', { cwd: ended, session_id: 'c1', hook_event_name: 'Stop', last_assistant_message: words }, { cwd: opened });
  turn(personal, personal, 'Booked the physiotherapist.');
  assert.match(log(personal), /Booked the physiotherapist\./, 'a turn in the private brain was not logged there');
  turn(personal, work, 'Moved the dentist to Friday.');
  assert.doesNotMatch(log(work), /dentist/, 'a turn of a chat opened in the private brain was logged in the work brain');
  turn(work, personal, 'Drafted the client proposal.');
  assert.doesNotMatch(log(personal), /client proposal/, 'a turn of a chat opened in the work brain was logged in the private brain');
  turn(work, other, 'Filed the invoice.');
  assert.match(log(other), /Filed the invoice\./, 'a turn between two ordinary brains is no longer logged where it ran');
});

test('no other brain reads a private brain: not as a source, not inside a folder it reads, not by import', (t) => {
  const { box, work, personal } = two(t);
  page(personal, 'areas/health/card.md', '# Health\n\nPhysiotherapy on Tuesdays.\n');
  for (const folder of [personal, path.join(personal, 'areas')]) {
    const refused = json(box, ['sources', 'add', folder, '--id', 'mine'], { cwd: work });
    assert.equal(refused.code, 1, refused.out);
    assert.equal(refusal(refused).code, 'PRIVATE_BRAIN');
    assert.match(refusal(refused).message, /no other brain reads it\./);
  }
  // The folder above both holds the private brain: added as a source, the brain inside it is passed over.
  const shelf = path.join(box.dir, 'shelf');
  fs.mkdirSync(shelf);
  fs.writeFileSync(path.join(shelf, 'recipes.md'), '# Recipes\n\nChickpeas with lemon.\n');
  const inner = path.join(shelf, 'Diary');
  assert.equal(cogby(box, ['init', '--brain', inner, '--private', ...INIT]).code, 0);
  page(inner, 'areas/diary/card.md', '# Diary\n\nSaw the osteopath.\n');
  assert.equal(cogby(box, ['sources', 'add', shelf, '--id', 'shelf'], { cwd: work }).code, 0);
  assert.equal(json(box, ['search', 'chickpeas'], { cwd: work }).data.results.length, 1);
  assert.equal(json(box, ['search', 'osteopath'], { cwd: work }).data.results.length, 0, 'a private brain inside a source was read');
  // A folder added as a source before its brain was marked is no longer read once it is.
  const later = path.join(box.dir, 'Later');
  assert.equal(cogby(box, ['init', '--brain', later, ...INIT]).code, 0);
  page(later, 'areas/money/card.md', '# Money\n\nMortgage renewal in March.\n');
  assert.equal(cogby(box, ['sources', 'add', later, '--id', 'later'], { cwd: work }).code, 0);
  assert.equal(json(box, ['search', 'mortgage'], { cwd: work }).data.results.length, 1);
  assert.equal(cogby(box, ['init', '--brain', later, '--private', ...INIT]).code, 0);
  assert.equal(cogby(box, ['sync'], { cwd: work }).code, 0);
  assert.equal(json(box, ['search', 'mortgage'], { cwd: work }).data.results.length, 0, 'a source that became private is still read');
  // Import: a private brain, or a folder in it, is not copied into another brain.
  for (const dir of [personal, path.join(personal, 'areas')]) {
    const survey = spawnSync(process.execPath, [path.join(ROOT, 'core', 'ops', 'import-brain.cjs'), 'survey', '--dir', dir], { env: box.env, cwd: work, encoding: 'utf8' });
    assert.notEqual(survey.status, 0, 'a private brain was surveyed for import');
    assert.match(survey.stderr + survey.stdout, /a private brain is not imported into another one/);
    assert.doesNotMatch(survey.stdout, /health/i);
  }
});
