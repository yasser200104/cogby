# Changelog

What changed in each version of the Cogby plugin, newest first.

## 0.3.11 (2026-11-22)

Onboarding, very simple: hello, let me get to know you, here's your brain. After the owner's review
and the first outside tester.

- Three steps, then You're set. **Hello:** Cogby says hello in the chat ("Hi, I'm Cogby. Let's work
  together: …", then how it files your work in four folders), and the screen stays minimal: "Meet
  Cogby", the four folders as small cards, the three steps. **Get to know you:** "Can I get to know
  your work?", calendar, email, files and your computer as cards with icons to untick (no to-dos:
  most people keep none in a connected tool), and Light (the default) or Deep (also email messages and what's inside files; it
  says plainly that this uses much more of your Claude allowance). **Check it:** your name and what
  you do, and what Cogby found, each row with a picker (Project, Ongoing, Done) and a bin; Done is
  filed in the Archive. **You're set:** My view first, "where you and I keep track of everything",
  then what to try, then "start a new chat, from anywhere".
- While Cogby looks through your work in the background, it asks a few questions in the chat: who
  you are, what matters most right now, what you want to understand yourself, and whether you want
  a morning check-in. The brain is created only after you check what it found.
- No more Quick choices and no Folders screen. Safe defaults, said in one line: Cogby asks before
  it sends, deletes or spends (pushing code too, when it finds code folders), answers first in plain
  words, keeps your brain in Cogby Brain in your home folder, saves it when you say "wrap up", keeps
  My view on, and runs no routine until you pick one. A folder is offered when a chat opens in it.
- The questions not reached wait in a new file, `.cogby/self/getting-to-know.md`, and a new chat is
  told the next one: at most one a chat, at a natural pause, each asked once and skippable.
- The screens take My view's light look in every theme: white cards on a white panel, a light grey
  band, Cogby's violet, and small corners.
- Cogby's default design, used for the other pages it makes, takes the same light look: white
  pages and cards, a light grey band, Cogby's violet, and small corners (4 to 8 px).

## 0.3.10 (2026-11-19)

My view, the way the owner worked in the old Console.

- Notion's white: page and cards white, bands and pressed states a light neutral grey, in place
  of the beige. Text and buttons stay Cogby's violet.
- Squarer: smaller corner rounding on cards, buttons, tags and meeting blocks (4 / 6 / 8 / 6 px).
  Dots and ticks stay round.
- Today: what waits on you first, then the Console Home's "Today's tasks": overdue and today,
  done today, and Add a task for today. The day's calendar stays on the right.
- Tasks & notes: the left side is the Console's tasks view: All / Mine / Cogby's, a New task
  window for a to-do or a note, To do / Planned by project / Done today, and a click on a date
  changes it. Notes stay on the right, and a new note can carry details.
- Projects: the Console's list, with search and status filters ("Anything not done" first), one
  row per project with its status, open to-dos and when it last moved, and sub-projects under
  their parent. A project's page has the Console's header and Tasks, Sub-projects, Documents
  (the files in its folder) and Project context tabs.

## 0.3.9 (2026-11-18)

Onboarding, rebuilt after the owner ran it live and found it too technical: fun, plain, not scary.

- Skills a person sees or types have plain names: setup is now **onboarding**
  (`/cogby:onboarding`), command-center is **my-view**, quiz is **quiz-me**, meeting-debrief is
  **meeting-notes** and html-plan is **plan-page**. The old words still start them: "set me up",
  "command center", "debrief the meeting", "quiz me", "html plan".
- The brain page is called **My view**, your brain on one page, in the onboarding and the skill.
- A welcome first: "Meet Cogby. It remembers, you decide.", four cards on what it does, the five
  steps, and the four places with "Cogby does the filing". Then five steps: Quick choices, What you
  have, About you, Check it, You're set.
- Every screen is fixed: one file beside the skill holds each screen in Cogby's colours (the design
  system's own, light and dark) with its mark and a five-step bar, readable deep violet text at 14
  to 16 px. Claude copies a screen into its own inline visual and fills in only the person's names;
  a plain-text twin stands in where a chat cannot show visuals. A click sends an ordinary reply.
- Quick choices asks only what applies to everyone. Where the brain lives and what a due routine
  does are defaults, said in one line. "Push or deploy code" is offered only when Cogby finds code
  folders.
