'use strict';

// The decision log: a decision is a `decision:` timeline line on the page it is about, with who made
// the call in the line. `cogby decisions` reads them back from the index as it is, and how one
// turned out is a second line that points at the first.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { ROOT, CLI, newBrain, cogby, json } = require('./helpers.cjs');
const page = require(path.join(ROOT, 'core', 'brain', 'page.cjs'));
const decisions = require(path.join(ROOT, 'core', 'brain', 'decisions.cjs'));
const cards = require(path.join(ROOT, 'core', 'brain', 'cards.cjs'));

const read = (box, rel) => fs.readFileSync(path.join(box.brain, ...rel.split('/')), 'utf8');

// Three projects' worth of decisions, on fixed dates, one of each kind of call and one old line.
function brainWithDecisions(t) {
  const box = newBrain(t);
  const base = ['--brain', box.brain];
  const decide = (slug, line, date, extra = []) => {
    const made = json(box, ['log', slug, line, '--decision', '--source', 'call with Sara', '--date', date, '--create', ...extra, ...base]);
    assert.equal(made.code, 0, made.err || made.out);
    return made.data;
  };
  decide('projects/acme/card', 'Go live in January, not December: the audit comes first', '2026-11-03', ['--who', 'accepted', '--expect', 'no rework after the audit', '--review', '2020-01-01']);
  decide('projects/acme/card', 'Keep one parallel month, not two', '2026-11-05', ['--who', 'owner', '--review', '2999-01-01']);
  decide('projects/website/card', 'Static site, not a CMS: nobody edits it weekly', '2026-11-08', ['--who', 'overrode']);
  // A line from before who made the call was recorded.
  decide('projects/website/card', 'Hosting stays where it is', '2026-10-01');
  cogby(box, ['log', 'projects/website/card', 'Homepage copy approved', '--source', 'email', '--date', '2026-11-09', ...base]);
  return { box, base };
}

test('the decision line round-trips, and a line with no marker still parses', () => {
  const summary = page.asDecision('Go live (phase 1) in January', { who: 'accepted', expect: 'no rework (we hope) · on time', review: '2027-01-15' });
  assert.equal(summary, 'decision: Go live (phase 1) in January (who: accepted · expect: no rework [we hope], on time · review: 2027-01-15)');
  assert.ok(page.isDecision(summary), 'the summary must still start with decision:');
  const line = page.renderTimelineLine({ date: '2026-11-06', source: 'call with Sara', summary, author: 'yasser', actor: 'agent', confirmed: false });
  const parsed = page.parseTimelineLine(line);
  assert.equal(parsed.decision, true);
  assert.equal(parsed.summary, summary);
  assert.deepEqual([parsed.author, parsed.actor, parsed.confirmed], ['yasser', 'agent', false], 'the writer tail is read as before');
  assert.deepEqual(page.parseDecision(parsed), { text: 'Go live (phase 1) in January', who: 'accepted', expect: 'no rework [we hope], on time', review: '2027-01-15' });
  assert.equal(page.renderTimelineLine(parsed), line);

  // Written before the marker existed, or by hand: no group, nothing recorded.
  const old = page.parseTimelineLine('- **2026-11-06** | call with Sara — decision: go live in December, the audit comes first [yasser · human · confirmed]');
  assert.deepEqual(page.parseDecision(old), { text: 'go live in December, the audit comes first', who: '', expect: '', review: '' });
  // Ordinary brackets at the end of a sentence are part of the sentence.
  assert.equal(page.parseDecision('decision: we chose B (the cheaper one)').text, 'we chose B (the cheaper one)');
  // A hand-written line with the group and no writer tail.
  const bare = page.parseTimelineLine('- **2026-11-06** | standup — decision: no Friday deploys (who: owner)');
  assert.equal(page.parseDecision(bare).who, 'owner');
  assert.equal(bare.author, '');
  // A value that is not one of the three, or not a date, is not recorded.
  assert.deepEqual(page.parseDecision('decision: x (who: nobody · review: soon)'), { text: 'x', who: '', expect: '', review: '' });
  assert.equal(page.parseDecision('Contract signed'), null);
  // Marking twice keeps one prefix and one group; a new value replaces the old one.
  assert.equal(page.asDecision(summary, { who: 'overrode' }), summary.replace('accepted', 'overrode'));

  const review = page.renderReview({ outcome: 'reversed', date: '2026-11-06', id: '3fa2c1', quote: 'Go "live" in January', note: 'The audit slipped.' });
  assert.equal(review, 'reviewed: reversed, decision of 2026-11-06 #3fa2c1 "Go \'live\' in January". The audit slipped.');
  assert.deepEqual(page.parseReview(review), { outcome: 'reversed', date: '2026-11-06', id: '3fa2c1', note: 'The audit slipped.' });
  assert.equal(page.parseReview('decision: x'), null);
});

