'use strict';

// How the index is kept up to date: a read answers from index.db as it is, a write indexes what it
// touched, and a background sync (or `cogby sync`) brings in what changed outside Cogby.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { ROOT, cogby, json, newBrain, hook } = require('./helpers.cjs');

const background = require(path.join(ROOT, 'core', 'brain', 'background.cjs'));
const db = require(path.join(ROOT, 'core', 'brain', 'db.cjs'));

const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
const WAIT_MS = 60000;

// The sandbox turns the background sync off; these tests turn it back on for one call.
const withBackground = (box) => ({ ...box.env, COGBY_NO_BACKGROUND_SYNC: '0' });

function until(what, check) {
  const deadline = Date.now() + WAIT_MS;
  for (;;) {
    const value = check();
    if (value) return value;
    if (Date.now() > deadline) assert.fail(`timed out waiting for ${what}`);
    sleep(150);
  }
}
// A detached sync holds index.db open: a test ends only once it is gone, so the folder can be removed.
const idle = (box) => until('the background sync to finish', () => !fs.existsSync(background.lockFile(box.brain)));

function byHand(box, rel, text) {
  const file = path.join(box.brain, ...rel.split('/'));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}
const found = (box, words) => json(box, ['search', words, '--brain', box.brain]).data.results.length > 0;

// Makes the index look as if its last sync was long ago.
function age(box, iso = '2020-01-01T00:00:00.000Z') {
  const { db: handle } = db.open(box.brain);
  try { db.stampSynced(handle, iso); } finally { handle.close(); }
}

test('a read answers from the index as it is: a file edited by hand waits for a sync', (t) => {
  const box = newBrain(t);
  byHand(box, 'areas/health/card.md', '# Health\n\nThe physiotherapist is on Tuesdays.\n');

  const before = json(box, ['search', 'physiotherapist', '--brain', box.brain]);
  assert.equal(before.data.results.length, 0, 'the search walked the files: a read must not sync');
  assert.match(before.data.index_as_of, /^\d{4}-\d\d-\d\dT/, 'a search result says when the index was last synced');
  assert.match(cogby(box, ['search', 'physiotherapist', '--brain', box.brain]).out, /Index as of \d{4}-\d\d-\d\d \d\d:\d\d:\d\d UTC/);
  assert.notEqual(cogby(box, ['get', 'areas/health', '--brain', box.brain]).code, 0, 'get read the files too');
  assert.doesNotMatch(cogby(box, ['context', '--brain', box.brain]).out, /Health/);

  const synced = json(box, ['sync', '--brain', box.brain]);
  assert.equal(synced.data.changed, 1);
  const after = json(box, ['search', 'physiotherapist', '--brain', box.brain]);
  assert.match(after.data.results[0].slug, /^areas\/health/);
  assert.ok(after.data.index_as_of > before.data.index_as_of, 'the explicit sync must move the time the index is as of');
});

test('with no index yet, or the index off, a read still reads the files itself', (t) => {
  const box = newBrain(t);
  byHand(box, 'areas/health/card.md', '# Health\n\nThe physiotherapist is on Tuesdays.\n');
  for (const name of fs.readdirSync(path.join(box.brain, '.cogby'))) if (name.startsWith('index.db')) fs.rmSync(path.join(box.brain, '.cogby', name));
  assert.ok(found(box, 'physiotherapist'), 'a missing index.db is rebuilt by the read that needs it');

  cogby(box, ['index', 'off', '--brain', box.brain]);
  byHand(box, 'areas/garden/card.md', '# Garden\n\nThe quince tree is pruned in February.\n');
  const off = json(box, ['search', 'quince', '--brain', box.brain]);
  assert.equal(off.data.index, 'off');
  assert.equal(off.data.results.length, 1);
});

