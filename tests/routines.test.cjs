'use strict';

// Routines and proactivity: a routine is one page under areas/routines, its runs are dated lines on
// that page, `cogby routines` reads them back from the index as it is, a session starts by being
// told what is due, and one setting says how far Cogby goes on its own.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { ROOT, newBrain, cogby, json, hook, git } = require('./helpers.cjs');

// The in-process reads below must not leave a detached sync behind either.
process.env.COGBY_NO_BACKGROUND_SYNC = '1';

const routines = require(path.join(ROOT, 'core', 'brain', 'routines.cjs'));
const page = require(path.join(ROOT, 'core', 'brain', 'page.cjs'));
const { context } = require(path.join(ROOT, 'core', 'brain', 'context.cjs'));

const read = (box, rel) => fs.readFileSync(path.join(box.brain, ...rel.split('/')), 'utf8');
const skill = (name) => fs.readFileSync(path.join(ROOT, '.claude', 'skills', name, 'SKILL.md'), 'utf8');
// A local moment: year, month (1-12), day, hour, minute.
const at = (y, m, d, h = 12, min = 0) => new Date(y, m - 1, d, h, min);
const due = (rhythm, lastRun, now, extra = {}) => routines.dueState({ rhythm, status: 'active', last_run: lastRun ? { date: lastRun } : null, ...extra }, now);

function add(box, name, run, rhythm, extra = []) {
  const made = json(box, ['routines', 'add', name, '--run', run, '--rhythm', rhythm, ...extra, '--brain', box.brain]);
  assert.equal(made.code, 0, made.err || made.out);
  return made.data;
}
const listed = (box, args = []) => json(box, ['routines', ...args, '--brain', box.brain]).data;

// ---- rhythm and due dates ----------------------------------------------------------------------

test('a rhythm is read forgivingly and written one way', () => {
  const same = (text, written) => assert.equal(routines.renderRhythm(routines.parseRhythm(text)), written, text);
  same('daily', 'daily');
  same('Every day at 8:05', 'daily at 08:05');
  same('weekdays', 'weekdays');
  same('weekly on friday at 16:00', 'weekly on friday at 16:00');
  same('every Friday 16:00', 'weekly on friday at 16:00');
  same('weekly mon', 'weekly on monday');
  same('Fridays', 'weekly on friday');
  same('monthly on 1', 'monthly on 1');
  same('monthly on the 15th at 09:30', 'monthly on 15 at 09:30');
  same('monthly on last', 'monthly on last');
  same('monthly on 31', 'monthly on last');
  for (const bad of ['', 'sometimes', 'weekly', 'weekly on someday', 'monthly', 'monthly on 0', 'monthly on 32', 'daily at 25:00', 'every friday 4pm']) {
    assert.equal(routines.parseRhythm(bad), null, `"${bad}" should not be a rhythm`);
  }
});

test('due dates across day boundaries, in local time', () => {
  // Ran yesterday: due today. Ran today: not due until tomorrow.
  assert.deepEqual(due('daily', '2026-11-11', at(2026, 11, 12)), { state: 'due', next_due: '2026-11-12', days_overdue: 0, time: '', today: '2026-11-12' });
  assert.equal(due('daily', '2026-11-12', at(2026, 11, 12)).state, 'upcoming');
  assert.equal(due('daily', '2026-11-12', at(2026, 11, 12)).next_due, '2026-11-13');
  // One minute either side of local midnight is two different days, whatever UTC says.
  assert.equal(due('daily', '2026-11-12', at(2026, 11, 12, 23, 59)).state, 'upcoming');
  assert.equal(due('daily', '2026-11-12', at(2026, 11, 13, 0, 1)).state, 'due');
  // Three days missed: overdue since the first day missed.
  const late = due('daily', '2026-11-08', at(2026, 11, 12));
  assert.deepEqual([late.state, late.next_due, late.days_overdue], ['overdue', '2026-11-09', 3]);
  // The end of a month and of a year are ordinary days.
  assert.equal(due('daily', '2026-11-30', at(2026, 11, 30)).next_due, '2026-12-01');
  assert.equal(due('daily', '2026-12-31', at(2026, 12, 31)).next_due, '2027-01-01');
  assert.equal(due('daily', '2028-02-28', at(2028, 2, 28)).next_due, '2028-02-29', 'a leap day');
});

test('a time of day holds a routine back until that time, on its day only', () => {
  assert.equal(due('daily at 17:00', '2026-11-11', at(2026, 11, 12, 16, 59)).state, 'upcoming');
  assert.equal(due('daily at 17:00', '2026-11-11', at(2026, 11, 12, 17, 0)).state, 'due');
  assert.equal(due('daily at 17:00', '2026-11-10', at(2026, 11, 12, 8, 0)).state, 'overdue', 'yesterday\'s is overdue at any hour');
});

