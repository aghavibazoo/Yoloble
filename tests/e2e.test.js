'use strict';
// End-to-end tests: drive index.html in headless Chrome/Edge over the DevTools
// protocol. The round folder lives in the browser's origin-private file system
// (OPFS), which hands Yoloble a real read-write FileSystemDirectoryHandle, so
// the same code path as a folder picked with "Choose Folder" is exercised.
// Skipped when no Chromium-based browser is installed.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { launch, findChrome, sleep } = require('./cdp');
const { serve, sampleFiles, putFolder, getFolder, openRound, snap, lineCount, settle, drag, clickAt, boxCenter } = require('./helpers');

const skip = findChrome() ? false : 'no Chromium-based browser found (set CHROME_PATH)';

let server, base;
test.before(async () => { if (!skip) { server = await serve(); base = `http://127.0.0.1:${server.address().port}/index.html`; } });
test.after(() => server?.close());

async function withBrowser(fn, opts) {
  const b = await launch(opts);
  try {
    await b.goto(base); await b.waitFor('typeof YOLOUI === "object"');
    const r = await fn(b);
    if (process.env.SHOT) await b.screenshot(process.env.SHOT);
    const errors = b.consoleLog.filter(l => l.startsWith('EXCEPTION'));
    assert.deepEqual(errors, [], 'uncaught exceptions in the page');
    return r;
  } finally { await b.close(); }
}

const IMG0 = 'clark_ave_01__a1b2c3d4__f006138';
const ORIGINAL = () => sampleFiles();

test('edits are saved back into the folder; only label files and image_status.json change', { skip }, () => withBrowser(async b => {
  const original = ORIGINAL();
  await putFolder(b, 'round', original);
  await openRound(b);
  let s = await snap(b);
  assert.equal(s.count, 12);
  assert.equal(s.name, IMG0 + '.jpg');
  assert.equal(s.boxes.length, 3);
  assert.match(s.saveState, /All changes saved/);

  await drag(b, { x: 0.80, y: 0.80 }, { x: 0.90, y: 0.90 });
  s = await snap(b);
  assert.equal(s.boxes.length, 4);
  await settle(b);
  let disk = await getFolder(b, 'round');
  const lines = disk[`Labels/${IMG0}.txt`].toString().trim().split('\n');
  assert.equal(lines.length, 4);
  assert.match(lines[3], /^0( \d\.\d{6}){4}$/);
  const [, xc, yc, w, h] = lines[3].split(' ').map(Number);
  for (const [v, want] of [[xc, 0.85], [yc, 0.85], [w, 0.1], [h, 0.1]]) assert.ok(Math.abs(v - want) < 0.005, lines[3]);

  // Deleting an image writes image_status.json with every image, exact names.
  await b.evaluate('YOLOUI.deleteCurrentImage()');
  await settle(b);
  disk = await getFolder(b, 'round');
  const status = JSON.parse(disk['image_status.json'].toString());
  assert.equal(status.length, 12);
  assert.deepEqual(status.find(r => r.name === IMG0 + '.jpg'), { name: IMG0 + '.jpg', status: 'deleted' });
  assert.ok(status.every(r => ['unlabeled', 'labeled', 'reviewed', 'deleted'].includes(r.status)));

  // Nothing else was written, nothing was added.
  assert.deepEqual(Object.keys(disk).sort(), Object.keys(original).sort());
  for (const [rel, buf] of Object.entries(original)) {
    if (rel === 'image_status.json' || rel === `Labels/${IMG0}.txt`) continue;
    assert.ok(buf.equals(disk[rel]), `${rel} changed`);
  }
}));

test('fast key presses never move boxes from one image to another', { skip }, () => withBrowser(async b => {
  const original = ORIGINAL();
  await putFolder(b, 'round', original);
  await openRound(b);
  for (let i = 0; i < 6; i++) await b.key('d');
  for (let i = 0; i < 3; i++) await b.key('a');
  await b.evaluate('new Promise(r => setTimeout(r, 300))');
  await settle(b);
  const s = await snap(b);
  assert.equal(s.index, 3);
  const own = original[`Labels/${s.name.replace(/\.jpg$/, '.txt')}`].toString();
  assert.equal(lineCount(own), s.boxes.length, 'current image shows its own boxes');
  const disk = await getFolder(b, 'round');
  for (const [rel, buf] of Object.entries(original)) if (rel.startsWith('Labels/')) assert.ok(buf.equals(disk[rel]), `${rel} was rewritten`);
}));

