# Catching up on meetings

For "catch me up on my meetings", "which meetings are not in my brain", and the Meeting catch-up
routine. Every meeting that was held and never written down, in one pass and with one yes. The steps
named here are the ones in `SKILL.md`.

## 1. Since when

`cogby meetings --limit 1` gives the newest record: start the day after its date. No record yet: the
last seven days. Never more than fourteen days back unless the owner names a date.

## 2. Which meetings were held

- **A calendar is connected:** the events in that window that have ended, that the owner did not
  decline, with at least one other person. Leave out anything personal, and any meeting that already
  has a record (same day, same title: `cogby meetings --limit 30`).
- **No calendar:** search the tool the owner's meetings are recorded in (the fact on
  `areas/work/card`) for transcripts or notes dated in the window. No such fact and no calendar: ask
  where their meetings are recorded, once, and keep the answer as that fact.

## 3. Which have something to read

For each, look for its transcript or notes as Step 1 does, the recorded tool first. Nothing found:
the meeting goes under "nothing to read", by its title and date. Never guess what was said in it.

More than eight with something to read: say how many, do the eight most recent, and offer the rest.

## 4. Read and extract

Each meeting on its own, as Steps 2 and 3 do: its pages, its summary, its items. A transcript is
read once, here, and never pasted anywhere.

## 5. Show them all, once

One block per meeting, in the plain form of Step 4 (title, date, with whom, pages, transcript link,
summary, then the items by kind), newest first, the items numbered straight through. Under them,
the meetings with nothing to read. Ask for one yes for everything; the owner strikes a line or a
whole meeting. A decision you are unsure of is shown unticked, as always.

## 6. Write

As Step 5, one record per meeting kept, each item with that meeting as its source. Then one line
per meeting on what was written, and the list of those with nothing to read.

When this ran as the routine:
`cogby routines ran "Meeting catch-up" --source "<this session, dated>" --result "<N> recorded, <M> with nothing to read"`.

## Nobody to ask (a scheduled run)

Write no record and no item. Do steps 1 to 3 only, then leave one notification (`notify`, `add`):
"<N> meetings since <date> are not in your brain yet: <their titles>. Catch up on them?", with the
answers "Yes, show me" and "Skip these", what you suggest, and what happens if nothing is done (they
wait for the next run). None waiting: no notification. Record the run either way, with the count.