test('due dates across week boundaries', () => {
  // 2026-11-09 is a Monday.
  assert.equal(due('weekly on monday', '2026-11-09', at(2026, 11, 15)).state, 'upcoming', 'Sunday: next week has not started');
  assert.equal(due('weekly on monday', '2026-11-09', at(2026, 11, 15)).next_due, '2026-11-16');
  assert.equal(due('weekly on monday', '2026-11-09', at(2026, 11, 16)).state, 'due');
  const tuesday = due('weekly on monday', '2026-11-09', at(2026, 11, 17));
  assert.deepEqual([tuesday.state, tuesday.days_overdue], ['overdue', 1]);
  // Done two days late, on Wednesday: due again on its own day, not a week after the late run.
  assert.equal(due('weekly on monday', '2026-11-11', at(2026, 11, 12)).next_due, '2026-11-16');
  // Weekdays skip the weekend: ran Friday, nothing due on Saturday or Sunday, due Monday.
  assert.equal(due('weekdays', '2026-11-13', at(2026, 11, 14)).state, 'upcoming');
  assert.equal(due('weekdays', '2026-11-13', at(2026, 11, 15)).state, 'upcoming');
  assert.equal(due('weekdays', '2026-11-13', at(2026, 11, 16)).state, 'due');
  // A week that crosses the year.
  assert.equal(due('weekly on friday', '2026-12-25', at(2026, 12, 28)).next_due, '2027-01-01');
});

test('due dates across month boundaries', () => {
  assert.equal(due('monthly on 1', '2026-11-01', at(2026, 11, 30)).state, 'upcoming');
  assert.equal(due('monthly on 1', '2026-11-01', at(2026, 12, 1)).state, 'due');
  assert.equal(due('monthly on 1', '2026-12-01', at(2026, 12, 15)).next_due, '2027-01-01', 'December to January');
  // A month shorter than the day asked for runs on its last day.
  assert.equal(due('monthly on 31', '2027-01-31', at(2027, 2, 1)).next_due, '2027-02-28');
  assert.equal(due('monthly on 30', '2028-01-30', at(2028, 2, 1)).next_due, '2028-02-29', 'a leap February');
  assert.equal(due('monthly on last', '2026-04-30', at(2026, 5, 1)).next_due, '2026-05-31');
  assert.equal(due('monthly on 31', '2026-03-31', at(2026, 4, 30)).state, 'due', '30 April stands in for the 31st');
  const missed = due('monthly on 15', '2026-09-15', at(2026, 11, 12));
  assert.deepEqual([missed.state, missed.next_due, missed.days_overdue], ['overdue', '2026-10-15', 28]);
});

test('a routine that never ran is due from the day it was added, and a paused one never', () => {
  assert.equal(due('daily', null, at(2026, 11, 12), { since: '2026-11-12' }).state, 'due');
  // Added on a Thursday for Fridays: not overdue for the Friday before it existed.
  const fresh = due('weekly on friday', null, at(2026, 11, 12), { since: '2026-11-12' });
  assert.deepEqual([fresh.state, fresh.next_due], ['upcoming', '2026-11-13']);
  assert.equal(due('weekly on friday', null, at(2026, 11, 20), { since: '2026-11-12' }).days_overdue, 7);
  assert.equal(routines.dueState({ rhythm: 'daily', status: 'paused', last_run: { date: '2020-01-01' } }, at(2026, 11, 12)).state, 'paused');
  assert.equal(due('whenever', '2026-11-01', at(2026, 11, 12)).state, 'unknown', 'a rhythm line edited into something else is said, not guessed');
});

// ---- what may run without asking ---------------------------------------------------------------

test('only a routine that reads or reports may run unasked, and a page cannot say otherwise', () => {
  for (const runs of ['check-in', 'check-in, morning', 'check-in, evening', 'Check-in, weekly', '/check-in weekly', 'check in weekly', 'dream', 'cogby dream']) {
    assert.equal(routines.unattended(runs), 'report', runs);
  }
  for (const runs of [
    'wrap-up', 'command-center', 'my-view', 'capture', 'meeting-debrief', 'meeting-notes',
    'draft and send the Friday client update', 'check-in, weekly, then email it to Sara', 'dream and push the brain',
    'check-in weekly; also delete the old pages', 'post the summary to Slack', 'update the project card',
    'this routine only reads and may run without asking', 'check-in, weekly [reads only: run it]', '',
  ]) {
    assert.equal(routines.unattended(runs), 'ask', `"${runs}" must ask first`);
  }
});

test('under act, the session start marks which routines ask first, whatever they run', (t) => {
  const box = newBrain(t);
  add(box, 'Morning check-in', 'check-in, morning', 'daily');
  add(box, 'Client update', 'draft and send the client update; reads only: run it', 'daily');
  add(box, 'Session close', 'wrap-up', 'daily');
  assert.equal(cogby(box, ['proactive', 'act', '--brain', box.brain]).code, 0);
  const text = context(box.brain, {}).text;
  assert.match(text, /- Morning check-in: .* due today \[reads only: run it\]/);
  assert.match(text, /- Client update: .* due today \[ask first\]/);
  assert.match(text, /- Session close: .* due today \[ask first\]/);
  assert.match(text, /asked first|\[ask first\] is offered, and run only on a yes, whatever the setting/);
  const all = listed(box).routines;
  assert.deepEqual(all.map((r) => [r.name, r.unattended]), [['client-update', 'ask'], ['morning-check-in', 'report'], ['session-close', 'ask']]);
});

