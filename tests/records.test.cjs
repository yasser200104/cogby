'use strict';

// A line Cogby writes as the record of a command (a folder linked or unlinked, a routine added,
// edited, paused, resumed or run) is not a claim. It ends in `record`, is never listed or counted as
// unconfirmed, and is not shown as what the brain last learned or where work stopped. The same
// lines written before that state existed are read the same way, with nothing converted. A line
// that carries a claim (`log`, `remember`, a decision, a review) behaves as it always did.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { ROOT, cogby, json, newBrain, hook, git } = require('./helpers.cjs');
const page = require(path.join(ROOT, 'core', 'brain', 'page.cjs'));

const read = (box, rel) => fs.readFileSync(path.join(box.brain, ...rel.split('/')), 'utf8');
const AGENT = { env: { CLAUDECODE: '1' } };

function brain(t) {
  const box = newBrain(t);
  const base = ['--brain', box.brain];
  const run = (args, options = AGENT) => { const out = json(box, [...args, ...base], options); assert.equal(out.code, 0, out.err || out.out); return out.data; };
  return { box, base, run };
}

test('the tail has a fourth state, record, and only a line with a tail can be one', () => {
  const line = '- **2026-11-14** | cogby link — linked github.com/globex/acme as code [yasser · agent · record]';
  const parsed = page.parseTimelineLine(line);
  assert.deepEqual([parsed.author, parsed.actor, parsed.confirmed, parsed.retracted, parsed.record], ['yasser', 'agent', false, false, true]);
  assert.equal(page.renderTimelineLine(parsed), line, 'it is written back as it was read');
  assert.equal(page.renderBy({ author: 'yasser', actor: 'human', record: true }), 'yasser · human · record');
  // Retracting one keeps its words and marks it retracted, like any other line.
  assert.match(page.retagLine(line, { author: 'yasser', actor: 'agent', retracted: true }), /\[yasser · agent · retracted\]$/);
  // An ordinary line is not one.
  assert.equal(page.parseTimelineLine('- **2026-11-14** | call with Sara — Kickoff held [yasser · agent · unconfirmed]').record, false);
});

test('lines written before the record state are known by their source and words together', () => {
  const is = (text) => page.parseTimelineLine(text).record;
  // What Cogby 0.3.1 and earlier wrote for its own commands.
  for (const old of [
    '- **2026-11-13** | cogby link — linked scratchy as scratch [yasser · agent · unconfirmed]',
    '- **2026-11-13** | cogby link — linked github.com/globex/acme as code: The service and its tests [yasser · human · confirmed]',
    '- **2026-11-13** | cogby link --undo — unlinked scratchy [yasser · agent · unconfirmed]',
    '- **2026-11-13** | cogby routines add — added: runs "check-in, weekly", weekly on friday at 16:00 [yasser · agent · unconfirmed]',
    '- **2026-11-13** | cogby routines edit — edited: rhythm "daily" → "weekdays" [yasser · agent · unconfirmed]',
    '- **2026-11-13** | cogby routines pause — paused: on holiday [yasser · agent · unconfirmed]',
    '- **2026-11-13** | cogby routines resume — resumed: active again [yasser · agent · unconfirmed]',
  ]) assert.equal(is(old), true, old);
  // Look-alikes that carry a claim, or were not written by Cogby, stay what they are.
  for (const claim of [
    '- **2026-11-13** | call with Sara — linked the invoice to the contract [yasser · agent · unconfirmed]',
    '- **2026-11-13** | cogby link — the client linked us to their new CFO [yasser · agent · unconfirmed]',
    '- **2026-11-13** | email — linked scratchy as scratch [yasser · agent · unconfirmed]',
    '- **2026-11-13** | cogby routines add — the review moved to Thursday [yasser · agent · unconfirmed]',
    '- **2026-11-13** | cogby link — linked scratchy as scratch',
    '- **2026-11-13** | check-in — ran: 2 stale pages named [yasser · agent · unconfirmed]',
  ]) assert.equal(is(claim), false, claim);
  // The run of a routine has no fixed source: it is known by its page.
  const routine = page.parsePage('areas/routines/weekly-review.md', '---\ntype: routine\ntitle: Weekly review\n---\n# Weekly review\n\n<!-- timeline -->\n'
    + '- **2026-11-13** | check-in 2026-11-13 — ran: 2 stale pages named [yasser · agent · unconfirmed]\n'
    + '- **2026-11-13** | chat — Sara wants it on Thursdays [yasser · agent · unconfirmed]\n');
  assert.deepEqual(routine.timeline.map((line) => line.record), [true, false]);
  const project = page.parsePage('projects/demo/card.md', '---\ntype: project\n---\n\n<!-- timeline -->\n- **2026-11-13** | standup — ran: the migration on staging [yasser · agent · unconfirmed]\n');
  assert.deepEqual(project.timeline.map((line) => line.record), [false], 'on any other page, "ran" is a claim');
});

