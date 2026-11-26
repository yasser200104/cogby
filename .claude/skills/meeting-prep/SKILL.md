---
name: meeting-prep
description: Prepare the owner for one meeting from what the brain already knows. Use on "prep me for my meeting with…", "meeting prep", "what do I need to know before the call with…", "brief me on [person or company]", "I have a 1-on-1 with…", or "prep my next meeting" / "prep today's meetings" when a calendar is connected. Produces a one-page brief: who, where things stand, what was promised, what to ask, read from the brain and the last meeting records. Reads only; it writes nothing unless the owner asks for the brief to be kept. NOT for what happened in a meeting (meeting-notes), and NOT a general project status (search the brain and read the page).
---

# Meeting prep: walk in knowing what the brain knows

## Step 1: Which meeting

- **The owner named it** (a person, a company, a topic): use that.
- **"My next meeting" or "today's":** read the calendar if a calendar connector is in this session.
  Take the title, time, attendee names and the join link. Do not read the description aloud or
  copy it anywhere. No calendar connected: ask which meeting, once.

Leave a personal-looking event (a doctor, family) alone unless the owner named it.

## Step 2: Read the brain

Search before anything else, one `search` per name: each person, the company, the project or
topic. Open the best hits at the `file` each names. Usually that is:

- `areas/people/<slug>`: who they are, why they matter, recent interactions;
- `areas/organizations/<slug>`: the relationship, what is signed;
- `projects/<name>/card`: Now and Next on top, the newest timeline lines below, and among them
  the decisions (lines that start with `decision:`);
- the page's facts table and the newest timeline lines.

Then the last meetings: `cogby meetings --page <slug> --limit 3` for the person, project or area
pages you read, and read the newest two or three records it lists (`resources/meetings/…`): their
summary and what they wrote where. Follow a record's transcript link (the Drive doc, the Granola
note) or run a transcript search through a connector only when the brief needs a detail the
summary does not hold, and never copy the transcript into the brief or the brain.

Also call `todo` (`list`) and `notify` (`list`) and keep what names this person, company or project.

Check the dates. A page with no new evidence in 14 days is stale: say so in the brief and do not
state its contents as current.

## Step 3: Fill gaps, only if asked or obvious

If the brain has nothing on someone, say so. Offer one of these, and do it only on a yes:
recent mail with them (subjects and dates, from a connected mail tool), the shared documents the
calendar event links, the transcript of a past meeting that was never debriefed (found as
`meeting-notes` Step 1 finds one, read for this brief only), or a web search for a company the
owner has never dealt with.

## Step 4: The brief

One screen. Every line that states a fact ends with where it came from. Leave out a section with
nothing in it.

Write the brief in the chat, as markdown. There is no card for it:

```markdown
## <Meeting title> · <day, time>

**With:** <name, role, organization> · <name…>

**Where things stand**
- <the two or three lines that matter, from the project's card and its latest timeline> (source, date)

**Promised**
- By you: <open to-dos and commitments that touch this person or project> (due)
- By them: <what they said they would do> (source, date)

**Decide or ask**
- <a notification waiting on the owner that this meeting can settle>
- <a question the evidence raises: a stale fact, a missed date, two lines that disagree>

**Last time:** <one line from the newest meeting record, or the most recent interaction> (date, record)

**Not in the brain:** <who or what you found nothing on>
```

Lead with what changed since they last met. Do not pad: a thin brief for a first meeting is correct.

## Step 5: Offer the next step, once

One line: *"Want this kept on the project, or as a page to decide from?"*

- **Kept:** `log` one line on the project or person page, `source: "meeting prep <date>"`, saying
  what the meeting is for. The brief itself is not stored: it is a view of the brain.
- **Several decisions to make before the meeting:** `plan-page`.
- Afterwards, `meeting-notes` turns what happened into evidence.

## Rules

- Search the brain first. Mail, calendar and the web fill gaps; they never replace it.
- Never state a stale page as current, and never invent a commitment.
- Nothing is written without a yes.
- Calendar and mail are read as titles, names, subjects and dates. Never copy a body into the brain.
- A transcript is read only for a detail the meeting records do not hold, and is never copied.

## When something is missing

- **No brain tools in this session:** say the brain is not reachable here, and prepare only from
  what the owner tells you and what a connected calendar shows.
- **Nothing found on anyone:** say so in one line and ask what the meeting is about.