test('classes: number keys, Shift+number for 10+, type-to-search picker, name labels toggle', { skip }, () => withBrowser(async b => {
  // A plain dataset folder (no round.json), where classes may be added.
  const files = ORIGINAL(); delete files['round.json'];
  await putFolder(b, 'round', files);
  await openRound(b);
  let s = await snap(b);
  // Select the first box (a Car) and change it with a number key.
  await clickAt(b, boxCenter(s.boxes[0]));
  assert.equal((await snap(b)).selected, 0);
  await b.key('8');
  s = await snap(b);
  assert.equal(s.boxes[0].cls, 8);
  assert.equal(s.currentClass, 0, 'with a box selected, the key changes the box, not the class for new boxes');
  // Type-to-search: C, "pick", Enter.
  await b.key('c');
  assert.ok(await b.evaluate(`document.getElementById('classPicker').classList.contains('show')`));
  await b.send('Input.insertText', { text: 'pick' });
  await b.key('Enter');
  s = await snap(b);
  assert.equal(s.boxes[0].cls, 1);
  assert.ok(!(await b.evaluate(`document.getElementById('classPicker').classList.contains('show')`)));
  // Undo goes back to class 8.
  await b.key('z', { ctrl: true });
  assert.equal((await snap(b)).boxes[0].cls, 8);
  // More than ten classes: add two, Shift+0 picks class 10 for new boxes.
  await b.evaluate('YOLOUI.addNewClass(); YOLOUI.addNewClass()');
  await b.key('Escape');
  assert.equal((await snap(b)).selected, -1);
  await b.key('0', { shift: true, code: 'Digit0', keyCode: 48 });
  assert.equal((await snap(b)).currentClass, 10);
  await drag(b, { x: 0.80, y: 0.80 }, { x: 0.90, y: 0.90 });
  await settle(b);
  const text = (await getFolder(b, 'round'))[`Labels/${IMG0}.txt`].toString();
  assert.match(text, /^8 0\.624491 /);
  assert.match(text.split('\n').at(-2), /^10 0\.85/);
  // Class names on boxes can be hidden with L, and the choice is remembered.
  assert.equal(await b.evaluate(`document.getElementById('showClassNames').checked`), true);
  await b.key('l');
  assert.equal(await b.evaluate(`document.getElementById('showClassNames').checked`), false);
  assert.equal(await b.evaluate(`localStorage.getItem('yoloble_show_class_names')`), '0');
  // Removing classes is refused while a folder is open.
  await b.evaluate('YOLOUI._removeClass(0)');
  assert.match(b.dialogs.at(-1), /cannot be removed or reset while a folder is open/);
}));

test('undo is per image: Ctrl+Z on another image never brings the previous image\'s boxes', { skip }, () => withBrowser(async b => {
  await putFolder(b, 'round', ORIGINAL());
  await openRound(b);
  await drag(b, { x: 0.80, y: 0.80 }, { x: 0.90, y: 0.90 });
  await b.key('d');
  await b.waitFor('YOLOUI._snapshot().index === 1 && YOLOUI._snapshot().owner === YOLOUI._snapshot().name');
  const before = (await snap(b)).boxes.length;
  assert.equal(await b.evaluate(`document.getElementById('undoBtn').disabled`), true);
  await b.key('z', { ctrl: true });
  assert.equal((await snap(b)).boxes.length, before);
  await b.key('a');
  await b.waitFor('YOLOUI._snapshot().index === 0 && YOLOUI._snapshot().owner === YOLOUI._snapshot().name');
  assert.equal((await snap(b)).boxes.length, 4);
  await b.key('z', { ctrl: true });
  assert.equal((await snap(b)).boxes.length, 3, 'undo still works on the image it belongs to');
}));

const statusFile = async b => Object.fromEntries(JSON.parse((await getFolder(b, 'round'))['image_status.json'].toString()).map(r => [r.name, r.status]));
const waitLoaded = (b, i) => b.waitFor(`YOLOUI._snapshot().index === ${i} && YOLOUI._snapshot().owner === YOLOUI._snapshot().name`);
const modal = b => b.evaluate(`({ show: document.getElementById('modalBg').classList.contains('show'), title: document.getElementById('modalTitle').textContent, body: document.getElementById('modalBody').textContent })`);

// The sample without its deliberate duplicate pre-label (an error that would stop Finish round).
function cleanSample() {
  const files = ORIGINAL(), name = 'clark_ave_01__e5f60718__f014209';
  files[`Labels/${name}.txt`] = Buffer.from(files[`Labels/${name}.txt`].toString().split('\n').slice(0, 3).join('\n') + '\n');
  const rj = JSON.parse(files['round.json']); rj.images[name + '.jpg'].prelabel_conf.pop();
  files['round.json'] = Buffer.from(JSON.stringify(rj, null, 2) + '\n');
  return files;
}

