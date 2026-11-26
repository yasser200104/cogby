'use strict';

// `cogby project status <name> <status>`: the one thing about a project the owner changes from My
// view (owner, 2026-11-25: "I can change their status from the view").
//
// A project's status is the `status:` line at the top of its card: planning, active, on-hold, done,
// or a word of the owner's own. A card with no such line is active. The change and the line that
// records it are one write, as for a routine: the old status stays in the timeline, so nothing a
// project used to be is lost. The line is a record of a command the owner chose, not a claim.

const { BrainError } = require('./db.cjs');
const brainLib = require('./brain.cjs');
const page = require('./page.cjs');

const STATUSES = ['planning', 'active', 'on-hold', 'done'];
const write = () => require('./write.cjs');
const pad = (n) => String(n).padStart(2, '0');
const isoDay = (date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
const nameOf = (ref) => page.oneLine(String(ref || '')).toLowerCase().replace(/\\/g, '/').replace(/\.md$/, '').replace(/\/card$/, '').replace(/^projects\//, '').replace(/\/+$/, '');
// A status as the card holds it: lower case, words joined by a dash, 40 characters at most.
const wordOf = (value) => page.oneLine(String(value || '')).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);

function setStatus(brain, ref, status, options = {}) {
  const name = nameOf(ref);
  const next = wordOf(status);
  if (!name || name.includes('/')) throw new BrainError('USAGE', `"${ref || ''}" is not a project's name.`, 'cogby project status <name> <planning|active|on-hold|done>');
  if (!next) throw new BrainError('USAGE', 'Name the status.', `Use one of: ${STATUSES.join(', ')}.`);
  const slug = `projects/${name}/card`;
  const exists = brainLib.withIndex(brain, (db) => { const row = brainLib.lookup(db, slug, { source: 'brain' }); return !!row && row.source_id === 'brain'; });
  if (!exists) throw new BrainError('NOT_FOUND', `No project "${name}".`, '`cogby map` lists the projects.');
  const source = page.oneLine(String(options.source || '')).slice(0, 120) || 'cogby project status';
  const by = write().recorder(brain, options);
  const date = isoDay(new Date());
  const written = write().writePage(brain, slug, (parsed) => {
    const was = wordOf((parsed.frontmatter || {}).status) || 'active';
    if (was === next) return { changed: false, status: 'unchanged', project: name, was, now: next };
    parsed.fmRaw = page.setField(parsed.fmRaw, 'status', next);
    parsed.timelineText = page.insertTimelineLine(parsed.timelineText, page.renderTimelineLine({ date, source, summary: `status: ${was} → ${next}`, ...by }), date);
    parsed.hasMarker = true;
    return { changed: true, status: 'changed', project: name, was, now: next, message: `project status: ${name} ${was} -> ${next}` };
  }, { env: options.env, by });
  return { ...written, action: 'status' };
}

module.exports = { setStatus, STATUSES };
