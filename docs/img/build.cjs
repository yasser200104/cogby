#!/usr/bin/env node
// The pictures on the README, drawn from one source in Cogby's default design system
// (.claude/skills/design/systems/main.md): the same tokens, light and dark. GitHub shows an image
// with no network, so the fonts are the system's fallback stacks and nothing is loaded.
//   node docs/img/build.cjs      writes <name>-light.svg and <name>-dark.svg beside this file
const fs = require('fs');
const path = require('path');

const TOKENS = {
  light: { canvasSoft: '#f7f7f5', card: '#ffffff', ink: '#191634', body: '#3d3663', muted: '#5c5486', accent: '#5940a4', hairline: 'rgba(55,36,118,.16)', hairlineStrong: 'rgba(55,36,118,.28)', success: '#16a34a', warn: '#b45309' },
  dark: { canvasSoft: '#0D0B24', card: '#161134', ink: '#EDEAFF', body: '#C2BBEE', muted: '#A9A2DC', accent: '#9C8BF0', hairline: 'rgba(180,165,255,.16)', hairlineStrong: 'rgba(180,165,255,.32)', success: '#4ADE80', warn: '#FBBF24' },
};
const SANS = "'IBM Plex Sans',-apple-system,'Segoe UI',sans-serif";
const SERIF = "'IBM Plex Serif',Georgia,serif";
const MONO = "'IBM Plex Mono',ui-monospace,Consolas,monospace";

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const t = (x, y, cls, s) => `<text x="${x}" y="${y}" class="${cls}">${esc(s)}</text>`;
const card = (x, y, w, h) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="8" class="card"/>`;
const rule = (x1, y, x2) => `<line x1="${x1}" y1="${y}" x2="${x2}" y2="${y}" class="rule"/>`;
// A callout: the soft band with the accent bar on its left.
const callout = (x, y, w, s) => `<rect x="${x}" y="${y}" width="${w}" height="40" class="soft"/><rect x="${x}" y="${y}" width="3" height="40" class="bar"/>${t(x + 16, y + 25, 'b', s)}`;

// The Cogby mark. Its colours are its own, as on My view.
const mark = (x, y, size) => {
  const tooth = [0, 45, 90, 135, 180, 225, 270, 315].map((a) => `<rect x="-11" y="-59" width="22" height="26" rx="9" transform="rotate(${a})"/>`).join('');
  return `<g transform="translate(${x + size / 2} ${y + size / 2}) scale(${size / 151.3})"><g fill="#9670E0">${tooth}<circle r="41"/></g>`
    + '<rect x="-24" y="-12" width="14" height="22" rx="7" fill="#1D1430"/><rect x="10" y="-12" width="14" height="22" rx="7" fill="#1D1430"/>'
    + '<circle cx="-19.6" cy="-6.4" r="2.9" fill="#FFFFFF"/><circle cx="14.4" cy="-6.4" r="2.9" fill="#FFFFFF"/>'
    + '<path d="M -9 20 q 9 9 18 0" fill="none" stroke="#1D1430" stroke-width="4" stroke-linecap="round"/></g>';
};

const svg = (theme, w, h, title, body) => {
  const c = TOKENS[theme];
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" role="img" aria-label="${esc(title)}">
<title>${esc(title)}</title>
<style>
svg{--canvas-soft:${c.canvasSoft};--surface-card:${c.card};--ink:${c.ink};--body:${c.body};--muted:${c.muted};--accent:${c.accent};--hairline:${c.hairline};--hairline-strong:${c.hairlineStrong};--success:${c.success};--warn:${c.warn}}
text{font-family:${SANS};font-size:15px;fill:var(--body)}
.brand{font-family:'Rubik',${SANS};font-size:30px;font-weight:600;fill:var(--ink);letter-spacing:-.035em}
.hero{font-size:40px;font-weight:600;fill:var(--ink);letter-spacing:-.01em}
.h{font-size:16px;font-weight:600;fill:var(--ink);letter-spacing:-.01em}
.lead{font-size:17px;fill:var(--body)}
.q{font-family:${SERIF};font-size:17px;fill:var(--ink)}
.b{font-size:14.5px;fill:var(--body)}
.i{font-size:14.5px;fill:var(--ink)}
.l{font-size:11.5px;font-weight:600;letter-spacing:.06em;fill:var(--muted)}
.m{font-family:${MONO};font-size:12.5px;fill:var(--muted)}
.mi{font-family:${MONO};font-size:12.5px;fill:var(--ink)}
.mb{font-family:${MONO};font-size:12.5px;fill:var(--ink);font-weight:600}
.ma{font-family:${MONO};font-size:12.5px;fill:var(--accent)}
.card{fill:var(--surface-card);stroke:var(--hairline);stroke-width:1}
.soft{fill:var(--canvas-soft)}
.bar{fill:var(--accent)}
.rule{stroke:var(--hairline);stroke-width:1}
.ok{fill:var(--success)}
.wait{fill:var(--warn)}
</style>
${body}
</svg>
`;
};

