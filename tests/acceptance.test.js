'use strict';
// Acceptance test for the review station (irs design section 12): a 50-frame
// round is opened, fully reviewed and finished without the ZIP export, the
// browser is killed mid-round and reopened with no work lost, and the folder
// Yoloble leaves behind is exactly what docs/round_format.md says irs ingest
// reads. Needs a Chromium-based browser and Python with Pillow (to generate the
// round); skipped otherwise. Set KEEP_ROUND=1 to keep the finished folder on
// disk (its path is printed) for checking with irs itself.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { launch, findChrome } = require('./cdp');
const { ROOT, serve, walk, putFolder, getFolder, openRound, snap, settle, drag, clickAt, boxCenter } = require('./helpers');
const C = require('./load-core').loadCore();

const FRAMES = 50;
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'yoloble-acceptance-'));
const roundDir = path.join(work, 'round_050');
function generate() {
  for (const py of ['python', 'python3', 'py']) {
    const r = spawnSync(py, [path.join(ROOT, 'tools', 'make_sample_round.py'), '--frames', String(FRAMES), '--out', roundDir, '--seed', '11'], { encoding: 'utf8' });
    if (r.status === 0) return true;
  }
  return false;
}
const skip = !findChrome() ? 'no Chromium-based browser found' : !generate() ? 'python with Pillow not available to generate the round' : false;
const readDir = dir => Object.fromEntries(walk(dir).map(rel => [rel, fs.readFileSync(path.join(dir, rel))]));

