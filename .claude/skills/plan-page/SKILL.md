---
name: plan-page
description: >
  Turn a plan, backlog, review or decision set into an interactive HTML page the owner answers by
  clicking, then read the answers back into the session. MANUAL ONLY: fires on "plan page", "html plan", "give me
  this as html", "make this a page so I can decide", "let me answer this in html", "I want to pick
  what stays and what goes", "review this as a page", "put the options in a page", /plan-page, or the old /html-plan.
  Never on your own judgment that a plan is long enough to deserve a page: offer it in one line and
  build it only on a yes. Also fires on the return leg, when the owner pastes back the answer block,
  file or screenshot of a page they already asked for. NOT design (that owns how a page
  looks, and this skill calls it for exactly that). NOT for forming a view in
  conversation: this is for when the view is formed and needs verdicts. NOT for a
  status report with nothing to decide — prose is better there.
---

# Plan page — decisions as a page, answers back in the session

A long plan in chat gets one reply that answers three of its twelve questions. The same plan as a
page, one control per decision, gets all twelve. This skill builds that page and closes the loop by
reading the answers back, so the decisions land somewhere durable instead of scrolling away.

**The page is slides, always.** The situation explained first, then one decision per slide, moved
left and right, with a strip that stays in view and shows the answers building up. Whatever the
number of rows: six or sixty.

**It is not a document with radio buttons bolted on.** It is a strategy-consulting brief the
owner can answer: MECE, the diagram carries the argument, every technical term defined where it
appears, the fewest words that carry the full detail. That format half of this skill comes from an
earlier kit of the author's own; what was kept and what was deliberately left behind is at the
bottom of this file, so a later session does not bring the rest back.

## Outcome

- **One HTML decision page, built as slides**, saved to the `output/` of the project it belongs to
  (`projects/<p>/output/`, created when the page is the first thing in it),
  named `<YYYY-MM-DD>-<subject>-decisions.html`. When no live project owns the subject, ask which
  one does; if none does, write it to the session's scratchpad or temp directory and say so.
  Resolve the path, never write a bare `output/` at the repo root.
- **An answer round-trip**: either the artifact store (answers read directly) or a copy-back block
  the owner pastes into chat. Same answer format either way, so parsing never forks.
- **The owner's verdicts folded into their real home** once taken — the backlog file, the project's
  `card.md`, the plan doc. The page is the input surface, not the record.
- **The verdicts that are decisions offered as decision lines**, each with who made the call: the
  owner taking your recommendation, choosing against it, or deciding with none on the row (Step 9).

## Context Needs

The `assets/` files are in this skill's own folder (`${CLAUDE_SKILL_DIR}/assets/`), not in the folder
the session is in.

| File | Load level | How it shapes this skill |
|---|---|---|
| `assets/before-after.html` | **read in full, once per session, before the first page** | The only thing that teaches the density. See Step 0 |
| The source plan, backlog or doc being decided | full | Every row on the page comes from it, with its real ids kept |
| the `design` skill | invoke | Owns the visual system; this skill owns the mechanics only |
| `assets/slides.html` | copy, then fill | The slides every page is built from: structure and behaviour, identical every run. See Step 4 |
| `assets/decision-kit.js` | read before building | The persistence and copy-back code, already pasted into `slides.html` |
| `assets/check-page.cjs` | run before handoff | Mechanical faults, non-zero exit. See Step 6 |
| `cogby map` | run | Finding the project that owns this subject |

## Step 0: Read the before/after, once per session

**Before your first page of the session, read `assets/before-after.html` in full.** Not "if there is
budget", not "if unsure": in full, first.

The hard part of this format is the dose. Every rule below can be followed to the letter and still
produce a page that is three paragraphs per row wearing a diagram as a hat. The dose is not
derivable from a rule, it is only visible in an example: that file takes one real Cogby backlog row
written the ordinary way and writes it again at format, with the word count on both. Its "after"
pane is the dose of one decision slide. The earlier kit made this read mandatory after a blind test
caught a session skipping it to save budget while calling it the most useful file it had.

## Step 1: Check it earns a page

