'use strict';

// Which Cogby this is: the version in the plugin's own manifest, .claude-plugin/plugin.json, of the
// program this file is part of (or of `root`). It is what a person is shown, so that on a computer
// with more than one copy of Cogby they can tell which one a chat runs: the session start says it
// (.claude/hooks/brain-context.cjs), the onboarding hello ends on it, My view prints it at its foot
// (core/brain/center.cjs), and `cogby --version` answers with it. Read, never written in anywhere,
// and shown as written: a test version such as "0.4.0-rc1" stays "0.4.0-rc1". A manifest that is
// missing, unreadable or holds something that is not a version gives '', and then nothing is shown.

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const SHAPE = /^[0-9A-Za-z][0-9A-Za-z.+-]{0,63}$/;

function pluginVersion(root = ROOT) {
  try {
    const manifest = JSON.parse(fs.readFileSync(path.join(root, '.claude-plugin', 'plugin.json'), 'utf8').replace(/^﻿/, ''));
    const version = manifest && typeof manifest.version === 'string' ? manifest.version.trim() : '';
    return SHAPE.test(version) ? version : '';
  } catch { return ''; }
}

module.exports = { pluginVersion, ROOT };
