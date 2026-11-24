'use strict';

// Work done outside the brain reaches its history without a wrap-up. Every write to the to-do, note
// and notification stores ends in a commit of that one file, behind the lock page writes take, and
// the session-end hook commits the day's log for a session that ran in the brain or in a place that
// keeps the log. Nothing here pushes, and no model runs.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const { ROOT, CLI, cogby, json, newBrain, hook, git } = require('./helpers.cjs');

const TODOS = '.cogby/todos/store.json';
const NOTES = '.cogby/notes/store.json';
const NOTIFICATIONS = '.cogby/notifications/store.json';
const commits = (box) => Number(git(box.brain, ['rev-list', '--count', 'HEAD']));
const last = (box) => git(box.brain, ['show', '--name-only', '--format=%s', 'HEAD']).split('\n').filter(Boolean);
const dirty = (box) => git(box.brain, ['status', '--porcelain', '--untracked-files=all']);
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const logFile = (box, day = today()) => path.join(box.brain, '.cogby', 'self', 'log', `${day}.md`);

function brain(t) {
  const box = newBrain(t);
  const base = ['--brain', box.brain];
  const run = (args, options) => { const out = json(box, [...args, ...base], options); assert.equal(out.code, 0, out.err || out.out); return out.data; };
  return { box, base, run };
}

