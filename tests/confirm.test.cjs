'use strict';

// The confirmed/unconfirmed tag doing work (core/brain/confirm.cjs): what an agent wrote is listed,
// the owner confirms or retracts it, an agent cannot do either on its own, and a session is told
// which of the lines it reads are an agent's and unconfirmed.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { ROOT, CLI, cogby, json, newBrain, git } = require('./helpers.cjs');
const page = require(path.join(ROOT, 'core', 'brain', 'page.cjs'));
const confirmLib = require(path.join(ROOT, 'core', 'brain', 'confirm.cjs'));

const read = (box, rel) => fs.readFileSync(path.join(box.brain, ...rel.split('/')), 'utf8');
const SKILLS = path.join(ROOT, '.claude', 'skills');
const skill = (name) => fs.readFileSync(path.join(SKILLS, name, 'SKILL.md'), 'utf8').replace(/\r\n/g, '\n');

// A brain with one page an agent and a person both wrote on: two agent lines, one of them a
// decision, one line of the owner's, two agent facts and one of the owner's.
function seeded(t) {
  const box = newBrain(t);
  const base = ['--brain', box.brain];
  const run = (args) => { const out = json(box, [...args, ...base]); assert.equal(out.code, 0, out.err || out.out); return out.data; };
  const kickoff = run(['log', 'projects/demo', 'Kickoff held', '--source', 'call with Sara', '--date', '2026-11-10', '--create', '--agent']);
  run(['log', 'projects/demo', 'Scope agreed', '--source', 'email', '--date', '2026-11-11', '--human']);
  const decided = run(['log', 'projects/demo', 'Postgres, not Mongo: the reporting queries', '--decision', '--who', 'accepted', '--source', 'session', '--date', '2026-11-12', '--agent']);
  run(['remember', 'projects/demo', 'UAT starts 18 Nov', '--kind', 'commitment', '--source', 'meeting 2026-11-05', '--agent']);
  run(['remember', 'projects/demo', 'Budget is 10k', '--source', 'email from finance', '--agent']);
  run(['remember', 'projects/demo', 'Sara signs off', '--source', 'the owner', '--human']);
  return { box, base, run, kickoff, decided };
}

function serve(box, requests) {
  const input = requests.map((request, index) => JSON.stringify({ jsonrpc: '2.0', id: index + 1, ...request })).join('\n') + '\n';
  const result = spawnSync(process.execPath, [CLI, 'serve', '--mcp'], { env: { ...box.env, CLAUDE_PROJECT_DIR: box.brain }, cwd: box.brain, encoding: 'utf8', input });
  return result.stdout.trim().split('\n').map((line) => JSON.parse(line));
}
const call = (name, args = {}) => ({ method: 'tools/call', params: { name, arguments: args } });
const body = (reply) => JSON.parse(reply.result.content[0].text);

test('a line keeps three states in its tail, and only the tail is ever rewritten', () => {
  const line = '- **2026-11-10** | call with Sara — Kickoff held [yasser · agent · unconfirmed]';
  const confirmed = page.retagLine(line, { author: 'yasser', actor: 'agent', confirmed: true });
  assert.equal(confirmed, '- **2026-11-10** | call with Sara — Kickoff held [yasser · agent · confirmed]');
  const retracted = page.retagLine(line, { author: 'yasser', actor: 'agent', retracted: true });
  assert.equal(retracted, '- **2026-11-10** | call with Sara — Kickoff held [yasser · agent · retracted]');
  const parsed = page.parseTimelineLine(retracted);
  assert.deepEqual([parsed.author, parsed.actor, parsed.confirmed, parsed.retracted, parsed.summary], ['yasser', 'agent', false, true, 'Kickoff held']);
  assert.equal(page.parseTimelineLine(line).retracted, false);
  // A fact is retracted in its status cell, read back, and no longer active.
  const facts = page.parseFacts(page.renderFacts([{ row: 1, claim: 'Budget is 10k', kind: 'fact', valid_from: '2026-11-10', source: 'email', author: 'yasser', actor: 'agent', confirmed: false, retracted_at: '2026-11-13' }]));
  assert.deepEqual([facts[0].retracted_at, page.isActive(facts[0]), page.factStatus(facts[0])], ['2026-11-13', false, 'retracted 2026-11-13']);
  // The id of a line is worked out from its date, source and words, so the same line has the same id.
  assert.match(confirmLib.lineId(page.parseTimelineLine(line)), /^[0-9a-f]{6}$/);
  assert.equal(confirmLib.lineId(page.parseTimelineLine(line)), confirmLib.lineId(page.parseTimelineLine(confirmed)));
  assert.notEqual(confirmLib.lineId(page.parseTimelineLine(line)), confirmLib.lineId({ date: '2026-11-10', source: 'call with Sara', summary: 'Kickoff moved' }));
});

