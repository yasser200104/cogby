'use strict';

// The rules every skill is held to (docs/reference.md, "How the skills are built"). A skill that names a
// script, a tool or another skill that is not there fails here, not in front of a person.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { ROOT } = require('./helpers.cjs');

const SKILLS = path.join(ROOT, '.claude', 'skills');
const names = fs.readdirSync(SKILLS).filter((name) => fs.existsSync(path.join(SKILLS, name, 'SKILL.md')));
const read = (name) => fs.readFileSync(path.join(SKILLS, name, 'SKILL.md'), 'utf8');
const TOOLS = JSON.parse(fs.readFileSync(path.join(ROOT, 'tests', 'tools.json'), 'utf8'));
const { COMMANDS } = require(path.join(ROOT, 'core', 'brain', 'cli.cjs'));

// Brain and Work skills are short. The three Output skills are the owner's and are left as they are.
const OUTPUT = new Set(['plan-page', 'design', 'clean-writing']);
const MAX_LINES = 160;
// Onboarding carries its own questions, where they used to come from the card tool: it has to work in
// the chat where the plugin was just installed, before Cogby's tool server runs. Its screens are files
// beside it.
// 204 since 2026-11-24: the six steps the chat lists moved in from screens-text.md, which is read too late.
const MAX_LINES_OF = { onboarding: 204 };

function frontmatter(text) {
  const block = /^---\n([\s\S]*?)\n---\n/.exec(text);
  assert.ok(block, 'no frontmatter');
  // A value is the rest of its line, plus the indented lines under it (a folded `>` block).
  const field = (key) => {
    const lines = block[1].split('\n');
    const at = lines.findIndex((line) => line.startsWith(`${key}:`));
    if (at < 0) return '';
    const parts = [lines[at].slice(key.length + 1).replace(/^\s*>\s*$/, '')];
    for (let i = at + 1; i < lines.length && /^\s+\S/.test(lines[i]); i++) parts.push(lines[i]);
    return parts.join(' ');
  };
  return { name: field('name').trim(), description: field('description').replace(/\s+/g, ' ').trim() };
}

test('the plugin ships exactly the skills it documents', () => {
  assert.deepEqual(names.slice().sort(), [
    'capture', 'check-in', 'digest', 'look-back', 'meeting-notes', 'meeting-prep', 'picture', 'quiz-me', 'routines', 'onboarding', 'wrap-up',
    'clean-writing', 'my-view', 'design', 'plan-page', 'notion-mirror',
  ].sort());
});

for (const name of names) {
  test(`skill ${name}: named after its folder, says when to fire and when not to`, () => {
    const meta = frontmatter(read(name));
    assert.equal(meta.name, name);
    assert.ok(meta.description.length > 80, 'the description is too short to trigger on');
    assert.ok(meta.description.length < 1024, 'the description is over the length Claude Code reads');
    assert.match(meta.description, /NOT |not for|Does NOT/i, 'the description does not say what the skill is not for');
    // Cowork refuses a plugin whose skill description holds anything shaped like a tag.
    assert.doesNotMatch(meta.description, /<[^>]*>/, 'the description holds angle brackets, which Cowork refuses on upload');
  });

  test(`skill ${name}: everything it names exists`, () => {
    const text = read(name);
    for (const [, script] of text.matchAll(/node (core\/[a-z/-]+\.cjs)/g)) {
      assert.ok(fs.existsSync(path.join(ROOT, script)), `${script} is not in the plugin`);
    }
    for (const [, command] of text.matchAll(/`cogby ([a-z]+)\b/g)) {
      assert.ok(COMMANDS.has(command) || command === 'help', `\`cogby ${command}\` is not a command`);
    }
    for (const [, tool] of text.matchAll(/`([a-z_]+)` tool\b/g)) {
      assert.ok(TOOLS.includes(tool), `the \`${tool}\` tool does not exist`);
    }
    for (const [, other] of text.matchAll(/`((?:tool-|meta-|ops-)[a-z-]+|capture|check-in|command-center|my-view|clean-writing|html-plan|plan-page|wrap-up|meeting-prep|meeting-debrief|meeting-notes|quiz-me|onboarding|setup)`/g)) {
      if (other === 'capture') continue; // also plain words
      assert.ok(names.includes(other), `it names the skill \`${other}\`, which is not shipped`);
    }
    assert.doesNotMatch(text, /cogby-brain\/|core\/ops\/notify\.cjs|induce-goals|Skill Registry|the Inbox|Settings >/, 'wording from the full Cogby program');
  });

  if (!OUTPUT.has(name)) {
    test(`skill ${name}: short enough to read in one sitting`, () => {
      const lines = read(name).split('\n').length;
      const limit = MAX_LINES_OF[name] || MAX_LINES;
      assert.ok(lines <= limit, `${lines} lines; the limit is ${limit}`);
    });
  }
}