test('a write is searchable at once, also on a page the index has not seen', (t) => {
  const box = newBrain(t);
  const base = ['--brain', box.brain];
  cogby(box, ['log', 'projects/acme', 'Two sandboxes were refreshed', '--source', 'standup', '--create', ...base]);
  assert.ok(found(box, 'sandboxes'));
  cogby(box, ['remember', 'projects/acme', 'The cutover is in March', '--source', 'plan', ...base]);
  assert.ok(found(box, 'cutover'));

  // Made by hand since the last sync: the write finds the file, and never starts a second page.
  byHand(box, 'projects/website/card.md', '---\ntype: project\ntitle: Website\n---\n\nThe marketing site, with a zeppelin on it.\n');
  const logged = json(box, ['log', 'projects/website', 'Homepage copy approved', '--source', 'email', ...base]);
  assert.equal(logged.code, 0, logged.out + logged.err);
  assert.equal(logged.data.created, false);
  assert.equal(logged.data.slug, 'projects/website/card');
  assert.ok(found(box, 'zeppelin'), 'what was already in the file is indexed with the line');
  assert.ok(found(box, 'homepage'));
  assert.ok(!fs.existsSync(path.join(box.brain, 'projects', 'website.md')));

  // Removed by hand since the last sync: the write does not follow the index to a file that is gone.
  fs.rmSync(path.join(box.brain, 'projects', 'acme.md'));
  const gone = json(box, ['log', 'projects/acme', 'Still here?', '--source', 'check', ...base]);
  assert.equal(gone.data.error.code, 'NOT_FOUND');
});

test('a background sync brings in a file edited outside Cogby, and nobody waits for it', (t) => {
  const box = newBrain(t);
  const env = withBackground(box);

  // Started by the session-start hook.
  byHand(box, 'areas/health/card.md', '# Health\n\nThe physiotherapist is on Tuesdays.\n');
  assert.equal(hook(box, 'brain-context', { session_id: 's1', source: 'startup' }, { env }).code, 0);
  until('the hook\'s background sync to index the file', () => found(box, 'physiotherapist'));
  idle(box);

  // Started by the hook that runs after each turn.
  byHand(box, 'areas/garden/card.md', '# Garden\n\nThe quince tree is pruned in February.\n');
  assert.equal(hook(box, 'capture-log', { session_id: 's1', last_assistant_message: 'Done.' }, { env }).code, 0);
  until('the turn\'s background sync to index the file', () => found(box, 'quince'));
  idle(box);

  // Started by a read that finds the last sync older than a minute. That read answers at once, from
  // the index as it was.
  byHand(box, 'areas/travel/card.md', '# Travel\n\nThe ferry to Tarifa leaves at nine.\n');
  const fresh = json(box, ['search', 'ferry', '--brain', box.brain], { env });
  assert.equal(fresh.data.background_sync, undefined, 'a sync a moment old must not start another');
  assert.equal(fresh.data.results.length, 0);
  age(box);
  const stale = json(box, ['search', 'ferry', '--brain', box.brain], { env });
  assert.equal(stale.data.results.length, 0, 'the stale read waited for the sync');
  assert.equal(stale.data.index_as_of, '2020-01-01T00:00:00.000Z');
  assert.equal(stale.data.background_sync, 'started');
  until('the read\'s background sync to index the file', () => found(box, 'ferry'));
  idle(box);
  assert.ok(json(box, ['search', 'ferry', '--brain', box.brain]).data.index_as_of > '2020-01-02');
});

test('two background syncs do not run at once, and a crashed one does not block the next', (t) => {
  const box = newBrain(t);
  const env = withBackground(box);

  // A sync is at work: this process holds the lock, as a running sync does.
  const token = background.acquire(box.brain);
  assert.ok(token);
  assert.deepEqual(background.start(box.brain, { env }), { started: false, why: 'running' });
  assert.equal(background.acquire(box.brain), null);
  assert.equal(json(box, ['sync', '--quick', '--background', '--brain', box.brain], { env }).data.skipped, 'running');
  age(box);
  assert.equal(json(box, ['search', 'anything', '--brain', box.brain], { env }).data.background_sync, 'running');
  background.release(box.brain, token);
  assert.equal(fs.existsSync(background.lockFile(box.brain)), false);

  // Two starts in a row: one sync.
  const first = background.start(box.brain, { env });
  const second = background.start(box.brain, { env });
  assert.equal(first.started, true);
  assert.deepEqual(second, { started: false, why: 'running' });
  idle(box);

  // A lock left by a process that is gone is taken over.
  fs.writeFileSync(background.lockFile(box.brain), JSON.stringify({ pid: 2 ** 22 - 3, token: 'dead' }));
  assert.equal(background.lockState(box.brain).stale, true);
  byHand(box, 'areas/health/card.md', '# Health\n\nThe physiotherapist is on Tuesdays.\n');
  const ran = json(box, ['sync', '--quick', '--background', '--brain', box.brain], { env });
  assert.equal(ran.data.changed, 1);
  assert.equal(fs.existsSync(background.lockFile(box.brain)), false, 'the sync must give the lock back');

  // Switched off, nothing is started.
  assert.deepEqual(background.start(box.brain, { env: box.env }), { started: false, why: 'off' });
});
