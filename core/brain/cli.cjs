'use strict';

// The brain commands of `cogby`: argv in, the functions of this folder called, text or JSON out.
// cli/bin/cogby.cjs hands a command here when its name is in COMMANDS; the install commands never
// reach this file.

const path = require('path');
const brainLib = require('./brain.cjs');
const { BrainError } = brainLib;

const COMMANDS = new Set(['init', 'sync', 'search', 'get', 'log', 'remember', 'context', 'sources', 'serve', 'link', 'places', 'dream', 'index', 'view', 'map', 'notify', 'todo', 'note', 'wrapup', 'card', 'decisions', 'routines', 'project', 'proactive', 'unconfirmed', 'confirm', 'retract', 'meetings']);
const VALUE_FLAGS = new Set(['--brain', '--source', '--date', '--kind', '--replaces', '--author', '--limit', '--id',
  '--valid-from', '--valid-until', '--expected-revision', '--title', '--repo', '--artifact',
  '--body', '--context', '--priority', '--meetings', '--data', '--recommend', '--if-ignored', '--status', '--undo', '--reason', '--due', '--project', '--text', '--who', '--expect', '--review', '--since', '--outcome', '--note', '--run', '--rhythm', '--why', '--scheduled', '--result', '--where', '--instructions', '--page', '--role', '--about', '--name', '--runs', '--sessions', '--tasks', '--by', '--plan']);
// May be given more than once; collected in order.
const MULTI_FLAGS = new Set(['--option']);
const BOOL_FLAGS = new Set(['--json', '--no-sources', '--default', '--create', '--agent', '--human', '--no-default-search', '--no-plugin', '--mcp', '--all', '--html', '--md', '--quick', '--background', '--decision', '--if-any', '--confirmed-by-owner', '--none', '--help', '-h', '--version']);

const HELP = `Brain commands:
  init [--brain PATH] [--default] [--private] [--no-plugin] [--no-sources]
                                              Lay out a brain here (or at PATH) as its own git repository,
                                              register Cogby's skills and hooks for it in Claude Code, and
                                              ask which folders of notes or files to add as sources.
                                              --private marks the brain (a new one or one that exists)
                                              private: used only from its own folder, never the default,
                                              never read by another brain
  sync [--source ID] [--quick]                Read changed files into the index; rebuilds it when it is missing.
                                              Searches answer from the index as it is; a background sync
                                              (--quick --background, started for you) keeps it up to date
  index on | off | status                     Keep the index (the default), or read the files directly on every command
  view [--json]                               What you need to see: projects and where each stopped, the last lines
                                              written, stale pages, mounted sources (--artifact URL records where
                                              the page made from it was published)
  view --html [--meetings FILE] [--runs FILE] [--sessions FILE] [--tasks FILE]
                                              Build the command center page from that snapshot: output/brain-view.html
                                              to open, and the same page ready to publish. Each FILE is JSON a session
                                              read for this page: today's meetings, a list from a calendar; --runs, each
                                              scheduled task's last run, { "<task id>": { link, at, summary } };
                                              --sessions, the open chats, a list of { id, title, state, needs, where,
                                              project, at, link }; --tasks, the to-dos kept in a tool of your own, a
                                              list of { id, text, due, done, tool, link, project }
  view --html --project NAME                  Build one project's own dashboard page: output/dashboard-NAME.html
                                              (--artifact URL --project NAME records where it was published)
  view auto on | off | status                 Keep the view page up to date on its own, after onboarding and at each
                                              wrap-up (the default), or make it only when asked
  map                                         What the brain holds: every project, area, resource and archive entry
                                              with its one line (the first sentence under its card's title).
                                              Reads the index as it is; there is no map file to keep up to date
  card [<name> [--data FILE]]                 A small piece of interface for the chat, as HTML: with no name, the
                                              cards there are (FILE: the card's data, as JSON)
  wrapup auto | review | off | status         What happens when a session closes: commit and push the brain on its
                                              own (auto), commit and leave a notification (review), or nothing (off,
                                              the default). It starts a background Claude, so it is yours to turn on
  search "<words>" [--source ID] [--limit N]  Keyword search over passages and titles, one ranked list
                                              (--source log: the day's log, one result an entry; name a
                                              card to list the entries about it, newest first)
  get <slug>                                  Print a page with its revision
  log <slug> "<line>" --source "<evidence>"   Append a timeline line (--date YYYY-MM-DD, --create; --decision marks
                                              it as a decision: the line starts with "decision:")
  log <slug> "<what and why>" --decision --who owner|accepted|overrode|agent [--expect "…"] [--review YYYY-MM-DD]
                                              A decision, with who made the call: you on your own, you accepting
                                              Claude's suggestion, you overriding it, or an agent alone on something
                                              you did not see; what you expect of it and when to look again are
                                              optional. <slug> log:today is the day's log,
                                              for a decision about no page in particular
  decisions [--project NAME|PAGE] [--since YYYY-MM-DD] [--due] [--who owner|accepted|overrode|agent|none]
            [--outcome as-expected|not-as-expected|reversed|none] [--all] [--limit N]
                                              The decisions in the brain, newest first, with who made each call.
                                              --due: review date reached and not reviewed yet. A reversed one is
                                              left out unless --all. Reads the index as it is. Once one was
                                              reviewed, a line says how each kind of call turned out. With --who
                                              the counts are of those calls only. Who made a call logged without it
                                              is added later as a line on the same page, never by editing the first:
                                              log <page> "who: accepted, decision of <date> #<id>" --source "…"
  decisions review <id> as-expected|not-as-expected|reversed --source "<evidence>" [--note "…"]
                                              Record how one turned out, as a new line on its page
  unconfirmed [--page SLUG] [--project NAME] [--limit N]
                                              What an agent wrote that you have not confirmed, newest first: timeline
                                              lines (named by a six-character id) and facts (named by their row, #3),
                                              each with its page and source. A line Cogby wrote as the record of a
                                              command (a folder linked, a routine added, paused or run) is not a
                                              claim and is never listed. Reads the index as it is
  confirm <page> <ref> [<ref> …]              Say a line or fact is right: only its tag changes, to confirmed.
                                              Yours to do: from an agent it is refused without --confirmed-by-owner,
                                              which is passed only after you said yes to those lines
  retract <page> <ref> [<ref> …] [--reason "…"]
                                              Say one is wrong: it stays on the page, marked retracted, and is left
                                              out of the session context, the decisions and the active facts
  routines [--all]                            Your routines: what each runs, its rhythm, its last run, when it is
                                              next due and whether it is overdue (--all with the paused ones).
                                              One page each under areas/routines. Reads the index as it is
  routines due                                Only the ones due or overdue now
  routines add "<name>" --run "<skill or prompt>" --rhythm "<rhythm>" [--why "…"] [--scheduled "<pointer>"]
               [--where "<plain words>"] [--instructions "<text>"]
                                              A rhythm is daily, weekdays, "weekly on friday" or "monthly on 1"
                                              (or "monthly on last"), each with an optional "at 16:00"
  routines edit <name> [--run "…"] [--rhythm "…"] [--why "…"] [--scheduled "<pointer>"|none] [--title "…"]
                [--where "<plain words>"|none] [--instructions "<text>"|none]
                                              --scheduled is the pointer: the task's name or id in the scheduler.
                                              --where says in plain words where it runs (the tool, this computer or
                                              the cloud, what must be open). --instructions keeps the full
                                              instructions on the page when they are more than the --run line, so
                                              the routine can be set up again in any tool (also on add)
  routines pause | resume <name> [--reason "…"]
  routines ran <name> --source "<evidence>" [--result "<one line>"] [--date YYYY-MM-DD] [--if-any]
                                              Record a run on the routine's page. <name> may be what it runs
                                              ("check-in, weekly"): every routine that runs it gets the line.
                                              --if-any: <name> is what ran (a skill recording its own run), matched
                                              against what each routine runs; none is not an error
  routines offered "<the routine, or the ask>" --source "<evidence>"
                                              Record, BEFORE making it, an offer or an ask about routines that
                                              nobody asked for (a new routine from what the brain shows, a first
                                              routine). Refused under proactive quiet, when one was made in the
                                              last 7 days, and when the same one was ever made: then say nothing
  proactive quiet | suggest | act | status    How far Cogby goes on its own about routines: say nothing unless
                                              asked (quiet), list what is due when a session starts and offer to
                                              run it (suggest, the default), or run the due ones that only read or
                                              report and leave a notification (act; anything that writes, sends or
                                              reaches outside the brain still asks first). status shows this, the
                                              automatic wrap-up and the view page together
  meetings [--page SLUG] [--limit N]          The meeting records, newest first: each debriefed meeting's summary and
                                              the link to its transcript, in resources/meetings/. --page: the ones
                                              that page links to or that link to it. Reads the index as it is
  meetings add --data FILE                    Write one meeting record (FILE: a JSON object with title, date, with,
                                              pages, transcript, recording, notes, event, summary, line, written; "-"
                                              reads it from stdin) and one line linking to it on every page in pages,
                                              dated the meeting's day. Written once: the same meeting again writes nothing
  remember <slug> "<claim>" --source "<evidence>"
                                              Save a fact: inserted, duplicate, or superseded with --replaces N (--kind, --create)
  context [--repo PATH]                       The block a session starts with; in a linked place, its page first
  link <folder> <card> [--role ROLE] [--about "<one line>"] [--name NAME]
                                              Make a folder a place of a project or area card: the folder first, then
                                              the card. Both sides are printed before anything is written. Roles: code
                                              (the main repo), workspace (deliverables, working files), environment (a
                                              dev setup or sandbox), reference (contracts, docs: read only), scratch
                                              (experiments). A folder with a git remote is named by it, so any clone
                                              resolves; any other by --name (default: the folder's name) and its path
                                              on this machine. One folder belongs to one card
  link <card> [same options]                  The shortcut: the folder is the one you are in (--repo PATH, the older
                                              way to name the folder, still works)
  link --none [<folder>]                      This folder, or the one named, is not a brain project (kept on this
                                              machine only)
  link --undo [<folder>]                      Take back the link (the place stays on the card, marked unlinked) or
                                              the mark
  places [<page>] [--all]                     The places of every page, or of one, each with its role, its one line and
                                              its folder on this machine (--all with the unlinked ones)
  dream [--since YYYY-MM-DD]                  The nightly pass: sync, check facts, read linked repos, flag stale pages
                                              (recorded as a run on a routine that runs it). It also lists what you
                                              asked the day before, cut from the day's log, for the look-back to read
                                              (--since: every day from that one to today, seven at most)
  notify                                      What Cogby left for you: the notifications still waiting (--all for every one)
  notify add --title "…" [--body "…"] [--source NAME] [--context KEY] [--priority high]
             [--option "…" … --recommend "…"] [--if-ignored "…"]
                                              Leave one. A notification carries a question and its answers (--option, and
                                              --recommend for the one you suggest), or one thing to go ahead with
                                              (--recommend alone, in a sentence), or it is not a notification.
                                              --if-ignored says what happens if nothing is done.
                                              The same source and context refreshes the one waiting.
                                              --status acted [--reason "…"] [--undo "…"] is for what needs nothing from the
                                              owner: something done without asking, shown under "Done without you"
  notify read | dismiss | later <id>          Mark one seen, clear it, or put it off (counted)
  notify answer <id> "<option>"               Answer one that asks a question
  notify comment <id> "<words>"               Add your words to one
  project status <name> <status>              A project's status, on its card: planning, active, on-hold or done.
                                              The old one stays in the card's timeline
  todo                                        Your own to-dos still open (--all for every one, --md as a checklist)
  todo add "<text>" [--project NAME] [--due YYYY-MM-DD] [--body "…"] [--by cogby]
                                              In a linked folder the project is that folder's page (--project none: no project).
                                              --by cogby hands it to Cogby, who proposes a plan before doing anything
  todo done | reopen | drop <id>              Tick one, untick it, or let it go (kept in the file)
  todo edit <id> [--text "…"] [--due YYYY-MM-DD|none] [--project NAME|none] [--body "…"|none]
                                              [--by cogby|me] [--plan "…"|none] (the plan is Cogby's, for a to-do handed to it)
  note                                        Your quick notes, newest first (--all with the dismissed ones)
  note add "<text>" [--body "…"] [--project NAME]
  note dismiss | reopen <id>
  mirror                                      The Notion mirror, an extra that is off until you turn it on: a copy of
                                              your projects, areas, people, open to-dos and decisions under one Notion
                                              page. Shows whether it is on, where it lives and what an update would write
  mirror on --parent <notion page link> | off Turn it on, under the Notion page you chose, or off. Off sends nothing
                                              more; what is in Notion stays. The brain stays the one home: a mirrored
                                              page says it is a copy, and an edit made in Notion is overwritten
  mirror push [--limit N] [--dry-run] [--if-on]
                                              Update Notion through Notion's own command-line tool (ntn): first take in
                                              what was ticked or added on the To-dos page, then write every page that
                                              is new or changed. Nothing is ever deleted in Notion. --if-on: does
                                              nothing and prints nothing while the mirror is off (what a wrap-up runs)
  mirror plan                                 What an update would write, page by page, without sending anything
  mirror page <key>                           One page as it goes to Notion, for a session that writes it through its
                                              own Notion connection; then: mirror done <key> --id <notion page link>
                                              (--id none forgets a page removed in Notion)
  mirror pull [--data FILE] [--dry-run]       Take in what was done on the To-dos page in Notion: a to-do ticked there
                                              is done here, a line added there is a new to-do (FILE: the page as Notion
                                              gives it back, "-" for stdin; without it the page is read with ntn)
  sources                                     The mounted sources: where each is, files indexed, last read, missing or not
  sources add <path> [--id ID] | remove <id>  Register a folder as a read-only source, indexed where it is, or drop one
  serve --mcp                                 The same operations as tools, over stdio

Every brain command takes --brain PATH and --json. \`cogby --version\` prints the version.

The bare \`cogby\` is put on PATH by Claude Code, inside its sessions only. In a terminal of your own, run
the same commands as \`node "<plugin folder>/bin/cogby" <command>\`.

Who wrote a line. Run in your own terminal, a write is yours: human, confirmed (--agent or COGBY_ACTOR=agent
marks it an agent's). Run inside a Claude session it is always an agent's and unconfirmed: --human and
COGBY_ACTOR=human are not honoured there. Such a line becomes confirmed only through \`cogby confirm\`.
An agent's line also says which agent when Cogby knows: "agent claude-code" from Claude Code's shell,
the client's name through the tool server, or COGBY_AGENT=<name> set by another agent's shell.
The line left by a link, a routine command or a change of a project's status
ends in "record": it says what was run, claims nothing, and needs no confirming.`;

