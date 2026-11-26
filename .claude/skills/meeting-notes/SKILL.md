---
name: meeting-notes
description: Turn what happened in a meeting into evidence in the brain. Use on "debrief the meeting", "debrief my 1:1 with…", "debrief today's meetings", "here are my notes from the call with…", "log this meeting", "we just met with…", "process this transcript", "catch me up on my meetings", "connect my meetings", /meeting-notes (the old /meeting-debrief), or pasted meeting notes, a transcript or a recap email. Finds the transcript itself through the session's connectors (calendar, Drive, Granola or another notes tool), extracts what was decided, what was learned, who promised what and what waits on the owner, shows it for one confirmation, then writes each item to its one home and keeps a meeting record that points at the transcript. NOT for preparing a meeting (meeting-prep), NOT for a single item (capture), NOT for closing the whole session (wrap-up).
---

# Meeting notes: what happened becomes evidence

A meeting nobody wrote down has to be held again. This skill writes it down once, in the places
the next session will look, and keeps the way back to the transcript.

## Step 1: Find the meeting and its transcript

**Which meeting.** One the owner names ("my 1:1 with Sam", "the Acme call yesterday"): find it by
title, attendee and day. "Today's meetings": list today's ended calendar events that have a
transcript, let the owner pick, then debrief each on its own. "Catch me up on my meetings", or the
Meeting catch-up routine: every meeting held since the last record, as `catch-up.md` beside this file says.

**Where the transcript is.** A fact on `areas/work/card` may say where the owner's meetings are recorded:
try that tool first ("connect my meetings": ask where, check it is connected, keep it as that fact). Then the
connectors here, in this order, stopping at the first that has it. Read only: never edit, share or comment.

1. **The calendar event** (Google Calendar). Google Meet attaches to it a Google Doc
   "<event title> - YYYY/MM/DD HH:MM GMT – Transcript", a Drive file "… – Recording" and, when
   Gemini took notes, "… – Notes by Gemini". Read the transcript with the Drive connector (the id is
   in its `fileUrl`). Keep each `fileUrl` as it is, and the event's `htmlLink`. A meeting a
   colleague organised often has no attachments on the owner's copy: go to 4.
2. **Granola.** Find the meeting by time and attendees (`list_meetings`, `search_meetings`),
   read its notes (`get_meetings`) and its transcript (`get_meeting_transcript`, paid plans only:
   on a free plan, say the record is written from Granola's notes). The pointer is the link the
   response gives for that meeting; when it gives none, "Granola meeting <its id>". Never build a URL.
3. **Any other meeting-notes connector** (Notion meeting notes, Fathom, tl;dv…): the same. Find it by
   time and attendees, read the transcript, and point at the link the tool returns.
4. **A Drive search** by date and a word of the title: `title contains 'Transcript' and title
   contains 'YYYY/MM/DD'`. An unscheduled call is named "<meet code> (YYYY-MM-DD HH:MM GMT) –
   Transcript". A colleague's doc can show as a shortcut: read its target
   (`shortcutDetails.targetFileId`) and point at the target's `viewUrl`.
5. **Ask** for a link or a file. Accept pasted text last, and say that the start of a paste lands
   in the day's log, as every ask does. When no connector was there, name the one that would make
   this automatic: Google Calendar with Drive for Meet, or Granola.

A tool's own summary (Gemini notes, Granola's notes) is a starting point. Decisions, who made the call,
commitments and facts are read from the transcript. Speaker labels can be wrong (one name for a whole room, or
for both on a 1:1): when who said it matters and the label is in doubt, ask. A transcript is read once, here.

## Step 2: Find the pages

`search` for each person, the company and the project or topic. List every page the meeting
touched: the project it was about or the area of a standing meeting, each person's page
(`areas/people/<slug>`), the organisation's. Each of them will link to the meeting's record.

No page for a person or company who will clearly come up again: propose creating one in Step 4
(`node core/ops/new.cjs person <slug>`, a lowercase hyphenated name). Someone mentioned in passing
gets no page.

## Step 3: Extract

Pull out only what is in the material. Mark anything you inferred as inferred.

| Kind | What counts | Where it will go |
|---|---|---|
| Decision | "we agreed", "we will go with", and an alternative was ruled out | a `log` line with `decision: true` and `who` on the project's card (the line starts with `decision:`) |
| Fact | something now known: a date, a price, who owns what (note the row it replaces, if any) | `remember` on the page it is about |
| Their commitment | what someone else said they would do, by when | `remember` with `kind: "commitment"` on the project or person page |
| The owner's action | what the owner said they would do | a to-do, with `due` and `project` |
| Open question | raised and not settled | `## Next` on the project's card, or a notification when only the owner can settle it |
| What happened | the meeting itself | the record's summary, and one line on each touched page linking to it |