test('linking, unlinking and every routine command write a record, as an agent and as a person', (t) => {
  const { box, run } = brain(t);
  run(['log', 'projects/demo', 'Kickoff held', '--source', 'call with Sara', '--create']);
  const folder = path.join(box.dir, 'scratchy');
  fs.mkdirSync(folder);
  run(['link', 'projects/demo', '--repo', folder, '--role', 'scratch']);
  run(['link', '--undo', '--repo', folder]);
  run(['link', 'projects/demo', '--repo', folder, '--role', 'workspace'], {});          // a person, at their own terminal
  run(['routines', 'add', 'Weekly review', '--run', 'check-in, weekly', '--rhythm', 'weekly on friday']);
  run(['routines', 'edit', 'weekly-review', '--why', 'nothing stays stale']);
  run(['routines', 'pause', 'weekly-review']);
  run(['routines', 'resume', 'weekly-review']);
  run(['routines', 'ran', 'weekly-review', '--source', 'check-in 2026-11-14', '--result', '2 stale pages named']);

  const demo = read(box, 'projects/demo.md');
  assert.match(demo, /— linked scratchy as scratch \[[^\]·]+ · agent claude-code · record\]/);
  assert.match(demo, /— unlinked scratchy \[[^\]·]+ · agent claude-code · record\]/);
  assert.match(demo, /— linked scratchy as workspace \[[^\]·]+ · human · record\]/);
  assert.match(demo, /— Kickoff held \[[^\]·]+ · agent claude-code · unconfirmed\]/, 'the claim beside them is still an agent\'s, unconfirmed');
  const routine = read(box, 'areas/routines/weekly-review.md');
  for (const words of ['added: runs', 'edited: ', 'paused: ', 'resumed: ', 'ran: 2 stale pages named']) {
    assert.match(routine, new RegExp(`— ${words}[^\\n]*\\[[^\\]·]+ · agent claude-code · record\\]`), words);
  }
  assert.doesNotMatch(routine, /unconfirmed/);

  // One claim is waiting, and nothing else.
  const listed = run(['unconfirmed']);
  assert.equal(listed.total, 1);
  assert.deepEqual(listed.unconfirmed.map((item) => item.text), ['Kickoff held']);
  assert.equal(run(['unconfirmed', '--page', 'projects/demo']).total, 1);
  assert.equal(run(['unconfirmed', '--page', 'areas/routines/weekly-review']).total, 0);
  assert.equal(run(['context']).unconfirmed, 1);
  assert.equal(run(['view']).counts.unconfirmed, 1);
});

