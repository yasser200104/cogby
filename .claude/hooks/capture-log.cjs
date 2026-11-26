#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { redact } = require(path.join(__dirname, '..', '..', 'core', 'lib', 'redact.cjs'));
const { forRoot: R } = require(path.join(__dirname, '..', '..', 'core', 'lib', 'paths.cjs'));
const { flagsFrom } = require(path.join(__dirname, '..', '..', 'core', 'lib', 'headless.cjs'));
const { rootsFrom, crossesPrivate } = require(path.join(__dirname, '..', '..', 'core', 'lib', 'locate.cjs'));

// How much of a turn is kept. Measured on 2,200 turns of real sessions (2026-11-15): 95% of asks are
// under 1,000 characters and 97% of answers under 4,000, so nearly every turn is kept whole, and the
// day's file grows about 1.6 times over the old caps (200 and 1,200, which kept 37% of answers whole).
// The file is committed with the brain and read by the wrap-up; the full text stays in the transcript.
const ASK_CAP = 1000;
const ASK_SCAN = 8000;    // how much of an ask is read for secrets before it is cut to ASK_CAP
const LABEL_CAP = 90;      // the `### HH:MM <label>` heading
const ANSWER_CAP = 4000;
const TAIL_BYTES = 512 * 1024; // transcripts run to tens of MB; the last ask is always near the end
// The `Card:` line. Every card a turn wrote to is named, up to WROTE_MAX. A turn that wrote to none
// is about the cards it read, when they are few: one that read across many (a check-in, a review) is
// about none in particular and gets no line.
const WROTE_MAX = 8;
const READ_MAX = 3;

// Cut to a cap, never through the middle of a character pair.
function cut(text, cap) {
  if (text.length <= cap) return text;
  let kept = text.slice(0, cap - 1);
  if (/[\uD800-\uDBFF]$/.test(kept)) kept = kept.slice(0, -1);
  return `${kept}…`;
}

// The turn that just ended, from the tail of the transcript: the owner's ask, and the tool calls
// made after it (what the turn read and wrote). Read backwards from the end, up to the ask.
function readTurn(transcriptPath) {
  const turn = { ask: '', uses: [] };
  if (!transcriptPath) return turn;
  try {
    const size = fs.statSync(transcriptPath).size;
    const start = Math.max(0, size - TAIL_BYTES);
    const fd = fs.openSync(transcriptPath, 'r');
    const buf = Buffer.alloc(size - start);
    fs.readSync(fd, buf, 0, buf.length, start);
    fs.closeSync(fd);
    const lines = buf.toString('utf8').split('\n');
    for (let i = lines.length - 1; i >= 0; i--) {
      const raw = lines[i].trim();
      if (!raw.startsWith('{')) continue; // blank, or the tail's truncated first line
      let row;
      try { row = JSON.parse(raw); } catch { continue; }
      if (!row.message || row.isSidechain) continue;   // a subagent's rows are not this turn's
      if (row.type === 'assistant' && Array.isArray(row.message.content)) {
        const calls = row.message.content.filter((b) => b && b.type === 'tool_use' && b.input && typeof b.input === 'object');
        turn.uses.unshift(...calls.map((b) => ({ name: String(b.name || ''), input: b.input })));
        continue;
      }
      if (row.type !== 'user' || row.isMeta) continue;
      const c = row.message.content;
      let text = '';
      if (typeof c === 'string') text = c;
      else if (Array.isArray(c)) {
        if (c.some((b) => b && b.type === 'tool_result')) continue; // a tool result, not an ask
        text = c.filter((b) => b && b.type === 'text').map((b) => b.text).join(' ');
      }
      text = text
        .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, ' ')
        .replace(/<[a-z-]+-(?:instructions|notification|reminder)>[\s\S]*?<\/[a-z-]+-(?:instructions|notification|reminder)>/gi, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      // Whole, up to a bound: it is cut to its cap only after secrets are taken out of it, so a value
      // cannot be split at the cut and slip past.
      if (text) { turn.ask = text.slice(0, ASK_SCAN); break; }
    }
  } catch { /* fall through — the ask is a nice-to-have, never a reason to lose the turn */ }
  return turn;
}

// ---- which card a turn is about ---------------------------------------------------------------
//
// Worked out from what the turn touched, never from its words: a page it wrote with `log` or
// `remember` (the tool or the command), a file it edited or read under a project or an area, a page
// it read with `get`. Each is followed to the card of its project or area, and only to a card that
// is a file in the brain. Anything else names no card. Files only: no index is opened for this.

