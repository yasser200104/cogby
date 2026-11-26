#!/usr/bin/env node
'use strict';

// SessionStart: what Cogby has to say when a session opens. The plugin's one session-start hook.
//
//   in a brain            the look-first rule, what the brain last learned (`cogby context`), what
//                         waits on the owner, and where Cogby's scripts are. It also records the
//                         snapshot the wrap-up commit is scoped against.
//   in a linked place     by its role: a code repo, a workspace or an environment opens on its page
//                         (current truth, open to-dos, parking spot, the write rule); a reference
//                         or scratch folder gets the two lines below and one naming the place
//   anywhere else         which brain is the person's, what was last parked there, where the scripts
//                         are, and what this folder is to the brain: marked "not a brain project", or
//                         not in the brain, with the instruction to ask the owner whether to save it
//                         (the first session in a git repository, the second anywhere else, twice at
//                         most, never under `cogby proactive quiet`)
//   no brain at all       one line, on a fresh start only: Cogby is installed, and how to make a brain
//
// Wherever it speaks, one line names this copy's version and folder (core/lib/version.cjs): a
// computer can hold more than one Cogby, and the onboarding hello ends on the version.
//
// It reads the brain's index when there is one and its files when there is not, and never makes an
// index itself: a session starting is not what decides that. It writes two things: this machine's
// count of sessions per unlinked folder, in .cogby/local.json, and the brain's AGENTS.md when the
// plugin has been updated since that file was written (core/brain/rules.cjs: the plugin's own file,
// replaced and committed alone, and said in one line here). Once, in a brain that still holds the
// generated map file `.cogby/context-index.md`, it also puts a note at the top of that file saying it
// is no longer updated (same module). Never fails a session: on any error it is silent.

const path = require('path');

const ENGINE = path.resolve(__dirname, '..', '..');
const NO_BRAIN = 'Cogby is installed and you have no brain yet. Type /cogby:onboarding to start (or say "set up my brain").';

let payload = {};
try { payload = JSON.parse(require('fs').readFileSync(0, 'utf8') || '{}'); } catch { /* no payload: treat as a start */ }

// The wrap-up commit is scoped to what this session dirtied, worked out against a snapshot of the
// brain taken now. A session that will not be wrapped up needs none. The snapshot is a `git status`
// that takes no index lock (wrapup-scope.cjs dirtyPaths): this hook can be stopped at any moment.
function recordBaseline(brain) {
  try {
    if (!require('../../core/lib/headless.cjs').flagsFrom(process.env).wrapup) return;
    require('../../core/lib/wrapup-scope.cjs').recordBaseline(brain, String(payload.session_id || '').trim());
  } catch { /* a session start never fails on this */ }
}

// The skills name Cogby's scripts as `node core/ops/<x>.cjs`: the script's name, not a path from the
// folder the session is in. This is the one line that says where they are, and where the brain's
// commands are, by full path too: a `cogby` found first on PATH may be an old global install, and
// then the line after this one says so (core/lib/cogby-on-path.cjs).
function scriptsLine() {
  const ops = path.join(ENGINE, 'core', 'ops');
  const bin = path.join(ENGINE, 'bin');
  let shadow = '';
  try {
    const onPath = require('../../core/lib/cogby-on-path.cjs');
    shadow = onPath.shadowLine(onPath.foreignCogby({ bin }), bin);
  } catch { /* never fails a session */ }
  return 'Cogby\'s scripts: where a skill says `node core/ops/<x>.cjs`, run `node "' + ops + path.sep + '<x>.cjs"`. '
    + (shadow
      ? `The brain's commands: \`node "${path.join(bin, 'cogby')}" <command>\`.\n${shadow}`
      : `The brain's commands are also \`cogby <command>\` in this shell, or \`node "${path.join(bin, 'cogby')}" <command>\` anywhere (\`cogby help\`).`);
}

