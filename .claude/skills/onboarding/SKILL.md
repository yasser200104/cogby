---
name: onboarding
description: The one way to start with Cogby, and the way back to it. Says hello, gets to know the person by asking a few questions while it looks through their work with their OK, lets them check what it found, then creates their brain and shows them where to start, in two short steps in the chat, with one screen to check what it found. Use on /cogby:onboarding, on "onboarding", "onboard me", "setup", "set me up", "set up my brain", "create my brain", "I just installed Cogby", "run the onboarding interview", when a session opened with "Cogby is installed and you have no brain yet", or when a brain tool reports "No brain found". Also when the brain exists but SOUL.md and USER.md are still placeholders. NOT for filing one thing into a brain that is already set up (that is capture).
---

# Onboarding: hello, let me get to know you, here's your brain

A **Hello**, then two steps: **Get to know you** (questions in the chat while Cogby looks through their work) and
**Check it** (what Cogby found, fixed by clicking; then the brain is created), then **You're set**. The hello is not
a step. North star: very simple, fun, not scary. They never type a command, close the chat or change folder.

## How it looks and sounds

- **The steps they see.** The chat lists your steps from your very first action, before you read anything else. Give
  it these six, all from the start, as written, in their language, and no others: "Introducing Cogby", "Understanding
  how you work", "Interviewing you", "Confirming what I found with you", "Creating your brain", "Taking it for a first
  spin". What you do for yourself (reading these files, checking for a brain, finding tools) never gets a line.
- **Plain, friendly words.** Call it onboarding, never setup. Never say context, brain folder, sources, MCP, PARA,
  session, role, command or terminal, and show no file path, unless they ask. Answer their questions the same way.
  PARA is named once, in the credit line of `youre-set`; "second brain" once, in the hello. Neither anywhere else.
- **Their language.** Follow the language they write in; ask ("English, or another language?") only when it is
  unclear. Nothing written yet (a bare command): start in English, and switch the moment they answer in another.
  Every step is said in it, the bold words they reply with too, and so is Check it. English is said as written.
- **They never type a command.** You run each one after a plain yes, and give it a plain description of what it does
  for them ("Creating your brain"), since that is what they see. A refusal is said in plain words, with what to do next.
- **One step per reply.** Never two steps in one message, never the whole run as one long page.
- **Plain chat, and one screen.** Hello, Get to know you and You're set are said in the chat, from `screens-text.md`
  next to this file: the same meaning, in the same order, in their language, each under its one progress line ("Step 1
  of 2 · Get to know you"). No visual: one takes about a minute to appear.
- **Check it is the one screen.** `screens.html` is it; its first comment says how to fill it. Read it when Check it
  starts, not before. Copy its `<style id="cogby-style">` block, its `<section>` and the `<script id="cogby-script">`
  block exactly. Change only what is marked `data-fill` and `data-if`, and the list under `data-map`: one short line
  per item, `name | where it came from | kind`, the kind one of Project, Ongoing, Done or Person. Never write a row's
  markup: the screen draws its rows from that list, so it appears quickly. Never restyle, recolour or redesign it.
  Another language: its words, in theirs; a right-to-left one (Arabic, Hebrew) sets `dir="rtl"`.
- **Where the screen shows.** This chat has Claude's inline visual tool (`show_widget`, with its `read_me`): call
  `read_me` once, without mentioning it, then show the screen with `show_widget` and say `check-it-reply` under it,
  every time. A click, or the same words typed, is a reply: act on it. No such tool: say `check-it` from `screens-text.md`.

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

- **"No brain found":** Hello.
- **A brain whose `.cogby/self/USER.md` still has `[OWNER_NAME]`:** Hello; it is the brain Check it fills.
- **A brain already set up:** say so. Onboarding again, only if asked, starts at Get to know you, adjusting, never replacing.

## Hello

Say `welcome` from `screens-text.md`, in the chat. Wait for "let's start" or any go-ahead.

**Defaults, never asked:** you ask before sending a message, deleting anything or spending money, from the first
minute and in this chat too; you answer first, in plain words; the brain lives in a new folder called Cogby Brain in
their home folder; it is saved when they say "wrap up"; My view is on; no routine runs until they pick one. Check it
says them in one line, and a word from them changes any of them.

## Step 1 of 2: Get to know you

**First, find what this chat can read, properly:** a calendar tool, a mail tool, a file store such as Google Drive.
A connected one may be listed without being loaded: when this chat has a way to search its tools, search for
calendar, mail and drive before deciding one is missing. Your computer is always there. Look the same way for their
to-do tool and their meeting tool: these are found, never asked in the interview.

**One of the three is missing:** say `connect-first`, naming only what is missing, and wait. You never connect
anything yourself: they do, or they skip. Where to connect: when this chat has a tool that suggests connectors, use
it for the one they named, so they get a button; otherwise tell them to open Claude's settings and choose
Connectors. On "done", look again the same way. Still not there: say in one line that it may only show up in a new
chat, and carry on with what there is. On "skip", carry on; You're set says what they can still connect.

Then say `get-to-know`, its list kept only to what this chat can read. **"Yes, take a look"**, with anything they said
to leave out and how closely: start the look-through in the background with Claude's own subagent tool (`Agent`, run
in the background), handing it "What the look-through reads" below and asking for the draft map back. Say `looking`.
Then ask the `questions` of `screens-text.md` in the chat, in their order, one at a time, waiting for each answer.

