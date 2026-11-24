---
name: design
description: Apply the owner's design system to anything a person will look at, so it reads as one coherent product instead of default styling. Use whenever building or styling a web page, landing page, dashboard, report, one-pager, email, slide or UI mockup, even when the request never mentions design. Also on "apply the design system", "use my design system", "style this", "make this look good", "make it not boring". Called by plan-page for how its pages look. NOT for cleaning up prose (clean-writing), NOT for writing a new design system from a reference, and NOT for the command center page, whose look is fixed.
---

# Design: one look, loaded before you build

The value of this skill is the constraint: read the system before generating, and check the result
against its don'ts after.

## Step 1: Load the system

1. **The owner's own:** `.cogby/design-system.md` in the brain. If it exists, it is the system.
2. **Otherwise the default:** `systems/main.md` in this skill's folder (`${CLAUDE_SKILL_DIR}/systems/main.md`).

Read the chosen file in full: tokens, type, spacing, components, do and don't. Say in one line
which one you loaded.

The owner wants their own look: offer to start `.cogby/design-system.md` from the default and
change it with them. Never edit the file in this skill's folder: a plugin update replaces it.

## Step 2: Build

- Declare the tokens as CSS custom properties on `:root` and use them by name. No inline hex, no
  guessed pixel values: use the spacing steps and the radius scale.
- Reach for the documented components before inventing a layout.
- Support light and dark when the system defines both.

## Step 3: Check, then say so

Re-read the output against the system's don'ts and the rules below. Fix every violation. State in
one line that the check passed, and name anything you chose to diverge on and why. Do not skip this.

## Step 4: Output

A single self-contained HTML file unless asked otherwise: tokens in `:root`, no CSS framework. A
deliverable for a project goes in that project's `output/` folder in the brain.

When the caller needs a page that opens with no network (as `plan-page` does), load no fonts and no
remote files: use the system's fallback font stacks and inline everything.

Another target (React, Tailwind, a fragment) is fine when asked; the rules still apply.

## Rules

- The loaded system is the source of truth. Do not blend in another.
- Reusable values are tokens, never scattered literals.
- One primary action per view.
- Decoration stays below content.
- Finished states only: no placeholder copy, no dead links.
- This skill applies a system. It does not invent one.

## When something is missing

- **Neither file can be read:** say so, and build with plain, legible defaults instead of guessing a brand.
- **The request is not visual** (a script, a data file, prose): this skill does not apply.