test('unconfirmed lists what an agent wrote and the owner has not confirmed, by page and by project', (t) => {
  const { box, base, run, kickoff, decided } = seeded(t);
  assert.match(kickoff.id, /^[0-9a-f]{6}$/, 'log says how its line is named');
  const listed = run(['unconfirmed']);
  assert.equal(listed.total, 4);
  assert.deepEqual(listed.counts, { lines: 2, facts: 2 });
  assert.deepEqual(listed.unconfirmed.map((item) => [item.kind, item.ref, item.text]).sort(), [
    ['fact', '#1', 'UAT starts 18 Nov'], ['fact', '#2', 'Budget is 10k'],
    ['line', decided.id, 'decision: Postgres, not Mongo: the reporting queries (who: accepted)'], ['line', kickoff.id, 'Kickoff held'],
  ].sort());
  const line = listed.unconfirmed.find((item) => item.ref === kickoff.id);
  assert.deepEqual([line.page, line.date, line.source], ['projects/demo', '2026-11-10', 'call with Sara']);
  assert.ok(!listed.unconfirmed.some((item) => /Scope agreed|Sara signs off/.test(item.text)), 'what a person wrote is not listed');

  // Another page, and a routine's page. The run recorded there is a record of a command, never
  // listed; a claim an agent logged on that page is, when the page is named.
  run(['log', 'areas/health', 'Checkup booked', '--source', 'calendar', '--create', '--agent']);
  run(['routines', 'add', 'Weekly review', '--run', 'check-in, weekly', '--rhythm', 'weekly on friday', '--agent']);
  run(['routines', 'ran', 'weekly-review', '--source', 'check-in 2026-11-13', '--agent']);
  assert.equal(run(['unconfirmed']).total, 5);
  assert.deepEqual(run(['unconfirmed', '--page', 'areas/health']).unconfirmed.map((item) => item.text), ['Checkup booked']);
  assert.equal(run(['unconfirmed', '--project', 'demo']).total, 4);
  assert.equal(run(['unconfirmed', '--page', 'areas/routines/weekly-review']).total, 0);
  run(['log', 'areas/routines/weekly-review', 'Sara wants it on Thursdays', '--source', 'chat', '--agent']);
  assert.deepEqual(run(['unconfirmed', '--page', 'areas/routines/weekly-review']).unconfirmed.map((item) => item.text), ['Sara wants it on Thursdays']);
  assert.equal(run(['unconfirmed']).total, 5, 'a routine\'s page stays out of the whole-brain count');
  assert.equal(run(['unconfirmed', '--limit', '2']).shown, 2);
  assert.equal(json(box, ['unconfirmed', '--page', 'nowhere/at-all', ...base]).data.error.code, 'NOT_FOUND');

  const text = cogby(box, ['unconfirmed', ...base]).out;
  assert.match(text, new RegExp(`${kickoff.id}  2026-11-10  projects/demo  line\\n        Kickoff held\\n        source: call with Sara`));
  assert.match(text, /5 unconfirmed: 3 timeline lines, 2 facts, written by an agent\./);
  assert.match(cogby(box, ['--help']).out, /unconfirmed \[--page SLUG\][\s\S]*confirm <page> <ref>[\s\S]*retract <page> <ref>/);
});

