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
  // The version is the plugin manifest's, the one the hello and My view show; package.json keeps the same.
  const version = JSON.parse(fs.readFileSync(path.join(ROOT, '.claude-plugin', 'plugin.json'), 'utf8')).version;
  assert.equal(require(path.join(ROOT, 'package.json')).version, version, 'package.json and .claude-plugin/plugin.json name different versions');
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

// Since 2026-11-20: a Hello, Get to know you (questions in the chat while the work is looked through in
// the background), Check it (then the brain is created), and You're set. The owner: "hi, here's how we
// work, let me know who you are; a map is built in the background; we create your brain; then how to
// start using it." Since 2026-11-22 the hello is not counted: two steps.
const SKILL_DIR = path.join(ROOT, '.claude', 'skills', 'onboarding');
const SCREENS = fs.readFileSync(path.join(SKILL_DIR, 'screens.html'), 'utf8').replace(/\r\n/g, '\n');
const TEXT_SCREENS = fs.readFileSync(path.join(SKILL_DIR, 'screens-text.md'), 'utf8').replace(/\r\n/g, '\n');
// Since 2026-11-22 every step is said in the chat and only Check it is a screen. An outside tester's onboarding of 0.3.11,
// reported by the owner: the visuals took far too long. The owner: "I will drop all screens and only keep the one that
// confirms his summary".
const SAID = ['welcome', 'connect-first', 'get-to-know', 'check-it', 'youre-set'];
const SCREEN = 'check-it';
const GONE = ['quick-choices', 'what-you-have', 'about-you', 'folders'];
// Hello is not a step (the owner, 2026-11-22, after their own run: "Hello as first step, can I not even show it").
const STEPS = ['Get to know you', 'Check it'];
const PRIVACY = 'Saved on your computer, in a folder you own. Nothing is shared with anyone unless you ask.';
const DEFAULTS = 'I\'ll always ask before I send a message, delete anything or spend money, and I\'ll answer first, in plain words. Your brain lives in a folder called Cogby Brain in your home folder, saved whenever you say "wrap up". Want any of that different? Just say so.';
const style = /<style id="cogby-style">\n([\s\S]*?)\n<\/style>/.exec(SCREENS)[1];
const script = /<script id="cogby-script">\n([\s\S]*?)\n<\/script>/.exec(SCREENS)[1];
const section = (id) => new RegExp(`^<section class="cg" id="${id}"[^>]*>\\n([\\s\\S]*?)\\n</section>`, 'm').exec(SCREENS)?.[1];
// How to fill the screen: the file's first comment, which is not copied into the chat.
const FILL = /<!--([\s\S]*?)-->/.exec(SCREENS)[1].replace(/\s+/g, ' ');
// The words the screen's script says, kept on the section so they can be said in the person's language.
const SAY = Object.fromEntries([.../<span data-say hidden ([^>]*)>/.exec(SCREENS)[1].matchAll(/data-([a-z]+)="([^"]*)"/g)].map(([, key, value]) => [key, value]));
const SELF = path.join(ROOT, 'core', 'templates', 'starter-brain', '.cogby', 'self');
// The one line that names the method, and the only place PARA is said to a person (the owner, 2026-11-22).
const CREDIT = 'Your brain is organised with PARA, a method by Tiago Forte.';
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

test('onboarding is a hello, two named steps and You\'re set, said in the chat, with one fixed screen: Check it', () => {
  const { text, flat, batches } = onboardingSkill();
  STEPS.forEach((step, i) => assert.ok(text.includes(`## Step ${i + 1} of 2: ${step}\n`), `no section "Step ${i + 1} of 2: ${step}"`));
  assert.ok(text.includes('## Hello\n'), 'the hello has no section of its own');
  assert.doesNotMatch(text, /of 3\b/, 'the hello is counted as a step again');
  assert.match(flat, /then \*\*You're set\*\*\. The hello is not a step\./);
  assert.ok(text.includes('## You\'re set\n'));
  assert.doesNotMatch(text, /^## .*\b[Ss]etup\b|of 5|Quick choices|About you/m, 'a heading or a step from the longer onboarding is back');
  assert.match(flat, /Call it onboarding, never setup\./);
  assert.match(flat, /Hello, Get to know you and You're set are said in the chat, from `screens-text\.md` next to this file: the same meaning, in the same order, in their language, each under its one progress line/);
  assert.match(flat, /\*\*Check it is the one screen\.\*\*/);
  assert.match(flat, /Read it when Check it starts, not before\./);
  assert.match(flat, /Copy its `<style id="cogby-style">` block, its `<section>` and the `<script id="cogby-script">` block exactly/);
  assert.match(flat, /Never restyle, recolour or redesign it\./);
  assert.match(flat, /Claude's inline visual tool \(`show_widget`, with its `read_me`\)/);
  assert.match(flat, /No such tool: say `check-it` from `screens-text\.md`\./);
  assert.doesNotMatch(flat, /[Ss]how `(welcome|get-to-know|connect-first|youre-set)`/, 'a step other than Check it is a screen again');
  assert.match(flat, /Show `check-it`:/);
  assert.deepEqual([...SCREENS.matchAll(/^<section class="cg" id="([a-z-]+)"[^>]*>/gm)].map((m) => m[1]), [SCREEN], 'screens.html holds a screen other than Check it');
  for (const id of SAID) {
    assert.ok(text.includes(`\`${id}\``), `the skill never says "${id}"`);
    assert.ok(plainOf(id), `screens-text.md has no "${id}"`);
  }
  for (const id of GONE) assert.ok(!plainOf(id), `the plain screen "${id}" is back`);
  // Each message of a step opens with one progress line, not a bar.
  for (const [id, line] of [['connect-first', 'Step 1 of 2 · Get to know you'], ['get-to-know', 'Step 1 of 2 · Get to know you'], ['check-it', 'Step 2 of 2 · Check it']]) {
    assert.ok(plainOf(id).includes(`\n> **${line}**\n>\n`), `"${id}" does not open with "${line}"`);
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
  const before = text.slice(text.indexOf('## Before the welcome'), text.indexOf('## Hello\n'));
  assert.ok(before.includes('Run `node "<plugin>/bin/cogby" view --json`.'), 'the first step does not ask a command whether a brain exists');
  assert.match(before, /\*\*"No brain found":\*\* Hello\./);
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
  assert.match(flat, /Nothing is written, created or linked, and no routine is scheduled, before Check it's "Looks right, create it"\./);
});

test('the welcome says hello in Cogby\'s own voice, in the chat, and names the two steps', () => {
  const plain = plainOf('welcome');
  // The hello the owner approved on 2026-11-22 (F6), after asking "Can I say I act like your second brain ?" and saying of
  // this draft "this is better". The four folders left the hello, and so did the line on critical thinking.
  const HELLO = [
    '> Hi, I\'m Cogby. Think of me as your second brain: I keep your projects, your people and your plans lined up, and nothing gets lost.',
    '> Tell me something once and I\'ll remember it, so you stop repeating yourself. When you correct me, I do it better the next time.',
    '> How I do it: with your OK, I keep notes on your work in a folder on your computer, and every new chat starts from them.',
    '> **How this goes:** 1 Get to know you → 2 Check it',
    '> Say **let\'s start** when you\'re ready.',
    // Since 2026-11-25: the last line names the copy of Cogby, read from its plugin.json by the session start
    // (the owner could not tell which of the three copies on their computer an onboarding ran).
    '> Cogby version <version>',
  ];
  const quoted = (text) => text.split('\n').filter((line) => line.startsWith('>')).join('\n');
  assert.equal(quoted(plain), HELLO.join('\n>\n'), 'the welcome is not the hello the owner approved, the two steps, "let\'s start", then the version');
  assert.ok(plain.endsWith(`\n${HELLO.join('\n>\n')}\n`), 'something is said after the hello');
  // The version comes from the session start's line, or from `cogby --version` when that line is not there.
  assert.match(plain.replace(/\s+/g, ' '), /`<version>` is the number in the session start's line "This is Cogby version …, from …" \(the one from `<plugin>` when there are several\)\. When the session start gave none, `node "<plugin>\/bin\/cogby" --version` says it\./);
  // In French, his words too, in the "vous" form: said as written when the person writes in French.
  const french = plainOf('welcome-fr');
  const BONJOUR = [
    '> Bonjour, je suis Cogby. Voyez-moi comme votre deuxième cerveau : vos projets, vos contacts et vos plans restent alignés, et rien ne se perd.',
    '> Dites-moi une chose une fois et je m\'en souviens : vous n\'avez plus à vous répéter. Quand vous me corrigez, je fais mieux la fois suivante.',
    '> Comment je fais : avec votre accord, je garde des notes sur votre travail dans un dossier sur votre ordinateur, et chaque nouvelle conversation part de ces notes.',
    '> **Les étapes :** 1 Faire connaissance → 2 Vérification',
    '> Dites **c\'est parti** quand vous voulez.',
    '> Cogby version <version>',
  ];
  assert.equal(quoted(french), BONJOUR.join('\n>\n'), 'the French hello is not the one the owner approved');
  assert.ok(french.endsWith(`\n${BONJOUR.join('\n>\n')}\n`),'the French hello does not end on the version');
  assert.match(french.replace(/\s+/g, ' '), /when the person writes in French, say this as written instead of translating\./);
  assert.match(french.replace(/\s+/g, ' '), /Its last line, the version, is filled as in `welcome`\./);
  assert.match(onboardingSkill().flat, /Say `welcome` from `screens-text\.md`, in the chat\. Wait for "let's start" or any go-ahead\./);
  assert.doesNotMatch(SCREENS + TEXT_SCREENS, /It remembers, you decide|You stay in charge|so your judgement stays yours|Remembers your work|Tells you what needs you/, 'a line the owner or the tester cut is back');
  assert.doesNotMatch(plain + french, /Projects, work with an end|Areas, what you look after|Resources, things to look up|critical thinking|esprit critique/i, 'the folders or the critical-thinking line are back on the hello');
  // "second brain" was banned here on 18 Nov 2026; on 22 Nov 2026 the owner chose it for the hello ("Can I say I act like
  // your second brain ?"). It is said there once, and nowhere else. The rest stays banned.
  assert.doesNotMatch(plain + french, /PARA|context manager|minutes?\b|—/i, 'jargon, a crowded term, a time estimate or an em dash on the welcome');
  assert.deepEqual(TEXT_SCREENS.split('\n').filter((line) => /second brain|deuxième cerveau/i.test(line)), [HELLO[0], BONJOUR[0]], '"second brain" is said somewhere other than the hello\'s first line');
  for (const text of [words(SCREENS), TEXT_SCREENS]) {
    assert.doesNotMatch(text, /forget/i, 'Cogby is not explained as a fix for forgetting');
    assert.doesNotMatch(text, /nothing leaves your computer/i, 'a privacy line that is not true: Claude reads the brain over the internet');
  }
});

test('the screen wears My view\'s light look, its mark and the two-step bar, with readable text and a bin that stands out', () => {
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
  const SMALL = new Set(['.cg .where', '.cg .steps li', '.cg .num', '.cg .said']);
  for (const [, selector, size] of style.matchAll(/^([^{\n]+)\{[^}\n]*?font-size:([\d.]+)px/gm)) {
    if (!SMALL.has(selector)) assert.ok(+size >= 14 && +size <= 22, `${selector} is ${size}px: text to read is 14 to 16px, a title 22px`);
  }
  for (const [, weight] of style.matchAll(/font-weight:(\d+)/g)) assert.ok(['400', '500'].includes(weight), `font-weight ${weight}: the chat's visuals use 400 and 500`);
  assert.match(style, /\.cg \.steps\{display:grid;grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/, 'the bar is not two wide');
  for (const part of [style, script, section(SCREEN)]) assert.doesNotMatch(part, /<!--|\/\*/, 'a comment inside a part that is copied');
  // The bin stands out (the owner, 2026-11-22: "the trash can needs to be more visible"): its own colour, a border,
  // and an arrow in its place once a row is removed, to bring it back.
  assert.match(style, /^\.cg \.ib\.bin\{[^}]*color:var\(--danger\)[^}]*border:1px solid var\(--line2\)/m, 'the bin looks like the pencil again');
  assert.ok(contrast(light.danger, light.card) >= 4.5, 'the bin\'s colour fails on white');
  assert.ok(script.includes('btn.firstElementChild.className = \'ti \' + (off ? \'ti-arrow-back-up\' : \'ti-trash\');'), 'a removed row still shows a bin');
  // What the screen no longer uses is not copied into the chat: every character is time the person waits.
  assert.doesNotMatch(style, /\.chip|\.pick|\.hero|\.ready|\.grid/, 'styling for a screen that is gone');
  assert.ok(style.length + script.length < 12000, `the style and script are ${style.length + script.length} characters: the screen got heavier`);
  assert.match(script, /typeof sendPrompt === 'function'/);
  // The button never fails silently (the owner's own run, 2026-11-22: "Looks right, create it" sent nothing, and nothing
  // showed). The reply is written on the screen every time, before the send is tried, and a send that throws is caught.
  const send = /function send\(message\) \{([\s\S]*?)\n    \}/.exec(script)[1];
  assert.ok(send.indexOf('said.textContent = say(\'sent\')') > -1 && send.indexOf('said.textContent') < send.indexOf('sendPrompt(message)'), 'the reply is not shown before it is sent');
  assert.doesNotMatch(send, /else/, 'the reply shows only when the chat cannot be reached');
  assert.match(send, /try \{ if \(typeof sendPrompt === 'function'\) sendPrompt\(message\); \} catch/);
  assert.equal(SAY.sent, 'Sent to the chat. If nothing happens there, copy this and send it yourself:');
  assert.ok(plainOf('check-it-reply').includes('> If the button does nothing, just answer here: **looks right, create it**, or tell me what to change.'));
  assert.match(onboardingSkill().flat, /show the screen with `show_widget` and say `check-it-reply` under it, every time\. A click, or the same words typed, is a reply: act on it\./);
  assert.match(plainOf('check-it-reply'), /Said under the screen, every time it is shown: in some chats its button reaches nothing\./);
  const mark = (html) => /<svg class="mark[^"]*"[^>]*>([\s\S]*?)<\/svg>/.exec(html)[1].replace(/\s+/g, '');
  const centerMark = mark(center);
  assert.equal(mark(section(SCREEN)), centerMark, 'the mark is not the command center\'s');
  const CURRENT = { 'check-it': 2 };
  for (const id of [SCREEN]) {
    const bar = /<ol class="steps"[^>]*>([\s\S]*?)<\/ol>/.exec(section(id))[1];
    const items = [...bar.matchAll(/<li( class="(done|now)")?>([\s\S]*?)<\/li>/g)].map(([, , state, inner]) => ({ state: state || 'next', inner, name: words(inner).replace(/^\d\s*/, '') }));
    assert.deepEqual(items.map((item) => item.name), STEPS, `${id}: the bar does not show the two steps`);
    const states = items.map((item) => item.state).join(' ');
    assert.equal(states, items.map((_, i) => (i + 1 < CURRENT[id] ? 'done' : i + 1 === CURRENT[id] ? 'now' : 'next')).join(' '), `${id}: the steps are not done, current, then to come`);
    for (const item of items) assert.equal(item.state === 'done', item.inner.includes('ti-check'), `${id}: "${item.name}" is ticked only if done`);
    assert.ok((section(id).match(/class="btn"/g) || []).length <= 1, `${id}: more than one main button`);
  }
});

test('every step speaks plainly, keeps the true privacy line, and leaves nothing for the person to type', () => {
  const BANNED = /\b(context|brain folder|sources?|MCP|PARA|session|role|command|terminal|setup)\b/i;
  assert.doesNotMatch(words(section(SCREEN)), BANNED, 'the screen uses a word the person should not meet');
  for (const line of TEXT_SCREENS.split('\n').filter((l) => l.startsWith('>') && l !== `> ${CREDIT}`)) assert.doesNotMatch(line, BANNED, `screens-text.md: ${line}`);
  for (const said of Object.values(SAY)) assert.doesNotMatch(said, BANNED, `the screen says: ${said}`);
  assert.ok(words(section(SCREEN)).includes(PRIVACY), 'the screen has no privacy line');
  assert.ok(plainOf('check-it').includes(PRIVACY), 'check-it has no privacy line');
  // Where Cogby asks to look, the privacy line sits right under the question, not at the foot (the owner, 2026-11-22).
  assert.ok(plainOf('get-to-know').includes('to find your projects, your priorities and the people you work with.\n> Everything I find is saved on your computer, in a folder you own. Nothing is shared with anyone unless you ask.\n'), 'the privacy line is not right under the ask');
  // Step 2: asks to get to know their work, says what it reads, offers light or deep, and says questions come while it looks.
  const two = plainOf('get-to-know');
  assert.ok(two.includes('> **Can I get to know your work?**\n> I\'ll look through <what you will look through> to find your projects, your priorities and the people you work with.\n'));
  assert.match(two, /It takes a minute or two\. While I look, I'll ask you a few quick questions\. Stay with me: at the end I'll need you to check what I found\./);
  // Nobody is left watching a background look with nothing said (the owner, 2026-11-22).
  assert.ok(plainOf('still-looking').includes('> Still looking through your work. Stay here: in a minute I\'ll show you what I found, and I\'ll need you to check it.'));
  assert.match(onboardingSkill().flat, /\*\*Questions done, still looking:\*\* say `still-looking`, once\./);
  // The list of steps the chat shows is written for the person (the owner, 2026-11-22: "more scary than useful").
  // Live test of 2026-11-24: the chat showed "Get ready to say hello" and "Say hello". The list is made with the
  // very first action, before screens-text.md is read, so its lines are in the skill itself, among its first rules,
  // in the owner's own words.
  const stepsRule = onboardingSkill().flat.match(/\*\*The steps they see\.\*\*.*?never gets a line\./)?.[0] || '';
  assert.ok(stepsRule, 'the skill does not say which steps the chat lists');
  assert.ok(stepsRule.includes('"Introducing Cogby", "Understanding how you work", "Interviewing you", "Confirming what I found with you", "Creating your brain", "Taking it for a first spin"'), 'the steps are not the six written for the person');
  assert.match(stepsRule, /from your very first action, before you read anything else/);
  assert.match(stepsRule, /all from the start, as written, in their language, and no others/);
  assert.doesNotMatch((stepsRule.match(/"[^"]+"/g) || []).join(' '), /\bthey\b|\bthem\b|\btheir\b|background|look-through|get ready/i, 'a step talks about the person, or in working words');
  const skillText = onboardingSkill().flat;
  assert.ok(skillText.indexOf('**The steps they see.**') < skillText.indexOf('**Plain, friendly words.**'), 'the steps are not the first rule');
  assert.equal(plainOf('task-list'), undefined, 'the steps are back in the second file, read too late');
  assert.ok(two.includes('> Say **yes, take a look** (or **yes, take a deep look**), name anything to leave out or another folder to look at, or say **I\'ll tell you myself**.'));
  assert.doesNotMatch(SCREENS + TEXT_SCREENS, /Map my work|map my work|Choose what I look at|data-reveal="/, '"Map my work" or the hidden list is back');
  // No to-dos line in the ask: where they keep them is found from what is connected (the owner, 2026-11-24).
  assert.doesNotMatch(two, /Your to-dos|ti-checklist/, 'the to-dos line is back');
  for (const [name, rule] of [['Calendar', 'a calendar is connected'], ['Email', 'an email account is connected'], ['Files', 'a file store is connected']]) {
    assert.ok(two.split('\n').some((line) => line.startsWith(`> - ${name}: `) && line.endsWith(` *(only when ${rule})*`)), `${name} is not named only when connected`);
  }
  assert.ok(two.includes('> - Your computer: Documents, Desktop and past Claude Code chats. Never the whole disk.'));
  assert.ok(two.includes('> - **Light**, unless you say otherwise:'), 'Light is not the default');
  assert.ok(two.includes('> - **Deep:** also reads your email messages and what\'s inside your files. A fuller map, but it uses much more of your Claude allowance.'));
  // Step 3: profile and map on one screen; rows have a picker and a bin; nothing asked up front stays here.
  const step3 = section('check-it');
  assert.match(words(step3), /Here's how I see you Fix anything that's wrong: pick what each one is, rename with the pencil, remove with the bin\. You can change all of this later\./);
  assert.match(step3, /data-name="My name"[^>]*data-fill="their name"/);
  assert.match(step3, /data-name="What I do"[^>]*data-fill="what they do"/);
  assert.doesNotMatch(step3, /ti-check ok|arrows-exchange|data-act="move"|data-name="Top priorities"|data-name="Understand myself"|data-name="Ask first"/, 'the old step 3 or 4 is back');
  assert.match(step3, /<div data-list="Done" hidden>\n<div class="label">Done <span class="m">· finished, so it goes to the Archive<\/span><\/div>/);
  assert.match(step3, /data-send="Looks right, create it">Looks right, create it</);
  assert.doesNotMatch(SCREENS + TEXT_SCREENS, /What are you trying to accomplish/i, 'the confusing first question is back');
  // You're set: My view is the main thing; what to try comes second.
  const end = plainOf('youre-set');
  assert.ok(end.includes('> **My view: where you and I keep track of everything.** What needs you, your projects and your to-dos, on one page. Come back to it any time.'));
  assert.ok(end.indexOf('My view: where you and I') < end.indexOf('Try this first'), 'what to try comes before My view');
  const NEW_CHAT = 'One last thing: start a new chat, from anywhere. That\'s where Cogby is fully switched on.';
  for (const part of ['Try this first', 'What needs me today?', NEW_CHAT]) assert.ok(end.includes(part), `the ending has no "${part}"`);
  assert.doesNotMatch(end, /[A-Z]:\\|~\/|\bnode |cogby (view|init|link|routines|wrapup)\b/, 'the ending shows a path or a command');
  assert.ok(end.includes('> - Your to-dos stay in <their tool>: I add them and tick them off there *(only when their task tool is connected)*'));
  assert.ok(end.includes('> - Your to-dos stay in <their tool>, which I can\'t reach yet. Connect it, then say "connect my to-dos" *(only when they named one that is not connected)*'));
  assert.ok(end.includes('> - Your meetings: say "catch me up on my meetings" and I\'ll write down what was decided and who promised what, with a link back to the recording *(only when their meeting tool is connected)*'));
});

test('Check it is drawn from a short list: one line per item, and a row\'s markup written once', () => {
  // An outside tester's onboarding of 0.3.11: the screen took far too long to appear. A row was about 520 characters of markup,
  // written out once per item. The owner, 2026-11-22: Claude fills a short list and the screen draws the rows.
  const { flat } = onboardingSkill();
  const step3 = section(SCREEN);
  const list = /<pre class="map" data-map>\n([\s\S]*?)\n<\/pre>/.exec(step3)[1].split('\n');
  assert.ok(list.length >= 5, 'the sample map has too few items');
  for (const line of list) {
    const parts = line.split(' | ');
    assert.equal(parts.length, 3, `"${line}" is not name | where it came from | kind`);
    assert.ok(['Project', 'Ongoing', 'Done', 'Person'].includes(parts[2]), `"${parts[2]}" is not a kind`);
    assert.ok(line.length < 100, `"${line}" is ${line.length} characters: an item is one short line`);
  }
  for (const kind of ['Project', 'Ongoing', 'Person']) assert.ok(list.some((line) => line.endsWith(` | ${kind}`)), `the sample has no ${kind}`);
  assert.equal((step3.match(/class="row"/g) || []).length, 1, 'a row is written out per item again');
  assert.doesNotMatch(SCREENS, /data-each/, 'something on the screen is still repeated by hand');
  // The one row the script copies: the picker, the pencil and the bin.
  const model = /^<div data-row hidden>(<div class="row">.*<\/div>)<\/div>$/m.exec(step3)[1];
  assert.ok(model.includes('<select class="kind" aria-label="What this is"><option value="Project">Project</option><option value="Ongoing">Ongoing</option><option value="Done">Done</option></select>'), 'no picker');
  assert.match(model, /<button class="ib" data-act="rename" aria-label="Rename"><i class="ti ti-pencil"/, 'no pencil');
  assert.match(model, /<button class="ib bin" data-act="remove" aria-label="Remove"><i class="ti ti-trash"/, 'no bin');
  assert.ok(script.includes('var row = model.cloneNode(true), select = row.querySelector(\'select.kind\');'));
  assert.ok(script.includes('if (kind === \'Person\') select.remove(); else select.value = kind;'), 'a person gets a project picker, or a row\'s picker does not start on its kind');
  // Where the rows go, and what can be added.
  assert.deepEqual([...step3.matchAll(/^<div data-list="([A-Za-z]+)"( hidden)?>$/gm)].map((m) => m[1] + (m[2] || '')), ['Project', 'Ongoing', 'Done hidden', 'Person']);
  for (const add of ['Add a project', 'Add something ongoing', 'Add a person or an organization']) {
    assert.ok(step3.includes(`<div class="addrow"><input type="text" placeholder="${add}" aria-label="${add}"><button class="quiet" data-add>Add</button></div>`), `no "${add}"`);
  }
  assert.ok(script.includes('make(name, say(\'added\'), btn.closest(\'[data-list]\').getAttribute(\'data-list\'), true);'));
  assert.ok(script.includes('map.textContent.split(\'\\n\')'), 'the script does not read the list');
  assert.ok(step3.includes('<span class="m" data-count></span>'), 'no count');
  // The reply the screen composes, in this order.
  assert.ok(script.includes('var out = { remove: [], rename: [], change: [], done: [], add: [] };'));
  assert.deepEqual([SAY.remove, SAY.rename, SAY.change, SAY.done, SAY.add], ['Remove', 'Rename', 'Change', 'Done, to the Archive', 'Add']);
  assert.equal(SAY.kept, '{n} of {m} kept');
  assert.equal(SAY.added, 'Added by you');
  // How it is filled, in the file and in the skill.
  assert.match(FILL, /data-map: the list of what was found\. Replace the sample lines, one short line per item: name \| where it came from \| kind The kind is Project, Ongoing, Done or Person \(a person or an organization\), always in English\./);
  assert.match(FILL, /Never write a row's markup: the script draws every row and the count from this list\./);
  assert.match(flat, /Change only what is marked `data-fill` and `data-if`, and the list under `data-map`: one short line per item, `name \| where it came from \| kind`, the kind one of Project, Ongoing, Done or Person\. Never write a row's markup: the screen draws its rows from that list, so it appears quickly\./);
  // What is copied into the chat, sample included: lighter than before, and an item adds a line, not a row.
  const copied = style.length + script.length + step3.length;
  assert.ok(copied < 18500, `the screen is ${copied} characters to copy`);
});

test('onboarding follows the person\'s language, on every step and on the screen, right to left too', () => {
  // The owner, 2026-11-22: follow the language the person writes in, and ask only when it is unclear.
  const { flat } = onboardingSkill();
  assert.match(flat, /\*\*Their language\.\*\* Follow the language they write in; ask \("English, or another language\?"\) only when it is unclear\./);
  assert.match(flat, /Nothing written yet \(a bare command\): start in English, and switch the moment they answer in another\./);
  assert.match(flat, /Every step is said in it, the bold words they reply with too, and so is Check it\. English is said as written\./);
  assert.doesNotMatch(flat + TEXT_SCREENS, /word for word/i, '"word for word" forbids saying a step in another language');
  assert.match(TEXT_SCREENS.replace(/\s+/g, ' '), /said in the chat, from here: the same meaning, in the same order, in the language the person writes in\. In English, these are the words\./);
  // Saved, so later chats use it.
  assert.match(flat, /how to answer \("answer first, in plain words", and the language they write in, so later chats use it\)/);
  assert.match(fs.readFileSync(path.join(SELF, 'USER.md'), 'utf8'), /^- \*\*How to answer:\*\* \[The language to answer in, and how\./m);
  // The screen: every word a person reads can be said in theirs, and nothing that makes it work is translated.
  assert.match(FILL, /Another language: the person reads every word in theirs\. Say the same thing, in the same order, in the section's text and in its placeholder, aria-label, data-name, data-send and data-say values\./);
  assert.match(FILL, /Leave as they are: class, value, data-list, data-act, and the kind that ends a map line\./);
  for (const key of [...script.matchAll(/say\('([a-z]+)'\)/g)].map((m) => m[1]).concat('back', 'remove', 'rename', 'change', 'done', 'add')) {
    assert.ok(SAY[key], `the script says "${key}", which the section does not hold`);
  }
  assert.doesNotMatch(script, /'(Remove|Bring back|Rename|Change|Add|Added by you)\b|' of '|kept'(?!\))/, 'a word a person reads is fixed in the script');
  // Right to left: one attribute on the section, and a layout with no left or right in it.
  assert.match(FILL, /A right-to-left language \(Arabic, Hebrew, Persian, Urdu\): set dir="rtl" on the section, and the layout follows it\./);
  assert.match(flat, /a right-to-left one \(Arabic, Hebrew\) sets `dir="rtl"`/);
  assert.match(SCREENS, /^<section class="cg" id="check-it" dir="ltr">$/m);
  assert.doesNotMatch(style, /(margin|padding|border)-(left|right)|text-align:(left|right)|[;{](left|right):/, 'the layout names a side, so it would not turn for Arabic');
});

test('what they want to understand is a guess they correct in the interview, not lists on Check it', () => {
  // The owner, 2026-11-24, reversing the choice of 22 Nov: the two lists leave Check it. Cogby guesses from what the
  // person does and they correct it, as question 4, always asked so it is never skipped as it was on 22 Nov.
  const { flat } = onboardingSkill();
  const step3 = section(SCREEN);
  assert.doesNotMatch(step3 + script + style, /understand|data-own|data-mine|Cogby handles it/, 'the two lists are back on Check it');
  assert.doesNotMatch(plainOf('check-it'), /understand yourself/, 'the chat version of Check it still asks it');
  assert.match(flat, /What they want to understand themselves is not on this screen: question 4 asked it\. Their reply lists what to remove, rename, change, mark Done or add; say back in one line what changed\./);
  // Written only from what they said or confirmed, on both lists of the file.
  assert.match(flat, /What they want to understand, from their answer to question 4: one line per topic under `## What I care about understanding myself` in `\.cogby\/self\/information-border\.md` \(made with its two headings if it is not there\), and one per topic they said to hand over under `## Hand over`\. Only what they said or confirmed: a guess they did not answer, or "ask me as we go", is written nowhere\./);
  const border = fs.readFileSync(path.join(SELF, 'information-border.md'), 'utf8');
  assert.match(border, /^## Hand over$/m);
  assert.doesNotMatch(fs.readFileSync(path.join(SELF, 'getting-to-know.md'), 'utf8'), /understand yourself/, 'it still waits as a question for a later chat');
});

test('the last message does one real thing first, and credits PARA in one line, the only place it is named', () => {
  // The owner, 2026-11-22: a live example at the end, and credit to Tiago Forte.
  const { flat } = onboardingSkill();
  const end = plainOf('youre-set');
  assert.match(flat, /\*\*One real thing first,\*\* done with what you just learned, its result said in `youre-set` above "Try this first"\./);
  assert.match(flat, /A calendar is connected and a work meeting is coming soon: prepare it as the `meeting-prep` skill does, by its commands, from the pages just written, in at most six lines \(who is in it, where things stand, one or two things to ask\)\./);
  assert.match(flat, /No calendar: what is on their plate this week, three to five lines from the map\. Read nothing they did not allow\./);
  assert.match(flat, /The map is too thin \(fewer than three rows kept, or nothing with a date\): skip it, and keep the three suggestions\./);
  const at = (part) => { const i = end.indexOf(part); assert.ok(i >= 0, `the ending has no "${part}"`); return i; };
  assert.ok(at('My view: where you and I') < at('> **One thing, done already:** *(only when there was enough to go on)*'), 'the example comes before My view');
  assert.ok(at('> **One thing, done already:**') < at('> **Try this first:**'), 'the example comes after what to try');
  assert.ok(end.includes('> <their next meeting, prepared: its name and time, who is in it, where things stand, one or two things to ask> *(only when a calendar is connected)*'));
  assert.ok(end.includes('> <what is on their plate this week, three to five lines> *(only when no calendar is connected)*'));
  assert.ok(end.includes('"Prep me for my next meeting" *(only when a calendar is connected, and that meeting was not just prepared)*'));
  // The credit: one line, said once.
  assert.ok(end.includes(`> <what was created>\n> ${CREDIT}\n`), 'the credit is not one line under what was created');
  assert.deepEqual(TEXT_SCREENS.split('\n').filter((line) => /PARA/.test(line)), [`> ${CREDIT}`], 'PARA is said somewhere other than the credit line');
  assert.doesNotMatch(words(section(SCREEN)) + Object.values(SAY).join(' '), /PARA/, 'the screen names PARA');
  assert.match(flat, /PARA is named once, in the credit line of `youre-set`; "second brain" once, in the hello\. Neither anywhere else\./);
  assert.ok(flat.includes(`the one credit line ("${CREDIT}")`));
  assert.doesNotMatch(words(section(SCREEN)) + Object.values(SAY).join(' ') + plainOf('youre-set') + plainOf('check-it') + plainOf('get-to-know') + plainOf('connect-first'), /second brain/i, 'Cogby is called a second brain outside the hello');
});

test('a new brain starts with two short files, on who Cogby is and who the person is', (t) => {
  // The owner, 2026-11-22: the starting files repeated AGENTS.md and asked for more than onboarding learns.
  const soul = fs.readFileSync(path.join(SELF, 'SOUL.md'), 'utf8').replace(/\r\n/g, '\n');
  const user = fs.readFileSync(path.join(SELF, 'USER.md'), 'utf8').replace(/\r\n/g, '\n');
  assert.match(soul, /^I am Cogby, \*\*\[OWNER_NAME\]\*\*'s context manager and working companion\./m);
  assert.deepEqual([...soul.matchAll(/^## (.+)$/gm)].map((m) => m[1]), ['Voice'], 'SOUL.md holds more than who Cogby is and its voice');
  assert.doesNotMatch(soul, /Operating principles|What I work with|PARA|second brain|\.claude\/skills/, 'SOUL.md repeats AGENTS.md');
  assert.ok(soul.length < 1200, `SOUL.md is ${soul.length} characters`);
  assert.deepEqual([...user.matchAll(/^- \*\*([^*:]+):\*\*/gm)].map((m) => m[1]), ['Who', 'What I do', 'What matters most', 'How to answer']);
  assert.deepEqual([...user.matchAll(/^## (.+)$/gm)].map((m) => m[1].replace(/ \(.*/, '')), ['Hard rules', 'Current standing work']);
  assert.doesNotMatch(user, /\bage\b|12-month|Platform|Disposition|Working with AI/i, 'USER.md asks for something onboarding never learns');
  assert.ok(user.includes('- **No secrets in memory files** — reference env var names only, never values.'));
  assert.ok(user.length < 1200, `USER.md is ${user.length} characters`);
  // What onboarding fills and looks for is still there, in the template and in a brain made from it.
  for (const file of [soul, user]) { assert.match(file, /\[OWNER_NAME\]/); assert.match(file, /^last-reviewed: \[TODAY\]$/m); }
  const box = newBrain(t);
  for (const [name, file] of [['SOUL.md', soul], ['USER.md', user]]) {
    assert.equal(fs.readFileSync(path.join(box.brain, '.cogby', 'self', name), 'utf8').replace(/\r\n/g, '\n'), file, `a new brain's ${name} is not the short one`);
  }
  assert.match(onboardingSkill().flat, /A brain whose `\.cogby\/self\/USER\.md` still has `\[OWNER_NAME\]`/);
});

test('before it looks, Cogby checks what is connected, and offers to connect what is missing or to skip', () => {
  // An outside tester's onboarding of 0.3.11, reported by the owner on 2026-11-22: it did not check their email or Drive, nor ask
  // whether he had connectors. A connected tool can be listed without being loaded, which is how one gets missed.
  const { flat } = onboardingSkill();
  assert.match(flat, /\*\*First, find what this chat can read, properly:\*\* a calendar tool, a mail tool, a file store such as Google Drive\./);
  assert.match(flat, /A connected one may be listed without being loaded: when this chat has a way to search its tools, search for calendar, mail and drive before deciding one is missing\./);
  assert.match(flat, /\*\*One of the three is missing:\*\* say `connect-first`, naming only what is missing, and wait\./);
  assert.match(flat, /You never connect anything yourself: they do, or they skip\./);
  assert.match(flat, /when this chat has a tool that suggests connectors, use it for the one they named, so they get a button; otherwise tell them to open Claude's settings and choose Connectors\./);
  assert.match(flat, /On "done", look again the same way\. Still not there: say in one line that it may only show up in a new chat, and carry on with what there is\./);
  assert.match(flat, /On "skip", carry on; You're set says what they can still connect\./);
  assert.ok(flat.indexOf('say `connect-first`') < flat.indexOf('Then say `get-to-know`'), 'the look is offered before the check for what is missing');
  const ask = plainOf('connect-first');
  assert.match(ask, /I can't see your <what is missing: calendar, email, files> from this chat\./);
  assert.match(ask, /To connect one, <where to connect it>\. Tell me when it's done\./);
  assert.match(ask, /Or say \*\*skip\*\*, and I'll work with what I can see\. You can connect the rest any time later\./);
  assert.ok(plainOf('youre-set').includes('isn\'t connected yet. Connect it any time, then say "look through my <email>" *(only when they skipped one)*'));
});

test('My view is published when the chat can publish, and the last message says plainly when it could not', () => {
  // An outside tester's onboarding of 0.3.11, reported by the owner on 2026-11-22: My view was not created as a page on claude.ai.
  const { flat } = onboardingSkill();
  assert.match(flat, /It publishes the page when this chat can publish one; look for that tool properly, as in Get to know you\./);
  assert.match(flat, /No link came back: the page is a file on their computer, and `youre-set` says so plainly, never a link that is not there\./);
  const view = fs.readFileSync(path.join(ROOT, '.claude', 'skills', 'my-view', 'SKILL.md'), 'utf8').replace(/\s+/g, ' ');
  assert.match(view, /\*\*If this session has the `Artifact` tool\*\* \(it may be listed without being loaded: where the session can search its tools, search for it before deciding there is none\)/);
  assert.doesNotMatch(view, /Brain page/, 'My view points at a question onboarding no longer asks');
  const end = plainOf('youre-set');
  assert.ok(end.includes('> <the page\'s link> It\'s a private page on claude.ai that only you can open. I refresh it when you wrap up. *(only when the page was published)*'));
  assert.ok(end.includes('> I couldn\'t publish it as a page from this chat, so it\'s saved on your computer. Say "open my view" and I\'ll open it. *(only when it was not)*'));
});

test('Cogby gets to know the person while it looks: questions in the chat, the look-through in the background', () => {
  const { flat } = onboardingSkill();
  assert.match(flat, /start the look-through in the background with Claude's own subagent tool \(`Agent`, run in the background\)/);
  // Live test of 2026-11-24 (the owner): say that a helper is at work and that the person only answers here.
  assert.match(flat, /asking for the draft map back\. Say `looking`\. Then ask the `questions`/);
  assert.ok(plainOf('looking').includes("> My helper is reading through your work now, to understand your world. The chat may show it as an agent working.\n> Two things are happening at once: it reads, and I ask you a few quick questions. You only need to answer me here.\n> Stay with me: when it's done, I'll show you what it found, and I'll need you to check it.\n"), 'the waiting line changed');
  // Four questions (the owner, 2026-11-24, after sitting through the nine of 22 Nov: "boring"): asked only while the
  // look runs, except the first and the last. The last is the information border, as a guess to correct. Where the
  // to-dos and the meetings live is found, not asked.
  assert.match(flat, /Then ask the `questions` of `screens-text\.md` in the chat, in their order, one at a time, waiting for each answer\./);
  const asked = ['1. What should I call you, and what do you do?', '2. What matters most to you right now?',
    '3. What do you already use Claude for, and what do you wish it did for you every day?',
    "4. My guess, from what you do: you want to understand <one or two subjects> yourself, and you'd rather I handle <one or two subjects>. For what you want to understand, I ask what you think first and I explain my reasons, so the know-how stays with you. Did I guess right? Change anything, or say **ask me as we go**."];
  const rule = plainOf('questions').replace(/\s+/g, ' ');
  assert.match(rule, /Questions 1 and 4 are always asked\. Questions 2 and 3 are asked only while the look is still running, and each can be skipped\./);
  assert.match(rule, /Question 4 is a guess for them to correct, never a blank to fill\./);
  assert.match(rule, /Subjects, never project names \("hiring decisions", not the name of a hiring project\), three at most in all\. Nothing to go on: money, people, technical choices\./);
  assert.deepEqual(plainOf('questions').split('\n').filter((line) => /^> \d/.test(line)).map((line) => line.slice(2)), asked);
  assert.match(flat, /\*\*Their to-do tool and their meeting tool\*\* are found, never asked\. One found: say so in one line \("Notion is connected, so your to-dos can stay there"\); a word from them changes it\. Several: ask which, in one line\. None: say nothing, and it waits as a question for a later chat\. They name one that is not connected: say `connect-later`, once\./);
  assert.match(plainOf('connect-later'), /you can connect it any time in Claude's settings, under Connectors, then tell me "connect my <to-dos, or meetings>"/);
  assert.match(flat, /\*\*The look-through reports before question 4:\*\* finish the question in hand, say `look-done`, ask question 4, then Check it\. Question 2 or 3 not reached waits for a later chat\./);
  assert.ok(plainOf('look-done').includes('> I\'ve finished looking through your work. One last question, then I\'ll show you what I found.'));
  assert.match(flat, /Where their to-dos live and where their meetings are recorded are one fact each on `work`, with the list's or folder's own name and link when they gave one; "none" is not written\. Never copy a to-do or a transcript\./);
  assert.match(flat, /\*\*No background tool here:\*\* say it takes a minute or two \(longer on Deep\), look first, ask only questions 1 and 4\./);
  assert.match(flat, /\*\*"I'll tell you myself":\*\* question 1, then, one at a time:/);
  assert.match(flat, /who do you work with most; then question 4\. Their answers are the map\./);
  assert.match(flat, /a to-do or meeting tool that was found ticks its question with what was found\. What they use Claude for and what they wish it did every day also go in USER\.md\./);
  assert.match(flat, /tick each in `\.cogby\/self\/getting-to-know\.md` with the date and the answer, or "skipped"/);
  // The morning check-in is no longer a question: offered when their answer to question 3 asks for a morning brief.
  // On a yes: a routine that only reports, and "on" only with the scheduler's word.
  assert.match(flat, /\*\*Their answer to question 3 asks for a morning brief:\*\* offer the morning check-in in one line\. On a yes: `cogby routines add/);
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
  assert.match(flat, /\*\*One step per reply\.\*\* Never two steps in one message, never the whole run as one long page\./);
  assert.match(flat, /give it a plain description of what it does for them \("Creating your brain"\), since that is what they see/);
  assert.match(flat, /Look the same way for their to-do tool and their meeting tool: these are found, never asked in the interview\./);
  assert.match(flat, /It ends by saying a new chat can start from anywhere\./);
  const after = text.split('## Right after onboarding\n')[1]?.split('\n## ')[0];
  assert.ok(after, 'no "Right after onboarding" section');
  assert.match(after.replace(/\s+/g, ' '), /Building My view and the first thing they try \("What needs me today\?", a meeting prep\) stay as plain as the onboarding, until they start a new chat\./);
  assert.match(after.replace(/\s+/g, ' '), /No tool names, file paths, commands or step-by-step narration, whichever skill does the work\./);
});

test('onboarding reads only what the person allowed, files Done in the Archive, and leaves folders to later', () => {
  const { flat } = onboardingSkill();
  assert.match(flat, /one line per topic under `## What I care about understanding myself` in `\.cogby\/self\/information-border\.md`/);
  assert.match(flat, /You never connect anything yourself: they do, or they skip\./);
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
  assert.deepEqual([...starter.matchAll(/^- \[ \] (.+)$/gm)].map((m) => m[1]), ['What matters most to you right now?',
    'What do you already use Claude for, and what do you wish it did for you every day?', 'Where do you keep your to-dos?',
    'Are your meetings recorded or written up somewhere?', 'Want a morning check-in?']);
  const RULE = 'Ask at most one in a chat, only at a natural pause, never in the middle of a task; the owner may skip it.';
  const started = () => hook(box, 'brain-context', { source: 'startup' }).out;
  let out = started();
  assert.ok(out.includes(`## Getting to know the owner\n5 questions left in ${file}; the next: "What matters most to you right now?"\n${RULE}`), out);
  // Each answer given in a later chat has a home, the same one onboarding uses.
  assert.ok(out.includes('What matters most and what they use Claude for go in USER.md, where their to-dos live and where their meetings are recorded are one fact each on `areas/work/card`, what they want to understand goes in the information border file, and a yes to a morning check-in goes to the routines skill.'), out);
  fs.writeFileSync(file, starter.replace('- [ ] What matters most to you right now?', '- [x] What matters most to you right now? (2026-11-20: Q4 close)'));
  out = started();
  assert.ok(out.includes(`4 questions left in ${file}; the next: "What do you already use Claude for, and what do you wish it did for you every day?"`), out);
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace(/^- \[ \] (?!Want a morning check-in\?)(.+)$/gm, '- [x] $1 (2026-11-20: skipped)'));
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
