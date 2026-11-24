'use strict';

// What a brain promises: nothing is deleted, every decision can be found again, and a write either
// happened or did not. One test per way each of those was once broken.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { ROOT, newBrain, cogby, json, git } = require('./helpers.cjs');

// The in-process writes below must not leave a detached sync behind.
process.env.COGBY_NO_BACKGROUND_SYNC = '1';

const page = require(path.join(ROOT, 'core', 'brain', 'page.cjs'));
const read = (box, rel) => fs.readFileSync(path.join(box.brain, ...rel.split('/')), 'utf8');

// ---- a fact is superseded only when told ---------------------------------------------------------

test('remember never supersedes on a guess: a similar fact is named, and replaced only with --replaces', (t) => {
  const box = newBrain(t);
  const base = ['--brain', box.brain];
  const sara = json(box, ['remember', 'areas/team', 'Sara\'s email is sara@acme.com', '--source', 't', '--create', ...base]);
  assert.equal(sara.data.status, 'inserted');
  assert.equal(sara.data.similar_row, null);

  const tom = json(box, ['remember', 'areas/team', 'Tom\'s email is tom@acme.com', '--source', 't', ...base]);
  assert.equal(tom.code, 0, tom.err || tom.out);
  assert.deepEqual([tom.data.status, tom.data.row, tom.data.superseded_row, tom.data.similar_row, tom.data.similar_claim],
    ['inserted', 2, null, 1, 'Sara\'s email is sara@acme.com']);
  let facts = page.parsePage('areas/team.md', read(box, 'areas/team.md')).facts;
  assert.deepEqual(facts.map((fact) => [fact.row, page.factStatus(fact)]), [[1, 'active'], [2, 'active']], 'both facts stand');

  // The person is told, and told how to replace it if that is what they meant.
  const said = cogby(box, ['remember', 'areas/team', 'Tom\'s phone is 555 0101', '--source', 't', ...base]).out;
  assert.match(said, /^inserted: fact #3 on areas\/team/);
  assert.doesNotMatch(said, /Looks like/, 'no near match, nothing said');
  const near = cogby(box, ['remember', 'areas/team', 'Sara\'s email is sara@acme.org', '--source', 'her signature', ...base]).out;
  assert.match(near, /^inserted: fact #4 on areas\/team/);
  assert.match(near, /Looks like fact #1 \("Sara's email is sara@acme\.com"\), which is still active\./);
  assert.match(near, /--replaces 1/);

  // The same claim again, now with --replaces: the old row is retired and no second copy is written.
  const replaced = json(box, ['remember', 'areas/team', 'Sara\'s email is sara@acme.org', '--source', 'her signature', '--replaces', '1', ...base]);
  assert.deepEqual([replaced.data.status, replaced.data.row, replaced.data.superseded_row], ['superseded', 4, 1]);
  facts = page.parsePage('areas/team.md', read(box, 'areas/team.md')).facts;
  assert.deepEqual(facts.map((fact) => [fact.row, page.factStatus(fact)]), [[1, 'superseded by #4'], [2, 'active'], [3, 'active'], [4, 'active']]);
  assert.match(read(box, 'areas/team.md'), /sara@acme\.com/, 'the replaced fact stays on the page');
  assert.equal(json(box, ['remember', 'areas/team', 'Sara\'s email is sara@acme.org', '--source', 'x', ...base]).data.status, 'duplicate');
  assert.equal(json(box, ['remember', 'areas/team', 'A new claim', '--source', 'x', '--replaces', '9', ...base]).data.error.code, 'NO_FACT');

  // The tool says the same in its result.
  const tool = require(path.join(ROOT, 'core', 'brain', 'mcp.cjs')).TOOLS.find((entry) => entry.name === 'remember');
  const viaTool = tool.run(box.brain, { slug: 'areas/team', claim: 'Tom\'s email is tom@acme.org', source: 't' });
  assert.deepEqual([viaTool.status, viaTool.superseded_row, viaTool.similar_row], ['inserted', null, 2]);
  assert.match(viaTool.note, /Fact #2 looks like this one .* nothing was superseded\. .* replaces: 2/);
  assert.doesNotMatch(tool.description, /superseded;/);
});

// ---- a decision is found again, whatever its source looks like ------------------------------------

test('a dash in a source does not hide the decision behind it', (t) => {
  const box = newBrain(t);
  const base = ['--brain', box.brain];
  const sources = ['call with Sara -- 2026-11-12', 'call with Sara — 2026-11-12', 'notes -- draft -- v2', '-- scribbled --'];
  for (const source of sources) {
    const line = page.renderTimelineLine({ date: '2026-11-12', source, summary: 'decision: go with Postgres', author: 'yasser', actor: 'human', confirmed: true });
    const parsed = page.parseTimelineLine(line);
    assert.equal(parsed.summary, 'decision: go with Postgres', line);
    assert.equal(parsed.source, page.cleanSource(source), 'the source reads back as it was written');
    assert.ok(page.isDecision(parsed) && parsed.decision, line);
  }
  assert.equal(page.cleanSource('call with Sara -- 2026-11-12'), 'call with Sara - 2026-11-12');
  assert.equal(page.cleanSource('PR #12 - re-run, a well-known fix'), 'PR #12 - re-run, a well-known fix', 'a hyphen is left alone');

  const made = json(box, ['log', 'projects/db', 'go with Postgres', '--decision', '--who', 'owner', '--source', 'call with Sara -- 2026-11-12', '--date', '2026-11-12', '--create', ...base]);
  assert.equal(made.code, 0, made.err || made.out);
  assert.match(made.data.line, /^- \*\*2026-11-12\*\* \| call with Sara - 2026-11-12 — decision: go with Postgres \(who: owner\) \[/);
  const listed = json(box, ['decisions', ...base]).data.decisions;
  assert.deepEqual(listed.map((d) => [d.text, d.source, d.who]), [['go with Postgres', 'call with Sara - 2026-11-12', 'owner']]);
  // The same line given again is still seen as the same line.
  const again = json(box, ['log', 'projects/db', 'go with Postgres', '--decision', '--who', 'owner', '--source', 'call with Sara -- 2026-11-12', '--date', '2026-11-12', ...base]);
  assert.equal(again.data.status, 'duplicate');
  // How it turned out is found too, with a dash in that source.
  const reviewed = json(box, ['decisions', 'review', listed[0].id, 'as-expected', '--source', 'retro — 2027-01-10', ...base]);
  assert.equal(reviewed.code, 0, reviewed.err || reviewed.out);
  assert.equal(json(box, ['decisions', ...base]).data.decisions[0].outcome, 'as expected');
});

test('a line already on disk with a dash in its source is found as a decision; a hand-written line reads as before', (t) => {
  const old = page.parseTimelineLine('- **2026-11-12** | call with Sara -- 2026-11-12 — decision: go with Postgres (who: owner) [yasser · agent · unconfirmed]');
  assert.deepEqual([old.source, old.summary, old.decision], ['call with Sara -- 2026-11-12', 'decision: go with Postgres (who: owner)', true]);
  const review = page.parseTimelineLine('- **2027-01-10** | retro -- 2027-01-10 — reviewed: reversed, decision of 2026-11-12 #3fa2c1 "go with Postgres". [yasser · human · confirmed]');
  assert.equal(page.parseReview(review).outcome, 'reversed');

  // Hand-written lines, and any line whose summary holds a dash, are cut at the first dash as always.
  const same = (line, source, summary) => { const parsed = page.parseTimelineLine(line); assert.deepEqual([parsed.source, parsed.summary], [source, summary], line); };
  same('- **2026-11-05** | Meeting — UAT moved — to 18 Nov', 'Meeting', 'UAT moved — to 18 Nov');
  same('- **2026-11-05** | Meeting -- UAT moved -- to 18 Nov [yasser · human · confirmed]', 'Meeting', 'UAT moved -- to 18 Nov');
  same('- **2026-11-05** | Meeting — we talked — decision: later', 'Meeting', 'we talked — decision: later');
  same('- **2026-11-05** | call — decision: ship it — the audit is done [yasser · human · confirmed]', 'call', 'decision: ship it — the audit is done');
  same('- **2026-11-05** | Kickoff held', '', 'Kickoff held');

  // In a brain: the old line is on a page already, and the decision log lists it after a sync.
  const box = newBrain(t);
  const dir = path.join(box.brain, 'projects');
  fs.writeFileSync(path.join(dir, 'db.md'), '---\ntype: project\ntitle: Db\n---\n# Db\n\n<!-- timeline -->\n'
    + '- **2026-11-12** | call with Sara -- 2026-11-12 — decision: go with Postgres [yasser · agent · unconfirmed]\n');
  assert.equal(cogby(box, ['sync', '--brain', box.brain]).code, 0);
  assert.deepEqual(json(box, ['decisions', '--brain', box.brain]).data.decisions.map((d) => d.text), ['go with Postgres']);
});

// ---- a store that cannot be read is never taken for an empty one ---------------------------------

test('a corrupt to-do, note or notification store refuses the write and is left untouched', (t) => {
  const box = newBrain(t);
  const base = ['--brain', box.brain];
  const stores = {
    todo: { file: path.join(box.brain, '.cogby', 'todos', 'store.json'), add: ['todo', 'add', 'two'], list: ['todo', '--all'], key: 'todos' },
    note: { file: path.join(box.brain, '.cogby', 'notes', 'store.json'), add: ['note', 'add', 'two'], list: ['note', '--all'], key: 'notes' },
    notify: { file: path.join(box.brain, '.cogby', 'notifications', 'store.json'), add: ['notify', 'add', '--title', 'two'], list: ['notify', 'list', '--all'], key: 'notifications' },
  };
  assert.equal(json(box, ['todo', 'add', 'one', ...base]).code, 0);
  assert.equal(json(box, ['note', 'add', 'one', ...base]).code, 0);
  assert.equal(json(box, ['notify', 'add', '--title', 'one', ...base]).code, 0);
  const todoId = json(box, ['todo', '--all', ...base]).data.todos[0].id;

  for (const [name, store] of Object.entries(stores)) {
    const good = fs.readFileSync(store.file, 'utf8');
    for (const broken of ['{broken', '', '{"version":1}', '[]']) {
      fs.writeFileSync(store.file, broken);
      const refused = json(box, [...store.add, ...base]);
      assert.notEqual(refused.code, 0, `${name}: a write over ${JSON.stringify(broken)} must be refused`);
      assert.equal(refused.data.error.code, 'STORE_UNREADABLE');
      assert.ok(refused.data.error.message.includes(store.file), 'the error names the file');
      // The hint is a command the owner can paste: `git log -- <file>`, with the space after the dashes.
      assert.doesNotMatch(refused.data.error.hint, /git log --S/, `${name}: the git command in the hint runs as written`);
      if (name !== 'notify') assert.match(refused.data.error.hint, new RegExp(`git log -- \.cogby/${store.key}/store\.json`));
      assert.equal(fs.readFileSync(store.file, 'utf8'), broken, `${name}: the unreadable file is left exactly as it is`);
      // A list shows nothing, and says that is because the store cannot be read.
      const listed = json(box, [...store.list, ...base]);
      assert.equal(listed.code, 0);
      assert.deepEqual(listed.data[store.key], []);
      assert.equal(listed.data.unreadable.file, store.file);
      assert.match(cogby(box, [...store.list, ...base]).out, /store cannot be read, so nothing is shown: .*store\.json/);
    }
    if (name === 'todo') {
      fs.writeFileSync(store.file, '{broken');
      assert.equal(json(box, ['todo', 'done', todoId, ...base]).data.error.code, 'STORE_UNREADABLE', 'changing one is a write too');
      assert.equal(fs.readFileSync(store.file, 'utf8'), '{broken');
    }
    // Repaired, everything that was there is there again, and writes go through.
    fs.writeFileSync(store.file, good);
    assert.equal(json(box, [...store.add, ...base]).code, 0);
    const back = json(box, [...store.list, ...base]).data;
    assert.equal(back.unreadable, undefined);
    assert.deepEqual(back[store.key].map((item) => item.text || item.title).sort(), ['one', 'two']);
  }
  // A store that is not there yet is simply empty.
  fs.rmSync(stores.todo.file);
  assert.deepEqual(json(box, ['todo', '--all', ...base]).data.todos, []);
  assert.equal(json(box, ['todo', 'add', 'fresh', ...base]).code, 0);
});

// ---- a run is recorded on the routine that ran ---------------------------------------------------

test('a skill or command records its run by what a routine runs, never by a name that starts the same', (t) => {
  const box = newBrain(t);
  const base = ['--brain', box.brain];
  const add = (name, run) => assert.equal(json(box, ['routines', 'add', name, '--run', run, '--rhythm', 'daily', ...base]).code, 0);
  add('Dream journal', 'write my journal');
  add('Check-in weekly notes', 'email Sara the weekly numbers');
  add('Wrap-up notes', 'tidy the notes folder');
  add('Dream', 'write down last night\'s dream');
  const ran = (name) => /— ran/.test(read(box, `areas/routines/${name}.md`));

  const pass = json(box, ['dream', ...base]);
  assert.equal(pass.code, 0, pass.err || pass.out);
  assert.deepEqual(pass.data.routines_recorded, [], 'no routine runs the nightly pass');
  assert.ok(!ran('dream-journal') && !ran('dream'), 'a routine named like the command did not run');

  for (const what of ['check-in, weekly', 'wrap-up', 'dream']) {
    const own = json(box, ['routines', 'ran', what, '--if-any', '--source', 'its own run', ...base]);
    assert.equal(own.code, 0, own.err || own.out);
    assert.deepEqual(own.data.recorded, [], `"${what}" is what ran, and no routine runs it`);
  }
  assert.ok(!ran('check-in-weekly-notes') && !ran('wrap-up-notes') && !ran('dream-journal') && !ran('dream'));

  // A routine that does run it gets the line, and only that one.
  add('Nightly tidy-up', 'cogby dream');
  assert.deepEqual(json(box, ['dream', ...base]).data.routines_recorded, ['nightly-tidy-up']);
  assert.ok(ran('nightly-tidy-up') && !ran('dream-journal') && !ran('dream'));

  // Naming a routine still works: by its exact name or title.
  assert.deepEqual(json(box, ['routines', 'ran', 'dream-journal', '--source', 'session', ...base]).data.recorded.map((entry) => entry.name), ['dream-journal']);
  assert.deepEqual(json(box, ['routines', 'ran', 'Dream', '--source', 'session', ...base]).data.recorded.map((entry) => entry.name), ['dream']);
  assert.ok(ran('dream-journal') && ran('dream'));
});

// ---- a write happens whole, or not at all --------------------------------------------------------

test('a write that cannot be indexed leaves the page as it was, on disk and in git', (t) => {
  const box = newBrain(t);
  const base = ['--brain', box.brain];
  assert.equal(json(box, ['log', 'projects/demo', 'Kickoff held', '--source', 'call', '--create', ...base]).code, 0);
  assert.equal(json(box, ['log', 'log:2026-11-11', 'No Friday deploys', '--decision', '--source', 'standup', ...base]).code, 0);
  const file = path.join(box.brain, 'projects', 'demo.md');
  const dayLog = (day) => path.join(box.brain, '.cogby', 'self', 'log', `${day}.md`);
  const before = fs.readFileSync(file);
  const logBefore = fs.readFileSync(dayLog('2026-11-11'));
  const head = git(box.brain, ['rev-parse', 'HEAD']);
  const status = git(box.brain, ['status', '--porcelain']);

  // The index step is made to fail, as it does when a sync holds the database past the wait.
  const brainLib = require(path.join(ROOT, 'core', 'brain', 'brain.cjs'));
  const writePath = require.resolve(path.join(ROOT, 'core', 'brain', 'write.cjs'));
  const real = brainLib.indexFile;
  t.after(() => { brainLib.indexFile = real; delete require.cache[writePath]; });
  brainLib.indexFile = () => { const error = new Error('database is locked'); error.code = 'ERR_SQLITE_ERROR'; throw error; };
  delete require.cache[writePath];
  const failing = require(writePath);
  const who = { env: box.env, author: 'tester', actor: 'human' };

  assert.throws(() => failing.log(box.brain, 'projects/demo', 'Second line', { ...who, source: 'call' }), /database is locked/);
  assert.deepEqual(fs.readFileSync(file), before, 'an existing page is put back byte for byte');
  assert.throws(() => failing.remember(box.brain, 'projects/demo', 'Budget is 10k', { ...who, source: 'email' }), /database is locked/);
  assert.deepEqual(fs.readFileSync(file), before);
  // A page the write would have created is not left behind.
  assert.throws(() => failing.remember(box.brain, 'projects/fresh', 'Budget is 10k', { ...who, source: 'email', create: true }), /database is locked/);
  assert.equal(fs.existsSync(path.join(box.brain, 'projects', 'fresh.md')), false);
  // The day's log: the appended line is taken back, and a log that was not there is not made.
  assert.throws(() => failing.log(box.brain, 'log:2026-11-11', 'Second decision', { ...who, source: 'standup', decision: true }), /database is locked/);
  assert.deepEqual(fs.readFileSync(dayLog('2026-11-11')), logBefore);
  assert.throws(() => failing.log(box.brain, 'log:2026-11-12', 'A decision', { ...who, source: 'standup', decision: true }), /database is locked/);
  assert.equal(fs.existsSync(dayLog('2026-11-12')), false);

  assert.deepEqual(fs.readdirSync(path.join(box.brain, 'projects')).filter((name) => /\.tmp$/.test(name)), [], 'no temporary file is left');
  assert.equal(fs.existsSync(path.join(box.brain, '.cogby', 'write.lock')), false, 'the lock is released');
  assert.equal(git(box.brain, ['rev-parse', 'HEAD']), head, 'nothing was committed');
  assert.equal(git(box.brain, ['status', '--porcelain']), status, 'nothing is left changed in the working tree');
  // The index still holds the page as it was.
  assert.doesNotMatch(cogby(box, ['get', 'projects/demo', ...base]).out, /Second line|Budget is 10k/);

  // With the index working again, the same write goes through whole.
  brainLib.indexFile = real;
  delete require.cache[writePath];
  const working = require(writePath);
  const done = working.log(box.brain, 'projects/demo', 'Second line', { ...who, source: 'call' });
  assert.equal(done.status, 'inserted');
  assert.equal(done.commit.committed, true);
  assert.match(fs.readFileSync(file, 'utf8'), /call — Second line/);
});

test('a commit that fails after the write is reported, and the write stands', (t) => {
  const box = newBrain(t);
  // A commit hook cannot refuse it (--no-verify), so the repository itself is made to: a lock on its index.
  fs.writeFileSync(path.join(box.brain, '.git', 'index.lock'), '');
  t.after(() => fs.rmSync(path.join(box.brain, '.git', 'index.lock'), { force: true }));
  const made = json(box, ['log', 'projects/demo', 'Kickoff held', '--source', 'call', '--create', '--brain', box.brain]);
  assert.equal(made.code, 0, made.err || made.out);
  assert.equal(made.data.commit.committed, false);
  assert.match(made.data.commit.why, /^git (add|commit): /);
  assert.match(read(box, 'projects/demo.md'), /call — Kickoff held/, 'the line is on the page');
  fs.rmSync(path.join(box.brain, '.git', 'index.lock'), { force: true });
  assert.match(cogby(box, ['log', 'projects/demo', 'Second', '--source', 'call', '--brain', box.brain]).out, /commit [0-9a-f]{7}/);
});
