---
name: check-in
description: Look across the whole brain and say what needs the owner, in chat. Use on "check in", "check-in", or one of three sizes. Morning ("morning brief", "what's on today", "what needs me", "start my day"), evening ("daily debrief", "close the day", "what did I get done"), weekly ("weekly review", "review my week", "review my decisions", "what's stale", "what should I drop"). Reads to-dos, notifications, each project's card, the day's log, the decision log, stale pages and, when connected, today's calendar. Reports in one screen and changes nothing unless the owner picks something. NOT for reviewing code, a pull request or a document. NOT for one meeting (meeting-prep), NOT for one project's status (search the brain and read the page), NOT for the dashboard page (my-view).
---

# Check-in: what needs you, and what you can let go

The same reading at three sizes. Pick by what the owner said, or by the clock when they only said
"check in": before noon is morning, later is evening, Friday afternoon or "week" is weekly.

## Step 1: Read, in this order

First, quietly, the health check of the routines skill ("Health check: keep them running"): are
the scheduled routines still scheduled, and did any miss a run. It speaks only when one did.

1. `view` tool (`snapshot`): projects and where each stopped, the last lines written, stale pages,
   notifications.
2. `todo` (`list`): open to-dos, with due dates. When a fact on `areas/work/card` names the tool the
   owner keeps their to-dos in and this session can reach it, read the open ones there too: that list
   comes first, and a to-do is ticked, dropped or added where it lives.
3. `notify` (`list`): what waits on the owner.
4. **Morning only:** today's calendar, if a calendar connector is in this session. Titles, times,
   who. No calendar: say so in one line and carry on.
5. **Evening only:** today's `.cogby/self/log/<YYYY-MM-DD>.md` and `note` (`list`) for today.
6. **Weekly only:** each active project's `card.md` (Now, Next and its newest timeline lines), and
   `cogby dream` for stale pages and
   facts that no longer hold up.