test('log --decision records who made the call, and refuses a value it does not know', (t) => {
  const box = newBrain(t);
  const base = ['--brain', box.brain];
  const made = json(box, ['log', 'projects/acme/card', 'Go live in January, not December', '--decision', '--who', 'accepted', '--expect', 'no rework', '--review', '2027-02-01', '--source', 'call', '--create', ...base]);
  assert.equal(made.code, 0, made.err || made.out);
  assert.match(made.data.line, /\| call — decision: Go live in January, not December \(who: accepted · expect: no rework · review: 2027-02-01\) \[/);
  assert.equal(json(box, ['log', 'projects/acme/card', 'x', '--decision', '--who', 'sara', '--source', 'call', ...base]).data.error.code, 'BAD_WHO');
  assert.equal(json(box, ['log', 'projects/acme/card', 'x', '--decision', '--review', 'soon', '--source', 'call', ...base]).data.error.code, 'BAD_DATE');
  assert.equal(json(box, ['log', 'projects/acme/card', 'Kickoff held', '--who', 'owner', '--source', 'call', ...base]).data.error.code, 'USAGE', 'who without --decision');
  // --due still takes a date everywhere else.
  assert.equal(json(box, ['todo', 'add', 'Send the plan', '--due', '2026-12-01', ...base]).data.todo.due, '2026-12-01');
});

test('cogby decisions lists every decision, newest first, with who made the call', (t) => {
  const { box, base } = brainWithDecisions(t);
  const all = json(box, ['decisions', ...base]);
  assert.equal(all.code, 0, all.err || all.out);
  assert.deepEqual(all.data.decisions.map((d) => [d.date, d.page, d.who]), [
    ['2026-11-08', 'projects/website/card', 'overrode'],
    ['2026-11-05', 'projects/acme/card', 'owner'],
    ['2026-11-03', 'projects/acme/card', 'accepted'],
    ['2026-10-01', 'projects/website/card', null],
  ]);
  const first = all.data.decisions[2];
  assert.equal(first.text, 'Go live in January, not December: the audit comes first');
  assert.equal(first.source, 'call with Sara');
  assert.equal(first.expect, 'no rework after the audit');
  assert.equal(first.review, '2020-01-01');
  assert.equal(first.due, true);
  assert.equal(first.status, 'current');
  assert.match(first.id, /^[0-9a-f]{6}$/);
  const unreviewed = { total: 1, reviewed: 0, as_expected: 0, not_as_expected: 0, reversed: 0 };
  assert.deepEqual(all.data.counts, {
    total: 4, by_who: { owner: 1, accepted: 1, overrode: 1, agent: 0, not_recorded: 1 }, due: 1, not_as_expected: 0, reversed: 0,
    outcome_by_who: { owner: unreviewed, accepted: unreviewed, overrode: unreviewed, agent: { ...unreviewed, total: 0 } },
  });
  assert.match(all.data.index_as_of, /^\d{4}-\d\d-\d\dT/);

  const text = cogby(box, ['decisions', ...base]).out;
  assert.match(text, /2026-10-01 {2}projects\/website\/card {2}who: not recorded/);
  assert.match(text, /2026-11-03 {2}projects\/acme\/card {2}accepted · review 2020-01-01 \(due\)/);
  assert.match(text, /source: call with Sara · expects: no rework after the audit/);
  assert.match(text, /4 decisions in scope: 1 yours alone, 1 accepted from Claude, 1 overrode Claude, 0 by an agent alone, 1 not recorded · 1 due for review/);
});

test('each filter of cogby decisions narrows the list', (t) => {
  const { box, base } = brainWithDecisions(t);
  const dates = (args) => { const out = json(box, ['decisions', ...args, ...base]); assert.equal(out.code, 0, out.err || out.out); return out.data.decisions.map((d) => d.date); };
  assert.deepEqual(dates(['--project', 'acme']), ['2026-11-05', '2026-11-03']);
  assert.deepEqual(dates(['--project', 'projects/website/card']), ['2026-11-08', '2026-10-01'], 'a page slug works where a project name does');
  assert.deepEqual(dates(['projects/website/card']), ['2026-11-08', '2026-10-01']);
  assert.deepEqual(dates(['--since', '2026-11-05']), ['2026-11-08', '2026-11-05']);
  assert.deepEqual(dates(['--due']), ['2026-11-03'], 'a review date in the future is not due');
  assert.deepEqual(dates(['--who', 'owner']), ['2026-11-05']);
  assert.deepEqual(dates(['--who', 'accepted']), ['2026-11-03']);
  assert.deepEqual(dates(['--who', 'overrode']), ['2026-11-08']);
  assert.deepEqual(dates(['--who', 'none']), ['2026-10-01']);
  assert.deepEqual(dates(['--project', 'acme', '--who', 'owner', '--since', '2026-11-01']), ['2026-11-05']);
  assert.deepEqual(dates(['--limit', '1']), ['2026-11-08']);
  assert.equal(json(box, ['decisions', '--project', 'acme', ...base]).data.counts.total, 2, 'the counts follow the scope');

  assert.equal(json(box, ['decisions', '--who', 'sara', ...base]).data.error.code, 'BAD_WHO');
  assert.equal(json(box, ['decisions', '--since', 'last week', ...base]).data.error.code, 'BAD_DATE');
  assert.equal(json(box, ['decisions', '--project', 'no-such-thing', ...base]).data.error.code, 'NOT_FOUND');
});

test('a review is a new line that points at the decision, and reversed takes it off the list', (t) => {
  const { box, base } = brainWithDecisions(t);
  const before = read(box, 'projects/acme/card.md');
  const target = json(box, ['decisions', '--due', ...base]).data.decisions[0];

  assert.equal(json(box, ['decisions', 'review', target.id, 'reversed', ...base]).data.error.code, 'SOURCE_REQUIRED');
  assert.equal(json(box, ['decisions', 'review', target.id, 'fine', '--source', 'retro', ...base]).data.error.code, 'BAD_OUTCOME');
  assert.equal(json(box, ['decisions', 'review', 'ffffff', 'reversed', '--source', 'retro', ...base]).data.error.code, 'NOT_FOUND');

  // Not as expected: recorded, still current, no longer due.
  const first = json(box, ['decisions', 'review', target.id, 'not-as-expected', '--source', 'retro 2027-02-03', '--note', 'Two weeks of rework.', '--date', '2027-02-03', ...base]);
  assert.equal(first.code, 0, first.err || first.out);
  assert.match(first.data.line, new RegExp(`^- \\*\\*2027-02-03\\*\\* \\| retro 2027-02-03 — reviewed: not as expected, decision of 2026-11-03 #${target.id} "Go live in January, not December: the audit comes first"\\. Two weeks of rework\\. \\[`));
  let listed = json(box, ['decisions', '--project', 'acme', ...base]).data;
  let entry = listed.decisions.find((d) => d.id === target.id);
  assert.deepEqual([entry.outcome, entry.reviewed_on, entry.review_note, entry.status, entry.due], ['not as expected', '2027-02-03', 'Two weeks of rework.', 'current', false]);
  assert.equal(listed.counts.not_as_expected, 1);
  assert.deepEqual(json(box, ['decisions', '--outcome', 'not-as-expected', ...base]).data.decisions.map((d) => d.id), [target.id]);
  assert.deepEqual(json(box, ['decisions', '--due', ...base]).data.decisions, []);

  // Reversed, later: the newest review stands. It leaves the list and stays in the record.
  const second = json(box, ['decisions', 'review', target.id, 'reversed', '--source', 'call 2027-03-01', '--date', '2027-03-01', ...base]);
  assert.equal(second.code, 0, second.err || second.out);
  listed = json(box, ['decisions', '--project', 'acme', ...base]).data;
  assert.deepEqual(listed.decisions.map((d) => d.date), ['2026-11-05'], 'a reversed decision must not be listed as current');
  assert.equal(listed.counts.reversed, 1);
  entry = json(box, ['decisions', '--project', 'acme', '--all', ...base]).data.decisions.find((d) => d.id === target.id);
  assert.deepEqual([entry.status, entry.outcome, entry.reviewed_on], ['reversed', 'reversed', '2027-03-01']);
  assert.deepEqual(json(box, ['decisions', '--outcome', 'reversed', ...base]).data.decisions.map((d) => d.id), [target.id]);

  // The old line is as it was: the reviews were added after it.
  const after = read(box, 'projects/acme/card.md');
  for (const line of before.split('\n').filter((text) => text.startsWith('- **'))) assert.ok(after.includes(line), `the line was edited: ${line}`);
  assert.equal(after.split('\n').filter((text) => /— reviewed: /.test(text)).length, 2);
  assert.equal(json(box, ['decisions', 'review', target.id, 'reversed', '--source', 'call 2027-03-01', '--date', '2027-03-01', ...base]).data.status, 'duplicate');
});

test('who made the call is crossed with how it turned out, and the line is absent until one is reviewed', (t) => {
  const { box, base } = brainWithDecisions(t);
  const list = (args = []) => { const out = json(box, ['decisions', '--all', ...args, ...base]); assert.equal(out.code, 0, out.err || out.out); return out.data; };
  const text = (args = []) => cogby(box, ['decisions', ...args, ...base]).out;
  const review = (id, outcome) => assert.equal(json(box, ['decisions', 'review', id, outcome, '--source', 'retro', '--date', '2027-02-03', ...base]).code, 0);
  const idOn = (date) => list().decisions.find((d) => d.date === date).id;

  // Nothing reviewed: the cross is all there, with no review in it, and the text says nothing more.
  for (const [who, row] of Object.entries(list().counts.outcome_by_who)) assert.deepEqual([row.total, row.reviewed], [who === 'agent' ? 0 : 1, 0]);
  const quiet = text().trimEnd().split('\n');
  assert.match(quiet[quiet.length - 2], /^4 decisions in scope: /, 'the summary line must be followed by the index line only');
  assert.match(quiet[quiet.length - 1], /^Index as of /);
  assert.doesNotMatch(quiet.join('\n'), /Overrode Claude \d|Accepted from Claude \d|Decided alone \d/);
  assert.equal(decisions.outcomeLine(list().counts), '');

  // Three more overrides, then reviews: three as expected and one not; the accepted one reversed.
  for (const [day, line] of [['2026-11-09', 'No newsletter signup, not a popup'], ['2026-11-10', 'One language, not two'], ['2026-11-11', 'No blog, not a weekly post']]) {
    assert.equal(json(box, ['log', 'projects/website/card', line, '--decision', '--who', 'overrode', '--source', 'call', '--date', day, ...base]).code, 0);
  }
  review(idOn('2026-11-08'), 'as-expected');
  review(idOn('2026-11-09'), 'as-expected');
  review(idOn('2026-11-10'), 'as-expected');
  review(idOn('2026-11-11'), 'not-as-expected');
  review(idOn('2026-11-03'), 'reversed');
  // One with no one recorded is reviewed too: there is no call to cross, so it changes nothing here.
  review(idOn('2026-10-01'), 'as-expected');

  assert.deepEqual(list().counts.outcome_by_who, {
    owner: { total: 1, reviewed: 0, as_expected: 0, not_as_expected: 0, reversed: 0 },
    accepted: { total: 1, reviewed: 1, as_expected: 0, not_as_expected: 0, reversed: 1 },
    overrode: { total: 4, reviewed: 4, as_expected: 3, not_as_expected: 1, reversed: 0 },
    agent: { total: 0, reviewed: 0, as_expected: 0, not_as_expected: 0, reversed: 0 },
  });
  const line = 'Accepted from Claude 1 time: 1 reversed. Overrode Claude 4 times: 3 as expected, 1 not.';
  const loud = text().trimEnd().split('\n');
  assert.match(loud[loud.length - 3], /^7 decisions in scope: 1 yours alone, 1 accepted from Claude, 4 overrode Claude, 0 by an agent alone, 1 not recorded · 0 due for review · 1 not as expected · 1 reversed$/, 'the summary line reads as before');
  assert.equal(loud[loud.length - 2], line);
  assert.match(loud[loud.length - 1], /^Index as of /);

  // It follows the scope, and it is there when no decision matches the other filters.
  assert.equal(decisions.outcomeLine(list(['--project', 'acme']).counts), 'Accepted from Claude 1 time: 1 reversed.');
  assert.equal(text(['--outcome', 'as-expected', '--since', '2026-11-12']).trimEnd().split('\n').slice(0, 1).join('\n'), 'No decision matches.');
  assert.equal(text(['--due']).trimEnd().split('\n').slice(0, 3).join('\n'), `No decision matches.\n${loud[loud.length - 3]}\n${line}`);
  // With --who the counts are of those calls only, also for the ones with nobody recorded.
  assert.equal(text(['--who', 'owner', '--outcome', 'reversed']).trimEnd().split('\n').slice(0, 2).join('\n'),
    'No decision matches.\n1 decision in scope: 1 yours alone, 0 accepted from Claude, 0 overrode Claude, 0 by an agent alone, 0 not recorded · 0 due for review · 0 not as expected · 0 reversed');
  assert.match(text(['--who', 'none']), /\n1 decision in scope: 0 yours alone, 0 accepted from Claude, 0 overrode Claude, 0 by an agent alone, 1 not recorded · /);
  assert.deepEqual(list(['--who', 'overrode']).counts.by_who, { owner: 0, accepted: 0, overrode: 4, agent: 0, not_recorded: 0 });
  assert.equal(decisions.outcomeLine(list(['--who', 'overrode']).counts), 'Overrode Claude 4 times: 3 as expected, 1 not.');

  // An override not reviewed yet is counted, and said to be: the sentence never passes four reviews off as five.
  json(box, ['log', 'projects/website/card', 'No cookie banner, not the full one', '--decision', '--who', 'overrode', '--source', 'call', '--date', '2026-11-12', ...base]);
  assert.match(text(), /Overrode Claude 5 times, 4 reviewed: 3 as expected, 1 not\.$/m);
  // "not" needs "as expected" before it to mean anything.
  assert.equal(decisions.outcomeLine({ outcome_by_who: { owner: { total: 2, reviewed: 1, as_expected: 0, not_as_expected: 1, reversed: 0 } } }), 'Decided alone 2 times, 1 reviewed: 1 not as expected.');

  // The view carries the same cross for its week.
  assert.deepEqual(Object.keys(json(box, ['view', ...base]).data.decisions.week.outcome_by_who), ['owner', 'accepted', 'overrode', 'agent']);
});

test('cogby decisions answers from the index as it is and never syncs first', (t) => {
  const { box, base } = brainWithDecisions(t);
  const file = path.join(box.brain, 'projects', 'acme', 'card.md');
  fs.appendFileSync(file, '- **2026-11-10** | standup — decision: no Friday deploys, not even small ones (who: owner) [yasser · human · confirmed]\n');
  const before = json(box, ['decisions', '--project', 'acme', ...base]);
  assert.deepEqual(before.data.decisions.map((d) => d.date), ['2026-11-05', '2026-11-03'], 'the command walked the files: a read must not sync');
  assert.equal(json(box, ['sync', ...base]).data.changed, 1);
  const after = json(box, ['decisions', '--project', 'acme', ...base]);
  assert.deepEqual(after.data.decisions.map((d) => [d.date, d.who]), [['2026-11-10', 'owner'], ['2026-11-05', 'owner'], ['2026-11-03', 'accepted']]);
  assert.ok(after.data.index_as_of > before.data.index_as_of);
});

test('a decision about no page in particular goes on the day\'s log, and nothing else does', (t) => {
  const box = newBrain(t);
  const base = ['--brain', box.brain];
  const dir = path.join(box.brain, '.cogby', 'self', 'log');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, '2026-11-12.md'), '# 2026-11-12\n\n### 09:14\n**User:** hello\n');

  assert.equal(json(box, ['log', 'log:2026-11-12', 'Something happened', '--source', 'session', ...base]).data.error.code, 'READ_ONLY');
  const made = json(box, ['log', 'log:2026-11-12', 'Invoices are sent on the 1st, not on delivery', '--decision', '--who', 'owner', '--source', 'session 2026-11-12', ...base]);
  assert.equal(made.code, 0, made.err || made.out);
  assert.equal(made.data.slug, 'log:2026-11-12');
  const text = fs.readFileSync(path.join(dir, '2026-11-12.md'), 'utf8');
  assert.ok(text.startsWith('# 2026-11-12\n\n### 09:14\n**User:** hello\n'), 'what the hook wrote is left as it was');
  assert.match(text, /<!-- timeline -->\n- \*\*2026-11-12\*\* \| session 2026-11-12 — decision: Invoices are sent on the 1st, not on delivery \(who: owner\) \[/);

  // The hook keeps appending after it, and a second decision of the day joins the first.
  fs.appendFileSync(path.join(dir, '2026-11-12.md'), '\n### 10:02\n**User:** more\n');
  json(box, ['log', 'log:2026-11-12', 'No calls before ten', '--decision', '--who', 'overrode', '--source', 'session 2026-11-12', ...base]);
  assert.equal((fs.readFileSync(path.join(dir, '2026-11-12.md'), 'utf8').match(/<!-- timeline -->/g) || []).length, 1);
  const listed = json(box, ['decisions', ...base]).data.decisions;
  assert.deepEqual(listed.map((d) => [d.page, d.who]).sort(), [['log:2026-11-12', 'overrode'], ['log:2026-11-12', 'owner']]);

  const reviewed = json(box, ['decisions', 'review', listed.find((d) => d.who === 'owner').id, 'as-expected', '--source', 'check-in', ...base]);
  assert.equal(reviewed.code, 0, reviewed.err || reviewed.out);
  assert.equal(json(box, ['decisions', '--outcome', 'as-expected', ...base]).data.decisions.length, 1);
});