- No more "do you keep notes somewhere?". Cogby offers to map your work itself, from what you tick:
  calendar titles and dates, email recipients and subjects, file names, the folders of past Claude
  Code chats, your to-dos where they live. You fix the map by clicking (drop, rename, move, add)
  and pick your top three priorities, in place of "What are you trying to accomplish?".
- Check it: one profile card, the question of what you want to understand yourself with examples
  from your own map (the answers go on the list of what you care about understanding yourself),
  and one line of counts.
- You're set: folders are connected on one screen after a yes, never one question per project; the
  routines you picked are scheduled for real and called "on" only once the scheduler confirms; the
  ending says what's ready, what to try first, links your brain page, and asks you to start a new
  chat, from anywhere. No paths, no terminal command. You never type a command anywhere.
- One screen per reply, never the whole run as one long page. Each command Claude runs carries a
  plain description of what it does for you.
- To-dos found in your own task tool are read there and never copied: until the two lists sync on
  their own, your tool is the list to trust, and the screens say so.
- Right after onboarding, building the brain page and the first thing you try (a meeting prep,
  "what needs me today?") stay just as plain: one line on what's happening, then the result.

My view, simpler, after the owner's review of the page: less to read, and a way to fix a line.

- Projects is a plain list of names, A to Z, in columns. A small count shows only when something
  in a project waits for you. Folder-style names read as words ("Hiring autumn 2026").
- No confirmed or unconfirmed marks anywhere on the page. Point at a timeline line and a Fix button
  appears: what you type is sent to the next session, which records it as your correction and
  offers to retract the line when you say it is wrong.
- Today shows your day hour by hour: each meeting a block at its time, meetings at the same time
  side by side, finished ones faded, all-day events on top. A meeting opens a card with the time,
  who is in it, Join, Prepare me and a box for your notes. Meetings carry their start and end.
- A to-do opens a panel: change its words, due date, project and details, mark it done or open it
  again, or remove it. To-dos keep details (`cogby todo add/edit --body "…"`, `none` clears them),
  and the page sends a seventh kind of change, a to-do edit.
- Less text: no intro sentences or section subtitles, long items cut to two lines (tap to see the
  rest), the suggested answer a small mark on its button, and "Not applied yet" now reads "sent".

## 0.3.8 (2026-11-18)

The command center, after the owner's review of the page: less on it, and one list of what waits.

- No Send bar. On the published page, a choice you press (Later, Clear, an answer, Prepare me) is
  sent at once, and a comment is sent when you press its Save. Cogby's suggested answer is shown,
  never sent for you. On a page opened from disk, a small "Copy my answers" button sits at the top
  while something is unsent.
- No footer, and no "days old" banner: the "As of" time at the top is the page's age.
- The Cogby mark sits on the page without its dark tile.
- Today: "Needs you" also lists the routines that are due and, when there are any, how many lines
  Cogby wrote that wait for your confirmation. "Moving this week" is gone, and so is the meetings
  box when no calendar was read. One "Tasks & notes" block takes the place of "Due" and "Capture".
- To-dos and notes are one tab, "Tasks & notes": to-dos on the left with an add field at the top of
  the list, notes on the right grouped by day. "Promised to others" shows only when there is one.
- A project's name and card open a basic view of the project inside the page. A project's own
  dashboard, when it has one, is a second link. A card shows Next beside Now.
- Brain: "Your folders" and "Gone quiet" are gone. Sources lists your own folders first, a missing
  one marked, and the brain and its day log last as built in. "Last lines written" is grouped by
  day, says where each line came from, and marks what Cogby wrote that you have not confirmed. A
  project's timeline marks it too.
- "Copy resume line" is gone.

## 0.3.7 (2026-11-18)

Cogby is your context manager first, and it now keeps a file of what you want to understand
yourself.

- A new brain holds `.cogby/self/information-border.md`, with two lists: "What I care about
  understanding myself" and "Hand over". Cogby reads it before it makes something that will be
  used, sent or shipped. On a listed topic it asks your view before it recommends. On a
  handed-over topic it decides and says what it chose in one line. It adds a line only on your
  answer. A brain made before this version has no such file yet, and the session start says so.
- The session start names that file and says the rule, also in a linked project folder. Under
  `cogby proactive quiet` it names the file only.
- A decision has a fourth value for who made the call: `agent`, a call an agent made alone that
  you did not see. `cogby log … --decision --who agent` writes one, `cogby decisions --who agent`
  lists them, and the count line of `cogby decisions` now reads "… N by an agent alone, N not
  recorded".