**This is a fit test, not a trigger.** Nothing in this skill fires on its own: if a plan is
sprawling and a page would help, say so in one line and build it on a yes. A page the owner did not
ask for costs them a context switch they did not agree to.

Once asked, a page is worth building when there are **roughly five or more genuine decisions** and
they have to be weighed against each other. Under that, answer in chat: a page with three controls
is a worse document.

The other half of the test is that the decisions are **the owner's**. Rows where the answer is
already determined by evidence are not decisions, they are findings: state them as findings and do
not spend a control on them.

## Step 2: Write the decision set

Pull every row from the source. For each one, carry:

- **The real id** from the source (`T3`, `F27`, `M9`). Never renumber: the owner will take the
  answers back to the source file, and a renumbered page makes that a translation job.
- **The title as the source states it.**
- **A plain-words line you write.** One sentence saying what changes for the owner, with no file
  paths and no internal vocabulary. Source rows are written for whoever builds them, not for whoever
  decides them, and a row the owner cannot understand is a row they cannot answer.
- **Status and cost**, where the source has them, so the trade is visible while they decide.
- **Whether the choice changes something a person sees** (a screen, a message, a document). If it
  does, the slide carries a small picture of that thing, before and after (Step 4).

Where a row's state is genuinely unknown, say so on the row rather than giving it a confident line.

**Every technical term gets a definition where it first appears**, in a box on the slide that uses it:
the term in bold, the everyday translation in parentheses, then one line of what it actually means.
Never a glossary at the end, because nobody goes there. This is the single highest-value rule in the
format and the one most often skipped.

> Bad: "the lane resolver gates the reach grammar before the spawn".
> Good: **Reach** (what a routine is allowed to touch): the list of services a scheduled job can
> reach when it runs on its own. Anything not on the list is refused.

## Step 3: Pick the lane

**Artifact lane** — when the Artifact tool is available. Publish with `capabilities: {db: {}}` and
read the answers back with the `ArtifactData` tool (Step 8). No copy-paste, and the page survives
the tab closing. Load the `artifact-capabilities` skill before writing any `claude.use` code.

**File lane** — a Cogby install, a headless run, anywhere with no artifact runtime. A standalone
HTML file in `output/` that persists to `localStorage` and carries a **Copy answers** button. This
lane must always work: build the page so it degrades to it rather than treating it as a fallback
bolted on afterwards.

Both lanes emit the same answer block (Step 8). Read `assets/decision-kit.js` so you know what it
does, and leave the copy inside `assets/slides.html` as written: it is the same code every time,
and the one part of this that has already failed in production.

## Step 4: Build the page

**Every page is built from `assets/slides.html`.** Copy it and fill it; never start from a blank
file, and never lay the decisions out as one long page.

| You fill | You do not change |
|---|---|
| every slot marked `REPLACE:` (the title, the slug, the opening slide, one decision slide per row, the lane line, the closing slide) | the STRUCTURE style block |
| the LOOK style block, with what `design` gives you | the script: it reads the slug, the ids, the options, the recommendations and the costs from the page, so nothing is typed into it |
| | the name of any `data-` attribute, the strip in the header, the Previous and Next bar |

Delete each `TEMPLATE:` comment once you have filled what it describes. The checker faults any
marker, any such comment and the placeholder look left in the page.

Invoke `design` for the visual system: this skill deliberately holds no opinion about
palette or type, because a decision page for a client proposal and one for an engineering backlog
should not look alike. The greys in the template only keep it legible until `design` replaces them.

### The slides, in order

| Slide | What it holds |
|---|---|
| **The situation** (one slide, two when needed) | the plain explanation, the cards, and a visual of the thing itself. Before any decision |
| **One slide per decision** | one row of the source, and nothing else. Never two decisions on a slide |
| **Your answers** | every answer and every row still open, the tally of what the answers add up to, and Copy answers |
| **How this was reached** | Step 5. Always the last slide |

The owner moves one slide at a time with the left and right arrow keys, the Previous and Next
buttons, or a swipe on a phone. The template does all three.

### The opening explanation shows the thing itself

