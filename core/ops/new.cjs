#!/usr/bin/env node

'use strict';

const fs = require('fs');
const path = require('path');
const scaffoldTemplates = require('./scaffold-templates.cjs');
const { ctx, relCtx, STANDARD_AREAS } = require('../lib/paths.cjs');
const { projectParent } = require('../lib/project-link.cjs');

const TYPES = {
  project: { dir: 'projects' },
  area: { dir: 'areas' },
};

const ROOT = process.env.BRAIN_DIR ? path.resolve(process.env.BRAIN_DIR) : path.resolve(__dirname, '..', '..');

const EXTRA_TYPES = ['organization', 'person', 'standard-areas'];
const ORG_KINDS = ['own', 'client', 'partner', 'vendor'];

const shown = (p) => relCtx(p) || path.relative(ROOT, p);

// A page scaffolded here is a write to the brain, so it is searchable when this returns: a search
// answers from the index as it is and does not look for new files. One quick pass over the brain's
// own folder, never the mounted ones, and only when the brain keeps an index.
function indexNewPages() {
  try {
    const brainLib = require('../brain/brain.cjs');
    const brain = [path.dirname(ctx('projects'))].find((dir) => brainLib.isBrain(dir));
    if (brain && brainLib.indexWanted(brain) && brainLib.indexEnabled(brain)) brainLib.refresh(brain, { source: 'brain' });
  } catch (e) { process.stderr.write(`new: search index not updated (${e.message}); \`cogby sync\` does it\n`); }
}

function fail(message) {
  process.stderr.write(`error: ${message}\n`);
  process.stderr.write(
    'usage: node core/ops/new.cjs <type> <name>   (type ∈ project | area | organization | person)\n' +
    '       node core/ops/new.cjs standard-areas\n'
  );
  process.exit(1);
}

function today() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}


function projectCard(name) {
  return scaffoldTemplates.renderTemplate('project-card', { name, date: today() });
}

function areaCard(name) {
  return scaffoldTemplates.renderTemplate('area-card', { name, date: today() });
}

function standardAreaFiles(slug) {
  const values = { name: slug, date: today() };
  if (slug === 'work') {
    return [
      ['card.md', () => scaffoldTemplates.renderTemplate('area-work-card', values)],
      ['rules.md', () => scaffoldTemplates.renderTemplate('area-work-rules', values)],
    ];
  }
  return [['card.md', () => areaCard(slug)]];
}

function organizationFile(name, kind) {
  return scaffoldTemplates.renderTemplate('organization', { name, date: today() })
    .replace(/^kind:.*$/m, `kind: ${kind}`);
}

function personFile(name) {
  return scaffoldTemplates.renderTemplate('person', { name, date: today() });
}


const [, , typeArg, nameArg] = process.argv;

const flags = process.argv.slice(4);
const parentIdx = flags.indexOf('--parent');
const parentArg = parentIdx >= 0 ? String(flags[parentIdx + 1] || '') : '';
if (parentIdx >= 0 && !parentArg.trim()) {
  fail('--parent needs a project slug');
}
const kindIdx = flags.indexOf('--kind');
const kindArg = kindIdx >= 0 ? String(flags[kindIdx + 1] || '').trim() : '';

if (!typeArg) {
  fail('<type> is required');
}
if (typeArg === 'standard-areas') {
  if (nameArg) fail('standard-areas takes no name');
} else if (!nameArg) {
  fail('both <type> and <name> are required');
}

const isFolderType = Object.prototype.hasOwnProperty.call(TYPES, typeArg);
if (!isFolderType && !EXTRA_TYPES.includes(typeArg)) {
  fail(`invalid type "${typeArg}": must be one of project, area, organization, person, standard-areas`);
}

if (parentIdx >= 0 && typeArg !== 'project') {
  fail(`--parent applies only to \`project\` (got "${typeArg}")`);
}
if (kindIdx >= 0 && typeArg !== 'organization') {
  fail(`--kind applies only to \`organization\` (got "${typeArg}")`);
}
if (typeArg === 'organization' && !ORG_KINDS.includes(kindArg)) {
  fail(`organization needs --kind <${ORG_KINDS.join(' | ')}>` + (kindArg ? ` (got "${kindArg}")` : ''));
}

if (typeArg === 'standard-areas') {
  const plan = [];
  try {
    for (const slug of STANDARD_AREAS) {
      for (const [file, render] of standardAreaFiles(slug)) {
        const filePath = ctx('areas', slug, file);
        plan.push({ filePath, text: fs.existsSync(filePath) ? null : render() });
      }
    }
  } catch (e) {
    fail(e.message);
  }
  for (const { filePath, text } of plan) {
    if (text === null) { process.stdout.write(`exists ${shown(filePath)}\n`); continue; }
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, text, 'utf8');
    process.stdout.write(`created ${shown(filePath)}\n`);
  }
  indexNewPages();
  process.exit(0);
}

const SAFE_NAME = /^[A-Za-z0-9._-]+$/;
if (
  !SAFE_NAME.test(nameArg) ||
  nameArg === '.' ||
  nameArg === '..' ||
  nameArg.includes('..')
) {
  fail(
    `invalid name "${nameArg}" — only [A-Za-z0-9._-] allowed, no path separators, ` +
      "'..', or drive letters"
  );
}

if (typeArg === 'organization' || typeArg === 'person') {
  const container = typeArg === 'organization' ? 'organizations' : 'people';
  const containerDir = ctx('areas', container);
  fs.mkdirSync(containerDir, { recursive: true });
  const filePath = path.join(containerDir, `${nameArg}.md`);
  if (path.resolve(path.dirname(filePath)) !== path.resolve(containerDir)) {
    fail(`refusing to write outside areas/${container}/`);
  }
  if (fs.existsSync(filePath)) {
    fail(`target already exists: ${shown(filePath)} (not overwriting)`);
  }
  let text;
  try {
    text = typeArg === 'organization' ? organizationFile(nameArg, kindArg) : personFile(nameArg);
  } catch (e) {
    fail(e.message);
  }
  fs.writeFileSync(filePath, text, 'utf8');
  process.stdout.write(`created ${shown(filePath)}\n`);
  indexNewPages();
  process.exit(0);
}

const baseDir = ctx(TYPES[typeArg].dir);
const targetDir = path.join(baseDir, nameArg);

const resolvedTarget = path.resolve(targetDir);
const expectedParent = path.resolve(baseDir);
if (path.dirname(resolvedTarget) !== expectedParent) {
  fail(`refusing to write outside ${TYPES[typeArg].dir}/`);
}

if (fs.existsSync(targetDir)) {
  fail(`target already exists: ${shown(targetDir)} (not overwriting)`);
}

let typedCard = null;
try {
  if (typeArg === 'project') {
    typedCard = projectCard(nameArg);
    const parentSlug = projectParent(parentArg, nameArg);
    if (parentSlug) typedCard = typedCard.replace(/^(name:.*)$/m, `$1\nparent: ${parentSlug}`);
  } else if (typeArg === 'area') {
    typedCard = areaCard(nameArg);
  }
} catch (e) {
  fail(e.message);
}

fs.mkdirSync(targetDir, { recursive: false });

const cardPath = path.join(targetDir, 'card.md');
fs.writeFileSync(cardPath, typedCard, 'utf8');
process.stdout.write(`created ${shown(cardPath)}
`);

indexNewPages();
