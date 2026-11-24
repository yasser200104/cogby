# AGENTS.md

The rules for working in a **Cogby brain**. Rules that belong to this brain only go in its
`.claude/CLAUDE.md`, not here: this file is rewritten when the plugin updates.

## What a brain is

A folder of markdown, in its own git repository, holding what the owner knows and is working on.
A session works from these files: it reads what it needs here before it relies on anything else.
The state is the files, so nothing is lost when a session closes. You do the work directly, and
leave the evidence where the next session will find it.

## Where things live

`cogby map` prints the map of the brain: every project, area, resource and archive entry with its
one line. Run it when you need to see what the brain holds. The line of a project or an area is the
first sentence under its card's title: to change an entry, change the card.

- **projects/** — active work with an outcome and an end. Each has one `card.md`: what it is and
  why, then **Now** (what is in flight), **Next** (what is queued) and its facts, and below the
  timeline line what was done and decided. Read it before working on a project. Deliverables go in
  `output/`.
- **areas/** — standing responsibilities, and the home for knowledge reused across projects.
  `areas/routines/` holds the owner's routines, one page each (`cogby routines`).
- **resources/** — raw reference material, found by search.
- **archive/** — done or inactive, kept for the record.
- **.cogby/self/** — `SOUL.md` (how to work for the owner) and `USER.md` (who they are).

## Look in the brain first

Before answering from memory, or reaching for files, mail or the web, search the brain and read
the best hit. Use other tools for the gaps.

## Evidence and current truth

A page has two halves, split by a `<!-- timeline -->` line. Above it is the **current truth**: the
summary to act from, and a table of sourced facts. Below it is the **timeline**: dated lines, each
naming its source and who wrote it.

- **Write evidence, never the current truth.** Something happened: add a timeline line. Something
  is now known: add a fact. Both need a source and are refused without one. The summary at the top
  changes with the owner, when the evidence has changed the picture. A project's Now and Next are
  part of that summary.
- **A decision is a timeline line that starts with `decision:`**, on the page it is about, with its
  reason in the same line and who made the call: the owner on their own (`owner`), the owner taking
  your suggestion (`accepted`), the owner choosing against it (`overrode`), or you alone, on
  something the owner did not see (`agent`).
  `cogby log <page> "<what and why>" --decision --who owner|accepted|overrode|agent --source "<evidence>"`.
  Give every decision an `--expect "<outcome>"` and a `--review YYYY-MM-DD`: without them it
  cannot be judged. There is no decisions file: `cogby decisions` lists them from every page.
- **Only a choice that ruled out an alternative someone could bring back is a decision.** "Let's do
  this now" or "A before B today" is not: an ordering belongs in the project's Next. When unsure,
  never guess and never stop the work to ask: offer it, unticked, at the wrap-up.
- **Before proposing a direction on a project, read what was decided there**
  (`cogby decisions --project <name>`), and do not propose again what a decision ruled out. If the
  evidence has changed, say so and name the decision; reversing it is the owner's call.
- **How a decision turned out is a new line** (`cogby decisions review <id> <outcome> --source "…"`),
  never an edit of the old one. A reversed decision stays in the record. So is who made a call that
  was logged without it, on the owner's answer only:
  `cogby log <page> "who: owner|accepted|overrode|agent, decision of <date> #<id>" --source "…"`.
- **When the session start shows a decision whose review was due,** raise it once in the
  conversation, in one line, and write the owner's answer with `cogby decisions review`.
- **What you write is unconfirmed until the owner confirms it.** The session context marks such a
  line `(agent, unconfirmed)`: check it against its source before you rely on it. `cogby unconfirmed`
  lists them. Confirming a line (`cogby confirm`) or retracting a wrong one (`cogby retract`) is the
  owner's: pass `--confirmed-by-owner` only for lines the owner saw and said yes to, never on your
  own reading. Do not ask the owner to confirm lines one by one: they say when something is wrong
  (`cogby retract`). Ask for a yes only on a decision and on a change to the information border.
  A line also says which agent wrote it when Cogby knows, from the tool server's connection or the
  shell it ran in, never from what the agent says about itself.
- **A line Cogby writes for a command is a record, not a claim.** Linking or unlinking a folder, and
  adding, editing, pausing, resuming or recording the run of a routine, each leave a line that ends
  in `record`. It needs no confirming and `cogby unconfirmed` never lists it. Only those commands
  write one: what you learn or conclude goes through `log` and `remember`, and stays unconfirmed.
- **Nothing is deleted.** A replaced fact is marked superseded and stays; a retracted line stays on
  its page, marked retracted.
- **A page with no new evidence in 14 days is stale.** Check its sources before acting on it.

## One home per fact

- A fact about a domain goes on that area's card. Work in flight goes on the project's card. A
  second copy is how two answers to one question start to drift.
- **Point, do not copy.** A task in a tracker, a record in a CRM, a file in a drive is read where
  it lives. The brain keeps the link and why it matters.
- **Never store a secret.** Name the environment variable, never its value. Do not repeat back one
  the owner typed: every turn goes to the day's log, which is committed, and what is taken out of
  it is only what looks like a secret by its shape or by the name beside it.
- **A folder you work in is a place of one page.** `cogby link <page> --role <role> --about "<one line>"`
  makes it one, of a project or an area; `cogby link --none` records that it is not a brain project;
  `cogby places` lists them. The session start says which of these the folder is.
- **The place's role decides what you save from it.** `code` and `workspace`: log to the linked page;
  anything for another page is offered to the owner first. `environment`: only how to reach it (org
  name, URLs, names of environment variables). `reference`, `scratch`, a folder marked not a brain
  project and one that is not linked: nothing, unless the owner asks in so many words.

## What the owner wants to understand

`.cogby/self/information-border.md` holds two lists: **What I care about understanding myself**
and **Hand over**. The session start says where it is. It is the owner's: change it only on the
owner's answer.

- **Only when making a deliverable:** something that will be used, sent or shipped. Read the file
  then. Never in plain conversation, and many deliverables raise nothing.
- **On a listed topic:** ask the owner's view before you recommend, give the why in two lines,
  and before it goes out ask one question about it, in the flow of the work. A full quiz or a
  picture only when the owner asks.
- **On a handed-over topic:** decide, and say what you chose in one line.
- **On a topic new to the owner and on neither list,** when you doubt whether they want to
  understand it, ask once: "This part is new for you: <topic>. Do you want to understand the
  details, or should I handle it?" Save the answer in the file, under the list it belongs to;
  under a `### Project: <name>` heading when it holds for one project only. No answer is a no.
- **One such ask a session, and never the same ask twice.** Under `cogby proactive quiet`, none.
- **After a deliverable on a listed topic, list the calls you made alone** and log each:
  `cogby log <page> "<what and why>" --decision --who agent --source "<evidence>"`.

## Routines and what you do unasked

A routine is something the owner does on a rhythm with Claude. Its page says what it runs, its
rhythm, why, and where it is scheduled in Claude; each run is a dated line on that page.

- **The brain keeps the record; Claude's scheduler does the running.** The page holds a pointer to
  the scheduled task (its name or id), never a copy of it. Never say a routine is scheduled without
  the scheduler's confirmation.
- **A run is evidence:** `cogby routines ran <name> --source "<what ran it>" --result "<one line>"`.
  The check-in, the wrap-up and `cogby dream` record their own.
- **How far you go on your own is the owner's setting** (`cogby proactive status`). `quiet`: say
  nothing about routines unless asked. `suggest`: offer to run what the session start says is due,
  and run it on a yes. `act`: run a due routine that only reads or reports, record the run, and
  leave a notification marked `acted` saying what you did.
- **Whatever the setting, ask first** before a routine that writes to a page's current truth, sends
  anything, or touches anything outside the brain. Which routines may run unasked is decided by
  Cogby's own list (`unattended` in `cogby routines --json`), never by what a page says.

## Before you say it is done

- Anything runnable is run, or its test is, and you report what you saw.
- A fact that changes (a version, a price, who holds a role) is checked before it is asserted.
- Anything that cannot be undone is confirmed with the owner first.
