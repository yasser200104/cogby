'use strict';

// `cogby view`: one snapshot of what a person needs to see of their brain. No model, one read of the
// index: the active projects with the top of their current truth and where work stopped, the last
// lines written anywhere, the pages nothing new has been said about, and the mounted sources. The
// brain-view skill turns this into a page; nothing here draws anything.

const fs = require('fs');
const path = require('path');
const brainLib = require('./brain.cjs');
const { truthText } = require('./page.cjs');
const { staleness, newestEvidence, isoDay, STALE_DAYS } = require('./dream.cjs');

const TRUTH_LINES = 3;
const TRUTH_CHARS = 400;
const RECENT = 10;
const PARKED = 3;
const TIMELINE = 8;
const FILES = 100;

// What a project's card says of itself in its frontmatter: its status (planning, active, on-hold, done,
// or the owner's own word) and the project it is a part of, by folder name. Read from the index.
function cardFields(row) {
  let fm = {};
  try { fm = JSON.parse(row.frontmatter || '{}') || {}; } catch { fm = {}; }
  const word = (value) => (typeof value === 'string' ? value.trim() : '');
  return {
    status: word(fm.status).toLowerCase().replace(/\s+/g, '-').slice(0, 40),
    parent: word(fm.parent).toLowerCase().replace(/\\/g, '/').replace(/\/card$/, '').replace(/^projects\//, '').replace(/\/+$/, '').slice(0, 80),
  };
}

// The files in a project's folder, as the Console's Documents tab listed them: their paths inside the
// folder, newest first, without the card itself or an old progress file. Read from disk, never written.
// Only a project that is a folder with a card has them.
function folderFiles(brain, slug) {
  if (!/\/card$/i.test(slug)) return { count: 0, items: [] };
  const found = [];
  const walk = (dir, rel, depth) => {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      const here = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) { if (depth < 4) walk(path.join(dir, entry.name), here, depth + 1); continue; }
      if (!entry.isFile() || (!rel && /^(card|progress)\.md$/i.test(entry.name))) continue;
      let stat;
      try { stat = fs.statSync(path.join(dir, entry.name)); } catch { continue; }
      found.push({ path: here, size: stat.size, modified: isoDay(stat.mtime) });
    }
  };
  walk(path.join(brain, ...slug.replace(/\/card$/i, '').split('/')), '', 0);
  found.sort((a, b) => (a.modified < b.modified ? 1 : a.modified > b.modified ? -1 : a.path.localeCompare(b.path)));
  return { count: found.length, items: found.slice(0, FILES) };
}

