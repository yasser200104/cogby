'use strict';

// A debriefed meeting keeps one record in one flat folder, resources/meetings/, that points at the
// transcript where it lives and holds a short summary. Every page the meeting touched links to it,
// every line written from it cites the transcript, and the record is written once: never stale, never
// "the latest evidence", never a second copy of what the meeting decided.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { ROOT, json, newBrain, git } = require('./helpers.cjs');
const cards = require(path.join(ROOT, 'core', 'brain', 'cards.cjs'));

const AGENT = { env: { CLAUDECODE: '1' } };
const DOC = 'https://docs.google.com/document/d/1GQ_test/edit?usp=drive_web';
const read = (box, rel) => fs.readFileSync(path.join(box.brain, ...rel.split('/')), 'utf8');
const exists = (box, rel) => fs.existsSync(path.join(box.brain, ...rel.split('/')));

function brain(t) {
  const box = newBrain(t);
  const base = ['--brain', box.brain];
  const run = (args, options = AGENT) => { const out = json(box, [...args, ...base], options); assert.equal(out.code, 0, out.err || out.out); return out.data; };
  const fail = (args, options = AGENT) => { const out = json(box, [...args, ...base], options); assert.notEqual(out.code, 0, out.out); return out.data.error; };
  // A project, an area and a person: the pages a meeting usually touches.
  for (const [type, name] of [['project', 'acme'], ['area', 'delivery'], ['person', 'sam']]) {
    const made = require('child_process').spawnSync(process.execPath, [path.join(ROOT, 'core', 'ops', 'new.cjs'), type, name], { env: { ...box.env, BRAIN_DIR: box.brain }, encoding: 'utf8' });
    assert.equal(made.status, 0, made.stderr);
  }
  git(box.brain, ['add', '-A']);
  git(box.brain, ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'pages']);
  const file = (data) => { const at = path.join(box.dir, `record-${Math.random().toString(16).slice(2)}.json`); fs.writeFileSync(at, JSON.stringify(data)); return at; };
  const add = (data, options) => run(['meetings', 'add', '--data', file(data)], options);
  const refuse = (data, options) => fail(['meetings', 'add', '--data', file(data)], options);
  return { box, base, run, fail, add, refuse };
}

const MEETING = {
  title: 'Sam / Dana : 1 on 1 ', date: '2026-11-12', with: ['Sam Rivera', 'Dana Whitfield'],
  pages: ['areas/people/sam', 'projects/acme', 'delivery'],
  transcript: DOC, recording: 'https://drive.google.com/file/d/124_test/view', event: 'https://www.google.com/calendar/event?eid=abc',
  summary: ['Went through how Dana delegates: task by task, or a whole scope through a lead.', 'Onboarding moves to a lead.', 'Hiring stays open.'],
  line: '1:1 with Sam: delegation and the onboarding scope',
  written: [{ kind: 'Decision', text: 'Onboarding goes to a lead, not to Sam (owner)', page: 'projects/acme' }, { kind: 'You will', text: 'Send the delegation map (due 2026-11-14)', page: 'to-dos' }],
};
const SLUG = 'resources/meetings/2026-11-12-sam-dana-1-on-1';