test('confirm rewrites only the tag, keeps who wrote the line, and is one commit of one file', (t) => {
  const { box, base, run, kickoff, decided } = seeded(t);
  const before = read(box, 'projects/demo.md');
  const commits = Number(git(box.brain, ['rev-list', '--count', 'HEAD']));
  const done = run(['confirm', 'projects/demo', kickoff.id, '#1', '--human']);
  assert.deepEqual(done.confirmed.map((item) => [item.ref, item.kind, item.text]), [[kickoff.id, 'line', 'Kickoff held'], ['#1', 'fact', 'UAT starts 18 Nov']]);
  assert.equal(done.commit.committed, true);
  assert.equal(Number(git(box.brain, ['rev-list', '--count', 'HEAD'])), commits + 1, 'several refs on one page are one commit');
  assert.deepEqual(git(box.brain, ['show', '--name-only', '--format=', 'HEAD']).split('\n'), ['projects/demo.md']);
  assert.match(git(box.brain, ['log', '-1', '--format=%s']), new RegExp(`^confirm\\(projects/demo\\): ${kickoff.id}, #1 \\(by `));

  // The file differs from what it was in the two tags and the revision, and in nothing else.
  const after = read(box, 'projects/demo.md');
  const changed = after.split('\n').filter((line, index) => line !== before.split('\n')[index]);
  assert.equal(changed.length, 3);
  assert.match(after, /\| call with Sara — Kickoff held \[[^\]·]+ · agent · confirmed\]/, 'the author and the actor are kept');
  assert.match(after, /\| 1 \| UAT starts 18 Nov \| commitment \|[^\n]*\| [^|·]+ · agent · confirmed \| active \|/);
  assert.equal(before.replace(/unconfirmed/g, 'confirmed').replace(/revision: \d+/, ''), after.replace(/unconfirmed/g, 'confirmed').replace(/revision: \d+/, ''));

  assert.equal(run(['unconfirmed']).total, 2);
  // Confirming it again writes nothing; a decision's own id names its line too.
  const again = run(['confirm', 'projects/demo', kickoff.id, '--human']);
  assert.deepEqual([again.confirmed.length, again.already.length, again.commit.committed], [0, 1, false]);
  const decision = run(['decisions']).decisions[0];
  assert.deepEqual([decision.confirmed, decision.actor], [false, 'agent']);
  assert.equal(run(['confirm', 'projects/demo', decision.id, '--human']).confirmed[0].ref, decision.id);
  assert.equal(run(['decisions']).decisions[0].confirmed, true);
  assert.notEqual(decision.id, decided.id);

  // All or nothing: one ref that names nothing refuses the whole call.
  const head = git(box.brain, ['rev-parse', 'HEAD']);
  const missing = json(box, ['confirm', 'projects/demo', '#2', 'ffffff', '--human', ...base]);
  assert.deepEqual([missing.code, missing.data.error.code], [1, 'NOT_FOUND']);
  assert.equal(json(box, ['confirm', 'projects/demo', 'not-a-ref', '--human', ...base]).data.error.code, 'BAD_REF');
  assert.equal(cogby(box, ['confirm', 'projects/demo', ...base]).code, 2);
  assert.equal(git(box.brain, ['rev-parse', 'HEAD']), head);
  assert.match(read(box, 'projects/demo.md'), /\| 2 \| Budget is 10k \|[^\n]*agent · unconfirmed \| active \|/);
});