**Their to-do tool and their meeting tool** are found, never asked. One found: say so in one line ("Notion is
connected, so your to-dos can stay there"); a word from them changes it. Several: ask which, in one line. None: say
nothing, and it waits as a question for a later chat. They name one that is not connected: say `connect-later`, once.
**The look-through reports before question 4:** finish the question in hand, say `look-done`, ask question 4, then
Check it. Question 2 or 3 not reached waits for a later chat. People they named join the map. **Questions
done, still looking:** say `still-looking`, once. **No background tool here:** say it takes a minute or two (longer on
Deep), look first, ask only questions 1 and 4. **"I'll tell you myself":** question 1, then, one at a time: what are you
working on that has an end; what do you keep up with no end date; who do you work with most; then question 4. Their
answers are the map.

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
``- [x] `Projects/Acme` → `projects/acme` ``), applied after Check it.

## Step 2 of 2: Check it

Show `check-it`: their name and what they do (their answer, or the map's best guess), what matters most when they
said, then the map. Each group's label gives one example from their own map ("they have an end, like October close");
never explain the four folders. Done is finished work, filed in the Archive. The note says the defaults in one
line; when the map found a code folder, pushing or deploying code joins what you ask before. What they want to
understand themselves is not on this screen: question 4 asked it. Their reply lists what to remove, rename, change,
mark Done or add; say back in one line what changed. Nothing is created before their "Looks right, create it".

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

- Write `.cogby/self/USER.md` (under 2 KB): who they are, what they do, what matters most when they said, how to
  answer ("answer first, in plain words", and the language they write in, so later chats use it), and what you ask
  before as hard rules. Replace `[OWNER_NAME]` and `[TODAY]` in `.cogby/self/SOUL.md`. For an identity already filled
  in, change only what they checked. Role and mandate go in `areas/work/card.md`.
- One page per row: `node core/ops/new.cjs project <slug>`, `area <slug>`, `person <slug>`,
  `organization <slug> --kind own|client|partner|vendor`. A Done row is made as a project, its folder then moved from
  `projects/` to `archive/`, with a timeline line saying it is finished. Imports:
  `node core/ops/import-brain.cjs apply --proposal <file> --dry-run`, then the same without `--dry-run`.
- Record what the map showed as evidence, each with `--source "onboarding <date>, <where it came from>"`:
  `cogby remember <page> "<claim>"` for a fact, `cogby log <page> "<what happened>"` for an event. Where their to-dos
  live and where their meetings are recorded are one fact each on `work`, with the list's or folder's own name and
  link when they gave one; "none" is not written. Never copy a to-do or a transcript.
- What they want to understand, from their answer to question 4: one line per topic under `## What I care about
  understanding myself` in `.cogby/self/information-border.md` (made with its two headings if it is not there), and
  one per topic they said to hand over under `## Hand over`. Only what they said or confirmed: a guess they did not
  answer, or "ask me as we go", is written nowhere.
- **The questions asked:** tick each in `.cogby/self/getting-to-know.md` with the date and the answer, or "skipped";
  a to-do or meeting tool that was found ticks its question with what was found. What they use Claude for and what
  they wish it did every day also go in USER.md. The ones left are asked in later chats; the session start says which.
- **Their answer to question 3 asks for a morning brief:** offer the morning check-in in one line. On a yes:
  `cogby routines add "Morning check-in" --run "check-in, morning" --rhythm "weekdays at 08:00" --source "onboarding
  <date>"`, then schedule it with the `routines` skill's Step 2; their yes was the yes. Only a scheduler that runs on this computer after the chat closes switches it on (a scheduled-tasks tool).
  It is "on" only once the scheduler confirms it; then record the pointer. No such scheduler here: say plainly it is
  saved, not running on its own yet, and that a new chat names it when it is due.

## You're set

**One real thing first,** done with what you just learned, its result said in `youre-set` above "Try this first". A
calendar is connected and a work meeting is coming soon: prepare it as the `meeting-prep` skill does, by its commands,
from the pages just written, in at most six lines (who is in it, where things stand, one or two things to ask). No
calendar: what is on their plate this week, three to five lines from the map. Read nothing they did not allow. The map
is too thin (fewer than three rows kept, or nothing with a date): skip it, and keep the three suggestions.

Invoke `my-view` once, by its commands, and keep the link it returns. It publishes the page when this chat can publish
one; look for that tool properly, as in Get to know you. No link came back: the page is a file on their computer, and
`youre-set` says so plainly, never a link that is not there. Say `youre-set`: what was created, and the one credit
line ("Your brain is organised with PARA, a method by Tiago Forte."); My view as the main thing, "where you and I keep
track of everything", with its link; the morning check-in "on" only once confirmed; where their to-dos stay, and the
meetings line when their meeting tool is connected; what they skipped connecting, and that they can ask for another look once it is connected; the one real thing; then "Try this
first", the meeting line only with a calendar and when you did not just prepare that meeting, the last one about one
of their projects. It ends by saying a new chat can start from anywhere. A folder of theirs needs no step here: when a
chat opens in a folder Cogby does not know, it offers to connect it then.

## Right after onboarding

Building My view and the first thing they try ("What needs me today?", a meeting prep) stay as plain as the
onboarding, until they start a new chat. One plain line on what is happening ("Getting My view ready"), the work
done quietly, then only the result. No tool names, file paths, commands or step-by-step narration, whichever skill
does the work.

## Rules

- Nothing is created before the hello is answered. Nothing is written, created or linked, and no routine is scheduled,
  before Check it's "Looks right, create it".
- Never write a secret, and never open a credential file an import refused.
- Never copy another assistant's system prompt into SOUL.md, and create nothing "for later": a mention is no request.
- A correction to how onboarding went is added, dated, to the brain's `.claude/CLAUDE.md` under `## This brain's rules`.
