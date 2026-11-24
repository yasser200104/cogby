# Strong points

The working list of what makes Cogby different from a notes folder with a search box: context and
memory you own, a partner for working well with AI and keeping your own judgement. Work on the
plugin is chosen and judged against this list: prefer a change that finishes one of these points or
makes one easier to see. Every "today" and "missing" line was checked in the code on 2026-11-13,
and each point was exercised by hand in a throwaway brain on 2026-11-14, for version 0.3.1. What
0.3.2 changed (in points 1, 3, 4, 6 and 7) was exercised by hand again on 2026-11-15. What 0.3.3
changed (linking in points 1 and 9, the day log in points 1 and 7) was tried by hand in a throwaway
brain the same day, by the session that built each change. Of what 0.3.4 changed, the `recorded`
day and staleness counted from it, `cogby meetings` and `cogby --version` were tried by hand in a
throwaway brain on 2026-11-16; the wrap-up review fix, setup and the cards were checked by their
tests, and the `digest` skill change by reading it, not by hand at release. Of what 0.3.5 changed
(the cards of point 8, and setup), every command setup names was run by hand in a throwaway brain
on 2026-11-16, the five kept cards were compared byte for byte with 0.3.4's, and one was shown and
clicked in the desktop app; setup in a chat where the plugin had just been installed was not tried
by hand. Check again before relying on one.

## 1. One brain across every folder

**What.** The plugin is installed once for the user, and a session in any folder knows where the
brain is. Every folder the owner works in has a known home in the brain, or is known to have none:
a folder is a place of one project or area page, with a role, and the session opens by that role.
**Where.** `.claude-plugin/plugin.json` (three hooks, through `.claude/hooks/plugin-hook.cjs`),
`.claude/hooks/brain-context.cjs`, `.claude/hooks/capture-log.cjs`, `findBrain` and `defaultBrain`
in `core/brain/brain.cjs`, `core/brain/context.cjs`, `core/brain/link.cjs` (`cogby link`,
`cogby places`, the `place` tool). `core/lib/locate.cjs` finds a brain only at or above the working
folder; the any-folder answer is the default brain in `brains.json`. The brain's rules:
`core/brain/rules.cjs` and `agentsStatus` in `core/lib/brain-harness.cjs`. Tests in
`tests/places.test.cjs` and `tests/harness.test.cjs`.
**Today.** Holds for reading, for the tools and for the day's log. Outside the brain, session start names the default
brain, the last line parked there and what waits on the owner, then says what the folder is. In a
`code`, `workspace` or `environment` place it shows the page's summary, its open to-dos, last three
timeline lines, open commitments and decisions in force. In a `reference` or `scratch` place it is
two lines and the place's name. Each says in one line what may be written from there. A folder
marked "not a brain project" (`cogby link --none`, this machine only) is said to be one. A folder
the brain does not know is told "This folder is not in your brain", and Claude is told to ask the
owner once whether to save it: at the first session in a git repository, from the second anywhere
else, twice at most for one folder, never under `cogby proactive quiet`. The tool server resolves
the same brain, so `log`, `remember`, `place` and the wrap-up skill work from any folder, and a
to-do or note added from a linked folder belongs to that folder's page. The per-turn day log runs
in the brain and in a `code`, `workspace` or `environment` place: an entry written from a place has
a line naming the place and its role (`Place: <name> · code`), never the folder's path. Every entry
says which card it is about on one line, the same everywhere: `Card: projects/x/card`, several
joined by ` · `. In a place it is the place's page, then any other card the turn wrote to. In the
brain it is worked out from the turn's tool calls in the tail of the transcript: the pages written
with `log` or `remember`, the files edited under a project or an area, or, when nothing was
written, the cards read (three at most: a turn that read across more is about none). No card
known, no line. In a `reference` or `scratch` place, a folder marked "not a brain project"
and a folder the brain does not know, it writes nothing, in the brain or in the folder. The log is
still not in default search and not shown at session start. Named, it is searched by entry:
`cogby search <card> --source log` puts the entries about that card first, newest first (`match`
is `card`), then the entries that hold the words, and reads the log folder before it answers
(`searchLog` in `core/brain/search.cjs`, tests in `tests/day-log.test.cjs`). The day's file is committed when the
session ends, in the brain and in those places, by the session-end hook: a plain git commit, no
model, whatever the automatic wrap-up is set to (point 7).
A brain's `AGENTS.md` follows the plugin. A session start, in the brain or in any folder that uses
it, replaces a copy that came from an older version with the plugin's own, commits that one file in
the brain and says so in one line. It tells Cogby's own copy from an edited one by the rules under
the first line: every `AGENTS.md` this repository shipped is on a list of hashes. A copy edited by
hand, or the owner's own file with no generated first line, is left alone and that is said once;
the same version, or a newer one written by another machine, is left alone and nothing is said. A
missing file is written again. `.claude/CLAUDE.md`, where a brain's own rules go, is never touched.
**Missing.**
- The automatic wrap-up still runs only for a session opened inside the brain. In a linked place the
  session-end hook commits the day's log and starts nothing else, even with `cogby wrapup auto`.
  It is off by default anywhere.
