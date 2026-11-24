'use strict';

// The file to start for a headless `claude`, for a caller that must outlive itself.
//
// On Windows `claude` on the PATH is usually npm's claude.cmd, and a .cmd has to run through
// cmd.exe: a child started that way dies when its parent exits, which is exactly when the
// session-end hook needs it to live (measured 2026-11-10: every automatic wrap-up on Windows ended
// with an empty log). The package ships the real claude.exe beside the shim, and that one, started
// directly and detached, survives.
//
// Small on purpose and free of the runtime: the brain plugin ships this and none of core/runtime.
// The Console's own lookup (core/runtime/providers/claude-auth.cjs claudeArgv) knows more places
// and stays where it is.

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('./spawn.cjs');

const PACKAGED = ['node_modules', '@anthropic-ai', 'claude-code', 'bin', 'claude.exe'];

// The real executable behind each shim on the PATH, in PATH order.
function packagedBeside(hits = []) {
  return hits.filter((hit) => /\.(cmd|bat|ps1)$/i.test(String(hit))).map((hit) => path.join(path.dirname(hit), ...PACKAGED));
}

function claudeBinary(env = process.env, io = {}) {
  if (env.BRAIN_CLAUDE_BIN) return env.BRAIN_CLAUDE_BIN;
  const platform = io.platform || process.platform;
  if (platform !== 'win32') return 'claude';
  const exists = io.exists || ((file) => { try { return fs.statSync(file).isFile(); } catch { return false; } });
  let hits = io.hits;
  if (!hits) {
    const probe = spawnSync('where', ['claude'], { env, encoding: 'utf8' });
    hits = !probe.error && probe.status === 0 ? String(probe.stdout || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean) : [];
  }
  const exe = hits.find((hit) => /\.exe$/i.test(hit));
  if (exe) return exe;
  return packagedBeside(hits).find(exists) || 'claude';
}

module.exports = { claudeBinary, packagedBeside };
