'use strict';

// A brain's AGENTS.md is the plugin's file: the rules for working in a brain, copied in when the
// brain is made, with a first line naming the version they came from. This is what keeps it the
// plugin's. When a session starts in or for a brain, `follow` looks at that file
// (core/lib/brain-harness.cjs agentsStatus) and:
//
//   - replaces it with the plugin's own when it came from an older version and is as Cogby wrote
//     it, or is missing; the file is committed alone, in the brain, like every other write here;
//   - leaves it alone when the versions match, or when the brain was last opened by a newer plugin;
//   - leaves it alone when it was edited by hand, or is the owner's own file with no generated
//     header, and says so once: which file and plugin version it said it about is kept in
//     .cogby/local.json, so the next session start is quiet until one of the two changes.
//
// A brain's own rules live in .claude/CLAUDE.md, which nothing here reads or writes.
//
// Returns { state, line, commit }: `line` is the one sentence for the session-start text, or ''.
// Never throws: a session start is not failed by this.

const brainLib = require('./brain.cjs');
const harness = require('../lib/brain-harness.cjs');

const OWN_RULES = 'A brain\'s own rules go in .claude/CLAUDE.md.';
const TAKE_THEM = 'To take the plugin\'s rules, move what you added to .claude/CLAUDE.md and delete AGENTS.md: the next session start writes the current one.';

function follow(brain, options = {}) {
  try {
    const status = harness.agentsStatus(brain, options);
    if (status.state === 'older' || status.state === 'missing') return replace(brain, status, options);
    if (status.state === 'edited' || status.state === 'owner') return sayOnce(brain, status);
    return { state: status.state, line: '', commit: null };
  } catch { return { state: 'error', line: '', commit: null }; }
}

function replace(brain, status, options) {
  const write = require('./write.cjs');
  return write.withLock(brain, () => {
    // Read again under the lock: another session starting at the same moment may have done it.
    const now = harness.agentsStatus(brain, options);
    if (now.state !== 'older' && now.state !== 'missing') return { state: now.state, line: '', commit: null };
    const written = harness.writeAgents(brain, options);
    if (!written.written) return { state: now.state, line: '', commit: null };
    const what = now.state === 'missing' ? `Cogby ${now.to}: AGENTS.md, the plugin's rules (the brain had none)`
      : `Cogby ${now.to}: AGENTS.md follows the plugin (was ${now.from})`;
    const commit = write.commitFile(brain, 'AGENTS.md', what);
    const saved = commit.committed ? `committed (${commit.sha})` : `not committed: ${commit.why}`;
    const line = now.state === 'missing'
      ? `Cogby's rules for this brain (AGENTS.md) were missing and were written again from the plugin, version ${now.to}; ${saved}. ${OWN_RULES}`
      : `Cogby's rules for this brain (AGENTS.md) were updated from version ${now.from} to ${now.to}, the plugin's own; ${saved}. ${OWN_RULES}`;
    return { state: 'updated', from: now.from, to: now.to, line, commit };
  });
}

// Said once for this file as it is and this plugin version; a later edit or a later plugin says it again.
function sayOnce(brain, status) {
  const local = brainLib.readLocal(brain);
  const said = local.agents_notice && typeof local.agents_notice === 'object' ? local.agents_notice : {};
  if (said.hash === status.hash && said.to === status.to) return { state: status.state, line: '', commit: null };
  local.agents_notice = { hash: status.hash, to: status.to, state: status.state, at: new Date().toISOString() };
  brainLib.writeLocal(brain, local);
  const line = status.state === 'owner'
    ? `AGENTS.md in this brain is not the one Cogby writes (it has no generated first line), so it was left as it is; the plugin's rules are at version ${status.to}. Tell the owner once. ${TAKE_THEM}`
    : `AGENTS.md in this brain came from Cogby ${status.from} and was edited by hand since, so it was left as it is; the plugin's rules are at version ${status.to}. Tell the owner once. ${TAKE_THEM}`;
  return { state: status.state, from: status.from, to: status.to, line, commit: null };
}

// ---- the map file older brains hold ------------------------------------------------------------
//
// Until 0.3.2 a brain kept `.cogby/context-index.md`, a generated map of its folders. Nothing writes
// it any more: `cogby map` prints the map from the index. A brain that has the file keeps it, because
// nothing is deleted, but a map that is no longer updated must not be read as current: the brain's
// own SOUL.md, and an AGENTS.md the owner edited, may still send a session to it. So the first
// session start after the update puts one note under its title, saying it stopped being updated and
// what to run instead, and commits that one file. Only a file Cogby generated is touched, and once.

const MAP_FILE = ['.cogby', 'context-index.md'];
const MAP_GENERATED = '<!-- generated by core/lib/context-index.cjs -->';
const MAP_RETIRED = '<!-- retired: cogby map -->';

function retireMapFile(brain) {
  const none = (state) => ({ state, line: '', commit: null });
  try {
    const fs = require('fs');
    const path = require('path');
    const file = path.join(brain, ...MAP_FILE);
    const state = (text) => (text == null ? 'none' : text.includes(MAP_RETIRED) ? 'retired' : text.includes(MAP_GENERATED) ? 'generated' : 'owner');
    const read = () => { try { return fs.readFileSync(file, 'utf8'); } catch { return null; } };
    const before = state(read());
    if (before !== 'generated') return none(before);
    const write = require('./write.cjs');
    return write.withLock(brain, () => {
      const text = read();
      if (state(text) !== 'generated') return none(state(text));
      const eol = text.includes('\r\n') ? '\r\n' : '\n';
      const now = new Date();
      const day = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
      const note = [MAP_RETIRED,
        `> This file is no longer updated. \`cogby map\` prints the current map. What is below is the map as it was on ${day}, kept for the record.`,
        ''].join(eol);
      const lines = text.split(/\r?\n/);
      const h1 = lines.findIndex((l) => /^#\s/.test(l));
      // Under the title and the blank line after it, or at the very top when there is no title.
      const at = h1 < 0 ? 0 : h1 + (lines[h1 + 1] !== undefined && !lines[h1 + 1].trim() ? 2 : 1);
      const next = [...lines.slice(0, at), ...(h1 >= 0 && at === h1 + 1 ? [''] : []), ...note.split(eol), ...lines.slice(at)].join(eol);
      const tmp = `${file}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, next, 'utf8');
      fs.renameSync(tmp, file);
      const rel = MAP_FILE.join('/');
      const commit = write.commitFile(brain, rel, 'Cogby: context-index.md is no longer updated (`cogby map` prints the map)');
      const saved = commit.committed ? `committed (${commit.sha})` : `not committed: ${commit.why}`;
      return {
        state: 'noted', commit,
        line: `The map file of this brain (${rel}) is no longer updated: \`cogby map\` prints the map of the brain from the index. The file was kept, with a note at its top saying so; ${saved}. Do not read it as the current map.`,
      };
    });
  } catch { return none('error'); }
}

module.exports = { follow, retireMapFile };