- An agent's line says which agent wrote it, when Cogby knows:
  `[yasser · agent claude-code · unconfirmed]`. The name comes from the tool server's connection,
  from Claude Code's shell, or from `COGBY_AGENT=<name>` set in another agent's shell. It is never
  something the agent passes. Older lines read as before. The index is rebuilt once to hold the
  name.
- The rules ask for an expected outcome and a review date on every decision, and for a decision
  whose review is due to be raised once in the conversation.
- The weekly check-in no longer goes through unconfirmed lines one by one. You say when a line is
  wrong, and Cogby asks for a yes only on a decision and on a change to that file.
- `USER.md` has a "Working with AI" line, and its size note is 2 KB.
- New words in setup's opening, the README and the starter `SOUL.md`: Cogby keeps what you know
  and what you are working on, and you make the calls.

## 0.3.6 (2026-11-16)

One fix, found in real use: a dismissed notification could come back.

- `cogby notify later` refuses a notification that was dismissed. A "later" sent from the command
  center before you cleared the notification, and applied after, used to put it back on your list.
- The command center marks each send, and each change to your to-dos and notes, read before it
  applies it, not after. A send that was applied but never marked read used to be applied again by
  the next session. If two sessions reach the same send, the second one skips it.

## 0.3.5 (2026-11-16)

Fewer cards, and a setup that works in the chat where you have just installed Cogby.

- Setup needs none of Cogby's tools. In the chat where the plugin was just installed, its tool
  server is not running, and setup used to open by calling two of its tools. Now every step is a
  command run by the plugin's full path, Claude's own question tool, or plain words. The questions
  and the opening words are written in the setup skill itself.
- Setup's review is a numbered list in the chat. You reply "create", or the numbers to drop.
- Five cards are gone: `setup`, `setup-review`, `check-in`, `meeting-brief` and
  `wrap-up-summary`. The check-in and the meeting brief are text in the chat. A session wrap ends
  with a short text report and one signed line, such as "Cogby · 3 lines saved to acme". Asking
  for a removed card is refused with a line that says what took its place.
- Five cards stay, and look as they did: `wrap-up-review`, `debrief-review`, `digest-review`,
  `quiz` and `picture`. Each skill that shows one now gives the card's data in full, as an example,
  so Claude does not have to look it up.
- The tool server names itself "Cogby", and each tool has a short title ("Show a card", "Search the
  brain") for apps that show one. The `card` tool lists only the five cards there are.

## 0.3.4 (2026-11-16)

Meeting debriefs that find the transcript themselves, and fixes from the first setups and the
first days of use. One change touches your pages: fact tables gain a column, described first.

- **The page format changes: fact tables gain a `recorded` column.** It sits between `valid_until`
  and `source`, and holds the day `remember` wrote the fact; Cogby sets it, never the caller. A
  page counts as having new evidence from that day, so a fact remembered today about something
  true since last year no longer leaves its page flagged as stale. Nothing is migrated: an old
  table reads as before and gains the column the next time a fact is written to it, its old rows
  left with no recorded day, and for those rows `valid_from` counts as before. The search index
  (schema 5 to 6) is rebuilt once from your pages the next time Cogby opens the brain, with nothing
  for you to do. An older version still reads a page written by 0.3.4, but drops the `recorded`
  column when it writes a fact to that page: if more than one machine shares the brain, update
  them all.
- **A meeting debrief finds the transcript and keeps a record of the meeting.** `meeting-debrief`
  looks for the transcript itself through the connectors the session has: the calendar event's
  Meet attachments read with Drive, Granola or another meeting-notes tool, a Drive search by title
  and date, and only then asks you for a link, a file or a paste. The transcript stays where it
  lives. Each debriefed meeting gets one record, `resources/meetings/<date>-<name>.md`: the link to
  the transcript, a summary of at most 15 lines, and what the debrief wrote where. Every page the
  meeting touched gets one timeline line linking to the record, and every line written from it
  cites the meeting's name, date and transcript link. A record is written once (the same meeting
  again writes nothing) and is never flagged stale; the session start and the view show the lines
  on the pages it touched, not the record's own. A link to a project or area that has since moved
  to `archive/` still finds it. `cogby meetings` lists the records, newest first;
  `cogby meetings --page <slug>` lists the ones linked to or from that page, and `meeting-prep`
  reads the newest of those before a meeting. The work templates no longer name a Meetings view
  that does not exist.
