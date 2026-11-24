'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { ROOT, sandbox, cogby, json, newBrain, hook } = require('./helpers.cjs');

const GUARD = path.join(ROOT, '.claude', 'hooks', 'wrapup-guard.cjs');

function guard(command) {
  const result = spawnSync(process.execPath, [GUARD], { encoding: 'utf8', input: JSON.stringify({ tool_name: 'Bash', tool_input: { command } }) });
  try { return JSON.parse(result.stdout).hookSpecificOutput.permissionDecision; } catch { return 'silent'; }
}

test('session start tells Claude to look in the brain, and shows the latest evidence', (t) => {
  const box = newBrain(t);
  cogby(box, ['log', 'projects/demo', 'Kickoff held', '--source', 'call', '--create', '--brain', box.brain]);
  const started = hook(box, 'brain-context', { session_id: 's1', hook_event_name: 'SessionStart', source: 'startup' });
  assert.equal(started.code, 0, started.err);
  assert.match(started.out, /Look in the brain first/);
  assert.match(started.out, /Kickoff held/);
  assert.doesNotMatch(started.out, /Waiting on the owner/, 'nothing waits, so nothing should be said');
  assert.ok(started.out.includes(path.join(ROOT, 'core', 'ops')), 'the session is not told where the scripts are');
  assert.match(started.out, /This session's id is s1/);
});

test('session start says what waits on the owner', (t) => {
  const box = newBrain(t);
  cogby(box, ['todo', 'add', 'Send proposal', '--due', '2020-01-01', '--brain', box.brain]);
  cogby(box, ['notify', 'add', '--title', 'Approve the scope?', '--brain', box.brain]);
  const started = hook(box, 'brain-context', { session_id: 's1', source: 'startup' });
  assert.match(started.out, /Waiting on the owner: 1 open to-do \(1 overdue\), 1 notification\./);
});

test('the automatic wrap-up is off until the owner turns it on', (t) => {
  const box = newBrain(t);
  const end = { session_id: 's1', hook_event_name: 'SessionEnd', reason: 'exit' };
  const off = hook(box, 'session-wrapup', end, { env: { BRAIN_WRAPUP_DRYRUN: '1' } });
  assert.match(off.out, /skip: mode=off/);
  assert.equal(cogby(box, ['wrapup', 'review', '--brain', box.brain]).code, 0);
  const on = hook(box, 'session-wrapup', end, { env: { BRAIN_WRAPUP_DRYRUN: '1' } });
  assert.match(on.out, /would spawn: claude/);
  assert.match(on.out, /mode=review/);
});

test('session start outside the brain names the default brain in brief', (t) => {
  const box = newBrain(t);
  const repo = path.join(box.dir, 'some-repo');
  fs.mkdirSync(repo);
  const started = hook(box, 'brain-context', { session_id: 's1', hook_event_name: 'SessionStart', source: 'startup' }, { cwd: repo });
  assert.equal(started.code, 0, started.err);
  assert.ok(started.out.includes(box.brain), 'the default brain is not named');
  assert.ok(started.out.includes(path.join(ROOT, 'core', 'ops')), 'a session outside the brain is not told where the scripts are');
  // The folder has no home in the brain, and the session is told so in plain words.
  assert.match(started.out, /\nThis folder is not in your brain\. /);
  assert.match(started.out, /save nothing from it to the brain unless the owner asks in so many words/);
});

test('session start in a linked folder opens on its page; in the brain itself nothing is said about places', (t) => {
  const box = newBrain(t);
  cogby(box, ['log', 'projects/demo', 'Kickoff held', '--source', 'call', '--create', '--brain', box.brain]);
  const work = path.join(box.dir, 'demo-files');
  fs.mkdirSync(work);
  assert.equal(cogby(box, ['link', 'projects/demo', '--about', 'Working files', '--repo', work, '--brain', box.brain]).code, 0);
  cogby(box, ['todo', 'add', 'Send proposal', '--brain', box.brain], { cwd: work });
  const start = { session_id: 's1', hook_event_name: 'SessionStart', source: 'startup' };

  const linked = hook(box, 'brain-context', start, { cwd: work });
  assert.equal(linked.code, 0, linked.err);
  assert.match(linked.out, /## This workspace's project: [^\n]*\(projects\/demo, revision \d+\)\nPlace: demo-files · workspace · "Working files"\nWrite rule: /);
  assert.match(linked.out, /### Open to-dos[^\n]*\n- Send proposal \(todo-/);
  assert.doesNotMatch(linked.out, /This folder is not in your brain/);
  assert.ok(linked.out.includes(path.join(ROOT, 'core', 'ops')));

  const inside = hook(box, 'brain-context', start);
  assert.doesNotMatch(inside.out, /This folder is|not in your brain/);
  // Starting sessions in a linked folder or in the brain counts nothing.
  const local = JSON.parse(fs.readFileSync(path.join(box.brain, '.cogby', 'local.json'), 'utf8'));
  assert.deepEqual(Object.keys(local.folders), [work]);
  assert.equal(local.folders[work].sessions, undefined);
});

test('with no brain, session start says so once and other hooks stay silent', (t) => {
  const box = sandbox(t);
  fs.mkdirSync(box.brain);
  const started = hook(box, 'brain-context', { session_id: 's1', source: 'startup' });
  assert.match(started.out, /cogby:onboarding/);
  assert.ok(started.out.includes(path.join(ROOT, 'core', 'ops')), 'onboarding is not told where the scripts are');
  const resumed = hook(box, 'brain-context', { session_id: 's1', source: 'resume' });
  assert.equal(resumed.out.trim(), '');
  for (const name of ['prompt-pointers', 'capture-log', 'session-wrapup']) {
    const run = hook(box, name, { session_id: 's1', prompt: 'hello' });
    assert.equal(run.code, 0, `${name}: ${run.err}`);
    assert.equal(run.out.trim(), '', `${name} spoke outside a brain`);
  }
});

test('every hook exits 0 inside a brain', (t) => {
  const box = newBrain(t);
  for (const name of ['brain-context', 'prompt-pointers', 'capture-log']) {
    const run = hook(box, name, { session_id: 's1', hook_event_name: 'x', prompt: 'what is the budget', source: 'startup' });
    assert.equal(run.code, 0, `${name}: ${run.err}`);
  }
});

test('the wrap-up child of a plugin brain is told where the brain is', (t) => {
  const box = newBrain(t);
  hook(box, 'brain-context', { session_id: 's1', hook_event_name: 'SessionStart', source: 'startup' });
  const planned = hook(box, 'session-wrapup', { session_id: 's1', hook_event_name: 'SessionEnd', reason: 'exit' },
    { env: { BRAIN_WRAPUP_DRYRUN: '1', BRAIN_WRAPUP_SHOW_PROMPT: '1', BRAIN_WRAPUP_MODE: 'auto' } });
  assert.ok(planned.out.includes(`git -C "${box.brain}"`), 'the prompt does not name the brain\'s repository');
  assert.ok(planned.out.includes(`--root "${box.brain}"`), 'the scope command is not pointed at the brain');
  assert.equal(planned.code, 0, planned.err);
  assert.match(planned.out, /would spawn: claude/);
  assert.match(planned.out, /--strict-mcp-config/, 'a plugin brain\'s child must load no connectors');
  assert.match(planned.out, /no remote, no push/);
});

// The wrap-up child of a plugin brain, planned in dry-run with its prompt shown.
function plannedWrapup(box, mode) {
  hook(box, 'brain-context', { session_id: 's1', hook_event_name: 'SessionStart', source: 'startup' });
  const planned = hook(box, 'session-wrapup', { session_id: 's1', hook_event_name: 'SessionEnd', reason: 'exit' },
    { env: { BRAIN_WRAPUP_DRYRUN: '1', BRAIN_WRAPUP_SHOW_PROMPT: '1', BRAIN_WRAPUP_MODE: mode } });
  assert.equal(planned.code, 0, planned.err);
  assert.match(planned.out, /would spawn: claude/);
  return planned.out;
}

function withRemote(box) {
  const bare = path.join(box.dir, 'remote.git');
  assert.equal(spawnSync('git', ['init', '--bare', '-q', bare]).status, 0);
  assert.equal(spawnSync('git', ['-C', box.brain, 'remote', 'add', 'origin', bare]).status, 0);
}

test('in review mode a plugin brain with a remote commits, does not push, and leaves one notification', (t) => {
  const box = newBrain(t);
  withRemote(box);
  const out = plannedWrapup(box, 'review');
  assert.match(out, /remote=yes/);
  assert.match(out, /mode=review/);
  assert.match(out, /plugin brain: review, commit only, no push, one notification/);
  assert.doesNotMatch(out, /PUSH the current branch/, 'review mode must not tell the child to push');
  assert.doesNotMatch(out, /That push is the only thing/);
  assert.match(out, /REVIEW mode: commit locally and do NOT push, even though it has a remote/);
  assert.ok(out.includes(`notify add --brain "${box.brain}" --title "<one plain sentence the owner can act on>" ` +
    '--body "<the commit hash, the branch, the files>" --source wrap-up --context wrapup-review'),
    'the child is not told to leave the review notification');
  assert.doesNotMatch(out, /core\/ops\/notify\.cjs/, 'a plugin brain has no Inbox script');
});

test('in review mode a plugin brain with no remote does not push either, and leaves the notification', (t) => {
  const box = newBrain(t);
  const out = plannedWrapup(box, 'review');
  assert.match(out, /remote=no/);
  assert.doesNotMatch(out, /PUSH the current branch/);
  assert.match(out, /REVIEW mode: commit locally and do NOT push\. Never add a remote\./);
  assert.match(out, /--source wrap-up --context wrapup-review/);
});

test('in auto mode a plugin brain with a remote still pushes', (t) => {
  const box = newBrain(t);
  withRemote(box);
  const out = plannedWrapup(box, 'auto');
  assert.match(out, /remote=yes/);
  assert.match(out, /plugin brain: push to its own remote/);
  assert.match(out, /PUSH the current branch to the remote it already tracks/);
  assert.match(out, /git rev-list --count @\{u\}\.\.HEAD/);
  assert.doesNotMatch(out, /REVIEW mode|--context wrapup-review/);
});

test('the review notification is one per brain: a second close refreshes it', (t) => {
  const box = newBrain(t);
  const add = (title) => cogby(box, ['notify', 'add', '--title', title, '--body', 'abc123 on main: projects/demo/card.md',
    '--source', 'wrap-up', '--context', 'wrapup-review', '--brain', box.brain]);
  assert.equal(add('Review the wrap-up commit before you push').code, 0);
  assert.equal(add('Review the two wrap-up commits before you push').code, 0);
  const open = json(box, ['notify', 'list', '--brain', box.brain]).data.notifications
    .filter((item) => item.context === 'wrapup-review');
  assert.equal(open.length, 1);
  assert.equal(open[0].title, 'Review the two wrap-up commits before you push');
});

test('the wrap-up guard refuses whole-tree staging and force pushes, also behind a quoted path', () => {
  const brain = '"C:\\Users\\Jo\\Cogby Brain"';
  assert.equal(guard('git add -A'), 'deny');
  assert.equal(guard('git add .'), 'deny');
  assert.equal(guard('git commit -am "x"'), 'deny');
  assert.equal(guard('git reset --hard'), 'deny');
  assert.equal(guard(`git -C ${brain} add -A`), 'deny');
  assert.equal(guard(`git -C ${brain} push --force`), 'deny');
  assert.equal(guard(`git -C ${brain} stash`), 'deny');
  assert.equal(guard(`git -C ${brain} commit -F msg.txt -- projects/demo/card.md`), 'allow');
  assert.equal(guard(`git -C ${brain} status --porcelain`), 'allow');
  assert.equal(guard(`git -C ${brain} push`), 'allow');
});

test('the wrap-up guard refuses writes to skills and identity files', () => {
  const write = (file) => {
    const result = spawnSync(process.execPath, [GUARD], { encoding: 'utf8', input: JSON.stringify({ tool_name: 'Edit', tool_input: { file_path: file } }) });
    try { return JSON.parse(result.stdout).hookSpecificOutput.permissionDecision; } catch { return 'silent'; }
  };
  assert.equal(write('C:/brain/.cogby/self/SOUL.md'), 'deny');
  assert.equal(write('/home/jo/brain/.claude/skills/capture/SKILL.md'), 'deny');
  assert.equal(write('/home/jo/brain/.claude/CLAUDE.md'), 'deny');
  assert.equal(write('/home/jo/brain/projects/demo/card.md'), 'allow');
});
