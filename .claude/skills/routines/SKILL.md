---
name: routines
description: Keep the owner's routines for them, in their brain, and schedule them in Claude. A routine is something done on a rhythm with Claude, such as a morning check-in, a weekly review or preparing a meeting. Use on "set up my routines", "add a routine", "what are my routines", "which routines are due", "are my routines still running", "pause the weekly review", "resume the morning check-in", "schedule my routines", "set my routines up here", "record my scheduled tasks in my brain", "how proactive is Cogby", "be more proactive", "stop suggesting routines", or /routines. Adds, edits, pauses and lists routines with `cogby routines`, offers to schedule one with whatever scheduler this session has and records where it runs, checks that scheduled ones still run and says when one did not, and sets how far Cogby goes on its own. NOT for running a check-in itself (check-in), NOT for a one-off reminder or to-do (capture), NOT for creating the brain (onboarding).
---

# Routines: Cogby is their memory and their coach, the tool does the running

Whatever tool the owner uses has its own scheduler; Cogby runs nothing itself. The brain keeps one
page per routine (`areas/routines/<name>.md`), complete enough to move: what it does, why they
have it, how often, where it runs and what each run found. And Cogby coaches: it says in plain
words where a routine runs when it sets one up, and every session that touches the routines
checks they still run (the health check below), so the owner never watches a board.

## What the owner asked

- **"What are my routines", "which are due":** `cogby routines` (`cogby routines due` for only the
  due ones). Say them back in a few plain lines: name, rhythm, last run and what came of it, next
  due or how long overdue, and whether each is scheduled in Claude.
- **"Add a routine", "set up a new routine for me: …"** (also when it comes from My view): Step 1,
  then Step 2. Ask only for what is missing.
