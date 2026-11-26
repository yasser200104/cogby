#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('../lib/spawn.cjs');
const paths = require('../lib/paths.cjs');
const { seedSummary } = require('../lib/card-summary.cjs');

const ROOT = process.env.BRAIN_DIR && fs.existsSync(process.env.BRAIN_DIR)
  ? path.resolve(process.env.BRAIN_DIR)
  : path.resolve(__dirname, '..', '..');
const NEW_CJS = path.join(__dirname, 'new.cjs');

const MAX_FILES = 40000;
const MAX_WALK_DEPTH = 12;
const SAMPLE_NOTES = 400;        // notes read for conventions, most recent first
const SAMPLE_BYTES = 4096;       // per sampled note
const DEFAULT_CAP = 12000;       // chars of survey output
const RECENT_SHOWN = 30;
const SHAPE_ROWS = 40;

const IGNORE_DIRS = new Set([
  '.git', '.svn', '.hg', 'node_modules', '__pycache__', '.venv', 'venv', '.tox',
  '.obsidian', '.logseq', '.trash', '.stfolder', '.stversions', '.smart-env',
  'dist', 'build', '.next', '.nuxt', '.cache', '.parcel-cache', '.gradle', '.terraform',
  '.idea', '.vscode', '.ipynb_checkpoints',
]);
const IGNORE_FILES = new Set(['.DS_Store', 'Thumbs.db', 'desktop.ini', '.gitkeep', '.keep']);

const SECRET_FILE_RE = new RegExp([
  '^\\.env(\\..+)?$',
  '^\\.(npmrc|netrc|pgpass|htpasswd)$',
  '^credentials?(\\.(json|ya?ml|txt|csv))?$',
  '^secrets?\\.(json|ya?ml|env|txt)$',
  '^client_secret.*\\.json$',
  '^token_cache\\.json$',
  '^service[-_]?account.*\\.json$',
  '^id_(rsa|dsa|ecdsa|ed25519)(\\.pub)?$',
  '.*\\.(pem|ppk|p12|pfx|kdbx|keystore|jks|asc|gpg)$',
].join('|'), 'i');
const SECRET_DIR_RE = /^(\.ssh|\.gnupg|\.aws|\.sfdx|secrets?|credentials?)$/i;

const NOTE_EXT = new Set(['.md', '.markdown', '.txt', '.org', '.rst']);
const DEST_BUCKETS = new Set(['projects', 'areas', 'resources', 'archive']);

const GUESS = [
  [/^(1[-_. ]*)?projects?$/i, 'projects/ — one folder per outcome with an end'],
  [/^(2[-_. ]*)?areas?$/i, 'areas/ — one card per standing responsibility'],
  [/^(3[-_. ]*)?(resources?|reference|refs?|library)$/i, 'resources/ — raw reference, searched on demand'],
  [/^(4[-_. ]*)?(archives?|old|done|completed)$/i, 'archive/'],
  [/^(clients?|customers?|accounts?)$/i, 'areas/<client>, plus one organizations/ file per client'],
  [/^(people|contacts|crm|humans)$/i, 'areas/people/<slug>.md'],
  [/^(compan(y|ies)|orgs?|organi[sz]ations?|vendors?)$/i, 'areas/organizations/<slug>.md'],
  [/^(notes?|zettel|slip-?box|permanent|atomic|clippings|readwise|highlights|literature|sources)$/i, 'resources/<topic>/'],
  [/^(daily|dailies|journal|diary|logs?)$/i, 'resources/journal/ — context/self/log/ is generated, never imported into'],
  [/^(meetings?|1-?on-?1s?|1-1s|standups?|calls?)$/i, 'the area or project each meeting belongs to'],
  [/^(inbox|0*0[-_. ]*inbox|unsorted|to-?sort|scratch|dump)$/i, 'nothing yet — triage before it earns a home'],
  [/^(templates?|_templates|snippets)$/i, 'skip — Cogby scaffolds its own'],
  [/^(tasks?|to-?dos?)$/i, "the owning project's card.md ## Next, not context/state/tasks/"],
  [/^(ideas?|someday|maybe|backlog)$/i, 'areas/threads/<name>.md, or leave it out'],
  [/^(attachments?|assets|files|images|media|_resources)$/i, 'rides along with whatever references it'],
];


