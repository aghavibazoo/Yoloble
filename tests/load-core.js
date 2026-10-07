// Loads the <script id="yoloble-core"> block from index.html, so the unit
// tests run against exactly the code the browser runs. No build step.
'use strict';
const fs = require('node:fs');
const path = require('node:path');

function loadCore() {
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const m = html.match(/<script id="yoloble-core">([\s\S]*?)<\/script>/);
  if (!m) throw new Error('core script block not found in index.html');
  const mod = { exports: {} };
  new Function('module', m[1])(mod);
  return mod.exports;
}

module.exports = { loadCore };