test('a session in a linked repo is shown the project\'s standing decisions, not the reversed ones', (t) => {
  const { box, base } = brainWithDecisions(t);
  const repo = path.join(box.dir, 'acme-code');
  fs.mkdirSync(repo);
  spawnSync('git', ['init', '-q'], { cwd: repo });
  spawnSync('git', ['remote', 'add', 'origin', 'https://example.com/globex/acme.git'], { cwd: repo });
  assert.equal(cogby(box, ['link', 'projects/acme/card', '--repo', repo, ...base]).code, 0);

  let context = json(box, ['context', '--repo', repo, ...base]).data;
  assert.match(context.text, /### Decisions in force/);
  assert.match(context.text, /- 2026-11-05 \| Keep one parallel month, not two \(owner\)/);
  assert.match(context.text, /- 2026-11-03 \| Go live in January, not December: the audit comes first \(accepted\) · review was due 2020-01-01/);
  assert.doesNotMatch(context.text, /Static site, not a CMS \(overrode\)/, 'another project\'s decision');
  assert.equal(context.project.decisions.length, 2);

  const target = context.project.decisions.find((d) => d.date === '2026-11-03');
  json(box, ['decisions', 'review', target.id, 'reversed', '--source', 'call', ...base]);
  context = json(box, ['context', '--repo', repo, ...base]).data;
  assert.doesNotMatch(context.text, /Go live in January, not December: the audit comes first \(accepted\)/);
  assert.equal(context.project.decisions.length, 1);
});

test('the view counts the week\'s decisions and the review cards can show one unticked', (t) => {
  const box = newBrain(t);
  const base = ['--brain', box.brain];
  const today = new Date();
  const day = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  json(box, ['log', 'projects/acme/card', 'Vendor B, not vendor A', '--decision', '--who', 'overrode', '--review', '2020-01-01', '--expect', 'cheaper by spring', '--source', 'call', '--create', ...base]);
  json(box, ['log', 'projects/acme/card', 'An old one', '--decision', '--source', 'call', '--date', '2020-02-02', ...base]);
  const view = json(box, ['view', ...base]).data.decisions;
  assert.equal(view.today, 1);
  assert.deepEqual(view.week.by_who, { owner: 0, accepted: 0, overrode: 1, agent: 0, not_recorded: 0 });
  assert.deepEqual(view.due.map((d) => [d.date, d.text, d.expect]), [[day, 'Vendor B, not vendor A', 'cheaper by spring']]);

  for (const name of ['wrap-up-review', 'debrief-review']) {
    const html = cards.render(name, { items: [{ kind: 'Decision', text: 'Postgres, not Mongo', where: 'projects/x · owner' }, { kind: 'Decision', text: 'Do the export first', where: 'unsure', ticked: false }] }, () => box.brain).html;
    assert.match(html, /data-line="1"><input type="checkbox" checked>/, `${name}: an item is ticked unless it says otherwise`);
    assert.match(html, /data-line="2"><input type="checkbox">/, `${name}: ticked: false must start unticked`);
  }
});

test('the log tool takes who made the call, and a tool-written decision is an agent\'s line', (t) => {
  const box = newBrain(t);
  const requests = [
    { method: 'tools/call', params: { name: 'log', arguments: { slug: 'projects/demo', line: 'Ship weekly, not daily', source: 'session', create: true, decision: true, who: 'accepted', expect: 'fewer rollbacks', review: '2027-01-10' } } },
    { method: 'tools/call', params: { name: 'log', arguments: { slug: 'projects/demo', line: 'x', source: 'session', decision: true, who: 'someone' } } },
  ];
  const input = requests.map((request, index) => JSON.stringify({ jsonrpc: '2.0', id: index + 1, ...request })).join('\n') + '\n';
  const result = spawnSync(process.execPath, [CLI, 'serve', '--mcp'], { env: { ...box.env, CLAUDE_PROJECT_DIR: box.brain }, cwd: box.brain, encoding: 'utf8', input });
  const replies = result.stdout.trim().split('\n').map((line) => JSON.parse(line));
  assert.match(JSON.parse(replies[0].result.content[0].text).line, /decision: Ship weekly, not daily \(who: accepted · expect: fewer rollbacks · review: 2027-01-10\) \[[^\]]*agent · unconfirmed\]/);
  assert.equal(replies[1].result.isError, true);
  const listed = json(box, ['decisions', '--brain', box.brain]).data.decisions;
  assert.deepEqual(listed.map((d) => [d.who, d.actor, d.confirmed]), [['accepted', 'agent', false]]);
  assert.equal(decisions.decisionId(listed[0].date, 'ship weekly  NOT daily!'), listed[0].id, 'the id ignores case, spacing and punctuation');
});