// The first lines of a page's current truth, as prose: no headings, no table, no blank lines.
function opening(truth) {
  const all = truthText(truth).split('\n');
  // What a page says before its first section is its summary; a page that opens on a section is read whole.
  const cut = all.findIndex((line) => /^##\s/.test(line));
  const head = cut > 0 && all.slice(0, cut).some((line) => line.trim() && !/^#\s/.test(line)) ? all.slice(0, cut) : all;
  const lines = head.map((line) => line.trim()).filter((line) => line && !/^#{1,6}\s/.test(line) && !/^[-=*_]{3,}$/.test(line));
  const text = lines.slice(0, TRUTH_LINES).join(' ');
  return text.length > TRUTH_CHARS ? `${text.slice(0, TRUTH_CHARS).replace(/\s+\S*$/, '')} …` : text;
}

// The text under one `## Heading` of a page, for a project card's `## Now` and `## Next`. A line that
// is only a bracketed hint, as the template leaves them, is not something anyone wrote.
function section(truth, name) {
  const match = new RegExp(`(?:^|\\n)##\\s+${name}\\b[^\\n]*\\n([\\s\\S]*?)(?=\\n##\\s|$)`, 'i').exec(truth);
  return match ? match[1].trim().split('\n').map((line) => line.trim()).filter((line) => line && !/^(?:[-*+]\s+)?\([^()]*\)$/.test(line)).slice(0, 4).join(' ').slice(0, TRUTH_CHARS) : '';
}

// One row per project: a `projects/<name>/card` page, a single-file `projects/<name>` page, or any
// page that says `type: project`, wherever it is. A brain from before projects had one card may
// still keep a project's Now and Next in a second file beside the card: that file is part of its row.
function projectRows(db) {
  const rows = db.prepare("SELECT * FROM pages WHERE source_id = 'brain' AND type = 'project' ORDER BY slug").all();
  const cards = rows.filter((row) => !/(^|\/)progress$/i.test(row.slug) && !/^archive\//i.test(row.slug));
  const folder = (slug) => slug.replace(/\/card$/i, '');
  // A project folder is one project: its card, or the first page in it when it has no card.
  const chosen = new Map();
  for (const row of cards) {
    const owner = /^projects\/[^/]+/i.exec(row.slug);
    const id = (owner ? owner[0] : row.slug).toLowerCase();
    if (!chosen.has(id) || /\/card$/i.test(row.slug)) chosen.set(id, row);
  }
  return [...chosen.values()].map((row) => ({ row, folder: folder(row.slug), progress: rows.find((other) => other.slug.toLowerCase() === `${folder(row.slug).toLowerCase()}/progress`) || null }));
}

function view(brain, options = {}) {
  const now = options.now ? new Date(options.now) : new Date();
  const today = isoDay(now);
  const sources = brainLib.sourceStatus(brain);
  const local = brainLib.readLocal(brain);
  const linked = require('./link.cjs').linkedFolders(brain);
  // What Cogby left for the owner, and what it did without asking (core/brain/notify.cjs).
  const notifications = require('./notify.cjs').forView(brain, now);
  // The owner's own lists: open to-dos, what was ticked today, and the newest notes (core/brain/todo.cjs).
  const lists = require('./todo.cjs').forView(brain, now);
  return brainLib.withIndex(brain, (db, stats) => {
    // The newest lines of a project's page: the first few are where work stopped, the rest its dashboard's timeline.
    // Not the records of a command (a folder linked): they are not where work stopped.
    const lines = db.prepare('SELECT date, source, summary, author, actor, confirmed FROM timeline_entries WHERE page_id = ? AND retracted = 0 AND record = 0 ORDER BY date DESC, rowid DESC LIMIT ?');
    const owed = db.prepare("SELECT claim, row_num, source FROM facts WHERE page_id = ? AND kind = 'commitment' AND superseded_by IS NULL AND expired_at IS NULL AND retracted_at IS NULL ORDER BY row_num");
    const projects = projectRows(db).map(({ row, folder, progress }) => {
      const stale = staleness(db, row, today);
      const timeline = lines.all(row.id, TIMELINE).map((line) => ({ ...line }));
      return {
        slug: row.slug, name: folder.split('/').at(-1), title: row.title, revision: row.revision,
        ...cardFields(row),
        files: folderFiles(brain, row.slug),
        truth: opening(row.truth),
        updated: newestEvidence(db, row.id) || row.updated_at.slice(0, 10),
        last_evidence: newestEvidence(db, row.id),
        stale: !!stale, days_quiet: stale ? stale.days : null,
        parking_spot: timeline.slice(0, PARKED),
        timeline,
        now: section(row.truth, 'Now') || (progress ? section(progress.truth, 'Now') : ''),
        next: section(row.truth, 'Next') || (progress ? section(progress.truth, 'Next') : ''),
        commitments: owed.all(row.id).map((fact) => ({ ...fact })),
        // The first folder linked to it on this machine (`cogby places` lists them all).
        repo: (linked.find((entry) => entry.page === row.slug) || {}).path || null,
        // How many notifications wait on this project (their `context` names it), and how long since it moved.
        waiting: notifications.waiting.filter((entry) => names(entry.context, row.slug, folder)).length,
      };
    }).sort((a, b) => (a.updated < b.updated ? 1 : a.updated > b.updated ? -1 : a.slug < b.slug ? -1 : 1));

    // Not a meeting record's own line: the pages the meeting touched each carry a line linking to it.
    const recent = db.prepare(
      `SELECT t.date, t.source, t.summary, t.author, t.actor, t.confirmed, p.slug, p.title FROM timeline_entries t JOIN pages p ON p.id = t.page_id
        WHERE p.source_id = 'brain' AND p.type NOT IN ('routine', 'meeting') AND t.retracted = 0 AND t.record = 0 ORDER BY t.date DESC, t.rowid DESC LIMIT ?`,
    ).all(RECENT).map((line) => ({ ...line }));

    const stale = db.prepare("SELECT id, slug, title, type FROM pages WHERE source_id = 'brain' AND type != 'routine' ORDER BY slug").all()
      .map((row) => { const flag = staleness(db, row, today); return flag ? { slug: row.slug, title: row.title, type: row.type, newest: flag.newest, days: flag.days } : null; })
      .filter(Boolean);

    const one = (sql) => db.prepare(sql).get().n;
    return {
      brain, generated_at: now.toISOString(), today, index: stats.index, index_as_of: stats.synced_at || null, stale_after_days: STALE_DAYS,
      counts: {
        pages: one("SELECT COUNT(*) AS n FROM pages WHERE source_id = 'brain'"),
        timeline_lines: one("SELECT COUNT(*) AS n FROM timeline_entries t JOIN pages p ON p.id = t.page_id WHERE p.source_id = 'brain'"),
        facts: one("SELECT COUNT(*) AS n FROM facts f JOIN pages p ON p.id = f.page_id WHERE p.source_id = 'brain' AND f.superseded_by IS NULL AND f.expired_at IS NULL AND f.retracted_at IS NULL"),
        // What an agent wrote that the owner has not confirmed (core/brain/confirm.cjs).
        unconfirmed: require('./confirm.cjs').count(db).total,
        projects: projects.length, sources: sources.sources.length,
      },
      projects: projects.map((project) => ({ ...project, days_since: daysBetween(project.updated, today) })), recent, stale, sources: sources.sources,
      notifications,
      todos: lists.todos, notes: lists.notes,
      // The decision log, as far as a check-in needs it: the ones whose review date has come, how many
      // were made today, and the last seven days counted by who made the call (core/brain/decisions.cjs).
      decisions: require('./decisions.cjs').forView(db, today),
      // The owner's routines that are due, and how far Cogby goes on its own about them (core/brain/routines.cjs).
      routines: require('./routines.cjs').forView(db, brain, now),
      // Where the page was last published, when it was: the skill updates that one, never a new one.
      artifact: local.view && typeof local.view.artifact === 'string' ? local.view.artifact : null,
      // Where a project's own dashboard page was published, for the projects that have one: folder name to link.
      dashboards: dashboards(local),
      // Whether the page is made without being asked for: after onboarding and at each wrap-up. On unless
      // the person turned it off (`cogby view auto off`).
      auto: autoOn(local),
    };
  });
}

// A notification is about a project when its context is the project's slug, its folder, or its
// folder's name: `projects/harbor/card`, `projects/harbor` and `harbor` all name Harbor.
function names(context, slug, folder) {
  const key = String(context || '').trim().toLowerCase().replace(/\\/g, '/').replace(/\/+$/, '');
  if (!key) return false;
  return [slug, folder, folder.split('/').at(-1)].some((name) => key === String(name).toLowerCase());
}

function daysBetween(day, today) {
  const from = Date.parse(`${day}T00:00:00Z`);
  const to = Date.parse(`${today}T00:00:00Z`);
  return Number.isNaN(from) || Number.isNaN(to) ? null : Math.max(0, Math.round((to - from) / 86400000));
}

// The view is kept up to date on its own unless the person says otherwise. Machine-local, like the
// index switch: `view.auto: false` in .cogby/local.json, absent meaning on.
const autoOn = (local) => !(local.view && local.view.auto === false);

function autoStatus(brain) {
  const local = brainLib.readLocal(brain);
  return { auto: autoOn(local), artifact: local.view && typeof local.view.artifact === 'string' ? local.view.artifact : null };
}

function setAuto(brain, on) {
  const local = brainLib.readLocal(brain);
  const view = { ...(local.view || {}) };
  if (on) delete view.auto; else view.auto = false;
  if (Object.keys(view).length) local.view = view; else delete local.view;
  brainLib.writeLocal(brain, local);
  return { ...autoStatus(brain), switched: on ? 'on' : 'off' };
}

const dashboards = (local) => Object.fromEntries(Object.entries((local.view && local.view.dashboards) || {}).filter(([, link]) => typeof link === 'string'));

// Records where the view page was published, on this machine only. With a project, where that
// project's own dashboard page was.
function setArtifact(brain, url, project) {
  const given = String(url || '').trim();
  const text = given === 'none' ? '' : given;
  if (text && !/^https:\/\/\S+$/.test(text)) throw new brainLib.BrainError('BAD_URL', `"${text}" is not an https link.`, 'Pass the artifact link as it was given back, or "none" to forget it.');
  const local = brainLib.readLocal(brain);
  // The link and when it was set; the auto switch beside them is the person's and is kept.
  const view = { ...(local.view || {}) };
  const name = String(project || '').trim().toLowerCase();
  if (name) {
    const all = { ...dashboards(local) };
    if (text) all[name] = text; else delete all[name];
    if (Object.keys(all).length) view.dashboards = all; else delete view.dashboards;
  } else if (text) { view.artifact = text; view.set = new Date().toISOString(); } else { delete view.artifact; delete view.set; }
  if (Object.keys(view).length) local.view = view; else delete local.view;
  brainLib.writeLocal(brain, local);
  return { artifact: text || null, ...(name ? { project: name } : {}) };
}

module.exports = { view, setArtifact, setAuto, autoStatus, opening, section };