The first slide explains the situation in two or three plain sentences and **one visual of the
thing being decided**, before the owner is asked anything. The test: someone who has never seen the
subject looks at the picture and knows what is being talked about.

| Counts | Does not count |
|---|---|
| the real screen as it is, and as it would be | a map of the page's own rows |
| a before and after of the thing (a form, a message, a document, a week) | a diagram of where notes or items were filed |
| the real steps a person goes through, in order | a decorative diagram: boxes and arrows that could sit on any page |
| real numbers as a chart | a logo, an icon, an illustration |

The template has a before/after frame for it: two labelled panels, each a drawing of the real thing
in inline SVG or simple HTML. Draw what a person would see, with the real labels and the real
numbers, not a symbol of it. A page whose opening visual is about the page (how it is organised,
where each note went) has explained nothing.

### The format, in one line

**A strategy-consulting brief, ultra vulgarized, MECE, visual, with the fewest possible words.**

The contresens that kills it: **few words does not mean less detail.** The numbers, the edge cases,
the traps and the exceptions are all there, in full. They travel in diagrams, tables and short boxes
instead of paragraphs. A good page is dense in information and poor in sentences. A six-row table
says more than a six-line paragraph and reads in two seconds.

### The five mechanics

| Mechanic | The test |
|---|---|
| **The diagram carries the argument, the sentence confirms it** | remove every paragraph and the slide still tells the story. If a paragraph says what the diagram already shows, the paragraph goes |
| **Every slide title asserts a conclusion** | someone who reads only the titles leaves with the whole argument. "Two mechanisms, and only two", never "The caching mechanisms". A decision slide keeps the source's own title |
| **MECE** | no two blocks saying the same thing from different angles, and no "and other items" bucket at the end. A MECE split has no bin |
| **Terms defined on the spot** | a reader who does not know the domain gets through without opening anything else |
| **Few words, full detail** | the detail is all present, carried by the visual |

Diagrams are **inline SVG written by hand**, with `viewBox`, `role="img"` and an `aria-label`. No
chart library: one more curve does not justify 300 KB of dependency, and a remote script breaks the
"opens with no network" rule below.

### The cards at the top

The opening slide carries **3 to 5 cards**, above its visual: a label, the value large, and two
lines saying what to conclude. The owner must be able to stop there and have the shape of the
decision.

**The large value is not necessarily a number.** On a subject with no measured data, hunting for
figures is how invented ones get in.

| The subject | What the card carries |
|---|---|
| measured data | the number, with its unit |
| a trade-off or a technical call | the verdict: `Yes`, `No`, `Depends`, `blocking` |
| a comparison | the gap in words: `x 1,000`, `2x slower`, `no gain` |
| no data at all | the short answer to the card's own question, in one or two words |

Four aligned `No`s across the top beat four invented statistics, and they carry the whole argument.
Never a blank card, never a card filled with a figure you do not have. If none of the four rows
apply, the page has no cards and that is fine.

### A decision slide

One row, one slide. It keeps, in this order: the source's real id, the title as the source states
it, your plain-words line, the definition box for each term it uses first, status and cost, the
options, and a note box.

**Its own small visual, only when the choice changes something a person sees.** The same
before/after frame as the opening slide, smaller: the thing as it is, and as it would be if the
owner says yes. A slide whose choice changes nothing visible (an order of work, a budget, who owns
something) carries no visual: delete the frame, never fill it with a decorative one.

**Each option is a button** with a short label and one line on what it sets in motion. Its
`data-value` is the short word that comes back in the answer block (`keep`, `cut`, `later`).

### The answers build up in view

The owner wants to see how the answers are evolving while still deciding, not only at the end.
Three things do it, and the template draws all three from what was answered. You write none of them.

- **The strip**, in the header of every slide: each decision as a small item with its id and what
  was chosen (or "open"), and the count ("4 of 10 answered"). A click on an item goes to its slide.
- **The answers slide**, after the last decision: every answer, every note, every row still open
  with a button back to it, then Copy answers. Nothing is sent or copied before the owner has seen
  this list.
