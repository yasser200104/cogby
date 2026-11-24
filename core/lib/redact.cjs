'use strict';

// What is taken out of text before it is written where it will be kept: the day's log, which is
// committed with the brain, and a place's one-line description. Two kinds of thing are found.
//
// 1. A value with a known shape (SECRET_PATTERNS): a GitHub token, an AWS key id, a JWT, a private
//    key block. The whole value is replaced by `[redacted:<what>]`.
//
// 2. A value that has no shape of its own and is known by what it is called: `password=hunter2`,
//    `"api_key": "…"`, `Authorization: Basic …`, `Bearer …`, `--token …`, and the password inside
//    `postgres://user:password@host`. The name stays and the value is replaced, so the line still
//    says what was there: `password=[redacted:password]`.
//
// The second kind is where ordinary prose and code are at risk, so it is deliberately narrow:
//   - the name must END in the secret word. `max_tokens: 4096`, `token_count=12` and `tokenizer`
//     are not names of a secret; `GITHUB_TOKEN`, `db.password` and `x-api-key` are;
//   - a value that is plainly not a secret is left: a placeholder (`<token>`, `${TOKEN}`, `***`,
//     `changeme`), a reference (`process.env.API_KEY`, `req.body.password`, a function call), a word
//     like `required`, `null` or `string`, a name that itself says secret (`password=password`);
//   - written tight (`key=value`) or in quotes, anything else is a value and is replaced. Written
//     loose, as in a sentence ("the password: see the wiki"), only a value that looks made up is
//     replaced: one with a digit or a symbol in it. A number alone is not a token.
// What this cannot see: a secret given in plain words with no name beside it ("it's hunter2"), or
// named in a sentence without a colon or an equals sign ("the password is hunter2"), and a
// password made only of letters written loose ("password: correcthorse"). The rule for those is
// the one in AGENTS.md: never put a secret in a session.

const SECRET_PATTERNS = [
  { name: 'telegram token', re: /\b\d{6,}:[A-Za-z0-9_-]{30,}\b/ },
  { name: 'sk- key', re: /\bsk-[A-Za-z0-9_-]{16,}\b/ },
  { name: 'slack token', re: /\bxox[bpase]-[A-Za-z0-9-]{10,}\b/ },
  { name: 'notion token', re: /\b(?:secret_[A-Za-z0-9]{40,}|ntn_[A-Za-z0-9]{40,})\b/ },
  { name: 'jwt', re: /\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\./ },
  { name: 'github token', re: /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{40,})\b/ },
  { name: 'aws access key id', re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/ },
  // With its END line, or cut off before it: then to the end of the key's own characters.
  { name: 'private key block', re: /-----BEGIN [A-Z0-9 ]*PRIVATE KEY(?: BLOCK)?-----(?:[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY(?: BLOCK)?-----|[A-Za-z0-9+/=\s]*)/ },
];

const MARK = (name) => `[redacted:${name}]`;

// ---- values known by their name -------------------------------------------------------------------

// The words a name ends in, and what the value is called once it is gone.
const NAMES = [
  ['password', /pass(?:word|wd|phrase)/],
  ['secret', /secret/],
  ['token', /token/],
  ['api key', /api[ _-]?key/],
  ['key', /(?:access|secret|private|signing|encryption|auth)[ _-]?key/],
  ['credentials', /credentials?/],
];
const NAME_SOURCE = NAMES.map(([, re]) => re.source).join('|');
const labelOf = (name) => { const found = NAMES.find(([, re]) => new RegExp(`(?:${re.source})$`, 'i').test(name)); return found ? found[0] : 'secret'; };

