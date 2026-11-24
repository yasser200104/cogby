---
name: digest
description: Read one source and turn it into evidence in the brain. Use on "digest this", "distill this", "read this into my brain", "what should I keep from this document", "digest the folder…", or /digest, with a file, a page or folder from a mounted source, pasted text, or a document already under resources/. Extracts the key points as sourced facts, dated events as timeline lines, the owner's actions and the open questions, shows them once for confirmation, then writes each to the page it belongs to and proposes a summary the owner can accept. NOT for one item to file (capture), NOT for a meeting (meeting-notes), NOT for only making a folder searchable (`cogby sources add`), NOT for cleaning up prose (clean-writing).
---

# Digest: one source becomes evidence

A source that is only searchable still has to be read again each time it matters. This skill reads
it once and leaves what it says on the pages the owner works from, each line naming the source.

## Step 1: Pin down the source

One source per run: a file, pasted text, a page from a mounted source, or a document under
`resources/`. Fix how it will be cited, specific enough to find again: the file's path inside the
brain or the source, its title and date, or "pasted in session 2026-11-12". Every item carries
this one `source`, with its page for a PDF.

- **A folder, or a file too long to read whole:** list what is there (names, counts, sizes) and
  ask which part to digest. Never digest more than a handful of files without a yes for that set.
- **A folder nobody has mounted:** digest the part the owner picks, and say that
  `cogby sources add "<path>"` would make the rest searchable where it sits.
- **A meeting's notes or transcript:** hand off to `meeting-notes`.

## Step 2: Read the brain first

`search` for the subject, the people, the organisations and the project the source is about. Read
the best hits, facts table included. This decides three things:

- **the pages:** the project, area, person or organisation each item is about. Use the hit's `slug`;
- **what is already there:** a claim the brain holds, from any source, is skipped;
- **what changed:** a claim that corrects a row is saved with `replaces` set to that row's number.

No page for something the source is mostly about: propose creating it in Step 4
(`node core/ops/new.cjs project <slug>`, or `area`, `person`, `organization`). A name mentioned in
passing gets no page.

## Step 3: Read and extract

Read the source once. Pull out only what it says, and mark anything you inferred as inferred.

- **A PDF:** read a long one in page ranges, at most 20 pages at a time. Start with the first
  pages and any contents page, then read only the ranges that matter. Each item cites its page:
  `resources/contracts/acme-msa.pdf p. 4`. Say which pages you read and which you did not.
- **A scan or an image:** read it, and end the source of each item from it with "read from a
  scan": `… p. 2, read from a scan`. Text read off an image can be wrong; this tells the owner to
  check it.

| Kind | What counts | Where it will go |
|---|---|---|
| Fact | something the source states as true: a number, a date, an owner, a term, a constraint | `remember` on the page it is about, with `replaces` when it corrects a row |
| Timeline | something that happened on a date the source gives | `log` on that page, with that `date` |
| To-do | something the source asks of the owner | `todo`, `add`, with `due` and `project` when known |
| Open question | what the source raises and does not settle, or where it contradicts the brain | `notify`, `add`, when only the owner can settle it; otherwise shown and not saved |

Aim for the points the owner would look up again, usually five to fifteen. A long source is not a
reason for a long list: what is left stays findable in the source itself.

Then write a summary of the source in two to four sentences. It is shown, and saved nowhere yet.

## Step 4: Show it, once

Show the summary, then every item with its kind and where it goes, then any page you would create.
Ask for one yes, and let the owner strike or fix lines. Do not ask per item.

**Where this session can show an inline visual** (a `show_widget`-style tool): call the `card`
tool with the name `digest-review` and show the `html` it returns, exactly as returned. Its
`data`, exactly:

```json
{"title": "<the source>", "source": "<how it is cited>", "page": "<where most of it goes>", "items": [{"kind": "Fact", "text": "<one line>", "where": "<its page>"}], "summary": "<a new summary for page>"}
```

`items`: 1 to 30, with `kind` one of `Fact`, `Timeline`, `To-do` or `Open question`. `summary`:
only when you propose a new summary for `page`; the card shows its first 200 characters. Rows are
numbered and ticked, except the summary, which is last and unticked. The click comes back as
"Save items 1; 2; 4. Leave out: 3; 5.": save exactly those numbers.

**Where it cannot,** show it as a short list grouped by kind:

```
Digest: Acme master agreement (resources/contracts/acme-msa.pdf) → projects/acme-migration

Summary: A two-year agreement from 1 January 2027, capped at 120k, with 60 days' notice.

Facts
1. Fees are capped at 120k a year (replaces 100k)
2. Notice period is 60 days                         → areas/clients/acme
Timeline
3. 2026-10-30  Agreement signed by both parties
To-do
4. Send the insurance certificate (due 1 Dec)
Open question
5. Who is the named security contact?               → needs you

Proposed summary for projects/acme-migration, only if you say so: …
```

## Step 5: Write

After the yes, write the items that were kept, and nothing else:

- `remember` tool for each fact, with the `source` and `replaces` where it applies;
- `log` tool for each timeline line, with the `source` and the event's `date`;
- `todo` tool for each action;
- `notify` tool for each open question only the owner can settle, with `options` when there are any.

Then add one line with the `log` tool to the main page: that the source was digested, and where
the source lives. A file the owner wants kept in the brain and that is not there yet is filed by
`capture`.

**The summary at the top of a page is the owner's.** Change it only when they ticked it or said
yes to it in words, and then replace only the text above the facts table on that one page.
Otherwise leave the page's summary as it is: the facts and lines are saved either way.

## Step 6: Say what was written

One line per item, with what the tool answered (saved, already there, replaced row N), then what
was left out and what was not read.

```
Fact:      Fees are capped at 120k a year, replaced row 3 → projects/acme-migration
Fact:      Notice period is 60 days → areas/clients/acme
Timeline:  2026-10-30 Agreement signed → projects/acme-migration
To-do:     Send the insurance certificate (due 1 Dec)
Needs you: Who is the named security contact?
Summary:   left as it was
Not read:  pages 31 to 48, appendices B to D (pricing tables)
```

## Rules

- One source per run, and nothing is written before the yes.
- Every item names the source. An item you cannot point to in the source is not saved.
- A claim the source only floats, or one you inferred, is an open question, never a fact.
- One home per item: the page it is about, not every page that mentions it.
- Never copy the source into the brain, and never copy a secret out of it.
- Never delete. A changed fact supersedes the old row, which stays.

## When something is missing

- **No brain tools in this session:** give the digest as text the owner can keep, and say it was
  not saved.
- **The source cannot be read at all** (an image too poor to make out, a format with no text):
  say so and ask for a text version.
- **The source contradicts the brain and you cannot tell which is newer:** show both with their
  dates as an open question. Do not supersede on a guess.
- **`remember` or `log` refuses a line:** show its message, fix the source or the page, and retry
  that line only.