- **The tally**, on the answers slide and, on a wide screen, beside the count: what the answers add
  up to so far, and what the open rows could still add. It exists only when the source has costs:
  put a bare number in `data-cost` on each option and name the unit once
  (`data-unit="days of work"`). With no costs in the source, leave both out and the tally stays
  hidden.

The strip and the answers slide are what keep the whole shape in view while one slide is on screen.

### The mechanics that are not taste

- **One decision per slide, the whole set always one click away.** No slide holds two decisions,
  and no decision is reachable only by paging through the others: the strip jumps to any of them.
- **Every control starts unset.** A pre-selected default is your opinion wearing the owner's hat,
  and they will accept it by not noticing. A recommendation is allowed, but as a marked and labelled
  option, never as a pre-checked one.
- **Every recommendation is marked once, on its option, and passed to the kit.** Put
  `data-recommended` on the button and keep its visible "Recommended" tag. The template reads those
  marks and calls `DecisionKit({ slug, recommended: { T3: "keep", M6: "cut" } })`: the row id and
  the value of the option you marked. It comes back with the answers, and it is the only way Step 9
  can tell a recommendation taken from one chosen against. A row you recommend nothing on has no
  mark, and no entry.
- **Every interaction saves immediately**, not on a Submit at the end: a click on an option, a
  keystroke in a note. See `## Rules`.
- **Grouped the way the source groups them**, with the group's own framing kept, so the owner's
  mental model of the work survives the trip into the page. Put the group's name in `data-group`
  on each of its slides and keep a group's slides together: the strip and the answers slide label
  the groups from it. On a backlog-sized page a group may open with its own short slide
  (`data-slide="intro"`) carrying the group's framing.
- **Zero remote resources.** No CDN, no web font, no linked image. The page must open with no
  network, from a USB stick, in ten years. Everything is inline, `decision-kit.js` included.
- **It works on a phone.** The template does at phone width; a drawing you add must too: give
  every SVG a `viewBox` and no fixed width.
- **Wide tables scroll inside their own container**, never the page body.
- **No em dash or en dash anywhere in the page.** Use colons and commas. This is this skill's own
  style rule, and the checker faults any dash in reader-visible text.

## Step 5: Close with "How this was reached"

**Every page that recommends anything ends with this section, last, always: it is the closing
slide, after the answers slide.** Three parts, in order:

1. **What was ruled out, and why.** Paths opened and closed. A documented dead end beats one never
   mentioned.
2. **What nearly went the other way.** The point where the recommendation hung by little, and what
   tipped it.
3. **What you are not sure of.** Named, not diluted into a hedge: sample limits, figures inferred
   rather than measured, what you did not verify.

This is the section that gives the owner the means to contradict you. Without it they have to take
your word, and a plan they cannot argue with is a plan they will not commit to. A purely descriptive
page (a recap, a how-to) can skip it; a page with decisions on it never can.

## Step 6: Run the checker

```bash
node "${CLAUDE_SKILL_DIR}/assets/check-page.cjs" <the-page.html>
```

The checker sits beside this file, in this skill's `assets/` folder: give `node` its full path.
Zero dependencies, non-zero exit on a fault. It catches the mechanical half: em dashes, remote
resources, a table outside its scroll container, an SVG with no `viewBox` or no label, a
pre-selected control, a missing "How this was reached", `decision-kit.js` referenced instead of
inlined, template markers or the placeholder look left in, a decision with no control. And the
slides: a page not built from the slide structure, no opening explanation before the first decision
or one with no visual, two decisions on one slide, no progress strip, no answers slide, no way to
move by keys, buttons or swipe. **Fix every FAULT before handing the page over.**

It knows nothing about the half that matters: whether the opening visual shows the thing itself,
whether a term is defined in the right place, whether the split is really MECE, whether a title
asserts anything. That gets re-read by you, against the five mechanics and the opening-explanation
table above.

## Step 7: Hand it over

Give the owner the link or the path, one line on how answers come back, and nothing else. Do not
summarize the page you just built: they are about to read it.

Tell them plainly which lane they are on — whether answers reach you by themselves, or whether they
need to press Copy answers and paste.

