'use strict';

// The day's log as the recall layer behind the cards: an entry names the card its turn was about
// (worked out from what the turn touched, never guessed), keeps most turns whole, and is found by
// that card with `cogby search … --source log`.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { cogby, json, newBrain, hook } = require('./helpers.cjs');

const user = (text) => ({ type: 'user', message: { role: 'user', content: text } });
const use = (name, input) => ({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'On it.' }, { type: 'tool_use', id: 't1', name, input }] } });
const result = { type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'ok' }] } };

// `pages` are written as files: the hook reads the folders, not the index.
function setup(t, pages = []) {
  const box = newBrain(t);
  const base = ['--brain', box.brain];
  for (const slug of pages) {
    const file = path.join(box.brain, ...`${slug}.md`.split('/'));
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `# ${slug.split('/')[1]}

What it is.
`);
  }
  const logDir = path.join(box.brain, '.cogby', 'self', 'log');
  const log = () => fs.readdirSync(logDir).filter((name) => /^\d{4}-\d\d-\d\d\.md$/.test(name)).map((name) => fs.readFileSync(path.join(logDir, name), 'utf8')).join('');
  let n = 0;
  // One turn: the rows of its transcript, then the hook. Returns the entry it wrote.
  const turn = (answer, rows, options = {}) => {
    const transcript = path.join(box.dir, `transcript-${++n}.jsonl`);
    fs.writeFileSync(transcript, `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`);
    const before = fs.existsSync(logDir) ? log() : '';
    const ran = hook(box, 'capture-log', { session_id: 's1', hook_event_name: 'Stop', last_assistant_message: answer, transcript_path: transcript }, options);
    assert.equal(ran.code, 0, ran.err);
    assert.equal(ran.out.trim(), '', 'the hook says nothing to the session');
    return log().slice(before.length);
  };
  const inBrain = (...parts) => path.join(box.brain, ...parts);
  return { box, base, log, turn, inBrain };
}