function parseArgs(argv) {
  const a = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (t.startsWith('--')) {
      const k = t.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith('--')) { a[k] = next; i++; } else { a[k] = true; }
    } else a._.push(t);
  }
  return a;
}
const val = (v) => (v && v !== true ? String(v) : null);
const num = (v, fallback) => {
  const n = parseInt(val(v) || '', 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};
function die(msg, code = 1) { process.stderr.write(`error: ${msg}\n`); process.exit(code); }
function log(s) { process.stdout.write(s + '\n'); }

const fwd = (p) => String(p).split(path.sep).join('/');
function bytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(1)} GB`;
}
const day = (ms) => (ms ? new Date(ms).toISOString().slice(0, 10) : 'n/a');
function slugify(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
}


function walk(rootDir) {
  const files = [];
  const secrets = [];
  const tooling = new Set();
  const skipped = { ignoredDirs: 0, ignoredFiles: 0, symlinks: 0, deep: 0, unreadable: 0 };
  let overflow = false;
  let dirCount = 0;

  const queue = [{ abs: rootDir, rel: '', depth: 0 }];
  while (queue.length) {
    const here = queue.shift();
    let entries;
    try { entries = fs.readdirSync(here.abs, { withFileTypes: true }); } catch { skipped.unreadable++; continue; }
    dirCount++;
    for (const entry of entries) {
      const abs = path.join(here.abs, entry.name);
      const rel = here.rel ? path.join(here.rel, entry.name) : entry.name;
      if (entry.isSymbolicLink()) { skipped.symlinks++; continue; }
      if (entry.isDirectory()) {
        if (IGNORE_DIRS.has(entry.name)) { tooling.add(entry.name); skipped.ignoredDirs++; continue; }
        if (SECRET_DIR_RE.test(entry.name)) { secrets.push({ rel: fwd(rel) + '/', why: 'credential folder' }); continue; }
        if (here.depth + 1 > MAX_WALK_DEPTH) { skipped.deep++; continue; }
        queue.push({ abs, rel, depth: here.depth + 1 });
        continue;
      }
      if (!entry.isFile()) continue;
      if (IGNORE_FILES.has(entry.name)) { skipped.ignoredFiles++; continue; }
      if (SECRET_FILE_RE.test(entry.name)) { secrets.push({ rel: fwd(rel), why: 'credential file name' }); continue; }
      if (files.length >= MAX_FILES) { overflow = true; continue; }
      let st;
      try { st = fs.statSync(abs); } catch { skipped.unreadable++; continue; }
      files.push({
        rel: fwd(rel), abs, size: st.size, mtimeMs: st.mtimeMs,
        ext: path.extname(entry.name).toLowerCase(), depth: here.depth + 1,
      });
    }
  }
  return { files, secrets, tooling, skipped, overflow, dirCount };
}


function spread(items, budget) {
  const groups = new Map();
  for (const item of items) {
    const key = item.rel.includes('/') ? item.rel.split('/')[0] : '.';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }
  const lanes = [...groups.values()];
  const out = [];
  for (let i = 0; out.length < budget; i++) {
    let moved = false;
    for (const lane of lanes) {
      if (i >= lane.length) continue;
      out.push(lane[i]);
      moved = true;
      if (out.length >= budget) break;
    }
    if (!moved) break;
  }
  return out;
}

function sampleNotes(files) {
  const notes = files.filter((f) => NOTE_EXT.has(f.ext)).sort((a, b) => b.mtimeMs - a.mtimeMs);
  const taken = spread(notes, SAMPLE_NOTES);
  const fmKeys = new Map();
  let wikilinks = 0, tagged = 0, withFrontmatter = 0, dated = 0;
  const titles = new Map();
  for (const f of taken) {
    let head = '';
    try {
      const fd = fs.openSync(f.abs, 'r');
      const buf = Buffer.alloc(Math.min(SAMPLE_BYTES, f.size || SAMPLE_BYTES));
      const read = fs.readSync(fd, buf, 0, buf.length, 0);
      fs.closeSync(fd);
      head = buf.slice(0, read).toString('utf8');
    } catch { continue; }
    const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(head);
    if (fm) {
      withFrontmatter++;
      for (const line of fm[1].split(/\r?\n/)) {
        const key = /^([A-Za-z][A-Za-z0-9_-]{0,30}):/.exec(line);
        if (key) fmKeys.set(key[1], (fmKeys.get(key[1]) || 0) + 1);
      }
    }
    if (/\[\[[^\]]+\]\]/.test(head)) wikilinks++;
    if (/(^|\s)#[A-Za-z][\w/-]{1,30}/m.test(head.replace(/^#+\s/gm, ''))) tagged++;
    if (/(^|\/)\d{4}-\d{2}-\d{2}/.test(f.rel)) dated++;
    const title = (fm ? /^title:\s*["']?(.+?)["']?\s*$/m.exec(fm[1]) : null)
      || /^#\s+(.+?)\s*$/m.exec(fm ? head.slice(fm[0].length) : head);
    if (title) titles.set(f.rel, title[1].trim().slice(0, 80));
  }
  return { notes: notes.length, sampled: taken.length, fmKeys, wikilinks, tagged, withFrontmatter, dated, titles };
}


function shape(files, depth) {
  const rows = new Map();
  for (const f of files) {
    const parts = f.rel.split('/');
    const keyParts = parts.slice(0, Math.min(depth, Math.max(parts.length - 1, 0)));
    const key = keyParts.length ? keyParts.join('/') : '.';
    for (let i = 1; i <= keyParts.length; i++) {
      const k = keyParts.slice(0, i).join('/');
      const row = rows.get(k) || { key: k, files: 0, size: 0, newest: 0 };
      row.files++; row.size += f.size; row.newest = Math.max(row.newest, f.mtimeMs);
      rows.set(k, row);
    }
    if (key === '.') {
      const row = rows.get('.') || { key: '.', files: 0, size: 0, newest: 0 };
      row.files++; row.size += f.size; row.newest = Math.max(row.newest, f.mtimeMs);
      rows.set('.', row);
    }
  }
  return [...rows.values()].sort((a, b) => b.files - a.files).slice(0, SHAPE_ROWS);
}

function guessFor(key) {
  const name = key.split('/').pop();
  for (const [re, hint] of GUESS) if (re.test(name)) return hint;
  return '';
}


function boundedWriter(cap) {
  let out = '';
  let dropped = 0;
  return {
    push(text) {
      if (dropped) { dropped++; return false; }
      if (out.length + text.length > cap) { dropped = 1; return false; }
      out += text;
      return true;
    },
    done() {
      return out + (dropped
        ? `\n_Survey truncated at ${cap} chars: ${dropped} section(s) dropped. Re-run with a bigger --cap, or --json, if you need the rest._\n`
        : '');
    },
  };
}


// A private brain is not copied into another one: neither the brain itself nor a folder inside it.
function refusePrivate(dir) {
  const brainLib = require('../brain/brain.cjs');
  for (let at = dir, i = 0; i < 12; i++) {
    if (brainLib.isBrain(at) && brainLib.isPrivate(at)) die(`${dir} is in the private brain at ${at}: a private brain is not imported into another one`);
    const up = path.dirname(at);
    if (up === at) break;
    at = up;
  }
}

function cmdSurvey(a) {
  const dir = val(a.dir);
  if (!dir) die('--dir <path> is required');
  const rootDir = path.resolve(dir);
  refusePrivate(rootDir);
  let st;
  try { st = fs.statSync(rootDir); } catch { die(`folder not found: ${rootDir}`); }
  if (!st.isDirectory()) die(`not a folder: ${rootDir}`);

  const depth = num(a.depth, 2);
  const cap = num(a.cap, DEFAULT_CAP);
  const scan = walk(rootDir);
  if (!scan.files.length) die(`nothing readable in ${rootDir} — is it the right folder?`);

  const sample = sampleNotes(scan.files);
  const rows = shape(scan.files, depth);
  const totalSize = scan.files.reduce((n, f) => n + f.size, 0);
  const oldest = Math.min(...scan.files.map((f) => f.mtimeMs));
  const newest = Math.max(...scan.files.map((f) => f.mtimeMs));
  const exts = new Map();
  for (const f of scan.files) exts.set(f.ext || '(none)', (exts.get(f.ext || '(none)') || 0) + 1);
  const recent = scan.files.slice().sort((x, y) => y.mtimeMs - x.mtimeMs).slice(0, RECENT_SHOWN);

  if (a.json) {
    log(JSON.stringify({
      source: fwd(rootDir),
      files: scan.files.length, folders: scan.dirCount, size: totalSize,
      modified: { from: day(oldest), to: day(newest) },
      truncated: scan.overflow, skipped: scan.skipped,
      tooling: [...scan.tooling],
      shape: rows.map((r) => ({ ...r, newest: day(r.newest), guess: guessFor(r.key) })),
      formats: [...exts.entries()].sort((x, y) => y[1] - x[1]).slice(0, 20),
      conventions: {
        notes: sample.notes, sampled: sample.sampled, withFrontmatter: sample.withFrontmatter,
        frontmatterKeys: [...sample.fmKeys.entries()].sort((x, y) => y[1] - x[1]).slice(0, 12),
        wikilinks: sample.wikilinks, tagged: sample.tagged, datedFilenames: sample.dated,
      },
      recent: recent.map((f) => ({ rel: f.rel, modified: day(f.mtimeMs), title: sample.titles.get(f.rel) || '' })),
      credentials: scan.secrets.slice(0, 40),
    }, null, 2));
    return;
  }

  const w = boundedWriter(cap);
  w.push(`# Brain folder survey — ${day(Date.now())}\n\n`);
  w.push(`Source: ${fwd(rootDir)}\n\n`);
  w.push(`Read **${scan.files.length} files** in ${scan.dirCount} folders, ${bytes(totalSize)}, `
    + `modified ${day(oldest)} → ${day(newest)}.\n`);
  const notLooked = [];
  if (scan.overflow) notLooked.push(`stopped counting at ${MAX_FILES} files`);
  if (scan.skipped.ignoredDirs) notLooked.push(`${scan.skipped.ignoredDirs} tooling/build folder(s)`);
  if (scan.skipped.symlinks) notLooked.push(`${scan.skipped.symlinks} symlink(s), never followed`);
  if (scan.skipped.deep) notLooked.push(`${scan.skipped.deep} folder(s) past depth ${MAX_WALK_DEPTH}`);
  if (scan.skipped.unreadable) notLooked.push(`${scan.skipped.unreadable} unreadable path(s)`);
  if (scan.secrets.length) notLooked.push(`${scan.secrets.length} credential-looking path(s), never read`);
  if (notLooked.length) w.push(`Not looked at: ${notLooked.join('; ')}.\n`);
  if (scan.tooling.size) w.push(`Written by: ${[...scan.tooling].join(', ')} (tooling folders detected).\n`);
  w.push('\n');

  w.push('## Shape\n\n| Folder | Files | Size | Newest | Usually maps to |\n|---|---|---|---|---|\n'
    + rows.map((r) => `| \`${r.key}\` | ${r.files} | ${bytes(r.size)} | ${day(r.newest)} | ${guessFor(r.key) || '—'} |`).join('\n')
    + '\n\nThe last column is a guess from the folder name alone. Check it against the documents before believing it.\n\n');

  w.push('## Formats\n\n'
    + [...exts.entries()].sort((x, y) => y[1] - x[1]).slice(0, 14).map(([e, n]) => `${e} ${n}`).join(' · ')
    + '\n\n');

  const keyList = [...sample.fmKeys.entries()].sort((x, y) => y[1] - x[1]).slice(0, 12)
    .map(([k, n]) => `${k} (${n})`).join(', ');
  w.push('## Conventions\n\n'
    + `- ${sample.notes} notes; conventions below are from a ${sample.sampled}-note sample, spread across the folders, newest first.\n`
    + `- YAML frontmatter on ${sample.withFrontmatter} of them${keyList ? `; keys: ${keyList}` : ''}\n`
    + `- \`[[wikilinks]]\` in ${sample.wikilinks}; \`#tags\` in ${sample.tagged}; dated filenames in ${sample.dated}\n\n`);

  w.push(`## Most recently touched\n\n${recent.map((f) => {
    const title = sample.titles.get(f.rel);
    return `- ${day(f.mtimeMs)} · \`${f.rel}\`${title ? ` — "${title}"` : ''}`;
  }).join('\n')}\n\n`);

  if (scan.secrets.length) {
    w.push(`## Credential-looking paths — never read, never copied\n\n${scan.secrets.slice(0, 20)
      .map((s) => `- \`${s.rel}\` (${s.why})`).join('\n')}\n\n`
      + 'Matched on file name only, so a false positive is possible. Nothing here was opened. Connections belong in Settings, never in a context file.\n\n');
  }

  w.push('## Next\n\nNothing has been copied. Nothing will be until a proposal says so, row by row:\n\n'
    + '```\nSource: ' + fwd(rootDir) + '\n'
    + '- [x] `<folder-or-file in this source>` → `<projects|areas|resources|archive>/<slug>`\n'
    + '```\n\nThen: `node core/ops/import-brain.cjs apply --proposal <file> --dry-run`\n');
  log(w.done());
}