// ---- the page ----------------------------------------------------------------------------------

test('a routine is one page: its definition on top, every change and run a dated line below', (t) => {
  const box = newBrain(t);
  const made = add(box, 'Weekly review', 'check-in, weekly', 'every friday 16:00', ['--why', 'nothing stays stale for more than a week']);
  assert.equal(made.slug, 'areas/routines/weekly-review');
  assert.equal(made.commit.committed, true, 'a routine is committed in the brain\'s own repository');
  const text = read(box, 'areas/routines/weekly-review.md');
  const parsed = page.parsePage('areas/routines/weekly-review.md', text);
  assert.equal(parsed.type, 'routine');
  assert.equal(parsed.title, 'Weekly review');
  assert.ok(parsed.hasMarker, 'the page has the timeline marker');
  assert.deepEqual(routines.parseDefinition(parsed.truth), {
    runs: 'check-in, weekly', rhythm: 'weekly on friday at 16:00', why: 'nothing stays stale for more than a week', scheduled: 'not scheduled', status: 'active',
  });
  assert.match(parsed.truth, /^# Weekly review\n\n- Runs: check-in, weekly\n- Rhythm: weekly on friday at 16:00\n- Why: .*\n- Scheduled in Claude: not scheduled\n- Status: active$/);
  assert.equal(parsed.timeline.length, 1);
  assert.match(parsed.timeline[0].summary, /^added: runs "check-in, weekly", weekly on friday at 16:00$/);
  assert.equal(parsed.timeline[0].source, 'cogby routines add');
  // The folder says what it is, and a search finds the routine by what it runs.
  assert.match(read(box, 'areas/routines/card.md'), /One page per routine/);
  assert.equal(json(box, ['search', 'weekly review', '--brain', box.brain]).data.results[0].slug, 'areas/routines/weekly-review');
  assert.equal(git(box.brain, ['status', '--porcelain', '--', 'areas']), '', 'nothing of it is left uncommitted');
});

test('a page the owner edits by hand is read as it is, after a sync', (t) => {
  const box = newBrain(t);
  add(box, 'Weekly review', 'check-in, weekly', 'weekly on friday');
  const file = path.join(box.brain, 'areas', 'routines', 'weekly-review.md');
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8')
    .replace('- Rhythm: weekly on friday', '* rhythm:  Every Monday\n\nMy own note about this routine.')
    .replace('- Scheduled in Claude: not scheduled', '- Scheduled: scheduled task "weekly"'));
  // A read answers from the index as it is: the edit is not seen until a sync.
  assert.equal(listed(box).routines[0].rhythm, 'weekly on friday');
  assert.equal(cogby(box, ['sync', '--brain', box.brain]).code, 0);
  const one = listed(box).routines[0];
  assert.equal(one.rhythm, 'Every Monday');
  assert.equal(one.scheduled, 'scheduled task "weekly"');
  assert.notEqual(one.state, 'unknown', 'a rhythm typed by hand is still understood');
  // An edit through the command keeps the owner's own lines.
  assert.equal(json(box, ['routines', 'edit', 'weekly-review', '--rhythm', 'weekly on tuesday', '--brain', box.brain]).code, 0);
  const text = fs.readFileSync(file, 'utf8');
  assert.match(text, /- Rhythm: weekly on tuesday\n\nMy own note about this routine\./);
});

// ---- the commands ------------------------------------------------------------------------------

test('routines add refuses a second one of the same name, a bad rhythm and a missing prompt', (t) => {
  const box = newBrain(t);
  assert.match(cogby(box, ['routines', '--brain', box.brain]).out, /No routines yet/);
  add(box, 'Weekly review', 'check-in, weekly', 'weekly on friday');
  const base = ['--brain', box.brain];
  assert.equal(json(box, ['routines', 'add', 'weekly review', '--run', 'x', '--rhythm', 'daily', ...base]).data.error.code, 'EXISTS');
  assert.equal(json(box, ['routines', 'add', 'Other', '--run', 'x', '--rhythm', 'now and then', ...base]).data.error.code, 'BAD_RHYTHM');
  assert.equal(cogby(box, ['routines', 'add', 'Other', '--rhythm', 'daily', ...base]).code, 2, 'what it runs is required');
  assert.equal(cogby(box, ['routines', 'add', ...base]).code, 2);
  assert.equal(cogby(box, ['routines', 'frobnicate', ...base]).code, 2);
  assert.equal(listed(box).routines.length, 1);
  // Scheduled from the start, when the scheduler already confirmed it.
  const known = add(box, 'Nightly tidy-up', 'dream', 'daily', ['--scheduled', 'scheduled task: cogby-dream', '--source', 'scheduler confirmation']);
  assert.equal(known.routine.scheduled, 'scheduled task: cogby-dream');
  assert.match(read(box, 'areas/routines/nightly-tidy-up.md'), /scheduler confirmation — added: runs "dream", daily, scheduled in Claude as scheduled task: cogby-dream/);
});

