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

// Drop files (name, text | null for an image) through the same entry point as a real drop.
async function dropFiles(b, files) {
  await b.evaluate(`(async () => {
    const jpg = await (await fetch('../samples/round_sample/Images/${IMG0}.jpg')).blob();
    const list = ${JSON.stringify(files)}.map(([n, t]) => t === null ? new File([jpg], n, { type: 'image/jpeg' }) : new File([t], n, { type: 'text/plain' }));
    await YOLOUI._routeUploads(list);
  })()`);
  await b.waitFor(`getComputedStyle(document.getElementById('loadingOverlay')).display === 'none' && YOLOUI._snapshot().owner !== null`);
}
const clsOf = async (b, i) => { await b.evaluate(`YOLOUI._gotoIndex(${i})`); await loaded(b, i); const s = await snap(b); return [s.name, s.boxes.map(x => x.cls).join(',')]; };

test('B2: dropping images, labels and a deleted_list together keeps each image with its own labels', { skip }, () => withBrowser(async b => {
  await dropFiles(b, [['a.jpg', null], ['b.jpg', null], ['c.jpg', null],
    ['a.txt', '0 0.1 0.1 0.1 0.1\n'], ['b.txt', '1 0.5 0.5 0.2 0.2\n'], ['c.txt', '2 0.8 0.8 0.3 0.3\n2 0.2 0.8 0.1 0.1\n'], ['deleted_list.txt', 'a.jpg\n']]);
  assert.equal((await snap(b)).count, 2);
  assert.deepEqual(await clsOf(b, 0), ['b.jpg', '1']);
  assert.deepEqual(await clsOf(b, 1), ['c.jpg', '2,2']);
}));

test('M6: labels dropped after the images are shown at once and survive moving on', { skip }, () => withBrowser(async b => {
  await dropFiles(b, [['a.jpg', null], ['b.jpg', null]]);
  await dropFiles(b, [['a.txt', '0 0.1 0.1 0.1 0.1\n'], ['b.txt', '1 0.5 0.5 0.2 0.2\n']]);
  await b.waitFor(`getComputedStyle(document.getElementById('loadingOverlay')).display === 'none'`);
  assert.equal((await snap(b)).boxes.length, 1, 'shown at once');
  await b.key('d'); await loaded(b, 1);
  await b.key('a'); await loaded(b, 0);
  assert.deepEqual(await clsOf(b, 0), ['a.jpg', '0']);
  assert.deepEqual(await clsOf(b, 1), ['b.jpg', '1']);
}));

test('M1: lower-cased names from an older status file never produce duplicates, and the exact name wins', { skip }, () => withBrowser(async b => {
  const orig = ORIGINAL(), jpg = orig[`Images/${IMG0}.jpg`];
  await putFolder(b, 'old', {
    'Images/Frame_A.jpg': jpg, 'Images/Frame_B.jpg': jpg, 'Labels/Frame_A.txt': Buffer.from('0 0.5 0.5 0.2 0.2\n'), 'classes.txt': orig['classes.txt'],
    'image_status.json': Buffer.from(JSON.stringify([{ name: 'frame_a.jpg', status: 'labeled' }, { name: 'frame_b.jpg', status: 'deleted' }, { name: 'gone.jpg', status: 'reviewed' }])) });
  await openRound(b, 'old');
  assert.equal((await snap(b)).count, 1, 'Frame_B is deleted through its lower-cased entry');
  await b.key(' ');
  await settle(b);
  let st = JSON.parse((await getFolder(b, 'old'))['image_status.json']);
  assert.deepEqual(st, [{ name: 'Frame_A.jpg', status: 'reviewed' }, { name: 'Frame_B.jpg', status: 'deleted' }, { name: 'gone.jpg', status: 'reviewed' }]);
  // A file with both spellings: the exact one wins on reopen.
  await putFolder(b, 'both', {
    'Images/Frame_A.jpg': jpg, 'classes.txt': orig['classes.txt'],
    'image_status.json': Buffer.from(JSON.stringify([{ name: 'Frame_A.jpg', status: 'reviewed' }, { name: 'frame_a.jpg', status: 'labeled' }])) });
  await openRound(b, 'both');
  assert.equal((await snap(b)).status['frame_a.jpg'], 'reviewed');
}));