## Step 8: Take the answers back

**Artifact lane:** the `ArtifactData` tool, action `get`, on the page's artifact `url`, collection
`review`, doc id `decisions`. That is the `review/decisions` doc `decision-kit.js` writes: `marks`
holds each row id's verdict, `notes` each row id's note and `recommended` what the page recommended
on each row.

**File lane:** the owner pastes the block. Parse this shape:

```
=== COGBY ANSWERS · <slug> · <YYYY-MM-DD> ===
T3: keep
M6: cut
F7: keep · only if the two weeks buys the sheets half too
recommended: T3=keep, M6=keep
unanswered: T1, T2, S6
=== END ===
```

`recommended:` lists what the page recommended, row by row; `recommended: none` means it recommended
nothing. A block with no such line, or a doc with no `recommended`, comes from a page built before
recommendations were carried: it says nothing either way.

**Screenshot:** a valid input, and often what actually arrives (the answers slide is the one
screen that shows every mark). Read the marks off it, then write
them into the store or the page so they are not lost a second time. Name every row you could not
read confidently instead of guessing — a wrong verdict recorded silently is worse than an unanswered
one, because the owner will never be asked again.

Then **fold the answers out to their real home**: the backlog file, the plan doc, the project's
`card.md` (what happened is a `log` line; a verdict that is a decision goes through Step 9). Confirm
before rewriting a source file wholesale; a partial pass is normal and the unanswered rows stay
unanswered rather than being quietly defaulted.

Report back in the house shape: the verdicts, then anything that looks like a mis-click — an answer
that contradicts a position the owner took earlier in the session, or a cut on a row whose cost is
trivial and whose benefit they asked for themselves. Flag it once; do not argue it twice.

## Step 9: Offer the verdicts that are decisions

A click is a verdict. Whether it is a decision is the test in the brain's `AGENTS.md`: **did it rule
out an alternative someone could bring back?** Go through the answered rows once.

| The verdict | What it is |
|---|---|
| a cut, a "no", one option taken over another ("static site, not a CMS") | a decision: offer it |
| an ordering or a timing ("this first", "next sprint", "later") | not a decision: it belongs in the project's `## Next` |
| a keep that changes nothing and closes nothing | not a decision: the folded answer is its record |
| you cannot tell | never guess: offer it, marked unsure |

**Who made the call** comes from the answer, never from memory of what you would have said:

| What came back | `--who` |
|---|---|
| the row is under `recommended` and the owner picked that option | `accepted` |
| the row is under `recommended` and the owner picked another option | `overrode` |
| `recommended` is there and the row is not in it | `owner` |
| no `recommended` at all (an older page, a screenshot) | read it off the page file, which marks the option; if that does not settle it, leave `--who` out |

