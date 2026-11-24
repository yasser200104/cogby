'use strict';

// Windows resolves a bare command name against the current directory BEFORE PATH.
// Setting this in our own process disables that for every spawn we make, including the
// unresolved fall-through in resolveOnPath below and any module that bypasses this wrapper.
if (process.platform === 'win32') process.env.NoDefaultCurrentDirectoryInExePath = '1';

const fs = require('fs');
const path = require('path');
const child_process = require('child_process');

function withHide(args) {
  const parts = [...args];
  const callback = typeof parts[parts.length - 1] === 'function' ? parts.pop() : null;
  const last = parts[parts.length - 1];
  if (last && typeof last === 'object' && !Array.isArray(last)) {
    parts[parts.length - 1] = { windowsHide: true, ...last };
  } else {
    parts.push({ windowsHide: true });
  }
  if (callback) parts.push(callback);
  return parts;
}


const WINDOWS_METACHARACTERS = /([()\][%!^"`<>&|;, *?])/g;

function envValue(env, name) {
  const source = env && typeof env === 'object' ? env : {};
  if (Object.prototype.hasOwnProperty.call(source, name)) return source[name];
  const wanted = String(name).toLowerCase();
  const key = Object.keys(source).find((candidate) => candidate.toLowerCase() === wanted);
  return key ? source[key] : '';
}

function resolveOnPath(command, env = process.env) {
  const text = String(command);
  if (path.isAbsolute(text) || /[\\/]/.test(text)) return text;
  const declared = String(envValue(env, 'PATHEXT') || '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean);
  const extensions = [...new Set(declared.flatMap((ext) => [ext.toLowerCase(), ext]))];
  const suffixes = extensions.some((ext) => text.toLowerCase().endsWith(ext.toLowerCase()))
    ? ['']
    : extensions;
  for (const dir of String(envValue(env, 'PATH') || '').split(path.delimiter).filter(Boolean)) {
    for (const extension of suffixes) {
      const candidate = path.join(dir, text + extension);
      try { if (fs.statSync(candidate).isFile()) return candidate; } catch { /* next candidate */ }
    }
  }
  return text;      // not on PATH: the bare name is safe to pass through because the guard at the
                    // top of this file stops libuv resolving it against the current directory
}

function systemBinary(rel) {
  if (process.platform !== 'win32') return rel;
  const root = process.env.SystemRoot || process.env.windir
    || path.join(process.env.SystemDrive || 'C:', 'Windows');
  return path.join(root, 'System32', rel);
}

function escapeCommand(value) {
  return String(value).replace(WINDOWS_METACHARACTERS, '^$1');
}

function escapeArgument(value) {
  let text = String(value);
  text = text.replace(/(\\*)"/g, '$1$1\\"');       // CRT: double the backslashes, escape the quote
  text = text.replace(/(\\*)$/, '$1$1');           // CRT: a trailing backslash must not eat the quote
  text = `"${text}"`;
  return text.replace(WINDOWS_METACHARACTERS, '^$1');   // cmd sees the line first: neutralise it
}

function needsShell(command) {
  return /\.(cmd|bat)$/i.test(String(command));
}

function windowsInvocation(args, env = process.env) {
  const parts = [...args];
  const callback = typeof parts[parts.length - 1] === 'function' ? parts.pop() : null;
  const last = parts[parts.length - 1];
  const options = last && typeof last === 'object' && !Array.isArray(last) ? parts.pop() : null;
  const [command, ...rest] = parts;
  const argv = Array.isArray(rest[0]) ? rest[0] : [];
  if (options && options.shell) return { args, changed: false };
  const childEnv = options && options.env ? options.env : env;
  const resolved = resolveOnPath(command, childEnv);
  const rebuild = (file, list, extra) => {
    const next = [file, list, { ...(options || {}), ...(extra || {}) }];
    if (callback) next.push(callback);
    return next;
  };
  if (!needsShell(resolved)) {
    return resolved === command
      ? { args, changed: false }
      : { args: rebuild(resolved, argv), changed: true, resolved };
  }
  const line = [escapeCommand(resolved), ...argv.map(escapeArgument)].join(' ');
  return {
    args: rebuild(envValue(childEnv, 'COMSPEC') || process.env.COMSPEC || 'cmd.exe', ['/d', '/s', '/c', `"${line}"`], { windowsVerbatimArguments: true, detached: false }),
    changed: true,
    resolved,
    line,
  };
}

function wrap(fn, rewrite = false) {
  return function hidden(...args) {
    const call = rewrite && process.platform === 'win32' ? windowsInvocation(args).args : args;
    return fn(...withHide(call));
  };
}

// ---- Process trees ------------------------------------------------------------------------
//
// Ending a process on Windows ends that one process: child.kill() and Node's own `timeout`
// option are both TerminateProcess. What it started keeps running, unless it sat in a
// kill-on-close job, and only a Node or claude.exe parent puts its direct children in one. A
// cmd.exe in the middle, or a shell the agent started detached, is outside it. stopTree is the
// one way Cogby stops a process together with everything below it (backlog M4).

const execFileSyncHidden = wrap(child_process.execFileSync, true);

function parsePsTable(text) {
  const rows = [];
  for (const line of String(text).split('\n')) {
    const m = line.match(/^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(.*)$/);
    if (m) rows.push({ pid: +m[1], ppid: +m[2], etimes: +m[3], rssKb: +m[4], args: m[5] });
  }
  return rows;
}

function psRowsWin() {
  const script =
    'Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,CommandLine,' +
    '@{n="RssKb";e={[int]($_.WorkingSetSize/1kb)}},' +
    '@{n="AgeS";e={try{[int]((Get-Date)-$_.CreationDate).TotalSeconds}catch{0}}} | ' +
    'ConvertTo-Json -Compress';
  const out = execFileSyncHidden(systemBinary('WindowsPowerShell/v1.0/powershell.exe'),
    ['-NoProfile', '-NonInteractive', '-Command', script],
    { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, timeout: 30000 });
  let parsed;
  try { parsed = JSON.parse(out || '[]'); } catch { return []; }
  const rows = [];
  for (const p of Array.isArray(parsed) ? parsed : [parsed]) {
    if (!p || !p.ProcessId) continue;
    rows.push({
      pid: +p.ProcessId, ppid: +p.ParentProcessId || 0, etimes: +p.AgeS || 0,
      rssKb: +p.RssKb || 0, args: String(p.CommandLine || ''),
    });
  }
  return rows;
}

// Every process on the machine: pid, parent pid, age in seconds, resident KB, command line.
function psRows() {
  if (process.platform === 'win32') return psRowsWin();
  return parsePsTable(execFileSyncHidden('ps', ['-eo', 'pid=,ppid=,etimes=,rss=,args='],
    { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, timeout: 30000 }));
}

// rootPid and every process below it, parents before their children, found by parent pid.
function treeOf(rows, rootPid) {
  const kids = new Map();
  for (const r of rows) {
    if (!kids.has(r.ppid)) kids.set(r.ppid, []);
    kids.get(r.ppid).push(r.pid);
  }
  const out = [];
  const seen = new Set();
  const walk = (p) => {
    if (seen.has(p)) return;
    seen.add(p);
    out.push(p);
    for (const c of kids.get(p) || []) walk(c);
  };
  walk(rootPid);
  return out;
}

function isAlive(pid) {
  try { process.kill(pid, 0); return true; } catch (error) { return !!(error && error.code === 'EPERM'); }
}

// The dependencies are injectable so the POSIX branch can be tested on a Windows box, and the
// Windows one anywhere: platform, kill(pid, signal), alive(pid), rows() and taskkill(pid).
function treeStopper(deps = {}) {
  const platform = deps.platform || process.platform;
  const kill = deps.kill || ((pid, sig) => process.kill(pid, sig));
  const alive = deps.alive || isAlive;
  const rows = deps.rows || psRows;
  const self = deps.self || process.pid;
  const taskkill = deps.taskkill || ((pid) => child_process.spawnSync(systemBinary('taskkill.exe'),
    ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true, timeout: 30000 }));
  const sleep = deps.sleep || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));

  const walk = (pid) => { try { return treeOf(rows(), pid); } catch { return []; } };
  const signal = (pid, sig) => {
    if (pid === self) return;
    try { kill(pid, sig); } catch { /* gone, or no such group */ }
  };
  const endEach = (pids) => { for (const p of [...pids].reverse()) signal(p, 'SIGKILL'); };

  function force(pid, snapshot) {
    if (platform === 'win32') {
      if (!alive(pid)) return 'gone';
      const r = taskkill(pid);
      // Exit 0 means every process in the tree was ended; a liveness check alone can race the
      // termination, which Windows completes after TerminateProcess returns.
      if (r && !r.error && (r.status === 0 || !alive(pid))) return 'taskkill';
      endEach(walk(pid));        // taskkill missing, or the root outlived it: end what the walk finds
      return 'walk';
    }
    const found = alive(pid) ? walk(pid) : [];
    signal(-pid, 'SIGKILL');     // the group, when the root leads one; nothing when it does not
    endEach([...new Set([...found, ...snapshot])].filter(alive));
    return 'group+walk';
  }

  // target: a ChildProcess, or a pid when that is all the caller has (the task Stop button reads
  // run.pid). graceMs: how long the gentle stop gets before the force, POSIX only.
  return async function stopTree(target, { graceMs = 0, gentleSignal = 'SIGTERM' } = {}) {
    const child = target && typeof target === 'object' ? target : null;
    // A pid read off an object that is not a ChildProcess is no proof of a process Cogby started
    // (a test double's made-up pid can be a live stranger), so such an object is only asked to
    // end itself.
    if (child && !(child instanceof child_process.ChildProcess) && !deps.trustObjects) {
      if (typeof child.kill === 'function') { try { child.kill('SIGKILL'); } catch { /* already gone */ } }
      return { pid: Number(child.pid) || 0, method: 'direct' };
    }
    const pid = Number(child ? child.pid : target);
    if (!Number.isInteger(pid) || pid <= 0 || pid === self || !alive(pid)) return { pid: pid || 0, method: 'none' };
    if (child && child.stdin && !child.stdin.destroyed) {
      try { child.stdin.end(); } catch { /* already closed */ }   // a stream-json claude exits on EOF
    }
    // Windows has no gentle signal for a process without a console, and waiting would let the
    // root die first and cut the parent-pid chain taskkill walks. So there the force is at once.
    let snapshot = [];
    if (platform !== 'win32' && graceMs > 0) {
      // A group signal misses whatever started a session of its own: the agent's shell, or the
      // child `script` puts on a pty. The walk reaches those, and is taken while the tree is whole.
      snapshot = walk(pid);
      signal(-pid, gentleSignal);
      for (const p of snapshot) signal(p, gentleSignal);
      for (const until = Date.now() + graceMs; Date.now() < until;) {
        if (!alive(pid) && !snapshot.some(alive)) break;
        await sleep(100);
      }
    }
    const method = force(pid, snapshot);
    if (child && alive(pid)) { try { child.kill('SIGKILL'); } catch { /* already gone */ } }
    return { pid, method };
  };
}

const stopTree = treeStopper();

// spawnSync whose `timeout` stops the whole tree. spawnSync cannot do it itself: it blocks this
// event loop, and its own timeout ends only the process it started. So it starts tree-runner.cjs,
// which runs the command, stops its tree at the deadline and reports on fd 3. Same result shape
// as spawnSync, including error.code 'ETIMEDOUT' and 'ENOENT'. Costs one Node start per call.
const TREE_RUNNER = path.join(__dirname, 'tree-runner.cjs');
const RUNNER_SLACK_MS = 15000;

function spawnSyncTree(command, args = [], options = {}) {
  const { timeout, ...rest } = options;
  if (!(Number(timeout) > 0)) return module.exports.spawnSync(command, args, rest);
  const given = rest.stdio;
  const stdio = Array.isArray(given) ? given.slice(0, 3) : [given || 'pipe', given || 'pipe', given || 'pipe'];
  while (stdio.length < 3) stdio.push('pipe');
  const spec = JSON.stringify({ command: String(command), args: args.map(String), timeoutMs: Number(timeout) });
  const r = module.exports.spawnSync(process.execPath, [TREE_RUNNER, spec],
    { ...rest, stdio: [...stdio, 'pipe'], timeout: Number(timeout) + RUNNER_SLACK_MS });
  let report = {};
  try { report = JSON.parse(String((r.output && r.output[3]) || '').trim() || '{}'); } catch { /* the runner died */ }
  const out = { ...r, pid: report.pid || 0, output: [null, r.stdout, r.stderr] };
  if (report.timedOut) {
    return { ...out, status: null, signal: 'SIGTERM',
      error: Object.assign(new Error(`spawnSync ${command} ETIMEDOUT`), { code: 'ETIMEDOUT', path: String(command) }) };
  }
  if (report.error) {
    return { ...out, status: null, signal: null,
      error: Object.assign(new Error(report.error.message), { code: report.error.code, path: String(command) }) };
  }
  if (Object.prototype.hasOwnProperty.call(report, 'status')) {
    return { ...out, status: report.status, signal: report.signal || null, error: undefined };
  }
  return out;
}

module.exports = {
  spawn: wrap(child_process.spawn, true),
  spawnSync: wrap(child_process.spawnSync, true),
  execFile: wrap(child_process.execFile, true),
  execFileSync: wrap(child_process.execFileSync, true),
  exec: wrap(child_process.exec),
  execSync: wrap(child_process.execSync),
  fork: wrap(child_process.fork),
  withHide, windowsInvocation, needsShell, resolveOnPath, systemBinary, escapeCommand, escapeArgument, envValue,
  stopTree, treeStopper, psRows, treeOf, parsePsTable, isAlive, spawnSyncTree,
};
