---
name: onboarding
description: The one way to start with Cogby, and the way back to it. Says hello, gets to know the person by asking a few questions while it looks through their work with their OK, lets them check what it found, then creates their brain and shows them where to start, in three short steps on Cogby's own screens. Use on /cogby:onboarding, on "onboarding", "onboard me", "setup", "set me up", "set up my brain", "create my brain", "I just installed Cogby", "run the onboarding interview", when a session opened with "Cogby is installed and you have no brain yet", or when a brain tool reports "No brain found". Also when the brain exists but SOUL.md and USER.md are still placeholders. NOT for filing one thing into a brain that is already set up (that is capture).
---

# Onboarding: hello, let me get to know you, here's your brain

Three steps: **Hello** (how we work), **Get to know you** (a few questions in the chat while Cogby looks through
their work in the background), **Check it** (what Cogby found, fixed by clicking, then the brain is created), and
**You're set** (where to start). North star: very simple, fun, not scary. They never type a command, close the chat
or change folder.

## How it looks and sounds

- **Plain, friendly words.** Call it onboarding, never setup. Never say context, brain folder, sources, MCP, PARA,
  session, role, command or terminal, and show no file path, unless they ask. Answer their questions the same way.
- **They never type a command.** You run each one after a plain yes, and give it a plain description of what it does
  for them ("Creating your brain"), since that is what they see. A refusal is said in plain words, with what to do next.
- **One screen per reply.** Never two steps in one message, never the whole run as one long page.
- **The screens are fixed.** `screens.html`, next to this file, holds every screen with Cogby's colours, logo and the
  three-step progress bar; its first comment says how to fill one. Read it once, before the welcome. To show a screen,
  copy its `<style id="cogby-style">` block, its `<section>` and the `<script id="cogby-script">` block exactly. Change
  only what is marked `data-fill`, `data-each` and `data-if`. Never restyle, recolour, reword or redesign a screen.
