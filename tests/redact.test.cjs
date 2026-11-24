'use strict';

// What is kept out of the day's log, which is committed with the brain: a value with a known shape,
// and a value known by the name beside it. And what must come through untouched: ordinary prose and
// code that only talk about passwords and tokens.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { ROOT, newBrain, hook, git } = require('./helpers.cjs');
const { redact } = require(path.join(ROOT, 'core', 'lib', 'redact.cjs'));

// Each secret is spelled so that it appears nowhere else in the line.
const SECRETS = [
  // [text, the secret that must be gone, what must still be there]
  ['password=hunter2', 'hunter2', 'password=[redacted:password]'],
  ['PASSWORD=correcthorse', 'correcthorse', 'PASSWORD=[redacted:password]'],
  ['DB_PASSWORD=s3cr3t!', 's3cr3t!', 'DB_PASSWORD=[redacted:password]'],
  ['passwd: hunter2', 'hunter2', 'passwd: [redacted:password]'],
  ['the db password: hunter2, as before', 'hunter2', 'password: [redacted:password], as before'],
  ['"password": "correct horse battery"', 'correct horse battery', '"password": "[redacted:password]"'],
  ["password = 'tr0ub4dor'", 'tr0ub4dor', "password = '[redacted:password]'"],
  ['**Password:** hunter2', 'hunter2', '**Password:** [redacted:password]'],
  ['pin as password=123456', '123456', 'password=[redacted:password]'],
  ['client_secret=abcDEF123ghi', 'abcDEF123ghi', 'client_secret=[redacted:secret]'],
  ['secret: 9f8a7b6c5d', '9f8a7b6c5d', 'secret: [redacted:secret]'],
  ['token=abc123def456', 'abc123def456', 'token=[redacted:token]'],
  ['MY_SERVICE_TOKEN="tok_live_99aa88bb"', 'tok_live_99aa88bb', 'MY_SERVICE_TOKEN="[redacted:token]"'],
  ['access_token: ya29.a0AfH6SMBx', 'ya29.a0AfH6SMBx', 'access_token: [redacted:token]'],
  ['api_key=AIzaSyD4f9k2', 'AIzaSyD4f9k2', 'api_key=[redacted:api key]'],
  ['apiKey: "live_4eC39HqLyjWDarjtT1zdp7dc"', 'live_4eC39HqLyjWDarjtT1zdp7dc', 'apiKey: "[redacted:api key]"'],
  ['API key: 7f3d9a2b1c', '7f3d9a2b1c', 'API key: [redacted:api key]'],
  ['x-api-key: 7f3d9a2b1c', '7f3d9a2b1c', 'x-api-key: [redacted:api key]'],
  ['AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI/K7MDENG/bPxRfiCY', 'wJalrXUtnFEMI/K7MDENG/bPxRfiCY', 'AWS_SECRET_ACCESS_KEY=[redacted:key]'],
  ["'api_key' => 'k3y-0f-mine'", 'k3y-0f-mine', "'api_key' => '[redacted:api key]'"],
  ['Authorization: Basic dXNlcjpwYXNzd29yZA==', 'dXNlcjpwYXNzd29yZA==', 'Authorization: Basic [redacted:authorization]'],
  ['Authorization: Bearer abcdef0123456789', 'abcdef0123456789', 'Authorization: Bearer [redacted:authorization]'],
  ['curl -H "Authorization: Token 9944b09199c62bcf"', '9944b09199c62bcf', 'Authorization: Token [redacted:authorization]'],
  ['authorization=q8w7e6r5t4y3', 'q8w7e6r5t4y3', 'authorization=[redacted:authorization]'],
  ['sent with Bearer mF_9.B5f-4.1JqM as the header', 'mF_9.B5f-4.1JqM', 'Bearer [redacted:bearer token] as the header'],
  ['postgres://app:hunter2@db.internal:5432/acme', 'hunter2', 'postgres://app:[redacted:password]@db.internal:5432/acme'],
  ['redis://:p4ssw0rd@cache:6379', 'p4ssw0rd', 'redis://:[redacted:password]@cache:6379'],
  ['mongodb+srv://admin:Zx9Qw@cluster0.example.net/app', 'Zx9Qw', 'mongodb+srv://admin:[redacted:password]@cluster0.example.net/app'],
  ['Server=db;User Id=app;Password=hunter2;Database=x', 'hunter2', 'Password=[redacted:password];Database=x'],
  ['jdbc:mysql://h/db?user=app&password=hunter2&ssl=true', 'hunter2', 'password=[redacted:password]&ssl=true'],
  ['mysql -u app --password hunter2 acme', 'hunter2', '--password [redacted:password] acme'],
  ['gh auth login --with-token=abc123def', 'abc123def', '--with-token=[redacted:token]'],
  ['(password=hunter2).', 'hunter2', '(password=[redacted:password]).'],
  // The shapes that were already known keep their own name.
  ['GITHUB_TOKEN=ghp_abcdefghijklmnopqrstuvwxyz0123456789', 'ghp_abcdefghijklmnopqrstuvwxyz0123456789', 'GITHUB_TOKEN=[redacted:github token]'],
  ['key AKIAIOSFODNN7EXAMPLE in the config', 'AKIAIOSFODNN7EXAMPLE', '[redacted:aws access key id]'],
  ['-----BEGIN OPENSSH PRIVATE KEY-----\nb3BlbnNzaC1rZXktdjEAAAAA\nQyNTUxOQAAACD\n-----END OPENSSH PRIVATE KEY-----', 'b3BlbnNzaC1rZXktdjEAAAAA', '[redacted:private key block]'],
  ['-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA7\nxK3mZq', 'MIIEowIBAAKCAQEA7', '[redacted:private key block]'],
];

