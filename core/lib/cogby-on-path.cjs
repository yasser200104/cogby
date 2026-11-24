'use strict';

// Which `cogby` a shell will run, and whether it is this plugin's.
//
// Claude Code puts the plugin's bin/ on the PATH of its shells, after what the PATH already holds.
// An older global install, such as the npm package @cogby/cli (0.1.x), therefore comes first, and
// every `cogby` a session runs goes to it: "Unknown command: wrapup", "Unknown command: help"
// (seen 2026-11-15 on Windows, during setup). Nothing failed loudly; the session only went on
// because it happened to run the plugin's file by its full path.
//
// This walks the PATH as a shell would, stops at the plugin's own bin/ (anything after it is
// shadowed by the plugin and harmless), and names the first other `cogby` before it, with the npm
// package behind it when there is one, so the person gets the exact command that removes it. It
// reads file names and, for a shim, the shim's few lines; it runs nothing.

const fs = require('fs');
const path = require('path');

const isFile = (file) => { try { return fs.statSync(file).isFile(); } catch { return false; } };
const real = (file) => { try { return fs.realpathSync(file); } catch { return path.resolve(file); } };
const same = (a, b, win) => (win ? a.toLowerCase() === b.toLowerCase() : a === b);

// The npm package a global shim starts, e.g. "@cogby/cli", or null.
function packageOf(file) {
  const fromPath = (text) => {
    const match = /node_modules[\\/]+((?:@[\w.-]+[\\/]+)?[\w.-]+)/.exec(text);
    return match ? match[1].replace(/\\/g, '/') : null;
  };
  const resolved = fromPath(real(file));
  if (resolved) return resolved;
  try {
    if (fs.statSync(file).size > 64 * 1024) return null;
    return fromPath(fs.readFileSync(file, 'utf8'));
  } catch { return null; }
}

// { file, package, command } for the first `cogby` on PATH that is not in `bin`, before `bin`; else null.
function foreignCogby({ bin, env = process.env, platform = process.platform } = {}) {
  const win = platform === 'win32';
  const own = real(bin);
  const names = win ? ['cogby.exe', 'cogby.cmd', 'cogby.bat', 'cogby.ps1', 'cogby'] : ['cogby'];
  const dirs = String(env.PATH || env.Path || '').split(win ? ';' : ':').map((dir) => dir.trim().replace(/^"(.*)"$/, '$1')).filter(Boolean);
  for (const dir of dirs) {
    if (same(real(dir), own, win)) return null;
    for (const name of names) {
      const file = path.join(dir, name);
      if (!isFile(file)) continue;
      if (same(path.dirname(real(file)), own, win)) return null;
      const pkg = packageOf(file);
      return { file, package: pkg, command: pkg ? `npm uninstall -g ${pkg}` : null };
    }
  }
  return null;
}

// The one line a session start says about it, or ''.
function shadowLine(found, bin) {
  if (!found) return '';
  const how = found.command
    ? `Tell the owner once, with the exact command: \`${found.command}\` removes it.`
    : 'Tell the owner once: removing it, or putting it after the plugin on PATH, fixes it.';
  return `\`cogby\` in this shell is not this plugin's: ${found.file}${found.package ? ` (npm package ${found.package})` : ''} comes first on PATH. `
    + `Run the brain's commands as \`node "${path.join(bin, 'cogby')}" <command>\`, never bare \`cogby\`. ${how}`;
}

module.exports = { foreignCogby, packageOf, shadowLine };
