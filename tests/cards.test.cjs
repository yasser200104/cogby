'use strict';

// The card kit: small pieces of interface shown inside the chat. One look, one behaviour, and
// nothing a card was given can become markup or code.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { ROOT, CLI, sandbox, cogby, newBrain } = require('./helpers.cjs');
const cards = require(path.join(ROOT, 'core', 'brain', 'cards.cjs'));

const HOSTILE = '</script><script>alert(1)</script> "quoted" \'single\' <img src=x onerror=alert(1)> & more';
const SAMPLE = {
  'wrap-up-review': { items: [{ kind: 'Progress', text: HOSTILE, where: 'projects/acme' }, { kind: 'Files', text: '3 files', where: 'commit' }] },
  'quiz': { topic: HOSTILE, questions: [{ question: HOSTILE, options: ['12 March', HOSTILE, '30 April'], answer: HOSTILE, why: HOSTILE, source: HOSTILE }, { question: 'Why Acme?', answer: HOSTILE }] },
  'debrief-review': { title: 'Acme weekly', date: '2026-11-11', page: 'projects/acme', summary: ['Cutover moved to 2 December.', HOSTILE], transcript: 'none', items: [{ kind: 'Decision', text: HOSTILE, where: 'projects/acme' }, { kind: 'You will', text: 'Send the plan', where: 'to-do' }] },
  'digest-review': { title: HOSTILE, source: HOSTILE, page: 'projects/acme', summary: HOSTILE, items: [{ kind: 'Fact', text: HOSTILE, where: 'projects/acme' }, { kind: 'Open question', text: 'Who signs off?', where: 'needs you' }] },
};

// The four cards there are. Six were removed. Five (setup, setup-review, check-in, meeting-brief,
// wrap-up-summary): what they showed is said in the chat, and onboarding shows its own fixed screens.
// The picture: a fixed card could only set words in boxes, so the session now draws the idea itself
// with the chat's own visual tool.
const KEPT = ['debrief-review', 'digest-review', 'quiz', 'wrap-up-review'];
const REMOVED = ['setup', 'setup-review', 'check-in', 'meeting-brief', 'wrap-up-summary', 'picture'];
const renderAll = () => cards.names().map((name) => [name, cards.render(name, SAMPLE[name]).html]);