// Prose and code that name a secret and hold none. Every one must come back exactly as it went in.
const LOOKALIKES = [
  'The password is stored in the vault, not in the repo.',
  'Reset your password: see the wiki page.',
  'Password: required, at least 12 characters.',
  'The API returns a token: store it in the keychain.',
  'Secret: always test the restore before you trust the backup.',
  'We agreed the secret to a good review is a short diff.',
  'max_tokens: 4096',
  'max_tokens=4096, temperature=0.2',
  'input_tokens: 1532, output_tokens: 288',
  'token_count = 12',
  'next_page_token: 3',
  'Each token is about four characters.',
  'The tokenizer splits on whitespace.',
  'password=password',
  'connect(user=user, password=password, token=access_token)',
  'const password = req.body.password;',
  'apiKey: process.env.API_KEY,',
  'api_key = os.environ["API_KEY"]',
  'token = getToken()',
  'password: string;',
  'password: null',
  'password=None',
  'secret: ${{ secrets.DEPLOY_KEY }}',
  'Authorization: Bearer <token>',
  'Authorization: Bearer $TOKEN',
  'Authorization: required on every endpoint',
  'the bearer of this letter',
  'Bearer authentication is used on every route.',
  '<input type="password" name="password" autocomplete="current-password">',
  'export API_KEY=<your key here>',
  'token: ***',
  'password=changeme',
  'https://example.com:8080/a@b',
  'git@github.com:globex/acme.git',
  'mailto:sara@example.com',
  'See https://docs.example.com/auth/token#refresh for the flow.',
  'The secret_key setting moved to settings.py.',
  'Add a "Forgot password?" link under the form.',
  'Kickoff held: UAT moves to 18 Nov, budget 10k.',
  'ran: 2 stale pages named, 1 decision due',
];

test('a secret known by its shape or by its name is replaced, and its name is kept', () => {
  for (const [text, secret, kept] of SECRETS) {
    const out = redact(text);
    assert.ok(!out.includes(secret), `still there: ${text} -> ${out}`);
    assert.ok(out.includes(kept), `expected "${kept}" in: ${out}`);
  }
});

test('prose and code that only talk about secrets come through untouched', () => {
  for (const text of LOOKALIKES) assert.equal(redact(text), text);
});

test('redacting twice changes nothing more, and text with no secret is returned as it is', () => {
  for (const [text] of SECRETS) assert.equal(redact(redact(text)), redact(text), text);
  assert.equal(redact(''), '');
  assert.equal(redact(null), '');
  const long = `${'An ordinary sentence about the project. '.repeat(200)}password=hunter2`;
  assert.ok(redact(long).endsWith('password=[redacted:password]'));
});

test('several secrets in one message are all taken out', () => {
  const out = redact('Use password=hunter2 and token: abc123def, then call postgres://app:pw0rd9@db/x with Authorization: Bearer zz99yy88xx77.');
  for (const secret of ['hunter2', 'abc123def', 'pw0rd9', 'zz99yy88xx77']) assert.ok(!out.includes(secret), out);
  assert.match(out, /^Use password=\[redacted:password\] and token: \[redacted:token\], then call postgres:\/\/app:\[redacted:password\]@db\/x with Authorization: Bearer \[redacted:authorization\]\.$/);
});

test('the day\'s log keeps no secret from the answer or from the owner\'s own words', (t) => {
  const box = newBrain(t);
  const transcript = path.join(box.dir, 'transcript.jsonl');
  // Past the 1,000 characters the log keeps of an ask: the secret is taken out before the cut.
  const asked = `The staging database password=hunter2 stopped working, ${'and here is some context '.repeat(50)}also token: zz99yy88xx77`;
  fs.writeFileSync(transcript, `${JSON.stringify({ type: 'user', message: { content: asked } })}\n`);
  const answer = 'I set it in the config:\n\n```\nDB_PASSWORD=hunter2\nAuthorization: Bearer abcdef0123456789\n```\n\nmax_tokens: 4096 stays as it is. The password is now in the vault.';
  const out = hook(box, 'capture-log', { session_id: 's1', hook_event_name: 'Stop', last_assistant_message: answer, transcript_path: transcript });
  assert.equal(out.code, 0, out.err);
  const dir = path.join(box.brain, '.cogby', 'self', 'log');
  const log = fs.readFileSync(path.join(dir, fs.readdirSync(dir).find((name) => /^\d{4}-\d\d-\d\d\.md$/.test(name))), 'utf8');
  for (const secret of ['hunter2', 'abcdef0123456789', 'zz99yy88xx77']) assert.ok(!log.includes(secret), `the log holds ${secret}:\n${log}`);
  assert.match(log, /> The staging database password=\[redacted:password\] stopped working/);
  assert.match(log, /DB_PASSWORD=\[redacted:password\] Authorization: Bearer \[redacted:authorization\]/);
  assert.match(log, /max_tokens: 4096 stays as it is\. The password is now in the vault\./, 'what is not a secret is kept');
  // And so no secret reaches the history when the session ends.
  hook(box, 'session-wrapup', { session_id: 's1', hook_event_name: 'SessionEnd', reason: 'exit' });
  assert.doesNotMatch(git(box.brain, ['log', '-p', '--format=%s']), /hunter2|abcdef0123456789|zz99yy88xx77/);
});