- The session whose start replaced `AGENTS.md` may already have read the old one: the new rules are
  certain only from the next session. A hand-edited copy is never merged: the owner moves their
  rules to `.claude/CLAUDE.md` and deletes the file, and the next session start writes the current one.
- No baseline is recorded and no session id is given outside the brain, so a wrap-up run by hand in
  a linked place cannot scope its commit to the session: the scope script reports no baseline, names
  only the shared stores and the day's log, and the rest is read from `git status` by hand.
- The day-log hook works out what the folder is after every turn, in every folder: two git calls and
  one read of the index, nothing cached between turns.
- The card of an entry is known only from tool calls. A turn that talked about a project and
  touched none of its files gets no `Card:` line and is found by its words. A page outside
  `projects/` and `areas/` names no card. A card renamed later is not followed: old entries keep
  the old slug.
- What may be written from a place is a line in the session context and the wrap-up skill, not a
  check: `log` and `remember` do not know which folder they were called from.
- The sessions-per-folder count and the "not a brain project" marks are per machine.

## 2. Claude writes evidence, never the current truth

**What.** A session adds a dated timeline line or a sourced fact. It does not rewrite the summary
at the top of a page. Nothing is deleted: a replaced fact is marked superseded and stays.
**Where.** `log`, `remember`, `writePage` and `requireSource` in `core/brain/write.cjs`; the `log`
and `remember` tools in `core/brain/mcp.cjs`.
**Today.** Holds through Cogby's tools and commands. Both writes are refused without a source. A
fact is superseded only when `--replaces` names its row; a similar fact is named and left alone. A
write that cannot be indexed is put back, and each write is one commit of one file. A page in a
read-only source is refused. Five write-path bugs against this point and point 4 were fixed in
commit `9ee410a`, with regression tests in `tests/promises.test.cjs`.
**Missing.**
- Nothing in code stops a session from editing a page file directly. That part is a rule in
  `AGENTS.md` and the skills, not a check.
- A new summary is proposed by a skill and typed in once the owner accepts. No command applies it
  and records that the owner accepted.

## 3. Every line says who wrote it