- **`cogby wrapup review` no longer pushes in a plugin brain.** It commits locally and leaves one
  notification naming the commit, the branch and the files, as the README says. This was
  the known issue of 0.3.2 and 0.3.3. `cogby wrapup auto`, and every brain that is not a plugin
  brain, are unchanged.
- **Setup is easier to follow.** It asks its closed questions with Claude's own question dialog
  where the host has one, and sends a card only where it does not. It says "Step N of 5" at each
  step and tells you to type your answers if a card does not appear.
- **Cards are smaller and follow your theme.** Each carries only the styles it uses (setup's card
  went from 18 KB to 8 KB, the others from about 10 KB to 3 or 4 KB), takes its colours from the
  host's light or dark theme, and shows a selected answer as a solid fill with a check.
- **An old `cogby` on your PATH is named.** When a `cogby` command installed before the plugin
  (such as the old `@cogby/cli` npm package) would run instead of the plugin's, the session start
  says so and gives the exact `npm uninstall -g` command that removes it. `cogby --version` prints
  the version.
- **`digest` reads PDFs by page and reads scans.** Each item from a PDF cites its page; a long PDF
  is read in ranges of at most 20 pages, and the summary says which pages were read and which were
  not. A scan or an image is read, and each item from it is marked "read from a scan" so you check
  it. A text version is asked for only when a source cannot be read at all.
- A new brain's `.gitignore` no longer names a `cogby setup` command that does not exist. An
  existing brain's `.gitignore` is never rewritten, so it keeps the old wording.


## 0.3.3 (2026-11-15)

Changes the owner asked for after reading how 0.3.2 works: linking, the day's log and the map.

- Linking a folder names both sides. `cogby link <folder> <card>` takes the folder first, then the
  card, and prints `Linking folder <folder> to card <card> as <role>` before it writes anything.
  `cogby link <card>` still means the folder you are in, and `--repo PATH` still works. `--none`
  and `--undo` take a folder the same way.
- Setup links your folders. For each project you keep in the review, it asks once whether the
  project has a folder or a repository on this machine, and links it on your yes.
- The day's log can be read by card. Each entry says which card it is about, on a line like
  `Card: projects/acme/card`: the place's page in a linked folder, and in the brain the project
  or area the turn wrote to. When no card can be known the line is left out. An entry keeps the
  ask up to 1,000 characters and the answer up to 4,000, where it kept 200 and 1,200.
  `cogby search acme --source log` lists everything said about that card, newest first. A plain
  search still never shows the log.
- `cogby map` prints the map of the brain: every project, area, resource and archive entry with
  its one line, read from the index. `.cogby/context-index.md` is no longer generated, and a new
  brain has none. A brain that already has the file keeps it: nothing updates it, and the first
  session start puts a note at its top saying so. `AGENTS.md`, `capture` and `html-plan` point at
  the command. `core/ops/reindex.cjs` is gone.

Known issue, unchanged from 0.3.2 and fixed in 0.3.4: in a plugin brain `cogby wrapup review`
pushed like `auto` when the brain had a remote.

## 0.3.2 (2026-11-15)

No new feature. The gaps the 0.3.1 verification found between the plugin and a dependable first
week of real use are closed.

- A brain's rules follow the plugin. When a session starts and the brain's `AGENTS.md` came from an
  older version, it is replaced with the current one, committed on its own, and the session says
  so in one line. A copy you edited by hand is left alone and you are told once. Your own rules go
  in the brain's `.claude/CLAUDE.md`, which is never touched.
- Bookkeeping no longer counts as unconfirmed. Linking a folder, and adding, pausing, resuming or
  recording the run of a routine, write a line that ends in `record`. It is not listed by
  `cogby unconfirmed`, not counted, and not shown as where you stopped. Lines of this kind written
  by earlier versions are read the same way, with nothing to migrate. What Claude claims with
  `log` and `remember` is unconfirmed exactly as before.
- Work done outside the brain reaches git without a wrap-up. Every to-do, note and notification is
  committed as it is written, from any folder. The day's log is committed when a session ends, in
  the brain and in a linked code, workspace or environment folder. Nothing is pushed for you.
- The day's log keeps fewer secrets. Besides known token shapes, a value named as a password,
  secret, token, API key or authorization is replaced and its name kept, and so is the password
  in a connection string. `max_tokens: 4096` and ordinary sentences about passwords are left alone.
  A secret said in plain words with no name beside it is still not caught.
