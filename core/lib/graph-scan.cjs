#!/usr/bin/env node

'use strict';

const fs = require('fs');
const path = require('path');
const { forRoot: R, samePath, wireFromLegacy } = require('./paths.cjs');
const { missingSummaries } = require('./card-summary.cjs');
const { findRoot, deriveEntities, resolvePointer } = require('./pointers.cjs');
const { projectDirs } = require('./transcript-store.cjs');

const ENTITY_BUCKETS = { projects: 'project', areas: 'area' };
const MEMBER_AREAS = Object.freeze({ people: 'person', organizations: 'organization' });
const CONTAINER_AREAS = new Set([...Object.keys(MEMBER_AREAS), 'threads']);
const LINK_ROOTS = ['areas', 'projects', 'resources', 'self/goals', 'tasks', 'team', 'routines'];
const WALK_DEPTH = 6;
const CLIQUE_CAP = 6;
const GENERIC = new Set(['card', 'progress', 'readme', 'index', 'task', 'plan', 'result',
  'verify', 'notes', 'summary', 'context-index', 'agents', 'claude']);

function read(p) {
  try { return fs.readFileSync(p, 'utf8'); } catch { return null; }
}
function listDir(p) {
  try { return fs.readdirSync(p, { withFileTypes: true }); } catch { return []; }
}
function exists(p) {
  try { fs.accessSync(p); return true; } catch { return false; }
}
const rel = (root, abs) => path.relative(root, abs).split(path.sep).join('/');

// `.claude/skills` is both roots' (§4.8), the same merge as scan.cjs scanSkills: Cogby's core skills
// in the engine, a brain's own in the brain, the brain's winning a name. A skill node keeps its
// root-relative `.claude/skills/<folder>/SKILL.md` path; skillFile() finds the file again, brain
// first. With no brain both are the root, read once, as before.
function skillBases(root) {
  const brain = R(root).BASE;
  return samePath(brain, root) ? [root] : [root, brain];
}
function skillFile(root, filePath) {
  const bases = skillBases(root);
  for (const base of bases.slice(1).reverse()) {
    const p = path.join(base, filePath);
    if (exists(p)) return p;
  }
  return path.join(bases[0], filePath);
}

function parseFrontmatter(content) {
  if (!content) return { data: {}, body: '' };
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(content);
  if (!m) return { data: {}, body: content };
  const data = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
    if (kv) data[kv[1]] = kv[2].replace(/\s+#.*$/, '').trim();
  }
  return { data, body: m[2] };
}

function descriptionOf(content) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(String(content || ''));
  if (!m) return '';
  const lines = m[1].split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const kv = /^description:\s*(.*)$/.exec(lines[i]);
    if (!kv) continue;
    const v = kv[1].replace(/\s+#.*$/, '').trim();
    if (!/^[>|][+-]?$/.test(v)) return v;
    const out = [];
    for (let j = i + 1; j < lines.length && /^\s+\S/.test(lines[j]); j++) out.push(lines[j].trim());
    return out.join(' ');
  }
  return '';
}

