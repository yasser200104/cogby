# Cogby design system (the default)

The look of Cogby's own My view: white paper, deep violet ink, hairlines instead of boxes, small
corners, one accent. Used when the brain has no design system of its own (`.cogby/design-system.md`).

## Tokens

Declare these as CSS custom properties on `:root` and use them by name. Never an inline hex.

| Token | Light | Dark | Use |
|---|---|---|---|
| `--canvas` | `#ffffff` | `#08071A` | page background |
| `--canvas-soft` | `#f7f7f5` | `#0D0B24` | a quieter band |
| `--surface-card` | `#ffffff` | `#161134` | cards, inputs |
| `--surface-strong` | `#efefed` | `#1E1745` | selected, pressed, table heads |
| `--ink` | `#191634` | `#EDEAFF` | headings, the one number that matters |
| `--body` | `#3d3663` | `#C2BBEE` | running text |
| `--muted` | `#5c5486` | `#A9A2DC` | labels, captions, metadata |
| `--primary` | `#372476` | `#9C8BF0` | the primary action, links |
| `--accent` | `#5940a4` | `#9C8BF0` | focus rings, the active tab |
| `--on-primary` | `#ffffff` | `#0A0820` | text on a primary fill |
| `--hairline` | `rgba(55,36,118,.16)` | `rgba(180,165,255,.16)` | every border and divider |
| `--hairline-strong` | `rgba(55,36,118,.28)` | `rgba(180,165,255,.32)` | a border that must be seen |
| `--success` / `--warn` / `--error` | `#16a34a` / `#b45309` / `#a8386e` | `#4ADE80` / `#FBBF24` / `#F0789F` | state, as text or a dot |
| `--shadow` | `0 4px 16px rgba(25,22,52,.06)` | `0 4px 20px rgba(0,0,0,.45)` | a raised card only |

Dark is the same token names redefined under `@media (prefers-color-scheme: dark)`. Support both.

## Type

| Role | Family | Size / weight |
|---|---|---|
| Body | `'IBM Plex Sans', -apple-system, 'Segoe UI', sans-serif` | 15px / 1.5, 400 |
| Headings | the same sans | 26 / 20 / 16px, 600, colour `--ink`, tracking `-0.01em` |
| A pull quote or a summary line | `'IBM Plex Serif', Georgia, serif` | 17px, 400 |
| Numbers, ids, code, timestamps | `'IBM Plex Mono', ui-monospace, Consolas, monospace` | 12.5px |
| Labels above a group | the sans | 11.5px, 600, uppercase, tracking `.06em`, colour `--muted` |

Three sizes of heading and no more. When the page must open with no network, use the fallback
stacks only and load no font.

## Space and shape

- Spacing steps: 4, 8, 12, 16, 24, 40, 64. Nothing in between.
- Page: one column, `max-width: 1080px`, 20px side padding, 24px between sections.
- Radius: small, as on My view: 4px (inputs), 6px (buttons, chips, pills), 8px (cards and panels). Dots
  and round ticks stay round.
- Borders are 1px `--hairline`. A card is a surface and a hairline; it has a shadow only when it floats.

## Components

- **Card:** `--surface-card`, 1px hairline, 8px radius, 16px padding. Title in `--ink` 600, one line
  of `--muted` metadata under it.
- **Primary button:** `--primary` fill, `--on-primary` text, 6px radius, 8px by 14px padding, 600.
  One per view. Every other action is a quiet button: transparent, hairline border, `--ink` text.
- **Pill:** 12.5px, 4px by 11px padding, 6px radius, hairline border. For a date, a count, a state.
- **Status dot:** an 8px circle beside text. Colour says the state; the text says it too.
- **Tabs:** text with a 2px underline in `--accent` when on. Not boxes.
- **Table:** no vertical rules, a hairline under each row, head row in the label style.
- **Callout:** a 3px left border in `--accent`, `--canvas-soft` behind, no icon.
- **Empty state:** one `--muted` sentence saying what would appear here. No illustration.

## Do

- Let the paper show: generous margins, few boxes, hairlines.
- Put the one thing the reader must see first, in `--ink`, larger than everything around it.
- Use colour for meaning only: the primary action, a state, a link.
- Keep text contrast at 4.5:1 or better, and a 44px touch target on a phone.

## Don't

- No gradients, no glass, no glow, no drop shadows on flat content.
- No emoji as icons, and no icon without a text label.
- No second accent colour, and no coloured card backgrounds to tell sections apart.
- No centred body text, and no all-caps beyond the small group labels.
- No placeholder copy, no dead links, no "Lorem ipsum".
