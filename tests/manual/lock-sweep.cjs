#!/usr/bin/env node
'use strict';

// The save-lock sweep. The session-end hook is run on a throwaway brain and stopped at many
// different moments, the way Claude Code stops a SessionEnd hook that runs over its time, and after
// each run the brain is checked for a git lock left behind. It is the reproduction of the leftover
// .git/index.lock of 24 and 25 Nov 2026, kept so it can be run again with as many runs as wanted.
//
//   node tests/manual/lock-sweep.cjs [--runs 60] [--files 1500] [--from <ms>] [--to <ms>]
//                                    [--mode both|review|off] [--kill both|tree|top] [--inline]
//                                    [--plugin <folder>]
//
//   --runs    how many runs (default 60). Three in four are stopped at a moment spread evenly from
//             --from to --to; every fourth is stopped the instant the hook says it has handed the
//             work over, the one moment a helper exists while the hook is still there.
//   --files   extra pages in the throwaway brain, so git has work to do (default 1500)
//   --from    the earliest moment a run is stopped at, in ms after it starts (default 0)
//   --to      the latest. Default: 1.2 times as long as the hook runs when left alone, measured
//             first, so the last runs find it already gone.
//   --kill    tree: the hook and everything below it; top: the hook's own process only
//   --inline  a control: the work is done inside the hook, as it was before the fix, and it is
//             stopped anywhere in the length of that work.
//   --plugin  another control: the hook of another copy of the plugin, for example the released
//             one unpacked in a temp folder. Expect leftover locks from a copy without the fix; it
//             shows the sweep can see one.
//
// One line per run, then `SUMMARY … N of M runs left an index.lock`. Exits 1 when N is not 0.
// Nothing here touches a real brain: the brain, HOME and Cogby's config folder are all inside one
// temp folder (tests/helpers.cjs), removed at the end. tests/save-lock.test.cjs runs a short sweep
// with the same code; this file is not picked up by `node --test "tests/*.test.cjs"`.

const fs = require('fs');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const { ROOT, HOOK, newBrain } = require('../helpers.cjs');
const { stopTree, isAlive, psRows } = require(path.join(ROOT, 'core', 'lib', 'spawn.cjs'));

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const HELPER_WAIT_MS = 90000;

function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const gitIn = (box, args) => spawnSync('git', ['-C', box.brain, '--no-optional-locks', ...args], { encoding: 'utf8', env: box.env, windowsHide: true });

// A throwaway brain with `files` extra pages committed, a few of them changed and a few new files
// left uncommitted (a working brain is never clean), and a transcript with one turn in it.
function makeBrain(t, { files = 0 } = {}) {
  const box = newBrain(t);
  for (let i = 0; i < files; i++) {
    const dir = path.join(box.brain, 'areas', `bulk-${i % 40}`);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `page-${i}.md`), `---\ntype: note\ntitle: Page ${i}\n---\n# Page ${i}\n\n${'A line of text on a page.\n'.repeat(30)}`);
  }
  if (files) {
    gitIn(box, ['add', '-A']);
    const made = gitIn(box, ['-c', 'user.name=Sweep', '-c', 'user.email=sweep@localhost', '-c', 'commit.gpgsign=false', 'commit', '-q', '--no-verify', '-m', 'bulk pages']);
    if (made.status !== 0) throw new Error(`the bulk commit failed: ${made.stderr}`);
    for (let i = 0; i < Math.min(files, 60); i++) fs.appendFileSync(path.join(box.brain, 'areas', `bulk-${i % 40}`, `page-${i}.md`), 'changed\n');
    for (let i = 0; i < Math.min(files, 40); i++) {
      const dir = path.join(box.brain, 'projects', `p-${i % 8}`, 'output');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, `new-${i}.md`), 'not committed\n');
    }
  }
  box.transcript = path.join(box.dir, 'transcript.jsonl');
  fs.writeFileSync(box.transcript, `${JSON.stringify({ type: 'user', message: { role: 'user', content: 'hello' } })}\n`);
  box.dayLog = path.join(box.brain, '.cogby', 'self', 'log', `${today()}.md`);
  return box;
}

