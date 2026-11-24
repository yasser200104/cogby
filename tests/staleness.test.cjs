'use strict';

// A page is stale when nothing new has been said about it in 14 days, counted from the day the
// evidence was written down. A fact carries two days: the one it became true (`valid_from`) and the
// one it was recorded (`recorded`). Only the second says whether the page heard something new.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { ROOT, newBrain, cogby, json } = require('./helpers.cjs');
const page = require(path.join(ROOT, 'core', 'brain', 'page.cjs'));
const { isoDay } = require(path.join(ROOT, 'core', 'brain', 'dream.cjs'));

const daysAgo = (n) => isoDay(new Date(Date.now() - n * 86400000));

function writePage(box, rel, body) {
  const file = path.join(box.brain, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, body);
}

test('a fact recorded today keeps its page fresh, whatever day it became true', (t) => {
  const box = newBrain(t);
  const base = ['--brain', box.brain];
  const today = daysAgo(0);
  const yearAgo = daysAgo(365);
  writePage(box, 'areas/contracts/card.md', '---\ntype: area\ntitle: Contracts\n---\n# Contracts\n\nThe provider contracts the business runs on.\n');
  assert.equal(cogby(box, ['sync', ...base]).code, 0);
  const saved = json(box, ['remember', 'areas/contracts/card', 'The hosting contract renews every March', '--source', 'signed contract', '--valid-from', yearAgo, ...base]);
  assert.equal(saved.code, 0, saved.err || saved.out);

  const pass = json(box, ['dream', ...base]).data;
  assert.ok(!pass.stale.some((entry) => entry.slug === 'areas/contracts/card'), `flagged as stale: ${JSON.stringify(pass.stale)}`);
  const view = json(box, ['view', ...base]).data;
  assert.ok(!view.stale.some((entry) => entry.slug === 'areas/contracts/card'), 'the view agrees');

  // The row keeps both days in the file, which is what the index is rebuilt from.
  const parsed = page.parsePage('areas/contracts/card.md', fs.readFileSync(path.join(box.brain, 'areas', 'contracts', 'card.md'), 'utf8'));
  assert.deepEqual(parsed.facts.map((fact) => [fact.valid_from, fact.recorded]), [[yearAgo, today]]);
});

test('a page whose newest evidence is 20 days old is stale, by the day it was recorded', (t) => {
  const box = newBrain(t);
  const base = ['--brain', box.brain];
  const old = daysAgo(20);
  const head = '| # | claim | kind | valid_from | valid_until | recorded | source | by | status |\n|---|---|---|---|---|---|---|---|---|\n';
  // Recorded 20 days ago about a price that applies from today: written down long ago, so stale.
  writePage(box, 'areas/pricing/card.md', `---\ntype: area\ntitle: Pricing\n---\n# Pricing\n\nWhat we charge.\n\n## Facts\n${head}`
    + `| 1 | The new rate applies from today | fact | ${daysAgo(0)} | | ${old} | rate card | yasser · human · confirmed | active |\n`
    + `\n<!-- timeline -->\n- **${daysAgo(30)}** | rate card — rates reviewed [yasser · human · confirmed]\n`);
  // A page written before facts carried a recorded day: its valid_from stands in for it.
  writePage(box, 'areas/office/card.md', '---\ntype: area\ntitle: Office\n---\n# Office\n\nThe lease.\n\n## Facts\n'
    + '| # | claim | kind | valid_from | valid_until | source | by | status |\n|---|---|---|---|---|---|---|---|\n'
    + `| 1 | The lease runs to 2028 | fact | ${old} | | lease | yasser · human · confirmed | active |\n`);
  writePage(box, 'areas/team/card.md', '---\ntype: area\ntitle: Team\n---\n# Team\n\nWho works here.\n\n## Facts\n'
    + '| # | claim | kind | valid_from | valid_until | source | by | status |\n|---|---|---|---|---|---|---|---|\n'
    + `| 1 | Sara leads support | fact | ${daysAgo(3)} | | org chart | yasser · human · confirmed | active |\n`);
  assert.equal(cogby(box, ['sync', ...base]).code, 0);

  const stale = Object.fromEntries(json(box, ['dream', ...base]).data.stale.map((entry) => [entry.slug, entry]));
  assert.deepEqual(stale['areas/pricing/card'], { slug: 'areas/pricing/card', newest: old, days: 20 });
  assert.deepEqual(stale['areas/office/card'], { slug: 'areas/office/card', newest: old, days: 20 });
  assert.equal(stale['areas/team/card'], undefined, 'three days old is fresh');
});

test('an old facts table gains the recorded column on its next write, and its old rows stay as they were', (t) => {
  const box = newBrain(t);
  const base = ['--brain', box.brain];
  const old = daysAgo(40);
  writePage(box, 'areas/office/card.md', '---\ntype: area\ntitle: Office\n---\n# Office\n\nThe lease.\n\n## Facts\n'
    + '| # | claim | kind | valid_from | valid_until | source | by | status |\n|---|---|---|---|---|---|---|---|\n'
    + `| 1 | The lease runs to 2028 | fact | ${old} | | lease | yasser · human · confirmed | active |\n`);
  assert.equal(cogby(box, ['sync', ...base]).code, 0);
  assert.equal(json(box, ['remember', 'areas/office/card', 'The landlord is Acme Estates', '--source', 'lease', ...base]).code, 0);
  const text = fs.readFileSync(path.join(box.brain, 'areas', 'office', 'card.md'), 'utf8');
  assert.match(text, /^\| # \| claim \| kind \| valid_from \| valid_until \| recorded \| source \| by \| status \|$/m);
  const facts = page.parsePage('areas/office/card.md', text).facts;
  assert.deepEqual(facts.map((fact) => [fact.row, fact.valid_from, fact.recorded]), [[1, old, ''], [2, daysAgo(0), daysAgo(0)]]);
});