test('an agent cannot confirm or retract without the owner\'s yes', (t) => {
  const { box, base, kickoff } = seeded(t);
  const before = read(box, 'projects/demo.md');
  const head = git(box.brain, ['rev-parse', 'HEAD']);
  // From an agent's shell: by the flag, and by the environment a command run from Claude carries,
  // where saying "human" changes nothing.
  for (const [extra, env] of [[['--agent'], {}], [[], { CLAUDECODE: '1', COGBY_ACTOR: '' }], [[], { COGBY_ACTOR: 'agent' }],
    [['--human'], { CLAUDECODE: '1' }], [[], { CLAUDECODE: '1', COGBY_ACTOR: 'human' }]]) {
    for (const command of ['confirm', 'retract']) {
      const refused = json(box, [command, 'projects/demo', kickoff.id, '#1', ...extra, ...base], { env });
      assert.deepEqual([refused.code, refused.data.error.code], [1, 'NEEDS_OWNER'], `${command} ${extra.join(' ')} ${JSON.stringify(env)}`);
      assert.match(refused.data.error.hint, /--confirmed-by-owner/);
    }
  }
  // From the tool server: no flag, or a flag that is not the boolean.
  const refused = serve(box, [
    call('confirm', { action: 'confirm', slug: 'projects/demo', refs: [kickoff.id] }),
    call('confirm', { action: 'confirm', slug: 'projects/demo', refs: [kickoff.id], confirmed_by_owner: 'true' }),
    call('confirm', { action: 'retract', slug: 'projects/demo', refs: ['#2'] }),
  ]);
  for (const reply of refused) {
    assert.equal(reply.result.isError, true);
    assert.equal(body(reply).error.code, 'NEEDS_OWNER');
  }
  assert.equal(read(box, 'projects/demo.md'), before, 'a refused call writes nothing');
  assert.equal(git(box.brain, ['rev-parse', 'HEAD']), head);

  // With the owner's yes, the tool lists, confirms and retracts; the commit says the yes came through an agent.
  const replies = serve(box, [
    call('confirm', { action: 'list', slug: 'projects/demo' }),
    call('confirm', { action: 'confirm', slug: 'projects/demo', refs: [kickoff.id, '#1'], confirmed_by_owner: true }),
    call('confirm', { action: 'retract', slug: 'projects/demo', refs: ['#2'], confirmed_by_owner: true, reason: 'it was 12k' }),
    call('confirm', { action: 'list' }),
  ]);
  assert.equal(body(replies[0]).total, 4);
  assert.deepEqual(body(replies[1]).confirmed.map((item) => item.ref), [kickoff.id, '#1']);
  assert.deepEqual(body(replies[2]).retracted.map((item) => item.ref), ['#2']);
  assert.equal(body(replies[3]).total, 1);
  assert.match(git(box.brain, ['log', '-2', '--format=%s']), /retract\(projects\/demo\): #2: it was 12k \(the owner said so, through an agent\)\nconfirm\(projects\/demo\): [0-9a-f]{6}, #1 \(the owner said so, through an agent\)/);
  // The same from a shell, with the flag.
  assert.equal(json(box, ['retract', 'projects/demo', kickoff.id, '--agent', '--confirmed-by-owner', ...base]).code, 0);
});

test('inside a Claude session a line is an agent\'s whatever the caller says; in a terminal it is the owner\'s', (t) => {
  const box = newBrain(t);
  const base = ['--brain', box.brain];
  const { writer } = require(path.join(ROOT, 'core', 'brain', 'write.cjs'));
  const who = (options, env) => { const by = writer(box.brain, { author: 'tester', ...options, env: { ...box.env, ...env } }); return `${by.actor} ${by.confirmed ? 'confirmed' : 'unconfirmed'}`; };

  // Both sides, through `env`. In a session nothing the caller says makes it a person.
  for (const options of [{}, { actor: 'human' }, { actor: 'agent' }]) {
    for (const said of [{}, { COGBY_ACTOR: 'human' }, { COGBY_ACTOR: 'agent' }]) {
      assert.equal(who(options, { CLAUDECODE: '1', ...said }), 'agent unconfirmed', `${JSON.stringify(options)} ${JSON.stringify(said)}`);
    }
  }
  // Outside one, a person, unless the caller says it is an agent.
  assert.equal(who({}, {}), 'human confirmed');
  assert.equal(who({ actor: 'human' }, {}), 'human confirmed');
  assert.equal(who({}, { COGBY_ACTOR: 'human' }), 'human confirmed');
  assert.equal(who({}, { CLAUDECODE: '' }), 'human confirmed');
  assert.equal(who({ actor: 'agent' }, {}), 'agent unconfirmed');
  assert.equal(who({}, { COGBY_ACTOR: 'agent' }), 'agent unconfirmed');

  // The commands, from Claude's shell: --human and COGBY_ACTOR=human write an agent's line, and say so.
  const inSession = { CLAUDECODE: '1' };
  const logged = json(box, ['log', 'projects/demo', 'Kickoff held', '--source', 'call with Sara', '--date', '2026-11-10', '--create', '--human', ...base], { env: inSession });
  assert.equal(logged.code, 0, logged.err || logged.out);
  assert.match(logged.err, /--human \(or COGBY_ACTOR=human\) is not honoured inside a Claude session/);
  const saved = json(box, ['remember', 'projects/demo', 'Budget is 10k', '--source', 'email from finance', ...base], { env: { ...inSession, COGBY_ACTOR: 'human' } });
  assert.equal(saved.code, 0, saved.err || saved.out);
  assert.match(saved.err, /not honoured inside a Claude session/);
  const folder = path.join(box.dir, 'demo-files');
  fs.mkdirSync(folder);
  assert.equal(json(box, ['link', 'projects/demo', '--repo', folder, '--human', ...base], { env: inSession }).code, 0);
  assert.equal(json(box, ['routines', 'add', 'Weekly review', '--run', 'check-in, weekly', '--rhythm', 'weekly on friday', '--human', ...base], { env: inSession }).code, 0);
  const text = read(box, 'projects/demo.md');
  assert.match(text, /\| call with Sara — Kickoff held \[[^\]·]+ · agent claude-code · unconfirmed\]/);
  assert.match(text, /\| 1 \| Budget is 10k \|[^\n]*\| [^|·]+ · agent claude-code · unconfirmed \| active \|/);
  assert.match(text, /— linked demo-files as workspace \[[^\]·]+ · agent claude-code · record\]/, 'a link is a record, and still says an agent ran it');
  assert.doesNotMatch(text, /human/);
  assert.doesNotMatch(read(box, 'areas/routines/weekly-review.md'), /human/);
  assert.doesNotMatch(git(box.brain, ['log', '--format=%s']), /human/, 'no commit says a person wrote these');

  // The only way such a line becomes confirmed is `cogby confirm` with the owner's yes.
  const refused = json(box, ['confirm', 'projects/demo', logged.data.id, '#1', '--human', ...base], { env: inSession });
  assert.deepEqual([refused.code, refused.data.error.code], [1, 'NEEDS_OWNER']);
  assert.equal(read(box, 'projects/demo.md'), text);
  const yes = json(box, ['confirm', 'projects/demo', logged.data.id, '#1', '--confirmed-by-owner', ...base], { env: inSession });
  assert.equal(yes.code, 0, yes.err || yes.out);
  assert.match(read(box, 'projects/demo.md'), /Kickoff held \[[^\]·]+ · agent claude-code · confirmed\]/, 'confirmed, and still an agent\'s, the same one');
  assert.match(git(box.brain, ['log', '-1', '--format=%s']), /\(the owner said so, through an agent\)$/);

  // The owner's own terminal: theirs and confirmed, with no flag, and nothing said on stderr.
  const own = json(box, ['log', 'projects/demo', 'Scope agreed', '--source', 'email', ...base]);
  assert.equal(own.code, 0, own.err || own.out);
  assert.equal(own.err, '');
  assert.match(read(box, 'projects/demo.md'), /\| email — Scope agreed \[[^\]·]+ · human · confirmed\]/);
  assert.equal(json(box, ['log', 'projects/demo', 'Drafted by a script', '--source', 'cron', '--agent', ...base]).code, 0);
  assert.match(read(box, 'projects/demo.md'), /Drafted by a script \[[^\]·]+ · agent · unconfirmed\]/);
  assert.match(cogby(box, ['--help']).out, /inside a Claude session it is always an agent's and unconfirmed: --human and\nCOGBY_ACTOR=human are not honoured there/);
});

