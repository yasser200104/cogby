'use strict';

// Shared by the tests: a throwaway brain in a temp folder, with Cogby's per-machine config pointed
// at that folder too, so nothing here reads or writes the real brain of whoever runs the tests.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const CLI = path.join(ROOT, 'core', 'brain', 'cli.cjs');
const HOOK = path.join(ROOT, '.claude', 'hooks', 'plugin-hook.cjs');

function sandbox(t, name = 'Cogby Brain') {
  const dir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'cogby-test-')));
  const home = path.join(dir, 'home');
  fs.mkdirSync(home, { recursive: true });
  const env = {
    ...process.env, HOME: home, USERPROFILE: home, APPDATA: path.join(home, 'AppData'),
    XDG_CONFIG_HOME: path.join(home, '.config'), COGBY_CONFIG_DIR: path.join(home, 'cogby-config'),
    COGBY_NO_SOURCES: '1',
    // No test leaves a detached sync behind: the ones that test it turn it back on and wait for it.
    COGBY_NO_BACKGROUND_SYNC: '1',
  };
  // CLAUDECODE too: a test is a person at their own terminal unless it says otherwise, also when the
  // suite itself is run from a Claude session. A test that is an agent passes `env: { CLAUDECODE: '1' }`.
  for (const key of ['CLAUDE_PROJECT_DIR', 'COGBY_BRAIN', 'BRAIN_DIR', 'COGBY_CONTEXT', 'BRAIN_WRAPUP_MODE', 'BRAIN_NO_WRAPUP', 'BRAIN_WRAPUP_DRYRUN',
    'CLAUDECODE', 'COGBY_ACTOR', 'COGBY_AGENT', 'COGBY_AUTHOR', 'BRAIN_HEADLESS', 'BRAIN_NO_CAPTURE', 'BRAIN_NO_GOAL']) delete env[key];
  // A space in the name on purpose: the usual brain is "~/Cogby Brain".
  const brain = path.join(dir, name);
  if (t) t.after(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5 }));
  return { dir, brain, env };
}

function cogby(box, args, options = {}) {
  const result = spawnSync(process.execPath, [CLI, ...args], {
    env: { ...box.env, ...(options.env || {}) }, cwd: options.cwd || box.dir, encoding: 'utf8',
  });
  return { code: result.status, out: result.stdout || '', err: result.stderr || '' };
}

function json(box, args, options) {
  const result = cogby(box, [...args, '--json'], options);
  let data = null;
  try { data = JSON.parse(result.out); } catch { /* left null: the caller asserts */ }
  return { ...result, data };
}

function newBrain(t, name) {
  const box = sandbox(t, name);
  const made = json(box, ['init', '--brain', box.brain, '--no-plugin', '--no-sources']);
  if (made.code !== 0) throw new Error(`init failed: ${made.err || made.out}`);
  return box;
}

function hook(box, name, payload, options = {}) {
  const cwd = options.cwd || box.brain;
  const result = spawnSync(process.execPath, [HOOK, name], {
    env: { ...box.env, CLAUDE_PROJECT_DIR: cwd, ...(options.env || {}) },
    cwd, encoding: 'utf8', input: JSON.stringify({ cwd, ...payload }),
  });
  return { code: result.status, out: result.stdout || '', err: result.stderr || '' };
}

function git(dir, args) {
  const result = spawnSync('git', ['-C', dir, ...args], { encoding: 'utf8' });
  return (result.stdout || '').trim();
}

// The onboarding skill carries its own closed questions, for a chat with no visual tool: two fenced
// JSON blocks, each one batch in the shape Claude Code's question tool takes. `flat` is the text on one line, for a phrase that may wrap;
// `prose` is the text without the two blocks.
function onboardingSkill() {
  const text = fs.readFileSync(path.join(ROOT, '.claude', 'skills', 'onboarding', 'SKILL.md'), 'utf8').replace(/\r\n/g, '\n');
  const block = /```json\n([\s\S]*?)\n```/g;
  const batches = [...text.matchAll(block)].map(([, json]) => JSON.parse(json));
  const prose = text.replace(block, '');
  return { text, batches, prose, flat: text.replace(/\s+/g, ' ') };
}

module.exports = { ROOT, CLI, HOOK, sandbox, cogby, json, newBrain, hook, git, onboardingSkill };