// The commands whose write carries who wrote it.
const SIGNED = new Set(['log', 'remember', 'decisions', 'confirm', 'retract', 'routines', 'project', 'link', 'meetings']);
const NOT_HUMAN = 'cogby: --human (or COGBY_ACTOR=human) is not honoured inside a Claude session: this was written as an agent\'s, unconfirmed. '
  + 'The owner confirms it with `cogby confirm`.';

const usage = (message) => new BrainError('USAGE', message, 'Run `cogby help` for the commands.');
const camel = (flag) => flag.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());

function parse(argv) {
  const out = { command: null, args: [], flags: {} };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (BOOL_FLAGS.has(arg)) { out.flags[arg === '-h' ? 'help' : camel(arg)] = true; continue; }
    if (MULTI_FLAGS.has(arg)) {
      if (argv[i + 1] === undefined) throw usage(`${arg} needs a value.`);
      (out.flags[`${camel(arg)}s`] = out.flags[`${camel(arg)}s`] || []).push(argv[++i]);
      continue;
    }
    // `cogby decisions --due` is a switch; everywhere else --due takes a date.
    if (arg === '--due' && out.command === 'decisions') { out.flags.due = true; continue; }
    // `cogby link --undo` is a switch too; on `notify add`, --undo says how to undo what was done.
    if (arg === '--undo' && out.command === 'link') { out.flags.undo = true; continue; }
    if (VALUE_FLAGS.has(arg)) {
      const value = argv[i + 1];
      if (value === undefined) throw usage(`${arg} needs a value.`);
      out.flags[camel(arg)] = value;
      i++;
      continue;
    }
    if (arg.startsWith('--')) throw usage(`Unknown option: ${arg}`);
    if (!out.command) out.command = arg; else out.args.push(arg);
  }
  return out;
}

// ---- init -------------------------------------------------------------------------------------

// `--private` is a yes/no flag that only `init` reads, so it is named here, beside it.
BOOL_FLAGS.add('--private');