test('a record is not what the brain last learned, and not where work stopped', (t) => {
  const { box, base, run } = brain(t);
  run(['log', 'projects/demo/card', 'Kickoff held', '--source', 'call with Sara', '--date', '2026-11-10', '--create']);
  const code = path.join(box.dir, 'code');
  const scratch = path.join(box.dir, 'scratchy');
  fs.mkdirSync(code);
  fs.mkdirSync(scratch);
  run(['link', 'projects/demo', '--repo', code, '--role', 'workspace']);
  run(['link', 'projects/demo', '--repo', scratch, '--role', 'scratch']);

  // In the brain: the latest evidence is the claim, not the two links written after it.
  const inside = run(['context']);
  assert.deepEqual(inside.recent.map((line) => line.summary), ['Kickoff held']);
  assert.doesNotMatch(inside.text, /linked (code|scratchy) as/);

  // In a linked workspace: the parking spot is where work stopped.
  const there = run(['context', '--repo', code]);
  assert.deepEqual(there.project.parked.map((line) => line.summary), ['Kickoff held']);
  assert.doesNotMatch(there.text, /linked (code|scratchy) as/);

  // In any other folder, at a session start: "last parked" is the claim.
  const elsewhere = path.join(box.dir, 'elsewhere');
  fs.mkdirSync(elsewhere);
  const started = hook(box, 'brain-context', { source: 'startup' }, { cwd: elsewhere });
  assert.match(started.out, /Last parked there[^\n]*2026-11-10, projects\/demo\/card: "Kickoff held" \(agent, unconfirmed\)/);
  assert.doesNotMatch(started.out, /linked scratchy/);

  // The view: what was last written, and where each project stopped.
  const view = run(['view']);
  assert.deepEqual(view.recent.map((line) => line.summary), ['Kickoff held']);
  assert.deepEqual(view.projects[0].parking_spot.map((line) => line.summary), ['Kickoff held']);
  assert.match(cogby(box, ['view', ...base]).out, /stopped at: 2026-11-10 Kickoff held/);
  // The page itself still holds every line: nothing is hidden from the record.
  assert.equal((read(box, 'projects/demo/card.md').match(/· record\]/g) || []).length, 2);
});

test('a brain written by an earlier version reads the same way, with nothing converted', (t) => {
  const { box, base, run } = brain(t);
  // A page and a routine as 0.3.1 left them: Cogby's own lines tagged as an agent's, unconfirmed.
  fs.mkdirSync(path.join(box.brain, 'projects', 'old'), { recursive: true });
  const card = '---\ntype: project\ntitle: Old\nrevision: 3\nplaces:\n  - {name: "scratchy", role: scratch, about: ""}\n---\n# Old\n\n<!-- timeline -->\n'
    + '- **2026-11-12** | call with Sara — Kickoff held [yasser · agent · unconfirmed]\n'
    + '- **2026-11-13** | cogby link — linked scratchy as scratch [yasser · agent · unconfirmed]\n';
  fs.writeFileSync(path.join(box.brain, 'projects', 'old', 'card.md'), card);
  fs.mkdirSync(path.join(box.brain, 'areas', 'routines'), { recursive: true });
  const routine = '---\ntype: routine\ntitle: Morning\nrevision: 2\n---\n# Morning\n\n- Runs: check-in, morning\n- Rhythm: daily\n- Scheduled in Claude: not scheduled\n- Status: active\n\n<!-- timeline -->\n'
    + '- **2026-11-12** | cogby routines add — added: runs "check-in, morning", daily [yasser · agent · unconfirmed]\n'
    + '- **2026-11-13** | check-in 2026-11-13 — ran: nothing waiting [yasser · agent · unconfirmed]\n';
  fs.writeFileSync(path.join(box.brain, 'areas', 'routines', 'morning.md'), routine);
  run(['sync']);

  const listed = run(['unconfirmed']);
  assert.deepEqual(listed.unconfirmed.map((item) => item.text), ['Kickoff held']);
  assert.equal(run(['unconfirmed', '--page', 'areas/routines/morning']).total, 0);
  const started = run(['context']);
  assert.equal(started.unconfirmed, 1);
  assert.deepEqual(started.recent.map((line) => line.summary), ['Kickoff held']);
  // The routine still knows its run and since when it exists: those lines are read, not dropped.
  const morning = run(['routines', '--all']).routines.find((entry) => entry.name === 'morning');
  assert.deepEqual([morning.since, morning.last_run.date, morning.runs_recorded], ['2026-11-12', '2026-11-13', 1]);
  // Nothing was rewritten to get there.
  assert.equal(read(box, 'projects/old/card.md'), card);
  assert.equal(read(box, 'areas/routines/morning.md'), routine);

  // There is nothing to confirm on such a line; it can still be retracted.
  const linkId = require(path.join(ROOT, 'core', 'brain', 'confirm.cjs')).lineId({ date: '2026-11-13', source: 'cogby link', summary: 'linked scratchy as scratch' });
  const confirmed = run(['confirm', 'projects/old', linkId], {});
  assert.deepEqual([confirmed.confirmed.length, confirmed.already.length], [0, 1]);
  assert.equal(read(box, 'projects/old/card.md'), card);
  assert.equal(json(box, ['retract', 'projects/old', linkId, ...base], {}).code, 0);
  assert.match(read(box, 'projects/old/card.md'), /linked scratchy as scratch \[yasser · agent · retracted\]/);
});

