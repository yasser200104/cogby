#!/usr/bin/env node
'use strict';


const scope = require('../lib/wrapup-scope.cjs');
const { rootsFrom } = require('../lib/locate.cjs');

function flag(argv, name) {
  const i = argv.indexOf(name);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : null;
}

function main(argv) {
  // The baseline and the git status it is compared against are both the brain's; `--root` still
  // names the tree to answer for, ahead of the session's own.
  //
  // What is printed: the paths this session dirtied, and with them the brain's shared working state
  // whenever it has changed (the to-do, note and notification stores, the day's log), which every
  // session writes and no one session owns (core/lib/wrapup-scope.cjs sharedPaths).
  const root = rootsFrom(flag(argv, '--root') || process.env.CLAUDE_PROJECT_DIR || process.cwd()).brain;

  if (argv.includes('--set-mode')) {
    process.stdout.write(scope.setMode(root, flag(argv, '--set-mode')) + '\n');
    return 0;
  }
  if (argv.includes('--mode')) {
    process.stdout.write(scope.readMode(root) + '\n');
    return 0;
  }
  if (argv.includes('--record-baseline')) {
    const file = scope.recordBaseline(root, flag(argv, '--session'), { force: argv.includes('--force') });
    process.stdout.write((file || '(not recorded)') + '\n');
    return file ? 0 : 3;
  }

  const sessionId = flag(argv, '--session');
  if (!sessionId) {
    process.stderr.write('usage: wrapup-scope.cjs --session <id> [--json] | --mode | --set-mode <m>\n');
    return 2;
  }
  const result = scope.scopeFor(root, sessionId);
  if (argv.includes('--json')) {
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  } else if (result.baseline === 'missing') {
    // What is printed is still certain: the brain's shared stores and the day's log, in scope for
    // any wrap-up. What this session itself dirtied beyond them is what is not known.
    for (const p of result.shared || []) process.stdout.write(p + '\n');
    process.stderr.write(
      'no session baseline: the scope of this session is UNKNOWN, not empty. ' +
      'Fall back to reviewing `git status` by hand and say so in the commit message.' +
      ((result.shared || []).length ? ' The paths printed are the brain\'s shared to-dos, notes, notifications and day\'s log: commit those too.' : '') + '\n');
  } else {
    for (const p of result.paths) process.stdout.write(p + '\n');
  }
  return result.baseline === 'missing' ? 3 : 0;
}

if (require.main === module) {
  try { process.exit(main(process.argv.slice(2))); }
  catch (e) { process.stderr.write(String((e && e.message) || e) + '\n'); process.exit(1); }
}

module.exports = { main };
