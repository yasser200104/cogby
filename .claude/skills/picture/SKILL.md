---
name: picture
description: Explain one idea as a picture, a small card in the chat drawn in one of five fixed layouts (flow, compare, layers, timeline, before-after), using the owner's own work as the example when the brain has one. MANUAL ONLY. Fires on "picture this", "picture <topic>", "show me a picture of…", "explain it as a picture", "draw it for me", or /picture. Also fires on the return leg, when the owner presses Simpler, Deeper or From my work on a picture. A plain "explain X" gets an ordinary answer, never a picture on your own judgement; you may offer one in a single line. NOT for a set of decisions to answer (plan-page), NOT for a chart of numbers, NOT for styling a page (design), and NOT for testing what the owner remembers (quiz-me).
---

# Picture: one idea, one drawing, then check it landed

An explanation the owner nods along to is not yet understood. A picture shows the shape of an idea
in one look, and ends with a way to check it: the "Quiz me on this" button.

## Step 1: What to picture, and from where

Take the idea the owner named. Then look in the brain first: `search` it and open the best hit.

- **The brain holds it** (their project, their process, their client): draw from those pages, and
  pass the page as `source`.
- **It does not** (a general concept): draw from what you know, pass no `source`, and where the
  brain has a project that makes a good example, use it in one item and say which.

## Step 2: Pick the layout by the shape of the idea

| The idea is… | Layout | Items |
|---|---|---|
| steps that happen in order | `flow` | 2 to 6 |
| options or things side by side | `compare` | 2 or 3 |
| one thing resting on another | `layers` | 2 to 6, top first |
| events on dates | `timeline` | 2 to 8, oldest first |
| a change from one state to another | `before-after` | exactly 2 |

One idea, one layout. If it needs two, picture the more important half and say what is left out.
If none fits (a web of relations, a formula, a table of numbers), say so and answer in text: a
forced picture is worse than none.

## Step 3: Write the words

The drawing is fixed; the words are yours, and there is room for few.

- `title`: the idea, in eight words or fewer.
- `gist`: one sentence a newcomer would understand.
- `items`: each a `title` of one to four words and a `text` of one line. `points` (short lines)
  where a column needs a list. `when` on a timeline item. `best: true` on the compared option you
  would choose, only when the owner asked which.
- `takeaway`: the one thing to remember, in a sentence. Not a repeat of the gist.

Plain words. Define a term the first time it appears, or leave it out.

## Step 4: Show it

**Where this session can show an inline visual** (a `show_widget`-style tool): call the `card` tool
with the name `picture` and show the `html` it returns, exactly as returned. Its `data`, exactly:

```json
{"title": "How a fact gets in", "gist": "<one sentence>", "layout": "flow", "items": [{"title": "Heard", "text": "<one line>", "points": ["<short line>"], "when": "<timeline only>", "best": true}, {"title": "Filed", "text": "<one line>"}], "takeaway": "<one sentence>", "source": "<the page, when it came from the brain>"}
```

`title`, `layout` (`flow`, `compare`, `layers`, `timeline` or `before-after`) and at least two `items` are
needed, or the card is refused; items beyond the layout's most (the table in Step 2) are left out.
`points` (five at most), `when`, `best`, `takeaway` and `source` are left out when not used; `layers`
draws only `title` and `text`. Add at most two plain lines after the card: what the picture leaves
out, or where the brain had nothing.

**Where it cannot,** give the same content as text: the gist, the items as a short numbered or
bulleted list, the takeaway.

## Step 5: The buttons

Each sends a chat message; answer it with a new picture of the same idea.

- **Simpler:** fewer items, shorter words, no term left undefined. Keep the layout.
- **Deeper:** take the item that carries the most and open it into its own picture, or add the
  level beneath. Say which you did.
- **From my work:** `search` the brain for a project or area where this idea is at play and redraw
  with it, `source` set to that page. Nothing found: say so, and keep the general picture.
- **Quiz me on this:** that is `quiz-me`. Where the picture came from the brain, quiz from those
  pages; where it did not, say a quiz needs something the brain holds.

## Rules

- A picture states only what the source or your knowledge supports. A fact from a stale page (no
  new evidence in 14 days) is drawn, and named as stale in the line after.
- Never invent an example from the owner's work.
- This skill writes nothing to the brain.

## When something is missing

- **No brain tools in this session:** picture from what you know and say the brain was not read.
- **The idea is too vague to draw:** ask what they want to understand about it, once.
