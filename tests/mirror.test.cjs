'use strict';

// The Notion mirror (core/brain/mirror.cjs): a copy of the brain under one Notion page, off until
// the owner turns it on. No test here reaches Notion: `ntn` is a stand-in, in the test's own process
// for most, and as a real command on disk for the one that goes through `cogby mirror push`.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { ROOT, newBrain, cogby, json, hook } = require('./helpers.cjs');

const mirror = require(path.join(ROOT, 'core', 'brain', 'mirror.cjs'));
const todo = require(path.join(ROOT, 'core', 'brain', 'todo.cjs'));
const PARENT = '11111111-2222-3333-4444-555555555555';

// A Notion that keeps its pages in memory and answers the three calls the mirror makes.
function fakeNotion() {
  const pages = new Map();
  const calls = [];
  let n = 0;
  const run = (args, input) => {
    calls.push(args.join(' '));
    if (args[0] === '--version') return { code: 0, out: 'ntn 0.0.0-test\n', err: '' };
    if (args[0] === 'api' && args[1] === 'v1/pages') {
      const body = JSON.parse(input);
      const id = `aaaaaaaa-0000-4000-8000-${String(++n).padStart(12, '0')}`;
      pages.set(id, { parent: body.parent.page_id, title: body.properties.title.title[0].text.content, content: '' });
      return { code: 0, out: JSON.stringify({ object: 'page', id, url: `https://www.notion.so/${id.replace(/-/g, '')}` }), err: '' };
    }
    const body = /^v1\/pages\/([0-9a-f-]{36})\/markdown$/.exec(args[1] || '');
    if (args[0] === 'api' && body) {
      const method = args[args.indexOf('-X') + 1];
      // Notion answers a page it cannot find with an error object: here with exit 0, the harder case to catch.
      if (!pages.has(body[1])) return { code: 0, out: JSON.stringify({ object: 'error', status: 404, code: 'object_not_found', message: 'Could not find page.' }), err: '' };
      if (method === 'PATCH') {
        const sent = JSON.parse(input);
        if (/allow_deleting_content/.test(input)) throw new Error('the mirror must never send allow_deleting_content');
        assert.equal(sent.type, 'replace_content');
        assert.equal(sent.markdown_version, 'v2');
        pages.get(body[1]).content = sent.replace_content.new_str;
      } else {
        assert.equal(method, 'GET');
        assert.ok(args.includes('markdown_version==v2'));
      }
      return { code: 0, out: JSON.stringify({ object: 'page_markdown', id: body[1], markdown: pages.get(body[1]).content, truncated: false, unknown_block_ids: [] }), err: '' };
    }
    return { code: 2, out: '', err: `unexpected: ${args.join(' ')}` };
  };
  const titled = (title) => [...pages.entries()].find(([, entry]) => entry.title === title);
  return { run, pages, calls, titled };
}

function write(box, rel, text) {
  const file = path.join(box.brain, ...rel.split('/'));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}

// A small brain: one project with a fact, a decision and two lines, one area, one person, one page
// kept out, one resource, two to-dos.
function seeded(t) {
  const box = newBrain(t);
  write(box, 'projects/harbor/card.md', '---\ntype: project\nname: harbor\n---\n# Harbor\n\nMove the client portal to the new host.\n\n## Now\n\n- Cutover plan with Dana\n\n## Next\n\n- (what is queued)\n\n<!-- timeline -->\n');
  write(box, 'projects/secret-plan/card.md', '---\ntype: project\nname: secret-plan\nmirror: false\n---\n# Secret plan\n\nNot for Notion.\n\n<!-- timeline -->\n');
  write(box, 'areas/finance/card.md', '---\ntype: area\n---\n# Finance\n\nThe monthly close.\n\n<!-- timeline -->\n');
  write(box, 'areas/people/dana.md', '---\ntype: person\n---\n# Dana\n\nLeads hosting.\n\n<!-- timeline -->\n');
  write(box, 'resources/pricing.md', '# Pricing\n\nRaw reference.\n');
  assert.equal(cogby(box, ['sync']).code, 0);
  assert.equal(cogby(box, ['remember', 'projects/harbor/card', 'The host contract ends 2027-03-01', '--source', 'contract.pdf']).code, 0);
  assert.equal(cogby(box, ['log', 'projects/harbor/card', 'Cut over on a Sunday, because traffic is lowest', '--decision', '--who', 'owner', '--source', 'call with Dana']).code, 0);
  assert.equal(cogby(box, ['log', 'projects/harbor/card', 'Dana sent the DNS list', '--source', 'email from Dana']).code, 0);
  assert.equal(cogby(box, ['todo', 'add', 'Book the cutover window', '--project', 'harbor', '--due', '2026-12-01']).code, 0);
  assert.equal(cogby(box, ['todo', 'add', 'Renew the passport']).code, 0);
  return box;
}

