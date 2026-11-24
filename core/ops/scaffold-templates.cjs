'use strict';

const fs = require('fs');
const path = require('path');

const TEMPLATE_DIR = path.join(__dirname, 'templates');
const TEMPLATE_CAP = 200 * 1024;
const TEMPLATE_DEFS = Object.freeze({
  'project-card': Object.freeze({
    id: 'project-card',
    filename: 'project-card.md',
    label: 'Project card',
    required: [
      ['name token', /{{name}}/],
      ['date token', /{{date}}/],
      ['project type', /^type:\s*project\s*$/m],
      ['name field', /^name:\s*{{name}}\s*$/m],
      ['organization field', /^organization:.*$/m],
      ['last-reviewed field', /^last-reviewed:\s*{{date}}\s*$/m],
    ],
  }),
  'area-card': Object.freeze({
    id: 'area-card',
    filename: 'area-card.md',
    label: 'Area card',
    required: [
      ['name token', /{{name}}/],
      ['date token', /{{date}}/],
      ['area type', /^type:\s*area\s*$/m],
      ['name field', /^name:\s*{{name}}\s*$/m],
      ['last-reviewed field', /^last-reviewed:\s*{{date}}\s*$/m],
    ],
  }),
  'area-work-card': Object.freeze({
    id: 'area-work-card',
    filename: 'area-work-card.md',
    label: 'Work area card',
    required: [
      ['name token', /{{name}}/],
      ['date token', /{{date}}/],
      ['area type', /^type:\s*area\s*$/m],
      ['name field', /^name:\s*{{name}}\s*$/m],
      ['last-reviewed field', /^last-reviewed:\s*{{date}}\s*$/m],
      ['Role section', /^## Role\s*$/m],
      ['Mandate section', /^## Mandate\s*$/m],
    ],
  }),
  'area-work-rules': Object.freeze({
    id: 'area-work-rules',
    filename: 'area-work-rules.md',
    label: 'Work area rules',
    required: [
      ['Rules heading', /^# Rules\s*$/m],
    ],
  }),
  'organization': Object.freeze({
    id: 'organization',
    filename: 'organization.md',
    label: 'Organization',
    required: [
      ['name token', /{{name}}/],
      ['date token', /{{date}}/],
      ['organization type', /^type:\s*organization\s*$/m],
      ['name field', /^name:\s*{{name}}\s*$/m],
      ['kind field', /^kind:\s*(own|client|partner|vendor)\s*$/m],
      ['domains field', /^domains:\s*\[.*\]\s*$/m],
      ['last-reviewed field', /^last-reviewed:\s*{{date}}\s*$/m],
    ],
  }),
  'person': Object.freeze({
    id: 'person',
    filename: 'person.md',
    label: 'Person',
    required: [
      ['name token', /{{name}}/],
      ['date token', /{{date}}/],
      ['person type', /^type:\s*person\s*$/m],
      ['name field', /^name:\s*{{name}}\s*$/m],
      ['role field', /^role:.*$/m],
      ['organization field', /^organization:.*$/m],
      ['last-reviewed field', /^last-reviewed:\s*{{date}}\s*$/m],
      ['review field', /^review:.*$/m],
    ],
  }),
});

function getTemplateDef(id) {
  return Object.prototype.hasOwnProperty.call(TEMPLATE_DEFS, id) ? TEMPLATE_DEFS[id] : null;
}

function templatePath(id, templateDir = TEMPLATE_DIR) {
  const def = getTemplateDef(id);
  if (!def) throw new Error('unknown scaffold template');
  return path.join(templateDir, def.filename);
}

function validateTemplate(id, text) {
  const def = getTemplateDef(id);
  if (!def) throw new Error('unknown scaffold template');
  if (typeof text !== 'string' || !text.trim()) throw new Error(def.label + ' template is empty');
  if (Buffer.byteLength(text, 'utf8') > TEMPLATE_CAP) throw new Error(def.label + ' template exceeds 200KB');
  for (const [label, pattern] of def.required) {
    if (!pattern.test(text)) throw new Error(def.label + ' template is missing its required ' + label);
  }
  const tokens = text.match(/{{[^{}]+}}/g) || [];
  for (const token of tokens) {
    if (token !== '{{name}}' && token !== '{{date}}') {
      throw new Error(def.label + ' template contains an unknown token: ' + token);
    }
  }
  return text;
}

function readTemplate(id, templateDir = TEMPLATE_DIR) {
  const file = templatePath(id, templateDir);
  let text;
  try { text = fs.readFileSync(file, 'utf8'); }
  catch (e) { throw new Error('cannot read ' + path.basename(file) + ': ' + e.message); }
  return validateTemplate(id, text);
}

function saveTemplate(id, text, templateDir = TEMPLATE_DIR) {
  const checked = validateTemplate(id, text);
  const file = templatePath(id, templateDir);
  const tmp = file + '.tmp-' + process.pid;
  try {
    fs.writeFileSync(tmp, checked, 'utf8');
    fs.renameSync(tmp, file);
  } catch (e) {
    try { fs.unlinkSync(tmp); } catch { /* no partial file to clean */ }
    throw new Error('cannot save ' + path.basename(file) + ': ' + e.message);
  }
  return { id, filename: path.basename(file), text: checked };
}

function renderTemplate(id, values, templateDir = TEMPLATE_DIR) {
  const text = readTemplate(id, templateDir);
  const name = String(values && values.name || '');
  const date = String(values && values.date || '');
  return text.split('{{name}}').join(name).split('{{date}}').join(date);
}

function listTemplates() {
  return Object.values(TEMPLATE_DEFS).map(({ id, filename, label }) => ({ id, filename, label }));
}

module.exports = {
  TEMPLATE_DIR,
  TEMPLATE_CAP,
  TEMPLATE_DEFS,
  getTemplateDef,
  templatePath,
  validateTemplate,
  readTemplate,
  saveTemplate,
  renderTemplate,
  listTemplates,
};