// What a turn leaves: something uncommitted in today's log.
function dirtyLog(box, n) {
  fs.mkdirSync(path.dirname(box.dayLog), { recursive: true });
  fs.appendFileSync(box.dayLog, `${fs.existsSync(box.dayLog) ? '' : `# ${today()}\n`}\n### run ${n}\nline ${Date.now()}\n`);
}

const logCommitted = (box) => { const r = gitIn(box, ['status', '--porcelain', '--untracked-files=all', '--', '.cogby/self/log']); return r.status === 0 && r.stdout.trim() === ''; };

// Every lock file in the brain's .git folder, and Cogby's own write lock.
function locks(box) {
  const found = [];
  try { for (const name of fs.readdirSync(path.join(box.brain, '.git'))) if (/\.lock$/.test(name)) found.push(`.git/${name}`); } catch { /* no .git */ }
  if (fs.existsSync(path.join(box.brain, '.cogby', 'write.lock'))) found.push('.cogby/write.lock');
  return found;
}

async function waitGone(pid, ms = HELPER_WAIT_MS) {
  for (const until = Date.now() + ms; Date.now() < until;) {
    if (!isAlive(pid)) return true;
    await sleep(40);
  }
  return false;
}

// Helpers of this checkout still at work, found by their command line: for the rare run that was
// stopped after its helper started and before the hook could say so.
function helpersLeft(root = ROOT) {
  try { return psRows().filter((row) => row.args.includes('--helper') && row.args.includes('session-wrapup.cjs') && row.args.toLowerCase().includes(root.toLowerCase())).map((row) => row.pid); }
  catch { return []; }
}

// One session end. The hook is started the way Claude Code starts it and, unless kill is 'none',
// stopped `delay` ms later if it is still running; with delay 'handoff', the instant it says the
// helper has the work. Then the helper is waited for, and the brain is looked at. Returns what
// happened; a lock found is removed, so the next run starts clean.
async function trial(box, { n = 0, mode = 'review', kill = 'tree', delay = 0, inline = false, hook = HOOK } = {}) {
  dirtyLog(box, n);
  const started = Date.now();
  const child = spawn(process.execPath, [hook, 'session-wrapup'], {
    env: { ...box.env, CLAUDE_PROJECT_DIR: box.brain, BRAIN_WRAPUP_MODE: mode, BRAIN_WRAPUP_DRYRUN: '1', COGBY_SESSION_END_INLINE: inline ? '1' : '0' },
    cwd: box.brain, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true,
  });
  let out = '';
  let handedOver = () => {};
  const handoff = new Promise((resolve) => { handedOver = resolve; });
  child.stdout.on('data', (chunk) => { out += chunk; if (/helper started/.test(out)) handedOver(); });
  child.stderr.on('data', (chunk) => { out += chunk; });
  let ranMs = null;
  const exited = new Promise((resolve) => child.on('exit', () => { ranMs = Date.now() - started; resolve(); }));
  const closed = new Promise((resolve) => child.on('close', resolve));
  child.stdin.on('error', () => { /* stopped before it read its payload */ });
  child.stdin.end(JSON.stringify({ cwd: box.brain, session_id: `sweep-${n}`, hook_event_name: 'SessionEnd', reason: 'other', transcript_path: box.transcript }));
  let killed = false;
  if (kill !== 'none') {
    await Promise.race([exited, delay === 'handoff' ? handoff : sleep(delay)]);
    if (ranMs === null) {
      killed = true;
      if (kill === 'tree') await stopTree(child); else child.kill('SIGKILL');
    }
  }
  await exited;
  await Promise.race([closed, sleep(2000)]);
  const helper = Number((/helper started: pid (\d+)/.exec(out) || [])[1]) || null;
  const helperDone = helper ? await waitGone(helper) : null;
  if (!helper) await sleep(300);
  let left = locks(box);
  // A git still at work holds its lock for a moment: only a lock that stays is a leftover.
  if (left.length) { await sleep(2500); left = locks(box); }
  const committed = logCommitted(box);
  for (const rel of left) fs.rmSync(path.join(box.brain, ...rel.split('/')), { force: true });
  return { n, mode, kill, delay, killed, ranMs, helper, helperDone, committed, left, out: out.replace(/\s+/g, ' ').trim() };
}

// After the last run: no helper is left at work, and no lock stands.
async function settle(box, ms = 60000, root = ROOT) {
  for (const until = Date.now() + ms; Date.now() < until;) {
    if (!helpersLeft(root).length) break;
    await sleep(500);
  }
  await sleep(300);
  return locks(box);
}

async function main() {
  const args = process.argv.slice(2);
  const value = (name, fallback) => { const at = args.indexOf(name); return at >= 0 && args[at + 1] ? args[at + 1] : fallback; };
  const runs = Math.max(1, Number(value('--runs', 60)) || 60);
  const files = Math.max(0, Number(value('--files', 1500)) || 0);
  const from = Math.max(0, Number(value('--from', 0)) || 0);
  const askedTo = Number(value('--to', 0)) || 0;
  const modes = value('--mode', 'both') === 'both' ? ['review', 'off'] : [value('--mode', 'review')];
  const kills = value('--kill', 'both') === 'both' ? ['tree', 'top'] : [value('--kill', 'tree')];
  const inline = args.includes('--inline');
  const plugin = value('--plugin', '') ? path.resolve(value('--plugin', '')) : '';
  const hook = plugin ? path.join(plugin, '.claude', 'hooks', 'plugin-hook.cjs') : HOOK;
  if (!fs.existsSync(hook)) throw new Error(`no plugin hook at ${hook}`);
  const control = inline || !!plugin;   // no hand-over to wait for: stopped by the clock only
  const what = plugin ? `the hook of ${plugin}` : inline ? 'the work inside the hook (control)' : 'the work in a detached helper';

  const box = makeBrain(null, { files });
  console.log(`brain: ${box.brain} · ${gitIn(box, ['ls-files']).stdout.split('\n').length - 1} files committed · ${what}`);
  const results = [];
  try {
    // First, left alone: how long the hook takes, and that the day's log is committed.
    const calmMs = [];
    for (let i = 0; i < 3; i++) {
      const calm = await trial(box, { n: `calm-${i}`, mode: modes[i % modes.length], kill: 'none', inline, hook });
      console.log(JSON.stringify({ ...calm, out: undefined }));
      calmMs.push(calm.ranMs);
      if (calm.left.length) results.push(calm);
    }
    const to = Math.max(from, askedTo > 0 ? askedTo : Math.round(1.2 * [...calmMs].sort((a, b) => a - b)[1]));
    console.log(`left alone the hook ran ${calmMs.join(', ')} ms · ${runs} runs, stopped between ${from} and ${to} ms${control ? '' : ' or at the hand-over'}`);
    for (let i = 0; i < runs; i++) {
      const delay = !control && i % 4 === 3 ? 'handoff' : runs === 1 ? from : Math.round(from + ((to - from) * i) / (runs - 1));
      const result = await trial(box, { n: i, mode: modes[i % modes.length], kill: kills[Math.floor(i / 4) % kills.length], delay, inline, hook });
      results.push(result);
      console.log(JSON.stringify({ ...result, out: undefined }));
    }
    const atEnd = await settle(box, 60000, plugin || ROOT);
    const closing = await trial(box, { n: 'last', mode: modes[0], kill: 'none', inline, hook });
    const index = results.filter((r) => r.left.some((rel) => rel === '.git/index.lock'));
    const any = results.filter((r) => r.left.length);
    const cut = results.filter((r) => r.killed);
    console.log(`SUMMARY ${plugin ? 'other plugin' : inline ? 'inline' : 'helper'} mode=${modes.join('+')} kill=${kills.join('+')}: ${index.length} of ${results.length} runs left an index.lock`
      + ` (${cut.length} were stopped while the hook ran, ${cut.filter((r) => r.helper).length} of them after it had handed over; ${any.length} left a lock of any kind${any.length ? `: ${any.map((r) => `${r.delay}${typeof r.delay === 'number' ? 'ms' : ''}[${r.left.join(' ')}]`).join(', ')}` : ''})`
      + ` · locks standing at the end: ${atEnd.join(' ') || 'none'} · the day's log is ${closing.committed ? 'committed' : 'NOT committed'} after a last run left alone`);
    process.exitCode = index.length || atEnd.length || !closing.committed ? 1 : 0;
  } finally {
    await settle(box, 20000, plugin || ROOT);
    fs.rmSync(box.dir, { recursive: true, force: true, maxRetries: 5 });
  }
}

if (require.main === module) main().catch((error) => { console.error(error); process.exit(1); });

module.exports = { makeBrain, trial, settle, locks, logCommitted, waitGone, dirtyLog };