7. **Evening and weekly:** the decision log. Evening: `cogby decisions --since <today>`. Weekly:
   `cogby decisions --since <seven days ago>` (its last line counts them by who made the call),
   `cogby decisions --due` (review date reached, not reviewed yet),
   `cogby decisions --outcome not-as-expected` and `cogby decisions --who none --since <seven days ago>`
   (logged this week without who made the call; each prints its id, date and page). Once a decision has been reviewed, each of these
   prints one more line under its counts: how each kind of call turned out ("Overrode Claude 4
   times: 3 as expected, 1 not."). Take it from a command run without `--since`, where it covers
   every decision: one made this week has rarely been reviewed yet.
8. **Weekly only:** `cogby routines --json`. Each routine's `week` holds the runs of the last seven
   days with what each found (`ran`) and the days no run covered (`missed`). For each run, look at
   what followed within two days in the to-dos and notifications: a to-do added or ticked, a
   notification answered or cleared, a line logged on what the run named. Something followed: the
   result was acted on. The same item named by three runs in a row with nothing following: ignored.

Read those `card.md` files directly. Do not open every page in the brain.

## Step 2: Report

Report in the chat, as text. There is no check-in card: the command center is the page to look at.
One screen, plain lines, most important first. Leave out a section with nothing in it. Never
invent a win: a thin day is written as a thin day.

**Morning**

```
Today, <weekday date>

Needs you
- <notifications waiting, oldest first; the recommended answer in brackets>
Due
- <to-dos due today or overdue, with how late>
Meetings
- 11:00 Acme weekly (Amina, Karim): <one line on what it is for>
In flight
- <each active project: its Now line>
```

**Evening**

```
<weekday date>

Moved:  <what was finished or logged today>
Decided: <today's decisions, each with who made the call: you alone, accepted from Claude, overrode Claude, an agent alone>
Parked: <what was due and is still open, and why if the log says>
Ask:    <the one thing worth deciding tomorrow, only if there is one>
```

**Weekly**

```
Week to <date>

Landed
- <Done lines dated this week, by project>
Stale
- <projects with no Done line in 14 days and nothing under Now; to-dos overdue by a week or more;
   areas not reviewed in 90 days; with how long>
Waiting on you
- <notifications older than a week>
Decisions
- <this week: N, of which X yours alone, Y accepted from Claude, Z where you overrode Claude, V by an agent alone, W not recorded>
- <review date reached: each one, with what was expected of it>
- <recorded as not turning out as expected>
- <logged this week with nobody recorded as making the call: each one, to ask about below>
- <how the calls turned out, over every decision: that line as printed, in one sentence; left out when it is not there>
Unconfirmed
- <N lines and facts an agent wrote that you have not confirmed: the count the snapshot gives; left out at zero>
Routines
- <each routine in one line: ran N times, missed which days; how many results you acted on, how many nothing followed>
- <at most ONE proposal, with the numbers behind it: move its time, change what it runs, or pause it; none when all is well>
Drop?
- <the one or two items stale longest that are worth closing or archiving>
```

## Step 3: Offer what the report makes possible

One line of offers, only those that apply. Do each only on a yes.

- Morning: `meeting-prep` for a meeting on the list.
- Any size: answer a waiting notification (`notify`, `answer`; "not now" is `later`); tick or
  drop a to-do (`todo`, `done` or `drop`); add a to-do.
- Evening or weekly: record how a decision turned out, in the owner's words, never on your own
  reading: `cogby decisions review <id> as-expected|not-as-expected|reversed --source "<what they said>" --note "…"`.
  It adds a line that points at the decision and never edits it; a reversed one leaves the list of
  current decisions.
- Weekly, for each decision `--who none` listed: ask once who made that call (the owner alone, the
  owner taking your suggestion, the owner choosing against it, or you alone on something they did
  not see), and record the answer as a new
  line on the decision's own page: `cogby log <page> "who: owner|accepted|overrode|agent, decision of <date> #<id>" --source "weekly review <date>, the owner's answer"`
  (a decision in the day's log: the page is `log:<date>`). The decision's line is never edited, and
  a line with a wrong id is refused. No answer, or "I don't remember": leave it not recorded and do
  not ask again; older ones are asked about only when the owner says so. Never fill it in yourself.
- Weekly, the one routine proposal: on a yes, `cogby routines edit` or `cogby routines pause`, and
  the scheduled task too, through the routines skill. Missed on most of its days: another time.
  Results nothing followed, three weeks running: change what it runs, or pause it.
- Weekly, when the brain shows a repeated need no routine covers (the same ask on a rhythm, a note
  that something came too late again): one new routine, through `keeping.md` of the
  routines skill, whose gate refuses a second ask in a week.
- Weekly, with several things to keep or drop: `plan-page`, so the owner decides by clicking.
- Weekly: mark an area reviewed by setting `last-reviewed:` on its card to today, after the owner
  has actually looked at it.

## Step 4: Record the run

Every time, without being asked: `cogby routines ran "check-in, <morning|evening|weekly>" --if-any --source "check-in <date>" --result "<the report in one line>"`.
It adds one line to the page of a routine that runs this check-in, and does nothing when the owner
keeps no such routine. It is the one thing this skill writes on its own.

## Step 5: Keep it, if asked

The report is a view of the brain, not a new fact. Store it only when the owner asks: the `note`
tool, `add`, with `source: "check-in"`, the text `Daily debrief <date>` or `Weekly review <date>`,
and the report as its `body`.

## Rules

- The counts by who made the call are reported as they are, with no verdict: how the owner works
  with Claude is theirs to judge. The same holds for how those calls turned out: the numbers in one
  sentence, with no advice and no conclusion drawn from them.
- Read only, but for the run's own line. Never close a project, drop a to-do, archive a page or touch `last-reviewed:` on your own.
- Naming what to drop is the job. Dropping it is the owner's.
- Routines by exception: morning and evening name a routine only when it is late or no longer
  scheduled, as one "Needs you" line. Acted on and ignored are counts, never a verdict.
- A source that is empty or unreadable is said so in one line; the report is built from the rest.
- Nothing leaves the machine: no message, no email.
- Do not read calendar descriptions, and leave out personal-looking events.

## When something is missing

- **No brain tools in this session:** say the brain is not reachable here and stop.
- **A brand-new brain:** say there is nothing to review yet, and offer `capture` or `onboarding`.