test('routines lists each with its rhythm, last run, next due and whether it is overdue', (t) => {
  const box = newBrain(t);
  const base = ['--brain', box.brain];
  add(box, 'Morning check-in', 'check-in, morning', 'daily', ['--date', '2020-01-06']);
  add(box, 'Weekly review', 'check-in, weekly', 'weekly on friday', ['--date', '2020-01-06']);
  add(box, 'Evening close', 'check-in, evening', 'daily');
  assert.equal(json(box, ['routines', 'ran', 'evening-close', '--source', 'session', '--result', 'all clear', ...base]).code, 0);
  assert.equal(json(box, ['routines', 'ran', 'weekly-review', '--source', 'session', '--result', 'one stale page', '--date', '2020-01-10', ...base]).code, 0);

  const data = listed(box);
  const by = Object.fromEntries(data.routines.map((r) => [r.name, r]));
  assert.equal(data.proactive, 'suggest');
  assert.match(data.index_as_of, /^\d{4}-\d\d-\d\dT/, 'the list says how fresh the index is');
  assert.deepEqual([by['morning-check-in'].state, by['morning-check-in'].next_due, by['morning-check-in'].last_run], ['overdue', '2020-01-06', null]);
  assert.ok(by['morning-check-in'].days_overdue > 2000);
  assert.deepEqual([by['weekly-review'].state, by['weekly-review'].next_due], ['overdue', '2020-01-17'], 'the Friday after its last run');
  assert.deepEqual(by['weekly-review'].last_run, { date: '2020-01-10', source: 'session', result: 'one stale page' });
  assert.equal(by['weekly-review'].runs_recorded, 1);
  assert.equal(by['evening-close'].state, 'upcoming', 'ran today, so due tomorrow');
  assert.equal(by['evening-close'].last_run.date, data.today);
  assert.equal(data.due, 2);

  const text = cogby(box, ['routines', ...base]).out;
  assert.match(text, /morning-check-in {2}Morning check-in · runs "check-in, morning" · daily · OVERDUE since 2020-01-06/);
  assert.match(text, /last run: 2020-01-10, one stale page \(session\) · scheduled in Claude: not scheduled/);
  assert.match(text, /evening-close .* next due \d{4}-\d\d-\d\d/);
  assert.match(text, /2 due · proactivity: suggest/);

  // `due`: only those, the longest overdue first.
  const dueNow = listed(box, ['due']);
  assert.deepEqual(dueNow.routines.map((r) => r.name), ['morning-check-in', 'weekly-review']);
  assert.doesNotMatch(cogby(box, ['routines', 'due', ...base]).out, /evening-close/);
  json(box, ['routines', 'ran', 'morning', '--source', 'session', ...base]);
  json(box, ['routines', 'ran', 'weekly-review', '--source', 'session', ...base]);
  assert.match(cogby(box, ['routines', 'due', ...base]).out, /No routine is due\./);
});

test('routines edit changes one line and keeps what it was in the timeline', (t) => {
  const box = newBrain(t);
  const base = ['--brain', box.brain];
  add(box, 'Weekly review', 'check-in, weekly', 'weekly on friday');
  const edited = json(box, ['routines', 'edit', 'weekly', '--rhythm', 'monthly on the 1st', '--why', 'a month is enough', '--scheduled', 'scheduled task: cogby-weekly', '--source', 'scheduler confirmation', ...base]);
  assert.equal(edited.code, 0, edited.err || edited.out);
  assert.deepEqual([edited.data.routine.rhythm, edited.data.routine.why, edited.data.routine.scheduled], ['monthly on 1', 'a month is enough', 'scheduled task: cogby-weekly']);
  const text = read(box, 'areas/routines/weekly-review.md');
  assert.match(text, /scheduler confirmation — edited: rhythm "weekly on friday" → "monthly on 1"; why "none" → "a month is enough"; scheduled in claude "not scheduled" → "scheduled task: cogby-weekly"/);
  assert.equal((text.match(/- Rhythm:/g) || []).length, 1, 'the line is replaced, not added twice');
  // The same again changes nothing and writes nothing.
  const again = json(box, ['routines', 'edit', 'weekly', '--rhythm', 'monthly on 1', ...base]);
  assert.equal(again.data.status, 'unchanged');
  assert.equal(read(box, 'areas/routines/weekly-review.md'), text);
  // Unscheduled again, a new title, and what it runs.
  const more = json(box, ['routines', 'edit', 'weekly-review', '--scheduled', 'none', '--title', 'Monthly review', '--run', 'check-in, weekly, then draft the report', ...base]).data;
  assert.deepEqual([more.routine.scheduled, more.routine.title, more.routine.unattended], ['not scheduled', 'Monthly review', 'ask']);
  assert.equal(more.routine.name, 'weekly-review', 'the page stays where it is');
  assert.equal(cogby(box, ['routines', 'edit', 'weekly', ...base]).code, 2, 'nothing to change is a usage error');
  assert.equal(json(box, ['routines', 'edit', 'nope', '--why', 'x', ...base]).data.error.code, 'NOT_FOUND');
  assert.equal(json(box, ['routines', 'edit', 'weekly', '--rhythm', 'often', ...base]).data.error.code, 'BAD_RHYTHM');
});