test('review: Space marks reviewed and moves on, N confirms an empty frame, progress and Finish round', { skip }, () => withBrowser(async b => {
  const original = cleanSample();
  await putFolder(b, 'round', original);
  await openRound(b);
  const names = Object.keys(original).filter(k => k.startsWith('Images/')).map(k => k.slice(7)).sort();
  // Pre-labels make images "labeled", which is not reviewed.
  assert.equal(await b.evaluate(`document.getElementById('progressText').textContent`), '0 of 12 reviewed');
  assert.equal(await b.evaluate(`document.getElementById('statusPill').textContent`), 'Not reviewed');

  await b.key(' ');
  await waitLoaded(b, 1);
  await settle(b);
  let st = await statusFile(b);
  assert.equal(st[names[0]], 'reviewed');
  assert.equal(st[names[1]], 'unlabeled', 'image with an empty pre-label file');
  assert.equal(st[names[2]], 'labeled', 'pre-labeled images are written as labeled, not reviewed');
  assert.equal(await b.evaluate(`document.getElementById('progressText').textContent`), '1 of 12 reviewed');

  // N on the empty frame: no question, reviewed, its empty file stays, next image.
  await b.key('n');
  await waitLoaded(b, 2);
  assert.equal(b.dialogs.length, 0);
  // N on an image with boxes: confirm, remove them, reviewed, empty file, next image.
  await b.key('n');
  await waitLoaded(b, 3);
  await settle(b);
  let disk = await getFolder(b, 'round');
  assert.equal(disk[`Labels/${names[1].replace('.jpg', '.txt')}`].toString(), '');
  assert.equal(disk[`Labels/${names[2].replace('.jpg', '.txt')}`].toString(), '');
  st = await statusFile(b);
  assert.equal(st[names[1]], 'reviewed');
  assert.equal(st[names[2]], 'reviewed');
  assert.match(b.dialogs.at(-1), /Remove all 2 boxes and mark this image as having no vehicles/);

  // Editing a reviewed image keeps it reviewed.
  await b.evaluate(`YOLOUI.previousImage()`);
  await waitLoaded(b, 2);
  await drag(b, { x: 0.40, y: 0.80 }, { x: 0.50, y: 0.90 });
  await settle(b);
  assert.equal((await statusFile(b))[names[2]], 'reviewed');
  // Clicking the pill un-reviews.
  await b.evaluate(`document.getElementById('statusPill').click()`);
  await settle(b);
  assert.equal((await statusFile(b))[names[2]], 'labeled');
  assert.equal(await b.evaluate(`document.getElementById('progressText').textContent`), '2 of 12 reviewed');

  // Finish with images left: warning listing them.
  await b.evaluate('YOLOUI.finishRound()');
  let m = await modal(b);
  assert.equal(m.show, true);
  assert.equal(m.title, 'Round not finished yet');
  assert.match(m.body, /10 images are not reviewed\. irs ingest stops on unreviewed images/);
  await b.key('Escape');

  // Review everything else, including deleting one.
  await b.evaluate(`YOLOUI._gotoIndex(0)`);
  await waitLoaded(b, 0);
  // Shift+Space: two sample images have deliberate problems that plain Space refuses (tested separately).
  for (let i = 1; i < 12; i++) { await b.key(' ', { shift: true }); await waitLoaded(b, i); }
  await b.evaluate('YOLOUI.deleteCurrentImage()');
  await b.key(' ');
  await b.evaluate('new Promise(r => setTimeout(r, 200))');
  assert.match(await b.evaluate(`document.getElementById('toast').textContent`), /Every image is reviewed or deleted/);
  await b.evaluate('YOLOUI.finishRound()');
  m = await modal(b);
  assert.equal(m.title, 'Round finished');
  assert.match(m.body, /11 of 12 images reviewed, 1 deleted\..*ready for irs ingest/);
  st = await statusFile(b);
  assert.deepEqual(Object.values(st).sort(), [...Array(11).fill('reviewed'), 'deleted'].sort());
  disk = await getFolder(b, 'round');
  assert.equal(disk[`Labels/${names[1].replace('.jpg', '.txt')}`].toString(), '', 'reviewed empty frame keeps its empty file');
}));

