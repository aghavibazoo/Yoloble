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
  const bak = Object.keys(disk).filter(k => /^image_status\.json\.\d{8}T\d{6}Z(-\d+)?\.bak$/.test(k));
  assert.equal(bak.length, 1);
  assert.ok(disk[bak[0]].equals(broken));
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
  assert.equal(await b.evaluate('document.querySelectorAll("#imageName img, #filterResults b").length'), 0);
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

test('a folder that fails to load takes the loading overlay down and says why', { skip }, () => withBrowser(async b => {
  await putFolder(b, 'round', ORIGINAL());
  await b.evaluate(`FileSystemFileHandle.prototype.getFile = function () { return Promise.reject(new DOMException('disk gone (simulated)', 'NotReadableError')); };`);
  const err = await b.evaluate(`(async () => { const r = await navigator.storage.getDirectory();
    try { await YOLOUI._openFolder(await r.getDirectoryHandle('round')); return 'no error'; } catch (e) { return String(e.message); } })()`);
  assert.match(err, /disk gone/);
  assert.equal(await b.evaluate(`getComputedStyle(document.getElementById('loadingOverlay')).display`), 'none');
}));

test('keyboard: shortcuts work after clicking a checkbox, Ctrl+A does not change image, the dialog keeps focus', { skip }, () => withBrowser(async b => {
  await putFolder(b, 'round', ORIGINAL());
  await openRound(b);
  // Click the Class names checkbox (as a mouse user would), then D.
  const r = await b.evaluate(`(() => { const r = document.getElementById('showClassNames').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
  await b.mouse('mousePressed', r.x, r.y); await b.mouse('mouseReleased', r.x, r.y);
  await b.key('d');
  await loaded(b, 1);
  await b.key('a', { ctrl: true });
  await sleep(300);
  assert.equal((await snap(b)).index, 1, 'Ctrl+A is the browser\'s');
  await b.evaluate('YOLOUI.finishRound()');
  assert.equal(await b.evaluate(`document.querySelector('#modalBg .modal').getAttribute('aria-labelledby')`), 'modalTitle');
  for (let i = 0; i < 8; i++) {
    await b.key('Tab', { code: 'Tab', keyCode: 9 });
    assert.ok(await b.evaluate(`!!document.activeElement.closest('#modalBg')`), 'focus stays in the dialog');
  }
  await b.key('d');
  assert.equal((await snap(b)).index, 1, 'keys do nothing to the image while the dialog is open');
  await b.key('Escape');
  assert.equal(await b.evaluate(`document.getElementById('modalBg').classList.contains('show')`), false);
}));

test('R1: an edit made while an earlier file is being written is the one saved (slow disk)', { skip }, () => withBrowser(async b => {
  const orig = ORIGINAL();
  await putFolder(b, 'round', orig);
  await openRound(b);
  await slowDisk(b, 1500);
  await b.evaluate(`(() => { const H = FileSystemFileHandle.prototype, cw = H.createWritable; window.__opened = [];
    H.createWritable = function (o) { window.__opened.push(this.name); return cw.call(this, o); }; })()`);
  await drag(b, { x: 0.80, y: 0.80 }, { x: 0.90, y: 0.90 });          // image 0 pending
  await b.key('d'); await loaded(b, 1); await b.evaluate('YOLOUI.fitToScreen()');   // its write starts (slow)
  const one = (await snap(b)).name.replace('.jpg', '.txt');
  await drag(b, { x: 0.80, y: 0.80 }, { x: 0.90, y: 0.90 });          // image 1 pending
  await b.key('d'); await loaded(b, 2); await b.evaluate('YOLOUI.fitToScreen()');
  const name = (await snap(b)).name;
  await drag(b, { x: 0.80, y: 0.80 }, { x: 0.90, y: 0.90 });          // image 2 pending (first edit)
  await b.waitFor(`window.__opened.includes(${JSON.stringify('X')})`.replace('"X"', JSON.stringify(one)), 15000);  // image 1 is being written now
  await sleep(200);
  await drag(b, { x: 0.05, y: 0.05 }, { x: 0.15, y: 0.15 });          // image 2, second edit
  await settle(b);
  const s = await snap(b);
  const disk = (await getFolder(b, 'round'))[`Labels/${name.replace('.jpg', '.txt')}`].toString();
  assert.equal(lineCount(disk), s.boxes.length, 'the folder has both edits');
  assert.equal(s.boxes.length, lineCount(orig[`Labels/${name.replace('.jpg', '.txt')}`]) + 2);
  assert.match(s.saveState, /All changes saved/);
}));

test('R2: a second tab is read-only even when the browser backup has no record of the folder', { skip }, () => withBrowser(async a => {
  const orig = ORIGINAL();
  await putFolder(a, 'round', orig);
  await openRound(a);
  const b = await a.newTab();
  await b.goto(base); await b.waitFor('typeof YOLOUI === "object"'); await b.focus();
  await sleep(300);   // tab A has gone to the background (and saved its record): now lose the record
  await b.evaluate(`new Promise(res => { const r = indexedDB.open('yoloble'); r.onsuccess = () => { const tx = r.result.transaction('sessions', 'readwrite'); tx.objectStore('sessions').clear(); tx.oncomplete = () => { r.result.close(); res(); }; }; })`);
  await openRound(b);
  assert.match((await snap(b)).saveState, /Open in another window/);
  await drag(b, { x: 0.80, y: 0.80 }, { x: 0.90, y: 0.90 });
  await sleep(800);
  assert.ok((await getFolder(a, 'round'))[`Labels/${IMG0}.txt`].equals(orig[`Labels/${IMG0}.txt`]), 'second tab wrote nothing');
}));

test('R2: two different folders with the same name can be worked on in two tabs', { skip }, () => withBrowser(async a => {
  const files = ORIGINAL(), nested = {};
  for (const [k, v] of Object.entries(files)) nested[`round/${k}`] = v;
  await putFolder(a, 'x', nested);
  await putFolder(a, 'y', nested);
  const open = (t, parent) => t.evaluate(`(async () => { const r = await (await navigator.storage.getDirectory()).getDirectoryHandle('${parent}');
    await YOLOUI._openFolder(await r.getDirectoryHandle('round')); })()`);
  await open(a, 'x');
  const b = await a.newTab();
  await b.goto(base); await b.waitFor('typeof YOLOUI === "object"'); await b.focus();
  await open(b, 'y');
  assert.match((await snap(a)).saveState, /All changes saved/);
  assert.match((await snap(b)).saveState, /All changes saved/);
}));

test('R3: an outside change to image_status.json is merged even when its timestamp does not change (FAT, 2 s)', { skip }, () => withBrowser(async b => {
  await putFolder(b, 'round', ORIGINAL());
  // Every file reports the same modification time, as on a coarse file system.
  await b.evaluate(`Object.defineProperty(File.prototype, 'lastModified', { get() { return 1700000000000; }, configurable: true }); 1`);
  await openRound(b);
  const other = 'clark_ave_01__a1b2c3d4__f016352.jpg';
  const st = JSON.parse((await getFolder(b, 'round'))['image_status.json']);
  st.find(r => r.name === other).status = 'deleted';
  await writeOpfs(b, 'round', 'image_status.json', JSON.stringify(st, null, 2) + '\n');
  await b.key(' ');
  await loaded(b, 1);
  await settle(b);
  const now = Object.fromEntries(JSON.parse((await getFolder(b, 'round'))['image_status.json']).map(r => [r.name, r.status]));
  assert.equal(now[`${IMG0}.jpg`], 'reviewed');
  assert.equal(now[other], 'deleted', 'the outside change survives');
}));

test('R4: a second window cannot replace a broken image_status.json', { skip }, () => withBrowser(async a => {
  const files = ORIGINAL();
  const broken = Buffer.from(files['image_status.json'].toString().slice(0, -20));
  files['image_status.json'] = broken;
  await putFolder(a, 'round', files);
  await openRound(a);
  const b = await a.newTab();
  await b.goto(base); await b.waitFor('typeof YOLOUI === "object"'); await b.focus();
  await openRound(b);
  assert.equal(await b.evaluate(`getComputedStyle(document.getElementById('saveBannerReplace')).display`), 'none');
  await b.evaluate('YOLOUI.replaceBrokenStatusFile()');
  await sleep(500);
  const disk = await getFolder(a, 'round');
  assert.ok(disk['image_status.json'].equals(broken));
  assert.deepEqual(Object.keys(disk).filter(k => k.endsWith('.bak')), []);
}));

test('R5: replacing a broken status file never overwrites an earlier backup', { skip }, () => withBrowser(async b => {
  const files = ORIGINAL();
  files['image_status.json'] = Buffer.from('{ broken');
  files['image_status.json.bak'] = Buffer.from('an older backup');
  await putFolder(b, 'round', files);
  await openRound(b);
  await b.evaluate(`document.getElementById('saveBannerReplace').click()`);
  await b.waitFor(`document.getElementById('noticeBannerMsg').textContent.includes('kept as image_status.json.')`);
  await settle(b);
  const disk = await getFolder(b, 'round');
  assert.equal(disk['image_status.json.bak'].toString(), 'an older backup', 'untouched');
  const bak = Object.keys(disk).filter(k => /^image_status\.json\.\d{8}T\d{6}Z(-\d+)?\.bak$/.test(k));
  assert.equal(bak.length, 1);
  assert.equal(disk[bak[0]].toString(), '{ broken');
}));

test('R7: a label file that keeps failing does not hold up the other files or the status file', { skip }, () => withBrowser(async b => {
  await putFolder(b, 'round', ORIGINAL());
  await openRound(b);
  await b.evaluate(`(() => { const H = FileSystemFileHandle.prototype, cw = H.createWritable;
    H.createWritable = function (o) { return this.name === '${IMG0}.txt' ? Promise.reject(new DOMException('locked by another program (simulated)', 'NoModificationAllowedError')) : cw.call(this, o); }; })()`);
  await drag(b, { x: 0.80, y: 0.80 }, { x: 0.90, y: 0.90 });          // image 0: cannot be written
  await b.key('d'); await loaded(b, 1); await b.evaluate('YOLOUI.fitToScreen()');
  await drag(b, { x: 0.40, y: 0.80 }, { x: 0.50, y: 0.90 });          // image 1: fine
  await b.key(' ', { shift: true }); await loaded(b, 2);               // a status change
  await sleep(1500);
  const disk = await getFolder(b, 'round');
  const one = 'clark_ave_01__a1b2c3d4__f010808';
  assert.equal(lineCount(disk[`Labels/${one}.txt`]), 1, 'the next file was written');
  assert.equal(JSON.parse(disk['image_status.json']).find(r => r.name === `${one}.jpg`).status, 'reviewed', 'the status file was written');
  assert.match(await b.evaluate(`document.getElementById('saveBannerMsg').textContent`), new RegExp(`Labels/${IMG0}\.txt.*locked by another program`));
  assert.equal((await snap(b)).unsaved, 1);
}));

test('R6: a label file named like its image except for case is shown, flagged and never written', { skip }, () => withBrowser(async b => {
  const files = ORIGINAL();
  const upper = IMG0.toUpperCase() + '.txt';
  files[`Labels/${upper}`] = files[`Labels/${IMG0}.txt`]; delete files[`Labels/${IMG0}.txt`];
  await putFolder(b, 'round', files);
  await openRound(b);
  assert.equal((await snap(b)).boxes.length, 3, 'its boxes are shown');
  assert.match(b.dialogs.join('\n'), /differs from .* only in upper\/lower case/);
  const checks = await b.evaluate(`[...document.querySelectorAll('#checksPanel .check-item .msg')].map(e => e.textContent)`);
  assert.match(checks[0], new RegExp(`Labels/${upper}.*needs exactly ${IMG0}\.txt`));
  await drag(b, { x: 0.80, y: 0.80 }, { x: 0.90, y: 0.90 });
  await sleep(1200);
  const disk = await getFolder(b, 'round');
  assert.ok(disk[`Labels/${upper}`].equals(files[`Labels/${upper}`]), 'the mismatched file is not touched');
  assert.equal(disk[`Labels/${IMG0}.txt`], undefined, 'no second file either');
  assert.match(await b.evaluate(`document.getElementById('saveBannerMsg').textContent`), /must be renamed/);
}));

test('no catch block in the app is silent', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const app = html.slice(html.indexOf('<script id="yoloble-core">'));
  assert.deepEqual(app.match(/catch\s*(\(\s*\w*\s*\))?\s*\{\s*\}/g) || [], []);
});

test('an unreadable classes.txt is reported when the folder opens', { skip }, () => withBrowser(async b => {
  await putFolder(b, 'round', ORIGINAL());
  await b.evaluate(`(() => { const g = FileSystemFileHandle.prototype.getFile; let n = 0;
    FileSystemFileHandle.prototype.getFile = function () { return this.name === 'classes.txt' && ++n > 1 ? Promise.reject(new DOMException('read error (simulated)', 'NotReadableError')) : g.call(this); }; })()`);
  await openRound(b);
  assert.match(b.dialogs.join('\n'), /classes\.txt could not be read \(read error \(simulated\)\)/);
}));

test('the vendored JSZip is the published file (sha256 with LF line endings) and its notices are present', () => {
  const crypto = require('node:crypto');
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const start = html.indexOf('<script id="jszip">') + '<script id="jszip">'.length;
  const body = html.slice(start, html.indexOf('</script>', start)).replace(/^\r?\n/, '').replace(/\r?\n$/, '').replace(/\r\n/g, '\n');
  const hash = crypto.createHash('sha256').update(body, 'utf8').digest('hex');
  assert.equal(hash, 'acc7e41455a80765b5fd9c7ee1b8078a6d160bbbca455aeae854de65c947d59e');
  const notices = fs.readFileSync(path.join(__dirname, '..', 'THIRD-PARTY-NOTICES.md'), 'utf8');
  assert.match(notices, /JSZip 3\.10\.1[\s\S]*Copyright \(c\) 2009-2016 Stuart Knightley[\s\S]*Permission is hereby granted/);
  assert.match(notices, /pako[\s\S]*Copyright \(C\) 2014-2017 by Vitaly Puzrin and Andrei Tuputcyn[\s\S]*Permission is hereby granted/);
});

test('N1: a review reaches image_status.json only after its label file is on disk', { skip }, () => withBrowser(async b => {
  const orig = ORIGINAL();
  await putFolder(b, 'round', orig);
  await openRound(b);
  await b.evaluate(`(() => { const P = FileSystemDirectoryHandle.prototype, g = P.getFileHandle; window.__lock = true;
    P.getFileHandle = function (n, o) { if (window.__lock && o?.create && n === '${IMG0}.txt') return Promise.reject(new DOMException('file is locked by another program', 'NoModificationAllowedError')); return g.call(this, n, o); }; })()`);
  await drag(b, { x: 0.80, y: 0.80 }, { x: 0.90, y: 0.90 });
  await b.key(' ');                                   // reviewed in Yoloble, moves on
  await loaded(b, 1);
  await b.key(' ', { shift: true }); await loaded(b, 2);   // another review, whose label is fine
  await sleep(1500);
  let disk = await getFolder(b, 'round');
  let st = Object.fromEntries(JSON.parse(disk['image_status.json']).map(r => [r.name, r.status]));
  assert.notEqual(st[`${IMG0}.jpg`], 'reviewed', 'not reviewed on disk while its labels are not');
  assert.ok(disk[`Labels/${IMG0}.txt`].equals(orig[`Labels/${IMG0}.txt`]));
  assert.equal(st['clark_ave_01__a1b2c3d4__f010808.jpg'], 'reviewed', 'the other review is written');
  // The lock goes away: label first, then the review.
  await b.evaluate('window.__lock = false; YOLOUI.retrySave()');
  await settle(b);
  disk = await getFolder(b, 'round');
  st = Object.fromEntries(JSON.parse(disk['image_status.json']).map(r => [r.name, r.status]));
  assert.equal(lineCount(disk[`Labels/${IMG0}.txt`]), 4);
  assert.equal(st[`${IMG0}.jpg`], 'reviewed');
}));

test('N3: undoing an edit that could not be saved clears the save error', { skip }, () => withBrowser(async b => {
  await putFolder(b, 'round', ORIGINAL());
  await openRound(b);
  await b.evaluate(`(() => { const P = FileSystemDirectoryHandle.prototype, g = P.getFileHandle;
    P.getFileHandle = function (n, o) { if (o?.create && n === '${IMG0}.txt') return Promise.reject(new DOMException('locked', 'NoModificationAllowedError')); return g.call(this, n, o); }; })()`);
  await drag(b, { x: 0.80, y: 0.80 }, { x: 0.90, y: 0.90 });
  await b.waitFor('YOLOUI._snapshot().saveError !== null');
  await b.key('z', { ctrl: true });                    // back to what the file holds: nothing to write
  await b.waitFor('YOLOUI._snapshot().saveError === null', 8000);
  const s = await snap(b);
  assert.equal(s.unsaved, 0);
  assert.match(s.saveState, /All changes saved/);
  assert.equal(await b.evaluate(`document.getElementById('saveBanner').classList.contains('show')`), false);
}));

async function secondTab(a) {
  const b = await a.newTab();
  await b.goto(base); await b.waitFor('typeof YOLOUI === "object"'); await b.focus();
  return b;
}
const bannerButtons = t => t.evaluate(`['saveBannerCheck', 'saveBannerTakeOver'].map(id => getComputedStyle(document.getElementById(id)).display !== 'none')`);

// Slow (about a minute): while a tab of the origin is frozen, Chrome takes about 60 s to read the
// stored folder handles in the second tab (seen with the OPFS harness; reading other records is fast).
test('N2: a frozen owner window keeps a second tab read-only; Take over makes the old window read-only', { skip }, () => withBrowser(async a => {
  const orig = ORIGINAL();
  await putFolder(a, 'round', orig);
  await openRound(a);
  await settle(a); await a.evaluate('YOLOUI._saveSession()'); await sleep(1000);  // idle, as a tab is when Chrome freezes it
  await a.send('Page.setWebLifecycleState', { state: 'frozen' });      // Chrome freezes background tabs like this
  const b = await secondTab(a);
  await openRound(b);
  assert.match((await snap(b)).saveState, /Open in another window/);
  assert.match(await b.evaluate(`document.getElementById('saveBannerMsg').textContent`), /does not answer/);
  assert.deepEqual(await bannerButtons(b), [true, true]);
  // Take over (confirmed), then edit in the new window: it saves.
  await b.evaluate('YOLOUI.takeOverFolder()');
  assert.match((await snap(b)).saveState, /All changes saved/);
  await drag(b, { x: 0.80, y: 0.80 }, { x: 0.90, y: 0.90 });
  await settle(b);
  // The old window wakes up: it is read-only and writes nothing.
  await a.send('Page.setWebLifecycleState', { state: 'active' });
  await a.focus();
  await a.waitFor(`/Taken over/.test(YOLOUI._snapshot().saveState)`);
  await drag(a, { x: 0.05, y: 0.05 }, { x: 0.15, y: 0.15 });
  await sleep(1000);
  assert.equal(lineCount((await getFolder(a, 'round'))[`Labels/${IMG0}.txt`]), 4, 'only the new window\'s edit');
}));

test('N2: an owner blocked by a dialog keeps a second tab read-only; Check again lets it in once the owner has gone', { skip }, () => withBrowser(async a => {
  await putFolder(a, 'round', ORIGINAL());
  await openRound(a);
  await a.send('Page.disable');                                          // the dialog stays open (not answered by the driver)
  a.send('Runtime.evaluate', { expression: 'setTimeout(() => alert("Opened with warnings"), 0)' }).catch(() => {});
  await sleep(300);
  const b = await secondTab(a);
  await openRound(b);
  assert.match((await snap(b)).saveState, /Open in another window/);
  assert.deepEqual(await bannerButtons(b), [true, true]);
  // The first window goes away (navigated elsewhere, its lock is released): Check again gives this one the folder.
  await Promise.race([a.send('Page.navigate', { url: 'about:blank' }).catch(() => {}), sleep(3000)]);
  await sleep(500);
  await b.focus();
  await b.evaluate(`(async () => { await new Promise(r => setTimeout(r, 300)); await YOLOUI.checkFolderAgain(); })()`);
  await b.waitFor(`/All changes saved/.test(YOLOUI._snapshot().saveState)`);
}));

module.exports = { dropFiles, withBrowser, profileDir, loaded, ORIGINAL, IMG0 };
