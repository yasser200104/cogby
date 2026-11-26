'use strict';

// The plan-page skill's slide template and its checker (.claude/skills/plan-page/assets). Every
// decision page is slides: the template is that page, and the checker faults a page not built from it.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { ROOT } = require('./helpers.cjs');

const SKILL = path.join(ROOT, '.claude', 'skills', 'plan-page');
const CHECKER = path.join(SKILL, 'assets', 'check-page.cjs');
const read = (...parts) => fs.readFileSync(path.join(SKILL, ...parts), 'utf8').replace(/\r\n/g, '\n');
const template = read('assets', 'slides.html');

// The template, filled the way a session fills it: every slot, the look, and the guide comments gone.
const filled = template
  .replace(/[ \t]*<!-- TEMPLATE:[\s\S]*?-->\n/g, '')
  .replace('PLACEHOLDER LOOK', 'LOOK')
  .replace(/REPLACE: T3/g, 'T3')
  .replace(/data-value="REPLACE: (\w+)"/g, 'data-value="$1"')
  .replace(/data-cost="REPLACE:[^"]*"/g, 'data-cost="2"')
  .replace(/REPLACE:[^<"]*/g, 'Filled in');

function check(t, html) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cogby-page-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5 }));
  const file = path.join(dir, 'page.html');
  fs.writeFileSync(file, html);
  const result = spawnSync(process.execPath, [CHECKER, file, '--json'], { encoding: 'utf8' });
  return { code: result.status, ...JSON.parse(result.stdout) };
}

// One change to the filled page, and the fault it must raise.
function once(text, from, to) {
  assert.equal(text.split(from).length, 2, `the page does not hold exactly one "${String(from).slice(0, 40)}"`);
  return text.replace(from, () => to);
}

test('the slide template carries the decision kit as written, and reads everything from the page', () => {
  assert.ok(template.includes(read('assets', 'decision-kit.js')), 'the kit inside slides.html is not decision-kit.js');
  const script = /<script>([\s\S]*?)<\/script>/.exec(template)[1];
  assert.doesNotMatch(script, /REPLACE:/, 'the script has a slot to fill');
  // Nothing starts chosen, and an answer is saved on the click or the keystroke itself.
  assert.doesNotMatch(template, /aria-pressed="true"|<input\b[^>]*\bchecked\b/);
  assert.match(script, /addEventListener\("click", function \(\) \{\s*kit\.mark\(/);
  assert.match(script, /addEventListener\("input", function \(\) \{\s*kit\.note\(/);
  // The recommendation is read off the option it is marked on, never typed a second time.
  assert.match(script, /\[data-recommended\]/);
  assert.match(script, /recommended: recommended/);
  // Keys, buttons and a swipe each move one slide.
  for (const move of ['"ArrowRight"', '"ArrowLeft"', '"touchstart"', '"touchend"', '[data-prev]', '[data-next]']) {
    assert.ok(script.includes(move), `the script has no ${move}`);
  }
});

test('the template as shipped is slides: its only faults are the slots a session has not filled', (t) => {
  const result = check(t, template);
  assert.equal(result.code, 1);
  assert.ok(result.passes.some((line) => /^Built as slides/.test(line)), result.faults.join('\n'));
  assert.equal(result.faults.length, 2, result.faults.join('\n'));
  assert.match(result.faults[0], /Template marker left in the page: "REPLACE:"/);
  assert.match(result.faults[1], /placeholder look/);
  // A guide comment left in is a fault of its own, also when every slot is filled.
  const withGuide = check(t, once(filled, '<main ', '<!-- TEMPLATE: the opening slide. -->\n<main '));
  assert.match(withGuide.faults.join('\n'), /Template marker left in the page: "TEMPLATE:"/);
});

test('a filled template passes with no fault', (t) => {
  const result = check(t, filled);
  assert.deepEqual(result.faults, []);
  assert.equal(result.code, 0);
  assert.ok(result.passes.some((line) => /^Built as slides: an opening explanation with a visual, 1 decision/.test(line)));
});

const optionsGroup = /<div class="options" data-options[\s\S]*?<\/div>\n/.exec(filled)[0];
const BROKEN = [
  ['one long page', (p) => once(p, ' data-slides', ''), /Not built as slides/],
  ['no slide at all', (p) => p.replace(/ data-slide="[a-z]+"/g, ''), /Not built as slides/],
  ['no opening explanation', (p) => once(p, 'data-slide="intro"', 'data-slide="aside"'), /No opening explanation/],
  ['an opening with no visual', (p) => once(p, /<figure class="ba" data-ba>[\s\S]*?<\/figure>\n/, ''), /opening explanation has no visual/],
  ['two decisions on one slide', (p) => once(p, optionsGroup, optionsGroup + optionsGroup), /More than one decision on a slide \(T3\)/],
  ['a second id inside a slide', (p) => once(p, '<h2>Filled in</h2>\n    <p class="plain">', '<h2 data-id="T4">Filled in</h2>\n    <p class="plain">'), /More than one decision on a slide/],
  ['a decision with no control', (p) => once(p, optionsGroup, ''), /A decision with no control \(T3\)/],
  ['an id the reader never sees', (p) => once(p, '<span class="id">T3</span>', ''), /never shows its id/],
  ['a recommendation with no label', (p) => once(p, '<span class="rec">Recommended</span>', ''), /not labelled as recommended/],
  ['a control on the opening slide', (p) => once(p, '<div class="cards">', '<div class="cards" data-options>'), /not a decision slide/],
  ['no progress strip', (p) => once(once(p, /<nav class="strip"[\s\S]*?<\/nav>\n/, ''), ' data-count', ''), /No progress strip/],
  ['no answers slide', (p) => once(p, 'data-slide="answers"', 'data-slide="aside"'), /No answers slide/],
  ['no arrow keys', (p) => once(p, '"ArrowRight"', '"PageDown"'), /No way to move between slides by the left and right arrow keys/],
  ['no buttons', (p) => once(p, '<button type="button" data-prev>', '<button type="button">'), /No way to move between slides by Previous and Next buttons/],
  ['a choice already made', (p) => p.replace('aria-pressed="false"', 'aria-pressed="true"'), /control starts pre-selected/],
  ['a dash in the text', (p) => once(p, '<h2>Your answers</h2>', '<h2>Your answers — all of them</h2>'), /em dash or en dash/],
  ['no closing section', (p) => once(p, '<h2>How this was reached</h2>', '<h2>Notes</h2>'), /No "How this was reached" section/],
];

for (const [name, breakIt, fault] of BROKEN) {
  test(`the checker faults ${name}`, (t) => {
    const result = check(t, breakIt(filled));
    assert.equal(result.code, 1);
    assert.match(result.faults.join('\n'), fault);
  });
}

test('the skill says slides for every page, and what the opening visual must show', () => {
  const skill = read('SKILL.md');
  assert.match(skill, /\*\*Every page is built from `assets\/slides\.html`\.\*\*/);
  assert.match(skill, /- 2026-11-22: \*\*Every decision page is slides, whatever the number of rows/);
  assert.doesNotMatch(skill, /- \*\*Every decision is visible at rest/);
  assert.doesNotMatch(skill, /more than about fifteen rows/);
  for (const line of ['the real screen as it is, and as it would be', "a map of the page's own rows", 'a decorative diagram']) {
    assert.ok(skill.includes(line), `the skill no longer says: ${line}`);
  }
  assert.match(skill, /## Step 0: Read the before\/after, once per session/);
});
