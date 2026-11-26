# Reference

The detail behind the [README](../README.md): the cards in the chat, what runs on its own, the tools
and every command, and how the skills are built.

## Cards in the chat

In the desktop and web apps, four skills show a small card inside the chat where a click is worth
more than text: the session wrap, the meeting debrief and the digest each show what they would save
for you to tick, and the quiz runs in one card. A click sends an ordinary chat message, and Claude
does the work from there. In a terminal the same skills answer in text. A picture is not a card:
Claude draws it with the chat's own visual tool.

Everything else is said in the chat. The check-in, the meeting brief and the end of a session wrap
are text; the wrap ends with one signed line, such as "Cogby · 3 lines saved to acme".

Every card comes from one kit in `core/brain/cards.cjs`: code fills it from data, so the look is the
same everywhere and nothing a note says can become markup. `cogby card` lists them, with the data
each takes; the skill that shows a card gives that data in full.

Onboarding needs none of Cogby's tools or cards. In the chat where you have just installed the
plugin, the tool server is not running yet, so onboarding runs on commands Claude runs for you
(`node "<plugin>/bin/cogby" …`) from its first step to its last. Its steps are said in the chat,
from `screens-text.md` beside the skill: the same meaning, in the same order, in the language you
write in. One step is a screen, Check it, kept in `screens.html` (Cogby's colours and mark): Claude
copies it into its own inline visual and fills in your names and a short list of what it found, one
line per item; the screen draws the rows itself. It says its plain-text version where a chat cannot
show visuals. A click on the screen sends an ordinary reply.

## What runs on its own

- **When a session starts:** one hook prints the brain's context, with the routines that are due in
  a few lines (nothing when none is). It calls no model and starts nothing.
- **Routines, as far as you allow:** `cogby proactive quiet` says nothing about routines unless you
  ask. `cogby proactive suggest`, the default, lists what is due and Claude offers to run it.
  `cogby proactive act` lets Claude run a due routine that only reads or reports (a check-in, the
  daily look-back, the nightly `dream`), record the run and leave you a notification saying what it did. A routine that
  writes to a page's summary, sends anything or touches anything outside the brain asks first,
  whatever the setting, and so does any routine whose prompt is free text: which ones may run
  unasked is a list in the code, not something a page can say about itself. There is no daemon: a
  routine runs when Claude's scheduler starts a session for it, or when you open one.
- **When a session starts:** Cogby says where the brain is and what waits on you. If the plugin has
  been updated since the brain's `AGENTS.md` was written, that file is replaced with the current
  rules and committed on its own, and the session is told in one line. A copy you edited is left
  alone and you are told once; your own rules belong in the brain's `.claude/CLAUDE.md`, which
  Cogby never touches.
- **After each turn:** one hook appends what was asked and answered to today's log in the brain:
  the ask up to 1,000 characters and the answer up to 4,000, which keeps nearly every turn whole.
  The full text stays in Claude's transcript. It runs in the brain and in a folder linked as a
  `code`, `workspace` or `environment` place, where each entry names the place. In any other folder
  it writes nothing. An entry says which card it is about, on a line like
  `Card: projects/acme/card`. In a place that is the place's page. In the brain it is the
  project or area the turn wrote to (with `log`, `remember` or an edited file), or the few it read
  when it wrote to none. When no card can be known, the line is left out. Before a turn is
  written, values that look like a secret are replaced and their name kept: known token shapes, and
  values named as a password, secret, token, API key or authorization. A secret said in plain
  words, with no name beside it, is not caught: do not paste one into a session.
- **Everything said about one card:** `cogby search acme --source log` lists the log entries
  about that card, newest first, then the entries that hold the words. One result is one entry of
  one day. The card can be given by its name, its folder or its slug. The log is searched only when
  it is named: a plain search never shows it.
- **The search index, in the background:** a search answers from the index as it is and never waits
  for your folders to be read. What Cogby writes is indexed in the same step. What changes outside
  Cogby (a file you edit, a mounted folder) is picked up by a background sync: a short process
  started when a session starts, after each turn, and by any search that finds the index more than
  a minute old. Nobody waits for it, only one runs at a time, and it exits when it is done: no
  watcher, no service. Every search result says when the index was last synced (`index_as_of`).
  One search does read files first: a search of the day's log reads the log folder, so the turn
  that just ended is found.
  `cogby sync` does a full pass now; `COGBY_NO_BACKGROUND_SYNC=1` turns the background one off.
- **When a session closes:** the day's log is committed to the brain, in the brain and in those
  linked places: a plain git commit of that one file, no model, no push. Nothing else, unless you
  turn it on. `cogby wrapup auto` makes a background
  Claude commit the brain and push it to its own remote; `cogby wrapup review` commits without
  pushing and leaves you a notification. That background run uses your Claude usage. It cannot
  stage the whole tree, force-push, or edit your skills and identity files.

`cogby proactive status` shows the three switches together: routines, the automatic wrap-up and
the view page.

Nothing else leaves your machine.

## Tools and commands

Claude gets twelve tools: `init`, `context`, `place`, `search`, `log`, `remember`, `confirm`, `todo`, `note`,
`notify`, `view`, `card`. Their descriptions cost about 2,700 tokens in every session, and a test keeps it there.
A decision is written with `log`; the decision log and the routines are commands, not more tools.

The same operations, and a few setup ones, are a command in Claude's shell: `cogby help`. Useful
ones to ask for: `cogby sources add <folder>` (search a folder where it is, read-only; `digest` is what reads one into pages),
`cogby dream` (check for stale pages), `cogby map` (what the brain holds).

The Notion mirror, an extra for people who want to see their brain in Notion. It is off until you turn
it on, and the brain stays the one home: every mirrored page says it is a copy, and an edit made in
Notion is overwritten. Only a to-do ticked or added on the mirrored To-dos page comes back.

```
cogby mirror                            # on or off, where it lives, what an update would write
cogby mirror on --parent <notion page link>
cogby mirror push                       # update Notion through Notion's own command-line tool (ntn)
cogby mirror plan                       # what an update would write, without sending anything
cogby mirror off                        # nothing more is sent; what is in Notion stays
```

Mirrored: every project and area card, every page under people, organizations and threads, the open
to-dos and the decisions. Never mirrored: `resources/`, the archive, the day log, meeting records,
notes, notifications, routines and `.cogby/self/`. A card with `mirror: false` in its frontmatter
stays out, and what looks like a secret is blanked before it leaves. Nothing is ever deleted in
Notion. Without Notion's command-line tool, a session writes the pages through its own Notion
connection (`cogby mirror page <key>`, then `cogby mirror done <key> --id <notion page link>`). Which
Notion page is which is remembered on the machine that made the mirror (`.cogby/local.json`), so a
mirror is kept from one machine. Nothing here runs in the background: a session updates it, on
request or at its wrap-up (`cogby mirror push --if-on`, which does and says nothing while the mirror is off).
Until you turn it on, nothing mentions it: not the session start, not My view, not the onboarding, and the
skill is left out of the list Claude reads, so you start it yourself by typing `/cogby:notion-mirror`.

The map of the brain:

```
cogby map                               # every project, area, resource and archive entry, one line each
cogby map --json
```

The line of a project or an area is the first sentence under its card's title. The map is read from
the index when you ask for it: no file holds a copy of it. A brain made before this still has
`.cogby/context-index.md`, the map as a generated file. Nothing updates it any more. It stays where
it is, and the first session start puts a note at its top saying so and naming `cogby map`.

Places, the folders you work in:

```
cogby link ~/code/acme acme --role code --about "The service and its tests"   # a repo: named by its git remote
cogby link ~/Documents/contracts acme --role reference --name contracts --about "Signed SOW"   # no git: named, found by its path here
cogby link acme --role code          # the shortcut: the folder is the one you are in
cogby link --none ~/Downloads           # that folder is not a brain project (this machine only)
cogby link --undo ~/code/acme        # take back the link or the mark
cogby places                            # every place; cogby places acme for one page
```

`cogby link <folder> <card>` names both sides: the folder first, then the card. Before it writes
anything it prints them in one line, `Linking folder <folder> to card <card> as <role>`. With one
argument the card is what you named and the folder is the one you are in; `--none` and `--undo`
work the same way. The older `--repo PATH` still names the folder. When a chat opens in a folder
Cogby does not know, it offers to connect it, so onboarding asks nothing about folders.

A folder is a place of one project or area page, with a role: `code` (the main repo), `workspace`
(deliverables, working files), `environment` (a dev setup or sandbox), `reference` (contracts, docs:
read only) or `scratch` (experiments). The role, the one line and the name are on the page, in its
frontmatter (`places:`), and travel with the brain; the folder's path stays in `.cogby/local.json`.
A page with the older single `repo:` field reads as one `code` place, as it is. A session in a
`code`, `workspace` or `environment` place opens on its page, with the page's open to-dos; in a
`reference` or `scratch` place it gets two lines and the place's name. In a folder the brain does
not know, Claude asks once whether to save it (the first session in a git repository, the second
anywhere else, twice at most, never under `cogby proactive quiet`). A to-do or a note added from a
linked folder belongs to that folder's page.

The decision log:

```
cogby log projects/acme/card "Go live in January, not December: the audit comes first" \
  --decision --who accepted --expect "no rework after the audit" --review 2027-02-01 --source "call with Sara"
cogby decisions                         # every current decision, newest first
cogby decisions --project acme       # one project (or any page slug)
cogby decisions --since 2026-11-01 --who overrode
cogby decisions --due                   # review date reached, not reviewed yet
cogby decisions review 3fa2c1 reversed --source "retro 2027-02-03" --note "the audit slipped"
```

`--who` is `owner`, `accepted`, `overrode` or `agent` (a call an agent made alone, that you did not
see); a decision logged without it is listed as not recorded, and `--who none` lists those. Who made one can be said later, as a line of its own on the same
page and never by editing the decision: `cogby log <page> "who: accepted, decision of <date> #<id>" --source "…"`.
The weekly check-in asks once for each decision logged that week with nobody recorded.
`log:today` as the page is the day's log, for a decision about no page in particular.
`cogby decisions` reads the index as it is, like a search, and takes `--json`. Once a decision has
been reviewed, it ends with how each kind of call turned out ("Overrode Claude 4 times: 3 as
expected, 1 not."); `--json` carries the same cross as `counts.outcome_by_who`.

Meeting records. A debrief finds the transcript through the session's connectors and leaves it
where it lives; the brain keeps a pointer and a short summary. Each debriefed meeting is one file in
one flat folder, `resources/meetings/<date>-<name>.md`, because a meeting often touches several
pages at once (a project, an area, a person). Every page it touched gets one timeline line linking
to the record, and every line written from it cites the meeting's name, its date and the
transcript's link. The record is written once, never edited, never flagged stale, and holds no
current truth: what the meeting decided and established lives on its pages.

```
cogby meetings add --data record.json   # the record and the lines linking to it (title, date, with, pages, transcript, summary, line, written)
cogby meetings                          # every record, newest first
cogby meetings --page areas/people/sam --limit 3   # the ones that page links to or that link to it
```

What Claude wrote, and whether you confirmed it. Every line and fact ends with who wrote it; what an
agent writes is `unconfirmed` until you say it is right. An agent's line also names the agent when
Cogby knows it (`[yasser · agent claude-code · unconfirmed]`): from the tool server's connection, or
from the shell the command ran in (Claude Code's, or `COGBY_AGENT=<name>` for another agent).
A session is told how many unconfirmed lines there are and sees `(agent, unconfirmed)` after each one it reads; the wrap-up confirms what you ticked, and the
weekly check-in reports how many are left. A line Cogby writes for a command you ran or
approved (a folder linked, a routine added, paused or run, a project's status changed) ends in `record`: it claims nothing, so
it is never listed as unconfirmed and never shown as where you stopped.

```
cogby unconfirmed                       # what an agent wrote that you have not confirmed, newest first
cogby unconfirmed --project acme     # one project (--page <slug> for one page)
cogby confirm projects/acme/card 3f9a1c "#3"     # a line by its id, a fact by its row: only the tag changes
cogby retract projects/acme/card "#4" --reason "it was 12k"
```

A retracted line stays on its page, marked `retracted`, and is left out of the session context, the
decision log and the active facts. Confirming and retracting are yours: from Claude both are refused
unless it passes `--confirmed-by-owner`, which the skills do only for lines you said yes to. Inside a
Claude session a write is always an agent's and unconfirmed, whatever `--human` or `COGBY_ACTOR=human`
says. `cogby` run in your own terminal writes your line, confirmed.

To-dos, notes and notifications are files in the brain. Every change to one is a commit of that
file, made at once from whichever folder you are in, so they travel to your other machines with
your next push and wait for no wrap-up. A brain made before they did stops ignoring the note and notification stores
on its next run. Two machines that both change the same store between pulls get an ordinary git
conflict in that file, to resolve by hand.

Routines and proactivity:

```
cogby routines add "Weekly review" --run "check-in, weekly" --rhythm "weekly on friday at 16:00"   --why "nothing stays stale for more than a week"
cogby routines                          # each with its rhythm, last run, next due, overdue or not
cogby routines due                      # only what is due or overdue now
cogby routines ran weekly-review --source "check-in 2026-11-13" --result "2 stale pages named"
cogby routines edit weekly-review --scheduled "scheduled task: cogby-weekly-review" --source "the scheduler's confirmation"
cogby routines pause weekly-review --reason "on holiday until the 24th"
cogby routines resume weekly-review
cogby proactive quiet | suggest | act | status
```

A rhythm is `daily`, `weekdays`, `weekly on <day>` or `monthly on <1-31|last>`, each with an
optional `at HH:MM`. Due dates are worked out from the rhythm and the last run, in local time: a
weekly review done two days late is due again on its own day. `ran` also takes what a routine runs
in place of its name (`cogby routines ran "check-in, weekly" --if-any …`), which is how the
check-in, the wrap-up and the look-back record their own runs; `cogby dream` records its own. `cogby routines`
reads the index as it is and takes `--json`.

A brain made before projects had one card keeps working as it is. To bring an old project to the
new layout, ask Claude to fold its `progress.md` into its `card.md`.

## How the skills are built

Three layers: **Brain** (`onboarding`, `capture`, `wrap-up`, `my-view`, `routines`, `look-back`, and the extra `notion-mirror`),
**Work** (`meeting-prep`, `meeting-notes`, `digest`, `check-in`), **Output** (`plan-page`, `design`,
`clean-writing`), and two you ask for by name (`quiz-me`, `picture`): sixteen skills. Every
skill has one job, reads the brain first, writes only through the tools, hands off to another
skill instead of repeating it, and says what it is not for.