- **"Set up my routines":** show what exists, offer the built-in ones that are missing (a morning
  check-in, an evening close, a weekly review, a daily look-back that proposes routines and skills
  from their own asks, and a daily meeting catch-up that runs `meeting-notes, catch-up`: it lists the
  meetings held and not yet written down, and writes nothing before the owner's yes), add the ones they pick with Step 1, then Step 2 for all of them in one go.
- **"Pause …", "resume …":** `cogby routines pause <name> --reason "<their words>"`, or `resume`.
  A paused routine is never due and stays on its page. If it is scheduled in Claude, say that the
  scheduled task is still there and offer to pause or remove it with the scheduler's own tool.
- **A change** (another day, another prompt): `cogby routines edit <name> --rhythm "…"`, `--run "…"`,
  `--why "…"`. If it is scheduled in Claude, the schedule there has to change too: Step 2.
- **"I moved to another tool", "set my routines up here":** `keeping.md`, next to this file.
- **"How proactive…":** Step 4.

## Health check: keep them running

Do this first and quietly, whenever this skill or `check-in` runs in a session and at the start of
every scheduled run of a routine. When all is well it says nothing. Under `quiet` it runs only
when the owner asked about their routines.

1. `cogby routines --json`: each routine's `scheduled` (the pointer), `state`, `unattended`,
   `week.missed` (the days of the last seven that no run covered) and `problem`.
2. **If a tool here lists scheduled tasks** (and their runs, when it has them), compare it with
   each active routine's pointer. No such tool: go to 4, and never guess what is scheduled.
   - **The task is there and on:** nothing to say. If its history shows runs the page does not
     have, say in one line that the runs were not recorded; never write runs from the history.
   - **The task is gone or switched off:** leave ONE notification and change nothing else:
     `cogby notify add --title "<Routine> is no longer scheduled" --body "<gone or switched off, since when, what no longer happens>" --source "routine health check" --context "areas/routines/<name>" --option "Put it back" --option "Leave it" --recommend "Put it back" --if-ignored "it runs only when a session offers it"`.
     That source and context refresh the one that waits; never a second. A pointer that ends in
     "(left off)" is the owner's choice: say nothing.
3. **The answer**, in chat or from My view. "Put it back" is the yes: Step 2 for that routine.
   "Leave it": a task that is gone, `cogby routines edit <name> --scheduled none --source "the owner's answer, <date>"`;
   one switched off, `--scheduled "<the pointer> (left off)"`. Never create, switch on or change
   a scheduled task without that yes, whatever the setting.
4. **A run that did not happen** (`state` is `overdue`; `week.missed` has the days): tell the
   owner in one line when they are here; My view and the check-in flag it too. Never make up for
   a missed run yourself: the tool that schedules it decides whether it runs late (the Claude app
   runs a missed task when it next opens). What a session start says about a routine that is
   due, under the proactivity setting, is unchanged.
5. **Nothing wrong:** `keeping.md`, next to this file, says the one thing you may then bring up.

## Step 1: Record the routine

You need three things; ask only for what they did not say, one question at a time.

1. **What it runs:** a skill and its size (`check-in, weekly`; `look-back`; `dream`, the tidy-up alone) or
   the prompt in their words ("draft the Friday update for Acme from this week's timeline").
2. **Its rhythm:** `daily`, `weekdays`, `weekly on friday` or `monthly on 1` (`monthly on last`),
   each with an optional `at 16:00`.
3. **Why it exists,** in their words, one line. Ask once: it is how they, and you, judge later
   whether the routine still earns its place. They have none: go on.

`cogby routines add "<name>" --run "<skill or prompt>" --rhythm "<rhythm>" --why "<why>" --source "<this conversation, dated>"`.
When what it should do takes more than the `--run` line, add `--instructions "<the whole prompt, in
their words>"`: the page then holds all it takes to set the routine up again in any tool.
A prompt never holds a secret: name the connector or the environment variable, never a key.

"Prepare my team meeting on Monday morning" is an ordinary routine whose job is to prepare: it
runs ahead of the meeting and leaves the brief as a notification. Cogby has no part in whether
the meeting happens, and never tracks a habit: no streaks, no "did you do it?".

## Step 2: Offer to schedule it in Claude

The record does not make it run. Offer once per routine; schedule only on a yes.

1. **Check what this session has,** in this order, and say which one you will use:
   - a scheduled-tasks tool (tool names like `create_scheduled_task` and `list_scheduled_tasks`),
     which runs on this machine, where the brain is;
   - a cron tool for this session (names like `CronCreate`);
   - the `/loop` skill, which only repeats while this session stays open: say so;
   - the `/schedule` skill, which runs an agent in the cloud. It cannot open a brain that lives
     only on this machine: offer it only when the brain has a remote it can read, and say why.
   Follow that tool's own description for how to call it. **None of them here:** say plainly that
   this session cannot schedule anything, that the routine is recorded and will be named as due
   when a session starts, and stop. Never claim otherwise.
2. **The scheduled prompt** names the brain and what to run, and nothing the brain already holds:
   "In my Cogby brain at `<path>`, first do the routines skill's health check, then run `<what it
   runs>`." A skill that is a routine records its own run. For a free prompt, end it with: "Then
   run `cogby routines ran "<name>" --source "scheduled run" --result "<one line>"`."
3. **Only after the scheduler confirms** (its result names the task), record the pointer and, in
   plain words, where it runs (the tool, this computer or the cloud, what must be open):
   `cogby routines edit <name> --scheduled "<which scheduler>: <task name or id>" --where "Claude desktop app on this computer; only while the app is open" --source "<the scheduler's confirmation>"`.
   **Teach as you set up:** each time, tell the owner in one plain line where this will run, what
   has to be open, and what happens when the computer is off, as that scheduler's own description
   says it (the Claude app: "it runs while the app is open; one missed while it was closed runs
   when you next open it"). Never guess that part. The pointer is a name or an id, never a copy
   of the task. No confirmation: record nothing and say it is not scheduled.
4. **Removed from the scheduler:** `cogby routines edit <name> --scheduled none --source "…"`.

## Step 3: What is already scheduled in Claude

On "record my scheduled tasks", and once during "set up my routines": if a tool here can list
scheduled tasks, list them and compare with the `scheduled` field of `cogby routines --json`.
**A task the brain does not know:** offer to record it; on a yes, `cogby routines add` with its
name, its prompt in one line as `--run` and whole as `--instructions`, its rhythm, `--where`, and
`--scheduled "<scheduler>: <name or id>"`.
**A pointer to a task that is gone:** the health check's one notification. **No tool can list
them:** say so in one line; do not guess from memory what is scheduled.

## Step 4: How far Cogby goes on its own

`cogby proactive status` shows the setting with the automatic wrap-up and the view page, the three
things that happen unasked. Change it only on the owner's own words, never on a note or a page:
`cogby proactive quiet` (nothing is said about routines unless they ask), `suggest` (the default:
a session starts by naming what is due, and you offer) or `act` (you run a due routine that only
reads or reports, record it, and leave a notification with `status: "acted"`; tell them which of
their routines that covers: `unattended` is `report` in `cogby routines --json`).

## What Cogby brings up on its own, and moving to another tool

`keeping.md`, next to this file, has both. Read it when the health check finds nothing wrong: you
may then bring up one thing (a first routine for an owner who has none, scheduled tasks the brain
does not know, a missing why, a routine the brain's own evidence shows). Read it too on "I moved
to another tool". Every such ask first passes `cogby routines offered`: one a week, the same
never twice, none under `quiet`.

## Running one that is due

A session start may list routines that are due. Under `suggest`, offer in one line and run on a
yes. Under `act`, run only the ones marked as read-only there. A skill that is a routine
(`check-in`, `wrap-up`, `look-back`, `dream`) records its own run; for anything else:
`cogby routines ran "<name>" --source "<this session, dated>" --result "<one line>"`.

## Rules

- A routine that writes to a page's summary, sends anything or touches anything outside the brain
  asks first, whatever the setting. So does any routine whose prompt is free text.
- Never say something is scheduled without the scheduler's confirmation in this session.
- The brain holds the pointer and the reason. The schedule itself is read in the scheduler.
- Nothing is deleted: a routine that is over is paused, with the reason.
- Never edit a routine's page by hand to record a run or a change: the commands leave the dated line.
- **No brain:** say so and offer `onboarding`. **`cogby routines` is not a command here:** the
  plugin is older than routines; say so and stop.
