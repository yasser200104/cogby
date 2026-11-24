'use strict';

// `cogby map`: what the brain holds, one line per entry. Every project, area, resource and archive
// entry, read from the index as it is: no file is walked and nothing is written. It replaces the
// generated `.cogby/context-index.md`, which had to be rebuilt after every change and was a second
// copy of what the index already knows.
//
// An entry is what sits directly under one of the four folders: a folder (`projects/acme/`) or a
// single file (`resources/pricing.md`). A folder's line is the first sentence under its card's
// title; a file's line is its title. Only what the index holds is listed, so a folder with no
// markdown or text in it is not here, as it is not in a search.

const brainLib = require('./brain.cjs');
const { cardSummary, CONTAINER_AREAS } = require('../lib/card-summary.cjs');

const BUCKETS = Object.freeze([
  ['projects', 'Projects', 'active work with an outcome and an end'],
  ['areas', 'Areas', 'standing responsibilities'],
  ['resources', 'Resources', 'reference material, found by search'],
  ['archive', 'Archive', 'done or inactive, kept for the record'],
]);
const NAMES = new Set(BUCKETS.map(([name]) => name));

const frontmatterOf = (row) => { try { return JSON.parse(row.frontmatter) || {}; } catch { return {}; } };
const text = (value) => (typeof value === 'string' && value.trim() ? value.trim() : null);

function map(brain) {
  return brainLib.withIndex(brain, (db, stats) => {
    const drafts = new Map(BUCKETS.map(([name]) => [name, new Map()]));
    for (const row of db.prepare("SELECT slug, path, title, truth, frontmatter FROM pages WHERE source_id = 'brain' ORDER BY path").all()) {
      const parts = row.path.split('/');
      const bucket = parts[0].toLowerCase();
      if (!NAMES.has(bucket) || parts.length < 2 || parts[1].startsWith('_')) continue;
      const folder = parts.length > 2;
      const key = `${folder ? 'd' : 'f'}:${parts[1].toLowerCase()}`;
      const entries = drafts.get(bucket);
      if (!entries.has(key)) entries.set(key, { name: parts[1], folder, pages: 0, card: null, readme: null, file: folder ? null : row });
      const draft = entries.get(key);
      draft.pages++;
      if (folder && parts.length === 3 && /^card\.(md|markdown)$/i.test(parts[2])) draft.card = row;
      if (folder && parts.length === 3 && /^readme\.(md|markdown)$/i.test(parts[2])) draft.readme = row;
    }

    const out = { brain, index: stats.index, index_as_of: stats.synced_at || null, ...(stats.background ? { background_sync: stats.background } : {}), counts: {} };
    for (const [bucket] of BUCKETS) {
      out[bucket] = [...drafts.get(bucket).values()]
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((draft) => entry(bucket, draft));
      out.counts[bucket] = out[bucket].length;
    }
    return out;
  });
}

function entry(bucket, draft) {
  const main = draft.card || draft.readme || draft.file;
  const fm = draft.card ? frontmatterOf(draft.card) : {};
  const container = draft.folder && bucket === 'areas' && CONTAINER_AREAS.has(draft.name.toLowerCase());
  const line = !draft.folder ? draft.file.title : draft.card ? cardSummary(draft.card.truth) : draft.readme ? draft.readme.title : null;
  const out = {
    name: draft.folder ? `${draft.name}/` : draft.name,
    kind: draft.folder ? 'folder' : 'file',
    // The page to read for this entry (`cogby get <page>`): its card, else its README, else the file itself.
    page: main ? main.slug : null,
    title: main ? main.title : null,
    line: line || null,
    pages: draft.pages,
  };
  if (draft.folder) out.card = !!draft.card;
  if (container) out.container = true;
  if (bucket === 'projects' && text(fm.parent)) out.parent = text(fm.parent);
  if (bucket === 'projects' && text(fm.status) && text(fm.status) !== 'active') out.status = text(fm.status);
  if (bucket === 'areas' && text(fm['last-reviewed'])) out.reviewed = text(fm['last-reviewed']);
  if (bucket === 'archive' && text(fm.closed)) out.closed = text(fm.closed);
  return out;
}

// One entry as a person reads it: its line, or what stands in for one, then what the card says about it.
function lineOf(bucket, item) {
  const count = `${item.pages} page${item.pages === 1 ? '' : 's'}`;
  const needsCard = item.kind === 'folder' && !item.card && !item.container && (bucket === 'projects' || bucket === 'areas');
  const first = item.line
    || (item.card ? 'no summary yet: write one sentence under the title of its card.md' : needsCard ? `no card.md, ${count}` : count);
  const tags = [
    item.container && item.line ? count : '',
    item.parent ? `part of ${item.parent}` : '', item.status || '',
    item.reviewed ? `reviewed ${item.reviewed}` : '', item.closed ? `closed ${item.closed}` : '',
  ].filter(Boolean);
  return [first, ...tags].join(' · ');
}

function mapText(result) {
  const asOf = result.index === 'off' ? 'Index off: the files were read just now.'
    : `Index as of ${result.index_as_of ? `${result.index_as_of.slice(0, 19).replace('T', ' ')} UTC` : 'no full sync yet'}`
      + `${result.background_sync ? ` (a background sync ${result.background_sync === 'started' ? 'has started' : 'is running'}; run it again for files changed since)` : ''}.`;
  const lines = [`Map of ${result.brain}`];
  for (const [bucket, title, about] of BUCKETS) {
    const items = result[bucket];
    lines.push('', `${title} (${items.length}): ${about}`);
    if (!items.length) { lines.push('  none yet'); continue; }
    const width = Math.min(28, Math.max(...items.map((item) => item.name.length)));
    for (const item of items) lines.push(`  ${item.name.padEnd(width)}  ${lineOf(bucket, item)}`);
  }
  lines.push('', 'Read an entry: `cogby get projects/<name>`. Its line is the first sentence under the title of its card.', asOf);
  return lines.join('\n');
}

module.exports = { map, mapText, BUCKETS };