test('a page is named by its link or its id', () => {
  assert.equal(mirror.notionId('https://www.notion.so/acme/Cogby-Decade-11111111222233334444555555555555?pvs=4'), PARENT);
  assert.equal(mirror.notionId(PARENT), PARENT);
  assert.equal(mirror.notionId('11111111222233334444555555555555'), PARENT);
  assert.throws(() => mirror.notionId('https://www.notion.so/acme/Just-a-title'), /does not name a Notion page/);
});

test('off until turned on: nothing is handed out, recorded, pulled or pushed', (t) => {
  const box = seeded(t);
  const notion = fakeNotion();
  // What would leave can be listed before saying yes, by title only.
  const before = mirror.plan(box.brain);
  assert.equal(before.on, false);
  assert.ok(before.pages.some((entry) => entry.key === 'projects/harbor/card'));
  for (const call of [
    () => mirror.onePage(box.brain, 'projects/harbor/card'),
    () => mirror.done(box.brain, 'projects/harbor/card', PARENT),
    () => mirror.pull(box.brain, { data: '- [ ] Something' }),
    () => mirror.push(box.brain, { run: notion.run }),
  ]) assert.throws(call, (error) => error.code === 'MIRROR_OFF');
  assert.equal(notion.pages.size, 0);
  assert.throws(() => mirror.setOn(box.brain, undefined, { run: notion.run }), (error) => error.code === 'NO_PARENT');
});

test('off means unseen: no word of it at the session start, on My view or at a wrap-up, and Claude is not told of the skill', (t) => {
  // A brain whose own pages never name Notion, so any word of it below would be Cogby's.
  const box = newBrain(t);
  write(box, 'projects/harbor/card.md', '---\ntype: project\nname: harbor\n---\n# Harbor\n\nMove the client portal to the new host.\n\n<!-- timeline -->\n');
  assert.equal(cogby(box, ['sync']).code, 0);
  assert.equal(cogby(box, ['todo', 'add', 'Book the cutover window', '--project', 'harbor']).code, 0);
  // A command that is not there: on a brain where the mirror is off, Notion's tool is not even looked for.
  const at = { cwd: box.brain, env: { COGBY_NTN: path.join(box.dir, 'no-such-ntn') } };
  // What every wrap-up runs: on this brain it does nothing and prints nothing.
  const quiet = cogby(box, ['mirror', 'push', '--if-on'], at);
  assert.deepEqual([quiet.code, quiet.out.trim(), quiet.err.trim()], [0, '', '']);
  assert.deepEqual(json(box, ['mirror', 'push', '--if-on'], at).data, { off: true, did: 'push' });
  // Without --if-on it is still refused, as for anyone who asks by name.
  assert.equal(cogby(box, ['mirror', 'push'], at).code, 1);

  const started = hook(box, 'brain-context', { session_id: 's1', hook_event_name: 'SessionStart', source: 'startup' });
  assert.equal(started.code, 0, started.err);
  assert.ok(started.out.length > 100, 'the session start said something');
  assert.doesNotMatch(started.out, /notion/i);
  assert.doesNotMatch(cogby(box, ['context', '--brain', box.brain]).out, /notion/i);
  const view = json(box, ['view', '--html', '--brain', box.brain]);
  assert.equal(view.code, 0, view.err);
  // What the page shows for this brain (its code may name Notion as one of the tools a task can live in).
  const shown = /<script type="application\/json" id="cogby-data">([\s\S]*?)<\/script>/.exec(fs.readFileSync(view.data.file, 'utf8'))[1];
  assert.doesNotMatch(shown, /notion|mirror/i);

  // The skill ships, and is kept out of the list of skills Claude reads: the owner starts it by typing its name.
  const skills = path.join(ROOT, '.claude', 'skills');
  const front = (name) => /^---\r?\n([\s\S]*?)\r?\n---/.exec(fs.readFileSync(path.join(skills, name, 'SKILL.md'), 'utf8'))[1];
  assert.match(front('notion-mirror'), /^disable-model-invocation: true\r?$/m);
  // No other skill's description, which Claude does read, sends anyone to it; and the onboarding never offers it.
  for (const name of fs.readdirSync(skills).filter((entry) => entry !== 'notion-mirror' && fs.existsSync(path.join(skills, entry, 'SKILL.md')))) {
    assert.doesNotMatch(front(name), /notion.mirror|cogby mirror/i, `the ${name} skill's description names the mirror`);
  }
  assert.doesNotMatch(fs.readFileSync(path.join(skills, 'onboarding', 'SKILL.md'), 'utf8'), /notion.mirror|cogby mirror/i);
});

