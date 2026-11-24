'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { ROOT, CLI, sandbox, newBrain } = require('./helpers.cjs');

// One server process per call list: requests in on stdin, one JSON line back per request.
function serve(box, requests, cwd) {
  const input = requests.map((request, index) => JSON.stringify({ jsonrpc: '2.0', id: index + 1, ...request })).join('\n') + '\n';
  const result = spawnSync(process.execPath, [CLI, 'serve', '--mcp'], { env: { ...box.env, CLAUDE_PROJECT_DIR: cwd || box.brain }, cwd: cwd || box.brain, encoding: 'utf8', input });
  return result.stdout.trim().split('\n').map((line) => JSON.parse(line));
}
const call = (name, args = {}) => ({ method: 'tools/call', params: { name, arguments: args } });
const body = (reply) => JSON.parse(reply.result.content[0].text);

test('the tool list is the one the plugin documents', (t) => {
  const box = newBrain(t);
  const [listed] = serve(box, [{ method: 'tools/list' }]);
  const names = listed.result.tools.map((tool) => tool.name).sort();
  const documented = JSON.parse(fs.readFileSync(path.join(ROOT, 'tests', 'tools.json'), 'utf8')).sort();
  assert.deepEqual(names, documented);
  const size = JSON.stringify(listed.result.tools).length;
  assert.ok(size < 10800, `the tool descriptions are ${size} characters: every session pays for them`);
});

test('the server and each tool have a name a person can read', (t) => {
  const box = newBrain(t);
  const [started, listed] = serve(box, [{ method: 'initialize', params: { protocolVersion: '2025-11-25' } }, { method: 'tools/list' }]);
  assert.deepEqual(started.result.serverInfo, { name: 'cogby', title: 'Cogby', version: require(path.join(ROOT, 'package.json')).version });
  assert.equal(started.result.protocolVersion, '2025-11-25');
  const titles = listed.result.tools.map((tool) => tool.title);
  for (const tool of listed.result.tools) {
    assert.ok(typeof tool.title === 'string' && tool.title.length >= 4 && tool.title.length <= 20, `${tool.name}: its title is "${tool.title}"`);
    assert.match(tool.title, /^[A-Z]/, `${tool.name}: its title does not read as a name`);
  }
  assert.equal(new Set(titles).size, titles.length, 'two tools share a title');
  assert.equal(listed.result.tools.find((tool) => tool.name === 'card').title, 'Show a card');
  assert.doesNotMatch(JSON.stringify(started.result) + JSON.stringify(listed.result), /"icons"|"websiteUrl"/, 'no icon and no hosted page were asked for');
});

test('the card tool names the five cards there are, and no other', (t) => {
  const box = newBrain(t);
  const [listed] = serve(box, [{ method: 'tools/list' }]);
  const card = listed.result.tools.find((tool) => tool.name === 'card');
  const named = /Names: ([^.]+)\./.exec(card.description)[1].split(', ');
  assert.deepEqual(named.slice().sort(), require(path.join(ROOT, 'core', 'brain', 'cards.cjs')).names().slice().sort());
  assert.equal(named.length, 5);
  assert.doesNotMatch(card.description, /setup|check-in|meeting-brief|wrap-up-summary/);
});

test('tools write as an agent and refuse a fact with no source', (t) => {
  const box = newBrain(t);
  const replies = serve(box, [
    call('remember', { slug: 'projects/demo', claim: 'Budget is 10k', create: true }),
    call('remember', { slug: 'projects/demo', claim: 'Budget is 10k', source: 'email', create: true }),
    call('log', { slug: 'projects/demo', line: 'Kickoff held', source: 'call' }),
    call('search', { query: 'budget' }),
  ]);
  assert.equal(replies[0].result.isError, true);
  assert.equal(body(replies[1]).status, 'inserted');
  assert.equal(replies[2].result.isError, false);
  assert.equal(body(replies[3]).results[0].slug, 'projects/demo');
  assert.match(body(replies[3]).index_as_of, /^\d{4}-\d\d-\d\dT/, 'a search result says when the index was last synced');
  assert.match(fs.readFileSync(path.join(box.brain, 'projects', 'demo.md'), 'utf8'), /agent/);
});

test('with no brain, a tool says so and init makes one', (t) => {
  const box = sandbox(t);
  fs.mkdirSync(path.join(box.dir, 'work'));
  const replies = serve(box, [call('search', { query: 'x' }), call('init', { path: box.brain }), call('search', { query: 'x' })], path.join(box.dir, 'work'));
  assert.equal(replies[0].result.isError, true);
  assert.match(body(replies[0]).error.message, /No brain found/);
  assert.equal(body(replies[1]).created, true);
  assert.equal(replies[2].result.isError, false);
});

test('a write through the tool server names the client that connected, and no argument can', (t) => {
  const box = newBrain(t);
  const demo = () => fs.readFileSync(path.join(box.brain, 'projects', 'demo.md'), 'utf8');
  const named = serve(box, [
    { method: 'initialize', params: { protocolVersion: '2025-06-18', clientInfo: { name: 'Some Agent/2', version: '1.0' } } },
    call('log', { slug: 'projects/demo', line: 'Kickoff held', source: 'call', date: '2026-11-10', create: true, author: 'tester' }),
    call('remember', { slug: 'projects/demo', claim: 'Budget is 10k', source: 'email', author: 'tester' }),
    // Nothing a tool call carries sets the name: these are not arguments, and are not read.
    call('log', { slug: 'projects/demo', line: 'Scope agreed', source: 'email', date: '2026-11-11', author: 'tester', agent_name: 'owner', agentName: 'owner', actor: 'human', agent: 'owner' }),
  ]);
  assert.equal(body(named[1]).line, '- **2026-11-10** | call — Kickoff held [tester · agent some-agent2 · unconfirmed]');
  assert.equal(body(named[3]).line, '- **2026-11-11** | email — Scope agreed [tester · agent some-agent2 · unconfirmed]');
  assert.match(demo(), /\| 1 \| Budget is 10k \|[^\n]*\| tester · agent some-agent2 · unconfirmed \| active \|/);

  // A client that does not say who it is, or a call with no initialize before it: an agent, no name.
  const bare = serve(box, [
    { method: 'initialize', params: { protocolVersion: '2025-06-18' } },
    call('log', { slug: 'projects/demo', line: 'Plan sent', source: 'email', date: '2026-11-12', author: 'tester', agent_name: 'owner' }),
  ]);
  assert.equal(body(bare[1]).line, '- **2026-11-12** | email — Plan sent [tester · agent · unconfirmed]');
  const [alone] = serve(box, [call('log', { slug: 'projects/demo', line: 'Plan read', source: 'call', date: '2026-11-13', author: 'tester' })]);
  assert.equal(body(alone).line, '- **2026-11-13** | call — Plan read [tester · agent · unconfirmed]');

  // All four are an agent's and unconfirmed, named or not.
  const [listed] = serve(box, [call('confirm', { action: 'list', slug: 'projects/demo' })]);
  assert.equal(body(listed).total, 5);
});
