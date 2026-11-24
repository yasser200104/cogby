'use strict';

// Getting started: which `cogby` a session runs, and what it is told when that is not Cogby's.
// Found 2026-11-15: an old global npm package (@cogby/cli 0.1.4) came first on PATH, so every
// `cogby` in setup went to it ("Unknown command: wrapup", "Unknown command: help") and nothing said so.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { ROOT, sandbox, cogby, hook, newBrain, onboardingSkill } = require('./helpers.cjs');
const onPath = require(path.join(ROOT, 'core', 'lib', 'cogby-on-path.cjs'));

const BIN = path.join(ROOT, 'bin');
const WIN = process.platform === 'win32';
const SEP = WIN ? ';' : ':';

// A folder holding npm's global shims for @cogby/cli, the way npm writes them on each system.
function oldGlobal(box) {
  const dir = path.join(box.dir, 'npm');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'cogby.cmd'), '@ECHO off\r\nGOTO start\r\n:start\r\nSETLOCAL\r\n"%_prog%"  "%dp0%\\node_modules\\@cogby\\cli\\bin\\cogby.js" %*\r\n');
  fs.writeFileSync(path.join(dir, 'cogby'), '#!/bin/sh\nbasedir=$(dirname "$0")\nexec node  "$basedir/node_modules/@cogby/cli/bin/cogby.js" "$@"\n', { mode: 0o755 });
  return dir;
}

test('cogby --version and cogby help answer, also through the file a shell runs', (t) => {
  const box = sandbox(t);
  const version = require(path.join(ROOT, 'package.json')).version;
  const direct = cogby(box, ['--version']);
  assert.equal(direct.code, 0, direct.err);
  assert.equal(direct.out.trim(), `cogby ${version}`);
  assert.match(cogby(box, ['help']).out, /^Brain commands:/);
  const { spawnSync } = require('child_process');
  const shim = spawnSync(process.execPath, [path.join(BIN, 'cogby'), '--version'], { env: box.env, encoding: 'utf8' });
  assert.equal(shim.stdout.trim(), `cogby ${version}`);
  assert.match(cogby(box, ['help']).out, /inside its sessions only/, 'help does not say where the bare command exists');
});