function init(target, options = {}) {
  const starter = require('../lib/starter-brain.cjs');
  const { ensureRepository } = require('../lib/brain-repo.cjs');
  const { ensureIgnored } = require('./db.cjs');
  const brain = path.resolve(target);
  const already = brainLib.isBrain(brain);
  const env = options.env || process.env;
  // The default brain is the one used from any folder; a private one is used only from its own.
  if (options.default === true && (options.private === true || (already && brainLib.isPrivate(brain)))) {
    throw new BrainError('PRIVATE_BRAIN', 'A private brain cannot be the default brain.', 'Leave out --default, or leave out --private.');
  }
  // Asked before the mark is written: a brain marked private stops being the default.
  const usual = options.private === true ? brainLib.defaultBrain(env) : null;
  if (!already) {
    try { starter.createBrain(brain, { createdBy: 'init', version: options.version }); }
    catch (error) { throw new BrainError('INIT', error.message, 'Pick an empty folder: cogby init --brain <path>.'); }
  }
  // Before the first commit, so the index never enters the brain's history.
  ensureIgnored(brain);
  // Typed on purpose (`--private`), on a new brain or one that exists; written before the first
  // commit of a new one, and committed on its own in one that has a history.
  const marked = options.private === true && brainLib.setPrivate(brain);
  // Cogby's skills and hooks, for sessions opened in this brain. The program is the package this
  // command runs from: no `cogby setup`, no service. Registered before the first commit, like setup.
  let plugin = { ok: false, skipped: true };
  if (options.plugin !== false) {
    const harness = require('../lib/brain-harness.cjs');
    const engine = path.resolve(__dirname, '..', '..');
    const run = options.run || ((command, args, spawnOptions) => require('../lib/spawn.cjs').spawnSync(command, args, spawnOptions));
    plugin = harness.registerPlugin({ engine, brain, run });
    plugin.program = harness.recordProgram(brain, engine, starter.configDir(options.env || process.env));
    delete plugin.calls;
  }
  const repository = ensureRepository(brain, { message: 'Cogby: new brain' });
  const stats = brainLib.sync(brain);
  // The first brain a person makes is their default, the one reached from any folder. A later one
  // becomes the default only when asked (`--default`, or onboarding, on the person's yes).
  if (marked && already) require('./write.cjs').commitFile(brain, '.cogby/brain.json', 'Cogby: this brain is private');
  const isPrivate = brainLib.isPrivate(brain);
  const before = brainLib.defaultBrain(env);
  // `default: false` is a caller that must never choose the default (the tool server, for a folder it
  // did not make).
  const choose = !isPrivate && (options.default === true || (options.default !== false && !before));
  const isDefault = choose ? !!brainLib.setDefaultBrain(brain, env) : !!before && brainLib.fold(before) === brainLib.fold(brain);
  return {
    brain, created: !already, repository, plugin, index: stats.index, default: isDefault,
    ...(isPrivate ? { private: true, marked, lost_default: !!usual && brainLib.fold(usual) === brainLib.fold(brain) } : {}),
    sync: stats,
  };
}

// ---- the guided step: which folders to mount ---------------------------------------------------