- No page Cogby builds loads anything from the network: the cards and the command center no longer
  ask Google for their fonts.
- The weekly check-in asks once who made each decision logged that week without it, and records
  your answer as a line of its own on the decision's page. The decision is never edited.
- `cogby decisions --who none` counts the decisions it lists, not the whole scope.
- The session-end hook no longer names a `cogby setup` command that does not exist.

## 0.3.1 (2026-11-14)

A release that adds nothing. Everything in 0.3.0 was run by hand in a throwaway brain and as an
installed plugin, and what was small and wrong was fixed.

- When the to-do or note store cannot be read, the hint now gives a git command that runs as
  written: `git log -- .cogby/todos/store.json`. The space after the dashes was missing.
- A brain with one page says "1 page", and one project "1 project", where a session starts and in
  `cogby view`.
- `cogby help` lines up the `dream` line with the others.
- The README says that Cogby is local-first and for Claude Code only today, that a Notion-backed
  option is being evaluated and is not in this release, and what a new brain's own
  `.claude/settings.json` sets. It lists all fourteen skills.
- `STRONG-POINTS.md` no longer calls the decision log's cross of who made a call with how it turned
  out "in progress": it shipped in 0.3.0.

## 0.3.0 (2026-11-13)

Everything since 0.2.0.

**Evidence you can trust**

- Five write-path bugs fixed. A similar fact is named and left alone, and replaces an older one
  only with `--replaces`. A dash in a source no longer hides the decision behind it. A to-do, note
  or notification store that cannot be read refuses writes and is left untouched. A routine's run
  is recorded by what the routine runs, never by a name that starts the same. A write that cannot
  be indexed is put back.
- Every line and fact says who wrote it and whether you confirmed it. `cogby unconfirmed` lists
  what an agent wrote, `cogby confirm` says a line is right, `cogby retract` says it is wrong and
  keeps it on the page. From Claude both are refused unless you said yes to those lines.
- Inside a Claude session a write is always an agent's and unconfirmed, whatever `--human` says.

**The decision log**

- A decision is a dated line on the page it is about, with its reason and who made the call: you
  alone, you taking Claude's suggestion, or you overriding it. `cogby decisions` lists them across
  the brain, and `cogby decisions review` records how one turned out as a new line.
- Once decisions have been reviewed, the list says how each kind of call turned out.
- A verdict you give on an `html-plan` page is offered as a decision, never saved on a guess.

**One brain across your folders**

- Places: `cogby link` makes the folder you work in a place of one project or area page, with a
  role (code, workspace, environment, reference, scratch). `cogby link --none` records that a
  folder is not a brain project. `cogby places` lists them.
- A session opens by what the folder is: on its page in a code, workspace or environment place,
  with two lines elsewhere. In a folder the brain does not know, Claude asks once whether to save
  it, twice at most, and never under `cogby proactive quiet`.
- The day's log is also written from a code, workspace or environment place, naming the place and
  its page, and from nowhere else.
- To-dos, notes and notifications are committed with the brain, so they travel to your other
  machines.

**Routines**

- What you do on a rhythm with Claude is one page each under `areas/routines/`, with a dated line
  for every run. `cogby routines` adds, edits, pauses and lists them and says what is due.
- `cogby proactive quiet | suggest | act` sets how far Claude goes on its own. Which routines may
  run unasked is a list in the code, not something a page can claim.

**Pages, skills and cards**

- A project is one `card.md`: what it is, what is in flight now and what is next on top, what was
  done and decided below. A brain made before this keeps working as it is.
- New skills: `digest` reads one document or folder into sourced evidence, `routines` keeps and
  schedules your routines, `quiz` asks you about your own brain, and `picture` draws one idea.
- Cards in the chat: setup, the check-in, the meeting brief, the debrief, digest and wrap-up
  reviews, the quiz and the picture, all from one kit that fills fixed markup from data.
- The command center shows your own folders, has a tab for notes, lets you add and remove to-dos
  and notes, and publishes no local path. A project can have a dashboard page of its own.
- A search answers from the index as it is. A short background sync keeps the index up to date.
- `STRONG-POINTS.md`: the nine things that make Cogby special, each checked against the code.

## 0.2.0 (2026-11-11)

The first version of the plugin as its own repository: one session-start hook, nine brain tools,
and skills in three layers.