**Offer them once, with the report, every one unticked.** One line each: the row id, the decision
with its reason (the owner's note when they left one), the page it goes on and who made the call.
The page is where `capture` would put it: the project's `card`, `areas/working-with-ai/card` for
how the owner works with Claude, `log:today` for one about nothing in particular. Nothing is
written until the owner says which ones; a row they do not name is dropped, and never asked about
again. For each one named:

```bash
cogby log projects/<p>/card "<the choice, and what it ruled out: why>" --decision --who accepted \
  --source "<the page's file name>, answered <YYYY-MM-DD>" --date <YYYY-MM-DD>
```

The date is the one in the answer block's first line, or the doc's `updated`. `--who` takes
`accepted`, `overrode` or `owner`. Add `--expect` and `--review` only if the owner gives them.

## Rules

*Updated automatically when the owner flags issues. Read before every run.*

- 2026-09-17: **Answers must be written somewhere durable the instant they are made** — the artifact
  store, or `localStorage`, or both. A page that held them in page memory only lost every marked row
  when a republish reloaded the tab. There is no Submit button that saves this: a page that batches
  answers until the end loses them at the end.
- 2026-09-17: **Never pre-select a default choice on any control.** An unset control reads as a
  question; a set one reads as a suggestion the owner would have to argue with.
- 2026-09-17: **When answers arrive as a screenshot, name the rows you could not read.** Guessing
  records a verdict the owner never gave.
- 2026-09-17: **Keep the source's own ids.** The owner takes answers back to the source file by hand.
- 2026-09-18: **Never build a page the owner did not ask for.** Do not fire on your own read that a
  plan carries more than about five decisions: offer in one line, build on a yes.
- 2026-10-04: **A backlog-sized page is slides: one item per slide, grouped by what it touches.**
  The first 0.1.5 release page grouped rows by where they came from (bugs, a tester's report,
  release blockers) and packed each as a dense card; the owner found none of it clear. What worked
  instead: areas that mean something to a user (installing and updating, routines, memory...), an
  area intro slide, then each item as Today / Why it matters / The fix in plain words, with arrow
  keys moving slide to slide and a contents overlay that keeps the whole shape one keypress away.
  (The row count this rule started at, about fifteen, is replaced by the 2026-11-22 rule: slides
  for every page. Its grouping and its Today / Why it matters / The fix shape still hold.)
- 2026-11-22: **Every decision page is slides, whatever the number of rows, and it opens with the
  thing itself.** The owner answered a ten-row page built as one long page that opened with a
  diagram of where each of the owner's notes had landed. The verdict: "not clear", "hard to
  navigate", "I need slides to go right or left", a wish to "see how my answers are evolving", and
  an opening that "has a useless visual. It needs to be a better explanation with a correct
  visual". So: one
  decision per slide, moved left and right; the strip and the answers slide show the answers
  building up; the first slide explains the situation with a visual of the thing being decided (the
  screen, the before and after), never a map of the page's own items or a decorative diagram. This
  replaces "every decision is visible at rest": the strip and the answers slide are what keep the
  whole shape in view. `assets/slides.html` is that page, and the checker faults a page not built
  from it.

## Self-Update

If the owner flags an issue with a page or with how answers came back — a control they could not
find, a row they could not understand, answers that went missing, a lane that did not fit their
surface — add the correction and the reason, dated, to the brain's `.claude/CLAUDE.md` under
`## This brain's rules`, now and not at wrap-up: a lost answer is a hard failure of this skill's one
job, and that file is read at the start of every session. Do not edit this skill: a plugin update
replaces it.

## Graceful Degradation

- **No Artifact tool** → file lane, always. It is a first-class path, not a consolation.
- **No project owns the page** → ask which one does; if none, the session's scratchpad or temp
  directory. Say which path you chose.
- **`claude.use("db")` resolves null at runtime** → the page says "saved in this browser only" in
  its own status line and keeps working through `localStorage`. Never fail silently: a page that
  looks saved and is not is the exact failure this skill exists to prevent.
- **Source has no per-row cost or status** → leave `data-cost` and `data-unit` out, and the tally
  stays hidden, rather than inventing estimates. A fabricated total is worse than no total, because
  the owner will decide against it.
- **Nothing visible to draw for the opening** → draw the real steps a person goes through, or the
  real numbers as a chart. If there is truly neither, say so to the owner before building: a page
  with nothing to show is usually a question for chat.
- **The page's script does not run** (a mail preview, a print) → the template shows every slide in
  order as one long page, and says it cannot save.
- **Too few decisions to earn a page** → say so and ask in chat instead.
- **No `node` on the box** → walk Step 6's list by hand against the page source, and say in the
  handoff that the checker did not run.

## What was deliberately left out

From the author's earlier kit, so a later session does not bring it back as an improvement:

- **Firing on answer length.** Its core trigger is "any long answer becomes a page". Refused: this
  skill is manual only.
- **A pasted CSS charter, and refusing to build without it.** `design` owns the visual
  system here and travels with the install; a second frozen palette would fork it.
- **A four-question first-run interview** (charter, language, output folder, ending section).
  `SOUL.md`, `USER.md` and the output-path rule already answer all four, and a new install is
  `onboarding`'s job.
- **Opening the page in a browser after writing it.** Cogby runs headless and remote as often as
  not; the `output/` path is the delivery surface.
- **A Python checker.** Ported to Node instead: this repo has no Python dependency and is not
  acquiring one for a linter.
