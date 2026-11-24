const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');

function envDir(name) {
  const v = process.env[name];
  if (!v) return null;
  const p = path.resolve(v);
  return fs.existsSync(p) ? p : null;
}

function dirIf(p) { return fs.existsSync(p) ? p : null; }

// One folder, two spellings: `c:\Cogby` and `C:\Cogby` on Windows, where a drive letter's case is
// whatever the shell or the caller handed over, and where the file system ignores case anyway. A
// plain `===` on such a pair answers "is this this program" wrongly — `locate.cjs` would treat the
// program as a foreign install (§4.2 case 3 read as case 2), and `brainOf` would drop COGBY_BRAIN.
function samePath(a, b) {
  if (a == null || b == null || a === '' || b === '') return false;
  const x = path.resolve(String(a));
  const y = path.resolve(String(b));
  return process.platform === 'win32' ? x.toLowerCase() === y.toLowerCase() : x === y;
}

const GROUP = {
  self: 'context', team: 'context', planning: 'context',
  tasks: 'state', routines: 'state', notes: 'state', notifications: 'state', apps: 'state', usage: 'state',
  projects: 'realm', areas: 'realm', resources: 'realm', archive: 'realm', output: 'realm',
};
const BUCKETS = Object.freeze(Object.keys(GROUP));
const REALM_BUCKETS = Object.freeze(['projects', 'areas', 'resources', 'archive', 'output']);
const STANDARD_AREAS = Object.freeze(['work', 'organizations', 'people']);

// The brain layout: work folders at the top, everything Cogby runs on hidden in `.cogby` (D8),
// and `.cogby/brain.json` as the marker that says so.
const BRAIN_RUNTIME = '.cogby';
const BRAIN_MARKER = 'brain.json';

function isBrainBase(base) {
  return fs.existsSync(path.join(base, BRAIN_RUNTIME, BRAIN_MARKER));
}

function build(base) {
  // Brain layout: the realm buckets ARE the brain's top level and context + state both live in the
  // hidden runtime folder. Everything below this line is the legacy layout, unchanged.
  const brain = isBrainBase(base) ? path.join(base, BRAIN_RUNTIME) : null;
  const contextRoot = brain || dirIf(path.join(base, 'context')) || base;
  const realmsDir = path.join(contextRoot, 'realms');

  // One realm only in the brain layout: `realmRoot` is the base outright, which leaves no coherent
  // place for a second realm — the migration refuses a multi-realm install rather than half-map it (D9).
  // So the brain reports no realms at all, whatever lands in `.cogby/realms/`: the same answer REALM
  // (null) gives, rather than a stray name the rest of the layout cannot resolve.
  const realms = () => (!brain && fs.existsSync(realmsDir)
    ? fs.readdirSync(realmsDir, { withFileTypes: true })
        .filter((e) => e.isDirectory() && !e.name.startsWith('.') && !e.name.startsWith('_'))
        .map((e) => e.name).sort()
    : []);

  const found = realms();
  let realm = null;
  if (found.length) {
    const want = (process.env.COGBY_REALM || '').trim();
    realm = (want && found.includes(want)) ? want
          : found.length === 1 ? found[0]
          : (found.includes('work') ? 'work' : found[0]);
  }
  const realmRoot = brain ? base : (realm ? path.join(realmsDir, realm) : contextRoot);
  const stateRoot = brain || dirIf(path.join(contextRoot, 'state')) || contextRoot;

  const rootFor = (bucket) => {
    switch (GROUP[bucket]) {
      case 'realm': return realmRoot;
      case 'state': return stateRoot;
      case 'context': return contextRoot;
      default: return null;
    }
  };

  function ctx(...seg) {
    const parts = seg.length === 1 && typeof seg[0] === 'string'
      ? seg[0].split(/[\\/]/).filter(Boolean)
      : seg.filter((x) => x !== undefined && x !== null && x !== '').map(String);
    if (!parts.length) throw new TypeError('ctx() needs at least a bucket name');
    const root = rootFor(parts[0]);
    if (!root) throw new TypeError(`ctx(): unknown substrate bucket ${JSON.stringify(parts[0])}`);
    return path.join(root, ...parts);
  }

  function abs(...seg) {
    const parts = seg.length === 1 && typeof seg[0] === 'string'
      ? seg[0].split(/[\\/]/).filter(Boolean)
      : seg.filter((x) => x !== undefined && x !== null && x !== '').map(String);
    if (!parts.length) return base;
    const root = rootFor(parts[0]);
    return path.join(root || base, ...parts);
  }

  function ctxRoot(bucket) {
    const r = rootFor(bucket);
    if (!r) throw new TypeError(`ctxRoot(): unknown substrate bucket ${JSON.stringify(bucket)}`);
    return r;
  }

  function relCtx(abs) {
    const target = path.resolve(abs);
    for (const root of [realmRoot, stateRoot, contextRoot].sort((a, b) => b.length - a.length)) {
      const rel = path.relative(root, target);
      if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) continue;
      const fwd = rel.split(path.sep).join('/');
      if (GROUP[fwd.split('/')[0]]) return fwd;
    }
    return null;
  }

  return {
    BASE: base,
    // 'brain' when `<base>/.cogby/brain.json` decided this layout, else 'legacy'. Read it instead of
    // re-deriving the layout from the roots: it is the answer this resolver was built on, cached with it.
    LAYOUT: brain ? 'brain' : 'legacy',
    CONTEXT_ROOT: contextRoot,
    STATE_ROOT: stateRoot,
    REALM_ROOT: realmRoot,
    REALM: realm,
    ctx, ctxRoot, relCtx, realms, abs,
  };
}

