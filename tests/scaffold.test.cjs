'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { ROOT, newBrain, json, cogby } = require('./helpers.cjs');

function ops(box, script, args, cwd) {
  const result = spawnSync(process.execPath, [path.join(ROOT, 'core', 'ops', script), ...args], {
    env: { ...box.env, CLAUDE_PROJECT_DIR: cwd || box.brain }, cwd: cwd || box.brain, encoding: 'utf8',
  });
  return { code: result.status, out: result.stdout || '', err: result.stderr || '' };
}
const has = (box, ...parts) => fs.existsSync(path.join(box.brain, ...parts));

test('new.cjs scaffolds a project, an area, a person and an organization inside the brain', (t) => {
  const box = newBrain(t);
  assert.equal(ops(box, 'new.cjs', ['project', 'acme']).code, 0);
  assert.ok(has(box, 'projects', 'acme', 'card.md'));
  assert.deepEqual(fs.readdirSync(path.join(box.brain, 'projects', 'acme')), ['card.md'], 'a project is one card');
  assert.equal(ops(box, 'new.cjs', ['area', 'health']).code, 0);
  assert.ok(has(box, 'areas', 'health', 'card.md'));
  assert.equal(ops(box, 'new.cjs', ['person', 'amina']).code, 0);
  assert.ok(has(box, 'areas', 'people', 'amina.md'));
  assert.equal(ops(box, 'new.cjs', ['organization', 'globex', '--kind', 'client']).code, 0);
  assert.match(fs.readFileSync(path.join(box.brain, 'areas', 'organizations', 'globex.md'), 'utf8'), /^kind: client$/m);

  const map = json(box, ['map', '--brain', box.brain]).data;
  assert.deepEqual(map.projects.map((entry) => entry.name), ['acme/']);
  assert.deepEqual(map.areas.map((entry) => entry.name), ['health/', 'organizations/', 'people/']);
  assert.equal(has(box, '.cogby', 'context-index.md'), false, 'no map file is written');
  assert.equal(fs.existsSync(path.join(ROOT, 'projects')), false, 'the scaffold wrote into the plugin folder');
});

test('new.cjs never overwrites, and refuses a name that climbs out', (t) => {
  const box = newBrain(t);
  assert.equal(ops(box, 'new.cjs', ['project', 'acme']).code, 0);
  assert.notEqual(ops(box, 'new.cjs', ['project', 'acme']).code, 0);
  assert.notEqual(ops(box, 'new.cjs', ['project', '../escape']).code, 0);
  assert.notEqual(ops(box, 'new.cjs', ['organization', 'globex']).code, 0, 'an organization needs a kind');
  assert.notEqual(ops(box, 'new.cjs', ['task', 'x']).code, 0, 'tasks are not part of the plugin');
});

test('a scaffolded project is found by search', (t) => {
  const box = newBrain(t);
  ops(box, 'new.cjs', ['project', 'acme']);
  const found = json(box, ['search', 'acme', '--brain', box.brain]);
  assert.match(found.data.results[0].slug, /^projects\/acme/);
});

test('a new brain has no map file, and nothing makes one', (t) => {
  const box = newBrain(t);
  assert.equal(has(box, '.cogby', 'context-index.md'), false);
  assert.equal(fs.existsSync(path.join(ROOT, 'core', 'ops', 'reindex.cjs')), false, 'the script that rebuilt it is gone');
  ops(box, 'new.cjs', ['standard-areas']);
  assert.equal(has(box, '.cogby', 'context-index.md'), false);
});