test('a 50-frame round is reviewed, survives a crash, and the folder matches round_format.md', { skip, timeout: 600000 }, async () => {
  const original = readDir(roundDir);
  const server = await serve();
  const base = `http://127.0.0.1:${server.address().port}/index.html`;
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'yoloble-acc-profile-'));
  const expectDeleted = new Set(), expectEmpty = new Set(), expectExtraBox = new Set(), expectReclass = new Map();
  let b;
  const start = async () => {
    b = await launch({ userDataDir: profile });
    await b.goto(base); await b.waitFor('typeof YOLOUI === "object"');
    await b.evaluate('YOLOUI._storageReady()');
  };
  const progress = () => b.evaluate(`document.getElementById('progressText').textContent`);
  const loaded = () => b.waitFor('YOLOUI._snapshot().owner !== null && YOLOUI._snapshot().owner === YOLOUI._snapshot().name');

  // Review one image the way a reviewer would; returns when it is decided.
  async function reviewOne(step) {
    await loaded();
    let s = await snap(b);
    const name = s.name;
    if (step % 11 === 4) { await b.evaluate('YOLOUI.deleteCurrentImage()'); expectDeleted.add(name); return; }
    // Fix problems the checks find (deleting duplicates, clipping), keep near-zero boxes.
    for (let guard = 0; guard < 10; guard++) {
      const errs = (await b.evaluate('YOLOUI._issues()')).filter(i => i.severity === 'error');
      if (!errs.length) break;
      await b.evaluate(`document.querySelector('#checksPanel .check-item:not(.warning) button').click()`);
    }
    s = await snap(b);
    if (!s.boxes.length) { await b.key('n'); expectEmpty.add(name); return; }
    if (step % 7 === 0) { await drag(b, { x: 0.05, y: 0.62 }, { x: 0.12, y: 0.70 }); expectExtraBox.add(name); }
    if (step % 5 === 0) {
      s = await snap(b);
      await clickAt(b, boxCenter(s.boxes[0]));
      const target = (s.boxes[0].cls + 1) % 9;
      await b.key(String(target));
      expectReclass.set(name, target);
    }
    const warn = (await b.evaluate('YOLOUI._issues()')).length > 0;
    await b.key(' ', { shift: warn });
  }

  try {
    await start();
    await putFolder(b, 'round_050', original);
    await openRound(b, 'round_050');
    assert.equal(await progress(), `0 of ${FRAMES} reviewed`);
    let step = 0;
    for (; step < 25; step++) await reviewOne(step);
    const before = await snap(b);
    await b.evaluate('YOLOUI._saveSession()');
    await b.kill(); // browser crash mid-round

    await start();
    assert.match(await b.evaluate(`document.getElementById('resumeBtn').textContent`), /Resume "round_050"/);
    await b.evaluate('YOLOUI.resumeLastFolder()');
    await b.waitFor(`getComputedStyle(document.getElementById('loadingOverlay')).display === 'none' && YOLOUI._snapshot().count > 0`);
    await b.evaluate('YOLOUI.fitToScreen()');
    const after = await snap(b);
    assert.equal(after.name, before.name, 'resumed on the same image');
    const done = 25 - [...expectDeleted].length;
    assert.equal(await progress(), `${done} of ${FRAMES} reviewed · ${expectDeleted.size} deleted`, 'no review lost');

    for (let guard = 0; guard < 200; guard++) {
      const p = await progress();
      const m = /^(\d+) of (\d+) reviewed(?: · (\d+) deleted)?$/.exec(p);
      if (+m[1] + (+m[3] || 0) === FRAMES) break;
      await reviewOne(step++);
    }
    await b.evaluate('YOLOUI.finishRound()');
    assert.equal(await b.evaluate(`document.getElementById('modalTitle').textContent`), 'Round finished',
      await b.evaluate(`document.getElementById('modalBody').textContent`));
    await settle(b);
    const disk = await getFolder(b, 'round_050');
    assert.deepEqual(b.consoleLog.filter(l => l.startsWith('EXCEPTION')), []);
    await b.close(); b = null;

    // ---- The folder, field by field (docs/round_format.md) ----
    // Layout: same files as irs queue wrote, nothing added or removed.
    assert.deepEqual(Object.keys(disk).sort(), Object.keys(original).sort());
    // Images/, round.json and classes.txt are never written.
    for (const rel of Object.keys(original)) if (rel.startsWith('Images/') || rel === 'round.json' || rel === 'classes.txt') assert.ok(original[rel].equals(disk[rel]), `${rel} changed`);
    const images = Object.keys(original).filter(r => r.startsWith('Images/')).map(r => r.slice(7));
    const rj = JSON.parse(original['round.json']);
    const classes = disk['classes.txt'].toString().split('\n').filter(Boolean);
    assert.deepEqual(classes, rj.classes, 'classes.txt equals round.json classes');
    // image_status.json: a JSON array, one entry per image, exact names, known statuses.
    const st = JSON.parse(disk['image_status.json']);
    assert.ok(Array.isArray(st));
    assert.deepEqual(st.map(r => r.name).sort(), [...images].sort());
    assert.ok(st.every(r => Object.keys(r).sort().join() === 'name,status'));
    const statusOf = Object.fromEntries(st.map(r => [r.name, r.status]));
    for (const n of images) assert.equal(statusOf[n], expectDeleted.has(n) ? 'deleted' : 'reviewed', n);
    // Labels: one file per image, same base name, valid per the irs rules.
    for (const n of images) {
      const rel = `Labels/${n.replace(/\.jpg$/, '.txt')}`;
      assert.ok(disk[rel], `${rel} exists`);
      if (expectDeleted.has(n)) continue;
      const text = disk[rel].toString();
      assert.deepEqual(C.checkLabelText(text, rj.classes.length).issues, [], `${rel} passes the irs label rules`);
      if (expectEmpty.has(n)) assert.equal(text, '', `${rel} is a confirmed empty frame`);
      else assert.ok(text.endsWith('\n') && /^(\d+( \d\.\d{6}){4}\n)+$/.test(text), `${rel} format`);
      const lines = text.split('\n').filter(Boolean);
      const orig = original[rel].toString().split('\n').filter(Boolean);
      const near = (l, want) => l.split(' ').slice(1).map(Number).every((v, k) => Math.abs(v - want[k]) < 0.005);
      if (expectExtraBox.has(n)) assert.ok(lines.some(l => near(l, [0.085, 0.66, 0.07, 0.08])), `${rel} has the drawn box:\n${text}`);
      if (expectReclass.has(n)) assert.ok(lines.some(l => l.startsWith(`${expectReclass.get(n)} `)), `${rel} has the new class`);
      if (!expectExtraBox.has(n) && !expectReclass.has(n) && !expectEmpty.has(n) && lines.length === orig.length)
        assert.deepEqual(lines, orig, `${rel} untouched when not edited`);
    }
    assert.ok(expectDeleted.size >= 4 && expectEmpty.size >= 1 && expectExtraBox.size >= 5 && expectReclass.size >= 5, 'the run exercised every kind of change');

    if (process.env.KEEP_ROUND) {
      const out = path.join(work, 'finished', 'round_050');
      for (const [rel, buf] of Object.entries(disk)) { fs.mkdirSync(path.dirname(path.join(out, rel)), { recursive: true }); fs.writeFileSync(path.join(out, rel), buf); }
      console.log('finished round kept at', out);
    }
  } finally {
    if (b) await b.close();
    server.close();
  }
});
