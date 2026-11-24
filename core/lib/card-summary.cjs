'use strict';
// The one line of a card: the first sentence under its title. `cogby map` shows it for every project
// and area (core/brain/map.cjs), an import seeds it on the cards it scaffolds, and the health check
// names the cards that have none. There is no generated map file any more: the map is printed from
// the index when it is asked for.
const fs = require('fs');
const path = require('path');

const CONTAINER_AREAS = new Set(['people', 'organizations', 'threads', 'routines']);
const SUMMARY_CAP = 140;

function read(p) { try { return fs.readFileSync(p, 'utf8'); } catch { return null; } }

// The first sentence of the first paragraph under the card's title.
function summaryOf(text) {
  if (text == null) return null;
  const lines = text.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '').split(/\r?\n/);
  const h1 = lines.findIndex((l) => /^#\s/.test(l));
  const para = [];
  for (let i = h1 < 0 ? 0 : h1 + 1; i < lines.length; i++) {
    const l = lines[i].trim();
    if (!l) { if (para.length) break; continue; }
    if (/^(#|<!--|[-*+]\s|>|\||```)/.test(l)) break;
    para.push(l);
  }
  if (!para.length) return null;
  const joined = para.join(' ');
  const first = (/^(.+?[.!?])(\s|$)/.exec(joined) || [null, joined])[1];
  return first.length > SUMMARY_CAP ? first.slice(0, SUMMARY_CAP - 1).trimEnd() + '…' : first;
}

// The shipped templates' own sentence is a placeholder, not a summary.
const PLACEHOLDERS = new Set(['project-card.md', 'area-card.md']
  .map((f) => summaryOf(read(path.join(__dirname, '..', 'ops', 'templates', f))))
  .filter(Boolean));

function cardSummary(card) {
  const s = summaryOf(card);
  return s && !PLACEHOLDERS.has(s) ? s : null;
}

// The projects and areas whose card is there and has no line of its own yet, as `projects/<name>/`.
// A folder that only holds one page per entry (people, organizations, threads, routines) has no card.
function missingSummaries(root) {
  // Required here, not at the top: paths.cjs resolves the brain when it loads, and `cogby map` only
  // needs the sentence.
  const paths = require('./paths.cjs');
  const r = root ? paths.forRoot(root) : paths;
  const out = [];
  for (const bucket of ['projects', 'areas']) {
    let entries = [];
    try { entries = fs.readdirSync(r.ctx(bucket), { withFileTypes: true }); } catch { /* no such folder */ }
    for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (!e.isDirectory() || e.name.startsWith('.') || e.name.startsWith('_')) continue;
      if (bucket === 'areas' && CONTAINER_AREAS.has(e.name)) continue;
      const card = read(path.join(r.ctx(bucket), e.name, 'card.md'));
      if (card != null && !cardSummary(card)) out.push(`${bucket}/${e.name}/`);
    }
  }
  return out;
}

// Put a one-liner into a freshly scaffolded card, replacing the template's placeholder
// sentence. A card that already has a real summary is left alone.
function seedSummary(cardFile, sentence) {
  const card = read(cardFile);
  if (card == null || cardSummary(card) || !String(sentence || '').trim()) return false;
  const eol = card.includes('\r\n') ? '\r\n' : '\n';
  const lines = card.split(/\r?\n/);
  const h1 = lines.findIndex((l) => /^#\s/.test(l));
  if (h1 < 0) return false;
  let start = h1 + 1;
  while (start < lines.length && !lines[start].trim()) start++;
  let end = start;
  if (start < lines.length && !/^(#|<!--|[-*+]\s|>|\||```)/.test(lines[start].trim())) {
    while (end < lines.length && lines[end].trim()) end++;
  }
  const insert = end > start ? [sentence.trim()] : [sentence.trim(), ''];
  lines.splice(start, end - start, ...insert);
  if (start === h1 + 1) lines.splice(start, 0, '');
  fs.writeFileSync(cardFile, lines.join(eol), 'utf8');
  return true;
}

module.exports = { summaryOf, cardSummary, missingSummaries, seedSummary, CONTAINER_AREAS };
