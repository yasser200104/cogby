'use strict';

// Whether a program folder is the plugin on its own: this repository, which carries the brain's code
// and none of the full Cogby program's Console, installer or policy files. The plugin names itself in
// its package.json (`cogby-plugin`), and that is the one thing read here. A Cogby program checkout, an
// installed program and a test fixture are never it, whatever files they happen to lack.

const fs = require('fs');
const path = require('path');

const NAME = 'cogby-plugin';

function isPluginOnly(root) {
  try { return JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).name === NAME; }
  catch { return false; }
}

module.exports = { NAME, isPluginOnly };
