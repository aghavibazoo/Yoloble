'use strict';
// Regression tests for the review-station audit (blockers, majors, minors).
// Each test failed before its fix. Same harness as tests/e2e.test.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { launch, findChrome, sleep } = require('./cdp');
const { slowDisk, serve, sampleFiles, putFolder, getFolder, openRound, snap, lineCount, settle, drag, clickAt, boxCenter } = require('./helpers');

const skip = findChrome() ? false : 'no Chromium-based browser found (set CHROME_PATH)';
const IMG0 = 'clark_ave_01__a1b2c3d4__f006138';
const ORIGINAL = () => sampleFiles();
const loaded = (b, i) => b.waitFor(`YOLOUI._snapshot().index === ${i} && YOLOUI._snapshot().owner === YOLOUI._snapshot().name`);

let server, base;
test.before(async () => { if (!skip) { server = await serve(); base = `http://127.0.0.1:${server.address().port}/index.html`; } });
test.after(() => server?.close());

async function withBrowser(fn, opts) {
  const b = await launch(opts);
  try {
    await b.goto(base); await b.waitFor('typeof YOLOUI === "object"');
    await b.evaluate('YOLOUI._storageReady()');
    const r = await fn(b);
    assert.deepEqual(b.consoleLog.filter(l => l.startsWith('EXCEPTION')), [], 'uncaught exceptions in the page');
    return r;
  } finally { await b.close(); }
}
const profileDir = tag => fs.mkdtempSync(path.join(os.tmpdir(), `yoloble-${tag}-`));

test('B1: undoing an edit while it is being written is written too (slow disk)', { skip }, () => withBrowser(async b => {
  const orig = ORIGINAL();
  await putFolder(b, 'round', orig);
  await openRound(b);
  await slowDisk(b, 1500);
  await drag(b, { x: 0.80, y: 0.80 }, { x: 0.90, y: 0.90 });
  await sleep(700);                       // the 400 ms debounce fired: the write is in flight
  await b.key('z', { ctrl: true });       // back to the original boxes
  await settle(b);
  const s = await snap(b);
  assert.equal(s.boxes.length, 3);
  assert.match(s.saveState, /All changes saved/);
  const disk = (await getFolder(b, 'round'))[`Labels/${IMG0}.txt`].toString();
  assert.equal(lineCount(disk), 3, 'the folder holds what the screen shows');
}));

module.exports = { withBrowser, profileDir, loaded, ORIGINAL, IMG0 };
