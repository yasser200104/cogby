#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { forRoot: R } = require('../../core/lib/paths.cjs');
const { rootsFrom } = require('../../core/lib/locate.cjs');
const headless = require('../../core/lib/headless.cjs');

const MAX_POINTERS = 5;
const MAX_CHARS = 400;
const MAX_CANDIDATES = 60;
const SEEN_TTL_MS = 7 * 24 * 60 * 60 * 1000; // prune a session's seen-set after a week

const STOP = new Set(`the a an and or but if then than that this these those there here of in on at
to for with from by about into over after before under above is are was were be been being do does
did done have has had can could should would will shall may might must i you he she it we they me
him her them my your his its our their what which who whom whose when where why how all any both
each few more most other some such no nor not only own same so too very just now also
please make made get got give gave take took go went come came see saw look looked want wanted
need needed try tried use used run ran fix fixed add added check checked read write wrote tell told
say said know knew think thought file files folder note notes card progress output task tasks goal
goals project projects area areas skill skills hook hooks session sessions today yesterday tomorrow
week month year time day days thing things stuff work working done ok okay yes yeah nope`
  .split(/\s+/).filter(Boolean));

function bail() { process.exit(0); }

let input = '';
const stdinTimeout = setTimeout(bail, 3000);
process.stdin.setEncoding('utf8');
process.stdin.on('data', (c) => (input += c));
process.stdin.on('end', () => {
  clearTimeout(stdinTimeout);
  try { main(); } catch { /* fail-open */ }
  process.exit(0);
});

function main() {
  let data = {};
  try { data = JSON.parse(input || '{}'); } catch { return; }

  const cwd = data.cwd || process.env.CLAUDE_PROJECT_DIR || process.cwd();
  // `root` is the substrate this prompt is matched against; the dashboard's resolver is engine code.
  const { engine, brain: root, inTree } = rootsFrom(cwd);
  if (!inTree) return;

  // Induction runs later, in another process, from the transcript alone: the env this hook sees
  // is gone by then, so a session that must open no goal says so here, where the sweep reads it.
  const flags = headless.flagsFrom(process.env);
  if (!flags.induct) headless.markSession(root, data.session_id);
  if (!flags.pointers) return;

  const prompt = String(data.prompt || '').trim();
  if (!prompt || prompt.startsWith('/')) return; // slash commands carry their own instructions

  const candidates = candidatesFrom(prompt);
  if (!candidates.length) return;

  // The resolver is core's own, beside this hook: it needs no Console on the machine.
  let results = [];
  try {
    results = require('../../core/lib/graph-scan.cjs').resolveMany(root, candidates, { archive: false });
  } catch { return; }

  const seen = loadSeen(root, data.session_id);
  const pointers = [];
  for (const r of results) {
    if (!r || !r.resolved) continue;                       // unresolved or ambiguous → silence
    const p = pointerFor(r.resolved);
    if (seen.has(p) || pointers.includes(p)) continue;
    pointers.push(p);
    if (pointers.length >= MAX_POINTERS) break;
  }
  if (!pointers.length) return;

  let line = `Named in that ask: ${pointers.join(' · ')}`;
  if (line.length > MAX_CHARS) {
    while (pointers.length > 1 && `Named in that ask: ${pointers.join(' · ')}`.length > MAX_CHARS) pointers.pop();
    line = `Named in that ask: ${pointers.join(' · ')}`;
    if (line.length > MAX_CHARS) return;
  }

  saveSeen(root, data.session_id, seen, pointers);
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'UserPromptSubmit',
      additionalContext: `${line} — paths only; read what is relevant (a folder means its card.md).`,
    },
  }));
}

function pointerFor(rel) {
  return /\/card\.md$/i.test(rel) ? rel.replace(/card\.md$/i, '') : rel;
}

function candidatesFrom(prompt) {
  const text = String(prompt)
    .replace(/```[\s\S]*?```/g, ' ')      // fenced code is not a claim about the substrate
    .replace(/`[^`]*`/g, ' ')             // inline code: usually a path the owner already knows
    .replace(/\b[\w./-]+\.(?:md|cjs|mjs|js|json|html|png|pdf)\b/gi, ' ') // an explicit path needs no pointer
    .toLowerCase();

  const words = (text.match(/[a-z][a-z0-9'-]+/g) || []).map((w) => w.replace(/^'+|'+$/g, ''));
  const keep = words.filter((w) => w.length >= 2 && !STOP.has(w));

  const out = new Set();
  for (const w of keep) out.add(w);                          // single tokens
  for (let i = 0; i < keep.length - 1; i++) {                // adjacent pairs and triples, hyphenated
    out.add(`${keep[i]}-${keep[i + 1]}`);
    if (i < keep.length - 2) out.add(`${keep[i]}-${keep[i + 1]}-${keep[i + 2]}`);
  }
  return [...out]
    .sort((a, b) => b.length - a.length)
    .slice(0, MAX_CANDIDATES);
}

function seenPath(root, sessionId) {
  const id = String(sessionId || '').replace(/[^a-zA-Z0-9-]/g, '').slice(0, 36);
  if (!id) return null;
  return R(root).ctx('self', '.gateway', 'pointers', `${id}.json`);
}

function loadSeen(root, sessionId) {
  const p = seenPath(root, sessionId);
  if (!p) return new Set();
  try { return new Set(JSON.parse(fs.readFileSync(p, 'utf8'))); } catch { return new Set(); }
}

function saveSeen(root, sessionId, seen, added) {
  const p = seenPath(root, sessionId);
  if (!p) return;
  try {
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, JSON.stringify([...seen, ...added]));
    pruneSeen(path.dirname(p));
  } catch { /* fail-open */ }
}

function pruneSeen(dir) {
  try {
    const now = Date.now();
    for (const f of fs.readdirSync(dir)) {
      const fp = path.join(dir, f);
      if (now - fs.statSync(fp).mtimeMs > SEEN_TTL_MS) fs.rmSync(fp, { force: true });
    }
  } catch { /* fail-open */ }
}