test('pre-labels: model boxes are shown unchecked with confidence until edited or reviewed, also after reopening', { skip }, async () => {
  const os = require('node:os');
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'yoloble-pre-'));
  let b = await launch({ userDataDir: profile });
  try {
    await b.goto(base); await b.waitFor('typeof YOLOUI === "object"');
    await putFolder(b, 'round', ORIGINAL());
    await openRound(b);
    assert.deepEqual(await b.evaluate('YOLOUI._round()'), { roundId: 3, modelId: 'm0005', classes: ['Car', 'Pickup Truck', 'Van', '2ax Truck', '3ax Truck', '4ax Truck', '5ax+ Truck', '2ax Bus', '3ax Bus'], images: 12 });
    let s = await snap(b);
    assert.deepEqual(s.boxes.map(x => [x.pre, x.conf]), [[true, 0.81], [true, 0.79], [true, 0.65]]);
    // Moving box 1 confirms it; the others stay unchecked.
    const c = s.boxes[1];
    await drag(b, { x: c.xc, y: c.yc }, { x: c.xc + 0.02, y: c.yc });
    s = await snap(b);
    assert.deepEqual(s.boxes.map(x => !!x.pre), [true, false, true]);
    // Changing a class confirms too.
    await clickAt(b, boxCenter(s.boxes[2]));
    await b.key('2');
    assert.deepEqual((await snap(b)).boxes.map(x => !!x.pre), [true, false, false]);
    await settle(b);
    await b.evaluate('YOLOUI._saveSession()');
  } finally { await b.close(); }

  // Reopen (normal close): the unchecked box is still unchecked; the file changed.
  b = await launch({ userDataDir: profile });
  try {
    await b.goto(base); await b.waitFor('typeof YOLOUI === "object"');
    await openRound(b);
    let s = await snap(b);
    assert.equal(b.dialogs.length, 0, 'nothing to recover');
    assert.deepEqual(s.boxes.map(x => [!!x.pre, x.conf ?? null]), [[true, 0.81], [false, null], [false, null]]);
    // Reviewing confirms everything.
    await b.key(' ');
    await b.waitFor('YOLOUI._snapshot().index === 1 && YOLOUI._snapshot().owner === YOLOUI._snapshot().name');
    await b.evaluate('YOLOUI.previousImage()');
    await b.waitFor('YOLOUI._snapshot().index === 0 && YOLOUI._snapshot().owner === YOLOUI._snapshot().name');
    assert.deepEqual((await snap(b)).boxes.map(x => !!x.pre), [false, false, false]);
  } finally { await b.close(); }
});

test('pre-labels: not trusted when the file no longer matches round.json, absent without round.json, refused for an unknown format', { skip }, () => withBrowser(async b => {
  const files = ORIGINAL();
  const changed = `Labels/${IMG0}.txt`;
  files[changed] = Buffer.concat([files[changed], Buffer.from('2 0.100000 0.100000 0.050000 0.050000\n')]);
  await putFolder(b, 'round', files);
  await openRound(b);
  assert.deepEqual((await snap(b)).boxes.map(x => !!x.pre), [false, false, false, false]);
  await b.evaluate('YOLOUI.addNewClass()');
  assert.match(b.dialogs.at(-1), /class list comes from round\.json/);
  await b.evaluate('YOLOUI.nextImage()');
  await b.evaluate('YOLOUI.nextImage()');
  await b.waitFor('YOLOUI._snapshot().index === 2 && YOLOUI._snapshot().owner === YOLOUI._snapshot().name');
  assert.ok((await snap(b)).boxes.every(x => x.pre), 'other images still show their pre-labels');

  const legacy = ORIGINAL(); delete legacy['round.json'];
  await putFolder(b, 'legacy', legacy);
  await openRound(b, 'legacy');
  assert.equal(await b.evaluate('YOLOUI._round()'), null);
  assert.ok((await snap(b)).boxes.every(x => !x.pre));

  const future = ORIGINAL(); future['round.json'] = Buffer.from(JSON.stringify({ format_version: 2, images: {} }));
  await putFolder(b, 'future', future);
  await openRound(b, 'future');
  assert.equal(await b.evaluate('YOLOUI._round()'), null);
  assert.match(await b.evaluate(`document.getElementById('noticeBannerMsg').textContent`), /format_version 2, but this Yoloble reads version 1/);
}));

test('reason banner shows why each frame was selected, and the round in the header', { skip }, () => withBrowser(async b => {
  const banner = () => b.evaluate(`({ show: document.getElementById('reasonBanner').classList.contains('show'), chip: document.getElementById('reasonChip').textContent, text: document.getElementById('reasonText').textContent, title: document.getElementById('reasonBanner').title, round: document.getElementById('roundInfo').textContent })`);
  const files = ORIGINAL();
  const rj = JSON.parse(files['round.json']);
  delete rj.images['clark_ave_01__a1b2c3d4__f023836.jpg'];
  files['round.json'] = Buffer.from(JSON.stringify(rj));
  await putFolder(b, 'round', files);
  await openRound(b);
  assert.deepEqual(await banner(), { show: true, chip: 'Rare class', text: 'rare class: 3ax Bus', title: 'Selection scores: rarity 0.82 · uncertainty 0.00 · disagreement 0.00', round: 'Round 3 · model m0005' });
  await b.evaluate('YOLOUI._gotoIndex(2)');
  await b.waitFor('YOLOUI._snapshot().owner === YOLOUI._snapshot().name && YOLOUI._snapshot().index === 2');
  let r = await banner();
  assert.equal(r.chip, 'Low confidence');
  assert.equal(r.text, 'low confidence: 2 boxes between 0.2 and 0.6');
  await b.evaluate('YOLOUI._gotoIndex(3)');
  await b.waitFor('YOLOUI._snapshot().owner === YOLOUI._snapshot().name && YOLOUI._snapshot().index === 3');
  r = await banner();
  assert.equal(r.chip, 'Not in round');

  const legacy = ORIGINAL(); delete legacy['round.json'];
  await putFolder(b, 'legacy', legacy);
  await openRound(b, 'legacy');
  r = await banner();
  assert.equal(r.show, false);
  assert.equal(r.round, '');
}));

