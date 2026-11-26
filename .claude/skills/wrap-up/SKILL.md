---
name: wrap-up
description: Close a working session so the next one can start from the files. Logs what was done and decided on the project's card, appends one summary to today's log, leaves a notification for anything waiting on the owner, commits what this session changed in the brain, and refreshes the command center. Use on /wrap-up, "wrap up", "close the session", "that's it for today", "done for today", "signing off", or a clear goodbye at the end of real work. Also run headless by the session-end hook when the owner turned the automatic wrap-up on. NOT for a mid-conversation "thanks", and NOT for filing one item (capture).
---

# Wrap-up: leave the evidence where the next session will find it

The next session works from the brain's files, not from this conversation. This skill puts what
matters there before the session ends.

**Headless run** (started by the session-end hook, nobody to ask): never ask a question, never edit `SOUL.md`,
`USER.md`, `.claude/CLAUDE.md` or any skill, and follow the hook's own prompt where it is more specific than this
file. A correction you would have proposed becomes a notification, a decision is saved only when it plainly
passes the test in Step 2 (one you are unsure of is not), and nothing is confirmed: there is no owner to say yes.

## Step 1: What happened

1. In the brain: `git status --porcelain` and `git diff --stat`.
2. Skim today's `.cogby/self/log/<YYYY-MM-DD>.md`. Its `### HH:MM` entries are written by a hook as
   the session goes: read them, never rewrite them.
3. Name, in one line each: what was produced, what was decided, what is still open.

A session that only talked has nothing to wrap: say so in one line and stop.

**Asked for by hand, check with them first.** Before Steps 2 to 7 write anything, show what you
would save, so a person who wraps up themselves decides what is kept. Where this session can show
an inline visual (a `show_widget`-style tool): call the `card` tool with the name
`wrap-up-review` and show the `html` it returns, exactly as returned. Its `data`, exactly:
`{"items": [{"kind": "Progress", "text": "<one line>", "where": "<its page>", "ticked": false}]}`.
`items` are in order, 1 to 30. `kind` is `Progress`, `Decision` (one that was made; `where` is its page and who
made the call), `Fact`, `To-do`, `For you` (a decision that waits on them), `Lesson`, `Files` (what would be
committed) or `Confirm` (a line or fact this session already
wrote with `log` or `remember`; `where` is its page). Leave `ticked` out, except `false` for an item shown unticked. The
click comes back as "Wrap up with items 1; 2; 4. Leave out: 3.": do exactly those. Where it cannot, list the items
numbered, say which start unticked, and ask which to keep. Headless: skip this.

**Outside the brain, the folder's place decides** (the session start names it). `code`, `workspace`: an item for
the linked page is ticked as usual, one aimed at any other page is `ticked: false`, and finished work that matches an
open to-do of that page adds a `To-do` item "mark done: <its text>" (`todo` tool, `done`; the commit is the `source`
of its `log` line). `environment`: only facts about how to reach it. `reference`, `scratch`, marked not a brain
project, or not linked: promote nothing to a page, and skip Steps 2 and 3 unless the owner names what to save.

**A kept item is confirmed.** A ticked `Progress`, `Decision`, `Fact` or `Confirm` item is the owner's
yes to that line. Once it is written, call the `confirm` tool: `action: "confirm"`, the page as `slug`,
`refs` (the `id` that `log` returned, `#<row>` for a fact) and `confirmed_by_owner: true`. An item
left out stays unconfirmed. Never pass `confirmed_by_owner` for a line the owner did not see and keep.

## Step 2: Update the project's card

A project is one page, `projects/<name>/card`. For each project this session worked on:

- **What was finished** is a timeline line: the `log` tool on `projects/<name>/card`, one line per
  piece of work, with its `source` (the commit, the file, this session).
- **A decision** is a timeline line too, marked as one: `log` with `decision: true`, one line
  with the reason in it, and `who` made the call: `owner` (they decided on their own), `accepted`
  (they took your suggestion) or `overrode` (they chose against it). Pass `expect` and `review`
  (a date) only when the owner said what they expect or when to look again.
- **`## Now` and `## Next`** sit above the timeline line: they are the current truth, and that changes with the
  owner. Run by hand: show the lines you would change as a `Progress` item in the review of Step 1 (a worked-on project with nothing under Now or Next always gets one line proposed for each: My view opens a project on them), and edit those two
  sections of `card.md` only once the owner kept that item. Headless: do not edit them. Log where work stopped as a timeline line, and the next session reads it.

Never write a Done or Decisions list into the card, and never rewrite an earlier line. No project
was touched: skip the card, not the decisions.

**What counts as a decision.** The test: did it rule out an alternative that someone could later bring back?
"Postgres, not Mongo, because of the reporting queries" does. "Let's work on this now" or "A before B today" does
not: it is in the day's log already, and an ordering belongs in `## Next`. Plainly passes: a ticked `Decision` item.
Unsure: never guess and never stop the work to ask; show it with `ticked: false`, saved only if the owner ticks it. Fails: not shown, not saved.