test('M4: an unedited label file is checked on its exact bytes (what irs reads), not on Yoloble\'s rewrite of it', { skip }, () => withBrowser(async b => {
  const files = ORIGINAL();
  // 1.0000004 is written back as 1.000000 (accepted), but irs reads the file as it is (rejected).
  files[`Labels/${IMG0}.txt`] = Buffer.concat([files[`Labels/${IMG0}.txt`], Buffer.from('1 1.0000004 0.5 0.1 0.1\n')]);
  const hex = 'clark_ave_01__a1b2c3d4__f023836';
  files[`Labels/${hex}.txt`] = Buffer.from('4 0x1 0.5 0.1 0.1\n');
  await putFolder(b, 'round', files);
  await openRound(b);
  const checks = () => b.evaluate(`[...document.querySelectorAll('#checksPanel .check-item .msg')].map(e => e.textContent)`);
  assert.deepEqual(await checks(), ['Box 4 coordinates outside the image']);
  await b.evaluate('YOLOUI.finishRound()');
  const body = await b.evaluate(`document.getElementById('modalBody').textContent`);
  assert.match(body, /f006138\.jpg: Box 4 coordinates outside the image/);
  assert.match(body, new RegExp(`${hex}\.jpg: Line 1 of the label file has a value that is not a number`));
  await b.key('Escape');
  // Clip fixes it: the file is rewritten and passes.
  await b.evaluate(`document.querySelector('#checksPanel .check-item button').click()`);
  await settle(b);
  assert.deepEqual(await checks(), []);
}));

test('M5: an image_status.json Yoloble cannot read is never overwritten without consent; replacing keeps a backup', { skip }, () => withBrowser(async b => {
  const files = ORIGINAL();
  const broken = Buffer.from(files['image_status.json'].toString().replace('"unlabeled"', '"reviewed"').slice(0, -20));  // truncated: not valid JSON
  files['image_status.json'] = broken;
  await putFolder(b, 'round', files);
  await openRound(b);
  const s = await snap(b);
  assert.match(s.saveState, /Read-only/);
  assert.match(await b.evaluate(`document.getElementById('saveBannerMsg').textContent`), /image_status\.json is not valid JSON.*opened read-only/);
  await drag(b, { x: 0.80, y: 0.80 }, { x: 0.90, y: 0.90 });
  await b.key(' ', { shift: true });
  await loaded(b, 1);
  await sleep(800);
  let disk = await getFolder(b, 'round');
  assert.ok(disk['image_status.json'].equals(broken), 'status file untouched');
  assert.ok(disk[`Labels/${IMG0}.txt`].equals(files[`Labels/${IMG0}.txt`]), 'label file untouched');
  // The reviewer chooses to replace it: the old bytes are kept beside it.
  await b.evaluate(`document.getElementById('saveBannerReplace').click()`);
  await settle(b);
  disk = await getFolder(b, 'round');
  assert.ok(disk['image_status.json.bak'].equals(broken));
  const st = JSON.parse(disk['image_status.json']);
  assert.equal(st.length, 12);
  assert.equal(st.find(r => r.name === `${IMG0}.jpg`).status, 'reviewed');
  assert.equal(lineCount(disk[`Labels/${IMG0}.txt`]), 4, 'the edit made meanwhile is saved too');
}));

async function writeOpfs(b, dir, rel, text) {
  await b.evaluate(`(async () => { let d = await (await navigator.storage.getDirectory()).getDirectoryHandle(${JSON.stringify(dir)});
    const parts = ${JSON.stringify(rel)}.split('/'); for (const p of parts.slice(0, -1)) d = await d.getDirectoryHandle(p);
    const w = await (await d.getFileHandle(parts.at(-1), { create: true })).createWritable(); await w.write(${JSON.stringify(text)}); await w.close(); })()`);
}

