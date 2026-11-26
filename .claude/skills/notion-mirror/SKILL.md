---
name: notion-mirror
description: Keep a copy of the brain in Notion, for an owner who wants to see their projects, areas, people, open to-dos and decisions there. An extra, off until the owner turns it on, and started only by the owner typing /notion-mirror (Claude never starts it on its own, so an owner who does not use Notion never meets it). Use it to "mirror my brain to Notion", "set up the Notion mirror", "update Notion" or "turn the Notion mirror off". Sets it up after saying exactly what leaves the computer, updates it (only the pages that changed), and takes in the to-dos ticked or added in Notion. The brain stays the one home. NOT for reading or writing someone's Notion in general (use the Notion tool directly), NOT for moving a brain into Notion, NOT for editing brain pages from Notion (those edits are overwritten), and NOT a live sync: it updates when a session runs it.
disable-model-invocation: true
---

# Notion mirror — the brain, shown in Notion

A copy, never a home. The brain's files stay the one place a fact lives; Notion shows them. The only
things that come back are a to-do ticked, or a to-do line added, on the mirrored To-dos page.

`cogby mirror` says where things stand: on or off, the Notion page it lives under, whether Notion's
own command-line tool is installed, and how many pages an update would write.

Speak to the owner in plain words: no commands, ids or file paths unless they ask.

## What is mirrored, and what never is

| Mirrored | Never mirrored |
|---|---|
| Every project's card | Raw reference material (`resources/`) |
| Every area's card | The archive |
| Every page under people, organizations and threads | The day log and meeting records |
| The open to-dos | Quick notes and notifications |
| The decisions | Routines, and what Cogby keeps about the owner (`.cogby/self/`) |

A card whose frontmatter says `mirror: false` stays out. What looks like a password or a key is
blanked before it leaves. Each mirrored page opens with a line saying it is a copy.

## Set it up (once, on the owner's yes)

1. **Say what will happen, then ask.** In a few lines: which pages go to Notion (the left column
   above, with their own counts from `cogby mirror plan`), what stays on their computer, that their
   brain stays the real one, that anyone who can open that Notion page can read the copy, and that
   the copy is updated when they ask and each time a session is wrapped up. Ask for a yes. No yes,
   no mirror.
2. **Ask where it lives.** A Notion page of theirs to hold it: they paste its link. If they have
   none and the session has a Notion tool, offer to create an empty private page named "Cogby" and
   use that.
3. **Pick how pages are sent.** `cogby mirror` says whether Notion's command-line tool was found.
   - Found: Cogby sends the pages itself. Fast, and uses almost none of their Claude allowance.
   - Not found: say there are two ways. Install Notion's command-line tool and sign in to it once
     (theirs to do; give the steps only if they want them), or carry on now through the session's
     Notion connection, which is slower and writes a batch of pages per run. Their choice.
4. **Turn it on:** `cogby mirror on --parent <the page's link>`. Then run the update below.

## Update it

Run when the owner asks. While the mirror is on, each wrap-up also runs `cogby mirror push --if-on`
by itself and reports it in one line; on a brain where the mirror is off that prints nothing, and
nothing is said.

**With Notion's command-line tool:** `cogby mirror push`. It takes in the to-dos ticked or added in
Notion, then writes every page that is new or changed. Report what it printed in one or two plain
lines.

**Through the session's own Notion connection,** when `cogby mirror push` says the tool was not found:

1. If `cogby mirror plan --json` shows the page `todos` with a `notion_id`, read that page from
   Notion as markdown and hand it over: `cogby mirror pull --data -` (the page on stdin). Do this
   before writing anything, or a tick made in Notion is lost when the page is rewritten.
2. `cogby mirror plan --json` again. Take the pages whose `action` is `create` or `update`, in the
   order listed (a section comes before the pages under it). At most 25 a run.
3. For each: `cogby mirror page <key> --json` gives its `title`, its `markdown` and
   `parent_notion_id`.
   - `create`: make a Notion page with that title under `parent_notion_id`, with the markdown as
     its content. A section has no content: title only.
   - `update`: replace that Notion page's content with the markdown. Never touch a page that has
     pages under it, and never delete or trash anything.
   Then record it at once: `cogby mirror done <key> --id <the Notion page's link or id>`.
4. Say how many were written and how many are left for the next run.

Never write a mirrored page's content from memory or reword it: send what `cogby mirror page` gives.

## What comes back from Notion

Only to-dos, and only two things: a to-do ticked on the To-dos page is marked done in the brain, and
a line the owner added there becomes a new to-do (under the project whose heading it sits below).
A reworded line, a deleted line, and any edit to another mirrored page change nothing in the brain
and are overwritten at the next update. If the owner says they edited a project in Notion, tell them
plainly it will be overwritten, and offer to make the change in the brain instead.

## When something is off

- **Notion's tool is not signed in.** The update stops at once and says so; nothing was sent. Signing
  in is the owner's (`ntn login`, once): ask them to, then run the update again.
- **A page was removed in Notion.** The update says it could not write it. On the owner's word,
  forget it so the next update makes a new one: `cogby mirror done <key> --id none`.
- **A page left the brain** (archived, or marked `mirror: false`). It stays in Notion and the
  update names it. Cogby never deletes it: tell the owner, who removes it there if they want.
- **Turn it off:** `cogby mirror off`. Nothing more is sent, and what is in Notion stays as it is.
- **Another computer.** Which Notion page is which is remembered on the computer that made the
  mirror. Run the updates from that one; a second computer would make a second set of pages.

## Rules

- Nothing goes to Notion before the owner's yes to step 1. `cogby mirror page`, `done`, `pull` and
  `push` all refuse while the mirror is off.
- Never read a mirrored Notion page to learn what is true: read the brain.
- Never delete, trash or move a Notion page for the mirror.
- Never store a Notion key or token in the brain. Signing in to Notion is the owner's.