test('checks: Space refuses an image with problems, fixes from the Checks panel, Shift+Space overrides, boxes stay inside the image', { skip }, () => withBrowser(async b => {
  await putFolder(b, 'round', ORIGINAL());
  await openRound(b);
  const loaded = i => b.waitFor(`YOLOUI._snapshot().index === ${i} && YOLOUI._snapshot().owner === YOLOUI._snapshot().name`);
  const checks = () => b.evaluate(`[...document.querySelectorAll('#checksPanel .check-item .msg, #checksPanel .check-ok')].map(e => e.textContent)`);
  assert.deepEqual(await checks(), ['No problems on this image ✓']);

  // A box drawn past the image edge is clipped to it.
  await drag(b, { x: 0.90, y: 0.80 }, { x: 1.10, y: 0.95 });
  let s = await snap(b);
  const nb = s.boxes.at(-1);
  assert.ok(Math.abs(nb.xc + nb.w / 2 - 1) < 1e-9, 'right edge at the image edge');

  // Duplicate pre-label (f014209, index 5): Space refuses and selects it.
  await b.evaluate('YOLOUI._gotoIndex(5)'); await loaded(5);
  assert.deepEqual(await checks(), ['Box 4 duplicates box 3 (same class, overlap above 95%)']);
  await b.key(' ');
  await b.evaluate('new Promise(r => setTimeout(r, 200))');
  s = await snap(b);
  assert.equal(s.index, 5, 'stayed on the image');
  assert.equal(s.selected, 3);
  assert.notEqual(s.status[s.name], 'reviewed');
  assert.match(await b.evaluate(`document.getElementById('toast').textContent`), /^Not marked reviewed: Box 4 duplicates box 3 .*Shift\+Space/);
  // Fix it from the panel, then Space works.
  await b.evaluate(`document.querySelector('#checksPanel .check-item button').click()`);
  assert.deepEqual(await checks(), ['No problems on this image ✓']);
  assert.equal((await snap(b)).boxes.length, 3);
  await b.key(' '); await loaded(6);

  // Near-zero box (f015197, index 9): a warning, overridden with Shift+Space.
  await b.evaluate('YOLOUI._gotoIndex(9)'); await loaded(9);
  assert.deepEqual(await checks(), ['Box 6 is near zero size (1.0×0.7 px)']);
  await b.key(' ', { shift: true }); await loaded(10);
  await settle(b);
  const st = JSON.parse((await getFolder(b, 'round'))['image_status.json'].toString());
  assert.equal(st.find(r => r.name === 'hwy7_east__0badc0de__f015197.jpg').status, 'reviewed');
}));

test('checks: Finish round reports classes.txt differing from round.json, foreign images and unreadable label lines', { skip }, () => withBrowser(async b => {
  const files = ORIGINAL();
  files['classes.txt'] = Buffer.from(files['classes.txt'].toString().replace('Van', 'van'));
  files['Images/stray__frame__f000001.jpg'] = files['Images/clark_ave_01__a1b2c3d4__f006138.jpg'];
  files[`Labels/${IMG0}.txt`] = Buffer.concat([files[`Labels/${IMG0}.txt`], Buffer.from('3 0.5 oops 0.1 0.1\n')]);
  await putFolder(b, 'round', files);
  await openRound(b);
  assert.match(b.dialogs.join('\n'), /unreadable line/);
  const checks = await b.evaluate(`[...document.querySelectorAll('#checksPanel .check-item .msg')].map(e => e.textContent)`);
  assert.deepEqual(checks, ['The label file has 1 unreadable line, which irs ingest rejects']);
  // Just showing the image and moving on does not rewrite the file.
  await b.key('d');
  await b.waitFor('YOLOUI._snapshot().index === 1 && YOLOUI._snapshot().owner === YOLOUI._snapshot().name');
  await b.key('a');
  await b.waitFor('YOLOUI._snapshot().index === 0 && YOLOUI._snapshot().owner === YOLOUI._snapshot().name');
  await settle(b);
  assert.match((await getFolder(b, 'round'))[`Labels/${IMG0}.txt`].toString(), /oops/);
  await b.evaluate('YOLOUI.finishRound()');
  const body = await b.evaluate(`document.getElementById('modalBody').textContent`);
  assert.match(body, /problems irs ingest would reject/);
  assert.match(body, /classes\.txt line 3 is "van", round\.json has "Van"/);
  assert.match(body, /stray__frame__f000001\.jpg: not listed in round\.json/);
  assert.match(body, /clark_ave_01__a1b2c3d4__f006138\.jpg: The label file has 1 unreadable line/);
  assert.equal(await b.evaluate(`document.getElementById('modalTitle').textContent`), 'Round not finished yet');
  await b.key('Escape');
  // Rewrite drops the unreadable line.
  await b.evaluate(`document.querySelector('#checksPanel .check-item button').click()`);
  await settle(b);
  const text = (await getFolder(b, 'round'))[`Labels/${IMG0}.txt`].toString();
  assert.equal(lineCount(text), 3);
  assert.doesNotMatch(text, /oops/);
}));