// Which Cogby this is, from its own plugin.json, and where it runs from. Nothing when the manifest
// cannot be read.
function versionLine() {
  try {
    const version = require('../../core/lib/version.cjs').pluginVersion(ENGINE);
    return version ? `This is Cogby version ${version}, from "${ENGINE}".` : '';
  } catch { return ''; }
}

// What waits on the owner, in one line, so a session opens knowing it without a tool call.
function waitingLine(brain) {
  try {
    const listed = require('../../core/brain/todo.cjs').listTodos(brain, {});
    const notified = require('../../core/brain/notify.cjs').list(brain, {});
    // A store that cannot be read is said, never counted as empty.
    const broken = [listed.unreadable, notified.unreadable].filter(Boolean).map((entry) => entry.file);
    if (broken.length) return `Cannot read ${broken.join(' or ')}: what waits on the owner is unknown, and nothing is written there until the file is repaired. Say so.`;
    const todos = listed.todos || [];
    const waiting = notified.notifications || [];
    if (!todos.length && !waiting.length) return '';
    const now = new Date();
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const overdue = todos.filter((todo) => todo.due && todo.due < today).length;
    const plural = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`;
    return `Waiting on the owner: ${plural(todos.length, 'open to-do')}${overdue ? ` (${overdue} overdue)` : ''}, `
      + `${plural(waiting.length, 'notification')}. Tools: todo, notify.`;
  } catch { return ''; }
}

try {
  const brainLib = require('../../core/brain/brain.cjs');
  const cwd = process.env.CLAUDE_PROJECT_DIR || payload.cwd || process.cwd();
  let brain = null;
  try { brain = brainLib.findBrain({ cwd }); } catch { /* none */ }
  if (!brain) {
    // Once, when the session begins: not again on resume, clear or compaction.
    // The scripts line goes with it: onboarding runs them before any brain exists to say where they are.
    // So does the version: the hello's last line says it.
    if (!payload.source || payload.source === 'startup') process.stdout.write(`${[NO_BRAIN, versionLine(), scriptsLine()].filter(Boolean).join('\n')}\n`);
  } else {
    const inside = brainLib.isInside(cwd, brain);
    if (inside) recordBaseline(brain);
    const { context } = require('../../core/brain/context.cjs');
    // A start, not a resume, a clear or a compaction, is what counts as a session in this folder.
    const sessionStart = !inside && (!payload.source || payload.source === 'startup');
    const lines = [context(brain, { cwd, create: false, brief: !inside, sessionStart }).text];
    // The brain's rules follow the plugin: said only when the file was replaced, or once when it was
    // edited by hand and left alone.
    let rules = '';
    try { rules = require('../../core/brain/rules.cjs').follow(brain, { engine: ENGINE }).line; } catch { /* never fails a session */ }
    if (rules) lines.push(...(inside ? ['', rules] : [rules]));
    // A brain from before `cogby map` holds a generated map file: kept, marked once as no longer updated.
    let oldMap = '';
    try { oldMap = require('../../core/brain/rules.cjs').retireMapFile(brain).line; } catch { /* never fails a session */ }
    if (oldMap) lines.push(...(inside ? ['', oldMap] : [oldMap]));
    const waiting = waitingLine(brain);
    if (waiting) lines.push(...(inside ? ['', waiting] : [waiting]));
    const version = versionLine();
    lines.push(...(inside ? [''] : []), ...(version ? [version] : []), scriptsLine());
    // The wrap-up skill scopes its commit to this session, and a model is not told its own id.
    const session = String(payload.session_id || '').trim();
    if (inside && /^[A-Za-z0-9._-]{1,120}$/.test(session)) lines.push(`This session's id is ${session}: the wrap-up skill scopes its commit with it.`);
    process.stdout.write(`${lines.join('\n')}\n`);
  }
} catch { /* a Node without SQLite, or a brain that cannot be read: nothing to add */ }
