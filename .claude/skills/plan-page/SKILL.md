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

**The page is not a document with radio buttons bolted on.** It is a strategy-consulting brief the
owner can answer: MECE, the diagram carries the argument, every technical term defined where it
appears, the fewest words that carry the full detail. That format half of this skill comes from an
earlier kit of the author's own; what was kept and what was deliberately left behind is at the
bottom of this file, so a later session does not bring the rest back.

## Outcome

- **One HTML decision page**, saved to the `output/` of the project it belongs to
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
| `assets/decision-kit.js` | read before building | The persistence and copy-back code, identical every run |
| `assets/check-page.cjs` | run before handoff | Mechanical faults, non-zero exit. See Step 6 |
| `cogby map` | run | Finding the project that owns this subject |

## Step 0: Read the before/after, once per session

**Before your first page of the session, read `assets/before-after.html` in full.** Not "if there is
budget", not "if unsure": in full, first.

The hard part of this format is the dose. Every rule below can be followed to the letter and still
produce a page that is three paragraphs per row wearing a diagram as a hat. The dose is not
derivable from a rule, it is only visible in an example: that file takes one real Cogby backlog row
written the ordinary way and writes it again at format, with the word count on both. The earlier kit
made this read mandatory after a blind test caught a session skipping it to save budget while
calling it the most useful file it had.

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

Where a row's state is genuinely unknown, say so on the row rather than giving it a confident line.

**Every technical term gets a definition where it first appears**, in a box on the row that uses it:
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

Both lanes emit the same answer block (Step 8). Read `assets/decision-kit.js` and use it as written
— it is the same code every time, and the one part of this that has already failed in production.

## Step 4: Build the page

Invoke `design` for the visual system: this skill deliberately holds no opinion about
palette or type, because a decision page for a client proposal and one for an engineering backlog
should not look alike.

### The format, in one line

**A strategy-consulting brief, ultra vulgarized, MECE, visual, with the fewest possible words.**

The contresens that kills it: **few words does not mean less detail.** The numbers, the edge cases,
the traps and the exceptions are all there, in full. They travel in diagrams, tables and short boxes
instead of paragraphs. A good page is dense in information and poor in sentences. A six-row table
says more than a six-line paragraph and reads in two seconds.

### The five mechanics

| Mechanic | The test |
|---|---|
| **The diagram carries the argument, the sentence confirms it** | remove every paragraph and the page still tells the story. If a paragraph says what the diagram already shows, the paragraph goes |
| **Every section title asserts a conclusion** | someone who reads only the titles leaves with the whole argument. "Two mechanisms, and only two", never "The caching mechanisms" |
| **MECE** | no two blocks saying the same thing from different angles, and no "and other items" bucket at the end. A MECE split has no bin |
| **Terms defined on the spot** | a reader who does not know the domain gets through without opening anything else |
| **Few words, full detail** | the detail is all present, carried by the visual |

Diagrams are **inline SVG written by hand**, with `viewBox`, `role="img"` and an `aria-label`. No
chart library: one more curve does not justify 300 KB of dependency, and a remote script breaks the
"opens with no network" rule below.

### The cards at the top

Open with **3 to 5 cards**: a label, the value large, and two lines saying what to conclude. The
owner must be able to stop there and have the shape of the decision.

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

### The mechanics that are not taste

- **Every decision is visible at rest.** No accordion hiding rows, no scroll-triggered reveal. The
  owner needs to see the whole shape to weigh any part of it.
- **Every control starts unset.** A pre-selected default is your opinion wearing the owner's hat,
  and they will accept it by not noticing. A recommendation is allowed, but as a marked and labelled
  option, never as a pre-checked one.
- **Every recommendation is passed to the kit**: `DecisionKit({ slug, recommended: { T3: "keep", M6: "cut" } })`,
  the row id and the value of the option you marked. It comes back with the answers, and it is the
  only way Step 9 can tell a recommendation taken from one chosen against. A row you recommend
  nothing on has no entry.
- **Every interaction saves immediately**, not on a Submit at the end. See `## Rules`.
- **A running tally** of answered, unanswered, and whatever the decision actually buys: days of
  work, cost, headcount. The tally is what turns a list into a decision.
- **Grouped the way the source groups them**, with the group's own framing kept, so the owner's
  mental model of the work survives the trip into the page.
- **Zero remote resources.** No CDN, no web font, no linked image. The page must open with no
  network, from a USB stick, in ten years. Inline everything, including `decision-kit.js`.
- **Wide tables scroll inside their own container**, never the page body.
- **No em dash or en dash anywhere in the page.** Use colons and commas. This is this skill's own
  style rule, and the checker faults any dash in reader-visible text.

## Step 5: Close with "How this was reached"

**Every page that recommends anything ends with this section, last, always.** Three parts, in order:

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
inlined, template markers left in, a decision with no control. **Fix every FAULT before handing the
page over.**

It knows nothing about the half that matters: whether a term is defined in the right place, whether
the split is really MECE, whether a title asserts anything. That gets re-read by you, against the
five mechanics above.

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

**Screenshot:** a valid input, and often what actually arrives. Read the marks off it, then write
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
  This overrides "every decision visible at rest" once a page carries more than about fifteen rows.

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
- **Source has no per-row cost or status** → drop the tally's derived number rather than inventing
  estimates. A fabricated total is worse than no total, because the owner will decide against it.
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