test('no skill reaches for its own files through the session folder', () => {
  // An installed skill lives in Claude Code's cache, not in <session>/.claude/skills.
  for (const name of names) {
    assert.doesNotMatch(read(name), /node \.claude\/skills\//, `${name} runs a script by a path that only exists in this repository`);
  }
});

test('the design skill ships a real design system', () => {
  const system = fs.readFileSync(path.join(SKILLS, 'design', 'systems', 'main.md'), 'utf8');
  assert.doesNotMatch(system, /Replace this file/i);
  for (const part of ['## Tokens', '## Type', '## Components', '## Don\'t', '--canvas', '--primary']) {
    assert.ok(system.includes(part), `the default design system has no ${part}`);
  }
});

test('a plan-page answer says what the page recommended, and the skill turns verdicts into offered decisions', () => {
  // The kit is the page's own script: with no browser it keeps its answers in memory, which is enough here.
  const kitFor = (opts) => new Function(`${fs.readFileSync(path.join(SKILLS, 'plan-page', 'assets', 'decision-kit.js'), 'utf8')}\nreturn DecisionKit;`)()(opts);
  const kit = kitFor({ slug: 'release', recommended: { T3: 'keep', M6: 'keep' } });
  kit.mark('T3', 'keep');
  kit.mark('M6', 'cut');
  kit.note('M6', 'not this quarter');
  const lines = kit.block(['T3', 'M6', 'S1']).split('\n');
  assert.match(lines[0], /^=== COGBY ANSWERS · release · \d{4}-\d\d-\d\d ===$/);
  assert.deepEqual(lines.slice(1), ['T3: keep', 'M6: cut · not this quarter', 'recommended: T3=keep, M6=keep', 'unanswered: S1', '=== END ===']);
  assert.deepEqual(kit.answers().recommended, { T3: 'keep', M6: 'keep' });
  assert.equal(kit.recommendedOf('S1'), undefined);
  // A page that recommended nothing says so: only a block from an older page has no such line.
  const plain = kitFor({ slug: 'release' });
  plain.mark('T3', 'keep');
  assert.deepEqual(plain.block(['T3']).split('\n').slice(1), ['T3: keep', 'recommended: none', '=== END ===']);

  const plan = read('plan-page');
  assert.match(plan, /## Step 9: Offer the verdicts that are decisions/);
  for (const who of ['accepted', 'overrode', 'owner']) assert.match(plan, new RegExp(`\\| \`${who}\` \\|`), `the skill does not say when a verdict is ${who}`);
  assert.match(plan, /every one unticked/);
  assert.match(plan, /never guess/);
  assert.match(plan, /--decision --who accepted \\\r?\n\s+--source "<the page's file name>, answered <YYYY-MM-DD>"/);
  assert.match(plan, /recommended: \{ T3: "keep"/, 'the skill does not tell a page to pass its recommendations to the kit');
});

test('the weekly check-in reports how the calls turned out, with no advice', () => {
  const text = read('check-in');
  assert.match(text, /how the calls turned out, over every decision/);
  assert.match(text, /with no advice/);
});

test('one trigger phrase belongs to one skill', () => {
  const quoted = new Map();
  for (const name of names) {
    const description = frontmatter(read(name)).description.split(/NOT |Does NOT/)[0];
    for (const [, phrase] of description.matchAll(/"([^"]{6,})"/g)) {
      const key = phrase.toLowerCase().replace(/[.…,]+$/, '');
      assert.ok(!quoted.has(key) || quoted.get(key) === name, `"${phrase}" triggers both ${quoted.get(key)} and ${name}`);
      quoted.set(key, name);
    }
  }
});