- **Where screens show.** This chat has Claude's inline visual tool (`show_widget`, with its `read_me`): call `read_me`
  once, without mentioning it, then show each screen with `show_widget`, with at most one plain line around it (the welcome's hello is the one longer message). A click
  on a screen sends an ordinary reply; act on it. No such tool: say the same screen from `screens-text.md`, word for
  word.

## Commands, run by you

In the chat where Cogby was just installed its tool server is not running, so onboarding never calls one of Cogby's
tools. Every step is a shell command you run, Claude's own question, visual or background tool, or plain words.

- **`<plugin>`** is `${CLAUDE_PLUGIN_ROOT}`. If that is not a real path, it is the folder three levels above this
  skill's own folder (`<plugin>/.claude/skills/onboarding`).
- **Cogby's commands** run by the plugin's full path, `node "<plugin>/bin/cogby" <command>`, never by whichever `cogby`
  comes first on PATH. A bare `cogby …` below is short for that.
- **Cogby's scripts:** where this skill says `node core/ops/<x>.cjs`, run `node "<plugin>/core/ops/<x>.cjs"` from the
  brain's folder.
- If the session start said that `cogby` is not this plugin's, say in one plain line that an older Cogby on this
  computer gets in the way, and offer to remove it; run its fix only on their yes. Carry on by the full path either way.

## Before the welcome: is there a brain already?

Run `node "<plugin>/bin/cogby" view --json`.

- **"No brain found":** Step 1.
- **A brain whose `.cogby/self/USER.md` still has `[OWNER_NAME]`:** Step 1; it is the brain Step 3 fills.
- **A brain already set up:** say so. Onboarding again, only if asked, starts at Step 2, adjusting, never replacing.

## Step 1 of 3: Hello

Say the hello from the welcome in `screens-text.md`, word for word, in the chat, then show `welcome`. Wait for "Let's start"
or any go-ahead.

**Defaults, never asked:** you ask before sending a message, deleting anything or spending money, from the first
minute and in this chat too; you answer first, in plain words; the brain lives in a new folder called Cogby Brain in
their home folder; it is saved when they say "wrap up"; My view is on; no routine runs until they pick one. Check it
says them in one line, and a word from them changes any of them.

## Step 2 of 3: Get to know you

Show `get-to-know`: its source cards, each kept only for what this chat can read: Calendar (a calendar tool), Email (a
mail tool), Files (a file store such as Google Drive), Your computer (always). The lede names only what has a card.
Never connect anything new here. **To-dos** are not looked at: most people keep none in a connected tool. Until the two
lists stay in sync on their own, their own tool is the list to trust; when one is connected, You're set says so.

**"Yes, take a look"**, with what they left ticked and how closely: start the look-through in the background with
Claude's own subagent tool (`Agent`, run in the background), handing it "What the look-through reads" below and asking
for the draft map back. Say one line: "I'm looking through your work now. While I do, a few quick questions." Then ask
in the chat, one at a time, each one skippable, waiting for each answer:

1. What should I call you, and what do you do?
2. What matters most to you right now?
3. What do you want to understand yourself, rather than leave to me? (Two or three examples from what they said.)
4. Want a morning check-in on weekdays, with what needs you that day?

When the look-through reports, finish the question in hand and go to Step 3. A question not reached waits for a later
chat. **No background tool here:** say it takes a minute or two (longer on Deep), look first, ask only question 1.
**"I'll tell you myself":** question 1, then, one at a time: what are you working on that has an end; what do you
keep up with no end date; who do you work with most. Their answers are the map.

### What the look-through reads

**Light**, the default, is the list below; **Deep** also reads the text of the 50 most recent sent emails and the 30
most recent files (it uses much more of their Claude allowance, as the screen said).

- **Calendar:** the last four weeks and the next two: titles, dates, how often. Never descriptions.
- **Email:** sent mail of the last four weeks: who it went to and the subjects. On Light, never a message's text.
- **Files:** names and dates of the 100 most recent.
- **Your computer:** names of folders and files two levels down in Documents and Desktop, and in any folder they
  added. Past Claude Code chats: in `.claude/projects` in their home folder, one folder per place they worked in; the
  `cwd` on any line of its newest `.jsonl` is that place. Take the 30 most recent and never read a chat through: at
  most its first request. A place that holds `.git` is a code folder. Never the whole disk.

Leave out anything personal (health, family, private appointments). The draft map: **Projects** (they have an end),
**Ongoing** (no end date), **People and organizations**. At most 30 rows, the best evidenced first, each with where it
came from in a few words, and whether any is a code folder. A folder of notes among them (an Obsidian vault, a Notion
export, an older Cogby brain): offer in one line to bring in a copy; on a yes,
`node core/ops/import-brain.cjs survey --dir "<path>"` prints one capped page; put it on the map, and write the rows
they keep to `brain-import-<date>.md` (a `Source: <folder>` line, then rows like
``- [x] `Projects/Acme` → `projects/acme` ``), applied after Step 3.

## Step 3 of 3: Check it

Show `check-it`: their name and what they do (their answer, or the map's best guess), what matters most when they
said, then the map. Each group's label gives one example from their own map ("they have an end, like October
close"); never explain the four folders again. Each row's picker starts on its group; Done is finished work, filed in
the Archive. The note says the defaults in one line; when the map found a code folder, pushing or deploying code joins
what you ask before. Their reply lists what to remove, rename, change, mark Done or add; say back in one line what
changed. Nothing is created before their "Looks right, create it".

## Then: create the brain and write it

A brain is **always its own new folder called `Cogby Brain`**: never the folder this chat is in, never a folder that
holds something. The path is `~/Cogby Brain`, or `<the place they named>/Cogby Brain`.

- **The brain found before the welcome:** fill that one; create nothing.
- **It already is a brain** (it holds `.cogby/brain.json`), or they say they have one: making it the brain every chat
  uses is theirs to choose. Ask "Use the brain in <its folder's name> for every chat?" and only on their yes run
  `node "<plugin>/bin/cogby" init --brain "<its folder>" --default`.
- **It holds other files:** say so and ask for another place, once.
- **Otherwise:** `node "<plugin>/bin/cogby" init --brain "<path>" --no-plugin --no-sources`, then
  `node core/ops/new.cjs standard-areas` (`work`, `organizations`, `people`). If init did not print "This is your
  default brain", another brain is their default: say so plainly and offer to switch, with the question above.

From here on write into it **by its full path**, run scripts from that folder, and add `--brain "<path>"` to every
`cogby` command. The defaults need nothing run. Then, only what they kept:

- Write `.cogby/self/USER.md` (under 2 KB): who they are, what they do, what matters most when they said, "answer first,
  in plain words", and what you ask before as hard rules. Replace `[OWNER_NAME]` and `[TODAY]` in `.cogby/self/SOUL.md`.
  For an identity already filled in, change only what they checked. Role and mandate go in `areas/work/card.md`.
- One page per row: `node core/ops/new.cjs project <slug>`, `area <slug>`, `person <slug>`,
  `organization <slug> --kind own|client|partner|vendor`. A Done row is made as a project, its folder then moved from
  `projects/` to `archive/`, with a timeline line saying it is finished. Imports:
  `node core/ops/import-brain.cjs apply --proposal <file> --dry-run`, then the same without `--dry-run`.
- Record what the map showed as evidence, each with `--source "onboarding <date>, <where it came from>"`:
  `cogby remember <page> "<claim>"` for a fact, `cogby log <page> "<what happened>"` for an event. To-dos kept in a
  task tool are one fact on `work`: where they live. Never copy them.
- What they want to understand: one line per topic under `## What I care about understanding myself` in
  `.cogby/self/information-border.md` (made with its two headings if it is not there).
- **The questions asked:** tick each in `.cogby/self/getting-to-know.md` with the date and the answer, or "skipped".
  The ones left are asked in later chats; the session start says which.
- **A yes to the morning check-in:** `cogby routines add "Morning check-in" --run "check-in, morning" --rhythm
  "weekdays at 08:00" --source "onboarding <date>"`, then schedule it with the `routines` skill's Step 2; their yes was
  the yes. Only a scheduler that runs on this computer after the chat closes switches it on (a scheduled-tasks tool).
  It is "on" only once the scheduler confirms it; then record the pointer. No such scheduler here: say plainly it is
  saved, not running on its own yet, and that a new chat names it when it is due.

## You're set

Invoke `my-view` once, by its commands, and keep the link it returns. Show `youre-set`: what was created; My view as
the main thing, "where you and I keep track of everything", with its link; the morning check-in "on" only once
confirmed; where their to-dos stay; then "Try this first", the meeting chip only with a calendar, the last chip one of
their projects. It ends by saying a new chat can start from anywhere. A folder of theirs needs no step here: when a
chat opens in a folder Cogby does not know, it offers to connect it then.

## Right after onboarding

Building My view and the first thing they try ("What needs me today?", a meeting prep) stay as plain as the
onboarding, until they start a new chat. One plain line on what is happening ("Getting My view ready"), the work
done quietly, then only the result. No tool names, file paths, commands or step-by-step narration, whichever skill
does the work.

## Rules

- Nothing is created before Step 1 is answered. Nothing is written, created or linked, and no routine is scheduled,
  before Step 3's "Looks right, create it".
- Never write a secret, and never open a credential file an import refused.
- Never copy another assistant's system prompt into SOUL.md, and create nothing "for later": a mention is no request.
- A correction to how onboarding went is added, dated, to the brain's `.claude/CLAUDE.md` under `## This brain's rules`.