**What.** Each timeline line and each fact ends with its author, whether a person or an agent wrote
it, and whether it is confirmed. What an agent wrote stays marked until the owner confirms it, and
the owner can retract a wrong line without deleting it.
**Where.** `writer()` in `core/brain/write.cjs`; `renderBy`, `parseBy` and `retagLine` in
`core/brain/page.cjs`; `core/brain/confirm.cjs` (`cogby unconfirmed`, `cogby confirm`,
`cogby retract`, the `confirm` tool); `tag` and the count in `core/brain/context.cjs`; the `author`,
`actor`, `agent_name`, `confirmed`, `retracted` and `retracted_at` columns in `core/brain/db.cjs`.
Which agent: `sessionAgent` in `core/brain/write.cjs`, `agentName` in `core/brain/page.cjs`, and
`initialize` in `core/brain/mcp.cjs`. Tests in `tests/confirm.test.cjs`.
**Today.** Holds through Cogby's commands and tools. Anything through the tool server is an agent's
and unconfirmed. So is every command run inside a Claude session (the `CLAUDECODE` environment),
whatever `--human`, `actor: 'human'` or `COGBY_ACTOR=human` says: the line is written as an agent's
and the command says on stderr that the claim was not honoured. A person running `cogby` in their
own terminal, outside a session, writes a confirmed human line (`--agent` marks it an agent's).
An agent's line names the agent when Cogby knows it (`[yasser · agent claude-code · unconfirmed]`):
the name the client gave the tool server when it connected, `claude-code` in a Claude Code shell, or
`COGBY_AGENT=<name>` in another agent's shell, which also makes the write an agent's. The name is
never a tool argument or a flag. Confirming or retracting a line keeps it, and a line that ends in
`agent` alone reads as before.
`cogby unconfirmed` lists an agent's unconfirmed lines and facts from the index, by page or project.
`cogby confirm <page> <ref>` changes only the state in the line's tail and keeps who wrote it; a fact
is named by its row (`#3`), a timeline line by a six-character id worked out from its date, source
and words. `cogby retract` marks a line `retracted` (a fact: `retracted <date>` in its status): it
stays in the file and leaves the session context, the decision log, the view and the active facts.
Each is one commit of one file. From an agent both are refused without `--confirmed-by-owner`, and
`--human` does not stand in for it: `cogby confirm` with the owner's yes is the only way an agent's
line becomes confirmed. The session context says how many unconfirmed lines the brain holds and puts `(agent, unconfirmed)`
after each one it shows. The wrap-up confirms the items the owner ticked; the weekly check-in
reports the count. Nobody is asked to confirm lines one by one: the owner says when one is wrong.
A line Cogby writes as the record of a command is not a claim, and has a fourth state: linking or
unlinking a folder, and adding, editing, pausing, resuming or recording the run of a routine, write
a line that ends in `record` (`[yasser · agent · record]`: who ran it is still said). It is never
listed or counted as unconfirmed, and is left out of "Last parked", "Latest evidence", a project's
parking spot and the view's "stopped at". Only `recorder` and `appendRecord` in
`core/brain/write.cjs` write that state, for `link.cjs` and `routines.cjs`; `log` and `remember`
cannot. The same lines written before 0.3.2 are known by their shape when a file is read (the
source Cogby gives itself for the command together with the words it writes; a "ran" line on a
routine's page), so an older brain reads the same way with nothing converted. Tests in
`tests/records.test.cjs`.
**Missing.**
- The agent's name is as given by the client or the environment, and nothing proves it.
- `--confirmed-by-owner` is still declared by the caller: passed from an agent's shell it confirms a
  line with nobody asked. The commit message says the yes came through an agent; no code can check
  that it was given.
- A session is recognised by `CLAUDECODE`, which Claude Code sets in every shell it starts. A
  command that takes the variable out first (`env -u CLAUDECODE cogby …`) reads as a person's
  terminal. That is a deliberate step and no longer a flag, but nothing inside `cogby` can tell the
  two apart.
- A decision written to the day's log (`log:today`) cannot be confirmed or retracted: that file is
  appended by a hook and never rewritten.
- Only the wrap-up confirms what the owner just approved. `capture`, `digest` and `meeting-notes`
  show their items for a yes and still write them unconfirmed.
- A retraction's reason is in the commit message only, not on the page, and nothing un-retracts a
  line but an edit by hand. Search still finds a retracted line in the page's text.
- The command center shows the count in "Needs you" and tags the timeline lines it shows, but not
  the facts, and nothing on it confirms a line: that stays `cogby confirm` with the owner's yes. The
  weekly check-in reports the count.
- To-dos, notes and notifications carry a source, not an author or an actor.
- A line from before 0.3.2 is taken for a record by its shape alone. A line written with
  `cogby log` whose source is exactly `cogby link` and whose words start `linked <name> as <role>`
  would read as one. A link or routine change recorded before 0.3.2 with a source of the caller's
  own is not recognised and stays in the unconfirmed list until confirmed.
- A record still counts as dated evidence for staleness: a page whose only recent line is a link is
  not flagged stale.

## 4. The decision log records who made the call

**What.** A decision is a timeline line on the page it is about, with its reason, who made the call
(`owner`, `accepted`, `overrode`, or `agent` for a call an agent made alone that the owner did not
see), what was expected, a review date, and later how it turned out.
**Where.** `core/brain/decisions.cjs` (`cogby decisions`, `cogby decisions review`), `asDecision`
and `parseDecision` in `core/brain/page.cjs`, `projectBlock` in `core/brain/context.cjs`.
**Today.** Holds. There is no decisions file: the list is read from every page and the day logs. A
review is a new line that points at the decision; a reversed one leaves the list and stays in the
record. A session in a linked repo is shown the project's five newest standing decisions. Once a
decision has been reviewed, the list ends with who made the call crossed with how it turned out
("Accepted from Claude 1 time: 1 not as expected."; `counts.outcome_by_who` in `--json`), and the
weekly check-in reports the same count. A `plan-page` verdict that is a decision is offered as a
decision line, never written on a guess.
A decision logged without `--who` is listed as not recorded. Who made it can be said later without
editing it: a line `who: accepted, decision of <date> #<id>` on the same page, written with
`cogby log`, is read for a decision whose own line names nobody (`parseWho` in `page.cjs`). The
weekly check-in lists the ones logged that week, asks once for each and writes the answer; `log`
refuses such a line when it points at no decision on the page. With `--who`, the counts are of
those calls only.
What the owner wants to understand themselves, and what they hand over, is one file in the brain:
`.cogby/self/information-border.md`. The session start names it (`borderBlock` in `context.cjs`).
**Missing.**
- The asking is the check-in skill's, not code: nothing asks outside a weekly review, and a decision
  older than a week with nobody recorded is asked about only when the owner says so.

## 5. The owner sets how far Claude acts alone

**What.** One setting says whether Claude stays quiet about routines, offers to run what is due, or
runs the read-only ones itself. Which routines may run unasked is a list in the code, not a page.
**Where.** `cogby proactive quiet | suggest | act | status`; `MODES`, `REPORT_ONLY`, `unattended()`
and `forContext` in `core/brain/routines.cjs`.
**Today.** Holds. The default is `suggest`. Under `act` only the check-in (any size) and `dream`
may run unasked; a wrap-up and any free-text prompt ask first, whatever a page says.
**Missing.**
- The setting is per machine (`.cogby/local.json`) and covers routines only: no per-project or
  per-skill level.
- Cogby marks each due routine `[reads only: run it]` or `[ask first]` in the session context. The
  session is trusted to follow the mark; no code stops it.

## 6. You own it

**What.** The brain is plain markdown in the owner's own git repository. No server, no account.
**Where.** `core/templates/starter-brain/`, `core/lib/brain-repo.cjs`, `commitFile` in
`core/brain/write.cjs`. The index is a local SQLite file, `.cogby/index.db`, git-ignored and
rebuilt by `cogby sync`.
**Today.** Holds. Cogby's code makes no network request, and the tool server is a local process on
stdio. No page Cogby builds asks the network for anything either: the cards, the command center and
a project's dashboard load no font, stylesheet, script or image, and name their fonts in a stack
that falls back to the system's (tests in `tests/cards.test.cjs` and `tests/brain.test.cjs`). What
leaves the machine: a `git push` to the brain's own remote, and a command center page the session
publishes.
**Missing.**
- Claude Code only: a plugin with a `bin/` folder cannot be installed on claude.ai or Cowork.

## 7. Working state lives with the knowledge

**What.** What is in flight sits in the same folder as what is known: to-dos, notes, notifications,
commitments, the day's log, how to work for the owner (`SOUL.md`) and who they are (`USER.md`).
**Where.** `core/brain/todo.cjs` (`.cogby/todos/`, `.cogby/notes/`), `core/brain/notify.cjs`
(`.cogby/notifications/`), `.claude/hooks/capture-log.cjs` (`.cogby/self/log/`), `.cogby/self/`.
A commitment is a fact of kind `commitment` on its page. What is ignored: `BRAIN_GITIGNORE` in
`core/lib/starter-brain.cjs` and `ensureIgnored` in `core/brain/db.cjs`. What the wrap-up commits:
`sharedPaths` in `core/lib/wrapup-scope.cjs`. What the session-end hook commits: `commitDayLogs` in
`core/brain/write.cjs`. What is kept out of the log: `core/lib/redact.cjs`. Tests in
`tests/brain.test.cjs`, `tests/stores.test.cjs`, `tests/redact.test.cjs` and `tests/day-log.test.cjs`.
**Today.** Holds, and travels. To-dos, notes and notifications are all committed with the brain: a
new brain ignores none of the three stores. A brain made before 2026-11-13 has the two old rules
taken out of its `.gitignore` on its next sync (a session start begins one) or its next write to a
store: exactly those two lines, once, as a commit of that one file, or left in the working tree
when the file holds the owner's own uncommitted edits. A rule the owner puts back afterwards is
kept. The outbox and health-check files beside the notes, the push subscriptions, `local.json` and
the index stay ignored. Work reaches the history without a wrap-up. Every write to a store is a
commit of that one file, behind the lock page writes take, from the brain or from any folder; a
write that is refused commits nothing, and a commit that fails leaves the write in place and says
so. The day's log is committed when a session ends, by the session-end hook, each day's file alone,
for a session in the brain or in a `code`, `workspace` or `environment` place. None of this
pushes. The wrap-up's scope still holds the three stores and the day's log whenever something in
them is uncommitted, whichever session changed them and from whichever folder, also when there is
no session baseline; a file already committed is simply not listed.
Before it is written, a turn is passed through `redact`: a value with a known shape (a GitHub or
AWS key, a JWT, a private key block) and a value known by the name beside it (`password=…`,
`"api_key": "…"`, `Authorization: …`, `Bearer …`, `--token …`, the password in
`scheme://user:password@host`) are replaced, and the name is kept. Only then is it cut: the ask
to 1,000 characters and the answer to 4,000, so a secret is never split at the cut. Measured on
2,200 turns of real sessions, 95% of asks and 97% of answers fit whole (the old caps, 200 and
1,200, kept 37% of answers whole), and a day's file grows about 1.6 times. Session start counts open to-dos and notifications, and says so when a store
cannot be read. A corrupt store refuses writes and is left untouched.
**Missing.**
- No merge for the stores. Each write rewrites the whole JSON file and its `updated` stamp, so two
  machines that both changed the same store since they last shared a commit get an ordinary git
  conflict on pull. The file then holds conflict markers and is not JSON: session start says the
  store cannot be read, and writes to it are refused until the owner resolves it by hand.
- These commits are local. They leave the machine with the next `git push`: the owner's, or the
  automatic wrap-up's when it is on. A session that is killed never runs the session-end hook; its
  day's log is committed when the next session ends.
- Redaction goes by shape and by name. A secret said in plain words with no name beside it, "the
  password is hunter2" with no colon or equals sign, and a letters-only password written loose
  (`password: correcthorse`) are not caught, and the log is committed.
- The notification store holds whatever a notification said. It is now in the brain's history and
  goes wherever the brain is pushed.
- The day's log is written in the brain and in `code`, `workspace` and `environment` places, and
  nowhere else (point 1).

## 8. Micro UIs with a return leg

**What.** Small fixed pages and cards the owner answers by clicking, built from their own brain.
Each answer comes back to the session.
**Where.** `core/brain/cards.cjs` (`cogby card`); the `quiz-me`, `picture`, `plan-page` and
`my-view` skills; `.claude/skills/plan-page/assets/decision-kit.js`;
`core/templates/command-center.html` and `core/brain/center.cjs`.
**Today.** Holds. Code fills each card from data, so no note can become markup. A card button sends
one chat message. `plan-page` answers return through the page's store, a pasted block or a
screenshot. What the owner sent from the command center is read and applied before it is rebuilt.
**Missing.**
- `quiz-me` keeps nothing about what the owner missed. The only trace is a to-do, on a yes.
- Cards need a session that can show an inline visual; elsewhere the same skills answer in text.
- A project's own dashboard page has no store: its answers leave by copy and paste.

## 9. Extra sources and linked places, read where they live

**What.** A folder of notes is indexed in place and stays read-only. A folder the owner works in
(a code repo, a workspace, an environment, reference material, a scratch folder) is a place of one
project or area page. The brain keeps the pointer, not a copy.
**Where.** `addSource`, `listSources` and `walk` in `core/brain/brain.cjs` (`cogby sources`),
`core/brain/link.cjs` (`cogby link`, `cogby places`), `setBlock` in `core/brain/page.cjs`,
`core/brain/dream.cjs` (commits of linked repos).
**Today.** Holds. A search hit names its source (`source:slug` in text, `source` and `file` in
JSON). A write to a source page is refused. Credential-looking paths are never opened. A page holds
several places, one line each in its frontmatter (`places:`): the normalized git remote or a short
name, a role and a one-line description. That half travels with the brain; the folder's path stays
in `.cogby/local.json`. A place with a remote resolves from any clone; one without resolves by its
path on this machine. A page with the older `repo:` field reads as one `code` place with nothing
to convert. Linking and unlinking each add a timeline line in the same one-file commit, and an
unlinked place stays on the page, marked. One folder belongs to one page: a second link is refused.
A credential in a remote URL and a secret-looking value in a description are not written. A `code`
place's `docs/` folder becomes a source, and `dream` lists the new commits of every linked folder
that is a repository.
**Missing.**
- Sources and folder paths are registered per machine (`.cogby/local.json`): a place named by a
  short name has to be linked once on each machine.
- One folder cannot belong to several pages.
- No remote sources: the `remote` column exists and is always empty.
- Only `.md`, `.markdown` and `.txt` files are indexed. Of a linked place, only a `code` place's `docs/`.

## Not what makes it special

These parts are needed and ordinary. They are not the focus. Whether to keep any is the owner's call.

- Keyword search (`core/brain/search.cjs`): full-text with stemming, no model.
- The `design` and `clean-writing` skills.
- The `projects/`, `areas/`, `resources/`, `archive/` folder layout.
- `meeting-prep`, `meeting-notes`, `digest` and `capture` as skills. What is special in them is
  points 2 to 4: they write sourced evidence and record who made each call.
- Stale-page flags and the nightly `dream` pass.