// The per-machine config folder, by the rules of cli/lib/runtime-paths.cjs configDirectory. An
// inline copy on purpose: this file must stay self-contained, because five test suites copy it
// ALONE into their fixture engines. starter-brain.cjs configDir is the one core implementation;
// brain-setting.test holds the three to the same answer.
function configDir(env = process.env) {
  const home = path.resolve(env.HOME || os.homedir());
  if (env.COGBY_CONFIG_DIR) return path.resolve(env.COGBY_CONFIG_DIR);
  if (process.platform === 'win32') return path.join(env.APPDATA || path.join(home, 'AppData', 'Roaming'), 'Cogby');
  if (process.platform === 'darwin') return path.join(home, 'Library', 'Application Support', 'Cogby');
  return path.join(env.XDG_CONFIG_HOME || path.join(home, '.config'), 'cogby');
}

// The brain's location as the install record states it: "brain" in <configDir>/install.json, read
// only when that record is THIS program's (its root is `engine`). A dev checkout, a fixture, another
// install's record and a record with no "brain" key all answer null, which is "no setting" and
// changes nothing. A "brain" that is there must be an absolute path, the rule cli/lib/installation.cjs
// readInstallRecord holds the same record to: a relative one would name a different folder from
// every cwd, and reading it as "no setting" would let core run while the CLI refuses the record. So
// anything else throws, the fix first, and every reader of the one setting gives the one answer.
function recordedBrain(engine = ROOT, env = process.env) {
  const file = path.join(configDir(env), 'install.json');
  let record;
  try { record = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')); } catch { return null; }
  if (!record || typeof record !== 'object' || record.brain === undefined || !samePath(record.root, engine)) return null;
  if (typeof record.brain === 'string' && path.isAbsolute(record.brain)) return path.resolve(record.brain);
  throw new Error(
    `Point "brain" in install.json at your brain folder by its absolute path: ${JSON.stringify(record.brain)} is not one ` +
    `(setting read from ${file}).`);
}

// How a process with no explicit substrate base finds the brain (§3): COGBY_BRAIN if it names a
// folder that exists, then the brain this program's install record names, otherwise THE one child
// of the engine root holding `.cogby/brain.json`. None — a dev checkout, every test fixture — falls
// back to the engine root itself, which is the legacy layout. Two stops the process: multi-brain is
// not built, and silently picking one writes the owner's work into the wrong brain.
//
// COGBY_BRAIN and the record answer "which brain belongs to this program", so they apply only when
// the root being resolved IS the engine root. Asked about any other root — the six ops that read
// BRAIN_DIR as their own root, every fixture — they are ignored and the children of that root
// decide, which is what keeps `BRAIN_DIR=<fixture>` plus a stray COGBY_BRAIN resolving to the fixture.
// The brain a folder is in: the nearest folder at or above it that holds the marker.
function brainAbove(start) {
  if (!start) return null;
  let dir = path.resolve(String(start));
  for (let i = 0; i < 12; i++) {
    if (isBrainBase(dir)) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

function brainOf(engineRoot) {
  const root = path.resolve(engineRoot);
  const ours = samePath(root, ROOT);
  const want = ours ? (process.env.COGBY_BRAIN || '').trim() : '';
  if (want) {
    const named = path.resolve(want);
    if (fs.existsSync(named)) return named;
  }
  // A recorded brain without its marker, or a "brain" that is not an absolute path (recordedBrain
  // throws on it), stops the process like two brains do, never a fall-through to discovery or the
  // engine root: that would write the owner's work into the program folder, and lane-policy's
  // module-load deny is what keeps the gate shut meanwhile. The fix comes first, for the same 120
  // characters as below. With COGBY_CONTEXT or BRAIN_DIR set the module still loads, and the stop
  // comes at the first forRoot(ROOT) or sessionRoot() instead; the doctor's row is fatal either way.
  const recorded = ours ? recordedBrain(root) : null;
  if (recorded) {
    if (isBrainBase(recorded)) return recorded;
    throw new Error(
      `Point "brain" in install.json at your brain folder, or put the brain back: ${recorded} holds no ` +
      `.cogby/brain.json (setting read from ${path.join(configDir(), 'install.json')}).`);
  }
  let entries;
  try { entries = fs.readdirSync(root, { withFileTypes: true }); } catch { return root; }
  const brains = entries
    .filter((e) => e.isDirectory() && !e.name.startsWith('.') && e.name !== 'node_modules')
    .map((e) => e.name).sort()
    .filter((name) => isBrainBase(path.join(root, name)));
  if (!brains.length) {
    // A program that holds no brain and no legacy substrate of its own is the plugin, run from
    // wherever Claude Code keeps it. Its brain is the one the command was run in: without this a
    // script such as new.cjs would lay a project out inside the plugin's own folder.
    if (ours && !fs.existsSync(path.join(root, 'context'))) {
      const here = brainAbove(process.env.CLAUDE_PROJECT_DIR) || brainAbove(process.cwd());
      if (here) return here;
      // Not in a brain: the person's default one (brains.json, core/brain/brain.cjs defaultBrain).
      try {
        const named = JSON.parse(fs.readFileSync(path.join(configDir(), 'brains.json'), 'utf8').replace(/^\uFEFF/, '')).default;
        if (typeof named === 'string' && path.isAbsolute(named) && isBrainBase(named)) return path.resolve(named);
      } catch { /* none recorded */ }
    }
    return root;
  }
  if (brains.length === 1) return path.join(root, brains[0]);
  // The fix comes first: the policy hook shows only the first 120 characters of this
  // (`.claude/hooks/lane-policy.cjs`, the module-load deny), and the root path alone can eat half.
  throw new Error(
    `Set COGBY_BRAIN: two brains in ${root} (${brains.join(' and ')}). Cogby supports one today; ` +
    'point COGBY_BRAIN at the one to use, or move the other out of the program folder.');
}

// Old content (notes, goals, SOUL text, a routine's steps) names paths in the pre-brain spellings.
// They are read through this, never rewritten in place — rewriting an owner file is risky and
// rewriting a routine breaks its signature (D4).
const LEGACY_PREFIXES = [
  /^cogby-brain[^/]*\/\.cogby\//,
  /^cogby-brain[^/]*\//,
  // A model working in the brain writes task paths brain-relative (`.cogby/tasks/<id>/output/x`
  // in a result.md's `## Deliverables`); without this row `bucketRelative` gets no bucket back
  // and the deliverable drops off the task page (§4.16).
  /^\.cogby\//,
  /^context\/realms\/[^/]+\//,
  /^context\/state\//,
  /^context\//,
];
function wireFromLegacy(rel) {
  const s = String(rel == null ? '' : rel).split('\\').join('/').replace(/^\.\//, '');
  for (const re of LEGACY_PREFIXES) if (re.test(s)) return s.replace(re, '');
  return s;
}

// Wire paths (JSON, ids, prompts, policy checks) are always '/'. A path printed for the owner
// to read or paste uses the platform separator; this is the one place that converts back.
function displayPath(p) {
  return String(p == null ? '' : p).split('/').join(path.sep);
}

// A path handed to the MODEL is measured from the folder the model's session is in, because that
// is what it resolves the path against (§4.5). `from` is that folder when the caller knows it — a
// hook has its payload's `cwd`, a spawner the cwd it chose — and sessionRoot() otherwise: the brain
// when sessions start there, the engine root when they cannot (no brain, or one that is not
// launchable). Never BRAIN_BASE: it names the brain even when the session sits at the engine root,
// and it follows BRAIN_DIR to a substrate no session starts in. With no brain on disk `from` is the
// engine root and the string is exactly today's path.relative(ROOT, …) in wire form (`/`), so the
// no-brain invariant holds by construction instead of by inspection.
//
// From a brain outside the program (the one the install record places elsewhere), a path that
// climbs out of `from` is spelled absolute, in wire form: `../<program>/core/…` would name the
// program by where the two folders happen to sit, and break the moment either moves. A path inside
// `from` stays relative, and from anywhere else nothing changes (`../core/…` from a brain in the
// program). `engine` is the program whose record is read: this one by default.
function promptRel(abs, from, engine = ROOT) {
  if (abs == null || abs === '') return '';
  const base = path.resolve(String(from || sessionRoot(engine)));
  const rel = path.relative(base, String(abs));
  const wire = (p) => p.split(path.sep).join('/');
  return climbs(rel) && inOutsideBrain(base, engine) ? wire(path.resolve(String(abs))) : wire(rel);
}

// Whether a path.relative() answer leaves the folder it was measured from: `..`, `../x`, or another
// drive (where path.relative hands back an absolute path).
function climbs(rel) {
  return rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel);
}

// Whether `dir` lies in the brain `engine`'s install record names, outside `engine`. Asked only of a
// path that climbs out of its folder, so the record is read only then; a record that cannot be read
// answers no, and the path keeps today's relative spelling.
function inOutsideBrain(dir, engine) {
  const program = path.resolve(String(engine));
  if (!climbs(path.relative(program, dir))) return false;
  let brain;
  try { brain = recordedBrain(program); } catch { return false; }
  return !!brain && !climbs(path.relative(brain, dir));
}

// For the few prompt strings that were NOT `path.relative(ROOT, …)` before the brain: a bucket-
// relative wire path (`tasks/<id>/task.md`, `self/log/<date>.md`) or a stored path still in the
// platform's separators. promptRel would change their bytes with no brain on disk, which §6 does not
// allow, so they keep `legacy` exactly while the substrate is the legacy layout. Once it is a brain
// the hidden buckets sit under `.cogby/` and only the path measured from the session's folder
// resolves. `layout` is the LAYOUT of the resolver that built `abs` (this program's by default).
function promptRelOr(legacy, abs, { from, layout } = {}) {
  return (layout || DEFAULT.LAYOUT) === 'brain' ? promptRel(abs, from) : String(legacy);
}

// `node core/ops/new.cjs` as the model must spell it from its own folder: `node ../core/ops/new.cjs`
// from inside the brain, unchanged from the engine root. Takes an engine-relative script path;
// anything after the first space is passed through untouched. `engine` is the program the script
// belongs to (this one by default; a hook that found another install through rootsFrom passes it).
// From a brain outside the program the script is its absolute path (promptRel), and that is always
// quoted (shellWord): it carries the program's folder, whose name the owner chose. A relative
// spelling is quoted only for a space, as before.
function engineCmd(rel, { from, engine = ROOT } = {}) {
  const s = String(rel == null ? '' : rel).trim();
  const cut = s.search(/\s/);
  const script = cut === -1 ? s : s.slice(0, cut);
  const rest = cut === -1 ? '' : s.slice(cut);
  const spelled = promptRel(path.join(engine, script), from || sessionRoot(engine), engine);
  const word = path.isAbsolute(spelled) ? shellWord(spelled)
    : /\s/.test(spelled) ? `"${spelled}"` : spelled;
  return `node ${word}${rest}`;
}

// An absolute path as one shell word. Not only a space splits it: `&`, `(`, `)`, `;`, `|` or `'` in
// a folder name ends an unquoted word too (`R&D(Cogby)`, `C:/Users/O'Brien`). Double quotes are the
// form bash, PowerShell and cmd all read; a path holding `$`, a backtick, `"`, `\` or `!`, which stay
// live inside them in a POSIX shell, takes single quotes instead, with `'\''` for an apostrophe.
function shellWord(p) {
  return /[$`"\\!]/.test(p) ? `'${p.replace(/'/g, `'\\''`)}'` : `"${p}"`;
}

function signingDir() {
  const raw = process.env.COGBY_SIGNING_DIR;
  if (raw && String(raw).trim()) return path.resolve(String(raw).trim());
  const home = process.env.HOME || os.homedir();
  return path.join(home, '.config', 'cogby', 'signing');
}
function signingKeyFile() { return path.join(signingDir(), 'box.pem'); }

const _cache = new Map();
const _bases = new Map();   // asked-for root -> the base it resolves to, so discovery runs once per root
function forRoot(root) {
  // `forRoot(ROOT)` means "the substrate for the program", which is the brain once one exists —
  // that is what leaves the ~40 call sites spelling it that way untouched. With no brain, discovery
  // hands back the root it was given and this is exactly today's build(path.resolve(root)).
  const asked = path.resolve(root);
  let key = _bases.get(asked);
  if (key === undefined) { key = brainOf(asked); _bases.set(asked, key); }
  let r = _cache.get(key);
  if (!r) { r = build(key); _cache.set(key, r); }
  return r;
}

// The env still wins. COGBY_CONTEXT and BRAIN_DIR name a substrate base outright — six ops read
// BRAIN_DIR as their OWN root, and about 38 test files point it at a fixture — so discovery runs
// only when neither is set. COGBY_BRAIN and the install record's "brain" sit below both: they
// override discovery, never an explicit base.
function buildDefault() {
  return build(envDir('COGBY_CONTEXT') || envDir('BRAIN_DIR') || brainOf(ROOT));
}

let DEFAULT = buildDefault();

function live() {
  return {
    // BRAIN_BASE, not BRAIN_ROOT: BRAIN_ROOT is an existing env var meaning the ENGINE root
    // (meeting-capture.cjs, doctor's KNOBS). Two names one character apart meaning opposite roots
    // is how this gets wired backwards later.
    BRAIN_BASE: DEFAULT.BASE,
    LAYOUT: DEFAULT.LAYOUT,
    CONTEXT_ROOT: DEFAULT.CONTEXT_ROOT,
    STATE_ROOT: DEFAULT.STATE_ROOT,
    REALM_ROOT: DEFAULT.REALM_ROOT,
    REALM: DEFAULT.REALM,
    ctx: DEFAULT.ctx,
    abs: DEFAULT.abs,
    ctxRoot: DEFAULT.ctxRoot,
    relCtx: DEFAULT.relCtx,
    realms: DEFAULT.realms,
  };
}

// Whether a session may START in `dir` rather than in the engine (§4.3). Every spawner that puts
// a session in a brain asks this one question, so the answer cannot drift between them. Four
// conditions, all of them:
//   - `dir` is a brain: it holds `.cogby/brain.json`;
//   - it sits DIRECTLY in `engine`, where its two forwarders climb exactly one folder up for the
//     engine's hook and core/lib/spawn.cjs; or it is the brain `engine`'s own install record names
//     ("brain" in install.json, recordedBrain), the one place outside the program a brain is
//     meant to live. Anywhere else (<engine>/sub/cogby-brain, a folder only COGBY_BRAIN names) is
//     neither, and the gate would be dead. A record that cannot be read answers no here: brainOf
//     is where a bad setting stops the process, and the program folder is still gated;
//   - both forwarders are there. The policy files spell their hook from the folder the session
//     started in (`node "$CLAUDE_PROJECT_DIR"/.claude/hooks/lane-policy.cjs`), which in a brain is
//     the brain, so from a brain without them the gate of every unattended lane would stop running
//     without a word;
//   - its `.claude/settings.json` is there (§4.7, decided in U6). Claude Code runs the hooks of the
//     folder a session starts in and not its parent's, so a brain without one runs none of Cogby's:
//     no Tier-0 snapshot, no capture-log, no wrap-up, and the wrap-up child loses them too, because
//     its one --settings file merges with exactly this file (§4.3 knock-on 2). Nothing errors; the
//     session simply stops being Cogby. Same reason as the forwarders, so the same fallback.
const GATE_FORWARDERS = Object.freeze(['lane-policy.cjs', 'wrapup-guard.cjs']);
function isLaunchableBrain(dir, engine = ROOT) {
  if (!dir || !engine || !isBrainBase(dir)) return false;
  if (!samePath(path.dirname(path.resolve(String(dir))), engine) && !isRecordedBrain(dir, engine)) return false;
  const harness = path.join(String(dir), '.claude');
  return GATE_FORWARDERS.every((f) => fs.existsSync(path.join(harness, 'hooks', f)))
    && fs.existsSync(path.join(harness, 'settings.json'));
}

function isRecordedBrain(dir, engine) {
  let recorded;
  try { recorded = recordedBrain(path.resolve(String(engine))); } catch { return false; }
  return !!recorded && samePath(recorded, dir);
}

// The folder a model session starts in: this program's brain when it may start there, so the
// brain's settings, connectors and rules apply to Cogby's own work exactly as they do when the
// owner opens the brain in Claude Code; the program itself otherwise, which with no brain on disk
// is exactly the cwd every session had before. The brain is the one forRoot(ROOT) finds
// (COGBY_BRAIN, then the install record, then discovery), never BRAIN_BASE: BRAIN_DIR and
// COGBY_CONTEXT name a substrate outright (a test fixture, a relocated legacy tree), which is no
// brain and ships no forwarders.
// `engine` asks the same question of another install — a route's own root, which in a test is a
// fixture — and defaults to this program.
function sessionRoot(engine = ROOT) {
  const root = path.resolve(String(engine));
  const base = forRoot(root).BASE;
  return isLaunchableBrain(base, root) ? base : root;
}

// Discovery reads the filesystem; the caches do not. `forRoot` memoises both the base a root
// resolves to and the layout built from it, and DEFAULT is built once at module load — so a root
// whose MEANING changes, the instant `cogby-brain/.cogby/brain.json` is written, keeps resolving
// to the old layout for the life of the process. That is right for everything started after the
// marker exists, and wrong for the three that write it and keep running: the migration (§4.14
// step 6), and the heartbeat's and doctor's finalize. They call this straight after the write.
// What it cannot fix: a module that destructured (`const { ctx } = require('./paths.cjs')`) still
// holds the old function — read through the export (`paths.ctx(…)`) after invalidating.
function invalidate() {
  _cache.clear();
  _bases.clear();
  DEFAULT = buildDefault();
  Object.assign(module.exports, live());
  return module.exports;
}

module.exports = {
  ROOT,
  displayPath,
  promptRel,
  promptRelOr,
  engineCmd,
  signingDir,
  signingKeyFile,
  BUCKETS,
  REALM_BUCKETS,
  STANDARD_AREAS,
  GROUP,
  forRoot,
  brainOf,
  configDir,
  recordedBrain,
  sessionRoot,
  isLaunchableBrain,
  GATE_FORWARDERS,
  samePath,
  wireFromLegacy,
  invalidate,
  ...live(),
};
