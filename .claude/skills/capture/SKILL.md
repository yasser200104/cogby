---
name: capture
description: Put one thing into the brain, in the one place it belongs. Use on "remember that…", "note that…", "remind me to…", "add a to-do", "create a task", "file this", "log this decision", "where does this go", "save this doc", a brain dump to sort, or a pasted document the owner wants kept. Also called by other skills (meeting-notes, wrap-up) to file what they found. Sorts each item into a to-do, a note, a timeline line, a fact, a filed document, or a notification for a decision. NOT for a whole meeting (meeting-notes), NOT for closing a session (wrap-up), NOT for editing a draft (clean-writing).
---

# Capture: one thing, one home

A second copy of a fact is how two answers to one question start to drift. This skill decides
where each item lives and writes it there once.

## Step 1: Split and sort

Split what you were given into items. One item is one sentence that can stand alone. Sort each:

| The item is… | It goes to | How |
|---|---|---|
| something the owner must do | a to-do | `todo` tool, `add`, with `due` and `project` when known |
| a thought to keep as it was said | a note | `note` tool, `add` |
| something that happened | the timeline of the page it is about | `log` tool, with a `source` |
| something now known to be true | a fact on the page it is about | `remember` tool, with a `source` |
| a decision that was made: it ruled out an alternative someone could bring back | the timeline of the page it is about (a project's card; `areas/working-with-ai/card` for how the owner works with Claude; `log:today` when it is about nothing in particular) | `log` tool with `decision: true`, the reason in the line, and `who`: `owner`, `accepted` (your suggestion) or `overrode` (against it) |
| a choice of the moment ("this first, then that") | not a decision: an ordering goes in the project's `## Next` | ask first, then edit |
| a decision only the owner can make | a notification | `notify` tool, `add`, with `options` and `recommend` |
| a rule for how Cogby should work here | the brain's `.claude/CLAUDE.md`, under `## This brain's rules` | ask first, then edit |
| a document, export or file to keep | a folder in the brain | Step 3 |

When an item could be two things, pick by what the owner will do with it: act on it (to-do), look
it up (fact), or read it again (note). Ask only when you truly cannot tell, and ask once for the
whole batch, not per item.

## Step 2: Find the page

For a timeline line or a fact, call `search` with the names in the item and use the best hit's
`slug`. A project's work in flight goes on `projects/<name>/card`, a fact about a client, team
or domain on that area's card, a fact about a person on `areas/people/<slug>`.

- **A page exists:** write to it.
- **No page, and it is real ongoing work or a responsibility:** create it with
  `node core/ops/new.cjs project <slug>` or `area <slug>` (`person`, `organization --kind …`), then write.
- **No page, and it is a one-off:** it is a note, not a page.

The `source` is where the item came from, said so the owner could find it again: "call with Amina
2026-11-11", "email from the landlord", "said in session 2026-11-11". A line with no source is
refused; do not invent one.

Before `remember`, read the page's facts table. Same claim: skip it. An older claim this one
corrects: pass `replaces` with its row number, so the old one is marked superseded. Nothing is
superseded without it: a result that names a `similar_row` is a question for the owner, not a fix.

## Step 3: A document to keep

1. Run `cogby map`: it prints what the brain holds, one line per project, area, resource and archive entry.
2. Choose the bucket: `projects/<name>/` for work with an end, `areas/<name>/` for what is
   maintained, `resources/<topic>/` for reference found by search, `archive/` for what is done.
3. Say where it will go and wait for a yes when it creates a folder or sits beside existing files.
4. Copy it in. Never overwrite: a file of that name already there means ask.
5. Add one line about it to the owning card's `## Holds` list.

A folder that should stay where it is (working files, a synced Drive) is not copied: mount it with
`cogby sources add "<path>"`.

## Step 4: Say what you did

One line per item: what it became and where. Nothing else.

```
To-do: Send the proposal to Acme (due Fri, project acme-migration)
Fact:  Budget is 12k, replaces 10k → projects/acme-migration
Note:  Idea: a shared checklist for onboarding
```

## Rules

- One home per item. Never write the same thing as both a to-do and a fact.
- Write evidence, never the summary at the top of a page: that changes with the owner.
- Never delete. A wrong fact is superseded; a to-do no longer wanted is dropped.
- Never store a secret. Name the environment variable, never its value.
- Point, do not copy: a record that lives in a tracker, a CRM or a drive gets a link and why it matters.
- The map (`cogby map`) is read from the cards. To change an entry, change its card.
- Never write into `.cogby/self/log/`: the session log is written by a hook.

## When something is missing

- **No brain tools in this session:** say the brain is not reachable here and stop. Do not write files by hand.
- **`new.cjs` refuses a name:** show its message and ask for another name.
- **The owner gave no source and you cannot tell:** ask where it came from, once.
- **"What did we decide about X?":** not a capture. Run `cogby decisions --project <name>`, or
  `search` for the words, and answer from the lines it returns.