test('the mirror holds projects, areas, people, to-dos and decisions, and nothing else', (t) => {
  const box = seeded(t);
  const keys = mirror.plan(box.brain).pages.map((entry) => entry.key);
  assert.deepEqual(keys, ['section:projects', 'section:areas', 'section:people', 'todos', 'decisions', 'projects/harbor/card', 'areas/finance/card', 'areas/people/dana']);
  // Kept out by its own card, and a resource is never mirrored.
  assert.ok(!keys.some((key) => /secret-plan|pricing/.test(key)));
});

test('a mirrored card says it is a copy, and carries its summary, facts, decisions and timeline', (t) => {
  const box = seeded(t);
  mirror.setOn(box.brain, PARENT, { run: fakeNotion().run });
  const card = mirror.onePage(box.brain, 'projects/harbor/card');
  assert.equal(card.title, 'Harbor');
  assert.equal(card.parent, 'section:projects');
  assert.match(card.markdown, /^> Mirrored from Cogby\. Edit it in Cogby/);
  assert.match(card.markdown, /Move the client portal to the new host\./);
  assert.match(card.markdown, /## Now\n\n- Cutover plan with Dana/);
  assert.match(card.markdown, /## Facts\n- The host contract ends 2027-03-01.* · source: contract\.pdf/);
  assert.match(card.markdown, /## Decisions\n- \*\*\d{4}-\d\d-\d\d\*\* Cut over on a Sunday, because traffic is lowest · call: owner/);
  assert.match(card.markdown, /## Timeline\n- \*\*\d{4}-\d\d-\d\d\*\* Dana sent the DNS list \(source: email from Dana\)/);
  // Not the title line (the Notion page has it), not a template hint, not a heading with nothing under it,
  // not the facts table, and the decision is not repeated in the timeline.
  assert.doesNotMatch(card.markdown, /^# Harbor|what is queued|## Next|\| claim \|/m);
  assert.equal(card.markdown.match(/Cut over on a Sunday/g).length, 1);
});

test('what looks like a secret is blanked before it leaves', (t) => {
  const box = seeded(t);
  write(box, 'areas/hosting/card.md', '---\ntype: area\n---\n# Hosting\n\nThe deploy key: API_KEY=sk-live-9f8a7b6c5d4e3f2a1b0c9d8e7f6a5b4c\n\n<!-- timeline -->\n');
  assert.equal(cogby(box, ['sync']).code, 0);
  mirror.setOn(box.brain, PARENT, { run: fakeNotion().run });
  const card = mirror.onePage(box.brain, 'areas/hosting/card');
  assert.doesNotMatch(card.markdown, /sk-live-9f8a/);
  assert.match(card.markdown, /\[redacted:/);
});

test('a push creates each page once, then writes only what changed, and never deletes', (t) => {
  const box = seeded(t);
  const notion = fakeNotion();
  mirror.setOn(box.brain, PARENT, { run: notion.run });

  const first = mirror.push(box.brain, { run: notion.run });
  assert.equal(first.created.length, 8);
  assert.deepEqual(first.failed, []);
  assert.equal(notion.pages.size, 8);
  // Sections sit under the owner's page, with a title and no body; a card sits under its section.
  const [projectsId, projects] = notion.titled('Projects');
  assert.equal(projects.parent, PARENT);
  assert.equal(projects.content, '');
  assert.equal(notion.titled('Harbor')[1].parent, projectsId);
  assert.match(notion.titled('To-dos')[1].content, /## No project\n- \[ \] Renew the passport `[0-9a-f]{5,}`\n\n## harbor\n- \[ \] Book the cutover window · due 2026-12-01 `[0-9a-f]{5,}`/);
  assert.match(notion.titled('Decisions')[1].content, /\(Harbor\) Cut over on a Sunday/);

  // Nothing changed: nothing is written.
  notion.calls.length = 0;
  const second = mirror.push(box.brain, { run: notion.run });
  assert.deepEqual([second.created.length, second.updated.length, second.unchanged], [0, 0, 8]);
  assert.ok(!notion.calls.some((call) => /^api v1\/pages( |$)|-X PATCH/.test(call)));

  // One card changes: that page is written, and no page is created.
  assert.equal(cogby(box, ['log', 'projects/harbor/card', 'Cutover rehearsed', '--source', 'runbook']).code, 0);
  const third = mirror.push(box.brain, { run: notion.run });
  assert.deepEqual(third.updated, ['projects/harbor/card']);
  assert.equal(third.created.length, 0);
  assert.match(notion.titled('Harbor')[1].content, /Cutover rehearsed/);
  assert.equal(notion.pages.size, 8);

  // A page that leaves the mirror stays in Notion and is named.
  write(box, 'areas/finance/card.md', '---\ntype: area\nmirror: false\n---\n# Finance\n\nThe monthly close.\n\n<!-- timeline -->\n');
  assert.equal(cogby(box, ['sync']).code, 0);
  const fourth = mirror.push(box.brain, { run: notion.run });
  assert.deepEqual(fourth.left.map((entry) => entry.key), ['areas/finance/card']);
  assert.equal(notion.pages.size, 8);
});

test('a push that stops halfway is picked up where it stopped, with no second page', (t) => {
  const box = seeded(t);
  const notion = fakeNotion();
  mirror.setOn(box.brain, PARENT, { run: notion.run });
  let fail = true;
  const flaky = (args, input) => (fail && args.includes('PATCH') && /Move the client portal/.test(input) ? { code: 1, out: '', err: 'rate_limited' } : notion.run(args, input));
  const first = mirror.push(box.brain, { run: flaky });
  assert.deepEqual(first.failed.map((entry) => entry.key), ['projects/harbor/card']);
  assert.match(first.failed[0].why, /rate_limited/);
  fail = false;
  const second = mirror.push(box.brain, { run: flaky });
  assert.deepEqual(second.updated, ['projects/harbor/card']);
  assert.equal(second.created.length, 0);
  assert.equal([...notion.pages.values()].filter((entry) => entry.title === 'Harbor').length, 1);
  // --limit writes that many pages and says how many are left.
  assert.equal(cogby(box, ['todo', 'add', 'One more']).code, 0);
  assert.equal(cogby(box, ['log', 'areas/finance/card', 'October closed', '--source', 'ledger']).code, 0);
  const limited = mirror.push(box.brain, { run: notion.run, limit: 1 });
  assert.equal(limited.updated.length, 1);
  assert.equal(limited.remaining, 1);
});

test('signed out of Notion: the push stops at once and says so, with nothing recorded', (t) => {
  const box = seeded(t);
  const notion = fakeNotion();
  mirror.setOn(box.brain, PARENT, { run: notion.run });
  // What ntn 0.23.31 prints, with exit 4, when nobody has signed in.
  const calls = [];
  const signedOut = (args) => {
    if (args[0] === '--version') return notion.run(args);
    calls.push(args.join(' '));
    return { code: 4, out: '', err: 'error: No workspace selected.\n  hint: Run `ntn login` first, or set NOTION_WORKSPACE_ID.\n' };
  };
  assert.throws(() => mirror.push(box.brain, { run: signedOut }), (error) => error.code === 'NTN_SIGNED_OUT' && /not signed in/.test(error.message));
  assert.equal(calls.length, 1, 'it tried once and stopped');
  assert.equal(mirror.status(box.brain, { run: notion.run }).in_notion, 0);
  // A page Notion cannot find is an error object with exit 0: still a failure, and that page only.
  mirror.push(box.brain, { run: notion.run });
  assert.equal(cogby(box, ['log', 'projects/harbor/card', 'Cutover rehearsed', '--source', 'runbook']).code, 0);
  notion.pages.delete(notion.titled('Harbor')[0]);
  const after = mirror.push(box.brain, { run: notion.run });
  assert.deepEqual(after.failed.map((entry) => entry.key), ['projects/harbor/card']);
  assert.match(after.failed[0].why, /object_not_found/);
});

test('to-dos come back: a tick is a done to-do, a new line is a new to-do, once', (t) => {
  const box = seeded(t);
  const notion = fakeNotion();
  mirror.setOn(box.brain, PARENT, { run: notion.run });
  mirror.push(box.brain, { run: notion.run });
  const page = notion.titled('To-dos')[1];

  // In Notion: tick one, add one under the project and one above every heading, reword nothing.
  page.content = page.content
    .replace('- [ ] Book the cutover window', '- [x] Book the cutover window')
    .replace('## harbor\n', '## harbor\n- [ ] Warn the support team · due 2026-12-02\n')
    .replace('## No project\n', '- [ ] Call the bank\n\n## No project\n')
    + '\n- [x] Ticked and never known\n';

  const dry = mirror.pull(box.brain, { run: notion.run, dryRun: true });
  assert.deepEqual([dry.ticked.length, dry.added.length], [1, 2]);
  assert.equal(todo.listTodos(box.brain).todos.length, 2, 'a dry run writes nothing');

  const pushed = mirror.push(box.brain, { run: notion.run });
  assert.deepEqual(pushed.pulled.ticked.map((item) => item.text), ['Book the cutover window']);
  assert.deepEqual(pushed.pulled.added.map((item) => [item.text, item.project, item.due]), [['Call the bank', '', ''], ['Warn the support team', 'harbor', '2026-12-02']]);
  const all = todo.listTodos(box.brain, { all: true }).todos;
  assert.equal(all.find((item) => item.text === 'Book the cutover window').status, 'done');
  assert.equal(all.find((item) => item.text === 'Warn the support team').source, 'notion');
  // The page was rewritten from the brain: the done one is gone, the new ones carry a tag.
  assert.doesNotMatch(page.content, /Book the cutover window|Ticked and never known/);
  assert.match(page.content, /- \[ \] Warn the support team · due 2026-12-02 `[0-9a-f]{5,}`/);

  // The same page read twice (a session with its own Notion connection, before it rewrote the page) adds nothing twice.
  const stale = '- [ ] Order the cake\n';
  assert.equal(mirror.pull(box.brain, { data: stale }).added.length, 1);
  assert.equal(mirror.pull(box.brain, { data: stale }).added.length, 0);
  // A to-do done in Cogby is never reopened by an old page that still shows it unticked.
  const before = todo.listTodos(box.brain, { all: true }).todos.filter((item) => item.status === 'done').length;
  mirror.pull(box.brain, { run: notion.run });
  assert.equal(todo.listTodos(box.brain, { all: true }).todos.filter((item) => item.status === 'done').length, before);
});

test('the To-dos page is read as Notion gives it back, by its CLI or by a connector', () => {
  // As fetched from a real Notion page on 2026-11-22 through Claude's Notion connector: the tag comes
  // back as <code>…</code>, a blank line follows each heading, bold comes back as <b>…</b>.
  const fetched = ['## No project', '', '- [ ] Renew the passport <code>a1b2c</code>', '- [x] Call the bank <code>d4e5f</code>', '', '## harbor', '',
    '- [ ] Book the cutover window · due 2026-12-01 <code>0f9e8</code>', '- [ ] Warn the <b>support</b> team · due 2026-12-02', '', '## Timeline', '', '- <b>2026-11-22</b> Dana sent the DNS list', ''].join('\n');
  assert.deepEqual(mirror.readTodoPage(fetched), { ticked: ['d4e5f'], added: [{ text: 'Warn the support team', project: 'harbor', due: '2026-12-02' }] });
  // The same page with the tag in backticks, and characters escaped.
  const plain = ['## No project', '- [x] Call the bank `d4e5f`', String.raw`- [ ] Pay invoice \#42 \(urgent\)`, '* [X] Done and never known', ''].join('\n');
  assert.deepEqual(mirror.readTodoPage(plain), { ticked: ['d4e5f'], added: [{ text: 'Pay invoice #42 (urgent)', project: '', due: '' }] });
});

test('a session with its own Notion connection: plan, page, done', (t) => {
  const box = seeded(t);
  mirror.setOn(box.brain, PARENT, { run: () => ({ code: null, out: '', err: 'not found' }) });
  // No `ntn`: Cogby says so, and names the other way.
  assert.throws(() => mirror.push(box.brain, { run: () => ({ code: null, out: '', err: 'not found' }) }), (error) => error.code === 'NO_NTN' && /cogby mirror plan/.test(error.hint));
  const section = mirror.onePage(box.brain, 'section:projects');
  assert.equal(section.parent_notion_id, PARENT);
  mirror.done(box.brain, 'section:projects', 'https://www.notion.so/Projects-aaaaaaaabbbbccccddddeeeeeeeeeeee');
  const card = mirror.onePage(box.brain, 'projects/harbor/card');
  assert.equal(card.parent_notion_id, 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee');
  assert.equal(card.action, 'create');
  const recorded = mirror.done(box.brain, 'projects/harbor/card', 'bbbbbbbbbbbbccccddddeeeeeeeeeeee');
  assert.equal(mirror.onePage(box.brain, 'projects/harbor/card').action, 'unchanged');
  assert.equal(recorded.counts.create, 6);
  // A page removed in Notion is forgotten, and made again at the next update.
  assert.equal(mirror.done(box.brain, 'projects/harbor/card', 'none').forgotten, true);
  assert.equal(mirror.onePage(box.brain, 'projects/harbor/card').action, 'create');
  assert.throws(() => mirror.onePage(box.brain, 'resources/pricing'), (error) => error.code === 'NOT_MIRRORED');
});

test('what the mirror remembers stays on this machine, and off keeps Notion as it is', (t) => {
  const box = seeded(t);
  const notion = fakeNotion();
  mirror.setOn(box.brain, PARENT, { run: notion.run });
  mirror.push(box.brain, { run: notion.run });
  const local = JSON.parse(fs.readFileSync(path.join(box.brain, '.cogby', 'local.json'), 'utf8'));
  assert.equal(local.mirror.parent, PARENT);
  assert.equal(Object.keys(local.mirror.pages).length, 8);
  const off = mirror.setOff(box.brain, { run: notion.run });
  assert.equal(off.on, false);
  assert.equal(off.in_notion, 8);
  assert.equal(notion.pages.size, 8);
  assert.throws(() => mirror.push(box.brain, { run: notion.run }), (error) => error.code === 'MIRROR_OFF');
  // On again, same page: it carries on. Another page: another mirror, nothing known under it.
  assert.equal(mirror.setOn(box.brain, undefined, { run: notion.run }).counts.unchanged, 8);
  assert.equal(mirror.setOn(box.brain, '99999999-2222-3333-4444-555555555555', { run: notion.run }).counts.create, 8);
});

test('the commands: status, on, plan, page, push through a real `ntn` on disk, pull from a file', (t) => {
  const box = seeded(t);
  // A stand-in `ntn` as a command on disk, so the push goes through the same spawn a real one would.
  const bin = path.join(box.dir, 'bin');
  const store = path.join(box.dir, 'notion.json');
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, 'fake-ntn.cjs'), `
const fs = require('fs');
const store = ${JSON.stringify(store)};
const pages = fs.existsSync(store) ? JSON.parse(fs.readFileSync(store, 'utf8')) : {};
const args = process.argv.slice(2);
const input = args[0] === '--version' ? '' : fs.readFileSync(0, 'utf8');
if (args[0] === '--version') { console.log('ntn 0.0.0-disk'); }
else if (args[1] === 'v1/pages') { const body = JSON.parse(input); const id = 'cccccccc-0000-4000-8000-' + String(Object.keys(pages).length + 1).padStart(12, '0'); pages[id] = { title: body.properties.title.title[0].text.content, content: '' }; console.log(JSON.stringify({ object: 'page', id })); }
else { const id = args[1].split('/')[2]; if (args.includes('PATCH')) pages[id].content = JSON.parse(input).replace_content.new_str; console.log(JSON.stringify({ object: 'page_markdown', id, markdown: pages[id].content })); }
if (args[1] === 'v1/pages' || args.includes('PATCH')) fs.writeFileSync(store, JSON.stringify(pages));
`);
  const command = process.platform === 'win32' ? path.join(bin, 'ntn.cmd') : path.join(bin, 'ntn');
  if (process.platform === 'win32') fs.writeFileSync(command, `@"${process.execPath}" "%~dp0fake-ntn.cjs" %*\r\n`);
  else fs.writeFileSync(command, `#!/bin/sh\nexec "${process.execPath}" "$(dirname "$0")/fake-ntn.cjs" "$@"\n`, { mode: 0o755 });
  const env = { COGBY_NTN: command };
  const at = { cwd: box.brain, env };

  assert.match(cogby(box, ['mirror'], at).out, /Notion mirror: off\.[\s\S]*not chosen yet[\s\S]*found \(ntn 0\.0\.0-disk\)/);
  const refused = cogby(box, ['mirror', 'push'], at);
  assert.equal(refused.code, 1);
  assert.match(refused.err, /The Notion mirror is off/);
  assert.match(cogby(box, ['mirror', 'on', '--parent', PARENT], at).out, /Notion mirror: on\./);
  assert.match(cogby(box, ['mirror', 'plan'], at).out, /8 to create[\s\S]*create\s+projects\/harbor\/card\s+Harbor/);
  assert.match(cogby(box, ['mirror', 'page', 'projects/harbor/card'], at).out, /^> Mirrored from Cogby/);
  assert.match(cogby(box, ['mirror', 'push', '--dry-run'], at).out, /Dry run, nothing sent: 8 pages would be written/);
  assert.ok(!fs.existsSync(store));

  const pushed = json(box, ['mirror', 'push'], at);
  assert.equal(pushed.code, 0, pushed.err);
  assert.equal(pushed.data.created.length, 8);
  const pages = Object.values(JSON.parse(fs.readFileSync(store, 'utf8')));
  // The markdown went through stdin whole: several lines, a middle dot, backticks.
  assert.match(pages.find((entry) => entry.title === 'To-dos').content, /- \[ \] Book the cutover window · due 2026-12-01 `[0-9a-f]{5,}`\n?$/);
  assert.match(cogby(box, ['mirror', 'push'], at).out, /Notion updated: 0 created, 0 updated, 8 already up to date\./);
  // While it is on, the wrap-up's form of the command is the same update.
  assert.match(cogby(box, ['mirror', 'push', '--if-on'], at).out, /Notion updated: 0 created, 0 updated, 8 already up to date\./);

  const file = path.join(box.dir, 'todos.md');
  fs.writeFileSync(file, '## harbor\n- [ ] Tell Dana the date\n');
  assert.match(cogby(box, ['mirror', 'pull', '--data', file], at).out, /From Notion: 0 to-dos ticked, 1 to-do added\.\n {2}new: Tell Dana the date \(harbor\)/);
  assert.equal(cogby(box, ['mirror', 'nonsense'], at).code, 2);
  assert.match(cogby(box, ['--help']).out, /mirror on --parent <notion page link> \| off/);
});