test('M2: a second tab on the same folder is read-only, never writes, and leaves the other tab\'s temporary files alone', { skip }, () => withBrowser(async a => {
  const orig = ORIGINAL();
  await putFolder(a, 'round', orig);
  await openRound(a);
  assert.match((await snap(a)).saveState, /All changes saved/);
  await writeOpfs(a, 'round', 'image_status.json.crswap', 'in progress');
  const b = await a.newTab();
  await b.goto(base); await b.waitFor('typeof YOLOUI === "object"'); await b.focus();
  await openRound(b);
  const s = await snap(b);
  assert.match(s.saveState, /Open in another window/);
  assert.match(await b.evaluate(`document.getElementById('saveBannerMsg').textContent`), /open in another Yoloble tab or window.*read-only/);
  await drag(b, { x: 0.80, y: 0.80 }, { x: 0.90, y: 0.90 });
  await b.key(' ', { shift: true });
  await sleep(800);
  let disk = await getFolder(a, 'round');
  assert.ok(disk[`Labels/${IMG0}.txt`].equals(orig[`Labels/${IMG0}.txt`]), 'second tab wrote nothing');
  assert.ok(disk['image_status.json'].equals(orig['image_status.json']));
  assert.ok(disk['image_status.json.crswap'], 'temporary file of the first tab not deleted');
  // The first tab still saves normally.
  await a.focus();
  await drag(a, { x: 0.80, y: 0.80 }, { x: 0.90, y: 0.90 });
  await settle(a);
  disk = await getFolder(a, 'round');
  assert.equal(lineCount(disk[`Labels/${IMG0}.txt`]), 4);
}));

test('M2: a status changed by someone else after Yoloble read the file is merged, not overwritten', { skip }, () => withBrowser(async b => {
  await putFolder(b, 'round', ORIGINAL());
  await openRound(b);
  const other = 'clark_ave_01__a1b2c3d4__f016352.jpg';
  const st = JSON.parse((await getFolder(b, 'round'))['image_status.json']);
  st.find(r => r.name === other).status = 'deleted';
  await sleep(20);
  await writeOpfs(b, 'round', 'image_status.json', JSON.stringify(st, null, 2) + '\n');   // e.g. another reviewer
  await b.key(' ');
  await loaded(b, 1);
  await settle(b);
  const now = Object.fromEntries(JSON.parse((await getFolder(b, 'round'))['image_status.json']).map(r => [r.name, r.status]));
  assert.equal(now[`${IMG0}.jpg`], 'reviewed', 'this window\'s review');
  assert.equal(now[other], 'deleted', 'the other change kept');
  await b.waitFor('YOLOUI._snapshot().count === 11');
  assert.match(await b.evaluate(`document.getElementById('noticeBannerMsg').textContent`), /changed outside this window/);
}));

test('pre-label trust: a pre-label file changed outside Yoloble (same line count) is no longer shown as model boxes', { skip }, async () => {
  const profile = profileDir('prehash');
  const target = 'clark_ave_01__e5f60718__f018633';   // never opened in the first session
  let b = await launch({ userDataDir: profile });
  try {
    await b.goto(base); await b.waitFor('typeof YOLOUI === "object"');
    await putFolder(b, 'round', ORIGINAL());
    await openRound(b);
    await b.evaluate('YOLOUI._saveSession()');
    const text = (await getFolder(b, 'round'))[`Labels/${target}.txt`].toString();
    await writeOpfs(b, 'round', `Labels/${target}.txt`, text.replace(/^(\d+ )0\.\d/, '$10.1'));   // move a box, keep the line count
  } finally { await b.close(); }
  b = await launch({ userDataDir: profile });
  try {
    await b.goto(base); await b.waitFor('typeof YOLOUI === "object"');
    await openRound(b);
    const i = await b.evaluate(`(async () => { for (let i = 0; i < 12; i++) { await YOLOUI._gotoIndex(i); if (YOLOUI._snapshot().owner === '${target}.jpg') return i; } })()`);
    await loaded(b, i);
    assert.ok((await snap(b)).boxes.every(x => !x.pre), 'changed file: boxes are not model boxes');
    await b.evaluate('YOLOUI._gotoIndex(0)'); await loaded(b, 0);
    assert.ok((await snap(b)).boxes.every(x => x.pre), 'unchanged file: still model boxes');
  } finally { await b.close(); }
});