**Where it goes.** About a project: its card. About how the owner works with Claude: `areas/working-with-ai/card`
(made once with `node core/ops/new.cjs area working-with-ai`; `SOUL.md` is not written here, and a standing rule that
follows is proposed in Step 5). About nothing in particular: the day's log, `log` on the page `log:today`.

## Step 3: File what was learned

Hand durable items to `capture`: a fact that is now known, something that happened, a to-do the
owner asked for. Do not file them yourself. Most sessions have none; skip silently.

## Step 4: What waits on the owner

A notification (`notify` tool, `add`, `source: "wrap-up"`) only when both are true:

1. **It needs their decision or approval:** a draft to OK, a call to make, a blocker. A heads-up or
   a "did X" does not; that is a timeline line on the project's card.
2. **The title is one sentence they can act on,** with no ids or file paths. When it is a question,
   pass `options` and `recommend`.

Set `context` to `<project> · <thread>` (`acme · content-review`): the same source and context
refreshes the one already waiting, so a bare project name lets a second item replace the first.

Something done unasked (a push, a fact superseded) is recorded with `status: "acted"`, a `reason` and an `undo`.

## Step 5: Lessons

If the owner corrected how you work, and it is a pattern and not a one-off, propose one dated line for the
brain's `.claude/CLAUDE.md` under `## This brain's rules`, and add it on a yes. A change to who the owner is or how they
want to be worked for is proposed for `USER.md` or `SOUL.md` the same way. Never edit a skill: skills are replaced when the plugin updates.

## Step 6: One summary in today's log

Append exactly one block to the bottom of `.cogby/self/log/<today>.md`. Omit a part with nothing in it.
```
## Session wrap

Goal: <what the session set out to do>
Deliverables:
- <path>: <what it is>
Decisions:
- <decision and why>
Open:
- <what is unfinished>
```

## Step 7: Commit this session's changes

Writes made with `log` and `remember` are already committed, and so is every to-do, note and notification, each as its own commit; a hook commits the day's log when the session ends. This commits the rest.

1. **Scope.** `node core/ops/wrapup-scope.cjs --session <id>` prints the paths this session dirtied (the id is in the
   line this session opened with, "This session's id is …"), and with them the to-do, note and notification stores and the
   day's log whenever they changed: every session writes those, from any folder, so they are always in scope (listed only while something in them is uncommitted: the log of a session still open, a store whose own commit did not go through). Commit exactly what it prints. It prints nothing: commit nothing. It reports no baseline: the scope is unknown, not empty, so commit what it did print, read
   `git status --porcelain`, commit only what plainly belongs to this session, and write `scope: unscoped, no session baseline` in the commit body.
2. **Commit named paths only:** `git commit -F <message-file> -- :/<path> :/<path>`. Never
   `git add -A`, `git add .` or `git commit -a`, and never `reset --hard`, `checkout --`, `restore`,
   `clean` or `stash`. Anything else dirty belongs to the owner or to another session: leave it.
3. **Message:** a subject that says what changed, the `Co-Authored-By` trailer, and as the last
   line `Cogby-Wrapup: <session-id>`.
4. **Push** depends on the mode (`cogby wrapup status`):
   - run by hand: commit, and push only if the owner says so;
   - `review`: commit, do not push, and leave one notification with `context: "wrapup-review"`;
   - `auto`: push the current branch, then check `git rev-list --count @{u}..HEAD` prints `0`.
   No remote is not an error: say "local only". A failed push is not an error either: the commit stays, the summary
   says why, and one notification is left with `context: "wrapup-push"`. Never force-push, never switch branches.

## Step 8: Refresh the command center, then report

Invoke `my-view`: it does nothing when the page is off, and a failure there is one line in
the report. Then `cogby mirror push --if-on`, an extra some owners turned on: say nothing when it prints nothing, one line in the report when it prints or fails. Then `cogby routines ran wrap-up --if-any --source "wrap-up <date>" --result "<the commit line>"`.

Report in the chat, as text: there is no card for it. The last line is signed. It names Cogby and says
what it did: how many timeline lines and facts this wrap-up wrote, and where they went.
```
--- Session wrap ---
Done:      <what was produced>
Progress:  <projects updated, or none>
Waiting:   <notifications left, or none>
Committed: <hash> (pushed | local only | push failed: <reason>)

Cogby · 3 lines saved to <project>
```
Nothing was written: the signed line is "Cogby · nothing saved from this session".

## Rules

- Never rewrite the log's `### HH:MM` entries, and append only one `## Session wrap`.
- Write to a project's card only for a project that was worked on, and to its `## Now` and `## Next` only with the owner's yes.
- A notification is for a decision that waits. One that was made is a line on its page, never saved on a guess.
- Commit named paths, and verify a push. Never create a git repository here: a brain with none skips Step 7 and says so.
- **No log file for today:** create it with a `# <date>` heading, then append the block.
- **`capture`, git or the brain tools are missing:** do the steps that still apply, file nothing inline, and name what was skipped.