const isFile = (file) => { try { return fs.statSync(file).isFile(); } catch { return false; } };

// `projects/<name>/…` or `areas/<name>/…`, relative to the brain: that project's or area's card.
function cardOfRel(root, rel) {
  const parts = String(rel).split('/').filter(Boolean);
  if (parts.length < 2 || !/^(?:projects|areas)$/.test(parts[0]) || parts.includes('..')) return null;
  const name = parts.length === 2 ? parts[1].replace(/\.(?:md|markdown)$/i, '') : parts[1];
  if (isFile(path.join(root, parts[0], name, 'card.md'))) return `${parts[0]}/${name}/card`;
  if (isFile(path.join(root, parts[0], `${name}.md`))) return `${parts[0]}/${name}`;
  return null;
}

function cardOfFile(root, cwd, file) {
  if (typeof file !== 'string' || !file) return null;
  const rel = path.relative(root, path.resolve(cwd, file));
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return null;
  return cardOfRel(root, rel.split(path.sep).join('/'));
}

// A page as `log`, `remember` and `get` are given it: a slug, or the bare name of one project or area.
function cardOfRef(root, ref) {
  const name = String(ref || '').trim().replace(/\\/g, '/').replace(/\.md$/i, '').replace(/^\/+|\/+$/g, '');
  if (!name || name.includes(':')) return null;   // `log:today`, a page of another source
  if (name.includes('/')) return cardOfRel(root, name);
  const found = ['projects', 'areas'].map((bucket) => cardOfRel(root, `${bucket}/${name}`)).filter(Boolean);
  return found.length === 1 ? found[0] : null;    // two of that name: not known, so not said
}

const EDITS = new Set(['Edit', 'Write', 'MultiEdit']);
const COGBY_TOOL = /^mcp__.*cogby.*__(log|remember|get)$/i;
const COGBY_COMMAND = /\bcogby(?:\.cmd|\.ps1)?["']?\s+(log|remember|get)\s+(?:"([^"]+)"|'([^']+)'|([^\s"'|;&<>]+))/g;

// `first` is the page of the place the session is in, when it is in one.
function cardsOf(root, cwd, uses, first) {
  const wrote = first ? [first] : [];
  const read = [];
  const add = (list, card) => { if (card && !list.includes(card)) list.push(card); };
  for (const { name, input } of uses) {
    try {
      const tool = COGBY_TOOL.exec(name);
      if (EDITS.has(name)) add(wrote, cardOfFile(root, cwd, input.file_path));
      else if (name === 'Read') add(read, cardOfFile(root, cwd, input.file_path));
      else if (tool) add(tool[1].toLowerCase() === 'get' ? read : wrote, cardOfRef(root, input.slug));
      else if ((name === 'Bash' || name === 'PowerShell') && typeof input.command === 'string') {
        for (const m of input.command.matchAll(COGBY_COMMAND)) add(m[1] === 'get' ? read : wrote, cardOfRef(root, m[2] || m[3] || m[4]));
      }
    } catch { /* one odd tool call never costs the turn its entry */ }
  }
  if (wrote.length) return wrote.slice(0, WROTE_MAX);
  return read.length <= READ_MAX ? read : [];
}

// A session outside the brain, in a folder that is a place of it: the place whose log this is, or
// null for a folder that keeps none (core/brain/link.cjs logPlace, which the session-end hook asks
// too before it commits the day's file).
function placeFor(brain, cwd) {
  try { return require(path.join(__dirname, '..', '..', 'core', 'brain', 'link.cjs')).logPlace(brain, cwd); }
  catch { return null; }   // a Node without SQLite: no log, never an error
}

// Set by plugin-hook.cjs for a session that is not in a brain: the person's default brain.
const PLACE_OF = (() => { const at = process.argv.indexOf('--place-of'); return at >= 0 ? String(process.argv[at + 1] || '') : ''; })();

// A headless spawn's replies are not the owner's history (review B9). When a caller turns capture
// back on for one (BRAIN_NO_CAPTURE=0), its entries say so in the heading.
const FLAGS = flagsFrom(process.env);
if (!FLAGS.capture) process.exit(0);