// 1. The top of the page: the name, the line, and what a session opens on.
const hero = () => [
  mark(0, 8, 52), t(64, 45, 'brand', 'Cogby'),
  t(0, 124, 'hero', 'It remembers, you decide.'),
  t(0, 164, 'lead', 'A context manager for Claude Code. What you know and'),
  t(0, 188, 'lead', 'what you are working on, kept in a folder you own.'),
  card(561, 9, 398, 222),
  '<circle cx="585" cy="37" r="4" class="ok"/>', t(597, 41, 'l', 'A SESSION STARTS'),
  t(581, 72, 'mi', 'Brain: ~/brain (214 pages)'),
  rule(581, 88, 939),
  t(581, 112, 'mb', 'projects/acme'),
  t(581, 136, 'm', 'Now'), t(661, 136, 'mi', 'UAT starts 18 Nov'),
  t(581, 158, 'm', 'Decided'), t(661, 158, 'mi', 'go live in January, 6 Nov'),
  t(661, 178, 'ma', 'you overrode Claude'),
  rule(581, 194, 939),
  t(581, 216, 'm', 'Waiting on you: 3 to-dos, 1 decision due'),
].join('\n');

// 2. The same request with and without a context system.
const twice = () => {
  const side = (x, label, dot, answer, source, close) => [
    card(x, 1, 466, 268),
    `<circle cx="${x + 24}" cy="29" r="4" class="${dot}"/>`, t(x + 36, 33, 'l', label),
    t(x + 20, 68, 'l', 'YOU'), t(x + 20, 90, 'i', "Draft this week's update for Acme."),
    t(x + 20, 124, 'l', 'CLAUDE'), ...answer.map((s, n) => t(x + 20, 146 + n * 21, 'b', s)),
    source ? t(x + 20, 146 + answer.length * 21 + 6, 'm', source) : '',
    callout(x + 20, 212, 426, close),
  ].join('\n');
  return [
    side(1, 'WITHOUT A CONTEXT SYSTEM', 'wait', ['Sure. Which client is this, what was agreed with', 'them, and where does the project stand today?'], '', 'You explain it again. Every session starts from zero.'),
    side(493, 'WITH COGBY', 'ok', ['Done. UAT starts 18 Nov. I kept the January go-live', 'you decided on 6 Nov.'], 'read projects/acme/card: 2 facts, 1 decision', 'It starts from your files. You only correct.'),
  ].join('\n');
};