test('`cogby map` prints every project, area, resource and archive entry with its one line', (t) => {
  const box = newBrain(t);
  const base = ['--brain', box.brain];
  const put = (rel, text) => { const file = path.join(box.brain, ...rel.split('/')); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); };
  ops(box, 'new.cjs', ['project', 'acme']);
  ops(box, 'new.cjs', ['project', 'site', '--parent', 'acme']);
  ops(box, 'new.cjs', ['person', 'amina']);
  put('projects/website/card.md', '---\ntype: project\nstatus: paused\n---\n# Website\n\nThe new marketing site. It replaces the 2024 one.\n\n## Now\n\n- Copy review\n');
  put('projects/bare/notes.md', '# Loose notes\n');
  put('areas/health/card.md', '---\ntype: area\nlast-reviewed: 2026-11-01\n---\n# Health\n\nCheckups, insurance and the gym.\n');
  put('resources/pricing/README.md', '# Pricing notes\n\nRates by region.\n');
  put('resources/vendors.md', '# Vendor list\n');
  put('archive/old-site/card.md', '---\nclosed: 2026-10-01\n---\n# Old site\n\nThe 2024 marketing site, replaced in October.\n');
  put('archive/_drafts/x.md', '# Not an entry\n');

  // The map reads the index as it is: a file made by hand is there after the next sync, not before.
  const before = json(box, ['map', ...base]).data;
  assert.deepEqual(before.projects.map((entry) => entry.name), ['acme/', 'site/']);
  assert.equal(cogby(box, ['sync', ...base]).code, 0);

  const map = json(box, ['map', ...base]).data;
  assert.deepEqual(map.counts, { projects: 4, areas: 2, resources: 2, archive: 1 });
  const by = (bucket) => Object.fromEntries(map[bucket].map((entry) => [entry.name, entry]));
  assert.deepEqual(by('projects')['website/'], { name: 'website/', kind: 'folder', page: 'projects/website/card', title: 'Website', line: 'The new marketing site.', pages: 1, card: true, status: 'paused' });
  assert.equal(by('projects')['acme/'].line, null, 'the template sentence is not a summary');
  assert.equal(by('projects')['site/'].parent, 'acme');
  assert.deepEqual(by('projects')['bare/'], { name: 'bare/', kind: 'folder', page: null, title: null, line: null, pages: 1, card: false });
  assert.equal(by('areas')['health/'].line, 'Checkups, insurance and the gym.');
  assert.equal(by('areas')['health/'].reviewed, '2026-11-01');
  assert.equal(by('areas')['people/'].container, true);
  assert.deepEqual(by('resources')['pricing/'], { name: 'pricing/', kind: 'folder', page: 'resources/pricing/README', title: 'Pricing notes', line: 'Pricing notes', pages: 1, card: false });
  assert.deepEqual(by('resources')['vendors.md'], { name: 'vendors.md', kind: 'file', page: 'resources/vendors', title: 'Vendor list', line: 'Vendor list', pages: 1 });
  assert.equal(by('archive')['old-site/'].closed, '2026-10-01');
  assert.equal(map.index, 'on');
  assert.match(map.index_as_of, /^\d{4}-\d\d-\d\dT/);

  const text = cogby(box, ['map', ...base]).out;
  assert.match(text, /^Projects \(4\): /m);
  assert.match(text, /^  website\/\s+The new marketing site\. · paused$/m);
  assert.match(text, /^  acme\/\s+no summary yet: write one sentence under the title of its card\.md$/m);
  assert.match(text, /^  bare\/\s+no card\.md, 1 page$/m);
  assert.match(text, /^  people\/\s+1 page$/m);
  assert.match(text, /^  old-site\/\s+The 2024 marketing site, replaced in October\. · closed 2026-10-01$/m);
  assert.match(text, /Index as of \d{4}-\d\d-\d\d /);
  assert.equal(cogby(box, ['get', by('resources')['vendors.md'].page, ...base]).code, 0, 'an entry\'s page is one `cogby get` reads');

  assert.equal(cogby(box, ['map', 'projects', ...base]).code, 2, 'it takes no argument');
  assert.equal(has(box, '.cogby', 'context-index.md'), false, 'printing the map writes no file');
});

test('with the index off, the map is read from the files', (t) => {
  const box = newBrain(t);
  const base = ['--brain', box.brain];
  assert.equal(cogby(box, ['index', 'off', ...base]).code, 0);
  fs.mkdirSync(path.join(box.brain, 'projects', 'website'), { recursive: true });
  fs.writeFileSync(path.join(box.brain, 'projects', 'website', 'card.md'), '# Website\n\nThe new marketing site.\n');
  const map = json(box, ['map', ...base]).data;
  assert.equal(map.index, 'off');
  assert.deepEqual(map.projects.map((entry) => [entry.name, entry.line]), [['website/', 'The new marketing site.']]);
  assert.match(cogby(box, ['map', ...base]).out, /Index off: the files were read just now\./);
});
