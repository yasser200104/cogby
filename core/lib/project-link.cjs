'use strict';
const fs = require('fs');
const { ctx } = require('./paths.cjs');
const { parseFrontmatter, setFrontmatterField, unsetFrontmatterField } = require('./frontmatter.cjs');

const MAX_DEPTH = 10;
function projectParent(value, childSlug) {
  const slug = String(value || '').trim();
  if (!slug) return '';
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(slug) || slug.includes('..')) throw new Error('Choose an existing project.');
  if (slug === childSlug) throw new Error('A project cannot be its own parent.');
  if (!fs.existsSync(ctx('projects', slug, 'card.md'))) throw new Error('Choose an existing project.');

  const chain = [childSlug, slug];
  let cur = slug;
  for (let hop = 0; hop < MAX_DEPTH; hop += 1) {
    let raw;
    try { raw = fs.readFileSync(ctx('projects', cur, 'card.md'), 'utf8'); } catch { return slug; }
    const fm = parseFrontmatter(raw);
    const next = fm && typeof fm.parent === 'string' ? fm.parent.trim() : '';
    if (!next) return slug;
    chain.push(next);
    if (next === childSlug) throw new Error(`That would make a loop: ${chain.join(' → ')}. Choose another parent.`);
    cur = next;
  }
  throw new Error(`That parent is nested too deep: ${chain.join(' → ')}. Choose another parent.`);
}

function setProjectParent(childSlug, parentSlug) {
  const slug = String(childSlug || '').trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(slug) || slug.includes('..')) throw new Error('Choose an existing project.');
  const cardPath = ctx('projects', slug, 'card.md');
  if (!fs.existsSync(cardPath)) throw new Error('Choose an existing project.');
  const parent = projectParent(parentSlug, slug);
  const raw = fs.readFileSync(cardPath, 'utf8');
  const fm = parseFrontmatter(raw);
  if (fm === null) throw new Error('This project\'s card is malformed (a frontmatter key repeats). Fix the card first.');
  if (!/^---\r?\n/.test(raw)) throw new Error('This project\'s card has no frontmatter block to write the parent into.');
  const previous = typeof fm.parent === 'string' && fm.parent.trim() ? fm.parent.trim() : '';
  if (previous === parent) return { slug, parent: parent || null, previous: previous || null };
  let next;
  if (!parent) next = unsetFrontmatterField(raw, 'parent');
  else if (previous) next = setFrontmatterField(raw, 'parent', parent);
  else if (/^name:.*$/m.test(raw)) next = raw.replace(/^(name:.*)$/m, `$1\nparent: ${parent}`);
  else next = setFrontmatterField(raw, 'parent', parent);
  fs.writeFileSync(cardPath, next, 'utf8');
  return { slug, parent: parent || null, previous: previous || null };
}

function projectLink(value) {
  const slug = String(value || '').trim();
  if (!slug) return '';
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(slug)) throw new Error('Choose an existing project.');
  if (!fs.existsSync(ctx('projects', slug, 'card.md'))) throw new Error('This project is no longer available. Choose another project or No project.');
  return slug;
}
module.exports = { projectLink, projectParent, setProjectParent };