// Asked once, at the end of laying out a brain: does the person keep notes or project files in
// folders that should be searchable from here? Each answer is registered as a read-only source,
// indexed where it is and never copied. Only for a person at a terminal: with no TTY, with --json or
// with --no-sources it is skipped and says nothing.
async function guideSources(brain, io = {}) {
  const input = io.stdin || process.stdin;
  const output = io.stdout || process.stdout;
  if (io.skip || !input.isTTY) return { asked: false, added: [] };
  // Lines are taken from an iterator, which keeps the ones typed ahead and ends when the input does:
  // a question asked of a closed input must be an empty answer, never a wait that does not end.
  const reader = require('readline').createInterface({ input, crlfDelay: Infinity });
  const lines = reader[Symbol.asyncIterator]();
  const prompt = {
    async question(text) { output.write(text); const next = await lines.next(); return next.done ? '' : String(next.value); },
    close() { reader.close(); },
  };
  const added = [];
  try {
    output.write('\nDo you keep notes or project files in other folders? Add one and it is searched from this brain,\n'
      + 'read where it is: never copied, never changed. Enter a folder path, or press Enter to skip.\n');
    for (;;) {
      const answer = (await prompt.question(added.length ? 'Another folder (Enter to finish): ' : 'Folder: ')).trim().replace(/^["']|["']$/g, '');
      if (!answer) break;
      try {
        const source = brainLib.addSource(brain, answer, { cwd: io.cwd });
        const pass = brainLib.refresh(brain, { source: source.id });
        added.push({ id: source.id, path: source.path, files: pass.sources[0].scanned });
        output.write(`  Added "${source.id}": ${pass.sources[0].scanned} files, read-only.\n`);
      } catch (error) {
        if (!(error instanceof BrainError)) throw error;
        output.write(`  Not added: ${error.message}${error.hint ? ` ${error.hint}` : ''}\n`);
      }
    }
  } finally { prompt.close(); }
  if (added.length) output.write('See them any time with `cogby sources`.\n');
  return { asked: true, added };
}

// ---- text for people --------------------------------------------------------------------------

const commitLine = (commit) => (commit.committed ? `commit ${commit.sha}` : `not committed: ${commit.why}`);
// A write to a store (a to-do, a note, a notification) says on a second line how it was saved.
const saved = (result) => (result.commit ? `\n  ${commitLine(result.commit)}` : '');

function human(command, result) {
  if (command === 'init') {
    const repo = result.repository;
    return [
      result.created ? `New brain in ${result.brain}` : `${result.brain} is already a brain; left as it is`,
      repo.ok ? (repo.nested ? `Git: inside the repository at ${repo.toplevel}, so it has no history of its own` : repo.created ? 'Git: its own repository, first commit made' : 'Git: its own repository')
        : `Git: no repository (${repo.why})`,
      ...(result.plugin.skipped ? [] : result.plugin.ok
        ? ['Claude Code: Cogby\'s skills and hooks are registered for this brain']
        : [`Claude Code: skills and hooks not registered (${result.plugin.why === 'claude-not-found' ? 'Claude Code was not found' : `${result.plugin.why}${result.plugin.detail ? `: ${result.plugin.detail}` : ''}`}). In this folder, run:`,
          ...(result.plugin.commands || []).map((line) => `  ${line}`)]),
      ...(result.default ? ['This is your default brain: its tools and its session-start line work from any folder.'] : []),
      ...(result.private ? [`Private${result.marked ? '' : ' already'}: this brain is used only from a chat or a command started in its own folder. It is never the default brain, and no other brain searches or imports it.`] : []),
      ...(result.lost_default ? ['It was your default brain: you have no default brain now. `cogby init --brain <another> --default` picks one.'] : []),
      result.index === 'on' ? `Indexed ${result.sync.pages} pages. Try: cogby search "<words>"` : 'Index off: commands read the files directly. Try: cogby search "<words>"',
    ].join('\n');
  }
  if (command === 'index') {
    if (result.switched === 'on') return `Index on: ${result.pages} pages in .cogby/index.db.`;
    if (result.switched === 'off') return 'Index off: every command now reads the files directly. Nothing else changed.';
    return result.index === 'on'
      ? `Index: on (${result.exists ? `${Math.max(1, Math.round(result.bytes / 1024))} KB, ${result.file}` : 'not built yet; the next command builds it'})`
      : 'Index: off (commands read the files directly; `cogby index on` keeps one)';
  }
  if (command === 'sync') {
    if (result.skipped === 'running') return 'A background sync is already running; nothing started.';
    if (result.index === 'off') return `Index is off: ${result.scanned} files read, nothing kept. \`cogby index on\` keeps an index.`;
    const lines = [`${result.rebuilt ? 'Index rebuilt' : 'Synced'}: ${result.scanned} files read, ${result.changed} changed, ${result.removed} removed, ${result.pages} pages indexed`];
    for (const source of result.sources) lines.push(`  ${source.id}: ${source.missing ? 'folder not found, kept as indexed' : `${source.scanned} files, ${source.changed} changed, ${source.removed} removed`}`);
    if (result.skipped.credentials) lines.push(`  ${result.skipped.credentials} credential-looking path(s) never opened`);
    if (result.skipped.large) lines.push(`  ${result.skipped.large} file(s) over the size limit skipped`);
    for (const entry of result.skipped.unreadable || []) lines.push(`  ${entry.source}:${entry.path} has no readable text, indexed by name only (${entry.reason})`);
    return lines.join('\n');
  }
  if (command === 'search') {
    const asOf = result.index === 'off' ? 'Index off: the files were read just now.'
      : `Index as of ${result.index_as_of ? `${result.index_as_of.slice(0, 19).replace('T', ' ')} UTC` : 'no full sync yet'}`
        + `${result.background_sync ? ` (a background sync ${result.background_sync === 'started' ? 'has started' : 'is running'}; search again for files changed since)` : ''}.`;
    if (!result.results.length) return `No match for "${result.query}" in: ${result.searched.join(', ') || 'no source'}.\n${asOf}`;
    return [...result.results.map((hit, index) => {
      const where = hit.source === 'brain' ? hit.slug : `${hit.source}:${hit.slug}`;
      return `${index + 1}. [${hit.match}] ${where} — ${hit.title}${hit.heading && hit.heading !== hit.title ? ` › ${hit.heading}` : ''} (${hit.part})\n   ${hit.snippet}`;
    }), asOf].join('\n');
  }
  if (command === 'get') {
    const where = result.source === 'brain' ? result.slug : `${result.source}:${result.slug}`;
    return `${where} · revision ${result.revision} · ${result.path}\n\n${result.content}`;
  }
  if (command === 'log') {
    if (result.status === 'duplicate') return `Already on ${result.slug}; nothing written.`;
    return `Logged on ${result.slug}${result.created ? ' (new page)' : ''}: ${result.source === 'log' ? '' : `revision ${result.revision}, `}${commitLine(result.commit)}\n${result.line}`;
  }
  if (command === 'decisions') {
    if (result.decision) {
      if (result.status === 'duplicate') return `Already recorded on ${result.slug}; nothing written.`;
      return `Reviewed #${result.decision.id} (${result.decision.date}, ${result.decision.page}): ${result.outcome}. ${commitLine(result.commit)}\n${result.line}`;
    }
    const c = result.counts;
    const asOf = result.index === 'off' ? 'Index off: the files were read just now.' : `Index as of ${result.index_as_of ? `${result.index_as_of.slice(0, 19).replace('T', ' ')} UTC` : 'no full sync yet'}.`;
    const tally = `${c.total} decision${c.total === 1 ? '' : 's'} in scope: ${c.by_who.owner} yours alone, ${c.by_who.accepted} accepted from Claude, ${c.by_who.overrode} overrode Claude, ${c.by_who.agent || 0} by an agent alone, ${c.by_who.not_recorded} not recorded`
      + ` · ${c.due} due for review · ${c.not_as_expected} not as expected · ${c.reversed} reversed`;
    // How the calls turned out, by who made them: there only once a decision in scope was reviewed.
    const closing = [tally, require('./decisions.cjs').outcomeLine(c), asOf].filter(Boolean);
    if (!result.decisions.length) return ['No decision matches.', ...closing].join('\n');
    const lines = [];
    for (const d of result.decisions) {
      const marks = [d.who ? `${d.who}${d.who_recorded_on ? ` (said ${d.who_recorded_on})` : ''}` : 'who: not recorded', d.review ? `review ${d.review}${d.due ? ' (due)' : ''}` : '', d.outcome ? `${d.outcome}${d.reviewed_on ? ` on ${d.reviewed_on}` : ''}` : ''].filter(Boolean).join(' · ');
      lines.push(`${d.id}  ${d.date}  ${d.page}  ${marks}`, `        ${d.text}`,
        `        source: ${d.source || 'none given'}${d.expect ? ` · expects: ${d.expect}` : ''}${d.review_note ? ` · ${d.review_note}` : ''}`);
    }
    if (result.matching > result.shown) lines.push(`… ${result.matching - result.shown} more (--limit N)`);
    lines.push(...closing);
    return lines.join('\n');
  }
  if (command === 'unconfirmed') {
    const asOf = result.index === 'off' ? 'Index off: the files were read just now.' : `Index as of ${result.index_as_of ? `${result.index_as_of.slice(0, 19).replace('T', ' ')} UTC` : 'no full sync yet'}.`;
    if (!result.total) return `Nothing an agent wrote is waiting to be confirmed.\n${asOf}`;
    const lines = [];
    for (const item of result.unconfirmed) {
      lines.push(`${item.ref.padEnd(6)}  ${item.date || '          '}  ${item.page}  ${item.kind === 'fact' ? `fact (${item.fact_kind})` : 'line'}`,
        `        ${item.text}`, `        source: ${item.source || 'none given'}`);
    }
    if (result.total > result.shown) lines.push(`… ${result.total - result.shown} more (--limit N)`);
    lines.push(`${result.total} unconfirmed: ${result.counts.lines} timeline line${result.counts.lines === 1 ? '' : 's'}, ${result.counts.facts} fact${result.counts.facts === 1 ? '' : 's'}, written by an agent.`
      + ' Right: cogby confirm <page> <ref> [<ref> …]. Wrong: cogby retract <page> <ref>.', asOf);
    return lines.join('\n');
  }
  if (command === 'confirm' || command === 'retract') {
    const done = result[command === 'confirm' ? 'confirmed' : 'retracted'];
    const word = command === 'confirm' ? 'Confirmed' : 'Retracted';
    const were = result.already.length ? `${result.already.map((item) => item.ref).join(', ')} already ${command === 'confirm' ? 'confirmed' : 'retracted'}.` : '';
    if (!done.length) return `Nothing changed on ${result.slug}: ${were}`;
    return [`${word} on ${result.slug}: revision ${result.revision}, ${commitLine(result.commit)}`,
      ...done.map((item) => `  ${item.ref.padEnd(6)}  ${item.text}`), ...(were ? [were] : [])].join('\n');
  }
  if (command === 'routines') return routinesText(result);
  if (command === 'project') {
    return result.status === 'unchanged' ? `${result.project} is already ${result.now}; nothing written.`
      : `Project ${result.project}: ${result.was} → ${result.now} (revision ${result.revision}, ${commitLine(result.commit)})`;
  }
  if (command === 'proactive') {
    const what = {
      quiet: 'nothing is said about your routines unless you ask',
      suggest: 'a session starts by listing the routines that are due, and Claude offers to run them',
      act: 'a due routine that only reads or reports (a check-in, the nightly pass) is run without asking, recorded, and left as a notification; one that writes, sends or reaches outside the brain still asks first',
    }[result.proactive];
    return [`Proactivity: ${result.proactive} (${what}).`, 'What else runs on its own:',
      `  Automatic wrap-up: ${result.wrapup}${result.wrapup_forced_by_env ? ' (set by BRAIN_WRAPUP_MODE)' : ''} · cogby wrapup auto | review | off`,
      `  View page kept up to date: ${result.view_auto ? 'on' : 'off'} · cogby view auto on | off`].join('\n');
  }
  if (command === 'remember') {
    if (result.status === 'duplicate') return `duplicate: ${result.slug} already holds this as fact #${result.row}; nothing written.`;
    const replaced = result.status === 'superseded' ? `, replacing #${result.superseded_row}` : '';
    const similar = result.similar_row ? `\nLooks like fact #${result.similar_row} ("${result.similar_claim}"), which is still active. If this one replaces it, run the same command again with --replaces ${result.similar_row}; if both are true, do nothing.` : '';
    return `${result.status}: fact #${result.row} on ${result.slug}${replaced}${result.created ? ' (new page)' : ''}: revision ${result.revision}, ${commitLine(result.commit)}${similar}`;
  }
  if (command === 'context') return result.text;
  if (command === 'card') return result.html !== undefined ? result.html.trimEnd() : result.cards.map((card) => `${card.name}\n  ${card.about}`).join('\n');
  if (command === 'wrapup') {
    const what = { auto: 'when a session closes, a background Claude commits the brain and pushes it to its own remote', review: 'when a session closes, a background Claude commits the brain, does not push, and leaves you a notification', off: 'nothing happens on its own when a session closes; run the wrap-up skill when you want one' }[result.wrapup];
    return `Automatic wrap-up: ${result.wrapup} (${what}).${result.forced_by_env ? ' Set by BRAIN_WRAPUP_MODE, which overrides the saved setting.' : ''}`;
  }
  if (command === 'view') {
    if (result.publish) return `${result.project ? `Dashboard for ${result.project}` : 'Command center'} built: ${result.file}\nTo publish: ${result.publish}${result.artifact ? `\nPublished at: ${result.artifact}` : ''}\n${result.waiting} waiting for you${result.meetings === null ? ', no calendar read' : `, ${result.meetings} meetings`}.`;
    if (result.projects === undefined && result.auto !== undefined) {
      const where = result.artifact ? ` It is published at ${result.artifact}` : '';
      if (result.switched === 'off') return `View: made only when you ask for it. Nothing is published or refreshed on its own any more.${result.artifact ? ` The page already published stays where it is until you delete it: ${result.artifact}` : ''}`;
      if (result.switched === 'on') return `View: kept up to date on its own, after onboarding and at each wrap-up. Where a session can publish, that is a private page on claude.ai.${where}`;
      return result.auto ? `View: on (kept up to date on its own; \`cogby view auto off\` stops that).${where}` : `View: off (made only when asked; \`cogby view auto on\` turns it back on).${where}`;
    }
    if (result.projects === undefined) return result.artifact ? `Recorded: the ${result.project ? `dashboard for ${result.project}` : 'view'} is published at ${result.artifact}` : 'Forgotten: the view has no published page.';
    const lines = [`${result.brain} · ${result.counts.pages} page${result.counts.pages === 1 ? '' : 's'} · ${result.counts.projects} project${result.counts.projects === 1 ? '' : 's'} · index ${result.index}`];
    lines.push('', 'Projects');
    for (const project of result.projects) {
      lines.push(`  ${project.title} (${project.slug}) · ${project.updated}${project.stale ? ` · quiet for ${project.days_quiet == null ? 'ever' : `${project.days_quiet} days`}` : ''}`);
      if (project.truth) lines.push(`    ${project.truth}`);
      const spot = project.parking_spot[0];
      if (spot) lines.push(`    stopped at: ${spot.date} ${spot.summary}`);
      else if (project.now) lines.push(`    now: ${project.now}`);
    }
    if (!result.projects.length) lines.push('  none yet');
    lines.push('', 'Last written');
    for (const line of result.recent) lines.push(`  ${line.date}  ${line.slug}  ${line.summary}`);
    if (!result.recent.length) lines.push('  nothing yet');
    if (result.stale.length) { lines.push('', `No new evidence in ${result.stale_after_days} days`); for (const entry of result.stale) lines.push(`  ${entry.slug}${entry.newest ? ` (last ${entry.newest})` : ' (none yet)'}`); }
    lines.push('', 'Sources');
    for (const source of result.sources) lines.push(`  ${source.id}: ${source.files} files, ${source.mode === 'write' ? 'writable' : 'read-only'}${source.missing ? ', MISSING' : ''}  ${source.path}`);
    return lines.join('\n');
  }
  if (command === 'map') return require('./map.cjs').mapText(result);
  if (command === 'meetings') return result.links ? require('./meetings.cjs').addText(result) : require('./meetings.cjs').listText(result);
  // A list that is empty because its store could not be read says so, in place of "nothing there".
  const unreadable = (what) => `The ${what} store cannot be read, so nothing is shown: ${result.unreadable.file} (${result.unreadable.why}). Nothing will be written to it until it is repaired or moved aside.`;
  if (command === 'todo') {
    if (result.unreadable) return unreadable('to-do');
    if (result.todos) return result.md || !result.todos.length ? require('./todo.cjs').todosText(result.todos)
      : result.todos.map((t) => `${t.id}  ${t.status}${t.due ? ` · due ${t.due}` : ''}${t.project ? ` · ${t.project}` : ''}  ${t.text}`).join('\n');
    const t = result.todo;
    return `To-do ${t.id}: ${t.status}${t.due ? `, due ${t.due}` : ''}${t.project ? `, ${t.project}` : ''} · ${t.text}${saved(result)}`;
  }
  if (command === 'note') {
    if (result.unreadable) return unreadable('note');
    if (result.notes) return result.notes.length ? result.notes.map((n) => `${n.id}  ${n.created.slice(0, 10)}${n.project ? ` · ${n.project}` : ''}${n.status === 'open' ? '' : ` · ${n.status}`}  ${n.text}`).join('\n') : 'No notes.';
    const n = result.note;
    return `Note ${n.id}: ${n.status}${n.project ? `, ${n.project}` : ''} · ${n.text}${saved(result)}`;
  }
  if (command === 'notify') {
    if (result.unreadable) return unreadable('notification');
    if (result.notifications) {
      if (!result.notifications.length) return result.all ? 'No notifications.' : 'Nothing is waiting for you.';
      return result.notifications.map((n) => `${n.id}  ${n.status}${n.priority === 'high' ? ' · high' : ''}${n.snoozed ? ` · put off ${n.snoozed}×` : ''}  ${n.title}${n.options.length ? `\n    answers: ${n.options.map((o) => (o === n.recommend ? `[${o}]` : o)).join(' | ')}` : ''}`).join('\n');
    }
    const n = result.notification;
    return `${result.refreshed ? 'Refreshed' : 'Notification'} ${n.id}: ${n.status}${n.answer ? `, answered "${n.answer}"` : ''}${n.snoozed ? `, put off ${n.snoozed} time${n.snoozed === 1 ? '' : 's'}` : ''} · ${n.title}${saved(result)}`;
  }
  if (command === 'link') {
    if (result.none) return result.status === 'unchanged' ? `${result.folder} is already marked "not a brain project".`
      : `Marked ${result.folder}: not a brain project. Kept on this machine only; \`cogby link --undo "${result.folder}"\` takes it back.`;
    if (result.status === 'cleared') return `Cleared: the brain no longer holds anything about ${result.folder}.`;
    const p = result.place;
    const what = `${p.id} · ${p.role}${p.about ? ` · ${p.about}` : ''}`;
    if (result.status === 'unlinked') return [`Unlinked folder ${result.folder} from card ${result.slug}`, `  place: ${what} stays on the page, marked unlinked (revision ${result.revision}, ${commitLine(result.commit)})`].join('\n');
    const done = { linked: 'Linked folder', updated: 'Updated the place of folder', unchanged: 'Already linked: folder' }[result.status] || 'Linked folder';
    const lines = [`${done} ${result.folder} ${result.status === 'updated' ? 'on' : 'to'} card ${result.slug}`,
      `  place: ${what} (on the page, revision ${result.revision}, ${commitLine(result.commit)})`];
    if (result.note) lines.push(`  ${result.note}`);
    if (result.docs) lines.push(result.docs.id ? `  docs: ${result.docs.path} is now the read-only source "${result.docs.id}" (${result.docs.files} files)` : `  docs: not registered (${result.docs.why})`);
    return lines.join('\n');
  }
  if (command === 'places') {
    const asOf = result.index === 'off' ? 'Index off: the files were read just now.' : `Index as of ${result.index_as_of ? `${result.index_as_of.slice(0, 19).replace('T', ' ')} UTC` : 'no full sync yet'}.`;
    const lines = [];
    let page = null;
    for (const place of result.places) {
      if (place.page !== page) { page = place.page; lines.push(`${place.page}  ${place.title}`); }
      lines.push(`  ${place.id} · ${place.role}${place.about ? ` · ${place.about}` : ''}${place.unlinked ? ` · unlinked ${place.unlinked}` : ''}`,
        `      ${place.unlinked ? 'no longer a place' : place.folder ? `${place.folder}${place.missing ? '  (MISSING: the folder is not there)' : ''}` : place.kind === 'repo' ? 'any clone of it; none linked on this machine' : 'not linked on this machine'}`);
    }
    if (!result.places.length) lines.push(result.page ? `${result.page} has no place. Link a folder to it: cogby link <folder> ${result.page} --role <role> --about "<one line>"` : 'No folder is linked yet. Link one: cogby link <folder> <card> --role <role> --about "<one line>"');
    if (result.not_projects.length) lines.push('Not brain projects (this machine):', ...result.not_projects.map((dir) => `  ${dir}`));
    lines.push(asOf);
    return lines.join('\n');
  }
  if (command === 'dream') {
    const i = result.index;
    const lines = [
      `Nightly pass, ${result.ran_at.slice(0, 16).replace('T', ' ')} UTC`,
      `Sync: ${result.sync.scanned} files read, ${result.sync.changed} changed, ${result.sync.removed} removed`,
      `Index: ${i.pages} pages, ${i.links} links (${i.unresolved_links.length} to pages that do not exist), ${i.timeline_lines} timeline lines, ${i.facts_active} active facts, ${i.facts_retired} retired`,
    ];
    for (const entry of i.unresolved_links.slice(0, 10)) lines.push(`  ${entry.slug} → [[${entry.target}]] has no page`);
    if (result.facts.length) { lines.push('', 'Facts to look at:'); for (const fact of result.facts) lines.push(`  ${fact.slug} #${fact.row}: ${fact.problem}`); }
    for (const repo of result.repos) {
      lines.push('', `${repo.slug} ← ${repo.folder}: ${repo.missing ? 'folder not found' : `${repo.commits.length} commit(s) since ${result.since.slice(0, 10)}`}`);
      for (const commit of repo.commits.slice(0, 10)) lines.push(`  ${commit.date} ${commit.sha} ${commit.subject} (${commit.author})`);
    }
    lines.push('', result.stale.length ? `No new evidence in 14 days (${result.stale.length}):` : 'No page is stale.');
    for (const entry of result.stale) lines.push(`  ${entry.slug}: ${entry.newest ? `last evidence ${entry.newest}, ${entry.days} days ago` : 'no dated evidence yet'}`);
    if (result.rewrite.candidates.length) lines.push('', `New evidence since the last pass, so the summary at the top may need a look: ${result.rewrite.candidates.join(', ')}.`);
    for (const day of result.days || []) {
      lines.push('', `${day.date}: ${day.entries} turn${day.entries === 1 ? '' : 's'} in the log, ${day.asked} asked by you${day.asked > day.asks.length ? ` (the first ${day.asks.length} shown)` : ''}`);
      for (const one of day.asks) lines.push(`  ${one.time} ${one.ask}${one.card ? ` [${one.card}]` : ''}`);
    }
    if (result.routines_recorded && result.routines_recorded.length) lines.push('', `Recorded as a run of: ${result.routines_recorded.join(', ')}.`);
    return lines.join('\n');
  }
  if (command === 'mirror') return require('./mirror.cjs').text(result.did, result);
  if (command === 'sources') {
    if (result.added) {
      const unread = [...(result.sync.skipped.unreadable || [])];
      return [`Added source "${result.added.id}" → ${result.added.path} (read-only, never copied). ${result.sync.changed} files indexed.`,
        ...unread.map((entry) => `  ${entry.path}: not readable as text (${entry.reason})`)].join('\n');
    }
    if (result.removed) return `Removed source "${result.removed.id}". ${result.removed.path} itself is untouched.`;
    const when = (iso) => (iso ? iso.slice(0, 16).replace('T', ' ') : 'never');
    const width = Math.max(...result.sources.map((source) => source.id.length), 6);
    const lines = [`${'source'.padEnd(width)}  ${'access'.padEnd(9)}  ${'files'.padStart(5)}  ${'last read (UTC)'.padEnd(16)}  folder`];
    for (const source of result.sources) {
      const last = result.index === 'off' ? 'every command' : source.files || source.last_sync ? when(source.last_sync) : 'never';
      lines.push(`${source.id.padEnd(width)}  ${(source.mode === 'write' ? 'writable' : 'read-only').padEnd(9)}  ${String(source.files).padStart(5)}  ${last.padEnd(16)}  ${source.path}`
        + `${source.missing ? '  (MISSING: the folder is not there)' : ''}${source.searched ? '' : '  (searched only when named)'}`);
    }
    lines.push(`Index: ${result.index}. Add a folder with \`cogby sources add <path>\`.`);
    return lines.join('\n');
  }
  return JSON.stringify(result, null, 2);
}

function routinesText(result) {
  if (result.action === 'ran') {
    if (!result.recorded.length) return `No routine is named "${result.asked}" or runs it; nothing recorded.`;
    return result.recorded.map((entry) => (entry.status === 'duplicate' ? `Already recorded on ${entry.name}; nothing written.` : `Run recorded on ${entry.name}: ${commitLine(entry.commit)}\n${entry.line}`)).join('\n');
  }
  if (result.action === 'offered') return `Offer recorded (${commitLine(result.commit)}): ${result.what}\nMake the offer now, once, and build the routine only on a yes. The next offer can be made from ${result.next_offer_from}.`;
  const due = (r) => (r.state === 'paused' ? 'paused' : r.state === 'unknown' ? 'rhythm not understood (fix it with `cogby routines edit`)'
    : r.state === 'overdue' ? `OVERDUE since ${r.next_due} (${r.days_overdue} day${r.days_overdue === 1 ? '' : 's'})`
      : r.state === 'due' ? 'DUE today' : `next due ${r.next_due}${r.due_time ? ` at ${r.due_time}` : ''}`);
  const one = (r) => [`${r.name}  ${r.title} · runs "${r.runs}" · ${r.rhythm} · ${due(r)}`,
    `    last run: ${r.last_run ? `${r.last_run.date}${r.last_run.result ? `, ${r.last_run.result}` : ''} (${r.last_run.source || 'no source'})` : 'never'} · scheduled in Claude: ${r.scheduled}${r.why ? ` · why: ${r.why}` : ''}`,
    ...(r.where || r.instructions ? [`    ${[r.where ? `where it runs: ${r.where}` : '', r.instructions ? `full instructions kept (${r.instructions.length} characters; \`cogby get ${r.slug}\`)` : ''].filter(Boolean).join(' · ')}`] : []),
    ...(r.gaps && r.gaps.length ? [`    not on its page yet: ${r.gaps.map((gap) => (gap === 'why' ? 'why it exists' : 'where it runs')).join(', ')}`] : []),
    ...(r.problem ? [`    problem: ${r.problem.text}`] : [])];
  if (result.action) {
    if (result.status === 'unchanged') return `Nothing changed on ${result.routine.name}.`;
    const done = { add: 'added', added: 'added', edit: 'edited', pause: 'paused', resume: 'resumed' }[result.action];
    return [`Routine ${done}: revision ${result.revision}, ${commitLine(result.commit)}`, ...one(result.routine)].join('\n');
  }
  const asOf = result.index === 'off' ? 'Index off: the files were read just now.' : `Index as of ${result.index_as_of ? `${result.index_as_of.slice(0, 19).replace('T', ' ')} UTC` : 'no full sync yet'}.`;
  const shown = result.only_due || result.all ? result.routines : result.routines.filter((r) => r.state !== 'paused');
  const hidden = result.routines.length - shown.length;
  if (!shown.length) {
    const none = result.only_due ? 'No routine is due.' : hidden ? 'No active routine.' : 'No routines yet. Add one: cogby routines add "<name>" --run "<skill or prompt>" --rhythm "<rhythm>"';
    return `${none}${hidden ? ` ${hidden} paused (--all).` : ''}\n${asOf}`;
  }
  return [...shown.flatMap(one), `${result.due} due · proactivity: ${result.proactive}${hidden ? ` · ${hidden} paused (--all)` : ''}`, asOf].join('\n');
}

// The owner's own lists: to-dos and quick notes (core/brain/todo.cjs).
// A to-do or a note made in a linked folder belongs to that folder's page, unless a project is named
// (`--project none`: no project).
const projectIn = (brain, flags, cwd) => (flags.project === undefined ? require('./link.cjs').defaultProject(brain, cwd) : flags.project === 'none' ? '' : flags.project);

function todoCommand(brain, args, flags, cwd) {
  const todo = require('./todo.cjs');
  const action = args[0] || 'list';
  const one = (shape) => { if (args.length !== 2) throw usage(`cogby todo ${shape}`); return args[1]; };
  if (action === 'list') { if (args.length > 1) throw usage('cogby todo [--all] [--md]'); return { ...todo.listTodos(brain, { all: !!flags.all }), md: !!flags.md }; }
  if (action === 'add') {
    if (args.length !== 2) throw usage('cogby todo add "<text>" [--project NAME] [--due YYYY-MM-DD] [--body "…"] [--by cogby]');
    return todo.addTodo(brain, { text: args[1], project: projectIn(brain, flags, cwd), due: flags.due, body: flags.body, source: flags.source, by: flags.by });
  }
  if (action === 'done' || action === 'reopen' || action === 'drop') return todo.setTodo(brain, one(`${action} <id>`), action);
  if (action === 'edit') return todo.editTodo(brain, one('edit <id> [--text "…"] [--due YYYY-MM-DD|none] [--project NAME|none] [--body "…"|none] [--by cogby|me] [--plan "…"|none]'), { text: flags.text, due: flags.due, project: flags.project, body: flags.body, by: flags.by, plan: flags.plan });
  throw usage(`todo ${action}: use add, list, done, reopen, drop or edit.`);
}

function noteCommand(brain, args, flags, cwd) {
  const todo = require('./todo.cjs');
  const action = args[0] || 'list';
  if (action === 'list') { if (args.length > 1) throw usage('cogby note [--all]'); return todo.listNotes(brain, { all: !!flags.all }); }
  if (action === 'add') {
    if (args.length !== 2) throw usage('cogby note add "<text>" [--body "…"] [--project NAME]');
    return todo.addNote(brain, { text: args[1], body: flags.body, project: projectIn(brain, flags, cwd), source: flags.source });
  }
  if (action === 'dismiss' || action === 'reopen') { if (args.length !== 2) throw usage(`cogby note ${action} <id>`); return todo.setNote(brain, args[1], action); }
  throw usage(`note ${action}: use add, list, dismiss or reopen.`);
}

function notifyCommand(brain, args, flags, env) {
  const notify = require('./notify.cjs');
  const action = args[0] || 'list';
  const one = (shape) => { if (args.length !== 2) throw usage(`cogby notify ${shape}`); return args[1]; };
  if (action === 'list') return notify.list(brain, { all: !!flags.all });
  if (action === 'add') {
    if (args.length !== 1) throw usage('cogby notify add --title "…" [--body "…"] [--source NAME] [--context KEY]');
    return notify.add(brain, { title: flags.title, body: flags.body, source: flags.source, context: flags.context, priority: flags.priority,
      options: flags.options, recommend: flags.recommend, ifIgnored: flags.ifIgnored, status: flags.status, reason: flags.reason, undo: flags.undo });
  }
  if (action === 'read' || action === 'dismiss') return notify.setStatus(brain, one(`${action} <id>`), action === 'read' ? 'read' : 'dismissed');
  if (action === 'later') return notify.later(brain, one('later <id>'));
  if (action === 'answer') { if (args.length !== 3) throw usage('cogby notify answer <id> "<option>"'); return notify.answer(brain, args[1], args[2]); }
  if (action === 'comment') {
    if (args.length !== 3) throw usage('cogby notify comment <id> "<words>"');
    return notify.comment(brain, args[1], args[2], { author: require('./write.cjs').writer(brain, { env, author: flags.author }).author, source: flags.source });
  }
  throw usage(`notify ${action}: use add, list, read, dismiss, later, answer or comment.`);
}

// The Notion mirror: a copy of the brain under one Notion page, off until the owner turns it on (core/brain/mirror.cjs).
// Its command and flags are named here, apart from the lists at the top that every other command shares.
COMMANDS.add('mirror'); VALUE_FLAGS.add('--parent'); for (const flag of ['--dry-run', '--if-on']) BOOL_FLAGS.add(flag);
function mirrorCommand(brain, args, flags, env, cwd) {
  const mirror = require('./mirror.cjs');
  const action = args[0] || 'status';
  const shape = 'cogby mirror [status] | on --parent <notion page link> | off | plan | page <key> | done <key> --id <notion page link>|none | pull [--data FILE] [--dry-run] | push [--limit N] [--dry-run] [--if-on]';
  const alone = () => { if (args.length > 1) throw usage(shape); };
  const key = () => { if (args.length !== 2) throw usage(shape); return args[1]; };
  let result;
  if (action === 'status') { alone(); result = mirror.status(brain, { env }); }
  else if (action === 'on') { alone(); result = mirror.setOn(brain, flags.parent, { env }); }
  else if (action === 'off') { alone(); result = mirror.setOff(brain, { env }); }
  else if (action === 'plan') { alone(); result = mirror.plan(brain); }
  else if (action === 'page') result = mirror.onePage(brain, key());
  else if (action === 'done') { if (flags.id === undefined) throw usage('cogby mirror done <key> --id <notion page link>|none'); result = mirror.done(brain, key(), flags.id); }
  else if (action === 'pull') { alone(); result = mirror.pull(brain, { env, dryRun: !!flags.dryRun, data: flags.data === undefined ? undefined : mirror.readData(flags.data, cwd) }); }
  else if (action === 'push') { alone(); result = mirror.push(brain, { env, limit: flags.limit, dryRun: !!flags.dryRun, ifOn: !!flags.ifOn }); }
  else throw usage(`mirror ${action}: use status, on, off, plan, page, done, pull or push.`);
  // `did`, not `action`: a page of the plan has an action of its own (create, update, unchanged).
  return { ...result, did: action };
}

// Routines: what the owner does on a rhythm with Claude (core/brain/routines.cjs).
function routinesCommand(brain, args, flags, who) {
  const routines = require('./routines.cjs');
  const action = args[0] || 'list';
  const by = { env: who.env, actor: who.actor, author: flags.author, source: flags.source };
  const name = (shape) => { if (args.length !== 2) throw usage(`cogby routines ${shape}`); return args[1]; };
  if (action === 'list' || action === 'due') {
    if (args.length > 1) throw usage('cogby routines [--all] | cogby routines due');
    return { ...routines.list(brain, { due: action === 'due' }), all: !!flags.all };
  }
  if (action === 'add') return routines.add(brain, name('add "<name>" --run "<skill or prompt>" --rhythm "<rhythm>" [--why "…"] [--scheduled "<pointer>"]'), { ...by, run: flags.run, rhythm: flags.rhythm, why: flags.why, scheduled: flags.scheduled, date: flags.date, where: flags.where, instructions: flags.instructions });
  if (action === 'edit') return routines.edit(brain, name('edit <name> [--run "…"] [--rhythm "…"] [--why "…"] [--scheduled "<pointer>"|none] [--title "…"]'), { ...by, run: flags.run, rhythm: flags.rhythm, why: flags.why, scheduled: flags.scheduled, title: flags.title, where: flags.where, instructions: flags.instructions });
  if (action === 'pause' || action === 'resume') return routines.setStatus(brain, name(`${action} <name> [--reason "…"]`), action === 'pause' ? 'paused' : 'active', { ...by, reason: flags.reason });
  if (action === 'ran') return routines.ran(brain, name('ran <name> --source "<evidence>" [--result "<one line>"] [--if-any]'), { ...by, result: flags.result, date: flags.date, ifAny: !!flags.ifAny });
  if (action === 'offered') return routines.offered(brain, name('offered "<the routine, in one line>" --source "<what in the brain shows the need>"'), { ...by, date: flags.date });
  throw usage(`routines ${action}: use list, due, add, edit, pause, resume, ran or offered.`);
}

// ---- dispatch ---------------------------------------------------------------------------------

function run(parsed, io) {
  const { command, args, flags } = parsed;
  const env = io.env || process.env;
  const cwd = io.cwd || process.cwd();
  if (command === 'init') {
    if (args.length) throw usage('init takes no argument; name the folder with --brain PATH.');
    return init(flags.brain ? path.resolve(cwd, flags.brain) : cwd, { version: io.version, env, plugin: !flags.noPlugin && !env.COGBY_NO_PLUGIN, run: io.run, default: flags.default ? true : undefined, private: !!flags.private });
  }
  // Found only once the command is known to be well formed: a mistyped command is a usage error
  // wherever it is typed, brain or no brain.
  let found = null;
  const where = () => found || (found = brainLib.findBrain({ brain: flags.brain, env, cwd }));
  const actor = flags.agent ? 'agent' : flags.human ? 'human' : undefined;
  const writeOptions = {
    source: flags.source, author: flags.author, actor, env, create: !!flags.create, title: flags.title,
    expectedRevision: flags.expectedRevision,
  };
  if (command === 'sync') {
    if (flags.background) {
      if (flags.source) throw usage('cogby sync --quick --background takes no --source.');
      return require('./background.cjs').run(where(), { env });
    }
    return brainLib.sync(where(), { source: flags.source, quick: !!flags.quick });
  }
  if (command === 'index') {
    const action = args[0] || 'status';
    if (args.length > 1 || !['on', 'off', 'status'].includes(action)) throw usage('cogby index on | off | status');
    return action === 'status' ? brainLib.indexStatus(where()) : brainLib.setIndex(where(), action === 'on');
  }
  if (command === 'search') {
    if (!args.length) throw usage('search needs words: cogby search "<words>"');
    return require('./search.cjs').search(where(), args.join(' '), { source: flags.source, limit: flags.limit });
  }
  if (command === 'get') {
    if (args.length !== 1) throw usage('get takes one page: cogby get <slug>');
    return brainLib.getPage(where(), args[0], { source: flags.source });
  }
  if (command === 'log') {
    if (args.length !== 2) throw usage('cogby log <slug> "<line>" --source "<evidence>"');
    return require('./write.cjs').log(where(), args[0], args[1], { ...writeOptions, date: flags.date, decision: !!flags.decision, who: flags.who, expect: flags.expect, review: flags.review });
  }
  if (command === 'decisions') {
    const decisions = require('./decisions.cjs');
    if (args[0] === 'review') {
      if (args.length !== 3) throw usage('cogby decisions review <id> as-expected|not-as-expected|reversed --source "<evidence>" [--note "…"]');
      return decisions.review(where(), args[1], args[2], { source: flags.source, author: flags.author, actor, env, date: flags.date, note: flags.note, scope: flags.project });
    }
    if (args.length > 1 || (args.length && flags.project)) throw usage('cogby decisions [--project NAME|PAGE] [--since YYYY-MM-DD] [--due] [--who …] [--outcome …] [--all] [--limit N]');
    return decisions.list(where(), { scope: flags.project || args[0], since: flags.since, due: !!flags.due, who: flags.who, outcome: flags.outcome, all: !!flags.all, limit: flags.limit });
  }
  if (command === 'unconfirmed') {
    if (args.length) throw usage('cogby unconfirmed [--page SLUG] [--project NAME] [--limit N]');
    return require('./confirm.cjs').list(where(), { page: flags.page, project: flags.project, limit: flags.limit });
  }
  if (command === 'confirm' || command === 'retract') {
    if (args.length < 2) throw usage(`cogby ${command} <page> <ref> [<ref> …]${command === 'retract' ? ' [--reason "…"]' : ''}`);
    return require('./confirm.cjs')[command](where(), args[0], args.slice(1), {
      author: flags.author, actor, env, confirmedByOwner: !!flags.confirmedByOwner, reason: flags.reason, expectedRevision: flags.expectedRevision,
    });
  }
  if (command === 'routines') return routinesCommand(where(), args, flags, { env, actor });
  if (command === 'project') {
    if (args[0] !== 'status' || args.length !== 3) throw usage('cogby project status <name> <planning|active|on-hold|done>');
    return require('./project.cjs').setStatus(where(), args[1], args[2], { env, actor, author: flags.author, source: flags.source });
  }
  if (command === 'proactive') {
    const routines = require('./routines.cjs');
    const action = args[0] || 'status';
    if (args.length > 1 || ![...routines.MODES, 'status'].includes(action)) throw usage('cogby proactive quiet | suggest | act | status');
    const brain = where();
    if (action !== 'status') routines.setMode(brain, action);
    return routines.status(brain, action !== 'status');
  }
  if (command === 'remember') {
    if (args.length !== 2) throw usage('cogby remember <slug> "<claim>" --source "<evidence>"');
    return require('./write.cjs').remember(where(), args[0], args[1], {
      ...writeOptions, kind: flags.kind, replaces: flags.replaces, validFrom: flags.validFrom, validUntil: flags.validUntil,
    });
  }
  if (command === 'context') return require('./context.cjs').context(where(), { repo: flags.repo, cwd });
  if (command === 'card') {
    const cards = require('./cards.cjs');
    if (!args.length) return { cards: cards.names().map((name) => ({ name, about: cards.CARDS[name].about })) };
    if (args.length > 1) throw usage('cogby card [<name> [--data FILE]]');
    let data = {};
    if (flags.data !== undefined) {
      try { data = JSON.parse(require('fs').readFileSync(require('path').resolve(cwd, flags.data), 'utf8').replace(/^\uFEFF/, '')); }
      catch (error) { throw new BrainError('BAD_DATA', `Could not read the card's data from ${flags.data}: ${error.message}`, 'Pass a JSON file holding an object.'); }
    }
    return cards.render(args[0], data);
  }
  if (command === 'wrapup') {
    const scope = require('../lib/wrapup-scope.cjs');
    const action = args[0] || 'status';
    if (args.length > 1 || !['auto', 'review', 'off', 'status'].includes(action)) throw usage('cogby wrapup auto | review | off | status');
    const brain = where();
    if (action !== 'status') scope.setMode(brain, action);
    const status = scope.status(brain);
    return { wrapup: status.mode, forced_by_env: status.envForced, switched: action !== 'status' };
  }
  if (command === 'view') {
    if (args[0] === 'auto') {
      const action = args[1] || 'status';
      if (args.length > 2 || !['on', 'off', 'status'].includes(action)) throw usage('cogby view auto on | off | status');
      return action === 'status' ? require('./view.cjs').autoStatus(where()) : require('./view.cjs').setAuto(where(), action === 'on');
    }
    if (args.length) throw usage('cogby view [--json] [--html [--meetings FILE] [--runs FILE] [--sessions FILE] [--tasks FILE]] [--artifact URL|none] [--project NAME] | cogby view auto on|off|status');
    if (flags.html) {
      let meetings; let runs; let sessions; let tasks;
      if (flags.tasks !== undefined) {
        try { tasks = JSON.parse(require('fs').readFileSync(require('path').resolve(cwd, flags.tasks), 'utf8').replace(/^\uFEFF/, '')); }
        catch (error) { throw new BrainError('BAD_TASKS', `Could not read the tasks from ${flags.tasks}: ${error.message}`, 'Pass a JSON file holding a list.'); }
      }
      if (flags.sessions !== undefined) {
        try { sessions = JSON.parse(require('fs').readFileSync(require('path').resolve(cwd, flags.sessions), 'utf8').replace(/^\uFEFF/, '')); }
        catch (error) { throw new BrainError('BAD_SESSIONS', `Could not read the sessions from ${flags.sessions}: ${error.message}`, 'Pass a JSON file holding a list.'); }
      }
      if (flags.meetings !== undefined) {
        try { meetings = JSON.parse(require('fs').readFileSync(require('path').resolve(cwd, flags.meetings), 'utf8').replace(/^\uFEFF/, '')); }
        catch (error) { throw new BrainError('BAD_MEETINGS', `Could not read the meetings from ${flags.meetings}: ${error.message}`, 'Pass a JSON file holding a list.'); }
      }
      if (flags.runs !== undefined) {
        try { runs = JSON.parse(require('fs').readFileSync(require('path').resolve(cwd, flags.runs), 'utf8').replace(/^\uFEFF/, '')); }
        catch (error) { throw new BrainError('BAD_RUNS', `Could not read the scheduled runs from ${flags.runs}: ${error.message}`, 'Pass a JSON file holding one object.'); }
      }
      return require('./center.cjs').build(where(), { meetings, runs, sessions, tasks, meetingsReadAt: new Date().toTimeString().slice(0, 5), project: flags.project });
    }
    return flags.artifact !== undefined ? require('./view.cjs').setArtifact(where(), flags.artifact, flags.project) : require('./view.cjs').view(where());
  }
  if (command === 'map') {
    if (args.length) throw usage('cogby map [--json]');
    return require('./map.cjs').map(where());
  }
  if (command === 'meetings') {
    const meetings = require('./meetings.cjs');
    if (args[0] === 'add') {
      if (args.length !== 1 || flags.data === undefined) throw usage('cogby meetings add --data FILE (a JSON object; "-" reads it from stdin)');
      let data;
      try { data = JSON.parse((flags.data === '-' ? require('fs').readFileSync(0, 'utf8') : require('fs').readFileSync(path.resolve(cwd, flags.data), 'utf8')).replace(/^\uFEFF/, '')); }
      catch (error) { throw new BrainError('BAD_DATA', `Could not read the meeting record from ${flags.data}: ${error.message}`, 'Pass a JSON file holding an object: title, date, with, pages, transcript, summary, line, written.'); }
      return meetings.add(where(), data, { author: flags.author, actor, env });
    }
    if (args.length) throw usage('cogby meetings [--page SLUG] [--limit N] | cogby meetings add --data FILE');
    return meetings.list(where(), { page: flags.page, limit: flags.limit });
  }
  if (command === 'mirror') return mirrorCommand(where(), args, flags, env, cwd);
  if (command === 'notify') return notifyCommand(where(), args, flags, env);
  if (command === 'todo') return todoCommand(where(), args, flags, cwd);
  if (command === 'note') return noteCommand(where(), args, flags, cwd);
  if (command === 'link') {
    // The two sides are told apart by position: the folder first, the card second. One argument is
    // the card, and the folder is the one the command was run in. `--repo PATH` is the older way to
    // name the folder and still works.
    const link = require('./link.cjs');
    const shape = 'cogby link <folder> <card> [--role ROLE] [--about "<one line>"] [--name NAME] | cogby link --none [<folder>] | cogby link --undo [<folder>]';
    const isFolder = (name) => { try { return require('fs').statSync(path.resolve(cwd, name)).isDirectory(); } catch { return false; } };
    const folderFrom = (named) => {
      if (named !== undefined && flags.repo !== undefined) throw usage('Name the folder once: as the first argument, or with --repo.');
      return named !== undefined ? named : flags.repo;
    };
    if (flags.none || flags.undo) {
      if (args.length > 1 || (flags.none && flags.undo) || flags.role || flags.about || flags.name) throw usage(shape);
      if (args.length && !isFolder(args[0])) throw usage(`"${args[0]}" is not a folder. ${flags.none ? 'cogby link --none [<folder>]' : 'cogby link --undo [<folder>]'}`);
      const folder = folderFrom(args[0]);
      return flags.none ? link.setNone(where(), { folder, cwd }) : link.undo(where(), { ...writeOptions, create: false, folder, cwd });
    }
    if (args.length < 1 || args.length > 2) throw usage(shape);
    const [named, card] = args.length === 2 ? args : [undefined, args[0]];
    if (named !== undefined && !isFolder(named) && isFolder(card)) throw usage(`The folder comes first, then the card: cogby link "${card}" ${named}`);
    const folder = folderFrom(named);
    const say = flags.json ? undefined : (line) => (io.stdout || process.stdout).write(`${line}\n`);
    try {
      return link.link(where(), card, { ...writeOptions, folder, cwd, role: flags.role, about: flags.about, name: flags.name, announce: say });
    } catch (error) {
      // One argument is read as the card. When it is a folder and no card has that name, say what is missing.
      if (error instanceof BrainError && error.code === 'NOT_FOUND' && folder === undefined && isFolder(card)) {
        throw new BrainError('NOT_FOUND', error.message, `"${card}" is a folder. Name the card too: \`cogby link "${card}" <card>\`.`);
      }
      throw error;
    }
  }
  if (command === 'places') {
    if (args.length > 1) throw usage('cogby places [<page>] [--all]');
    return require('./link.cjs').places(where(), { page: args[0], all: !!flags.all });
  }
  if (command === 'dream') return require('./dream.cjs').dream(where(), { env, since: flags.since });
  if (command === 'sources') {
    const action = args[0] || 'list';
    if (action === 'list') return brainLib.sourceStatus(where());
    if (action === 'add') {
      if (args.length !== 2) throw usage('cogby sources add <path> [--id ID] [--no-default-search]');
      const added = brainLib.addSource(where(), args[1], { id: flags.id, defaultSearch: !flags.noDefaultSearch, cwd });
      return { added, sync: brainLib.refresh(where(), { source: added.id }) };
    }
    if (action === 'remove') {
      if (args.length !== 2) throw usage('cogby sources remove <id>');
      const removed = brainLib.removeSource(where(), args[1]);
      brainLib.refresh(where());
      return { removed };
    }
    throw usage(`sources ${action}: use add, list or remove.`);
  }
  if (command === 'serve') {
    if (!flags.mcp) throw usage('serve needs a mode: cogby serve --mcp');
    // The project folder when a plugin starts the server, else the folder the command ran in.
    const start = env.CLAUDE_PROJECT_DIR || cwd;
    return require('./mcp.cjs').serve(() => brainLib.findBrain({ brain: flags.brain, env, cwd: start }),
      { stdin: io.stdin, stdout: io.stdout, version: io.version, cwd: start, env }).then(() => ({ served: true }));
  }
  throw usage(`Unknown command: ${command}`);
}

// Returns the exit code: 0, 1 for a refusal or failure, 2 for a command typed wrong.
async function main(argv, io = {}) {
  const stdout = io.stdout || process.stdout;
  const stderr = io.stderr || process.stderr;
  const json = argv.includes('--json');
  try {
    const parsed = parse(argv);
    if (parsed.flags.version) { stdout.write(`cogby ${io.version || 'unknown'}\n`); return 0; }
    if (parsed.flags.help || !parsed.command || parsed.command === 'help') { stdout.write(`${HELP}\n`); return 0; }
    const result = await run(parsed, io);
    if (parsed.command === 'serve') return 0;
    stdout.write(`${json ? JSON.stringify(result, null, 2) : human(parsed.command, result)}\n`);
    // On stderr, so the JSON on stdout stays one object.
    if (SIGNED.has(parsed.command) && require('./write.cjs').humanRefused({ env: io.env || process.env, actor: parsed.flags.agent ? 'agent' : parsed.flags.human ? 'human' : undefined })) {
      stderr.write(`${NOT_HUMAN}\n`);
    }
    if (parsed.command === 'init') {
      const env = io.env || process.env;
      await guideSources(result.brain, { stdin: io.stdin, stdout, cwd: io.cwd, skip: json || parsed.flags.noSources || !!env.COGBY_NO_SOURCES });
    }
    return 0;
  } catch (error) {
    const known = error instanceof BrainError;
    const payload = { code: known ? error.code : 'INTERNAL', message: error.message, hint: known ? error.hint : null };
    if (json) stdout.write(`${JSON.stringify({ error: payload }, null, 2)}\n`);
    else stderr.write(`cogby: ${payload.message}${payload.hint ? `\n  ${payload.hint}` : ''}\n`);
    return known && error.code === 'USAGE' ? 2 : 1;
  }
}

module.exports = { COMMANDS, HELP, parse, init, guideSources, human, run, main };

// The version is the plugin manifest's, the one a person is shown (core/lib/version.cjs).
if (require.main === module) main(process.argv.slice(2), { version: require('../lib/version.cjs').pluginVersion() || require('../../package.json').version }).then((code) => { process.exitCode = code; });