The summary: 5 to 15 lines written from the transcript, in your words: what was discussed, what
moved, what is left. No long quotes, nothing secret.

**A decision, and who made the call.** The test: did it rule out an alternative that someone could
later bring back? "We go with vendor B, not A" does. "Let's start with the export" does not: it is
an ordering, and goes under `## Next`. Unsure: never guess, show it unticked in Step 4. For each
one, `who`: `owner` when the owner made the call in the meeting, `accepted` when it was your
suggestion they took, `overrode` when they chose against it. `expect` and `review` (a date) only
when the meeting said what is expected or when to look again.

## Step 4: Show it, once

Show the extraction once, each item with its destination, the summary and the transcript link, and
anything you would create. Ask for one yes, and let them strike or fix lines. The yes covers the
summary and the record too. Do not ask per item.

**Where this session can show an inline visual** (a `show_widget`-style tool): call the `card` tool with the name
`debrief-review` and show the `html` it returns, exactly as returned. Its `data`, exactly:
```json
{"title": "Acme weekly", "date": "2026-11-11", "pages": ["projects/acme-migration", "areas/people/amina"], "summary": ["<a line of the record>", "…"], "transcript": "<its link or path, or none>", "items": [{"kind": "Decision", "text": "<one line>", "where": "<its page>", "ticked": false}]}
```
`pages`: every page it touched. `summary`: the record's lines, 15 at most. `items`: in the order you extracted them, 30 at most;
`kind` is `Decision`, `Fact`, `They will`, `You will` or `Open`; a decision's `where` is its page and who made the call; leave `ticked`
out, except `false` for a decision you are unsure of. Rows are numbered, the last is the record itself. The click comes back as "Save items 1; 2; 4. Leave out: 3.": save exactly those.

**Where it cannot,** show it as a short list grouped by kind:

```
Meeting: Acme weekly, 2026-11-11, with Amina and Karim → projects/acme-migration, areas/people/amina
Transcript: https://docs.google.com/document/d/…/edit

Summary (for the record)
- The audit has to finish before cutover; go-live moves to December.
Decisions
- Go-live moves to 2 December, not November: the audit comes first (owner)
Facts
- Budget is 12k (replaces 10k)
They will
- Karim: send the data export by Friday
You will
- Send the revised plan (due Thu)
Open
- Who signs off on the cutover?  → needs you
```

## Step 5: Write

After the yes, the record first, then the items.

1. **The record.** Write a JSON file outside the brain and run `cogby meetings add --data <file>`
   with `title`, `date` (YYYY-MM-DD, the day it was held), `with` (names), `pages` (every touched
   page), `transcript` ("none" when there is none), `recording`, `notes` and `event` when you have
   them, `summary` (the lines), `line` (what happened, one line, for the pages) and `written` (the
   kept items: `{ kind, text, page }`). It writes `resources/meetings/<date>-<name>.md`, marked as
   written by an agent and unconfirmed, and one line on each page linking to it, then prints the
   `source`. Stopped halfway? Run it again: nothing is written twice.
2. **The items**, handed to `capture`, each with that exact `source` (the meeting's name, its date
   and the transcript's link) and the meeting's date as `date` (`valid_from` for a fact).
3. **The project's card**, `projects/<name>/card`: each decision as a `log` line with
   `decision: true`, `who` and its reason in the line. A decision about no project goes on the area
   it is about, or on `log:<the meeting's date>`. An open question the owner kept goes under
   `## Next` in `card.md`: that section is current truth, so it changes only with that yes. Never
   write a Done or Decisions list into the card.

The owner left the record out: skip 1; the source is `"<name> <YYYY-MM-DD>, <transcript link>"`.

## Step 6: Close

Report in a few lines what was written and where, with the record's path and the transcript link,
then offer, once, only what applies:

- a follow-up message to the attendees: draft it, pass it through `clean-writing`, never send it;
- `plan-page`, when several open questions need the owner's verdict.

## Rules

- Nothing is written before the yes.
- One home per item: a commitment is not also a to-do unless it is the owner's own. The record only
  lists what was written; it is written once and never edited.
- Never record as a fact what was only floated. A maybe is an open question, and a choice of the
  moment is not a decision: nothing is saved as one on a guess.
- Every line carries the meeting as its source, with the transcript's link when there is one.
- Never store the transcript: the record points at it and holds a summary. Never copy a secret.
- Never send a message. Drafts only.

## When something is missing

- **No brain tools in this session:** give the extraction and the summary as text the owner can
  keep, with the transcript link, and say it was not saved.
- **No shell for `cogby meetings add`:** write the items with the tools, each source carrying the
  link, and say the meeting record was not written.
- **The transcript contradicts the brain:** show both, with dates, and ask which stands. Then supersede.
