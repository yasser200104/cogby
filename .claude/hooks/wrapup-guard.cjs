#!/usr/bin/env node
'use strict';


// Skills, the identity files, and the brain's own rules file: what tells Cogby who it works for and how.
const PROTECTED = /(^|[\\/])\.claude[\\/]skills[\\/]|(^|[\\/])\.claude[\\/]CLAUDE\.md$|(^|[\\/])(context[\\/])?self[\\/](SOUL|USER)\.md$/i;
const WRITE_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit']);

// Emitted once the guard has run its checks and found nothing to refuse. A bare exit(0) is NOT a
// grant: the CLI reads silence as "no opinion" and falls back to its own permission evaluation,
// which in this `--print --permission-mode auto` child has nobody to ask and therefore refuses.
//
// Granting makes this guard the SOLE gate for the wrap-up child. The deny list below is what stands
// between that child and the owner's other work, so keep it.
function allow(reason) {
  try {
    process.stdout.write(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'allow',
        permissionDecisionReason: String(reason || 'Allowed by the wrap-up guard.'),
      },
    }));
  } catch { /* stdout is gone; exit 0 reads as an abstain, which fails closed */ }
  process.exit(0);
}

function deny(reason) {
  try {
    process.stdout.write(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: reason,
      },
    }));
  } catch { /* stdout is gone; exit 0 is all that is left */ }
  process.exit(0);
}

const PATH_RE = '(?:\\.claude/skills/|\\.claude/CLAUDE\\.md|(?:context/)?self/(?:SOUL|USER)\\.md)';

function segments(command) {
  return String(command || '').split(/\n|&&|\|\||[;|]/).map((s) => s.trim()).filter(Boolean);
}

// A value may be quoted: a brain's folder often has a space in it ("Cogby Brain"), and a rule that
// lost track of `git -C "<such a path>" add -A` would refuse nothing.
const GIT_VALUE = '(?:"[^"]*"|\'[^\']*\'|\\S+)';
const GIT_GLOBALS = '(?:-C\\s+' + GIT_VALUE + '\\s+|-c\\s+' + GIT_VALUE + '\\s+|--\\S+=\\S+\\s+|--\\S+\\s+|-\\S+\\s+)*';
function gitSub(seg, sub) {
  const m = new RegExp(`\\bgit\\s+${GIT_GLOBALS}${sub}\\b(.*)$`, 'i').exec(seg);
  return m ? m[1] : null;
}

function checkBash(command) {
  for (const seg of segments(command)) {
    const add = gitSub(seg, 'add');
    if (add !== null) {
      if (/(^|\s)(-A|--all|--no-ignore-removal)(\s|$)/.test(add)) {
        deny('`git add -A` is refused in an automatic wrap-up: it stages the owner\'s and any peer '
          + 'session\'s uncommitted work as well as this session\'s. Get this session\'s paths from '
          + '`node core/ops/wrapup-scope.cjs --session <id>` and commit them explicitly with '
          + '`git commit -F <message-file> -- <paths>`.');
      }
      if (/(^|\s)(\.|:\/|\*|:!?\S*\*)(\s|$)/.test(add)) {
        deny('`git add .` is refused in an automatic wrap-up, for the same reason as `git add -A`: '
          + 'it stages everything dirty, not this session\'s work. Name the paths from '
          + '`node core/ops/wrapup-scope.cjs --session <id>` instead.');
      }
      const operands = add.split(/\s+/).filter((t) => t && !t.startsWith('-') && t !== '--');
      if (!operands.length) {
        deny('`git add` with no pathspec is refused in an automatic wrap-up. Name the files this '
          + 'session dirtied, from `node core/ops/wrapup-scope.cjs --session <id>`.');
      }
    }

    const commit = gitSub(seg, 'commit');
    if (commit !== null && (/(^|\s)--all(\s|$)/.test(commit) || /(^|\s)-[a-z]*a[a-z]*(\s|$)/.test(commit))) {
      deny('`git commit -a` is refused in an automatic wrap-up: it commits every modified tracked '
        + 'file, including the owner\'s. Use `git commit -F <message-file> -- <paths>` with the '
        + 'paths from `node core/ops/wrapup-scope.cjs --session <id>`.');
    }

    const push = gitSub(seg, 'push');
    if (push !== null && /(^|\s)(--force|--force-with-lease\S*|-f|--mirror|--delete|-d)(\s|=|$)/.test(push)) {
      deny('A force-shaped push is refused in an automatic wrap-up. Push the current branch '
        + 'fast-forward only, or leave the commit local and finish cleanly.');
    }

    const reset = gitSub(seg, 'reset');
    if (reset !== null && /(^|\s)(--hard|--merge|--keep)(\s|$)/.test(reset)) {
      deny('`git reset --hard` is refused in an automatic wrap-up: it destroys uncommitted work '
        + 'that may belong to the owner or to a session still open. Leave the tree dirty — a '
        + 'wrap-up commits its own scope and nothing else.');
    }
    for (const sub of ['checkout', 'restore', 'clean', 'stash']) {
      const rest = gitSub(seg, sub);
      if (rest === null) continue;
      if (sub === 'checkout' && !/(^|\s)--(\s|$)/.test(rest) && !/(^|\s)\.(\s|$)/.test(rest)) continue;
      deny(`\`git ${sub}\` is refused in an automatic wrap-up: it discards or hides uncommitted `
        + 'work that may belong to the owner or to a session still open. A dirty tree is the '
        + 'correct outcome here — commit only this session\'s paths and leave the rest alone.');
    }

    const shellWrite = [
      new RegExp(`>>?\\s*['"]?\\S*${PATH_RE}`, 'i'),
      new RegExp(`\\btee\\b[^\\n]*${PATH_RE}`, 'i'),
      new RegExp(`\\bsed\\b[^\\n]*\\s-i[^\\n]*${PATH_RE}`, 'i'),
      new RegExp(`\\b(cp|mv|rm|truncate|install)\\b[^\\n]*${PATH_RE}`, 'i'),
    ];
    if (shellWrite.some((re) => re.test(seg))) deny(protectedReason());
  }
}

function protectedReason() {
  return 'Refused: an automatic wrap-up may not edit `.claude/skills/**`, `.claude/CLAUDE.md`, `SOUL.md` or `USER.md`. '
    + 'Those are the owner\'s capability and identity files and nobody approved this change. If you '
    + 'found a correction that belongs in a skill\'s `## Rules`, leave it for the owner as a proposal '
    + 'instead, with the notification command your instructions give. Reading these files is fine; '
    + 'writing them is not.';
}

let input = '';
const bail = setTimeout(() => process.exit(0), 5000);
process.stdin.setEncoding('utf8');
process.stdin.on('data', (c) => (input += c));
process.stdin.on('end', () => {
  clearTimeout(bail);
  let payload = {};
  try { payload = JSON.parse(input || '{}'); } catch { process.exit(0); }
  try {
    const tool = String(payload.tool_name || '');
    const args = payload.tool_input || {};
    if (tool === 'Bash') checkBash(args.command);
    if (WRITE_TOOLS.has(tool)) {
      const file = String(args.file_path || args.notebook_path || '');
      if (file && PROTECTED.test(file.replace(/\\/g, '/'))) deny(protectedReason());
    }
  } catch {
    // The checks did not finish, so nothing here has been cleared. Abstain rather than grant:
    // silence hands the decision back to the CLI, which is the safe direction for a call this
    // guard never managed to classify.
    process.exit(0);
  }
  allow('the wrap-up guard found nothing to refuse in this call');
});