test('an entry in the brain names the card its turn wrote to or read, and no card when none is known', (t) => {
  const { box, turn, inBrain } = setup(t, ['projects/acme/card', 'projects/website', 'areas/health/card', 'areas/finance/card', 'areas/home/card', 'projects/garden/card', 'areas/garden/card', 'people/sara']);
  const card = (entry) => (/^Card: (.*)$/m.exec(entry) || [null, null])[1];

  // Written with the command, the tool, or by editing a file under the project.
  const logged = turn('Moved the go-live.', [user('Move the go-live'), use('Bash', { command: 'cogby log projects/acme/card "Go-live moved" --source "call with Sara"' }), result]);
  assert.match(logged, /^\n### \d\d:\d\d Moved the go-live\.\nCard: projects\/acme\/card\n> Move the go-live\nMoved the go-live\.\n$/);
  assert.equal(card(turn('Saved it.', [user('Remember that'), use('mcp__plugin_cogby_cogby-brain__remember', { slug: 'projects/website', claim: 'x', source: 'y' }), result])), 'projects/website', 'a card that is one file');
  assert.equal(card(turn('Saved it.', [user('Remember that'), use('mcp__cogby-brain__log', { slug: 'health', line: 'x', source: 'y' }), result])), 'areas/health/card', 'a bare name of one area');
  assert.equal(card(turn('Wrote the report.', [user('Write the report'), use('Write', { file_path: inBrain('projects', 'acme', 'output', 'report.md') }), result])), 'projects/acme/card', 'a file under the project');
  assert.equal(card(turn('Fixed the card.', [user('Fix it'), use('Edit', { file_path: 'areas/health/card.md' }), result])), 'areas/health/card', 'a path given from the brain');
  assert.equal(card(turn('Done.', [user('Log it'), use('PowerShell', { command: 'cogby remember "projects/acme" "Budget is 10k" --source call' }), result])), 'projects/acme/card');

  // Several cards written: all of them, in the order they were touched, once each.
  assert.equal(card(turn('Logged both.', [user('Log both'),
    use('Bash', { command: 'cogby log areas/finance/card "Invoice sent" --source mail && cogby log projects/acme/card "Paid" --source bank' }), result,
    use('Bash', { command: 'cogby log areas/finance/card "Receipt filed" --source mail' }), result])), 'areas/finance/card · projects/acme/card');

  // What a turn wrote says more than what it read; a turn that only read is about what it read.
  assert.equal(card(turn('Logged it.', [user('Log it'), use('Read', { file_path: inBrain('areas', 'health', 'card.md') }), result,
    use('Bash', { command: 'cogby log projects/acme/card "x" --source y' }), result])), 'projects/acme/card');
  assert.equal(card(turn('You ran three times.', [user('How is my running?'), use('Read', { file_path: inBrain('areas', 'health', 'card.md') }), result])), 'areas/health/card');
  assert.equal(card(turn('Here it is.', [user('Show acme'), use('Bash', { command: 'cogby get projects/acme' }), result])), 'projects/acme/card');

  // No card can be known: no line, never a guess.
  const none = (why, rows) => assert.equal(card(turn('Nothing to tag.', rows)), null, why);
  none('a turn that touched nothing', [user('What is a brain?')]);
  none('a turn that read across many cards', [user('Check in'), ...['health', 'finance', 'home'].map((name) => use('Read', { file_path: inBrain('areas', name, 'card.md') })), use('Read', { file_path: inBrain('projects', 'acme', 'card.md') }), result]);
  none('a page that is not there', [user('Log it'), use('Bash', { command: 'cogby log projects/nowhere "x" --source y' }), result]);
  none('the day\'s log itself', [user('Log it'), use('Bash', { command: 'cogby log log:today "x" --decision --source y' }), result]);
  none('a name that two cards share', [user('Log it'), use('mcp__cogby-brain__log', { slug: 'garden', line: 'x', source: 'y' }), result]);
  none('a page outside projects and areas', [user('Log it'), use('Bash', { command: 'cogby log people/sara "x" --source y' }), result]);
  none('a file outside the brain', [user('Edit it'), use('Edit', { file_path: path.join(box.dir, 'projects', 'acme', 'card.md') }), result]);
  none('a file of the brain that belongs to no card', [user('Read it'), use('Read', { file_path: inBrain('AGENTS.md') }), result]);
  none('another server\'s tool of the same name', [user('Log it'), use('mcp__tracker__log', { slug: 'projects/acme/card' }), result]);
  none('words that only talk about a card', [user('Tell me about projects/acme/card and cogby log')]);
  // What an earlier turn touched is not this turn's.
  none('an earlier turn\'s work', [user('Log it'), use('Bash', { command: 'cogby log projects/acme/card "x" --source y' }), result, user('And what is a brain?')]);
  // A subagent's rows and a transcript that cannot be read cost nothing and tag nothing.
  none('a subagent\'s work', [user('Ask the agent'), { ...use('Edit', { file_path: inBrain('areas', 'health', 'card.md') }), isSidechain: true }]);
  const broken = path.join(box.dir, 'broken.jsonl');
  fs.writeFileSync(broken, '{ not json\n\n[1, 2]\n{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Edit","input":null}]}}\n');
  assert.equal(hook(box, 'capture-log', { session_id: 's1', last_assistant_message: 'Still logged.', transcript_path: broken }).code, 0);
  assert.equal(hook(box, 'capture-log', { session_id: 's1', last_assistant_message: 'Logged with no transcript.', transcript_path: path.join(box.dir, 'gone.jsonl') }).code, 0);
});

test('an entry keeps the ask to 1,000 characters and the answer to 4,000, and a secret is gone before the cut', (t) => {
  const { turn } = setup(t);
  const whole = turn(`Done. ${'word '.repeat(700)}End.`, [user(`Start ${'ask '.repeat(200)}end?`)]);
  assert.match(whole, /\n> Start (?:ask ){200}end\?\nDone\. (?:word ){700}End\.\n$/, 'a turn under the caps is kept whole');

  // Each secret starts before the cut and ends after it: cut first, half of it would stay.
  const ask = `${'a'.repeat(980)} password=hunter2-${'Z'.repeat(40)} and the rest`;
  const answer = `${'b'.repeat(3970)} token=abc123-${'Q'.repeat(60)} and the rest`;
  const cutEntry = turn(answer, [user(ask)]);
  const [, asked, answered] = /\n> (.*)\n(.*)\n$/.exec(cutEntry);
  assert.equal(asked.length, 1000);
  assert.equal(answered.length, 4000);
  assert.ok(asked.endsWith('…') && answered.endsWith('…'), 'a cut is marked');
  assert.doesNotMatch(cutEntry, /hunter2|ZZZ|abc123|QQQ/, 'no part of a secret is left at the cut');
  assert.match(asked, /a password=\[redac/);
  assert.match(answered, /b token=\[redacted:to/);
});

test('search --source log returns the entries about a card, one result an entry, and stays out of default search', (t) => {
  const { box, base, turn } = setup(t);
  // Made with the command, so the index holds them: a search finds the card a query names there.
  for (const slug of ['projects/acme/card', 'areas/health/card', 'areas/finance/card']) {
    assert.equal(cogby(box, ['log', slug, 'Started', '--source', 'call', '--create', ...base]).code, 0, slug);
  }
  const logOn = (slug) => [user('Log it'), use('Bash', { command: `cogby log ${slug} "x" --source y` }), result];
  turn('Moved the acme go-live to January.', logOn('projects/acme/card'));
  turn('Booked the physiotherapist.', logOn('areas/health/card'));
  // A long turn: the card's line and the last words are far apart, and still one entry.
  turn(`Reviewed the vendor contract. ${'The clauses were read one by one. '.repeat(110)}The indemnity quince clause stays.`, logOn('projects/acme/card'));
  // An entry that mentions the card's path in its words, and is about another card.
  turn('Compared it with projects/acme/card and changed nothing there.', logOn('areas/finance/card'));
  turn('A brain is a folder of markdown.', [user('What is a brain?')]);

  // No sync is run here: a search that names the log reads the log folder first.
  const search = (words, ...flags) => { const out = json(box, ['search', words, ...flags, ...base]); assert.equal(out.code, 0, out.err || out.out); return out.data; };
  for (const words of ['projects/acme/card', 'projects/acme', 'acme']) {
    const found = search(words, '--source', 'log');
    assert.equal(found.card, 'projects/acme/card', words);
    const about = found.results.filter((hit) => hit.match === 'card');
    assert.deepEqual(about.map((hit) => hit.heading.replace(/^\d\d:\d\d /, '')), ['Reviewed the vendor contract.', 'Moved the acme go-live to January.'], `${words}: the entries about the card, newest first`);
    assert.deepEqual(found.results.slice(0, 2), about, 'they come first');
    for (const hit of about) {
      assert.equal(hit.source, 'log');
      assert.match(hit.slug, /^\d{4}-\d\d-\d\d$/);
      assert.match(hit.file, /[\\/]\.cogby[\\/]self[\\/]log[\\/]\d{4}-\d\d-\d\d\.md$/);
    }
    assert.ok(!about.some((hit) => /Compared it with/.test(hit.heading)), 'an entry that only mentions the card is not about it');
  }
  // The mention is still found, by its words.
  assert.ok(search('projects/acme/card', '--source', 'log').results.some((hit) => hit.match !== 'card' && /^\d\d:\d\d Compared it with/.test(hit.heading)));
  assert.deepEqual(search('areas/health', '--source', 'log').results.filter((hit) => hit.match === 'card').map((hit) => hit.heading.replace(/^\d\d:\d\d /, '')), ['Booked the physiotherapist.']);

  // Words: each matching entry is its own result, and the card and the words of one entry meet.
  const words = search('physiotherapist', '--source', 'log');
  assert.equal(words.card, undefined);
  assert.deepEqual(words.results.map((hit) => [hit.match, hit.heading.replace(/^\d\d:\d\d /, '')]), [['all-words', 'Booked the physiotherapist.']]);
  const far = search('acme indemnity quince', '--source', 'log');
  assert.deepEqual([far.results[0].match, far.results[0].heading.replace(/^\d\d:\d\d /, '')], ['all-words', 'Reviewed the vendor contract.']);
  assert.match(cogby(box, ['search', 'acme', '--source', 'log', ...base]).out, /^1\. \[card\] log:\d{4}-\d\d-\d\d — [^\n]* › \d\d:\d\d Reviewed the vendor contract\./);
  assert.equal(search('zebra', '--source', 'log').results.length, 0);

  // An entry written before the Card line existed, from a place, is found by its page.
  const day = path.join(box.brain, '.cogby', 'self', 'log', '2026-01-02.md');
  fs.writeFileSync(day, '\n### 09:00 Fixed the importer.\nPlace: example.com/globex/acme · code · page projects/acme/card\nFixed the importer.\n');
  const older = search('acme', '--source', 'log').results.filter((hit) => hit.match === 'card');
  assert.deepEqual(older.map((hit) => hit.slug).at(-1), '2026-01-02');
  assert.equal(older.length, 3);

  // The log is not in a plain search, before or after a full sync.
  assert.equal(search('physiotherapist').results.length, 0);
  assert.equal(cogby(box, ['sync', ...base]).code, 0);
  assert.equal(search('physiotherapist').results.length, 0);
  assert.equal(search('indemnity quince').results.length, 0);
  assert.equal(search('acme', '--source', 'log').results.filter((hit) => hit.match === 'card').length, 3);

  // With the index off the log is read as it is, and the entries are found by the slug's words.
  assert.equal(cogby(box, ['index', 'off', ...base]).code, 0);
  const off = search('projects/acme/card', '--source', 'log');
  assert.ok(off.results.length >= 3 && off.results.every((hit) => hit.source === 'log'));
});