test('U cycles through unchecked model boxes, least confident first, zooming to each', { skip }, () => withBrowser(async b => {
  await putFolder(b, 'round', ORIGINAL());
  await openRound(b);
  await b.evaluate('YOLOUI._gotoIndex(9)');   // f015197: confidences 0.86 0.78 0.68 0.63 0.58 0.27
  await b.waitFor('YOLOUI._snapshot().index === 9 && YOLOUI._snapshot().owner === YOLOUI._snapshot().name');
  const zoom0 = await b.evaluate(`document.getElementById('zoomLevel').textContent`);
  const seen = [];
  for (let i = 0; i < 7; i++) { await b.key('u'); const s = await snap(b); seen.push(s.boxes[s.selected].conf); }
  assert.deepEqual(seen, [0.27, 0.58, 0.63, 0.68, 0.78, 0.86, 0.27]);
  assert.notEqual(await b.evaluate(`document.getElementById('zoomLevel').textContent`), zoom0, 'zoomed in');
  await b.key('u', { shift: true });
  const s = await snap(b);
  assert.equal(s.boxes[s.selected].conf, 0.86, 'Shift+U goes back');
  // An image without unchecked model boxes says so.
  await b.key(' ', { shift: true });
  await b.waitFor('YOLOUI._snapshot().index === 10 && YOLOUI._snapshot().owner === YOLOUI._snapshot().name');
  await b.evaluate('YOLOUI.previousImage()');
  await b.waitFor('YOLOUI._snapshot().index === 9 && YOLOUI._snapshot().owner === YOLOUI._snapshot().name');
  await b.key('u');
  assert.match(await b.evaluate(`document.getElementById('toast').textContent`), /No unchecked model boxes/);
}));

test('finer editing: edge handles, Shift+arrow nudge as one undo step, redo', { skip }, () => withBrowser(async b => {
  await putFolder(b, 'round', ORIGINAL());
  await openRound(b);
  let s = await snap(b);
  const orig = s.boxes[0];
  await clickAt(b, boxCenter(orig));
  // Five nudges right, one up.
  for (let i = 0; i < 5; i++) await b.key('ArrowRight', { shift: true, code: 'ArrowRight', keyCode: 39 });
  await b.key('ArrowUp', { shift: true, code: 'ArrowUp', keyCode: 38 });
  s = await snap(b);
  assert.equal(s.index, 0, 'Shift+arrow does not change image');
  assert.ok(Math.abs(s.boxes[0].xc - (orig.xc + 5 / 640)) < 1e-9);
  assert.ok(Math.abs(s.boxes[0].yc - (orig.yc - 1 / 360)) < 1e-9);
  assert.equal(s.boxes[0].pre, undefined, 'nudging confirms a model box');
  // One undo step for the whole run; redo brings it back.
  await b.key('z', { ctrl: true });
  s = await snap(b);
  assert.deepEqual(s.boxes[0], orig);
  assert.equal(await b.evaluate(`document.getElementById('redoBtn').disabled`), false);
  // Clicking a box without moving it keeps the redo history.
  await clickAt(b, boxCenter(orig));
  await b.key('y', { ctrl: true });
  s = await snap(b);
  assert.ok(Math.abs(s.boxes[0].xc - (orig.xc + 5 / 640)) < 1e-9, 'Ctrl+Y redoes');
  await b.key('z', { ctrl: true });
  await b.key('z', { ctrl: true, shift: true });
  assert.ok(Math.abs((await snap(b)).boxes[0].xc - (orig.xc + 5 / 640)) < 1e-9, 'Ctrl+Shift+Z redoes');

  // Edge handle: drag the right edge of the selected box outwards; height stays.
  s = await snap(b);
  await clickAt(b, boxCenter(s.boxes[0]));
  const bx = (await snap(b)).boxes[0];
  await drag(b, { x: bx.xc + bx.w / 2, y: bx.yc }, { x: bx.xc + bx.w / 2 + 0.05, y: bx.yc + 0.03 });
  const after = (await snap(b)).boxes[0];
  assert.ok(Math.abs(after.w - (bx.w + 0.05)) < 0.004, `width grew: ${after.w}`);
  assert.ok(Math.abs(after.h - bx.h) < 1e-6, 'height unchanged');
  await settle(b);
}));

