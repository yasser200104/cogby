'use strict';

// Every change to a page goes through writePage, and nothing else in core/brain writes one. That is
// on purpose, for the shared brain that comes later: one function is one place to check who may
// write, and the revision it bumps is how a second writer finds out the page moved under them.
//
// A session writes evidence only: `log` appends a timeline line, `remember` adds a row to the facts
// table. Neither touches the current truth at the top of the page. Both refuse without a source,
// both record who wrote the line and whether a person or an agent did, and both end in a commit of
// that one file in the brain's own repository.

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { BrainError } = require('./db.cjs');
const { withIndex, lookup, nearest, indexFile, resolveLinks, pageFile, deletePage } = require('./brain.cjs');
const page = require('./page.cjs');
const { gitIn, ownRepository } = require('../lib/brain-repo.cjs');

const LOCK = ['.cogby', 'write.lock'];
const LOCK_WAIT_MS = 8000;
const LOCK_STALE_MS = 30000;

const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
const normClaim = (text) => String(text || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

function overlap(a, b) {
  const x = new Set(a.split(' ').filter(Boolean));
  const y = new Set(b.split(' ').filter(Boolean));
  if (!x.size || !y.size) return 0;
  let shared = 0;
  for (const word of x) if (y.has(word)) shared++;
  return shared / (x.size + y.size - shared);
}

// A command run from inside an agent's session, and which agent: null when it is not one, else the
// agent's name ('' when it has none that can be written). Claude Code sets CLAUDECODE in every shell
// it starts: that is `claude-code`. Any other agent says so with COGBY_AGENT=<its name>. That
// variable can only make a write an agent's, never a person's.
function sessionAgent(env = process.env) {
  if (String(env.CLAUDECODE || '').trim()) return 'claude-code';
  if (String(env.COGBY_AGENT || '').trim()) return page.agentName(env.COGBY_AGENT);
  return null;
}
const inSession = (env = process.env) => sessionAgent(env) !== null;

// Who is writing. A person's line counts as confirmed, an agent's does not until the owner says so
// (`cogby confirm`).
//
// Inside an agent's session the writer is an agent, whatever the caller says: `--human`,
// `actor: 'human'` and COGBY_ACTOR=human are not honoured there, because the one who would pass
// them is the agent itself. So is anything that came in over the tool server, which passes
// `actor: 'agent'` on every write. Outside a session (a person at their own terminal) the line is
// a person's, unless the caller says it is an agent's (`--agent`, COGBY_ACTOR=agent).
//
// Which agent is said when Cogby knows (`agent_name`): the name the tool server's client gave when
// it connected (`options.agentName`, set by mcp.cjs and by nothing a caller types), else the
// session's (sessionAgent above). Otherwise none: the line ends in `agent` alone.
//
// Tests simulate either side through `options.env`: with CLAUDECODE set, and without it.
function writer(brain, options = {}) {
  const env = options.env || process.env;
  let author = options.author || env.COGBY_AUTHOR;
  if (!author) { const name = gitIn(brain)('config', 'user.name'); author = name.ok && name.out ? name.out : ''; }
  if (!author) { try { author = os.userInfo().username; } catch { author = 'unknown'; } }
  const said = options.actor === 'agent' || options.actor === 'human' ? options.actor : (env.COGBY_ACTOR === 'agent' ? 'agent' : 'human');
  const session = sessionAgent(env);
  const actor = session !== null ? 'agent' : said;
  const agent_name = actor === 'agent' ? (page.agentName(options.agentName) || session || '') : '';
  return { author: page.oneLine(author).replace(/[[\]·|]/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase() || 'unknown', actor, agent_name, confirmed: actor === 'human' };
}

// Who ran a command of Cogby's own that leaves a line behind (a folder linked, a routine added,
// paused or run). The line says who and whether a person or an agent ran it, and ends in `record`:
// it is the record of that command, not a claim, so it is never unconfirmed (page.cjs). Only
// link.cjs and routines.cjs ask for this; `log` and `remember` always go through writer().
const recorder = (brain, options = {}) => ({ ...writer(brain, options), record: true });

// True when the caller asked to be read as a person and is not: the CLI says so once, so an agent
// that passed --human learns why its line came out unconfirmed.
const humanRefused = (options = {}) => {
  const env = options.env || process.env;
  return inSession(env) && (options.actor === 'human' || (options.actor !== 'agent' && env.COGBY_ACTOR === 'human'));
};

function withLock(brain, work) {
  const file = path.join(brain, ...LOCK);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const deadline = Date.now() + LOCK_WAIT_MS;
  for (;;) {
    try { fs.closeSync(fs.openSync(file, 'wx')); break; }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      let age = 0;
      try { age = Date.now() - fs.statSync(file).mtimeMs; } catch { continue; }
      if (age > LOCK_STALE_MS) { try { fs.rmSync(file, { force: true }); } catch { /* another writer took it */ } continue; }
      if (Date.now() > deadline) throw new BrainError('BUSY', 'Another write to this brain is in progress.', 'Try again in a moment.');
      sleep(40);
    }
  }
  try { return work(); } finally { try { fs.rmSync(file, { force: true }); } catch { /* gone already */ } }
}

// A slug a new page may be created at: inside the brain, markdown, nothing hidden.
function newSlug(ref) {
  const slug = String(ref || '').trim().replace(/\\/g, '/').replace(/\.md$/i, '').replace(/^\/+|\/+$/g, '');
  const parts = slug.split('/');
  if (!slug || parts.some((part) => !part || part === '.' || part === '..' || part.startsWith('.') || /[<>:"|?*\x00-\x1f]/.test(part))) {
    throw new BrainError('BAD_SLUG', `"${ref}" cannot be a page.`, 'A page is a path inside the brain, like projects/acme.');
  }
  return slug;
}

function commitFile(brain, rel, message) {
  const own = ownRepository(brain);
  if (!own.repo) {
    return { committed: false, why: own.prefix ? 'the brain sits inside another git repository, so its history is that repository\'s' : 'the brain is not a git repository (run `git init` in it, or `cogby init`)' };
  }
  const git = gitIn(brain);
  const add = git('add', '--', rel);
  if (!add.ok) return { committed: false, why: `git add: ${add.err || 'failed'}` };
  const identity = git('config', 'user.name').out && git('config', 'user.email').out ? [] : ['-c', 'user.name=Cogby', '-c', 'user.email=cogby@localhost'];
  const commit = git(...identity, '-c', 'commit.gpgsign=false', 'commit', '-q', '--no-verify', '-m', message, '--', rel);
  if (!commit.ok) return { committed: false, why: `git commit: ${commit.err || 'failed'}` };
  return { committed: true, sha: git('rev-parse', '--short', 'HEAD').out };
}

// A page of the brain the index has not seen yet: a file made by hand since the last sync. The
// index is not brought up to date before a write, so the write looks on disk itself, at the two
// places a slug can be: <slug>.md, and the card of the folder <slug>.
function onDisk(brain, ref) {
  let slug;
  try { slug = newSlug(ref); } catch { return null; }
  for (const rel of [`${slug}.md`, `${slug}/card.md`]) {
    try { return { rel, text: fs.readFileSync(path.join(brain, ...rel.split('/')), 'utf8') }; } catch { /* not there */ }
  }
  return null;
}

// The one write. `mutate(parsed)` changes the parsed page in place and returns { changed, message,
// ...whatever the caller wants back }; when it reports no change, nothing is written.
//
// The index is read as it is, never synced first, so the page's text always comes from its file:
// the index only says which file a name means. A file the index has not seen is found on disk, and
// a row whose file is gone is dropped, so a write behaves the same whether or not a sync has run.
function writePage(brain, ref, mutate, options = {}) {
  return withLock(brain, () => withIndex(brain, (db) => {
    const brainSource = { id: 'brain', path: brain, mode: 'write' };
    // `other-source:slug` names a page outside the brain: found below, and refused.
    const found = lookup(db, ref, { source: 'brain' });
    let row = found && found.source_id === 'brain' ? found : null;
    let created = false;
    let rel;
    let text;
    if (row) {
      rel = row.path;
      try { text = fs.readFileSync(pageFile(db, row), 'utf8'); }
      catch (error) {
        if (error.code !== 'ENOENT') throw error;
        deletePage(db, row.id);
        row = null;
      }
    }
    const unseen = row ? null : onDisk(brain, ref);
    if (unseen) ({ rel, text } = unseen);
    if (!row && !unseen) {
      const elsewhere = lookup(db, ref);
      if (elsewhere) throw new BrainError('READ_ONLY', `"${ref}" is in the read-only source "${elsewhere.source_id}".`, 'Only the brain\'s own pages are written. Log it on a page in the brain and name this file as the source.');
      if (!options.create) {
        const near = nearest(db, ref);
        throw new BrainError('NOT_FOUND', `No page "${ref}" in the brain.`, `${near.length ? `Closest: ${near.join(', ')}. ` : ''}To start a new page there, pass --create.`);
      }
      const slug = newSlug(ref);
      rel = `${slug}.md`;
      const stub = page.parsePage(rel, '');
      text = `---\ntype: ${stub.type}\ntitle: ${options.title || stub.title}\n---\n`;
      created = true;
    }
    const parsed = page.parsePage(rel, text);
    if (options.expectedRevision != null && Number(options.expectedRevision) !== parsed.revision) {
      throw new BrainError('CONFLICT', `${parsed.slug} is at revision ${parsed.revision}, not ${options.expectedRevision}.`, 'Read the page again with `cogby get`, then retry.');
    }
    const outcome = mutate(parsed) || {};
    if (!outcome.changed) return { ...outcome, source: 'brain', slug: parsed.slug, revision: parsed.revision, created: false, commit: { committed: false, why: 'nothing changed' } };

    const revision = parsed.revision + 1;
    parsed.fmRaw = page.setField(parsed.fmRaw, 'revision', revision);
    const next = page.renderPage(parsed);
    const abs = path.join(brain, ...rel.split('/'));
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    // All or nothing. The file goes into place first, because the index records its size and time;
    // when indexing then fails (the database held by a sync for longer than it waits, a full disk),
    // the file is put back as it was, or removed when this write made it, and the error is the
    // answer: nothing changed, on disk or in the index, and nothing is left to commit.
    let before = null;
    try { before = fs.readFileSync(abs); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    const tmp = `${abs}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, next);
    fs.renameSync(tmp, abs);

    try {
      const stat = fs.statSync(abs);
      db.exec('BEGIN');
      try {
        indexFile(db, brainSource, { rel, size: stat.size, mtimeMs: Math.floor(stat.mtimeMs) }, next, crypto.createHash('sha1').update(next).digest('hex'));
        resolveLinks(db);
        db.exec('COMMIT');
      } catch (error) { try { db.exec('ROLLBACK'); } catch { /* keep the first error */ } throw error; }
    } catch (error) {
      putBack(abs, rel, before, error);
      throw error;
    }

    // A commit that fails after a good index does not undo the write. The file and the index agree,
    // and the line is evidence: taking it back because git refused (a hook, a lock, no identity)
    // would lose it over a problem with the history, not with the write. The result says
    // `committed: false` and why, the CLI prints it, and the file stays changed in the working tree
    // for the next commit of that page or the wrap-up to pick up.
    const by = options.by ? ` [${page.renderBy(options.by)}]` : '';
    const commit = commitFile(brain, rel, `${outcome.message || `write: ${parsed.slug}`}${by}`);
    return { ...outcome, source: 'brain', slug: parsed.slug, revision, created, path: abs, commit };
  }));
}

// The file as it was before a write that could not be indexed. When that cannot be done either, the
// error says so: the page is then changed on disk, not indexed and not committed.
function putBack(abs, rel, before, cause) {
  try {
    if (before === null) { fs.rmSync(abs, { force: true }); return; }
    const tmp = `${abs}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, before);
    fs.renameSync(tmp, abs);
  } catch (error) {
    throw new BrainError('WRITE_HALF_DONE', `${rel} was written but could not be indexed (${cause.message}), and could not be put back (${error.message}).`,
      'The file is changed on disk, not indexed and not committed. Look at it with `git diff` in the brain, then run `cogby sync`.');
  }
}

function requireSource(source, command) {
  const text = page.oneLine(source);
  if (!text) {
    throw new BrainError('SOURCE_REQUIRED', `${command} needs a source: where this comes from.`,
      `Add --source "<evidence>", for example --source "call with Sara 2026-11-05" or --source "commit 3f2a1c".`);
  }
  return text;
}

// The day's log, `.cogby/self/log/<date>.md`, named `log:<date>` or `log:today`. It is the hook's
// file, and the one thing written to it from here is a decision that is about no page in
// particular (and, later, how that decision turned out).
const DAY_LOG_RE = /^log:(today|\d{4}-\d{2}-\d{2})$/i;
const LOG_DIR = ['.cogby', 'self', 'log'];

// One line added to the day's log, below a timeline marker it is given when it has none. Appended,
// never rewritten: the hook that keeps the log appends to the same file while a session runs. Not
// committed here: the day's log is committed once, when the session ends (commitDayLogs below).
function logDay(brain, day, entry, by, check) {
  return withLock(brain, () => withIndex(brain, (db) => {
    const dir = path.join(brain, ...LOG_DIR);
    const file = path.join(dir, `${day}.md`);
    let had = '';
    try { had = fs.readFileSync(file, 'utf8'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    const parsed = page.parsePage(`${day}.md`, had);
    if (check) check(parsed);
    const slug = `log:${day}`;
    if (parsed.timeline.some((line) => line.date === entry.date && line.source === entry.source && line.summary === entry.summary)) {
      return { changed: false, status: 'duplicate', line: null, source: 'log', slug, revision: 0, created: false, commit: { committed: false, why: 'nothing changed' } };
    }
    const text = page.renderTimelineLine({ ...entry, ...by });
    const lead = had ? (had.endsWith('\n') ? '' : '\n') : `# ${day}\n`;
    fs.mkdirSync(dir, { recursive: true });
    const existed = fs.existsSync(file);
    const added = `${lead}${parsed.hasMarker ? '' : `\n${page.MARKER}\n`}${text}\n`;
    fs.appendFileSync(file, added);
    // All or nothing, as in writePage: when the line cannot be indexed it is taken back out.
    try {
      const next = fs.readFileSync(file, 'utf8');
      const stat = fs.statSync(file);
      db.exec('BEGIN');
      try {
        db.prepare("INSERT OR IGNORE INTO sources (id, path, remote, mode, in_default_search, synced_at) VALUES ('log', ?, NULL, 'read-only', 0, NULL)").run(dir);
        indexFile(db, { id: 'log', path: dir, mode: 'read-only' }, { rel: `${day}.md`, size: stat.size, mtimeMs: Math.floor(stat.mtimeMs) }, next, crypto.createHash('sha1').update(next).digest('hex'));
        db.exec('COMMIT');
      } catch (error) { try { db.exec('ROLLBACK'); } catch { /* keep the first error */ } throw error; }
    } catch (error) {
      takeBack(file, added, existed, error);
      throw error;
    }
    return { changed: true, status: 'inserted', line: text, source: 'log', slug, revision: 0, created: !had, path: file,
      commit: { committed: false, why: 'the day\'s log is committed when the session ends' } };
  }));
}

// What logDay appended, taken out again. Only those bytes: the hook appends to the same file while
// a session runs, so the file is never put back whole. They are cut off the end when they are still
// the end, and cut out of the middle when the hook has written since.
function takeBack(file, added, existed, cause) {
  try {
    const now = fs.readFileSync(file);
    const chunk = Buffer.from(added);
    const at = now.lastIndexOf(chunk);
    if (at === -1) return;
    if (at === 0 && now.length === chunk.length && !existed) fs.rmSync(file, { force: true });
    else if (at + chunk.length === now.length) fs.truncateSync(file, at);
    else fs.writeFileSync(file, Buffer.concat([now.subarray(0, at), now.subarray(at + chunk.length)]));
  } catch (error) {
    throw new BrainError('WRITE_HALF_DONE', `The day's log was written but could not be indexed (${cause.message}), and the line could not be taken back (${error.message}).`,
      `The line is in ${file}, not indexed. Run \`cogby sync\`.`);
  }
}

// The day's log reaches the brain's history when a session ends, with no model and no wrap-up: the
// session-end hook calls this for a session that ran in the brain or in a place that keeps the log.
// Every day file with something uncommitted in it is committed, each alone: today's, and an earlier
// day's that a session which never ended cleanly left behind. Behind the write lock, like every
// other commit Cogby makes; nothing is pushed. Returns one entry per file: { file, committed, … }.
const DAY_FILE = /^\d{4}-\d{2}-\d{2}\.md$/;
function commitDayLogs(brain, logDir = path.join(brain, ...LOG_DIR)) {
  if (!ownRepository(brain).repo) return [];
  const rel = path.relative(brain, logDir).split(path.sep).join('/');
  if (!rel || rel.startsWith('..')) return [];
  const status = gitIn(brain)('status', '--porcelain', '--untracked-files=all', '--', rel);
  if (!status.ok || !status.out) return [];
  // The path is read from where the log folder starts in the line, not from a fixed column: the
  // first line of the output reaches here with its leading space trimmed.
  const files = status.out.split(/\r?\n/).map((line) => { const at = line.indexOf(`${rel}/`); return at === -1 ? '' : line.slice(at).replace(/"$/, ''); })
    .filter((file) => file && DAY_FILE.test(file.slice(rel.length + 1))).sort();
  if (!files.length) return [];
  return withLock(brain, () => files.map((file) => ({ file, ...commitFile(brain, file, `day log: ${path.basename(file, '.md')}`) })));
}

// One dated line added to a page's timeline, or to the day's log. `options.check(parsed)` may refuse
// the write after reading the page as it is on disk. `log` and a decision's review both end here.
// A line written this way carries a claim: an agent's is unconfirmed, whatever the options say.
const appendLine = (brain, ref, summary, options = {}) => append(brain, ref, summary, options, false);

// The same write for the record of a command (the run of a routine): the line ends in `record`. Not
// reachable from `log`: it is a different function, not an option.
const appendRecord = (brain, ref, summary, options = {}) => append(brain, ref, summary, options, true);

function append(brain, ref, summary, options, record) {
  // Cleaned here as the line will hold it, so the same line given twice is still seen as the same.
  const source = page.cleanSource(requireSource(options.source, options.command || 'log'));
  const day = DAY_LOG_RE.exec(String(ref || '').trim());
  const logDate = day ? (day[1].toLowerCase() === 'today' ? today() : day[1]) : null;
  if (logDate && !page.isDate(logDate)) throw new BrainError('BAD_DATE', `"${logDate}" is not a date.`, 'Use log:YYYY-MM-DD or log:today.');
  const date = options.date || logDate || today();
  if (!page.isDate(date)) throw new BrainError('BAD_DATE', `"${date}" is not a date.`, 'Use YYYY-MM-DD.');
  const by = record ? recorder(brain, options) : writer(brain, options);
  if (day) {
    if (!page.isDecision(summary) && !page.parseReview(summary) && !page.parseWho(summary)) {
      throw new BrainError('READ_ONLY', 'The day\'s log is written by a hook, not by hand.', 'Only a decision about no page in particular is logged there: add --decision. Anything else goes on the page it is about.');
    }
    return logDay(brain, logDate, { date, source, summary }, by, options.check);
  }
  return writePage(brain, ref, (parsed) => {
    if (options.check) options.check(parsed);
    const same = parsed.timeline.some((entry) => !entry.retracted && entry.date === date && entry.source === source && entry.summary === summary);
    if (same) return { changed: false, status: 'duplicate', line: null };
    const text = page.renderTimelineLine({ date, source, summary, ...by });
    parsed.timelineText = page.insertTimelineLine(parsed.timelineText, text, date);
    parsed.hasMarker = true;
    // `id` is how this line is named again, to confirm or retract it (core/brain/confirm.cjs).
    return { changed: true, status: 'inserted', line: text, id: require('./confirm.cjs').lineId({ date, source, summary }), message: `log(${parsed.slug}): ${summary.slice(0, 72)}` };
  }, { ...options, by });
}

// Appends one dated line to a page's timeline. `decision: true` marks the line as a decision: its
// summary starts with `decision:`, which is how a decision is found again. A decision may also say
// who made the call (`who`: owner, accepted, overrode, agent), what is expected of it (`expect`) and when
// to look again (`review`, a date); those travel in the line (page.cjs asDecision).
function log(brain, ref, line, options = {}) {
  requireSource(options.source, 'log');
  const said = page.oneLine(line);
  const meta = { who: options.who ? String(options.who).toLowerCase() : '', expect: page.oneLine(options.expect), review: options.review || '' };
  if ((meta.who || meta.expect || meta.review) && !options.decision) {
    throw new BrainError('USAGE', 'who, expect and review describe a decision.', 'Add --decision (tool: decision: true), or leave them out.');
  }
  if (meta.who && !page.WHO.includes(meta.who)) throw new BrainError('BAD_WHO', `"${options.who}" is not who made the call.`, `Use one of: ${page.WHO.join(', ')} (the owner on their own, accepted Claude's suggestion, overrode it, or an agent alone on something the owner did not see).`);
  if (meta.review && !page.isDate(meta.review)) throw new BrainError('BAD_DATE', `"${meta.review}" is not a date.`, 'A review date is YYYY-MM-DD.');
  const summary = said && options.decision ? page.asDecision(said, meta) : said;
  if (!said || (options.decision && !page.parseDecision(summary).text)) throw new BrainError('EMPTY', 'log needs a line to write.', 'cogby log <page> "<what happened>" --source "<evidence>"');
  // A line that says who made an earlier call (`who: accepted, decision of <date> #<id>`) is written
  // only when it can be read back and the decision it points at is on this page: a mistyped one
  // would sit there unread, and the decision would stay "not recorded".
  if (!options.decision && /^who:\s/i.test(said) && /decision of/i.test(said)) {
    const points = page.parseWho(said);
    if (!points) throw new BrainError('BAD_WHO', 'That line does not say who made a call in a form the decision log reads.', `Write it as: who: ${page.WHO.join('|')}, decision of YYYY-MM-DD #<id> (the date and id are in \`cogby decisions\`).`);
    const { idOf } = require('./decisions.cjs');
    const also = options.check;
    return appendLine(brain, ref, summary, { ...options, check: (parsed) => {
      if (also) also(parsed);
      if (!parsed.timeline.some((entry) => !entry.retracted && entry.date === points.date && idOf(entry) === points.id)) {
        throw new BrainError('NOT_FOUND', `No decision #${points.id} of ${points.date} on ${parsed.slug || ref}.`, 'Write the line on the page the decision is on; `cogby decisions --who none` lists each with its page, date and id.');
      }
    } });
  }
  return appendLine(brain, ref, summary, options);
}

// Saves one sourced claim as a row in the page's facts table. Nothing is ever removed: a claim that
// replaces another marks the old row superseded.
//
// A row is superseded only when `replaces` names it, never on a guess: two claims that share half
// their words ("Sara's email is …", "Tom's email is …") are as often two facts as one corrected.
// With no `replaces` the claim is added, and an active row of the same kind that looks like it is
// named in the result (`similar_row`, `similar_claim`) so the caller can say so. Passing the same
// claim again with `replaces` then retires that row without writing the claim a second time.
function remember(brain, ref, claim, options = {}) {
  const source = requireSource(options.source, 'remember');
  const text = page.oneLine(claim);
  if (!text) throw new BrainError('EMPTY', 'remember needs a claim.', 'cogby remember <page> "<one claim>" --source "<evidence>"');
  const kind = options.kind || 'fact';
  if (!page.KINDS.includes(kind)) throw new BrainError('BAD_KIND', `"${kind}" is not a kind of fact.`, `Use one of: ${page.KINDS.join(', ')}.`);
  for (const key of ['validFrom', 'validUntil']) {
    if (options[key] && !page.isDate(options[key])) throw new BrainError('BAD_DATE', `"${options[key]}" is not a date.`, 'Use YYYY-MM-DD.');
  }
  const by = writer(brain, options);
  return writePage(brain, ref, (parsed) => {
    const facts = parsed.facts;
    const active = facts.filter(page.isActive);
    const wanted = normClaim(text);
    const same = active.find((fact) => normClaim(fact.claim) === wanted);
    let old = null;
    if (options.replaces != null) {
      old = active.find((fact) => fact.row === Number(options.replaces)) || null;
      if (!old && !same) throw new BrainError('NO_FACT', `No active fact #${options.replaces} on ${parsed.slug}.`, 'See the rows with `cogby get`.');
      if (old === same) old = null;
    }
    if (same && !old) return { changed: false, status: 'duplicate', row: same.row };
    let similar = null;
    if (!old) {
      let best = 0;
      for (const fact of active) {
        const score = fact.kind === kind ? overlap(normClaim(fact.claim), wanted) : 0;
        if (score >= 0.5 && score > best) { best = score; similar = fact; }
      }
    }
    const row = same ? same.row : facts.reduce((max, fact) => Math.max(max, fact.row), 0) + 1;
    if (old) old.superseded_by = row;
    if (!same) facts.push({ row, claim: text, kind, valid_from: options.validFrom || today(), valid_until: options.validUntil || '', source, ...by, recorded: today(), superseded_by: null, expired_at: null, retracted_at: null });
    parsed.truth = page.replaceFacts(parsed.truth, facts);
    return {
      changed: true, status: old ? 'superseded' : 'inserted', row, superseded_row: old ? old.row : null,
      similar_row: similar ? similar.row : null, similar_claim: similar ? similar.claim : null,
      message: `remember(${parsed.slug}): ${text.slice(0, 72)}`,
    };
  }, { ...options, by });
}

module.exports = { writePage, commitDayLogs, appendLine, appendRecord, log, remember, writer, recorder, inSession, sessionAgent, humanRefused, commitFile, withLock };
