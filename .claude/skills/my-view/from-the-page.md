# What the owner answered on a notification

Read with Step 2 of `SKILL.md`. On the page, a notification shows what Cogby suggests, and the owner
answers it with one of its own answers, with **Yes, do that** (on an older page, **Do this**), with
Later or Clear, or in their own words. Three things need judgement, and this file says how to apply
them: **Yes, do that**, an answer in their own words, and the prompt the page gives to paste into a
chat.

The page runs nothing. A press is a message to you; you carry it out.

## First: is it still waiting?

Read the notification before you act on it: `cogby notify list --all --json` (tool `notify`, action
`list`, `all: true`), and find its id. If its status is no longer `unread`, the owner settled it
already, in chat or with an earlier press. Skip a `do`, an `answer`, a `later` or a reply on it, and
name it in your one-line report. A `dismiss` is applied either way.

## Yes, do that (action `do`)

The owner tells you to go ahead with what the notification suggests.

1. **What it suggests** is its `recommend`. With `options`, that is the suggested answer. With none,
   it is the thing to do, in a sentence. With no `recommend` at all, it is what the title and the body
   plainly ask for.
2. **Record the press.** With options: `cogby notify answer <id> "<recommend>"`. Without:
   `cogby notify comment <id> "Yes, do that" --source "command center"`.
3. **Carry it out**, as you would had the owner said "yes, do that" in chat. Ask first, in chat,
   before any part of it that sends a message, deletes something, spends money, pushes or deploys
   code, or touches anything outside the brain. The press is a yes to the suggestion, never to those.
4. **Close it.** Done: `cogby notify read <id>`. A part of it waits on the owner's yes: leave it
   unread and say what waits.
5. **Nothing clear to carry out** (no `recommend`, and the text asks for nothing you can do): do
   nothing, leave it unread, and ask the owner in your report what they want done.

## An answer in their own words (a comment on a `notification`)

It is the owner's reply to that notification, the same as if they had typed it in chat under it.

1. Keep it: `cogby notify comment <id> "<text>" --source "command center"`.
2. Act on it as their reply, with the same ask-first rule as above. It may answer the question in
   other words, ask for something else, or ask you a question back.
3. It settles the notification: `cogby notify read <id>`. It leaves it open (a question back, "not
   yet"): leave it unread, and answer them in your report.

## The prompt pasted into a chat

**Copy prompt**, at the top of the page, gives one request with everything the owner chose and asked
there, for when it should happen now. It opens with "From my Cogby page", asks for a session of its
own, and lists each thing on a numbered line:

| On a line | The same as |
|---|---|
| `Cogby asked "<title>" (<id>). My answer: "<option>". Carry it out.` | action `answer` |
| `Cogby left "<title>" (<id>). Yes, do what it suggests…` | action `do` |
| `Put off "<title>" (<id>) for now.` | action `later` |
| `Clear "<title>" (<id>): nothing to do.` | action `dismiss` |
| `About "<title>" (<id>), in my own words: <text>` | a comment on the notification |
| `Prepare me for my meeting "<title>"…` | action `prepare` |
| `My notes for the meeting "<title>": <text>` | a comment on the meeting |
| `Do this for me: <text>` | a comment on a `request` |
| a line about a to-do, a note or a project's status | the change of that kind in Step 2 |

Apply each line exactly as the same send or change would be applied. A to-do or a note named as "the
one I added on this page" has no id yet: add it first, from its own line, then apply the line to it.
When the prompt ends on "These are also saved on my page", the same presses wait in the page's store:
go through Step 2 instead, so that each is done once, and the check at the top of this file keeps a
notification from being carried out twice. When it ends on "opened from a file", the text is all
there is. Do not rebuild the page unless they ask.

An older page gave one line per notification instead, `From my Cogby page, about "<title>" (<id>):`
followed by `my answer is "<option>"`, `go ahead and do what you suggested`, `put it off for now`,
`clear it` or `in my own words: <text>`. Apply it the same way.