let input = '';
const stdinTimeout = setTimeout(() => process.exit(0), 4000);
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => (input += chunk));
process.stdin.on('end', () => {
  clearTimeout(stdinTimeout);
  try {
    let data = {};
    try {
      data = JSON.parse(input || '{}');
    } catch {
      process.exit(0);
    }

    const msg = redact(data.last_assistant_message || '');
    if (!msg) process.exit(0);

    const cwd = data.cwd || process.env.CLAUDE_PROJECT_DIR || process.cwd();
    // A private brain is sealed both ways: a turn whose folder is in another brain than the one the
    // session was opened in, with a private brain among them, is logged nowhere (locate.cjs crossesPrivate).
    if (crossesPrivate(cwd)) process.exit(0);

    function dateStr(d) {
      const yyyy = d.getFullYear();
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      const dd = String(d.getDate()).padStart(2, '0');
      return `${yyyy}-${mm}-${dd}`;
    }

    function extractLabel(text) {
      let inFence = false;
      for (const raw of String(text || '').split('\n')) {
        if (/^\s*(?:```|~~~)/.test(raw)) { inFence = !inFence; continue; }
        if (inFence) continue;
        const plain = raw
          .replace(/^\s*>+\s*/, '')                    // block quote
          .replace(/^\s*#{1,6}\s+/, '')                // heading
          .replace(/^\s*(?:[-*+]|\d+[.)])\s+/, '')     // list marker
          .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')   // link/image → its text
          .replace(/[*_`]/g, '')                       // emphasis, inline code
          .replace(/\s+/g, ' ')
          .trim();
        if (plain.length < 3) continue;
        const sentence = (plain.match(/^.*?[.!?](?=\s|$)/) || [plain])[0].trim();
        return sentence.length > LABEL_CAP ? sentence.slice(0, LABEL_CAP - 1) + '…' : sentence;
      }
      return 'Session entry';
    }

    // Secrets are taken out of the whole text first (`msg` above, the ask here), and only then is
    // it cut: a value cannot be split at the cut and slip past.
    const turn = readTurn(data.transcript_path);
    const ask = cut(redact(turn.ask), ASK_CAP);
    const gist = msg.replace(/\s+/g, ' ').trim().replace(/^(\s{0,3})([#>]+)/, '$1\\$2');
    const trimmed = cut(gist, ANSWER_CAP);

    // A session whose folder is neither a brain nor an install has no log to write to. rootsFrom
    // then hands back the folder itself, and writing there planted self/log/ in a Downloads folder
    // (found 2026-11-10): a hook writes inside a brain or an install, never anywhere else.
    //
    // Outside a brain the hook is told which brain is the person's (`--place-of`), and writes there
    // only when this folder is a place of it that works on its page. It is never left to rootsFrom:
    // a repository with a CLAUDE.md beside a .claude/ folder reads as an install to that walk.
    let root;
    let place = null;
    if (PLACE_OF) {
      place = placeFor(path.resolve(PLACE_OF), cwd);
      if (!place) process.exit(0);
      root = path.resolve(PLACE_OF);
    } else {
      const where = rootsFrom(cwd);
      if (!where.inTree) process.exit(0);
      root = where.brain;   // the daily log is substrate, so it follows the brain
    }
    const now = new Date();
    const today = dateStr(now);
    const logDir = R(root).ctx('self', 'log');
    const logPath = path.join(logDir, `${today}.md`);

    try {
      fs.mkdirSync(logDir, { recursive: true });
    } catch {
    }

    const hh = String(now.getHours()).padStart(2, '0');
    const min = String(now.getMinutes()).padStart(2, '0');
    // An entry from a place says where the turn happened: the place and its role. Every entry says
    // which card it is about, when that is known, on a line that reads the same everywhere:
    // `Card: <slug>`, several joined by ` · `. In a place the place's own page comes first.
    const at = place ? `Place: ${redact(place.id)} · ${place.role}\n` : '';
    let cards = place ? [place.page] : [];
    try { cards = cardsOf(root, cwd, turn.uses, place ? place.page : null); } catch { /* the place's page, or none */ }
    const about = cards.length ? `Card: ${cards.join(' · ')}\n` : '';
    const entry = `\n### ${hh}:${min} ${FLAGS.headless ? '[headless] ' : ''}${extractLabel(msg)}\n`
      + at
      + about
      + (ask ? `> ${ask}\n` : '')
      + `${trimmed}\n`;

    fs.appendFileSync(logPath, entry);
  } catch {
    process.exit(0);
  }
  process.exit(0);
});