test('who made a call that was logged without it is added later as a line of its own, never by editing the decision', (t) => {
  const box = newBrain(t);
  const base = ['--brain', box.brain];
  const run = (args, options) => json(box, [...args, ...base], options);
  const ok = (args, options) => { const out = run(args, options); assert.equal(out.code, 0, out.err || out.out); return out.data; };
  ok(['log', 'projects/acme/card', 'Go live in January, not December', '--decision', '--source', 'call with Sara', '--date', '2026-11-03', '--create']);
  ok(['log', 'projects/acme/card', 'Keep one parallel month, not two', '--decision', '--who', 'owner', '--source', 'call with Sara', '--date', '2026-11-05']);
  const before = read(box, 'projects/acme/card.md');
  const unrecorded = ok(['decisions', '--who', 'none']);
  assert.deepEqual(unrecorded.decisions.map((d) => [d.date, d.who]), [['2026-11-03', null]]);
  assert.deepEqual(unrecorded.counts.by_who, { owner: 0, accepted: 0, overrode: 0, agent: 0, not_recorded: 1 }, 'the counts are of the calls asked for');
  const { id } = unrecorded.decisions[0];

  // A line that cannot be read back, or points at no decision on the page, is refused: nothing is written.
  assert.equal(run(['log', 'projects/acme/card', `who: sara, decision of 2026-11-03 #${id}`, '--source', 'weekly review']).data.error.code, 'BAD_WHO');
  assert.equal(run(['log', 'projects/acme/card', 'who: accepted, decision of 2026-11-03 #000000', '--source', 'weekly review']).data.error.code, 'NOT_FOUND');
  assert.equal(run(['log', 'projects/acme/card', `who: accepted, decision of 2026-11-04 #${id}`, '--source', 'weekly review']).data.error.code, 'NOT_FOUND');
  assert.equal(read(box, 'projects/acme/card.md'), before);

  // The owner's answer, written by the session that asked.
  const said = ok(['log', 'projects/acme/card', `who: accepted, decision of 2026-11-03 #${id}`, '--source', 'weekly review 2026-11-14, the owner\'s answer', '--date', '2026-11-14'], { env: { CLAUDECODE: '1' } });
  assert.match(said.line, new RegExp(String.raw`\| weekly review 2026-11-14, the owner's answer — who: accepted, decision of 2026-11-03 #${id} \[[^\]]*agent claude-code · unconfirmed\]$`));
  const after = read(box, 'projects/acme/card.md');
  assert.ok(after.includes('- **2026-11-03** | call with Sara — decision: Go live in January, not December ['), 'the decision\'s own line is as it was written');
  assert.equal(after.split('\n').filter((line) => /decision: Go live/.test(line)).join(), before.split('\n').filter((line) => /decision: Go live/.test(line)).join());

  const listed = ok(['decisions']);
  assert.deepEqual(listed.decisions.map((d) => [d.date, d.who, d.who_recorded_on]), [['2026-11-05', 'owner', null], ['2026-11-03', 'accepted', '2026-11-14']]);
  assert.equal(listed.decisions.length, 2, 'it is not a decision of its own');
  assert.deepEqual(listed.counts.by_who, { owner: 1, accepted: 1, overrode: 0, agent: 0, not_recorded: 0 });
  assert.equal(ok(['decisions', '--who', 'none']).decisions.length, 0, 'so it is not asked about again');
  assert.match(cogby(box, ['decisions', ...base]).out, new RegExp(String.raw`${id}  2026-11-03  projects/acme/card  accepted \(said 2026-11-14\)`));
  // A session in the linked project sees who made it.
  assert.equal(ok(['decisions', '--project', 'acme']).decisions.find((d) => d.id === id).who, 'accepted');

  // What a decision says about itself stands: a later line does not change it.
  const own = listed.decisions[0];
  ok(['log', 'projects/acme/card', `who: overrode, decision of 2026-11-05 #${own.id}`, '--source', 'weekly review', '--date', '2026-11-14']);
  assert.equal(ok(['decisions']).decisions.find((d) => d.id === own.id).who, 'owner');
  // Said twice, the newest answer is the one read.
  ok(['log', 'projects/acme/card', `who: overrode, decision of 2026-11-03 #${id}`, '--source', 'the owner, corrected', '--date', '2026-11-15']);
  assert.deepEqual(ok(['decisions']).decisions.filter((d) => d.id === id).map((d) => [d.who, d.who_recorded_on]), [['overrode', '2026-11-15']]);

  // A decision about no page in particular, in the day's log, takes one too.
  const logged = ok(['log', 'log:2026-11-12', 'Invoices are sent on the 1st, not on delivery', '--decision', '--source', 'session 2026-11-12']);
  assert.equal(logged.status, 'inserted');
  const dayId = ok(['decisions', '--who', 'none']).decisions[0].id;
  ok(['log', 'log:2026-11-12', `who: owner, decision of 2026-11-12 #${dayId}`, '--source', 'weekly review']);
  assert.equal(ok(['decisions']).decisions.find((d) => d.id === dayId).who, 'owner');
  // An ordinary line that starts with "who" is still an ordinary line.
  assert.equal(ok(['log', 'projects/acme/card', 'who: Sara and Karim joined the call', '--source', 'call']).status, 'inserted');

  const check = fs.readFileSync(path.join(ROOT, '.claude', 'skills', 'check-in', 'SKILL.md'), 'utf8').replace(/\r\n/g, '\n');
  assert.match(check, /`cogby decisions --who none --since <seven days ago>`/);
  assert.match(check, /ask once who made that call/);
  assert.match(check, /`cogby log <page> "who: owner\|accepted\|overrode\|agent, decision of <date> #<id>" --source "weekly review <date>, the owner's answer"`/);
  assert.match(check, /The decision's line is never edited/);
  assert.match(check, /Never fill it in yourself/);
  assert.match(cogby(box, ['--help']).out, /log <page> "who: accepted, decision of <date> #<id>" --source/);
});

test('a call an agent made alone is a fourth kind: logged, listed, counted, crossed with how it turned out', (t) => {
  const box = newBrain(t);
  const base = ['--brain', box.brain];
  const run = (args) => json(box, [...args, ...base]);
  const ok = (args) => { const out = run(args); assert.equal(out.code, 0, out.err || out.out); return out.data; };
  assert.deepEqual(page.WHO, ['owner', 'accepted', 'overrode', 'agent']);

  // Logged with it, the line carries it and the list gives it back.
  const made = ok(['log', 'projects/website/card', 'Plain CSS, not a framework: three pages', '--decision', '--who', 'agent', '--expect', 'no build step to keep up', '--review', '2027-01-15', '--source', 'the landing page, built 2026-11-10', '--date', '2026-11-10', '--create']);
  assert.match(made.line, /decision: Plain CSS, not a framework: three pages \(who: agent · expect: no build step to keep up · review: 2027-01-15\)/);
  ok(['log', 'projects/website/card', 'Static site, not a CMS', '--decision', '--who', 'owner', '--source', 'call', '--date', '2026-11-08']);
  const listed = ok(['decisions']);
  assert.deepEqual(listed.decisions.map((d) => [d.date, d.who]), [['2026-11-10', 'agent'], ['2026-11-08', 'owner']]);
  assert.deepEqual(listed.counts.by_who, { owner: 1, accepted: 0, overrode: 0, agent: 1, not_recorded: 0 });
  assert.deepEqual(listed.counts.outcome_by_who.agent, { total: 1, reviewed: 0, as_expected: 0, not_as_expected: 0, reversed: 0 });
  const text = () => cogby(box, ['decisions', ...base]).out;
  assert.match(text(), /2026-11-10 {2}projects\/website\/card {2}agent · review 2027-01-15/);
  assert.match(text(), /2 decisions in scope: 1 yours alone, 0 accepted from Claude, 0 overrode Claude, 1 by an agent alone, 0 not recorded · /);
  assert.equal(decisions.outcomeLine(listed.counts), '', 'nothing reviewed, nothing said');

  // --who agent filters, and the counts are of those calls.
  const mine = ok(['decisions', '--who', 'agent']);
  assert.deepEqual(mine.decisions.map((d) => d.date), ['2026-11-10']);
  assert.deepEqual(mine.counts.by_who, { owner: 0, accepted: 0, overrode: 0, agent: 1, not_recorded: 0 });
  assert.deepEqual(ok(['decisions', '--who', 'owner']).decisions.map((d) => d.date), ['2026-11-08']);

  // Reviewed, it is in the cross and in the sentence.
  ok(['decisions', 'review', mine.decisions[0].id, 'not-as-expected', '--source', 'the owner, 2027-01-15']);
  const after = ok(['decisions']).counts;
  assert.deepEqual(after.outcome_by_who.agent, { total: 1, reviewed: 1, as_expected: 0, not_as_expected: 1, reversed: 0 });
  assert.equal(decisions.outcomeLine(after), 'Decided by an agent alone 1 time: 1 not as expected.');
  assert.match(text(), /\nDecided by an agent alone 1 time: 1 not as expected\.\n/);

  // Said later, for a decision logged with nobody recorded.
  ok(['log', 'projects/website/card', 'System fonts, not a web font', '--decision', '--source', 'the landing page', '--date', '2026-11-11']);
  const { id } = ok(['decisions', '--who', 'none']).decisions[0];
  assert.deepEqual(page.parseWho(`who: agent, decision of 2026-11-11 #${id}`), { who: 'agent', date: '2026-11-11', id, note: '' });
  ok(['log', 'projects/website/card', `who: agent, decision of 2026-11-11 #${id}`, '--source', 'weekly review 2026-11-14, the owner\'s answer', '--date', '2026-11-14']);
  assert.deepEqual(ok(['decisions']).decisions.filter((d) => d.id === id).map((d) => [d.who, d.who_recorded_on]), [['agent', '2026-11-14']]);
  assert.deepEqual(ok(['decisions', '--who', 'agent']).decisions.map((d) => d.date), ['2026-11-11', '2026-11-10']);
  assert.equal(ok(['decisions', '--who', 'none']).decisions.length, 0);

  // The help names it.
  assert.match(cogby(box, ['--help']).out, /--decision --who owner\|accepted\|overrode\|agent /);
  assert.match(cogby(box, ['--help']).out, /\[--who owner\|accepted\|overrode\|agent\|none\]/);
});