test('a folder opened read-only is never written and says so', { skip }, () => withBrowser(async b => {
  await putFolder(b, 'round', ORIGINAL());
  await b.evaluate(`(async () => { const r = await navigator.storage.getDirectory(); await YOLOUI._loadReadOnlyForTests(await r.getDirectoryHandle('round')); })()`);
  await b.waitFor(`getComputedStyle(document.getElementById('loadingOverlay')).display === 'none' && YOLOUI._snapshot().count > 0`);
  await b.evaluate('YOLOUI.fitToScreen()');
  await drag(b, { x: 0.80, y: 0.80 }, { x: 0.90, y: 0.90 });
  await sleep(800);
  const s = await snap(b);
  assert.equal(s.boxes.length, 4);
  assert.equal(s.unsaved, 1);
  assert.match(s.saveState, /Read-only/);
  assert.ok(await b.evaluate(`document.getElementById('saveBanner').classList.contains('show')`));
  const disk = await getFolder(b, 'round');
  for (const [rel, buf] of Object.entries(ORIGINAL())) assert.ok(buf.equals(disk[rel]), `${rel} changed`);
}));

test('a failed write shows the error banner, keeps the change and succeeds on retry', { skip }, () => withBrowser(async b => {
  await putFolder(b, 'round', ORIGINAL());
  await openRound(b);
  await b.evaluate(`window.__realCW = FileSystemFileHandle.prototype.createWritable;
    FileSystemFileHandle.prototype.createWritable = function () { return Promise.reject(new DOMException('disk full (simulated)', 'QuotaExceededError')); };`);
  await drag(b, { x: 0.80, y: 0.80 }, { x: 0.90, y: 0.90 });
  await b.waitFor('YOLOUI._snapshot().saveError !== null');
  let s = await snap(b);
  assert.match(s.saveState, /Save failed \(1 unsaved\)/);
  assert.match(await b.evaluate(`document.getElementById('saveBannerMsg').textContent`), /disk full \(simulated\)/);
  assert.ok(await b.evaluate(`document.getElementById('saveBanner').classList.contains('show')`));
  await b.evaluate('FileSystemFileHandle.prototype.createWritable = window.__realCW');
  await b.evaluate('YOLOUI.retrySave()');
  await settle(b);
  s = await snap(b);
  assert.equal(s.saveError, null);
  assert.match(s.saveState, /All changes saved/);
  assert.ok(!(await b.evaluate(`document.getElementById('saveBanner').classList.contains('show')`)));
  const disk = await getFolder(b, 'round');
  assert.equal(disk[`Labels/${IMG0}.txt`].toString().trim().split('\n').length, 4);
}));

const IMG3 = 'clark_ave_01__a1b2c3d4__f023836';

test('a crash mid-round loses nothing: reopening resumes on the same image and restores unsaved edits', { skip }, async () => {
  const os = require('node:os');
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'yoloble-crash-'));
  // Session 1: one edit reaches the folder, then writes start failing and a
  // second edit only exists in the browser when the browser dies.
  let b = await launch({ userDataDir: profile });
  await b.goto(base); await b.waitFor('typeof YOLOUI === "object"');
  await b.evaluate('YOLOUI._storageReady()');
  await putFolder(b, 'round', ORIGINAL());
  await openRound(b);
  await drag(b, { x: 0.80, y: 0.80 }, { x: 0.90, y: 0.90 });
  await settle(b);
  for (let i = 0; i < 3; i++) await b.key('d');
  await b.waitFor(`YOLOUI._snapshot().name === '${IMG3}.jpg' && YOLOUI._snapshot().owner === '${IMG3}.jpg'`);
  await b.evaluate(`FileSystemFileHandle.prototype.createWritable = function () { return Promise.reject(new DOMException('simulated', 'InvalidStateError')); };`);
  await drag(b, { x: 0.05, y: 0.05 }, { x: 0.15, y: 0.12 });
  await b.waitFor('YOLOUI._snapshot().saveError !== null');
  await b.evaluate('YOLOUI._saveSession()');
  await b.kill();

  // Session 2: same profile, same folder.
  b = await launch({ userDataDir: profile });
  try {
    await b.goto(base); await b.waitFor('typeof YOLOUI === "object"');
    await b.evaluate('YOLOUI._storageReady()');
    assert.match(await b.evaluate(`document.getElementById('resumeBtn').textContent`), /Resume "round"/);
    let disk = await getFolder(b, 'round');
    assert.equal(lineCount(disk[`Labels/${IMG0}.txt`]), 4, 'first edit was saved before the crash');
    const before = disk[`Labels/${IMG3}.txt`].toString();
    await b.evaluate('YOLOUI.resumeLastFolder()');
    await b.waitFor(`getComputedStyle(document.getElementById('loadingOverlay')).display === 'none' && YOLOUI._snapshot().count > 0`);
    assert.equal(b.dialogs.length, 1);
    assert.match(b.dialogs[0], /kept 1 label edit for "round" that never reached the folder/);
    const s = await snap(b);
    assert.equal(s.name, IMG3 + '.jpg', 'resumes on the image it was on');
    await settle(b);
    disk = await getFolder(b, 'round');
    const after = disk[`Labels/${IMG3}.txt`].toString();
    assert.equal(lineCount(after), lineCount(before) + 1, 'unsaved edit restored and saved');
    assert.match(after.split('\n').at(-2), /^0 0\.100000 0\.08\d{4} 0\.100000 0\.0[67]\d{4}$/);
    assert.deepEqual(b.consoleLog.filter(l => l.startsWith('EXCEPTION')), []);
  } finally { await b.close(); }
});