test('a retracted line stays in the file and leaves everything a session reads', (t) => {
  const { box, base, run, kickoff, decided } = seeded(t);
  const done = run(['retract', 'projects/demo', kickoff.id, decided.id, '#1', '--human', '--reason', 'the call was cancelled']);
  assert.deepEqual(done.retracted.map((item) => item.ref), [kickoff.id, decided.id, '#1']);
  const text = read(box, 'projects/demo.md');
  assert.match(text, /- \*\*2026-11-10\*\* \| call with Sara — Kickoff held \[[^\]·]+ · agent · retracted\]/, 'the line is kept, with its words');
  assert.match(text, /\| 1 \| UAT starts 18 Nov \| commitment \|[^\n]*agent · unconfirmed \| retracted \d{4}-\d\d-\d\d \|/);
  assert.match(git(box.brain, ['log', '-1', '--format=%s']), /^retract\(projects\/demo\): .*: the call was cancelled \(by /);

  assert.deepEqual(run(['unconfirmed']).unconfirmed.map((item) => item.ref), ['#2'], 'a retracted line is not waiting to be confirmed');
  assert.equal(run(['decisions', '--all']).decisions.length, 0, 'a retracted decision is no decision');
  assert.deepEqual([run(['get', 'projects/demo']).facts, run(['get', 'projects/demo']).timeline], [2, 1]);
  const context = cogby(box, ['context', ...base], { cwd: box.brain }).out;
  assert.doesNotMatch(context, /Kickoff held|Postgres|UAT starts/);
  assert.match(context, /Scope agreed/);
  assert.doesNotMatch(JSON.stringify(run(['view']).recent), /Kickoff held/);

  // Retracted is not confirmed later, retracting twice writes nothing, and the claim can be saved again.
  assert.equal(json(box, ['confirm', 'projects/demo', kickoff.id, '--human', ...base]).data.error.code, 'RETRACTED');
  assert.equal(json(box, ['confirm', 'projects/demo', '#1', '--human', ...base]).data.error.code, 'RETRACTED');
  assert.deepEqual([run(['retract', 'projects/demo', '#1', '--human']).already.length, run(['retract', 'projects/demo', kickoff.id, '--human']).commit.committed], [1, false]);
  assert.deepEqual([run(['remember', 'projects/demo', 'UAT starts 18 Nov', '--kind', 'commitment', '--source', 'meeting 2026-11-12', '--human']).status,
    run(['log', 'projects/demo', 'Kickoff held', '--source', 'call with Sara', '--date', '2026-11-10', '--human']).status], ['inserted', 'inserted']);
  // A superseded fact is out of use already: there is nothing to retract.
  run(['remember', 'projects/demo', 'Budget is 12k', '--source', 'email', '--replaces', '2', '--human']);
  assert.equal(json(box, ['retract', 'projects/demo', '#2', '--human', ...base]).data.error.code, 'NOT_ACTIVE');
  // The index rebuilt from the files reads the same states.
  run(['sync']);
  assert.equal(run(['unconfirmed']).total, 0);
  assert.equal(run(['decisions', '--all']).decisions.length, 0);
});