// 3. One real page: the summary above the timeline mark, the evidence below it.
const page = () => {
  const note = (y, label, a, b) => [t(640, y, 'l', label), t(640, y + 22, 'b', a), t(640, y + 43, 'b', b)].join('\n');
  return [
    card(1, 1, 606, 398),
    t(21, 31, 'm', 'projects/acme/card.md'),
    rule(21, 44, 587),
    t(21, 72, 'mb', '# acme'),
    t(21, 94, 'mi', 'Move Acme to the new billing provider before the January audit.'),
    t(21, 126, 'mb', '## Now'),
    t(21, 148, 'mi', "- UAT with the client's finance team"),
    t(21, 180, 'mb', '## Facts'),
    t(21, 202, 'mi', '| UAT starts 18 Nov | meeting 2026-11-05 | dana · confirmed |'),
    rule(21, 226, 240), t(252, 230, 'ma', '<!-- timeline -->'), rule(388, 226, 587),
    t(21, 262, 'mi', '- **2026-11-05** | Meeting — UAT moved to 18 Nov'),
    t(37, 283, 'm', '[dana · human · confirmed]'),
    t(21, 315, 'mi', '- **2026-11-06** | call with Sara — decision: go live in January,'),
    t(37, 336, 'mi', 'not December: the audit comes first (who: overrode)'),
    t(37, 357, 'm', '[dana · agent claude-code · unconfirmed]'),
    note(60, 'THE CURRENT TRUTH', 'The summary to act from, and a table', 'of facts. Every fact names its source.'),
    rule(640, 136, 959),
    note(166, 'THE EVIDENCE', 'Dated lines under the timeline mark.', 'Nothing is deleted or rewritten.'),
    rule(640, 242, 959),
    note(272, 'WHO MADE THE CALL', 'A decision says if it was yours,', "Claude's suggestion, or your override."),
    rule(640, 348, 959),
    t(640, 378, 'b', 'What an agent wrote stays marked.'),
  ].join('\n');
};

// 4. The brain is a folder: it goes where the work goes.
const travels = () => {
  const row = (y, name, what) => [t(21, y, 'mi', name), t(150, y, 'b', what)].join('\n');
  const point = (y, head, a, b) => [t(500, y, 'h', head), t(500, y + 24, 'b', a), t(500, y + 45, 'b', b)].join('\n');
  return [
    card(1, 1, 446, 278),
    t(21, 31, 'l', 'YOUR BRAIN'), rule(21, 44, 427),
    t(21, 72, 'mb', 'brain/'),
    row(100, '  projects/', 'active work, one card each'),
    row(126, '  areas/', 'standing responsibilities'),
    row(152, '  resources/', 'reference, found by search'),
    row(178, '  archive/', 'done, kept for the record'),
    row(204, '  AGENTS.md', 'the rules an agent works by'),
    row(230, '  .cogby/self/', 'who you are, how to work for you'),
    t(21, 260, 'm', 'markdown files, in their own git repository'),
    point(40, 'Every folder', 'Installed once. A session in any folder knows where', 'the brain is, and what that folder is to it.'),
    rule(500, 104, 959),
    point(134, 'Every machine', 'The brain is its own git repository. Push it, pull it,', 'and it is the same brain on the next computer.'),
    rule(500, 198, 959),
    point(228, 'Not tied to one tool', 'Plain markdown and one command line. The plugin is', 'for Claude Code today; the files stay readable anywhere.'),
  ].join('\n').replace(/class="mi">  /g, 'class="mi" xml:space="preserve">  ');
};

const PICTURES = [
  ['hero', 960, 240, 'Cogby. It remembers, you decide. A session starts by reading your brain: the project, what is in flight, what you decided, and what waits on you.', hero],
  ['twice', 960, 270, 'The same request twice. Without a context system Claude asks you to explain the project again. With Cogby it answers from your files and names what it read.', twice],
  ['page', 960, 400, 'A page in a brain: the summary and sourced facts above the timeline mark, dated evidence below it, each line saying who wrote it and who made the call.', page],
  ['travels', 960, 280, 'The brain is a folder of markdown in its own git repository. It works from every folder, moves to every machine, and is not tied to one tool.', travels],
];

for (const [name, w, h, title, draw] of PICTURES) {
  for (const theme of ['light', 'dark']) fs.writeFileSync(path.join(__dirname, `${name}-${theme}.svg`), svg(theme, w, h, title, draw()));
}
console.log(`wrote ${PICTURES.length * 2} pictures to ${path.relative(process.cwd(), __dirname) || '.'}`);