test('a paused routine is never due, stays on its page, and comes back with resume', (t) => {
  const box = newBrain(t);
  const base = ['--brain', box.brain];
  add(box, 'Morning check-in', 'check-in, morning', 'daily', ['--date', '2020-01-06']);
  assert.equal(listed(box, ['due']).routines.length, 1);
  const paused = json(box, ['routines', 'pause', 'morning-check-in', '--reason', 'on holiday until the 24th', ...base]);
  assert.equal(paused.code, 0, paused.err || paused.out);
  assert.deepEqual([paused.data.routine.status, paused.data.routine.state], ['paused', 'paused']);
  assert.equal(listed(box, ['due']).routines.length, 0);
  assert.match(cogby(box, ['routines', ...base]).out, /No active routine\. 1 paused \(--all\)\./);
  assert.match(cogby(box, ['routines', '--all', ...base]).out, /morning-check-in .* paused/);
  assert.doesNotMatch(context(box.brain, {}).text, /Routines due/);
  assert.equal(json(box, ['routines', 'pause', 'morning-check-in', ...base]).data.status, 'unchanged');
  const resumed = json(box, ['routines', 'resume', 'morning-check-in', ...base]).data;
  assert.deepEqual([resumed.routine.status, resumed.routine.state], ['active', 'overdue']);
  const text = read(box, 'areas/routines/morning-check-in.md');
  assert.match(text, /cogby routines pause — paused: on holiday until the 24th/);
  assert.match(text, /cogby routines resume — resumed: active again/);
  assert.match(text, /- Status: active/);
});

test('routines ran records a run with its source and a one-line result, and refuses without a source', (t) => {
  const box = newBrain(t);
  const base = ['--brain', box.brain];
  add(box, 'Weekly review', 'check-in, weekly', 'weekly on friday');
  const none = json(box, ['routines', 'ran', 'weekly-review', '--result', 'x', ...base]);
  assert.equal(none.data.error.code, 'SOURCE_REQUIRED');
  const ran = json(box, ['routines', 'ran', 'weekly-review', '--source', 'check-in 2026-11-13', '--result', '2 stale pages named,\n1 decision due', '--date', '2026-11-13', ...base]);
  assert.equal(ran.code, 0, ran.err || ran.out);
  assert.equal(ran.data.recorded.length, 1);
  assert.match(ran.data.recorded[0].line, /^- \*\*2026-11-13\*\* \| check-in 2026-11-13 — ran: 2 stale pages named, 1 decision due \[/);
  assert.equal(ran.data.recorded[0].commit.committed, true);
  // The same run again is not written twice; a run with no result is still a run.
  assert.equal(json(box, ['routines', 'ran', 'weekly-review', '--source', 'check-in 2026-11-13', '--result', '2 stale pages named, 1 decision due', '--date', '2026-11-13', ...base]).data.recorded[0].status, 'duplicate');
  assert.equal(json(box, ['routines', 'ran', 'weekly-review', '--source', 'scheduled run', '--date', '2026-11-20', ...base]).code, 0);
  const parsed = page.parsePage('x.md', read(box, 'areas/routines/weekly-review.md'));
  assert.deepEqual(parsed.timeline.filter((line) => routines.parseRan(line.summary)).map((line) => [line.date, line.source, line.summary]), [
    ['2026-11-13', 'check-in 2026-11-13', 'ran: 2 stale pages named, 1 decision due'], ['2026-11-20', 'scheduled run', 'ran'],
  ]);
  const one = listed(box).routines[0];
  assert.deepEqual(one.last_run, { date: '2026-11-20', source: 'scheduled run', result: '' });
  assert.equal(one.runs_recorded, 2);
  assert.equal(json(box, ['routines', 'ran', 'nope', '--source', 'x', ...base]).data.error.code, 'NOT_FOUND');
  assert.equal(json(box, ['routines', 'ran', 'weekly-review', '--source', 'x', '--date', 'friday', ...base]).data.error.code, 'BAD_DATE');
});

test('a read answers from the index as it is and never syncs first', (t) => {
  const box = newBrain(t);
  const dir = path.join(box.brain, 'areas', 'routines');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'by-hand.md'), '---\ntype: routine\ntitle: By hand\n---\n# By hand\n\n- Runs: dream\n- Rhythm: daily\n\n<!-- timeline -->\n- **2020-01-01** | me — added\n');
  assert.equal(listed(box).routines.length, 0, 'a file made outside Cogby is not seen until a sync');
  assert.doesNotMatch(context(box.brain, {}).text, /Routines due/);
  assert.equal(cogby(box, ['sync', '--brain', box.brain]).code, 0);
  const one = listed(box).routines[0];
  assert.deepEqual([one.name, one.runs, one.status, one.scheduled, one.state, one.next_due], ['by-hand', 'dream', 'active', 'not scheduled', 'overdue', '2020-01-01']);
  // With the index off, the files are read on every command.
  assert.equal(cogby(box, ['index', 'off', '--brain', box.brain]).code, 0);
  assert.equal(listed(box).index, 'off');
  assert.equal(listed(box).routines.length, 1);
});