test('the session context marks an agent\'s unconfirmed lines and says how many there are', (t) => {
  const { box, base, run, kickoff } = seeded(t);
  const started = run(['context']);
  assert.equal(started.unconfirmed, 4);
  assert.match(started.text, /\nUnconfirmed: 4 lines or facts an agent wrote that the owner has not confirmed \(`cogby unconfirmed` lists them\)\. One marked "\(agent, unconfirmed\)" below is a note to check against its source, not a settled fact\.\n/);
  assert.match(started.text, /## Latest evidence\n[\s\S]*- 2026-11-10 \| projects\/demo \| call with Sara — Kickoff held \(agent, unconfirmed\)\n/);
  assert.match(started.text, /- 2026-11-11 \| projects\/demo \| email — Scope agreed\n/, 'the owner\'s own line carries no mark');
  assert.match(started.text, /## Open commitments\n- UAT starts 18 Nov \(projects\/demo #1, source: meeting 2026-11-05\) \(agent, unconfirmed\)(\n|$)/);
  assert.ok(started.text.length <= 6100);

  // In a linked repo, the project block carries the same mark on its last lines, commitments and decisions.
  const repo = path.join(box.dir, 'code');
  fs.mkdirSync(repo);
  for (const args of [['init', '-q'], ['remote', 'add', 'origin', 'https://example.com/globex/demo.git']]) spawnSync('git', ['-C', repo, ...args]);
  const linked = json(box, ['link', 'projects/demo', '--repo', repo, '--human', ...base]);
  assert.equal(linked.code, 0, linked.err || linked.out);
  const inRepo = json(box, ['context', '--repo', repo, ...base]).data.text;
  const block = inRepo.slice(inRepo.indexOf('## This repo\'s project'), inRepo.indexOf('## Latest evidence'));
  assert.match(block, /### Parking spot[^\n]*\n(?:- [^\n]*\n)*- 2026-11-12 \| session — decision: Postgres, not Mongo[^\n]*\(agent, unconfirmed\)\n/);
  assert.match(block, /### Open commitments\n- UAT starts 18 Nov \(#1, source: meeting 2026-11-05\) \(agent, unconfirmed\)\n/);
  assert.match(block, /### Decisions in force[^\n]*\n- 2026-11-12 \| Postgres, not Mongo: the reporting queries \(accepted\) \(agent, unconfirmed\)\n/);

  // Confirmed, the marks and the count go; with nothing unconfirmed the line is not there at all.
  run(['confirm', 'projects/demo', kickoff.id, '#1', '--human']);
  const later = run(['context']);
  assert.equal(later.unconfirmed, 2);
  assert.match(later.text, /— Kickoff held\n/);
  assert.match(later.text, /UAT starts 18 Nov \(projects\/demo #1, source: meeting 2026-11-05\)(\n|$)/);
  const rest = run(['unconfirmed']).unconfirmed.map((item) => item.ref);
  run(['confirm', 'projects/demo', ...rest, '--human']);
  const clean = run(['context']);
  assert.equal(clean.unconfirmed, 0);
  assert.doesNotMatch(clean.text, /Unconfirmed:|\(agent, unconfirmed\)/);
  assert.equal(run(['view']).counts.unconfirmed, 0);

  // A long unconfirmed line is still one bounded line, and the block keeps its cap.
  for (let i = 0; i < 12; i++) run(['log', 'projects/demo', `Note ${i} ${'very long words '.repeat(60)}`, '--source', 'session', '--agent']);
  const long = run(['context']).text;
  assert.ok(long.length <= 6000 + 60, `the context is ${long.length} characters`);
  for (const line of long.split('\n').filter((entry) => /Note \d+ /.test(entry))) {
    assert.ok(line.length < 400, 'a line stays one bounded line');
    assert.match(line, /… \(agent, unconfirmed\)$|cut at/);
  }
});

test('the wrap-up confirms what the owner kept, and the weekly check-in counts what is unconfirmed', () => {
  const wrap = skill('wrap-up');
  assert.match(wrap, /`Confirm` \(a line or fact this session already\nwrote with `log` or `remember`/);
  assert.match(wrap, /A ticked `Progress`, `Decision`, `Fact` or `Confirm` item is the owner's\nyes to that line\. Once it is written, call the `confirm` tool/);
  assert.match(wrap, /`confirmed_by_owner: true`/);
  assert.match(wrap, /nothing is confirmed: there is no owner to say yes/, 'a headless run confirms nothing');
  const check = skill('check-in');
  assert.match(check, /\nUnconfirmed\n- <N lines and facts an agent wrote that you have not confirmed/);
  // It reports the count and does not walk the lines: the owner says when one is wrong.
  assert.doesNotMatch(check, /cogby unconfirmed|cogby confirm|--confirmed-by-owner/);
  assert.match(fs.readFileSync(path.join(ROOT, 'AGENTS.md'), 'utf8'), /Do not ask the owner to confirm lines one by one/);
});

// ---- which agent wrote a line ------------------------------------------------------------------

test('a tail names the agent, and a tail written before names existed reads as it did', () => {
  assert.equal(page.agentName('Some Agent/2'), 'some-agent2');
  assert.equal(page.agentName('claude-code'), 'claude-code');
  assert.equal(page.agentName('  ·[]|!  '), '', 'nothing left is no name');
  assert.equal(page.agentName('x'.repeat(60)).length, 40);

  assert.deepEqual(page.parseBy('yasser · agent claude-code · unconfirmed'),
    { author: 'yasser', actor: 'agent', agent_name: 'claude-code', confirmed: false, retracted: false, record: false });
  assert.deepEqual(page.parseBy('yasser · agent · unconfirmed'),
    { author: 'yasser', actor: 'agent', agent_name: '', confirmed: false, retracted: false, record: false });
  assert.deepEqual(page.parseBy('yasser · human · confirmed'),
    { author: 'yasser', actor: 'human', agent_name: '', confirmed: true, retracted: false, record: false });
  // An author whose own name starts with the word is still the author.
  assert.deepEqual(page.parseBy('agent smith · agent duet · record'),
    { author: 'agent smith', actor: 'agent', agent_name: 'duet', confirmed: false, retracted: false, record: true });
  assert.deepEqual([page.parseBy('agent smith · human · confirmed').author, page.parseBy('agent smith · human · confirmed').actor], ['agent smith', 'human']);

  assert.equal(page.renderBy({ author: 'yasser', actor: 'agent', agent_name: 'duet' }), 'yasser · agent duet · unconfirmed');
  assert.equal(page.renderBy({ author: 'yasser', actor: 'agent', agent_name: 'Not A/Name' }), 'yasser · agent not-aname · unconfirmed', 'the name is cleaned on the way out too');
  assert.equal(page.renderBy({ author: 'yasser', actor: 'agent' }), 'yasser · agent · unconfirmed');
  assert.equal(page.renderBy({ author: 'yasser', actor: 'human', agent_name: 'duet', confirmed: true }), 'yasser · human · confirmed', 'a person has no agent name');

  // Rewriting a tail keeps the name, also when the caller does not pass it.
  const line = '- **2026-11-10** | call with Sara — Kickoff held [yasser · agent claude-code · unconfirmed]';
  assert.equal(page.retagLine(line, { author: 'yasser', actor: 'agent', confirmed: true }), '- **2026-11-10** | call with Sara — Kickoff held [yasser · agent claude-code · confirmed]');
  assert.equal(page.retagLine(line, { author: 'yasser', actor: 'agent', retracted: true }), '- **2026-11-10** | call with Sara — Kickoff held [yasser · agent claude-code · retracted]');
  const parsed = page.parseTimelineLine(line);
  assert.deepEqual([parsed.author, parsed.actor, parsed.agent_name, parsed.summary], ['yasser', 'agent', 'claude-code', 'Kickoff held']);

  // A page from before: every line and row reads as it did, with no name.
  const old = page.parsePage('projects/old.md', '---\ntype: project\n---\n## Facts\n| # | claim | kind | valid_from | valid_until | recorded | source | by | status |\n|---|---|---|---|---|---|---|---|---|\n'
    + '| 1 | Budget is 10k | fact | 2026-11-05 | | 2026-11-06 | email | yasser · agent · unconfirmed | active |\n\n<!-- timeline -->\n'
    + '- **2026-11-10** | call with Sara — Kickoff held [yasser · agent · unconfirmed]\n- **2026-11-11** | email — Scope agreed [yasser · human · confirmed]\n');
  assert.deepEqual(old.timeline.map((entry) => [entry.actor, entry.agent_name, entry.confirmed]), [['agent', '', false], ['human', '', true]]);
  assert.deepEqual([old.facts[0].actor, old.facts[0].agent_name, old.facts[0].confirmed], ['agent', '', false]);
  assert.match(page.renderFacts(old.facts), /\| yasser · agent · unconfirmed \| active \|/);
});

test('a command says which agent ran it from its shell: Claude Code, or COGBY_AGENT', (t) => {
  const box = newBrain(t);
  const base = ['--brain', box.brain, '--author', 'tester'];
  const { writer } = require(path.join(ROOT, 'core', 'brain', 'write.cjs'));
  const who = (options, env) => { const by = writer(box.brain, { author: 'tester', ...options, env: { ...box.env, ...env } }); return page.renderBy(by); };
  assert.equal(who({}, {}), 'tester · human · confirmed');
  assert.equal(who({ actor: 'agent' }, {}), 'tester · agent · unconfirmed');
  assert.equal(who({}, { CLAUDECODE: '1' }), 'tester · agent claude-code · unconfirmed');
  assert.equal(who({}, { COGBY_AGENT: 'duet' }), 'tester · agent duet · unconfirmed');
  assert.equal(who({ actor: 'human' }, { COGBY_AGENT: 'duet', COGBY_ACTOR: 'human' }), 'tester · agent duet · unconfirmed', 'the variable never makes a person');
  assert.equal(who({}, { COGBY_AGENT: '   ' }), 'tester · human · confirmed', 'an empty value is not set');
  assert.equal(who({}, { COGBY_AGENT: '!!!' }), 'tester · agent · unconfirmed', 'a name with nothing to keep is still an agent');
  assert.equal(who({}, { CLAUDECODE: '1', COGBY_AGENT: 'duet' }), 'tester · agent claude-code · unconfirmed', 'Claude Code comes first');
  assert.equal(who({ agentName: 'Some Agent/2' }, {}), 'tester · human · confirmed', 'a name alone does not make an agent');

  const run = (args, env) => { const out = json(box, [...args, ...base], { env }); assert.equal(out.code, 0, out.err || out.out); return out.data; };
  const kickoff = run(['log', 'projects/demo', 'Kickoff held', '--source', 'call with Sara', '--date', '2026-11-10', '--create'], { CLAUDECODE: '1' });
  assert.match(kickoff.line, /Kickoff held \[tester · agent claude-code · unconfirmed\]$/);
  const scope = run(['log', 'projects/demo', 'Scope agreed', '--source', 'email', '--date', '2026-11-11', '--human'], { COGBY_AGENT: 'duet' });
  assert.match(scope.line, /Scope agreed \[tester · agent duet · unconfirmed\]$/, 'an agent\'s, unconfirmed, whatever --human says');
  run(['remember', 'projects/demo', 'Budget is 10k', '--source', 'email from finance'], { COGBY_AGENT: 'Duet 2' });
  let text = read(box, 'projects/demo.md');
  assert.match(text, /\| 1 \| Budget is 10k \|[^\n]*\| tester · agent duet-2 · unconfirmed \| active \|/);
  assert.match(git(box.brain, ['log', '-1', '--format=%s']), /\[tester · agent duet-2 · unconfirmed\]$/);

  // Listed as before: the name changes nothing in what is unconfirmed.
  const listed = run(['unconfirmed']);
  assert.deepEqual(listed.unconfirmed.map((item) => item.ref).sort(), ['#1', kickoff.id, scope.id].sort());
  assert.match(cogby(box, ['context', '--brain', box.brain]).out, /Scope agreed[^\n]*\(agent, unconfirmed\)/);

  // The index holds the name beside the actor.
  const { withIndex } = require(path.join(ROOT, 'core', 'brain', 'brain.cjs'));
  const rows = withIndex(box.brain, (db) => ({
    lines: db.prepare('SELECT summary, actor, agent_name FROM timeline_entries ORDER BY date').all().map((row) => [row.summary, row.actor, row.agent_name]),
    facts: db.prepare('SELECT claim, actor, agent_name FROM facts').all().map((row) => [row.claim, row.actor, row.agent_name]),
  }));
  assert.deepEqual(rows.lines, [['Kickoff held', 'agent', 'claude-code'], ['Scope agreed', 'agent', 'duet']]);
  assert.deepEqual(rows.facts, [['Budget is 10k', 'agent', 'duet-2']]);

  // Confirming and retracting keep the name, on a line and on a fact.
  run(['confirm', 'projects/demo', kickoff.id, '#1'], {});
  run(['retract', 'projects/demo', scope.id], {});
  text = read(box, 'projects/demo.md');
  assert.match(text, /Kickoff held \[tester · agent claude-code · confirmed\]/);
  assert.match(text, /Scope agreed \[tester · agent duet · retracted\]/);
  assert.match(text, /\| 1 \| Budget is 10k \|[^\n]*\| tester · agent duet-2 · confirmed \| active \|/);
  run(['retract', 'projects/demo', '#1'], {});
  assert.match(read(box, 'projects/demo.md'), /\| tester · agent duet-2 · confirmed \| retracted \d{4}-\d\d-\d\d \|/);
});
