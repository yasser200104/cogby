'use strict';

function parseFrontmatter(content) {
  const m = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return {};
  const out = {};
  const seen = new Set();
  for (const line of m[1].split('\n')) {
    const top = /^([A-Za-z0-9_-]+):/.exec(line);
    if (top) {
      if (seen.has(top[1])) return null;   // duplicate top-level key = injected, or corrupt
      seen.add(top[1]);
    }
    if (line.trim().startsWith('#')) continue;
    const i = line.indexOf(':');
    if (i === -1) continue;
    const k = line.slice(0, i).trim();
    if (k) out[k] = line.slice(i + 1).trim();
  }
  return out;
}

function setFrontmatterField(content, field, value) {
  if (/[\r\n]/.test(String(value))) throw new TypeError('frontmatter value contains a newline');
  const m = content.match(/^(---\r?\n)([\s\S]*?)(\r?\n---)/);
  if (!m) return content;
  const re = new RegExp(`^${field}:.*$`, 'm');
  const body = re.test(m[2]) ? m[2].replace(re, `${field}: ${value}`) : m[2] + `\n${field}: ${value}`;
  return m[1] + body + m[3] + content.slice(m[0].length);
}

function unsetFrontmatterField(content, field) {
  const m = content.match(/^(---\r?\n)([\s\S]*?)(\r?\n---)/);
  if (!m) return content;
  const re = new RegExp(`^${field}:`);
  const lines = m[2].split(/\r?\n/);
  if (!lines.some((line) => re.test(line))) return content;
  const eol = /\r\n/.test(m[2]) ? '\r\n' : '\n';
  const body = lines.filter((line) => !re.test(line)).join(eol);
  return m[1] + body + m[3] + content.slice(m[0].length);
}

function readSection(body, name) {
  const re = new RegExp(`(?:^|\\n)##\\s+${name}\\b([\\s\\S]*?)(?=\\n##\\s|$)`, 'i');
  const m = re.exec(body);
  return m ? m[1].trim() : '';
}

function replaceSection(body, name, text) {
  const re = new RegExp(`((?:^|\\n)##\\s+${name}\\b)([\\s\\S]*?)(?=\\n##\\s|$)`, 'i');
  const m = re.exec(body);
  if (m) return body.slice(0, m.index) + `${m[1]}\n\n${text}\n` + body.slice(m.index + m[0].length);
  const next = body.search(/(?:^|\n)##\s/);
  const block = `## ${name}\n\n${text}\n\n`;
  return next === -1 ? `${body.replace(/\s*$/, '')}\n\n${block}` : body.slice(0, next).replace(/\s*$/, '\n\n') + block + body.slice(next).replace(/^\n+/, '');
}

module.exports = { parseFrontmatter, setFrontmatterField, unsetFrontmatterField, readSection, replaceSection };