test('Finish round flags a reviewed image without a label file and a label file without an image', { skip }, () => withBrowser(async b => {
  const files = ORIGINAL();
  const gone = 'clark_ave_01__a1b2c3d4__f016352';
  delete files[`Labels/${gone}.txt`];
  const st = JSON.parse(files['image_status.json']); st.find(r => r.name === `${gone}.jpg`).status = 'reviewed';
  files['image_status.json'] = Buffer.from(JSON.stringify(st));
  files['Labels/orphan__frame__f000001.txt'] = Buffer.from('0 0.5 0.5 0.1 0.1\n');
  await putFolder(b, 'round', files);
  await openRound(b);
  await b.evaluate('YOLOUI.finishRound()');
  const body = await b.evaluate(`document.getElementById('modalBody').textContent`);
  assert.match(body, new RegExp(`${gone}\.jpg: is reviewed but has no label file`));
  assert.match(body, /Labels\/orphan__frame__f000001\.txt belongs to no image in Images\//);
}));

test('statuses an older Yoloble kept in the browser never leak into a folder with its own image_status.json', { skip }, () => withBrowser(async b => {
  await b.evaluate(`localStorage.setItem('yolo_image_status', JSON.stringify([{name:'${IMG0}.jpg', status:'deleted'}]))`);
  await b.goto(base); await b.waitFor('typeof YOLOUI === "object"'); await b.evaluate('YOLOUI._storageReady()');
  const files = ORIGINAL();
  files['image_status.json'] = Buffer.from(JSON.stringify(JSON.parse(files['image_status.json']).filter(r => r.name !== `${IMG0}.jpg`)));
  await putFolder(b, 'round', files);
  await openRound(b);
  assert.equal((await snap(b)).count, 12, 'not hidden by a status from another dataset');
  await b.key(' ');
  await loaded(b, 1);
  await settle(b);
  const st = JSON.parse((await getFolder(b, 'round'))['image_status.json']);
  assert.ok(!st.some(r => r.status === 'deleted'), 'never written into this folder');
}));

test('a recovered undo of a delete shows the image again', { skip }, async () => {
  const profile = profileDir('undel');
  let b = await launch({ userDataDir: profile });
  await b.goto(base); await b.waitFor('typeof YOLOUI === "object"');
  await putFolder(b, 'round', ORIGINAL());
  await openRound(b);
  await b.evaluate('YOLOUI.deleteCurrentImage()');
  await b.waitFor('YOLOUI._snapshot().count === 11 && YOLOUI._snapshot().owner === YOLOUI._snapshot().name');
  await settle(b);                                   // the delete reached the folder
  await b.evaluate(`FileSystemFileHandle.prototype.createWritable = function () { return Promise.reject(new DOMException('simulated', 'InvalidStateError')); };`);
  await b.evaluate(`document.querySelector('#toast button').click()`);   // Undo, which cannot be saved
  await b.waitFor('YOLOUI._snapshot().count === 12 && YOLOUI._snapshot().saveError !== null');
  await b.evaluate('YOLOUI._saveSession()');
  await b.kill();
  b = await launch({ userDataDir: profile });
  try {
    await b.goto(base); await b.waitFor('typeof YOLOUI === "object"');
    await openRound(b);
    assert.match(b.dialogs.join('\n'), /kept 1 status change/);
    assert.equal((await snap(b)).count, 12, 'the restored image is back in the set');
    await settle(b);
    const st = JSON.parse((await getFolder(b, 'round'))['image_status.json']);
    assert.notEqual(st.find(r => r.name === `${IMG0}.jpg`).status, 'deleted');
  } finally { await b.close(); }
});

test('thumbnails of a previous folder are not reused for another folder with the same file names', { skip }, () => withBrowser(async b => {
  await putFolder(b, 'one', ORIGINAL());
  await openRound(b, 'one');
  await b.waitFor('YOLOUI._thumbCache().length >= 5');
  await putFolder(b, 'two', ORIGINAL());
  const right = await b.evaluate(`(async () => { const r = await navigator.storage.getDirectory();
    await YOLOUI._openFolder(await r.getDirectoryHandle('two')); return YOLOUI._thumbCache().length; })()`);
  assert.equal(right, 0, 'nothing kept from the other folder');
}));

test('object URLs are freed: images still draw after their URL is revoked', { skip }, () => withBrowser(async b => {
  await b.evaluate(`window.__urls = new Set(); const c = URL.createObjectURL, r = URL.revokeObjectURL;
    URL.createObjectURL = o => { const u = c(o); window.__urls.add(u); return u; }; URL.revokeObjectURL = u => { window.__urls.delete(u); return r(u); };`);
  await putFolder(b, 'round', ORIGINAL());
  await openRound(b);
  for (let i = 1; i < 6; i++) { await b.key('d'); await loaded(b, i); }
  assert.equal(await b.evaluate('window.__urls.size'), 0, 'no object URL left open');
  // The image is still drawn (a pixel of the road is not the empty background).
  await b.evaluate('new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))');
  const px = await b.evaluate(`(() => { const c = document.getElementById('canvas'); const d = c.getContext('2d').getImageData(c.width / 2, c.height / 2, 1, 1).data; return [d[0], d[1], d[2]]; })()`);
  assert.notDeepEqual(px, [10, 10, 10]);
}));

test('file and class names are shown as text, never interpreted as HTML', { skip }, () => withBrowser(async b => {
  const files = ORIGINAL(), jpg = files[`Images/${IMG0}.jpg`];
  const evil = '<img src=x onerror="window.__pwned=1">.jpg';
  await putFolder(b, 'evil', { [`Images/${evil}`]: jpg, 'classes.txt': Buffer.from('<b onmouseover="window.__pwned=2">Car</b>\nVan\n'),
    [`Labels/${evil.replace('.jpg', '.txt')}`]: Buffer.from('0 0.5 0.5 0.2 0.2\n') });
  await openRound(b, 'evil');
  await b.evaluate(`(() => { const s = document.getElementById('filterClass'); s.value = '0'; s.dispatchEvent(new Event('change')); })()`);
  await b.evaluate('new Promise(r => setTimeout(r, 300))');
  assert.equal(await b.evaluate('document.getElementById("imageName").textContent.includes("<img src=x")'), true);
  assert.equal(await b.evaluate('window.__pwned'), undefined);
  assert.equal(await b.evaluate('document.querySelectorAll("#imageName img, #filterResults b, #debugInfo img").length'), 0);
}));

test('the ZIP export works with no network (JSZip is inside index.html)', { skip }, async () => {
  const b = await launch();
  try {
    await b.send('Network.enable');
    await b.send('Network.setBlockedURLs', { urls: ['*cdnjs.cloudflare.com*', '*unpkg.com*', '*jsdelivr.net*'] });
    await b.goto(base); await b.waitFor('typeof YOLOUI === "object"');
    await putFolder(b, 'round', ORIGINAL());
    await openRound(b);
    const n = await b.evaluate(`(async () => Object.keys((await JSZip.loadAsync(await YOLOUI._buildBundle())).files).length)()`);
    assert.ok(n > 12);
  } finally { await b.close(); }
});

module.exports = { dropFiles, withBrowser, profileDir, loaded, ORIGINAL, IMG0 };