test('an older cogby before the plugin on PATH is named, with the package that removes it', (t) => {
  const box = sandbox(t);
  const npm = oldGlobal(box);
  for (const platform of ['win32', 'linux']) {
    const found = onPath.foreignCogby({ bin: BIN, env: { PATH: [npm, BIN].join(platform === 'win32' ? ';' : ':') }, platform });
    assert.ok(found, `${platform}: the old cogby is not found`);
    assert.equal(found.package, '@cogby/cli');
    assert.equal(found.command, 'npm uninstall -g @cogby/cli', 'the command that removes it is not the package\'s');
    assert.equal(path.basename(found.file), platform === 'win32' ? 'cogby.cmd' : 'cogby');
    const line = onPath.shadowLine(found, BIN);
    assert.match(line, /not this plugin's/);
    assert.ok(line.includes('`npm uninstall -g @cogby/cli`'));
    assert.ok(line.includes(`node "${path.join(BIN, 'cogby')}" <command>`), 'the line does not give the plugin\'s own command by full path');
  }
  assert.equal(onPath.foreignCogby({ bin: BIN, env: { PATH: [BIN, npm].join(SEP) } }), null, 'one after the plugin is shadowed by it, and harmless');
  assert.equal(onPath.foreignCogby({ bin: BIN, env: { PATH: path.join(box.dir, 'nothing-here') } }), null);
  // Not an npm shim: still named, with no command made up for it.
  const other = path.join(box.dir, 'other');
  fs.mkdirSync(other);
  fs.writeFileSync(path.join(other, WIN ? 'cogby.cmd' : 'cogby'), '@echo off\r\necho hi\r\n', { mode: 0o755 });
  const plain = onPath.foreignCogby({ bin: BIN, env: { PATH: [other, BIN].join(SEP) } });
  assert.equal(plain.package, null);
  assert.equal(plain.command, null);
  assert.match(onPath.shadowLine(plain, BIN), /removing it, or putting it after the plugin on PATH/);
});

test('a session start says when cogby is not the plugin\'s, with no brain and with one', (t) => {
  const box = sandbox(t);
  fs.mkdirSync(box.brain);
  const npm = oldGlobal(box);
  const shadowed = [npm, BIN, process.env.PATH || process.env.Path || ''].join(SEP);
  const fresh = hook(box, 'brain-context', { source: 'startup' }, { env: { PATH: shadowed, Path: shadowed } });
  assert.match(fresh.out, /no brain yet/);
  assert.match(fresh.out, /`cogby` in this shell is not this plugin's: .*\(npm package @cogby\/cli\)/);
  assert.ok(fresh.out.includes('`npm uninstall -g @cogby/cli`'));
  assert.ok(fresh.out.includes(`node "${path.join(BIN, 'cogby')}" <command>`));
  assert.doesNotMatch(fresh.out, /also `cogby <command>` in this shell/, 'it still says the bare command works');

  const clean = [BIN, process.env.PATH || process.env.Path || ''].join(SEP);
  const fine = hook(box, 'brain-context', { source: 'startup' }, { env: { PATH: clean, Path: clean } });
  assert.doesNotMatch(fine.out, /not this plugin's/);
  assert.ok(fine.out.includes(`node "${path.join(BIN, 'cogby')}" <command>`), 'the full-path form is not given');
});

// ---- the onboarding skill ----------------------------------------------------------------------

// Three steps since 2026-11-20: Hello, Get to know you (questions in the chat while the work is looked
// through in the background), Check it (then the brain is created), and You're set. The owner: "hi, here's
// how we work, let me know who you are; a map is built in the background; we create your brain; then
// how to start using it."
const SKILL_DIR = path.join(ROOT, '.claude', 'skills', 'onboarding');
const SCREENS = fs.readFileSync(path.join(SKILL_DIR, 'screens.html'), 'utf8').replace(/\r\n/g, '\n');
const TEXT_SCREENS = fs.readFileSync(path.join(SKILL_DIR, 'screens-text.md'), 'utf8').replace(/\r\n/g, '\n');
const IDS = ['welcome', 'get-to-know', 'check-it', 'youre-set'];
const GONE = ['quick-choices', 'what-you-have', 'about-you', 'folders'];
const STEPS = ['Hello', 'Get to know you', 'Check it'];
const PRIVACY = 'Saved on your computer, in a folder you own. Nothing is shared with anyone unless you ask.';
const DEFAULTS = 'I\'ll always ask before I send a message, delete anything or spend money, and I\'ll answer first, in plain words. Your brain lives in a folder called Cogby Brain in your home folder, saved whenever you say "wrap up". Want any of that different? Just say so.';
const style = /<style id="cogby-style">\n([\s\S]*?)\n<\/style>/.exec(SCREENS)[1];
const script = /<script id="cogby-script">\n([\s\S]*?)\n<\/script>/.exec(SCREENS)[1];
const section = (id) => new RegExp(`^<section class="cg" id="${id}">\\n([\\s\\S]*?)\\n</section>`, 'm').exec(SCREENS)?.[1];
const plainOf = (id) => TEXT_SCREENS.split(`## ${id}\n`)[1]?.split('\n## ')[0];
// What a person reads on a screen: its text, without the markup.
const words = (html) => html.replace(/<svg[\s\S]*?<\/svg>/g, ' ').replace(/<[^>]+>/g, ' ').replace(/&[a-z]+;/g, ' ').replace(/\s+/g, ' ').trim();
const tokens = (block) => Object.fromEntries([...block.matchAll(/--([a-z0-9-]+):([^;}]+)/g)].map(([, name, value]) => [name, value.trim()]));
function luminance(hex) {
  const [r, g, b] = hex.replace('#', '').match(/../g).map((part) => parseInt(part, 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
const contrast = (a, b) => { const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

test('onboarding runs every command itself, by full path: the person never types one', () => {
  const { flat } = onboardingSkill();
  assert.ok(flat.includes('`node "<plugin>/bin/cogby" <command>`'));
  assert.match(flat, /never by whichever `cogby` comes first on PATH/);
  assert.ok(flat.includes('**`<plugin>`** is `${CLAUDE_PLUGIN_ROOT}`'));
  assert.match(flat, /three levels above this skill's own folder \(`<plugin>\/\.claude\/skills\/onboarding`\)/);
  assert.ok(flat.includes('run `node "<plugin>/core/ops/<x>.cjs"` from the brain\'s folder'));
  assert.match(flat, /They never type a command\.\*\* You run each one after a plain yes,/);
  // Making a brain the default is still the person's choice: a yes in their words, then the command run for them.
  assert.match(flat, /only on their yes run `node "<plugin>\/bin\/cogby" init --brain "<its folder>" --default`/);
  assert.doesNotMatch(flat, /in a terminal|`cogby` exists inside Claude sessions|give them the one command|pass its fix to the person/i);
  assert.match(flat, /offer to remove it; run its fix only on their yes/);
});

test('onboarding is three named steps and You\'re set, on fixed screens, with a plain-text twin', () => {
  const { text, flat, batches } = onboardingSkill();
  STEPS.forEach((step, i) => assert.ok(text.includes(`## Step ${i + 1} of 3: ${step}\n`), `no section "Step ${i + 1} of 3: ${step}"`));
  assert.ok(text.includes('## You\'re set\n'));
  assert.doesNotMatch(text, /^## .*\b[Ss]etup\b|of 5|Quick choices|About you/m, 'a heading or a step from the longer onboarding is back');
  assert.match(flat, /Call it onboarding, never setup\./);
  assert.match(flat, /copy its `<style id="cogby-style">` block, its `<section>` and the `<script id="cogby-script">` block exactly/);
  assert.match(flat, /Never restyle, recolour, reword or redesign a screen\./);
  assert.match(flat, /Claude's inline visual tool \(`show_widget`, with its `read_me`\)/);
  assert.match(flat, /say the same screen from `screens-text\.md`, word for word/);
  for (const id of IDS) {
    assert.ok(section(id), `screens.html has no screen "${id}"`);
    assert.ok(text.includes(`\`${id}\``), `the skill never shows the screen "${id}"`);
    assert.ok(plainOf(id), `screens-text.md has no plain version of "${id}"`);
  }
  for (const id of GONE) {
    assert.ok(!section(id), `the screen "${id}" is back`);
    assert.ok(!plainOf(id), `the plain screen "${id}" is back`);
  }
  // Nothing is asked up front any more: no question batches.
  assert.deepEqual(batches, [], 'the skill asks quick-choice questions again');
});

test('onboarding names no Cogby tool: commands, Claude\'s own question, visual and background tools, plain words', () => {
  const { text, flat, prose } = onboardingSkill();
  const tools = JSON.parse(fs.readFileSync(path.join(ROOT, 'tests', 'tools.json'), 'utf8'));
  for (const tool of tools) {
    assert.doesNotMatch(prose, new RegExp(`\`${tool}\`\\s+tool|tool\\s+\`${tool}\`|${tool}\\s+tool,`), `onboarding calls the ${tool} tool`);
  }
  assert.doesNotMatch(prose, /\btool, action\b|mcp__|`cogby card|the `?card`? tool|setup-review/, 'onboarding reaches for a tool or a card of Cogby\'s');
  assert.match(flat, /onboarding never calls one of Cogby's tools/);
  const before = text.slice(text.indexOf('## Before the welcome'), text.indexOf('## Step 1 of 3'));
  assert.ok(before.includes('Run `node "<plugin>/bin/cogby" view --json`.'), 'the first step does not ask a command whether a brain exists');
  assert.match(before, /\*\*"No brain found":\*\* Step 1\./);
  for (const command of ['init --brain "<path>" --no-plugin --no-sources', 'cogby routines add "Morning check-in"', 'cogby remember <page>', 'cogby log <page>']) {
    assert.ok(flat.includes(command), `onboarding does not give the command ${command}`);
  }
  assert.match(flat, /add `--brain "<path>"` to every `cogby` command/);
});

test('with no brain and no server, the commands onboarding opens with answer', (t) => {
  const box = sandbox(t);
  const work = path.join(box.dir, 'work');
  fs.mkdirSync(work);
  const none = cogby(box, ['view', '--json'], { cwd: work });
  assert.equal(none.code, 1);
  assert.match(JSON.parse(none.out).error.message, /No brain found/);
  const made = cogby(box, ['init', '--brain', box.brain, '--no-plugin', '--no-sources'], { cwd: work });
  assert.equal(made.code, 0, made.err);
  assert.match(made.out, /This is your default brain/);
  const seen = cogby(box, ['view', '--json'], { cwd: work });
  assert.equal(JSON.parse(seen.out).brain, box.brain);
  assert.equal(JSON.parse(seen.out).auto, true);
  assert.equal(cogby(box, ['view', 'auto', 'off', '--brain', box.brain], { cwd: work }).code, 0);
  assert.equal(JSON.parse(cogby(box, ['view', '--json', '--brain', box.brain], { cwd: work }).out).auto, false);
});

test('what used to be asked up front is a safe default, said in one line before anything is created', () => {
  const { flat } = onboardingSkill();
  assert.match(flat, /\*\*Defaults, never asked:\*\* you ask before sending a message, deleting anything or spending money, from the first minute and in this chat too; you answer first, in plain words; the brain lives in a new folder called Cogby Brain in their home folder; it is saved when they say "wrap up"; My view is on; no routine runs until they pick one\./);
  assert.match(flat, /when the map found a code folder, pushing or deploying code joins what you ask before/);
  assert.match(words(section('check-it')), new RegExp(DEFAULTS.replace(/[.?*+^$()[\]{}|\\]/g, '\\$&')));
  assert.ok(plainOf('check-it').includes('> <the defaults>'));
  assert.doesNotMatch(SCREENS + TEXT_SCREENS + flat, /Where should your brain live|When a routine is due, what should I do|Which routines do you want/);
  assert.match(flat, /A brain is \*\*always its own new folder called `Cogby Brain`\*\*/);
  assert.match(flat, /Nothing is written, created or linked, and no routine is scheduled, before Step 3's "Looks right, create it"\./);
});

test('the welcome says hello in Cogby\'s own voice, and shows the three steps', () => {
  const welcome = section('welcome');
  const said = words(welcome);
  const HELLO = 'Hi, I\'m Cogby. Let\'s work together: I\'ll keep track of your projects, people and plans, so every chat picks up where we left off. I\'ll also help you keep your critical thinking sharp.';
  // The hello is said in the chat, not on the screen; the screen keeps four minimal folder cards (the owner, 2026-11-21:
  // "I just want the cards to be minimal and clean, not lots of wording").
  assert.ok(welcome.includes('<h1>Meet Cogby</h1>\n<div class="label">Your brain has four folders. Cogby does the filing.</div>'), 'the welcome is not the title, then the folders');
  assert.doesNotMatch(welcome, /class="lede"|Hi, I'm Cogby/, 'the hello is back on the screen');
  const FOLDERS = [['Projects', 'With an end'], ['Areas', 'No end date'], ['Resources', 'To look up'], ['Archive', 'Finished']];
  const cards = [...welcome.matchAll(/<div class="card"><i class="ti ti-[a-z-]+ ic" aria-hidden="true"><\/i><div class="t">([^<]+)<\/div><div class="m">([^<]+)<\/div><\/div>/g)].map(([, title, line]) => [title, line]);
  assert.deepEqual(cards, FOLDERS, 'the welcome\'s cards are not the four folders, minimal');
  const plain = plainOf('welcome');
  const SAID = `> ${HELLO} I organize what I remember about your work in folders on this computer. The main ones are Projects, work with an end, like a launch; Areas, what you look after with no end date, like your team; Resources, things to look up, like notes and documents; and Archive, what's finished. I do the filing.`;
  assert.ok(plain.includes(`Say this first, in the chat:\n\n${SAID}\n\nThen the screen:\n\n> **Meet Cogby**\n`), 'the hello is not said in the chat before the screen');
  assert.ok(plain.includes('> Projects: with an end · Areas: no end date · Resources: to look up · Archive: finished'));
  assert.ok(plain.includes('> **How this goes:** 1 Hello → 2 Get to know you → 3 Check it'));
  assert.match(onboardingSkill().flat, /Say the hello from the welcome in `screens-text\.md`, word for word, in the chat, then show `welcome`\./);
  assert.doesNotMatch(SCREENS + TEXT_SCREENS, /It remembers, you decide|You stay in charge|so your judgement stays yours|Remembers your work|Tells you what needs you/, 'a line the owner or the tester cut is back');
  assert.match(welcome, /<button class="btn" data-say="Let's start">Let's start<\/button>/);
  assert.doesNotMatch(said, /PARA|second brain|context manager|minutes?\b/i, 'jargon, a crowded term or a time estimate on the welcome');
  for (const text of [said, words(SCREENS), TEXT_SCREENS]) {
    assert.doesNotMatch(text, /forget/i, 'Cogby is not explained as a fix for forgetting');
    assert.doesNotMatch(text, /nothing leaves your computer/i, 'a privacy line that is not true: Claude reads the brain over the internet');
  }
});

test('every screen wears My view\'s light look, its mark and the three-step bar, with readable text', () => {
  // One light look in every theme, the same as My view (the owner, 2026-11-21: "make the colour light like in this
  // artifact"): white page and cards, a light grey band, Cogby's violet, small corners.
  const center = fs.readFileSync(path.join(ROOT, 'core', 'templates', 'command-center.html'), 'utf8');
  const theirs = tokens(/:root\{([^}]*)\}/.exec(center)[1]);
  const light = tokens(/^\.cg\{([^}]*)\}/m.exec(style)[1]);
  const from = { card: 'surface-card', soft: 'canvas-soft', tint: 'seg-on', ink: 'ink', body: 'body', muted: 'muted', primary: 'primary', accent: 'accent', 'on-primary': 'on-primary', line: 'hairline', line2: 'hairline-strong' };
  for (const [ours, name] of Object.entries(from)) assert.equal(light[ours].toLowerCase(), theirs[name].toLowerCase(), `--${ours} is not My view's --${name}`);
  assert.doesNotMatch(style, /prefers-color-scheme|data-mode=dark/, 'a dark look is back');
  assert.match(/^\.cg\{([^}]*)\}/m.exec(style)[1], /color-scheme:light;color:var\(--body\);background:var\(--card\)/, 'a screen does not paint its own light background, so it would not read on a dark chat');
  for (const [, selector, radius] of style.matchAll(/^([^{\n]+)\{[^}\n]*?border-radius:(\d+)px/gm)) assert.ok(+radius <= 8, `${selector} has ${radius}px corners: My view's are 4 to 8`);
  assert.ok(contrast(light.ink, light.card) >= 7, 'the ink is not deep enough');
  assert.ok(contrast(light.body, light.card) >= 7, 'running text is not deep enough');
  assert.ok(contrast(light.muted, light.card) >= 4.5, 'the quiet colour fails for small text');
  assert.ok(contrast(light['on-primary'], light.primary) >= 4.5, 'the button text fails');
  assert.doesNotMatch(style, /color:#|color:rgb|color:gr[ae]y|opacity:(?!1\b)/i, 'a colour or a fade outside the tokens');
  const SMALL = new Set(['.cg .where', '.cg .steps li', '.cg .num', '.cg .box', '.cg .said']);
  for (const [, selector, size] of style.matchAll(/^([^{\n]+)\{[^}\n]*?font-size:([\d.]+)px/gm)) {
    if (!SMALL.has(selector)) assert.ok(+size >= 14 && +size <= 22, `${selector} is ${size}px: text to read is 14 to 16px, a title 22px`);
  }
  for (const [, weight] of style.matchAll(/font-weight:(\d+)/g)) assert.ok(['400', '500'].includes(weight), `font-weight ${weight}: the chat's visuals use 400 and 500`);
  assert.match(style, /\.cg \.steps\{display:grid;grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/, 'the bar is not three wide');
  for (const part of [style, script, ...IDS.map(section)]) assert.doesNotMatch(part, /<!--|\/\*/, 'a comment inside a part that is copied');
  assert.match(script, /typeof sendPrompt === 'function'/);
  const mark = (html) => /<svg class="mark[^"]*"[^>]*>([\s\S]*?)<\/svg>/.exec(html)[1].replace(/\s+/g, '');
  const centerMark = mark(center);
  for (const id of IDS) assert.equal(mark(section(id)), centerMark, `${id}: the mark is not the command center's`);
  const CURRENT = { welcome: 1, 'get-to-know': 2, 'check-it': 3 };
  for (const id of IDS) {
    const bar = /<ol class="steps"[^>]*>([\s\S]*?)<\/ol>/.exec(section(id))[1];
    const items = [...bar.matchAll(/<li( class="(done|now)")?>([\s\S]*?)<\/li>/g)].map(([, , state, inner]) => ({ state: state || 'next', inner, name: words(inner).replace(/^\d\s*/, '') }));
    assert.deepEqual(items.map((item) => item.name), STEPS, `${id}: the bar does not show the three steps`);
    const states = items.map((item) => item.state).join(' ');
    if (id === 'youre-set') assert.equal(states, 'done done done');
    else assert.equal(states, items.map((_, i) => (i + 1 < CURRENT[id] ? 'done' : i + 1 === CURRENT[id] ? 'now' : 'next')).join(' '), `${id}: the steps are not done, current, then to come`);
    for (const item of items) assert.equal(item.state === 'done', item.inner.includes('ti-check'), `${id}: "${item.name}" is ticked only if done`);
    assert.ok((section(id).match(/class="btn"/g) || []).length <= 1, `${id}: more than one main button`);
  }
});

test('the screens speak plainly, keep the true privacy line, and leave nothing for the person to type', () => {
  const BANNED = /\b(context|brain folder|sources?|MCP|PARA|session|role|command|terminal|setup)\b/i;
  for (const id of IDS) assert.doesNotMatch(words(section(id)), BANNED, `${id} uses a word the person should not meet`);
  for (const line of TEXT_SCREENS.split('\n').filter((l) => l.startsWith('>'))) assert.doesNotMatch(line, BANNED, `screens-text.md: ${line}`);
  for (const id of ['get-to-know', 'check-it']) {
    assert.ok(words(section(id)).includes(PRIVACY), `${id} has no privacy line`);
    assert.ok(plainOf(id).includes(PRIVACY), `the plain ${id} has no privacy line`);
  }
  // Step 2: asks to get to know their work, says what it reads, offers light or deep, and says questions come while it looks.
  const step2 = section('get-to-know');
  const two = words(step2);
  assert.match(step2, /<h1>Can I get to know your work\?<\/h1>/);
  assert.match(two, /I'll look through your emails, calendar and files to find your projects, your priorities and the people you work with\./);
  assert.match(two, /It takes a minute or two\. While I look, I'll ask you a few quick questions\./);
  assert.match(step2, /<button class="quiet" data-say="I'll tell you myself">I'll tell you myself<\/button><button class="btn" data-send="Yes, take a look">Yes, take a look<\/button>/);
  assert.doesNotMatch(SCREENS + TEXT_SCREENS, /Map my work|map my work|Choose what I look at|data-reveal="/, '"Map my work" or the hidden list is back');
  // No to-dos card: most people keep none in a connected tool (the owner, 2026-11-21).
  assert.doesNotMatch(step2 + plainOf('get-to-know'), /Your to-dos|ti-checklist/, 'the to-dos card is back');
  const CARDS = { Calendar: 'calendar', Email: 'mail', Files: 'file', 'Your computer': 'device-laptop' };
  for (const [card, icon] of Object.entries(CARDS)) assert.match(step2, new RegExp(`<i class="ti ti-${icon}" aria-hidden="true"></i><span><span class="t">${card}</span>`), `no "${card}" card with its icon`);
  for (const [card, rule] of [['Calendar', 'a calendar is connected'], ['Email', 'an email account is connected'], ['Files', 'a file store is connected']]) {
    assert.match(step2, new RegExp(`data-if="${rule}">[^\\n]*<span class="t">${card}</span>`), `the ${card} card is not shown only when connected`);
  }
  const depth = /data-q data-one data-name="How closely">([\s\S]*?)<\/div>/.exec(step2)?.[1];
  assert.match(depth, /aria-pressed="true">[\s\S]*?<span class="t">Light<\/span>/, 'Light is not the default');
  assert.match(words(depth), /Deep Also reads your email messages and what's inside your files\. A fuller map, but it uses much more of your Claude allowance\./);
  // Step 3: profile and map on one screen; rows have a picker and a bin; nothing asked up front stays here.
  const step3 = section('check-it');
  assert.match(words(step3), /Here's how I see you Fix anything that's wrong: pick what each one is, rename with the pencil, remove with the bin\. You can change all of this later\./);
  assert.match(step3, /data-name="My name"[^>]*data-fill="their name"/);
  assert.match(step3, /data-name="What I do"[^>]*data-fill="what they do"/);
  assert.doesNotMatch(step3, /ti-check ok|arrows-exchange|data-act="move"|data-name="Top priorities"|data-name="Understand myself"|data-name="Ask first"/, 'the old step 3 or 4 is back');
  const rows = [...step3.matchAll(/<div class="row"[^>]*data-kind="([A-Za-z]+)"[^>]*>([\s\S]*?)<\/div>(?=\n)/g)];
  assert.ok(rows.length >= 5, 'the sample map has too few rows');
  for (const [, kind, inner] of rows) {
    assert.match(inner, /data-act="remove" aria-label="Remove"><i class="ti ti-trash"/, `a ${kind} row has no bin`);
    if (kind === 'Person') { assert.doesNotMatch(inner, /select/, 'a person has a project picker'); continue; }
    assert.ok(inner.includes(`<option selected>${kind}</option>`), `a ${kind} row's picker does not start on its kind`);
  }
  assert.match(step3, /<div data-list="Done" data-kind="Done" hidden>\n<div class="label">Done <span class="m">· finished, so it goes to the Archive<\/span><\/div>/);
  assert.match(step3, /data-send="Looks right, create it">Looks right, create it</);
  for (const said of ['\'Remove: \'', '\'Change: \'', '\'Done, to the Archive: \'', '\'Rename: \'', '\'Add: \'']) assert.ok(script.includes(said), `the reply does not report ${said}`);
  assert.doesNotMatch(SCREENS + TEXT_SCREENS, /What are you trying to accomplish/i, 'the confusing first question is back');
  // You're set: My view is the main thing; what to try comes second.
  const done = section('youre-set');
  const end = words(done);
  assert.match(done, /<div class="card hero">[\s\S]*?<div class="t">My view: where you and I keep track of everything<\/div>[\s\S]*?<a class="btn" href="#" data-fill="the page's link">Open My view<\/a><\/div>/);
  assert.ok(done.indexOf('class="card hero"') < done.indexOf('Try this first'), 'what to try comes before My view');
  assert.doesNotMatch(done.slice(done.indexOf('Try this first')), /class="btn"/, 'a chip to try is as loud as My view');
  const NEW_CHAT = 'One last thing: start a new chat, from anywhere. That\'s where Cogby is fully switched on.';
  for (const part of ['Try this first', 'What needs me today?', NEW_CHAT]) assert.ok(end.includes(part), `the ending has no "${part}"`);
  assert.ok(plainOf('youre-set').includes('**My view: where you and I keep track of everything.**'));
  assert.ok(TEXT_SCREENS.includes(NEW_CHAT));
  assert.doesNotMatch(end, /[A-Z]:\\|~\/|\bnode |cogby (view|init|link|routines|wrapup)\b/, 'the ending shows a path or a command');
  assert.match(end, /Your to-dos stay in Notion: that's the list to trust/);
});

test('Cogby gets to know the person while it looks: questions in the chat, the look-through in the background', () => {
  const { flat } = onboardingSkill();
  assert.match(flat, /start the look-through in the background with Claude's own subagent tool \(`Agent`, run in the background\)/);
  assert.match(flat, /Say one line: "I'm looking through your work now\. While I do, a few quick questions\."/);
  const asked = ['1. What should I call you, and what do you do?', '2. What matters most to you right now?',
    '3. What do you want to understand yourself, rather than leave to me?', '4. Want a morning check-in on weekdays, with what needs you that day?'];
  let at = -1;
  for (const question of asked) { const next = flat.indexOf(question); assert.ok(next > at, `"${question}" is not asked, or not in order`); at = next; }
  assert.match(flat, /When the look-through reports, finish the question in hand and go to Step 3\. A question not reached waits for a later chat\./);
  assert.match(flat, /\*\*No background tool here:\*\* say it takes a minute or two \(longer on Deep\), look first, ask only question 1\./);
  assert.match(flat, /\*\*"I'll tell you myself":\*\* question 1, then, one at a time:/);
  assert.match(flat, /tick each in `\.cogby\/self\/getting-to-know\.md` with the date and the answer, or "skipped"/);
  // The morning check-in, on a yes: a routine that only reports, and "on" only with the scheduler's word.
  const routines = require(path.join(ROOT, 'core', 'brain', 'routines.cjs'));
  const add = /`cogby routines add "Morning check-in" --run "([^"]+)" --rhythm\s+"([^"]+)"/.exec(flat);
  assert.ok(add, 'no command for the morning check-in');
  assert.ok(routines.parseRhythm(add[2]), `"${add[2]}" is not a rhythm`);
  assert.equal(routines.unattended(add[1]), 'report');
  assert.match(flat, /schedule it with the `routines` skill's Step 2; their yes was the yes/);
  assert.match(flat, /It is "on" only once the scheduler confirms it/);
  assert.match(flat, /No such scheduler here: say plainly it is saved, not running on its own yet/);
});

test('the run reads as steps, and what comes right after it stays just as plain', () => {
  const { flat, text } = onboardingSkill();
  assert.match(flat, /\*\*One screen per reply\.\*\* Never two steps in one message, never the whole run as one long page\./);
  assert.match(flat, /give it a plain description of what it does for them \("Creating your brain"\), since that is what they see/);
  assert.match(flat, /until the two lists stay in sync on their own, their own tool is the list to trust/i);
  assert.match(flat, /It ends by saying a new chat can start from anywhere\./);
  const after = text.split('## Right after onboarding\n')[1]?.split('\n## ')[0];
  assert.ok(after, 'no "Right after onboarding" section');
  assert.match(after.replace(/\s+/g, ' '), /Building My view and the first thing they try \("What needs me today\?", a meeting prep\) stay as plain as the onboarding, until they start a new chat\./);
  assert.match(after.replace(/\s+/g, ' '), /No tool names, file paths, commands or step-by-step narration, whichever skill does the work\./);
});

test('onboarding reads only what the person allowed, files Done in the Archive, and leaves folders to later', () => {
  const { flat } = onboardingSkill();
  assert.match(flat, /one line per topic under `## What I care about understanding myself` in `\.cogby\/self\/information-border\.md`/);
  assert.match(flat, /Never connect anything new here\./);
  assert.match(flat, /never read a chat through/);
  assert.match(flat, /Never the whole disk\./);
  assert.match(flat, /On Light, never a message's text\./);
  assert.match(flat, /\*\*Light\*\*, the default, is the list below; \*\*Deep\*\* also reads the text of the 50 most recent sent emails and the 30 most recent files/);
  assert.match(flat, /A Done row is made as a project, its folder then moved from `projects\/` to `archive\/`, with a timeline line saying it is finished\./);
  assert.match(flat, /when a chat opens in a folder Cogby does not know, it offers to connect it then/);
  assert.doesNotMatch(flat, /show `folders`|cogby link/, 'onboarding asks about folders again');
  const border = fs.readFileSync(path.join(ROOT, 'core', 'templates', 'starter-brain', '.cogby', 'self', 'information-border.md'), 'utf8');
  assert.match(border, /^## What I care about understanding myself$/m);
});

test('the questions not reached wait in the brain, and a new chat is told the next one, until none is left', (t) => {
  const box = newBrain(t);
  const file = path.join(box.brain, '.cogby', 'self', 'getting-to-know.md');
  const starter = fs.readFileSync(path.join(ROOT, 'core', 'templates', 'starter-brain', '.cogby', 'self', 'getting-to-know.md'), 'utf8');
  assert.equal(fs.readFileSync(file, 'utf8'), starter, 'a new brain does not start with the questions');
  assert.deepEqual([...starter.matchAll(/^- \[ \] (.+)$/gm)].map((m) => m[1]), ['What matters most to you right now?', 'What do you want to understand yourself?', 'Want a morning check-in?']);
  const RULE = 'Ask at most one in a chat, only at a natural pause, never in the middle of a task; the owner may skip it.';
  const started = () => hook(box, 'brain-context', { source: 'startup' }).out;
  let out = started();
  assert.ok(out.includes(`## Getting to know the owner\n3 questions left in ${file}; the next: "What matters most to you right now?"\n${RULE}`), out);
  fs.writeFileSync(file, starter.replace('- [ ] What matters most to you right now?', '- [x] What matters most to you right now? (2026-11-20: Q4 close)')
    .replace('- [ ] What do you want to understand yourself?', '- [x] What do you want to understand yourself? (2026-11-20: skipped)'));
  out = started();
  assert.ok(out.includes(`1 question left in ${file}; the next: "Want a morning check-in?"`), out);
  // A chat in a folder outside the brain gets it in one line.
  const work = path.join(box.dir, 'elsewhere');
  fs.mkdirSync(work);
  const brief = hook(box, 'brain-context', { source: 'startup' }, { cwd: work }).out;
  assert.ok(brief.includes(`Getting to know the owner: 1 question left in ${file}; the next: "Want a morning check-in?". ${RULE}`), brief);
  // Quiet: nothing asked of the session. All asked: nothing said.
  assert.equal(cogby(box, ['proactive', 'quiet', '--brain', box.brain]).code, 0);
  assert.doesNotMatch(started(), /Getting to know the owner/);
  assert.equal(cogby(box, ['proactive', 'suggest', '--brain', box.brain]).code, 0);
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('- [ ] Want a morning check-in?', '- [x] Want a morning check-in? (2026-11-21: yes)'));
  assert.doesNotMatch(started(), /Getting to know the owner/);
});
