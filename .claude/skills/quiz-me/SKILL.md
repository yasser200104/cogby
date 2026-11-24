---
name: quiz-me
description: Quiz the owner on what their own brain holds. One card, one question to a page, the answer and its page shown as soon as they commit, a second try at what they missed. MANUAL ONLY. Fires on "quiz me", "quiz me on <project or topic>", "test me on…", "what do I still remember about…", the "Quiz me on this" button of a picture, or /quiz-me (the old /quiz). Also fires on the return leg, when the owner sends back "My quiz on…" with how it went. Never on your own judgement that the owner should be tested. Reads only; it writes nothing unless the owner says a fact has changed or asks to be quizzed again later. NOT a general-knowledge quiz on something the brain does not hold, NOT for what needs the owner (check-in), and NOT for filing one thing (capture).
---

# Quiz me: keep what your brain knows in your own head

The brain remembers so the owner does not have to repeat themselves. It is not there so they stop
knowing their own work. A quiz makes them pull an answer out of their own memory before they see
what the brain holds. A wrong answer is useful twice: either the owner forgot, or the brain is out
of date.

Four things make a quiz work, and the card does them. Keep to them in text too.

- **Recall before reveal.** Pulling an answer from memory is what strengthens it; rereading does not.
- **Say how sure you are first.** A mistake made with confidence, then corrected, is the one best
  remembered. It also shows the owner where their picture of the work is wrong, not just thin.
- **Mix the questions.** Some with options, some with none.
- **Bring back what was missed.** Once before the quiz ends, and again some days later.

## Step 1: What to quiz on

- **The owner named it** (a project, a person, an area, a topic): use that.
- **They did not:** offer the two or three projects with the newest evidence, and ask which. Once.

## Step 2: Read the brain

`search` the topic and open the best hits at the `file` each names: the card, the facts
table and the newest timeline lines. From these pick **five** things worth knowing by heart:

- a decision and why it was taken; a date or a deadline; a number (a price, a budget, a count);
- who owes what to whom; what is blocked and on what; what changed most recently.

Each one must be a sourced fact or a dated timeline line, and not superseded. Skip trivia (a file
name, the wording of a note) and never ask for a secret. Fewer than three such facts: say the brain
holds too little on this to quiz on, and stop.

A page with no new evidence in 14 days is stale. You may still ask from it: put "stale" after the
page in `source`. It is the likeliest place for "that has changed".

## Step 3: Write the questions

- **Three with options, two without.** A what, when, who or how much takes three or four options.
  A why or a what-next takes none: the owner answers in their head, then says whether they had it.
- **Wrong options are plausible** and come from the same pages: another date in the timeline,
  another person on the project, the number before it changed. Never a joke option.
- **Start with the easiest.** Put the two that matter most in the middle.
- **Ask about the work, not the page.** "Why did we drop the second vendor?" and not "What does
  the card say about vendors?"
- `answer` is the text of the right option, or the answer in one line. `why` is one line of
  context: the reason behind it, what depends on it. `source` is the page.

## Step 4: Show the quiz

**Where this session can show an inline visual** (a `show_widget`-style tool): call the `card` tool
once with the name `quiz` and show the `html` it returns, exactly as returned. Its `data`, exactly:

```json
{"topic": "Acme migration", "questions": [
  {"question": "When is cutover?", "options": ["12 March", "30 April", "2 December"], "answer": "2 December", "why": "<one line>", "source": "projects/acme-migration/card"},
  {"question": "Why did we drop the second vendor?", "answer": "<the answer in one line>", "why": "<one line>", "source": "<the page>"}]}
```

One to seven `questions`. With `options` (two to four), exactly one must be the same text as
`answer`, or the card is refused. Leave `options` out for an answer recalled unaided. The card runs the whole quiz:
the owner answers, says how sure they are, sees the answer and its page, presses Continue, gets a
second try at what they missed, and presses Finish. Add no text after the card, and no answers.

**Where it cannot,** run it in chat, one question to a message: ask, wait, ask how sure they are,
then give the answer, the one-line why and the page. Ask the missed ones again at the end.

## Step 5: When the results come back

The card sends one message: "My quiz on <topic>: 3 of 5 right the first time", then what was
missed and how (was sure, wrong, did not know, right on the second try), what was right only by
guessing, and what the owner says has changed. Answer in five lines or fewer:

- **Was sure, and wrong** comes first. Say what the brain holds and the page to reread.
- **Did not know** and **right by guessing** are the same thing: not known yet. Name the page.
- Say nothing about what they got right, beyond the score.

Never soften a miss, and never turn a guess into knowledge.

## Step 6: "My brain is out of date on…"

The owner is telling you the brain is wrong. For each such question, ask what is true now and how
they know. Then write the evidence, never the summary: the `remember` tool with the new claim, its
`source`, and `replaces` set to the old fact; or the `log` tool for something that happened.
Confirm in one line.

## Step 7: Bring it back later

If anything was missed, offer once: *"Want these back in three days?"* On a yes, call the `todo`
tool (`add`) with the text "Quiz me again on <topic>: <the missed questions, shortened>" and a due
day three days out. The check-in will show it. Nothing else about a quiz is stored: it is practice,
not a record.

## Rules

- The brain is the only source of questions. Nothing from your own knowledge, nothing guessed.
- In chat, the answer never travels with the question.
- Nothing is written unless the owner says a fact has changed or asks for the quiz to come back.

## When something is missing

- **No brain tools in this session:** say the brain is not reachable here, and stop.
- **The topic is not in the brain:** say so, and offer the nearest thing that is.