test('a status change that never reached the folder is restored too', { skip }, async () => {
  const os = require('node:os');
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'yoloble-status-'));
  let b = await launch({ userDataDir: profile });
  await b.goto(base); await b.waitFor('typeof YOLOUI === "object"');
  await putFolder(b, 'round', ORIGINAL());
  await openRound(b);
  await b.evaluate(`FileSystemFileHandle.prototype.createWritable = function () { return Promise.reject(new DOMException('simulated', 'InvalidStateError')); };`);
  await b.evaluate('YOLOUI.deleteCurrentImage()');
  await b.waitFor('YOLOUI._snapshot().saveError !== null');
  await b.evaluate('YOLOUI._saveSession()');
  await b.kill();
  b = await launch({ userDataDir: profile });
  try {
    await b.goto(base); await b.waitFor('typeof YOLOUI === "object"');
    await openRound(b);
    assert.match(b.dialogs[0], /kept 1 status change/);
    assert.equal((await snap(b)).count, 11);
    await settle(b);
    const status = JSON.parse((await getFolder(b, 'round'))['image_status.json'].toString());
    assert.equal(status.find(r => r.name === IMG0 + '.jpg').status, 'deleted');
  } finally { await b.close(); }
});

test('a full browser store does not stop saving to the folder', { skip }, () => withBrowser(async b => {
  await putFolder(b, 'round', ORIGINAL());
  await openRound(b);
  await b.evaluate(`IDBObjectStore.prototype.put = function () { throw new DOMException('quota (simulated)', 'QuotaExceededError'); };`);
  await drag(b, { x: 0.80, y: 0.80 }, { x: 0.90, y: 0.90 });
  await settle(b);
  await b.waitFor(`document.getElementById('noticeBanner').classList.contains('show')`);
  assert.match(await b.evaluate(`document.getElementById('noticeBannerMsg').textContent`), /Backup in the browser failed \(quota \(simulated\)\)\. Changes are still being saved to the folder/);
  assert.match((await snap(b)).saveState, /All changes saved/);
  assert.equal(lineCount((await getFolder(b, 'round'))[`Labels/${IMG0}.txt`]), 4);
}));

test('declining recovery discards the kept edits and does not ask again', { skip }, async () => {
  const os = require('node:os');
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'yoloble-discard-'));
  let b = await launch({ userDataDir: profile });
  await b.goto(base); await b.waitFor('typeof YOLOUI === "object"');
  await putFolder(b, 'round', ORIGINAL());
  await openRound(b);
  await b.evaluate(`FileSystemFileHandle.prototype.createWritable = function () { return Promise.reject(new DOMException('simulated', 'InvalidStateError')); };`);
  await drag(b, { x: 0.80, y: 0.80 }, { x: 0.90, y: 0.90 });
  await b.waitFor('YOLOUI._snapshot().saveError !== null');
  await b.evaluate('YOLOUI._saveSession()');
  await b.kill();
  b = await launch({ userDataDir: profile });
  try {
    await b.goto(base); await b.waitFor('typeof YOLOUI === "object"');
    b.setDialogAccept(false);
    await openRound(b);
    assert.equal(b.dialogs.length, 1);
    assert.equal((await snap(b)).boxes.length, 3, 'kept edit discarded');
    b.setDialogAccept(true);
    await openRound(b);
    assert.equal(b.dialogs.length, 1, 'not offered a second time');
  } finally { await b.close(); }
});

test('statuses kept in localStorage by older versions are moved to IndexedDB once', { skip }, () => withBrowser(async b => {
  await b.evaluate(`localStorage.setItem('yolo_image_status', JSON.stringify([{name:'${IMG0}.JPG', status:'deleted'}]))`);
  await b.goto(base); await b.waitFor('typeof YOLOUI === "object"');
  await b.evaluate('YOLOUI._storageReady()');
  assert.equal(await b.evaluate(`localStorage.getItem('yolo_image_status')`), null);
  const files = ORIGINAL(); delete files['image_status.json'];
  await putFolder(b, 'legacy', files);
  await openRound(b, 'legacy');
  const s = await snap(b);
  assert.equal(s.count, 11, 'image deleted in the old status list stays hidden');
  assert.equal(s.status[`${IMG0}.jpg`.toLowerCase()], 'deleted');
}));