function parseProposal(md) {
  const source = /^\s*Source:\s*(.+?)\s*$/m.exec(md);
  const rows = [];
  const re = /^[ \t]*[-*] \[[xX]\][ \t]*`?([^`\n→]+?)`?[ \t]*(?:→|->)[ \t]*`?([^`\n]+?)`?[ \t]*$/gm;
  let m;
  while ((m = re.exec(md))) rows.push({ src: m[1].trim().replace(/\/+$/, ''), dest: m[2].trim().replace(/\/+$/, '') });
  return { source: source ? source[1].trim() : null, rows };
}

function inside(parent, child) {
  const rel = path.relative(parent, child);
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}

function copyTree(srcAbs, destDir, tally) {
  const stack = [{ abs: srcAbs, rel: '' }];
  while (stack.length) {
    const here = stack.pop();
    let entries;
    try { entries = fs.readdirSync(here.abs, { withFileTypes: true }); } catch { tally.unreadable++; continue; }
    for (const entry of entries) {
      const abs = path.join(here.abs, entry.name);
      const rel = here.rel ? path.join(here.rel, entry.name) : entry.name;
      if (entry.isSymbolicLink()) { tally.symlinks++; continue; }
      if (entry.isDirectory()) {
        if (IGNORE_DIRS.has(entry.name)) { tally.tooling++; continue; }
        if (SECRET_DIR_RE.test(entry.name)) { tally.credentials++; continue; }
        stack.push({ abs, rel });
        continue;
      }
      if (!entry.isFile()) continue;
      if (IGNORE_FILES.has(entry.name)) continue;
      if (SECRET_FILE_RE.test(entry.name)) { tally.credentials++; tally.credentialNames.push(fwd(rel)); continue; }
      copyFile(abs, path.join(destDir, rel), tally);
    }
  }
}

function copyFile(srcAbs, destAbs, tally) {
  if (fs.existsSync(destAbs)) { tally.existing++; return; }
  if (tally.dryRun) { tally.copied++; return; }
  try {
    fs.mkdirSync(path.dirname(destAbs), { recursive: true });
    fs.copyFileSync(srcAbs, destAbs, fs.constants.COPYFILE_EXCL);
    tally.copied++;
    tally.bytes += fs.statSync(destAbs).size;
  } catch (e) { tally.failed.push(`${fwd(path.basename(srcAbs))}: ${e.code || e.message}`); }
}

function cmdApply(a) {
  const file = val(a.proposal);
  if (!file) die('--proposal <file> is required');
  if (!fs.existsSync(file)) die(`proposal not found: ${file}`);
  const parsed = parseProposal(fs.readFileSync(file, 'utf8'));
  const sourceArg = val(a.dir) || parsed.source;
  if (!sourceArg) die('the proposal has no `Source: <path>` line — pass --dir <path>');
  const source = path.resolve(sourceArg);
  if (!fs.existsSync(source)) die(`source folder not found: ${source}`);
  refusePrivate(source);

  if (!parsed.rows.length) {
    log('Nothing ticked — nothing copied. Tick the rows you want with [x] and re-run.');
    return;
  }

  const dryRun = a['dry-run'] === true;
  const resolver = paths.forRoot(ROOT);
  const created = [];
  const report = [];

  for (const row of parsed.rows) {
    const srcAbs = path.resolve(source, row.src);
    if (!inside(source, srcAbs)) { report.push(`refused ${row.src}: outside the source folder`); continue; }
    if (!fs.existsSync(srcAbs)) { report.push(`missing ${row.src}: not in the source folder`); continue; }
    if (SECRET_FILE_RE.test(path.basename(srcAbs))) { report.push(`refused ${row.src}: credential file name`); continue; }

    const parts = row.dest.split('/').filter(Boolean);
    const bucket = parts[0];
    const slug = parts[1];
    if (!DEST_BUCKETS.has(bucket)) {
      report.push(`refused ${row.dest}: destination must start with ${[...DEST_BUCKETS].join(', ')}`);
      continue;
    }
    if (!slug) { report.push(`refused ${row.dest}: needs a name after ${bucket}/`); continue; }
    if (parts.some((p) => p === '..')) { report.push(`refused ${row.dest}: '..' is not a destination`); continue; }
    const destDir = resolver.ctx(...parts);
    if (!inside(resolver.ctxRoot(bucket), destDir)) { report.push(`refused ${row.dest}: resolves outside the substrate`); continue; }

    const entityType = bucket === 'projects' ? 'project' : bucket === 'areas' ? 'area' : null;
    const isNew = !fs.existsSync(resolver.ctx(bucket, slug));
    if (isNew && entityType) {
      if (dryRun) { created.push({ slug, type: entityType }); }
      else {
        const res = spawnSync(process.execPath, [NEW_CJS, entityType, slug], {
          cwd: ROOT, env: { ...process.env, BRAIN_DIR: paths.forRoot(ROOT).BASE }, encoding: 'utf8',
        });
        if (res.status !== 0) {
          report.push(`skipped ${row.dest}: could not scaffold — ${(res.stderr || res.stdout || '').trim().split('\n')[0]}`);
          continue;
        }
        created.push({ slug, type: entityType, src: row.src });
      }
    } else if (isNew && !dryRun) {
      fs.mkdirSync(destDir, { recursive: true });
    }

    const tally = { copied: 0, existing: 0, credentials: 0, credentialNames: [], tooling: 0, symlinks: 0, unreadable: 0, bytes: 0, failed: [], dryRun };
    if (fs.statSync(srcAbs).isDirectory()) copyTree(srcAbs, destDir, tally);
    else copyFile(srcAbs, path.join(destDir, path.basename(srcAbs)), tally);

    const notes = [];
    if (tally.existing) notes.push(`${tally.existing} already there, left alone`);
    if (tally.credentials) notes.push(`${tally.credentials} credential path(s) refused`);
    if (tally.tooling) notes.push(`${tally.tooling} tooling folder(s) skipped`);
    if (tally.symlinks) notes.push(`${tally.symlinks} symlink(s) skipped`);
    if (tally.failed.length) notes.push(`${tally.failed.length} failed: ${tally.failed.slice(0, 3).join('; ')}`);
    report.push(`${dryRun ? 'would copy' : 'copied'} ${tally.copied} file(s)${tally.bytes ? ` (${bytes(tally.bytes)})` : ''}`
      + ` ${paths.displayPath(fwd(row.src))} → ${paths.displayPath(row.dest)}${notes.length ? ` — ${notes.join('; ')}` : ''}`);
  }

  for (const line of report) log(`  ${line}`);

  if (!created.length) {
    log(dryRun ? '\n(dry run — nothing written)' : '\nDone. No new entity was scaffolded.');
    return;
  }
  if (dryRun) {
    log(`\n(dry run — nothing written; ${created.length} entit${created.length === 1 ? 'y' : 'ies'} would be scaffolded: `
      + created.map((c) => `${c.type}/${c.slug}`).join(', ') + ')');
    return;
  }
  const r = paths.forRoot(ROOT);
  for (const c of created) {
    seedSummary(r.ctx(c.type === 'project' ? 'projects' : 'areas', c.slug, 'card.md'),
      `Imported ${day(Date.now())} from \`${fwd(c.src)}\` in an existing notes folder.`);
  }
  // The imported pages are searchable when this returns: a search answers from the index as it is.
  // One quick pass over the brain's own folder, only when the brain keeps an index.
  try {
    const brainLib = require('../brain/brain.cjs');
    const brain = path.dirname(r.ctx('projects'));
    if (brainLib.isBrain(brain) && brainLib.indexWanted(brain) && brainLib.indexEnabled(brain)) brainLib.refresh(brain, { source: 'brain' });
  } catch (e) { log(`The search index was not updated (${e.message}); \`cogby sync\` does it.`); }
  log(`\n${created.length} entit${created.length === 1 ? 'y' : 'ies'} scaffolded. \`cogby map\` lists them.`);
  log('Next: open each card.md and write the real one-line purpose while it is still fresh. The source folder was not modified.');
}


if (require.main === module) {
  const a = parseArgs(process.argv.slice(2));
  const cmd = a._[0];
  if (cmd === 'survey') cmdSurvey(a);
  else if (cmd === 'apply') cmdApply(a);
  else {
    process.stderr.write(
      'usage: import-brain.cjs survey --dir <path> [--depth 2] [--cap 12000] [--json]\n'
      + '       import-brain.cjs apply --proposal <file> [--dir <path>] [--dry-run]\n');
    process.exit(1);
  }
}

module.exports = {
  walk, shape, spread, sampleNotes, parseProposal, inside, slugify, guessFor,
  SECRET_FILE_RE, SECRET_DIR_RE, DEST_BUCKETS, GUESS,
};