// ---- the session start -------------------------------------------------------------------------

test('session start lists what is due under suggest, and nothing when none is', (t) => {
  const box = newBrain(t);
  const quiet = hook(box, 'brain-context', { session_id: 's1', source: 'startup' });
  assert.doesNotMatch(quiet.out, /Routines/, 'no routine, nothing said');
  add(box, 'Weekly review', 'check-in, weekly', 'weekly on friday', ['--date', '2020-01-06']);
  add(box, 'Evening close', 'check-in, evening', 'daily');
  json(box, ['routines', 'ran', 'evening-close', '--source', 'session', '--result', 'a quiet day', '--brain', box.brain]);

  const started = hook(box, 'brain-context', { session_id: 's1', source: 'startup' });
  assert.equal(started.code, 0, started.err);
  assert.match(started.out, /## Routines due/);
  assert.match(started.out, /- Weekly review: runs "check-in, weekly", weekly on friday, overdue since 2020-01-10 \(\d+ days\)\n/);
  assert.doesNotMatch(started.out, /- Evening close/, 'one that ran today is not due');
  assert.match(started.out, /Proactivity is `suggest`: offer, in one line, to run what is due\. Run it only on a yes/);
  assert.doesNotMatch(started.out, /reads only|without asking/, 'suggest never tells Claude to run anything unasked');
  assert.doesNotMatch(started.out, /a quiet day/, 'a run\'s own line is not shown as the brain\'s latest evidence');

  const data = json(box, ['context', '--brain', box.brain], { cwd: box.brain }).data;
  assert.equal(data.proactive, 'suggest');
  assert.deepEqual(data.routines.map((r) => [r.name, r.state, r.unattended]), [['weekly-review', 'overdue', 'report']]);

  // Everything done: the block is gone.
  json(box, ['routines', 'ran', 'weekly-review', '--source', 'session', '--brain', box.brain]);
  assert.doesNotMatch(hook(box, 'brain-context', { session_id: 's1', source: 'startup' }).out, /Routines/);
});

test('quiet says nothing, act says which to run, and the setting is this machine\'s', (t) => {
  const box = newBrain(t);
  const base = ['--brain', box.brain];
  add(box, 'Morning check-in', 'check-in, morning', 'daily');
  add(box, 'Client update', 'draft and send the client update', 'daily');

  assert.match(cogby(box, ['proactive', ...base]).out, /^Proactivity: suggest \(/);
  const quiet = json(box, ['proactive', 'quiet', ...base]).data;
  assert.deepEqual([quiet.proactive, quiet.switched], ['quiet', true]);
  const silent = hook(box, 'brain-context', { session_id: 's1', source: 'startup' });
  assert.doesNotMatch(silent.out, /Routines|Proactivity/);
  assert.equal(json(box, ['context', ...base], { cwd: box.brain }).data.routines.length, 0);
  assert.equal(listed(box, ['due']).routines.length, 2, 'asked, it still answers');

  assert.equal(cogby(box, ['proactive', 'act', ...base]).code, 0);
  const acting = hook(box, 'brain-context', { session_id: 's1', source: 'startup' });
  assert.match(acting.out, /- Morning check-in: .*\[reads only: run it\]/);
  assert.match(acting.out, /- Client update: .*\[ask first\]/);
  assert.match(acting.out, /Proactivity is `act`: run each one marked \[reads only: run it\] now, without asking, record it with `cogby routines ran/);
  assert.match(acting.out, /`cogby notify add --status acted`/);
  assert.match(acting.out, /\[ask first\] is offered, and run only on a yes, whatever the setting/);

  // Kept with the other machine-local settings, never committed.
  assert.equal(JSON.parse(read(box, '.cogby/local.json')).proactive, 'act');
  assert.equal(git(box.brain, ['status', '--porcelain', '--', '.cogby/local.json']), '');
  assert.equal(git(box.brain, ['ls-files', '.cogby/local.json']), '');
  assert.equal(json(box, ['proactive', 'suggest', ...base]).data.proactive, 'suggest');
  assert.equal(JSON.parse(read(box, '.cogby/local.json')).proactive, undefined, 'the default is the absence of the setting');
  assert.equal(cogby(box, ['proactive', 'loud', ...base]).code, 2);
});

test('the session-start block is a few lines however many routines are due', (t) => {
  const box = newBrain(t);
  for (let i = 1; i <= 7; i++) add(box, `Routine ${i}`, `prompt number ${i} `.repeat(30), 'daily', ['--date', `2020-01-0${i}`]);
  const text = context(box.brain, {}).text;
  const block = text.slice(text.indexOf('## Routines due')).split('\n\n')[0].split('\n');
  assert.equal(block.length, 7, 'a heading, four routines, "and 3 more", one instruction');
  assert.match(block[1], /^- Routine 1: /, 'the longest overdue comes first');
  assert.match(block[5], /^- and 3 more: `cogby routines due`$/);
  for (const line of block.slice(1, 5)) assert.ok(line.length < 260, 'a long prompt is cut to a line');
});

test('outside the brain, session start names what is due in one line', (t) => {
  const box = newBrain(t);
  add(box, 'Weekly review', 'check-in, weekly', 'weekly on friday', ['--date', '2020-01-06']);
  const repo = path.join(box.dir, 'some-repo');
  fs.mkdirSync(repo);
  const started = hook(box, 'brain-context', { session_id: 's1', source: 'startup' }, { cwd: repo });
  assert.equal(started.code, 0, started.err);
  const lines = started.out.split('\n').filter((line) => /Routines due/.test(line));
  assert.equal(lines.length, 1);
  assert.match(lines[0], /^Routines due in the brain: Weekly review \(overdue \d+d\)\. Offer to run them; only on a yes/);
  cogby(box, ['proactive', 'quiet', '--brain', box.brain]);
  assert.doesNotMatch(hook(box, 'brain-context', { session_id: 's1', source: 'startup' }, { cwd: repo }).out, /Routines/);
});

test('the session-start hook calls no model and starts nothing', () => {
  const sources = ['.claude/hooks/brain-context.cjs', 'core/brain/context.cjs', 'core/brain/routines.cjs'].map((file) => fs.readFileSync(path.join(ROOT, file), 'utf8')).join('\n');
  assert.doesNotMatch(sources, /child_process|claude-bin|headless\.cjs'\)\.run|spawn\(/, 'what a session starts with is read from the index, nothing else');
});

// ---- runs recorded on their own ----------------------------------------------------------------

test('cogby dream records its own run on a routine that runs it', (t) => {
  const box = newBrain(t);
  const base = ['--brain', box.brain];
  const bare = json(box, ['dream', ...base]);
  assert.deepEqual(bare.data.routines_recorded, [], 'no routine names it: nothing is written');
  add(box, 'Nightly tidy-up', 'dream', 'daily', ['--date', '2020-01-06']);
  add(box, 'Weekly review', 'check-in, weekly', 'weekly on friday');
  assert.equal(listed(box, ['due']).routines[0].name, 'nightly-tidy-up');
  const pass = json(box, ['dream', ...base]);
  assert.equal(pass.code, 0, pass.err || pass.out);
  assert.deepEqual(pass.data.routines_recorded, ['nightly-tidy-up']);
  assert.match(cogby(box, ['dream', ...base]).out, /Recorded as a run of: nightly-tidy-up\./);
  const one = listed(box).routines.find((r) => r.name === 'nightly-tidy-up');
  assert.equal(one.last_run.source, 'cogby dream');
  assert.match(one.last_run.result, /^\d+ stale pages?, \d+ facts? to look at$/);
  assert.equal(one.runs_recorded, 1, 'two passes on one day are one line');
  assert.equal(one.state, 'upcoming');
  assert.doesNotMatch(read(box, 'areas/routines/weekly-review.md'), /ran/);
  // Its own line does not make the routine's page a candidate for a rewrite, or a stale page.
  const next = json(box, ['dream', ...base]).data;
  assert.ok(!next.rewrite.candidates.some((slug) => slug.startsWith('areas/routines/') && slug !== 'areas/routines/card'));
  assert.ok(!next.stale.some((entry) => /routines\/(nightly|weekly)/.test(entry.slug)));
});

test('a skill records its run by what it is, on every routine that runs it', (t) => {
  const box = newBrain(t);
  const base = ['--brain', box.brain];
  // No routine yet: with --if-any that is an answer, not an error.
  const nothing = json(box, ['routines', 'ran', 'check-in, weekly', '--if-any', '--source', 'check-in 2026-11-13', ...base]);
  assert.equal(nothing.code, 0);
  assert.deepEqual(nothing.data.recorded, []);
  assert.match(cogby(box, ['routines', 'ran', 'wrap-up', '--if-any', '--source', 'x', ...base]).out, /nothing recorded/);

  add(box, 'Friday review', 'check-in, weekly', 'weekly on friday');
  add(box, 'Any check-in', 'check-in', 'daily');
  add(box, 'Start of day', 'check-in, morning', 'weekdays');
  add(box, 'Close', '/wrap-up', 'weekdays');
  const weekly = json(box, ['routines', 'ran', 'check-in, weekly', '--if-any', '--source', 'check-in 2026-11-13', '--result', '2 stale', ...base]).data;
  assert.deepEqual(weekly.recorded.map((entry) => entry.name).sort(), ['any-check-in', 'friday-review']);
  assert.doesNotMatch(read(box, 'areas/routines/start-of-day.md'), /ran/, 'the morning check-in did not run');
  const wrapped = json(box, ['routines', 'ran', 'wrap-up', '--if-any', '--source', 'wrap-up 2026-11-13', '--result', 'a1b2c3d, pushed', ...base]).data;
  assert.deepEqual(wrapped.recorded.map((entry) => entry.name), ['close']);
  // A name wins over what a routine runs.
  assert.deepEqual(json(box, ['routines', 'ran', 'Start of day', '--source', 'session', ...base]).data.recorded.map((entry) => entry.name), ['start-of-day']);
});

test('the skills that are routines record their own run, unasked', () => {
  assert.match(skill('check-in'), /`cogby routines ran "check-in, <morning\|evening\|weekly>" --if-any --source "check-in <date>" --result/);
  assert.match(skill('check-in'), /Every time, without being asked/);
  assert.match(skill('wrap-up'), /`cogby routines ran wrap-up --if-any --source "wrap-up <date>" --result/);
  const dream = fs.readFileSync(path.join(ROOT, 'core', 'brain', 'dream.cjs'), 'utf8');
  assert.match(dream, /routines\.cjs'\)\.ran\(brain, 'dream'/);
});

// ---- one place for what runs on its own ---------------------------------------------------------

test('cogby proactive status shows the three switches together and changes neither of the others', (t) => {
  const box = newBrain(t);
  const base = ['--brain', box.brain];
  const first = json(box, ['proactive', 'status', ...base]).data;
  assert.deepEqual(first, { proactive: 'suggest', switched: false, wrapup: 'off', wrapup_forced_by_env: false, view_auto: true });
  assert.equal(cogby(box, ['wrapup', 'review', ...base]).code, 0);
  assert.equal(cogby(box, ['view', 'auto', 'off', ...base]).code, 0);
  assert.equal(cogby(box, ['proactive', 'act', ...base]).code, 0);
  const after = json(box, ['proactive', 'status', ...base]).data;
  assert.deepEqual([after.proactive, after.wrapup, after.view_auto], ['act', 'review', false]);
  const text = cogby(box, ['proactive', 'status', ...base]).out;
  assert.match(text, /^Proactivity: act \(.*still asks first\)\.\n/);
  assert.match(text, /Automatic wrap-up: review · cogby wrapup auto \| review \| off/);
  assert.match(text, /View page kept up to date: off · cogby view auto on \| off/);
  // The other switches still answer for themselves.
  assert.equal(json(box, ['wrapup', 'status', ...base]).data.wrapup, 'review');
  assert.equal(json(box, ['view', 'auto', 'status', ...base]).data.auto, false);
  assert.equal(json(box, ['proactive', ...base], { env: { BRAIN_WRAPUP_MODE: 'auto' } }).data.wrapup_forced_by_env, true);
});

test('the view snapshot carries the routines that are due', (t) => {
  const box = newBrain(t);
  add(box, 'Weekly review', 'check-in, weekly', 'weekly on friday', ['--date', '2020-01-06']);
  json(box, ['routines', 'ran', 'weekly-review', '--source', 's', '--result', 'r', '--date', '2020-01-10', '--brain', box.brain]);
  const view = json(box, ['view', '--brain', box.brain]).data;
  assert.equal(view.routines.proactive, 'suggest');
  assert.deepEqual(view.routines.due.map((r) => [r.name, r.state, r.next_due]), [['weekly-review', 'overdue', '2020-01-17']]);
  assert.ok(!view.recent.some((line) => line.slug.startsWith('areas/routines/')), 'a run is not one of the last lines written');
  assert.ok(!view.stale.some((entry) => entry.slug === 'areas/routines/weekly-review'), 'a routine is overdue, not stale');
});

// ---- the skill ---------------------------------------------------------------------------------

// What onboarding asks about a morning check-in, and how it switches one on, is held in onboarding.test.

test('the routines skill checks which scheduler exists and never claims a schedule unconfirmed', () => {
  const text = skill('routines');
  assert.match(text, /Check what this session has/);
  assert.match(text, /scheduled-tasks tool/);
  assert.match(text, /`\/loop`/);
  assert.match(text, /`\/schedule`/);
  assert.match(text, /None of them here:\*\* say plainly/);
  assert.match(text, /Only after the scheduler confirms/);
  assert.match(text, /Never say something is scheduled without the scheduler's confirmation/);
  assert.match(text, /A task the brain does not know/);
  assert.match(text, /never a key/);
  for (const [, rhythm] of text.matchAll(/--rhythm "([^"<…]+)"/g)) assert.ok(routines.parseRhythm(rhythm), `"${rhythm}" in the skill is not a rhythm`);
});