test('every write to a store is one commit of that one file', (t) => {
  const { box, base, run } = brain(t);
  let n = commits(box);
  const step = (file, subject) => {
    assert.equal(commits(box), n + 1, subject);
    n += 1;
    assert.deepEqual(last(box), [subject, file]);
    assert.equal(dirty(box), '', 'nothing is left in the working tree');
  };

  const added = run(['todo', 'add', 'Send the proposal', '--due', '2026-11-20']);
  assert.equal(added.commit.committed, true);
  assert.match(added.commit.sha, /^[0-9a-f]{7,}$/);
  step(TODOS, 'todo: Send the proposal');
  run(['todo', 'edit', added.todo.id, '--text', 'Send the proposal to Sara']);
  step(TODOS, 'todo edit: Send the proposal to Sara');
  // The details kept with a to-do: set with its lines, taken off with "none".
  assert.equal(run(['todo', 'edit', added.todo.id, '--body', 'Both phases.\nSSO first.']).todo.body, 'Both phases.\nSSO first.');
  step(TODOS, 'todo edit: Send the proposal to Sara');
  assert.equal(run(['todo', 'edit', added.todo.id, '--body', 'none']).todo.body, '');
  step(TODOS, 'todo edit: Send the proposal to Sara');
  run(['todo', 'done', added.todo.id]);
  step(TODOS, 'todo done: Send the proposal to Sara');
  run(['todo', 'reopen', added.todo.id]);
  step(TODOS, 'todo reopen: Send the proposal to Sara');
  run(['todo', 'drop', added.todo.id]);
  step(TODOS, 'todo drop: Send the proposal to Sara');

  const note = run(['note', 'add', 'Sara prefers Fridays']);
  step(NOTES, 'note: Sara prefers Fridays');
  run(['note', 'dismiss', note.note.id]);
  step(NOTES, 'note dismiss: Sara prefers Fridays');

  const ask = run(['notify', 'add', '--title', 'Approve the scope?', '--source', 'wrap-up', '--context', 'demo', '--option', 'yes', '--option', 'no']);
  step(NOTIFICATIONS, 'notify: Approve the scope?');
  run(['notify', 'add', '--title', 'Approve the new scope?', '--source', 'wrap-up', '--context', 'demo', '--option', 'yes', '--option', 'no']);
  step(NOTIFICATIONS, 'notify refresh: Approve the new scope?');
  run(['notify', 'later', ask.notification.id]);
  step(NOTIFICATIONS, 'notify later: Approve the new scope?');
  run(['notify', 'comment', ask.notification.id, 'Ask Karim first']);
  step(NOTIFICATIONS, 'notify comment: Approve the new scope?');
  run(['notify', 'answer', ask.notification.id, 'yes']);
  step(NOTIFICATIONS, 'notify answer: Approve the new scope?');
  run(['notify', 'dismiss', ask.notification.id]);
  step(NOTIFICATIONS, 'notify dismissed: Approve the new scope?');
  run(['notify', 'add', '--title', 'Ran the morning check-in', '--status', 'acted', '--reason', 'it was due']);
  step(NOTIFICATIONS, 'notify acted: Ran the morning check-in');

  // A person is told how it was saved.
  assert.match(cogby(box, ['todo', 'add', 'Call the bank', ...base]).out, /^To-do todo-[^\n]+ · Call the bank\n  commit [0-9a-f]{7,}\n$/);
  // No machine path is in what was committed.
  assert.doesNotMatch(git(box.brain, ['log', '-p', '--format=%s%n%b']), new RegExp(box.dir.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&').replace(/\\\\/g, '[\\\\/]+'), 'i'));
});

test('a write that is refused writes and commits nothing', (t) => {
  const { box, base, run } = brain(t);
  run(['todo', 'add', 'Send the proposal']);
  const n = commits(box);
  const before = fs.readFileSync(path.join(box.brain, ...TODOS.split('/')));
  assert.notEqual(cogby(box, ['todo', 'add', '   ', ...base]).code, 0);
  assert.notEqual(cogby(box, ['todo', 'done', 'todo-nope', ...base]).code, 0);
  assert.notEqual(cogby(box, ['todo', 'add', 'Late', '--due', 'tomorrow', ...base]).code, 0);
  assert.notEqual(cogby(box, ['notify', 'add', '--title', 'x', '--priority', 'urgent', ...base]).code, 0);
  assert.notEqual(cogby(box, ['notify', 'read', 'ntf-nope', ...base]).code, 0);
  assert.ok(fs.readFileSync(path.join(box.brain, ...TODOS.split('/'))).equals(before));
  assert.equal(commits(box), n);
  assert.equal(dirty(box), '');
  assert.ok(!fs.existsSync(path.join(box.brain, '.cogby', 'write.lock')), 'the lock is given back');

  // A store that cannot be read refuses the write, is left byte for byte, and nothing is committed.
  fs.writeFileSync(path.join(box.brain, ...TODOS.split('/')), '{ not json');
  const refused = json(box, ['todo', 'add', 'Another', ...base]);
  assert.equal(refused.data.error.code, 'STORE_UNREADABLE');
  assert.equal(fs.readFileSync(path.join(box.brain, ...TODOS.split('/')), 'utf8'), '{ not json');
  assert.equal(commits(box), n);
});

test('a dismissed notification is not brought back by a later "later"', (t) => {
  const { box, base, run } = brain(t);
  const ask = run(['notify', 'add', '--title', 'Approve the scope?', '--source', 'wrap-up']);
  run(['notify', 'dismiss', ask.notification.id]);
  const n = commits(box);
  const before = fs.readFileSync(path.join(box.brain, ...NOTIFICATIONS.split('/')));
  const refused = json(box, ['notify', 'later', ask.notification.id, ...base]);
  assert.notEqual(refused.code, 0);
  assert.equal(refused.data.error.code, 'DISMISSED');
  assert.ok(fs.readFileSync(path.join(box.brain, ...NOTIFICATIONS.split('/'))).equals(before));
  assert.equal(commits(box), n);
  assert.ok(!fs.existsSync(path.join(box.brain, '.cogby', 'write.lock')), 'the lock is given back');
});

test('a to-do added from a linked folder is committed in the brain, with no wrap-up', (t) => {
  const { box, run } = brain(t);
  run(['log', 'projects/demo/card', 'Kickoff held', '--source', 'call', '--create']);
  const repo = path.join(box.dir, 'code');
  fs.mkdirSync(repo);
  run(['link', 'projects/demo', '--repo', repo, '--role', 'workspace']);
  const n = commits(box);
  // No --brain: the folder is found as a place of the default brain.
  const added = json(box, ['todo', 'add', 'Fix the export'], { cwd: repo, env: { CLAUDECODE: '1' } });
  assert.equal(added.code, 0, added.err || added.out);
  assert.equal(added.data.todo.project, 'demo');
  assert.equal(added.data.commit.committed, true);
  assert.equal(commits(box), n + 1);
  assert.deepEqual(last(box), ['todo: Fix the export', TODOS]);
  assert.equal(dirty(box), '');
  assert.ok(!fs.existsSync(path.join(repo, '.cogby')), 'nothing is written in the folder itself');
});

test('a store write never pushes', (t) => {
  const { box, run } = brain(t);
  const remote = path.join(box.dir, 'remote.git');
  spawnSync('git', ['init', '-q', '--bare', remote]);
  git(box.brain, ['remote', 'add', 'origin', remote]);
  const branch = git(box.brain, ['rev-parse', '--abbrev-ref', 'HEAD']);
  assert.equal(spawnSync('git', ['-C', box.brain, 'push', '-q', '-u', 'origin', branch]).status, 0);
  run(['todo', 'add', 'Send the proposal']);
  run(['note', 'add', 'An idea']);
  run(['notify', 'add', '--title', 'Look at this']);
  assert.equal(git(box.brain, ['rev-list', '--count', '@{u}..HEAD']), '3', 'three commits, none of them pushed');
});

test('a brain that is not a repository still takes the write, and says it was not committed', (t) => {
  const { box, base, run } = brain(t);
  fs.rmSync(path.join(box.brain, '.git'), { recursive: true, force: true });
  const added = run(['todo', 'add', 'Send the proposal']);
  assert.equal(added.commit.committed, false);
  assert.match(added.commit.why, /not a git repository/);
  assert.equal(run(['todo']).todos.length, 1);
  assert.match(cogby(box, ['note', 'add', 'An idea', ...base]).out, /\n  not committed: the brain is not a git repository/);
});

test('writes at the same moment each land whole or are refused whole: one lock, one commit each', async (t) => {
  const { box, base, run } = brain(t);
  const n = commits(box);
  const add = (text) => new Promise((resolve) => {
    const child = spawn(process.execPath, [CLI, 'todo', 'add', text, ...base, '--json'], { env: box.env, cwd: box.dir, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.on('data', (chunk) => { out += chunk; });
    child.on('close', (code) => resolve({ code, out }));
  });
  const texts = ['one', 'two', 'three', 'four', 'five'].map((word) => `To-do ${word}`);
  const done = await Promise.all(texts.map(add));
  // Each write waits its turn behind the lock. On a machine busy enough that one waits longer than
  // the lock allows, that one is refused whole ("try again"), never half done: so what is in the
  // store is exactly what was accepted, each with its own commit, and nothing was overwritten.
  const landed = texts.filter((text, index) => done[index].code === 0);
  const refused = done.filter((entry) => entry.code !== 0);
  for (const entry of refused) assert.equal(JSON.parse(entry.out).error.code, 'BUSY', entry.out);
  assert.ok(landed.length >= 1, 'at least the first writer gets the lock');
  assert.deepEqual(run(['todo']).todos.map((item) => item.text).sort(), [...landed].sort(), 'no write overwrote another');
  assert.equal(commits(box), n + landed.length);
  assert.equal(dirty(box), '');
  // Tried again, as the refusal says, the rest land too.
  for (const text of texts.filter((entry) => !landed.includes(entry))) run(['todo', 'add', text]);
  assert.deepEqual(run(['todo']).todos.map((item) => item.text).sort(), [...texts].sort());
  assert.equal(commits(box), n + texts.length);
  assert.ok(!fs.existsSync(path.join(box.brain, '.cogby', 'write.lock')), 'the lock is given back');
});

test('the session-end hook commits the day\'s log for a session in the brain, with the wrap-up off', (t) => {
  const { box } = brain(t);
  const turn = { session_id: 's1', hook_event_name: 'Stop', last_assistant_message: 'Wrote the plan.' };
  hook(box, 'capture-log', turn);
  assert.match(dirty(box), /\.cogby\/self\/log\/\d{4}-\d\d-\d\d\.md/, 'after a turn the log is written, not committed');
  // A day a session that never ended cleanly left behind.
  fs.writeFileSync(logFile(box, '2026-01-02'), '\n### 09:00 An older turn\nLeft over.\n');
  const n = commits(box);
  const end = hook(box, 'session-wrapup', { session_id: 's1', hook_event_name: 'SessionEnd', reason: 'exit' }, { env: { BRAIN_WRAPUP_DRYRUN: '1' } });
  assert.equal(end.code, 0, end.err);
  assert.match(end.out, new RegExp(`\\[wrapup\\] day log: \\.cogby/self/log/${today()}\\.md committed [0-9a-f]{7,}`));
  assert.match(end.out, /\[wrapup\] skip: mode=off/, 'no wrap-up is started for it');
  assert.equal(commits(box), n + 2, 'each day is a commit of its own');
  assert.deepEqual(last(box), [`day log: ${today()}`, `.cogby/self/log/${today()}.md`]);
  assert.deepEqual(git(box.brain, ['show', '--name-only', '--format=%s', 'HEAD~1']).split('\n').filter(Boolean), ['day log: 2026-01-02', '.cogby/self/log/2026-01-02.md']);
  assert.equal(dirty(box), '');

  // Nothing new: nothing committed. And `/clear` ends a session too.
  hook(box, 'session-wrapup', { session_id: 's1', hook_event_name: 'SessionEnd', reason: 'exit' });
  assert.equal(commits(box), n + 2);
  hook(box, 'capture-log', { ...turn, last_assistant_message: 'One more thing.' });
  hook(box, 'session-wrapup', { session_id: 's1', hook_event_name: 'SessionEnd', reason: 'clear' });
  assert.equal(commits(box), n + 3);

  // A headless child writes no log and commits none.
  fs.appendFileSync(logFile(box), '\n### 23:59 By hand\nNot the hook.\n');
  hook(box, 'session-wrapup', { session_id: 'child', hook_event_name: 'SessionEnd', reason: 'exit' }, { env: { BRAIN_HEADLESS: '1' } });
  assert.equal(commits(box), n + 3);
});

test('in a linked place the day\'s log is committed to the brain; in any other folder nothing is', (t) => {
  const { box, run } = brain(t);
  run(['log', 'projects/demo/card', 'Kickoff held', '--source', 'call', '--create']);
  const folder = (name) => { const dir = path.join(box.dir, name); fs.mkdirSync(dir); return dir; };
  const code = folder('code');
  const scratch = folder('scratchy');
  const unknown = folder('unknown');
  run(['link', 'projects/demo', '--repo', code, '--role', 'code']);
  run(['link', 'projects/demo', '--repo', scratch, '--role', 'scratch']);
  // The owner turned the automatic wrap-up on: outside the brain it still never starts.
  run(['wrapup', 'auto']);
  const n = commits(box);
  const end = (cwd) => hook(box, 'session-wrapup', { session_id: 's2', hook_event_name: 'SessionEnd', reason: 'exit' }, { cwd, env: { BRAIN_WRAPUP_DRYRUN: '1' } });

  hook(box, 'capture-log', { session_id: 's2', hook_event_name: 'Stop', last_assistant_message: 'Fixed the export.' }, { cwd: code });
  const ended = end(code);
  assert.equal(ended.code, 0, ended.err);
  assert.match(ended.out, /\[wrapup\] day log: [^\n]* committed/);
  assert.doesNotMatch(ended.out, /would spawn/, 'no automatic wrap-up outside the brain');
  assert.equal(commits(box), n + 1);
  assert.deepEqual(last(box), [`day log: ${today()}`, `.cogby/self/log/${today()}.md`]);
  assert.match(fs.readFileSync(logFile(box), 'utf8'), /\nPlace: code · code\nCard: projects\/demo\/card\n/);
  assert.doesNotMatch(git(box.brain, ['show', 'HEAD']), new RegExp(path.basename(box.dir)), 'the folder\'s path is not in the history');
  assert.equal(dirty(box), '');

  // A scratch place and a folder the brain does not know: no log, and a log left by another
  // session is not theirs to commit.
  fs.appendFileSync(logFile(box), '\n### 23:59 Another session\nStill open.\n');
  for (const cwd of [scratch, unknown]) {
    hook(box, 'capture-log', { session_id: 's3', hook_event_name: 'Stop', last_assistant_message: 'Tried something.' }, { cwd });
    const out = end(cwd);
    assert.equal(out.code, 0, out.err);
    assert.equal(out.out, '');
  }
  assert.equal(commits(box), n + 1);
  assert.doesNotMatch(fs.readFileSync(logFile(box), 'utf8'), /Tried something/);
});

test('the wrap-up\'s scope still works when the stores and the log are already committed', (t) => {
  const { box, run } = brain(t);
  const scopeScript = path.join(ROOT, 'core', 'ops', 'wrapup-scope.cjs');
  const scope = (session) => spawnSync(process.execPath, [scopeScript, '--session', session, '--root', box.brain], { env: box.env, cwd: box.brain, encoding: 'utf8' });
  hook(box, 'brain-context', { session_id: 's1', hook_event_name: 'SessionStart', source: 'startup' });
  // The session works: a to-do, a note, a notification (each committed as it is written), a turn
  // in the log, and a file it made.
  run(['todo', 'add', 'Send the proposal']);
  run(['note', 'add', 'An idea']);
  run(['notify', 'add', '--title', 'Look at this']);
  hook(box, 'capture-log', { session_id: 's1', hook_event_name: 'Stop', last_assistant_message: 'Wrote the plan.' });
  fs.writeFileSync(path.join(box.brain, 'projects', 'plan.md'), '# Plan\n');

  // Before the session ends: the stores are committed and out of scope; the log is still dirty.
  const during = scope('s1');
  assert.equal(during.status, 0, during.stderr);
  assert.deepEqual(during.stdout.trim().split('\n').sort(), [`.cogby/self/log/${today()}.md`, 'projects/plan.md']);

  // After the session-end hook committed the log: only what the session made is left.
  hook(box, 'session-wrapup', { session_id: 's1', hook_event_name: 'SessionEnd', reason: 'exit' });
  const after = scope('s1');
  assert.equal(after.status, 0, after.stderr);
  assert.deepEqual(after.stdout.trim().split('\n'), ['projects/plan.md']);
  // The wrap-up commits that; then the scope is empty, which is a real answer.
  git(box.brain, ['add', '--', 'projects/plan.md']);
  spawnSync('git', ['-C', box.brain, '-c', 'user.name=T', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'wrap', '--', 'projects/plan.md']);
  const empty = scope('s1');
  assert.equal(empty.status, 0, empty.stderr);
  assert.equal(empty.stdout.trim(), '');
  assert.equal(dirty(box), '');

  // With the automatic wrap-up on, the hook commits the log first and then plans the child.
  run(['wrapup', 'auto']);
  hook(box, 'capture-log', { session_id: 's1', hook_event_name: 'Stop', last_assistant_message: 'One more turn.' });
  const planned = hook(box, 'session-wrapup', { session_id: 's1', hook_event_name: 'SessionEnd', reason: 'exit' }, { env: { BRAIN_WRAPUP_DRYRUN: '1' } });
  assert.match(planned.out, /\[wrapup\] day log: [^\n]* committed/);
  assert.match(planned.out, /baseline=found paths=0/);
});