test('a debrief keeps one record of the meeting, linked from every page it touched, citing the transcript', (t) => {
  const { box, run, add } = brain(t);
  const out = add(MEETING);
  assert.equal(out.status, 'written');
  assert.equal(out.slug, SLUG);
  assert.equal(out.source, `Sam / Dana : 1 on 1 2026-11-12, ${DOC}`);
  assert.deepEqual(out.pages, ['areas/people/sam', 'projects/acme/card', 'areas/delivery/card']);
  assert.deepEqual(out.links.map((link) => link.status), ['inserted', 'inserted', 'inserted']);
  assert.ok(out.commit.committed);

  const text = read(box, `${SLUG}.md`);
  for (const part of ['type: meeting', 'date: 2026-11-12', 'with: [Sam Rivera, Dana Whitfield]', 'pages:\n  - "[[areas/people/sam]]"\n  - "[[projects/acme/card]]"\n  - "[[areas/delivery/card]]"',
    `transcript: ${DOC}`, 'recording: https://drive.google.com/file/d/124_test/view', 'event: https://www.google.com/calendar/event?eid=abc',
    "title: 'Sam / Dana : 1 on 1, 2026-11-12'", '## Summary\n\n- Went through how Dana delegates', '- Hiring stays open.',
    '## Written to\n\n- Decision: Onboarding goes to a lead, not to Sam (owner) → [[projects/acme/card]]', '- You will: Send the delegation map (due 2026-11-14) → to-dos']) {
    assert.ok(text.includes(part), `the record has no ${JSON.stringify(part)}:\n${text}`);
  }
  // Marked the way every agent write is: its one line ends in agent claude-code · unconfirmed, and it is listed.
  assert.match(text, /<!-- timeline -->\n- \*\*2026-11-12\*\* \| Sam \/ Dana : 1 on 1 2026-11-12, https:\/\/docs\.google\.com\/\S+ — meeting record: a 3-line summary and 2 items written, from the transcript \[[^\]]* · agent claude-code · unconfirmed\]\n$/);
  // Each touched page links to it, dated the day of the meeting, with the transcript in the source.
  for (const rel of ['areas/people/sam.md', 'projects/acme/card.md', 'areas/delivery/card.md']) {
    assert.ok(read(box, rel).includes(`- **2026-11-12** | Sam / Dana : 1 on 1 2026-11-12, ${DOC} — 1:1 with Sam: delegation and the onboarding scope → [[${SLUG}]] [`), rel);
  }
  assert.equal(git(box.brain, ['status', '--porcelain']), '', 'the record and each line are committed');
  assert.match(git(box.brain, ['log', '--format=%s', '-4']), new RegExp(`meeting\\(${SLUG}\\)`));

  const pending = run(['unconfirmed']).unconfirmed;
  assert.ok(pending.some((item) => item.page === SLUG && /meeting record/.test(item.text)), 'the record waits on the owner like any agent line');
  assert.equal(pending.filter((item) => /\[\[resources\/meetings\//.test(item.text)).length, 3);

  // Found from each page, both ways round: the page links to it, and it links to the page.
  for (const page of ['areas/people/sam', 'acme', 'areas/delivery/card']) {
    const listed = run(['meetings', '--page', page]);
    assert.deepEqual(listed.meetings.map((m) => m.slug), [SLUG], page);
  }
  const all = run(['meetings']).meetings[0];
  assert.deepEqual([all.date, all.transcript, all.with, all.pages], ['2026-11-12', DOC, ['Sam Rivera', 'Dana Whitfield'], ['areas/people/sam', 'projects/acme/card', 'areas/delivery/card']]);
  assert.ok(fs.existsSync(all.file));
});

test('the same meeting twice writes nothing twice; another meeting of that name gets its own record', (t) => {
  const { box, run, add } = brain(t);
  add(MEETING);
  const head = git(box.brain, ['rev-parse', 'HEAD']);
  const again = add(MEETING);
  assert.equal(again.status, 'duplicate');
  assert.deepEqual(again.links.map((link) => link.status), ['duplicate', 'duplicate', 'duplicate']);
  assert.equal(git(box.brain, ['rev-parse', 'HEAD']), head, 'nothing was committed');
  // A debrief that stopped after the record is finished by running it again.
  const other = add({ ...MEETING, transcript: 'https://docs.google.com/document/d/OTHER/edit', pages: ['areas/people/sam'] });
  assert.equal(other.status, 'written');
  assert.equal(other.slug, `${SLUG}-2`);
  assert.deepEqual(run(['meetings', '--page', 'areas/people/sam']).meetings.map((m) => m.slug).sort(), [SLUG, `${SLUG}-2`]);
  assert.equal(run(['meetings', '--limit', '1']).shown, 1);
});

test('a meeting with no transcript says so, and its lines cite its name and date only', (t) => {
  const { box, add } = brain(t);
  const out = add({ ...MEETING, title: 'Call with Sam', transcript: 'none', recording: '', event: '', pages: ['sam'], written: [], line: '' });
  assert.equal(out.source, 'Call with Sam 2026-11-12');
  assert.equal(out.transcript, null);
  const text = read(box, `${out.slug}.md`);
  assert.match(text, /^transcript: none$/m);
  assert.doesNotMatch(text, /^recording:/m);
  assert.match(text, /No transcript: written from notes or what the owner said\./);
  assert.match(text, /- Nothing beyond this record and the lines linking to it\./);
  assert.match(text, /from notes, no transcript \[/);
  assert.ok(read(box, 'areas/people/sam.md').includes(`| Call with Sam 2026-11-12 — Meeting "Call with Sam" with Sam Rivera, Dana Whitfield → [[${out.slug}]] [`));
});

test('nothing is written when a page is missing, the summary is a transcript, or the line is a decision', (t) => {
  const { box, refuse } = brain(t);
  const head = git(box.brain, ['rev-parse', 'HEAD']);
  assert.equal(refuse({ ...MEETING, pages: ['areas/people/sam', 'areas/people/nobody'] }).code, 'NOT_FOUND');
  assert.equal(refuse({ ...MEETING, pages: [] }).code, 'USAGE');
  assert.equal(refuse({ ...MEETING, summary: Array.from({ length: 16 }, (_, n) => `Line ${n}`) }).code, 'TOO_LONG');
  assert.equal(refuse({ ...MEETING, summary: ['x'.repeat(401)] }).code, 'TOO_LONG');
  assert.equal(refuse({ ...MEETING, summary: [] }).code, 'USAGE');
  assert.equal(refuse({ ...MEETING, line: 'decision: onboarding goes to a lead' }).code, 'USAGE');
  assert.equal(refuse({ ...MEETING, date: '12/11/2026' }).code, 'BAD_DATE');
  assert.equal(refuse({ ...MEETING, title: '' }).code, 'USAGE');
  assert.equal(exists(box, 'resources/meetings'), false);
  assert.equal(git(box.brain, ['rev-parse', 'HEAD']), head);
  assert.equal(git(box.brain, ['status', '--porcelain']), '');
});

test('a secret said in the meeting does not reach the record', (t) => {
  const { box, add } = brain(t);
  const out = add({ ...MEETING, summary: ['Shared the staging key sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789 by mistake.', 'DB_PASSWORD=hunter2isnotsafe9 was read out.'] });
  const text = read(box, `${out.slug}.md`);
  assert.doesNotMatch(text, /sk-ant-api03-abcdefghij|hunter2isnotsafe9/);
  assert.match(text, /\[redacted:/);
});

test('a record is never stale, not the latest evidence, not a project, and is found by search and the map', (t) => {
  const { box, run, add } = brain(t);
  const before = run(['view']).counts.projects;
  // Long past the 14 days after which a page with no new evidence is flagged.
  const out = add({ ...MEETING, date: '2026-01-15', pages: ['sam'] });
  const view = run(['view']);
  assert.ok(!view.stale.some((page) => page.slug === out.slug), 'a record is not a page that went quiet');
  assert.ok(view.stale.some((page) => page.slug === 'areas/people/sam'), 'the page it touched is judged as always');
  assert.ok(!view.recent.some((line) => line.slug === out.slug), 'the record\'s own line is not what the brain last learned');
  assert.ok(view.recent.some((line) => line.slug === 'areas/people/sam' && line.summary.includes(`[[${out.slug}]]`)));
  assert.equal(view.counts.projects, before);
  const dream = run(['dream']);
  assert.ok(!dream.stale.some((page) => page.slug === out.slug));
  assert.ok(!dream.rewrite.candidates.includes(out.slug), 'a record\'s summary is never up for a rewrite');
  assert.ok(!run(['context']).text.includes(`| ${out.slug} |`));

  const resources = run(['map']).resources;
  assert.deepEqual(resources.map((entry) => [entry.name, entry.pages]), [['meetings/', 1]]);
  assert.equal(run(['search', 'delegates whole scope lead']).results[0].slug, out.slug);
  assert.ok(run(['search', 'Sam Rivera']).results.some((hit) => hit.slug === out.slug), 'found by who was there');
});

test('a record still finds a project that moved to the archive; a write never follows it there', (t) => {
  const { box, run, fail, add } = brain(t);
  const out = add({ ...MEETING, pages: ['projects/acme'] });
  fs.mkdirSync(path.join(box.brain, 'archive'), { recursive: true });
  fs.renameSync(path.join(box.brain, 'projects', 'acme'), path.join(box.brain, 'archive', 'acme'));
  run(['sync']);
  assert.deepEqual(run(['meetings', '--page', 'archive/acme']).meetings.map((m) => m.slug), [out.slug]);
  assert.deepEqual(run(['dream']).index.unresolved_links, [], 'the record\'s [[projects/acme/card]] resolves to the archived card');
  assert.equal(fail(['log', 'projects/acme', 'Something new', '--source', 'test']).code, 'NOT_FOUND');
  assert.equal(exists(box, 'archive/acme/card.md') && read(box, 'archive/acme/card.md').includes('Something new'), false);
});

test('the debrief review shows the summary, the transcript and a row for the record', () => {
  const none = () => { throw new Error('no brain needed'); };
  const html = cards.render('debrief-review', {
    title: 'Sam / Dana : 1 on 1', date: '2026-11-12', pages: ['areas/people/sam', 'projects/acme/card'],
    summary: ['Onboarding moves to a lead.', 'Hiring stays open.'], transcript: DOC,
    items: [{ kind: 'Decision', text: 'Onboarding goes to a lead', where: 'projects/acme · owner' }],
  }, none).html;
  assert.match(html, /goes on areas\/people\/sam, projects\/acme\/card/);
  assert.match(html, /For the meeting record/);
  assert.match(html, /Hiring stays open\./);
  assert.match(html, /Transcript: https:\/\/docs\.google\.com\/document\/d\/1GQ_test/);
  assert.match(html, /data-line="2"><input type="checkbox" checked><span class="tag">2 · Record<\/span>/);
  const bare = cards.render('debrief-review', { title: 'Call', summary: 'One line', transcript: 'none' }, none).html;
  assert.match(bare, /No transcript: the record says so/);
  assert.match(bare, /data-line="1"><input type="checkbox" checked><span class="tag">1 · Record/);
  // The card as it was: items alone, no record row.
  const old = cards.render('debrief-review', { title: 'Acme weekly', page: 'projects/acme', items: [{ kind: 'Fact', text: 'Budget is 12k', where: 'projects/acme' }] }, none).html;
  assert.doesNotMatch(old, /Record|For the meeting record/);
  assert.match(old, /goes on projects\/acme/);
});

test('the skills find the transcript, keep the record, and no template sends meetings to a view that does not exist', () => {
  const skill = (name) => fs.readFileSync(path.join(ROOT, '.claude', 'skills', name, 'SKILL.md'), 'utf8');
  const debrief = skill('meeting-notes');
  for (const part of ['`cogby meetings add --data <file>`', 'resources/meetings/', 'Google Calendar', 'Granola', '`get_meeting_transcript`',
    "title contains 'Transcript'", 'shortcutDetails.targetFileId', 'Never build a URL', 'lands\n   in the day\'s log', 'Speaker labels can be wrong']) {
    assert.ok(debrief.includes(part), `meeting-notes does not say ${part}`);
  }
  assert.doesNotMatch(debrief, /A meeting is not a page of its own/);
  const order = ['**The calendar event**', '**Granola.**', '**Any other meeting-notes connector**', '**A Drive search**', '**Ask**'].map((step) => debrief.indexOf(step));
  assert.deepEqual(order.slice().sort((a, b) => a - b), order, 'the lookup runs in the agreed order');
  assert.ok(order.every((at) => at > 0));
  const prep = skill('meeting-prep');
  assert.match(prep, /`cogby meetings --page <slug> --limit 3`/);
  assert.match(prep, /never copy the transcript/);
  for (const template of ['area-work-card.md', 'area-work-rules.md']) {
    const text = fs.readFileSync(path.join(ROOT, 'core', 'ops', 'templates', template), 'utf8');
    assert.doesNotMatch(text, /Meetings view/, template);
    assert.match(text, /resources\/meetings\//, template);
  }
});

test('meetings and to-dos follow the owner\'s own tools: asked once, kept as one fact, used by the skills', () => {
  // The owner, 2026-11-22 (notes 9 and 14 to 17 of their own run): to-dos must live in the tool the person already uses,
  // meetings were nowhere in the brain, and both must work for any person's tools, not his.
  const fs = require('node:fs');
  const path = require('node:path');
  const ROOT_DIR = path.join(__dirname, '..');
  const flat = (rel) => fs.readFileSync(path.join(ROOT_DIR, rel), 'utf8').replace(/\s+/g, ' ');
  const notes = flat('.claude/skills/meeting-notes/SKILL.md');
  assert.match(notes, /"Catch me up on my meetings", or the Meeting catch-up routine: every meeting held since the last record, as `catch-up\.md` beside this file says\./);
  assert.match(notes, /A fact on `areas\/work\/card` may say where the owner's meetings are recorded: try that tool first/);
  const catchUp = flat('.claude/skills/meeting-notes/catch-up.md');
  assert.match(catchUp, /Ask for one yes for everything/);
  assert.match(catchUp, /## Nobody to ask \(a scheduled run\) Write no record and no item\./);
  assert.match(catchUp, /Never guess what was said in it\./);
  // A routine that runs it asks first: it writes to pages.
  const routines = require(path.join(ROOT_DIR, 'core', 'brain', 'routines.cjs'));
  assert.equal(routines.unattended('meeting-notes, catch-up'), 'ask');
  assert.match(flat('.claude/skills/routines/SKILL.md'), /a daily meeting catch-up that runs `meeting-notes, catch-up`: it lists the meetings held and not yet written down, and writes nothing before the owner's yes/);
  // To-dos: the owner's tool first, Cogby's list only without one, never both.
  const capture = flat('.claude/skills/capture/SKILL.md');
  assert.match(capture, /add the to-do there, in that list, with its due date, and the project in its text\. Say where it went\. Do not also add it to Cogby's list\./);
  assert.match(capture, /\*\*"Connect my to-dos":\*\* ask which tool and which list, check this session can reach it, and keep the answer as that fact/);
  assert.match(flat('.claude/skills/check-in/SKILL.md'), /read the open ones there too: that list comes first, and a to-do is ticked, dropped or added where it lives\./);
  const rules = flat('AGENTS.md');
  assert.match(rules, /\*\*To-dos live where the owner keeps them\.\*\*/);
  assert.match(rules, /Never the same to-do in both\./);
  assert.match(rules, /\*\*Meetings: what is coming is read from the calendar, what was held from the brain's meeting records\*\* \(`cogby meetings`\)\./);
  assert.match(rules, /a link to the recording or transcript, never its text/);
});