function aliasesOf(content) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(String(content || ''));
  if (!m) return [];
  const lines = m[1].split(/\r?\n/);
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const kv = /^aliases:\s*(.*)$/.exec(lines[i]);
    if (!kv) continue;
    const v = kv[1].replace(/\s+#.*$/, '').trim();
    if (v.startsWith('[')) {
      for (const a of v.replace(/^\[/, '').replace(/\]$/, '').split(',')) {
        const t = a.trim().replace(/^["']|["']$/g, '').trim();
        if (t) out.push(t);
      }
    } else if (v) {
      out.push(v.replace(/^["']|["']$/g, '').trim());
    } else {
      for (let j = i + 1; j < lines.length && /^\s+-\s+/.test(lines[j]); j++) {
        const t = lines[j].replace(/^\s+-\s*/, '').replace(/\s+#.*$/, '').trim().replace(/^["']|["']$/g, '').trim();
        if (t) out.push(t);
      }
    }
    break;
  }
  return [...new Set(out)];
}

const PURPOSE_HEADINGS = /^##+\s*(remit|outcome|what|what it is|purpose|mission|why|goal)\b/i;
function firstProse(body) {
  for (const line of String(body || '').split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#') || t.startsWith('---') || t.startsWith('|') || t.startsWith('```')) continue;
    return t.replace(/^[-*]\s+/, '').replace(/\*\*/g, '');
  }
  return '';
}
function purposeOf(body) {
  const lines = String(body || '').split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    if (!PURPOSE_HEADINGS.test(lines[i])) continue;
    const rest = firstProse(lines.slice(i + 1).join('\n'));
    if (rest) return rest.slice(0, 160);
  }
  return firstProse(body).slice(0, 160);
}

function walkMd(root, dirRel, depth = WALK_DEPTH, out = []) {
  if (depth < 0) return out;
  for (const e of listDir(R(root).abs(dirRel))) {
    if (e.name.startsWith('.') || e.name.startsWith('_') || e.name === 'node_modules') continue;
    const child = dirRel + '/' + e.name;
    if (e.isDirectory()) walkMd(root, child, depth - 1, out);
    else if (/\.md$/i.test(e.name)) out.push(child);
  }
  return out;
}

function buildNodes(root, opts) {
  const nodes = new Map();
  const add = (n) => nodes.set(n.id, Object.assign({ degree: 0, weight: 1 }, n));

  for (const [bucket, type] of Object.entries(ENTITY_BUCKETS)) {
    for (const e of listDir(R(root).abs(bucket))) {
      if (!e.isDirectory() || e.name.startsWith('.') || e.name.startsWith('_')) continue;
      if (bucket === 'areas' && CONTAINER_AREAS.has(e.name)) continue;
      const dirRel = bucket + '/' + e.name;
      const cardRel = dirRel + '/card.md';
      const cardText = read(R(root).abs(cardRel)) || '';
      const { data, body } = parseFrontmatter(cardText);
      add({
        id: type + ':' + e.name,
        type,
        slug: e.name,
        label: e.name.replace(/[-_]/g, ' '),
        path: exists(R(root).abs(cardRel)) ? cardRel : dirRel,
        purpose: purposeOf(body),
        aliases: aliasesOf(cardText),
        lastReviewed: data['last-reviewed'] || null,
        review: data.review || null,
        status: data.status || '',
        weight: walkMd(root, dirRel, 3).length || 1,
      });
    }
  }

  for (const [area, type] of Object.entries(MEMBER_AREAS)) {
    for (const e of listDir(R(root).abs('areas/' + area))) {
      if (!e.isFile() || !/\.md$/i.test(e.name) || e.name === 'card.md') continue;
      const slug = e.name.replace(/\.md$/i, '');
      const filePath = 'areas/' + area + '/' + e.name;
      const memberText = read(R(root).abs(filePath)) || '';
      const { data, body } = parseFrontmatter(memberText);
      add(Object.assign({
        id: type + ':' + slug,
        type,
        slug,
        label: slug.replace(/[-_]/g, ' '),
        path: filePath,
        purpose: purposeOf(body),
        aliases: aliasesOf(memberText),
        lastReviewed: data['last-reviewed'] || null,
        review: data.review || null,
        status: data.status || '',
        weight: 1,
      }, type === 'organization' ? { kind: data.kind || null } : {}));
    }
  }

  if (opts.archive) {
    for (const e of listDir(R(root).ctx('archive'))) {
      if (!e.isDirectory() || e.name.startsWith('.')) continue;
      add({
        id: 'archive:' + e.name,
        type: 'archive',
        slug: e.name,
        label: e.name.replace(/[-_]/g, ' '),
        path: 'archive/' + e.name,
        purpose: '',
        lastReviewed: null,
        review: null,
        status: 'closed',
        weight: walkMd(root, 'archive/' + e.name, 2).length || 1,
      });
    }
  }

  if (opts.machinery) {
    for (const e of listDir(R(root).ctx('routines'))) {
      if (!e.isFile() || !/\.md$/i.test(e.name) || /^index\.md$/i.test(e.name)) continue;
      const slug = e.name.replace(/\.md$/i, '');
      const filePath = 'routines/' + e.name;
      const { data } = parseFrontmatter(read(R(root).abs(filePath)) || '');
      add({
        id: 'routine:' + slug,
        type: 'routine',
        slug,
        label: (data.routine || slug).replace(/[-_]/g, ' '),
        path: filePath,
        purpose: (data.description || '').slice(0, 160),
        lastReviewed: null,
        review: null,
        status: (data.status || 'active').toLowerCase(),
        weight: 1,
      });
    }
    for (const base of skillBases(root)) for (const e of listDir(path.join(base, '.claude', 'skills'))) {
      if (!e.isDirectory() || e.name.startsWith('.')) continue;
      const filePath = '.claude/skills/' + e.name + '/SKILL.md';
      const content = read(path.join(base, filePath));
      if (content == null) continue;
      const name = parseFrontmatter(content).data.name || e.name;
      add({
        id: 'skill:' + name,
        type: 'skill',
        slug: name,
        label: name.replace(/[-_]/g, ' '),
        path: filePath,
        purpose: descriptionOf(content).slice(0, 160),
        lastReviewed: null,
        review: null,
        status: '',
        weight: 1,
      });
    }
  }
  return nodes;
}

function ownerOf(filePath, nodes) {
  const p = String(filePath || '');
  const member = /^areas\/([^/]+)\/([^/]+)\.md$/.exec(p);
  if (member && Object.hasOwn(MEMBER_AREAS, member[1])) {
    const id = MEMBER_AREAS[member[1]] + ':' + member[2];
    if (nodes.has(id)) return id;
  }
  const routine = /^routines\/([^/]+)\.md$/.exec(p);
  if (routine && nodes.has('routine:' + routine[1])) return 'routine:' + routine[1];
  const m = /^(areas|projects|archive)\/([^/]+)(?:\/|$)/.exec(p);
  if (!m) return null;
  const type = m[1] === 'areas' ? 'area' : m[1] === 'projects' ? 'project' : 'archive';
  const id = type + ':' + m[2];
  return nodes.has(id) ? id : null;
}

function buildSlugIndex(root, files, nodes) {
  const idx = new Map();
  const put = (key, target) => {
    const k = key.toLowerCase();
    const list = idx.get(k);
    if (list) { if (!list.includes(target)) list.push(target); } else idx.set(k, [target]);
  };
  for (const f of files) {
    const noExt = f.replace(/\.md$/i, '');
    put(noExt, f);
    const base = noExt.split('/').pop();
    if (!GENERIC.has(base.toLowerCase())) put(base, f);
  }
  for (const n of nodes.values()) {
    if (n.type === 'routine' || n.type === 'skill') continue;
    put(n.slug, n.path);
    put(n.path.replace(/\/card\.md$/, ''), n.path);
    for (const a of n.aliases || []) put(a, n.path);
  }
  return idx;
}

function aliasCollisions(nodes, idx) {
  const out = [];
  const seen = new Set();
  for (const n of nodes.values()) {
    for (const a of n.aliases || []) {
      const k = a.toLowerCase();
      if (seen.has(k)) continue;
      const hit = idx.get(k) || [];
      if (hit.length > 1) { seen.add(k); out.push({ alias: a, candidates: hit.slice(0, 6) }); }
    }
  }
  return out.sort((a, b) => a.alias.localeCompare(b.alias));
}

function resolveName(root, name, opts) {
  return resolveMany(root, [name], opts)[0];
}

function resolveMany(root, names, opts = {}) {
  const withArchive = opts.archive !== false;
  const nodes = buildNodes(root, { archive: withArchive });
  const files = [];
  for (const r of withArchive ? LINK_ROOTS.concat(['archive']) : LINK_ROOTS) files.push(...walkMd(root, r));
  const idx = buildSlugIndex(root, files, nodes);
  return (names || []).map((name) => {
    const key = String(name || '').trim()
      .replace(/^\[\[/, '').replace(/\]\]$/, '')
      .replace(/^\.?\//, '').replace(/\.md$/i, '')
      .toLowerCase();
    if (!key) return { query: name, unresolved: true };
    const hit = idx.get(key) || [];
    if (hit.length === 1) {
      const owner = ownerOf(hit[0], nodes);
      return { query: name, resolved: hit[0], entity: owner ? nodes.get(owner) : null };
    }
    if (hit.length > 1) return { query: name, ambiguous: hit };
    return { query: name, unresolved: true };
  });
}

function stripFences(text) {
  return String(text || '').replace(/```[\s\S]*?```/g, '\n').replace(/^ {4}.*$/gm, '');
}
const WIKILINK = /\[\[([^\]|#\n]+)(?:[|#][^\]\n]*)?\]\]/g;
const MDLINK = /\]\(([^)\s#]+\.md)(?:#[^)]*)?\)/g;

const BARE_PATH = /\b(?:areas|projects)\/[A-Za-z0-9_*<>-]+(?:\/[A-Za-z0-9._*<>-]+)*/g;
function barePaths(text) {
  const out = new Set();
  let m;
  BARE_PATH.lastIndex = 0;
  while ((m = BARE_PATH.exec(String(text || '')))) {
    out.add(m[0].replace(/[.,;:!?)\]]+$/, ''));   // sentence punctuation is not part of a path
  }
  return [...out];
}

function linksIn(root, filePath, text) {
  const body = stripFences(text);
  const out = { wiki: [], md: [] };
  let m;
  WIKILINK.lastIndex = 0;
  while ((m = WIKILINK.exec(body))) {
    const raw = m[1].trim().replace(/^\.\//, '').replace(/\.md$/i, '');
    if (raw) out.wiki.push(raw);
  }
  MDLINK.lastIndex = 0;
  while ((m = MDLINK.exec(body))) {
    const target = m[1].trim();
    if (/^https?:/i.test(target)) continue;
    const abs = path.resolve(path.dirname(R(root).abs(filePath)), target);
    if (!abs.startsWith(root + path.sep)) continue;      // repo-confined, same rule as resolvePointer
    if (exists(abs)) out.md.push(rel(root, abs));
  }
  return out;
}

function goalEntityPaths(root, text) {
  const hrefs = [];
  for (const line of String(text || '').split(/\r?\n/)) {
    const t = line.trim();
    if (!/^-\s*task:/i.test(t)) continue;
    const i = Math.max(t.lastIndexOf(' → '), t.lastIndexOf(' -> '));
    if (i < 0) continue;
    const pointer = t.slice(i + (t[i + 2] === '>' ? 4 : 3)).trim();
    const href = resolvePointer(root, pointer);
    if (href) hrefs.push(href);
  }
  return deriveEntities(hrefs).map((e) => e.path);
}

function fileTargets(root, filePath, text, idx, stats) {
  const found = linksIn(root, filePath, text);
  const out = [];
  for (const raw of found.wiki) {
    if (stats) stats.links++;
    const hit = idx.get(raw.toLowerCase());
    if (!hit) { if (stats) stats.unresolved.push({ from: filePath, link: raw }); continue; }
    if (hit.length > 1) { if (stats) stats.ambiguous.push({ from: filePath, link: raw, candidates: hit.slice(0, 4) }); continue; }
    if (stats) stats.resolved++;
    out.push({ path: hit[0], kind: 'wikilink' });
  }
  for (const t of found.md) {
    if (stats) { stats.links++; stats.resolved++; }
    out.push({ path: t, kind: 'mdlink' });
  }
  if (filePath.startsWith('self/goals/')) {
    for (const p of goalEntityPaths(root, text)) {
      if (stats) stats.resolved++;
      out.push({ path: p, kind: 'goal' });
    }
  }
  return out;
}

function backlinksFor(root, target) {
  const t = String(target || '').replace(/^\.?\//, '');
  if (!t) return [];
  const nodes = buildNodes(root, { archive: true });
  const files = [];
  for (const r of LINK_ROOTS.concat(['archive'])) files.push(...walkMd(root, r));
  const idx = buildSlugIndex(root, files, nodes);
  const out = [];
  for (const f of files) {
    if (f === t) continue;
    const text = read(R(root).abs(f));
    if (text == null) continue;
    const hit = fileTargets(root, f, text, idx, null).find((x) => x.path === t);
    if (hit) out.push({ path: f, kind: hit.kind, owner: ownerOf(f, nodes) });
  }
  return out;
}

function categorizeUnresolved(root, unresolved, exampleFiles, opts = {}) {
  if (!unresolved.length) return;
  const memSlugs = new Set();
  // Claude Code's auto-memory folder sits under the same per-folder slug as the transcripts, so it
  // is found the same way (§4.4): through transcript-store's one spelling of the rule, which the
  // hand-built '-' + root.split(sep) here never matched on Windows (`-C:-Users-…` against
  // `C--Users-…`), and for both of this install's roots.
  const memDirs = opts.memoryDir !== undefined
    ? (opts.memoryDir ? [opts.memoryDir] : [])
    : projectDirs(root, { override: '' }).map((d) => path.join(d, 'memory'));
  for (const memDir of memDirs) {
    for (const e of listDir(memDir)) {
      if (e.isFile() && /\.md$/i.test(e.name)) memSlugs.add(e.name.replace(/\.md$/i, '').toLowerCase());
    }
  }
  const archSlugs = new Set();
  for (const e of listDir(R(root).ctx('archive'))) {
    if (!e.name.startsWith('.') && !e.name.startsWith('_')) archSlugs.add(e.name.replace(/\.md$/i, '').toLowerCase());
  }
  for (const f of walkMd(root, 'archive', 3)) {
    const noExt = f.replace(/\.md$/i, '').toLowerCase();
    archSlugs.add(noExt);
    const base = noExt.split('/').pop();
    if (!GENERIC.has(base)) archSlugs.add(base);
  }
  for (const u of unresolved) {
    const k = u.link.toLowerCase();
    u.category = exampleFiles.has(u.from) ? 'doc-example'
      : (archSlugs.has(k) || archSlugs.has(k.replace(/^archive\//, ''))) ? 'archived-target'
      : memSlugs.has(k) ? 'memory-namespace'
      : 'actionable';
  }
}

function scanGraph(root, opts = {}) {
  const nodes = buildNodes(root, opts);
  const roots = opts.archive ? LINK_ROOTS.concat(['archive']) : LINK_ROOTS;
  const files = [];
  for (const r of roots) files.push(...walkMd(root, r));

  const idx = buildSlugIndex(root, files, nodes);
  const edges = new Map();                       // 'a|b' -> { s, t, weight, refs[] }
  const stats = { files: files.length, links: 0, resolved: 0, unresolved: [], ambiguous: [] };
  stats.aliasCollisions = aliasCollisions(nodes, idx);

  const link = (a, b, viaPath, kind) => {
    if (!a || !b || a === b) return;
    const [s, t] = a < b ? [a, b] : [b, a];
    const key = s + '|' + t;
    const e = edges.get(key) || { s, t, weight: 0, refs: [] };
    e.weight++;
    if (e.refs.length < 12 && !e.refs.some((r) => r.path === viaPath)) e.refs.push({ path: viaPath, kind });
    edges.set(key, e);
  };

  const exampleFiles = new Set();
  for (const f of files) {
    const text = read(R(root).abs(f));
    if (text == null) continue;
    const fm = parseFrontmatter(text).data;
    if (fm.graph === 'examples') exampleFiles.add(f);
    const from = ownerOf(f, nodes);
    const targets = fileTargets(root, f, text, idx, stats)
      .map((t) => ({ id: ownerOf(t.path, nodes), kind: t.kind }))
      .filter((t) => t.id);

    if (from) {
      for (const t of targets) link(from, t.id, f, t.kind);
      const org = nodes.get(from).path === f ? String(fm.organization || '').trim() : '';
      if (org) {
        stats.links++;
        const orgId = 'organization:' + org;
        if (nodes.has(orgId) && orgId !== from) { stats.resolved++; link(from, orgId, f, 'organization'); }
        else stats.unresolved.push({ from: f, link: 'organizations/' + org });
      }
      if (opts.machinery && from.startsWith('routine:')) {
        const seen = new Set();
        for (const p of barePaths(parseFrontmatter(text).body)) {
          const id = ownerOf(p, nodes);
          if (id && id !== from && !seen.has(id)) { seen.add(id); link(from, id, f, 'step'); }
        }
      }
    } else {
      const uniq = [...new Set(targets.map((t) => t.id))];
      if (uniq.length > 1 && uniq.length <= CLIQUE_CAP) {
        const kind = targets[0].kind === 'goal' ? 'goal' : 'co-mention';
        for (let i = 0; i < uniq.length; i++) {
          for (let j = i + 1; j < uniq.length; j++) link(uniq[i], uniq[j], f, kind);
        }
      }
    }
  }

  if (opts.machinery) {
    for (const n of nodes.values()) {
      if (n.type !== 'skill') continue;
      const seen = new Set();
      for (const p of barePaths(descriptionOf(read(skillFile(root, n.path))))) {
        const id = ownerOf(p, nodes);
        if (id && id !== n.id && !seen.has(id)) { seen.add(id); link(n.id, id, n.path, 'contract'); }
      }
    }
  }

  const edgeList = [...edges.values()];
  for (const e of edgeList) {
    const a = nodes.get(e.s), b = nodes.get(e.t);
    if (a) a.degree++;
    if (b) b.degree++;
  }
  categorizeUnresolved(root, stats.unresolved, exampleFiles, opts);
  stats.unresolvedTotal = stats.unresolved.length;
  stats.ambiguousTotal = stats.ambiguous.length;
  stats.unresolvedByCategory = {};
  for (const u of stats.unresolved) {
    stats.unresolvedByCategory[u.category] = (stats.unresolvedByCategory[u.category] || 0) + 1;
  }
  if (!opts.fullIssues) {
    stats.unresolved = stats.unresolved.slice(0, 40);
    stats.ambiguous = stats.ambiguous.slice(0, 40);
  }

  if (opts.machinery) {
    const loose = [];
    for (const [id, n] of nodes) {
      if ((n.type === 'routine' || n.type === 'skill') && !n.degree) { loose.push(id); nodes.delete(id); }
    }
    stats.machineryLoose = loose.sort();
  }

  return {
    nodes: [...nodes.values()].sort((a, b) => b.degree - a.degree || a.id.localeCompare(b.id)),
    edges: edgeList.sort((a, b) => b.weight - a.weight),
    stats,
    scannedAt: new Date().toISOString(),
  };
}

// There is no map file to keep current: `cogby map` prints the map from the index. What is checked
// here: every card has a one-line summary for that map, the cards carry what the substrate
// promises, and goal pointers still resolve.
function checkIndexCoverage(root) {
  const issues = [];
  const add = (type, detail, extra) => issues.push(Object.assign({ type, detail }, extra || {}));
  for (const m of missingSummaries(root)) add('card-no-summary', `${m}card.md has no one-line summary under its title`, { name: m.replace(/\/$/, '') });

  for (const e of listDir(R(root).ctx('projects'))) {
    if (!e.isDirectory() || e.name.startsWith('.') || e.name.startsWith('_')) continue;
    if (!exists(R(root).ctx('projects', e.name, 'card.md'))) add('project-missing-card', `projects/${e.name}/ has no card.md`, { name: e.name });
    if (exists(R(root).ctx('projects', e.name, 'progress.md'))) add('project-two-files', `projects/${e.name}/ still has a progress.md beside its card: fold it into card.md (Now and Next on top, done and decisions as timeline lines)`, { name: e.name });
  }
  for (const e of listDir(R(root).ctx('areas'))) {
    if (!e.isDirectory() || e.name.startsWith('.') || e.name.startsWith('_')) continue;
    if (CONTAINER_AREAS.has(e.name)) continue;
    const card = read(R(root).ctx('areas', e.name, 'card.md'));
    if (card == null) { add('area-missing-card', `areas/${e.name}/ has no card.md`, { name: e.name }); continue; }
    const fm = parseFrontmatter(card).data;
    if (!fm['last-reviewed']) add('area-missing-freshness', `areas/${e.name}/card.md has no last-reviewed:`, { name: e.name });
    if (!fm.review) add('area-missing-freshness', `areas/${e.name}/card.md has no review: cadence`, { name: e.name });
  }

  // In the brain layout a pointer may carry a pre-brain (`context/realms/work/…`) or engine-relative
  // (`cogby-brain/…`) prefix: read it as wire, the same normalisation resolvePointer uses, so those
  // are checked too. A pointer that still names no bucket is one this check cannot place, and is
  // never flagged; one that is on disk in the spelling it was written in is not stale. Before the
  // brain the check is exactly what it was: wire spellings only.
  const brainLayout = R(root).LAYOUT === 'brain';
  for (const e of listDir(R(root).abs('self/goals'))) {
    if (!e.isFile() || !/\.md$/i.test(e.name)) continue;
    const gp = 'self/goals/' + e.name;
    for (const line of (read(R(root).abs(gp)) || '').split(/\r?\n/)) {
      const t = line.trim();
      if (!/^-\s*task:/i.test(t)) continue;
      const i = Math.max(t.lastIndexOf(' → '), t.lastIndexOf(' -> '));
      if (i < 0) continue;
      const pointer = t.slice(i + (t[i + 2] === '>' ? 4 : 3)).trim().split(/\s/)[0].split(/[#?]/)[0].replace(/[.,;:)]+$/, '');
      const wire = brainLayout ? wireFromLegacy(pointer) : pointer;
      if (!/^(projects|areas|archive|resources|tasks)\//.test(wire)) continue;
      if (exists(R(root).abs(wire))) continue;
      if (wire !== pointer && exists(path.join(root, pointer))) continue;
      add('stale-goal-pointer', `${gp} points at ${pointer} which is not on disk`, { from: gp, name: pointer });
    }
  }

  const counts = {};
  for (const i of issues) counts[i.type] = (counts[i.type] || 0) + 1;
  return { ok: issues.length === 0, issues, counts };
}

function neighborsOf(graph, id) {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  return graph.edges
    .filter((e) => e.s === id || e.t === id)
    .map((e) => ({ node: byId.get(e.s === id ? e.t : e.s) || null, weight: e.weight, refs: e.refs }))
    .filter((x) => x.node);
}

module.exports = { scanGraph, neighborsOf, backlinksFor, ownerOf, buildSlugIndex, walkMd, linksIn, fileTargets, purposeOf, checkIndexCoverage, aliasesOf, resolveName, resolveMany };

if (require.main === module) {
  const root = findRoot(__dirname);
  const rIdx = process.argv.indexOf('--resolve');
  if (rIdx !== -1) {
    console.log(JSON.stringify(resolveName(root, process.argv[rIdx + 1] || ''), null, 2));
    return;
  }
  if (process.argv.includes('--index-health')) {
    const g = scanGraph(root, { archive: process.argv.includes('--archive'), fullIssues: true });
    console.log(JSON.stringify({
      coverage: checkIndexCoverage(root),
      links: {
        scanned: g.stats.links,
        resolved: g.stats.resolved,
        unresolvedTotal: g.stats.unresolvedTotal,
        ambiguousTotal: g.stats.ambiguousTotal,
        byCategory: g.stats.unresolvedByCategory,
        needsAttention: g.stats.unresolved.filter((u) => u.category === 'actionable' || u.category === 'memory-namespace'),
        ambiguous: g.stats.ambiguous,
        aliasCollisions: g.stats.aliasCollisions,
      },
    }, null, 2));
    return;
  }
  const g = scanGraph(root, {
    archive: process.argv.includes('--archive'),
    machinery: process.argv.includes('--machinery'),
  });
  if (process.argv.includes('--stats')) {
    console.log(JSON.stringify({ nodes: g.nodes.length, edges: g.edges.length, stats: g.stats }, null, 2));
  } else {
    console.log(JSON.stringify(g, null, 2));
  }
}