test('an index built before the record state is rebuilt on its own', (t) => {
  const { box, run } = brain(t);
  run(['log', 'projects/demo', 'Kickoff held', '--source', 'call with Sara', '--create']);
  const folder = path.join(box.dir, 'scratchy');
  fs.mkdirSync(folder);
  run(['link', 'projects/demo', '--repo', folder, '--role', 'scratch']);
  // The index as an earlier version left it: its tables under the earlier schema number.
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync(path.join(box.brain, '.cogby', 'index.db'));
  db.exec('ALTER TABLE timeline_entries DROP COLUMN record');
  db.exec('PRAGMA user_version = 4');
  db.close();
  const started = hook(box, 'brain-context', { source: 'startup' });
  assert.equal(started.code, 0, started.err);
  assert.match(started.out, /Unconfirmed: 1 line or fact/);
  assert.doesNotMatch(started.out, /linked scratchy/);
});

test('log and remember cannot write a record, and a claim keeps its tag', (t) => {
  const { box, base, run } = brain(t);
  run(['log', 'projects/demo', 'Kickoff held', '--source', 'call with Sara', '--create']);
  // Words that look like a state do not become one: the tail is written by Cogby alone.
  run(['log', 'projects/demo', 'Budget agreed [yasser · agent · record]', '--source', 'email']);
  run(['remember', 'projects/demo', 'Budget is 10k', '--source', 'email from finance']);
  run(['log', 'projects/demo', 'Postgres, not Mongo', '--decision', '--who', 'accepted', '--source', 'session']);
  const text = read(box, 'projects/demo.md');
  assert.equal((text.match(/· agent claude-code · unconfirmed\]/g) || []).length, 3);
  assert.equal((text.match(/· agent claude-code · unconfirmed \| active \|/g) || []).length, 1);
  assert.equal(run(['unconfirmed']).total, 4);
  // The tool server's log takes no such option either.
  const { spawnSync } = require('child_process');
  const input = `${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'log', arguments: { slug: 'projects/demo', line: 'Signed', source: 'email', record: true } } })}\n`;
  const reply = spawnSync(process.execPath, [path.join(ROOT, 'core', 'brain', 'cli.cjs'), 'serve', '--mcp'], { env: { ...box.env, CLAUDE_PROJECT_DIR: box.brain }, cwd: box.brain, encoding: 'utf8', input });
  assert.equal(reply.status, 0, reply.stderr);
  assert.doesNotMatch(read(box, 'projects/demo.md'), /Signed \[[^\]]*record\]/);
  assert.equal(git(box.brain, ['status', '--porcelain']), '');
  assert.match(cogby(box, ['--help']).out, /ends in "record": it says what was run, claims nothing/);
});