// A value that is not one: a placeholder, a reference to where the secret is kept, a type, a word.
const PLACEHOLDER = /^(?:null|none|nil|true|false|undefined|empty|unset|missing|required|optional|hidden|redacted|masked|string|str|text|bool(?:ean)?|number|int(?:eger)?|any|object|here|todo|tbd|n\/a|yes|no|on|off|x{2,}|\*{2,}|\.{2,}|…+|-+|changeme|change[-_]me|your[-_\w]*|example[-_\w]*|placeholder|dummy|sample|test|foo|bar)$/i;
// A dotted path of plain names (`req.body.password`) is code; one with digits in it (`ya29.a0AfH6`) may be a token.
const REFERENCE = /^(?:\$|%\w|<|\{\{|\[redacted:)|[()]|^[A-Za-z_$]+(?:(?:\.|::|->)[A-Za-z_$]+)+;?$|^(?:process\.env|os\.environ|env|ENV|secrets|vault|config|settings)\b/;
const SAYS_SECRET = new RegExp(`^[A-Za-z_]*(?:${NAME_SOURCE}|pwd|key)[A-Za-z_]*$`, 'i');
const notASecret = (value) => !value || PLACEHOLDER.test(value) || REFERENCE.test(value) || SAYS_SECRET.test(value);
// Made up, not a word: it has a digit or a symbol in it. A number alone is a count, not a token.
const looksMadeUp = (value) => value.length >= 4 && /[0-9!@#%^&*+~=\/\\]/.test(value) && !/^\d{1,5}$/.test(value);

// name, an optional closing quote, `=`, `:` or `=>`, then a value in quotes or up to the next space.
const ASSIGNMENT = new RegExp(
  '(?<![A-Za-z0-9])'
  + `((?:[A-Za-z0-9]+[_.-])*[A-Za-z0-9]*?(?:${NAME_SOURCE}))`          // 1: the name, ending in the word
  + '(["\'`]?[*_]{0,2}(\\s*)(=>|[:=])[*_]{0,2}(\\s*))'                   // 2: what stands between (3, 5: its spaces; 4: the sign)
  + '(?:"([^"\\n]*)"|\'([^\'\\n]*)\'|`([^`\\n]*)`|([^\\s"\'`,;&]+))',    // 6-8: a quoted value; 9: a bare one
  'gi');

function assignments(text) {
  return text.replace(ASSIGNMENT, (whole, name, between, before, sign, after, dq, sq, bq, bare) => {
    const quoted = dq !== undefined || sq !== undefined || bq !== undefined;
    // A bare value ends before the punctuation that closes the sentence or the bracket around it.
    const trail = quoted ? '' : (/[.)\]}>]+$/.exec(bare) || [''])[0];
    const value = quoted ? (dq !== undefined ? dq : sq !== undefined ? sq : bq) : bare.slice(0, bare.length - trail.length);
    if (notASecret(value.trim())) return whole;
    const label = labelOf(name);
    // A count is not a token: `page_token: 3`. A password may be all digits.
    if (label !== 'password' && label !== 'secret' && /^\d+$/.test(value)) return whole;
    const tight = sign !== '=>' && !before && !after && sign === '=';
    if (!quoted && !tight && !looksMadeUp(value)) return whole;
    const quote = dq !== undefined ? '"' : sq !== undefined ? '\'' : bq !== undefined ? '`' : '';
    return `${name}${between}${quote}${MARK(label)}${quote}${trail}`;
  });
}

// `Authorization: Basic dXNlcjpwYXNz`, `Authorization: Bearer …`, and a bare `Bearer …` anywhere.
const AUTH_HEADER = /\b(authorization["'`]?\s*[:=]\s*["'`]?)(?:(basic|bearer|digest|token|negotiate|apikey)\s+)?([^\s"'`,;]+)/gi;
const BEARER = /\b(bearer\s+)([A-Za-z0-9._~+\/=-]{8,})/gi;
const opaque = (value) => (/\d/.test(value) || value.length >= 20) && !notASecret(value);

// The punctuation that closes the sentence around a value is not part of it.
const cut = (value) => { const trail = (/[.)\]}>]+$/.exec(value) || [''])[0]; return [value.slice(0, value.length - trail.length), trail]; };

const headers = (text) => text
  .replace(AUTH_HEADER, (whole, lead, scheme, given) => {
    const [value, trail] = cut(given);
    const secret = scheme ? !notASecret(value) && (opaque(value) || value.length >= 8) : opaque(value);
    return secret ? `${lead}${scheme ? `${scheme} ` : ''}${MARK('authorization')}${trail}` : whole;
  })
  .replace(BEARER, (whole, lead, given) => { const [value, trail] = cut(given); return opaque(value) ? `${lead}${MARK('bearer token')}${trail}` : whole; });

// `--password hunter2`, `--token=abc123`: a flag whose name says secret.
const FLAG = new RegExp(`(--[a-z0-9-]*(?:${NAME_SOURCE})(?:\\s+|=))(?:"([^"\\n]+)"|'([^'\\n]+)'|([^\\s"'\`,;&]+))`, 'gi');
const flags = (text) => text.replace(FLAG, (whole, lead, dq, sq, bare) => {
  const value = dq !== undefined ? dq : sq !== undefined ? sq : bare;
  if (notASecret(value) || value.startsWith('-') || (bare !== undefined && !lead.endsWith('=') && !looksMadeUp(value))) return whole;
  const quote = dq !== undefined ? '"' : sq !== undefined ? '\'' : '';
  return `${lead}${quote}${MARK(labelOf(lead.replace(/^--|[\s=]+$/g, '')))}${quote}`;
});

// scheme://user:password@host. The user and the host stay; `https://host:8080/a@b` is not one.
const CONNECTION = /\b([a-z][a-z0-9+.-]*:\/\/[^\s:@\/]*:)([^\s@\/]+)(@)/gi;
const connections = (text) => text.replace(CONNECTION, (whole, lead, value, at) => (/^(?:\$|<|\{|\*+$|x+$|\[redacted:)/i.test(value) ? whole : `${lead}${MARK('password')}${at}`));

function redact(text) {
  let out = String(text == null ? '' : text);
  if (!out) return out;
  // Shapes first, so a token that is also named keeps its more exact label.
  for (const { name, re } of SECRET_PATTERNS) {
    const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g');
    out = out.replace(g, MARK(name));
  }
  return flags(assignments(headers(connections(out))));
}

module.exports = { SECRET_PATTERNS, redact, MARK };