test('every card renders, with one shared look that follows the host\'s light or dark', () => {
  const rendered = renderAll();
  assert.deepEqual(cards.names().slice().sort(), KEPT, 'the cards are no longer the four that were kept');
  // The colours are the host's theme variables, with Cogby's own after the comma: no second palette
  // of its own for dark, which could disagree with how the host says it is dark.
  for (const variable of ['--text-primary', '--text-secondary', '--surface-2', '--surface-1', '--border']) {
    assert.ok(cards.STYLE.includes(`var(${variable},`), `the cards do not follow the host's ${variable}`);
  }
  assert.doesNotMatch(cards.STYLE, /data-mode|prefers-color-scheme/, 'the cards keep a dark palette of their own');
  for (const [name, html] of rendered) {
    assert.ok(html.startsWith('<style>\n.cg{--cg-'), `${name} does not open with the shared style`);
    assert.match(html, /<h2 class="sr-only">[^<]{20,}<\/h2>/, `${name} says nothing to a screen reader`);
    const body = html.slice(html.indexOf('</style>')).replace(/<svg[\s\S]*?<\/svg>/, '');
    assert.doesNotMatch(body, /#[0-9a-f]{6}\b/i, `${name} has a literal colour outside the tokens and the mark`);
  }
});

test('a card shows what it was given and sends one chat message, nothing else', () => {
  for (const [name, html] of renderAll()) {
    // Nothing is loaded: no font, no stylesheet, no image, no address at all.
    // (The hostile sample's own "<img src=x" is in the card as escaped text, which loads nothing.)
    assert.doesNotMatch(html, /https?:\/\/|<link\b|<img\b|<script[^>]*\bsrc=|@import|@font-face|url\(/i, `${name} reaches for something outside itself`);
    assert.doesNotMatch(html, /fetch\(|XMLHttpRequest|localStorage|document\.cookie|eval\(|<iframe|<form|javascript:/i, `${name} does more than ask`);
    const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((match) => match[1]);
    assert.equal(scripts.length, 1, `${name} must have exactly one script`);
    assert.ok(scripts[0].includes('sendPrompt('), `${name} never sends an answer`);
    assert.doesNotThrow(() => new Function('sendPrompt', 'document', scripts[0]), `${name}: its script does not parse`);
  }
});

test('nothing a card is given becomes markup or code', () => {
  for (const [name, html] of renderAll()) {
    assert.ok(!html.includes('<img'), `${name} let a tag through`);
    assert.ok(!html.includes('alert(1)</script>'), `${name} let a script through`);
    assert.equal((html.match(/<script>/g) || []).length, 1, `${name} has a script it did not write`);
    for (const [, value] of html.matchAll(/data-(?:say|line)="([^"]*)"/g)) assert.doesNotMatch(value, /[<>]/, `${name} has raw markup in an attribute`);
    const script = /<script>([\s\S]*?)<\/script>/.exec(html)[1];
    assert.ok(!script.includes('quoted') && !script.includes('Acme'), `${name} put its data inside its script`);
  }
});

test('a removed card is refused, and the refusal says what took its place', () => {
  for (const name of REMOVED) {
    assert.ok(!cards.names().includes(name), `${name} is still a card`);
    assert.throws(() => cards.render(name, SAMPLE['wrap-up-review']), (error) => {
      assert.equal(error.code, 'NO_CARD');
      assert.match(error.message, new RegExp(`^The card "${name}" was removed: show no card for it\\.$`));
      assert.match(error.hint, /skill/, `${name}: the refusal does not say which skill does it now`);
      assert.doesNotMatch(error.hint, /Cards:.*\bpicture\b/, `${name}: the refusal still lists the picture as a card`);
      for (const kept of KEPT) assert.ok(error.hint.includes(kept), `${name}: the refusal does not list ${kept}`);
      return true;
    });
    assert.ok(cards.REMOVED[name], `${name} has no line saying what took its place`);
  }
  // A name that was never a card, and one that is only a property of every object, get the plain refusal.
  for (const name of ['no-such-card', 'constructor', 'toString']) assert.throws(() => cards.render(name, {}), /No card named/);
});

test('a card refuses what it cannot show', () => {
  const none = () => { throw new Error('no brain should be needed'); };
  assert.throws(() => cards.render('wrap-up-review', {}, none), /needs items/);
  assert.throws(() => cards.render('debrief-review', {}, none), /needs items/);
  assert.throws(() => cards.render('digest-review', { summary: 'x' }, none), /needs items/);
  assert.throws(() => cards.render('no-such-card', {}, none), /No card named/);
  assert.throws(() => cards.render('quiz', {}, none), /needs questions/);
  assert.throws(() => cards.render('quiz', { questions: [{ question: 'When?' }] }, none), /needs a question and its answer/);
  assert.throws(() => cards.render('quiz', { questions: [{ question: 'When?', options: ['a', 'b'], answer: 'c' }] }, none), /exactly one of its options/);
  assert.throws(() => cards.render('quiz', { questions: [{ question: 'When?', options: ['a', 'A'], answer: 'a' }] }, none), /exactly one of its options/);
});

test('a quiz is one card: a page to a question, the answer hidden until asked for, one message at the end', () => {
  const none = () => { throw new Error('no brain should be needed'); };
  const html = cards.render('quiz', { topic: 'Acme', questions: [
    { question: 'When is cutover?', options: ['12 March', '30 April'], answer: '30 april', why: 'After the audit.', source: 'projects/acme/card' },
    { question: 'Why did we drop the second vendor?', answer: 'No export.' },
  ] }, none).html;
  assert.equal((html.match(/<section class="pg[^"]*" data-q=/g) || []).length, 2);
  assert.equal((html.match(/<section class="pg on"/g) || []).length, 1, 'exactly one question shows at first');
  assert.match(html, /<span id="where">Question 1 of 2<\/span>/);
  assert.equal((html.match(/<i class="seg"><\/i>/g) || []).length, 2, 'the progress line has one part to a question');
  assert.match(html, /<button class="opt" aria-pressed="false"><i class="dot" aria-hidden="true"><\/i><b>12 March<\/b>/);
  assert.match(html, /<button class="opt" aria-pressed="false" data-right><i class="dot" aria-hidden="true"><\/i><b>30 April<\/b>/, 'the right option is not marked');
  assert.equal((html.match(/ data-right>/g) || []).length, 1);
  assert.equal((html.match(/class="set sure"/g) || []).length, 2, 'every question asks how sure they are');
  assert.equal((html.match(/class="set self"/g) || []).length, 1, 'only a question with no options is self-marked');
  assert.match(html, /<p class="lbl">Your brain says<\/p>\n<p class="ans">30 april<\/p>\n<p class="because">After the audit\.<\/p>\n<p class="src">From projects\/acme\/card<\/p>/);
  assert.match(html, /<div id="recap"><\/div>/, 'the end has no place for the recap of every question');
  assert.match(html, /id="go" style="display:none">Continue</, 'Continue shows before an answer');
  assert.match(html, /<section class="pg end" id="end" data-topic="Acme">/);
  // Every question shows while the card streams; the script makes it one at a time once it runs.
  assert.match(cards.STYLE, /\.cg\[data-js\] \.pg\{display:none\}/);
  assert.doesNotMatch(cards.STYLE, /^\.cg \.pg\{display:none/m, 'a page is hidden while the card streams');
  assert.match(cards.STYLE, /\.cg \.rev\{display:none/, 'an answer shows before it is asked for');
  assert.match(cards.STYLE, /\.pg\[data-shown\] \.rev\{display:block\}/);
  const script = /<script>([\s\S]*?)<\/script>/.exec(html)[1];
  assert.equal((script.match(/sendPrompt\(say\)/g) || []).length, 1, 'the quiz must send its results once, at the end');
  assert.match(script, /Second try/);
  // The end lists every question with how it went, built from the page's own text, never from the data.
  assert.match(script, /name\.textContent=text\(p\.querySelector\('\.q'\)\)/);
  assert.doesNotMatch(script, /innerHTML/);
  assert.match(script, /setAttribute\('data-js',''\)/);
});

// A picture is not a card: the session draws it with the chat's own visual tool, in that tool's own
// design, and the picture skill says only what the drawing has to show. The kind of visual is chosen
// for the subject, from what the tool can make, and Cogby adds nothing to how it looks: a purple
// accent and then a purple edge were both tried on 25 Nov 2026 and dropped by the owner as useless.
test('a picture is drawn by the session, not filled in by a card', () => {
  const text = fs.readFileSync(path.join(ROOT, '.claude', 'skills', 'picture', 'SKILL.md'), 'utf8').replace(/\r\n/g, '\n');
  assert.doesNotMatch(text, /`card` tool|cogby card/, 'the picture skill still asks for a card');
  assert.match(text, /look first at what that tool can make: read its own\s+guidance once/, 'the skill does not send the session to the visual tool\'s own range');
  assert.match(text, /The table is where to start, not a rule/, 'the skill fixes one kind of drawing to an idea');
  assert.match(text, /Cogby adds nothing to how a picture looks: no mark, no frame and no colour\s+of its own/);
  assert.doesNotMatch(text, /purple/i, 'the skill still gives a picture a purple of Cogby\'s');
  // What marks a picture as Cogby's is one signed line under it, the way a session wrap ends.
  assert.ok(text.includes('`Cogby · from <page>`'), 'the skill does not sign a picture');
  assert.ok(text.includes('`Cogby · from general knowledge, your brain has nothing on this yet`'), 'the skill does not sign a picture the brain had nothing for');
  assert.doesNotMatch(text, /#[0-9a-fA-F]{6}\b/, 'the skill gives a colour code of its own');
  assert.match(text, /## Step 5: The full explanation, as a page/, 'the skill has no way to a full explanation');
  for (const say of ['again, simpler.', 'again, one level deeper.', 'with an example from my own work.', 'Give me the full explanation of "<title>".', 'Quiz me on "<title>".']) {
    assert.ok(text.includes(say), `the skill does not give the message "${say}"`);
  }
});

// The mark stands on the card itself. It once sat on a dark tile, which read as a black square.
test('the mark has no tile behind it', () => {
  const html = cards.render('quiz', SAMPLE.quiz).html;
  const mark = /<svg[\s\S]*?<\/svg>/.exec(html)[0];
  assert.doesNotMatch(mark, /<rect width="32" height="32"/, 'the mark still has its tile');
  assert.match(mark, /aria-label="Cogby"/);
});

// What a card costs is what the session has to send before the person sees it. Each carries only the
// style rules it uses. Three of the four are under 8 KiB whole. The quiz is not and never was: it is a
// whole quiz in one card, and its script alone is about 5.6 KB. It is held to where it stands.
test('a card is small: it carries only the style rules it uses', () => {
  const none = () => { throw new Error('no brain should be needed'); };
  const sized = renderAll();
  for (const [name, html] of sized) {
    if (name !== 'quiz') assert.ok(html.length < 8192, `the ${name} card is ${html.length} bytes; the budget is 8 KiB`);
    const style = html.slice(0, html.indexOf('</style>'));
    const markup = html.slice(html.indexOf('</style>'));
    const used = new Set();
    for (const [, value] of markup.matchAll(/class="([^"]*)"/g)) value.split(/\s+/).forEach((one) => used.add(one));
    for (const [, args] of markup.matchAll(/classList\.(?:add|toggle|remove)\(([^)]*)\)/g)) for (const [, one] of args.matchAll(/'([\w-]+)'/g)) used.add(one);
    for (const rule of style.split('\n').slice(2)) {
      for (const selector of rule.slice(0, rule.indexOf('{')).split(',')) {
        for (const [, one] of selector.matchAll(/\.([\w-]+)/g)) assert.ok(one === 'cg' || used.has(one), `${name} ships "${selector}", but never uses .${one}`);
      }
    }
    for (const [, token] of style.matchAll(/(--cg-[\w-]+):/g)) assert.ok(style.includes(`var(${token}`), `${name} declares ${token} and never uses it`);
    // The quiz carries more: an answer has four states (free, picked, right, wrong), each said in words too.
    assert.ok(style.length < (name === 'quiz' ? 6000 : 5000), `${name} ships ${style.length} bytes of style`);
  }
  const quiz = cards.render('quiz', { topic: 'Acme', questions: [{ question: 'When is cutover?', answer: '2 December' }] }, none).html;
  assert.ok(quiz.length < 13000, `a quiz of one question is ${quiz.length} bytes; it was 12,407 with the progress line and the recap`);
  // No rule is left in the sheet for a card that is gone.
  const shipped = sized.map(([, html]) => html.slice(0, html.indexOf('</style>'))).join('\n');
  for (const rule of cards.STYLE.split('\n').slice(2, -1)) {
    const selectors = rule.slice(0, rule.indexOf('{')).split(',');
    assert.ok(selectors.some((selector) => shipped.includes(`${selector},`) || shipped.includes(`${selector}{`)), `no card uses the rule "${rule.slice(0, 60)}"`);
  }
});

// A selected answer must read at a glance in both themes: WCAG asks 3:1 for a state, and a cue that
// is not colour alone. Its text never changes colour and never sits on the purple: a host styles its
// own buttons, and on 25 Nov 2026 a pressed answer could not be read in the chat. So the state is an
// outline in the purple, measured against the card with the host's light and dark values and with
// Cogby's own for a host that has none, plus a mark that fills with a check.
test('a selected answer stands out in light and dark, and not by colour alone', () => {
  const hex = (value) => { const v = value.replace('#', ''); const full = v.length === 3 ? v.split('').map((c) => c + c).join('') : v; return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16)); };
  const lum = (rgb) => { const [r, g, b] = rgb.map((c) => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
  const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
  const base = /^\.cg\{(.*)\}$/m.exec(cards.STYLE)[1];
  const fallback = (token) => new RegExp(`${token}:var\\(--[\\w-]+,(#[0-9a-fA-F]{3,6})\\)`).exec(base)[1];
  // --cg-primary is one hue mixed with the text colour: 72 parts of the hue, 28 of the text.
  const mix = /--cg-primary:color-mix\(in srgb,(#[0-9a-fA-F]{6}) 72%,var\(--cg-ink\)\)/.exec(base);
  assert.ok(mix, 'the selected colour is no longer mixed from the text colour');
  assert.doesNotMatch(cards.STYLE, /--cg-onp|color:var\(--cg-primary\)[^;}]*;[^}]*background:var\(--cg-primary\)/, 'text is set on the purple again');
  for (const rule of cards.STYLE.split('\n').filter((line) => /aria-pressed="true"\]\{|aria-pressed="true"\] b\{|\.go\{/.test(line))) {
    assert.doesNotMatch(rule, /(?:^|[;{])color:(?!var\(--cg-ink\))/, `a pressed control changes its text colour: ${rule.slice(0, 70)}`);
  }
  const themes = {
    'Cogby, no host': { ink: hex(fallback('--cg-ink')), card: hex(fallback('--cg-card')) },
    'host light': { ink: hex('#0b0b0b'), card: hex('#ffffff') },
    'host dark': { ink: hex('#ffffff'), card: hex('#2b2b2b') },
  };
  for (const [theme, { ink, card }] of Object.entries(themes)) {
    const line = hex(mix[1]).map((c, i) => Math.round(c * 0.72 + ink[i] * 0.28));
    assert.ok(ratio(line, card) >= 3, `${theme}: the outline of a selected answer is ${ratio(line, card).toFixed(2)}:1 against the card`);
    assert.ok(ratio(ink, card) >= 7, `${theme}: the text of an answer is ${ratio(ink, card).toFixed(2)}:1`);
  }
  for (const selector of ['.cg .chip[aria-pressed="true"],', '.cg .opt[aria-pressed="true"],']) assert.ok(cards.STYLE.includes(selector), `${selector} has no selected style`);
  assert.match(cards.STYLE, /\.cg \.chip\[aria-pressed="true"\]::before,\.cg \.mini\[aria-pressed="true"\]::before\{content:"\\2713"/, 'a selected chip has no check');
  assert.match(cards.STYLE, /\.cg \.opt\[aria-pressed="true"\] \.dot::before,.*\{content:"\\2713"/, 'a selected answer has no check');
  assert.match(cards.STYLE, /\.cg \.opt\.wrong::after\{content:"Your answer"\}/, 'a wrong answer is not named as the one they gave');
});

test('an existing brain becomes the default with the one command onboarding runs on a yes', (t) => {
  const box = newBrain(t);
  const other = sandbox(t);
  assert.match(cogby(other, ['search', 'x']).err, /No brain found/);
  const adopted = cogby(other, ['init', '--brain', box.brain, '--default', '--no-plugin', '--no-sources']);
  assert.equal(adopted.code, 0, adopted.err);
  assert.equal(cogby(other, ['sources']).code, 0, 'the adopted brain is not reached from another folder');
});

test('cards come from the tool and the command, also before any brain exists', (t) => {
  const box = sandbox(t);
  fs.mkdirSync(box.brain);
  const listed = cogby(box, ['card'], { cwd: box.brain });
  for (const name of KEPT) assert.ok(listed.out.includes(`${name}\n`), `cogby card does not list ${name}`);
  for (const name of REMOVED) assert.ok(!listed.out.includes(`${name}\n`), `cogby card still lists ${name}`);
  const data = path.join(box.dir, 'quiz.json');
  fs.writeFileSync(data, JSON.stringify(SAMPLE.quiz));
  const drawn = cogby(box, ['card', 'quiz', '--data', data], { cwd: box.brain });
  assert.equal(drawn.code, 0, drawn.err);
  assert.match(drawn.out, /class="bar"/);
  for (const name of REMOVED) {
    const refused = cogby(box, ['card', name], { cwd: box.brain });
    assert.equal(refused.code, 1);
    assert.match(refused.err, new RegExp(`The card "${name}" was removed`));
  }

  const call = (id, args) => JSON.stringify({ jsonrpc: '2.0', id, method: 'tools/call', params: { name: 'card', arguments: args } });
  const input = [call(1, { name: 'quiz', data: SAMPLE.quiz }), call(2, { name: 'setup' }), call(3, { name: 'check-in', data: { title: 'Monday' } })].join('\n') + '\n';
  const served = spawnSync(process.execPath, [CLI, 'serve', '--mcp'], { env: { ...box.env, CLAUDE_PROJECT_DIR: box.brain }, cwd: box.brain, encoding: 'utf8', input });
  const [shown, setup, checkIn] = served.stdout.trim().split('\n').map((line) => JSON.parse(line).result);
  assert.equal(shown.isError, false);
  assert.match(JSON.parse(shown.content[0].text).html, /class="bar"/);
  assert.match(JSON.parse(shown.content[0].text).show, /exactly as returned/);
  for (const reply of [setup, checkIn]) {
    assert.equal(reply.isError, true);
    const { error } = JSON.parse(reply.content[0].text);
    assert.equal(error.code, 'NO_CARD');
    assert.match(error.message, /was removed: show no card for it/);
    assert.match(error.hint, /Cards: debrief-review, digest-review, wrap-up-review, quiz\./);
  }
});

// A skill that shows a card gives the card's `data` in full, as an example that parses: a session
// never has to open the source of the cards to learn what one takes. (One measured run lost about
// twenty seconds doing exactly that.)
const SHOWN_BY = { 'wrap-up-review': 'wrap-up', 'debrief-review': 'meeting-notes', 'digest-review': 'digest', quiz: 'quiz-me' };

test('every card is shown by one skill, which gives its exact data', () => {
  const skills = path.join(ROOT, '.claude', 'skills');
  const read = (name) => fs.readFileSync(path.join(skills, name, 'SKILL.md'), 'utf8').replace(/\r\n/g, '\n');
  const all = fs.readdirSync(skills).map(read).join('\n');
  const source = fs.readFileSync(path.join(ROOT, 'core', 'brain', 'cards.cjs'), 'utf8');
  assert.deepEqual(Object.keys(SHOWN_BY).sort(), KEPT);
  for (const [, name] of all.matchAll(/(?:the name|card) `([a-z-]+)`/g)) assert.ok(cards.names().includes(name), `a skill names the card ${name}, which does not exist`);
  assert.doesNotMatch(all, /wrap-up-summary|setup-review|meeting-brief/, 'a skill still names a card that was removed');
  const keys = (value) => (Array.isArray(value) ? value.flatMap(keys) : value && typeof value === 'object' ? Object.entries(value).flatMap(([key, inner]) => [key, ...keys(inner)]) : []);
  for (const [card, skill] of Object.entries(SHOWN_BY)) {
    const text = read(skill);
    const named = text.search(new RegExp(`the name\\s+\`${card}\``));
    assert.ok(named > 0, `${skill} does not show the ${card} card`);
    const found = /^[^]{0,200}?Its\s+`data`, exactly:\s*(?:```json\n([\s\S]*?)\n```|`(\{.*\})`)/.exec(text.slice(named));
    assert.ok(found, `${skill} does not give the exact data of the ${card} card`);
    const data = JSON.parse(found[1] || found[2]);
    assert.doesNotThrow(() => cards.render(card, data), `${skill}: the card refuses the skill's own example`);
    // Every field of the example is one the card reads, and one its own line of help names.
    for (const key of Object.keys(data)) assert.ok(source.includes(`data.${key}`), `${skill} passes "${key}", which the ${card} card never reads`);
    for (const key of new Set(keys(data))) {
      assert.match(cards.CARDS[card].about, new RegExp(`\\b${key}\\b`), `${skill} passes "${key}", which \`cogby card\` does not list for ${card}`);
      assert.match(source, new RegExp(`\\.${key}\\b`), `${skill} passes "${key}", which no card reads`);
    }
  }
});
