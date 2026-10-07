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
const http = require('node:http');
const { launch, findChrome, sleep } = require('./cdp');

const ROOT = path.join(__dirname, '..');
const SAMPLE = path.join(ROOT, 'samples', 'round_sample');
const skip = findChrome() ? false : 'no Chromium-based browser found (set CHROME_PATH)';

function serve() {
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.jpg': 'image/jpeg', '.txt': 'text/plain' };
  const server = http.createServer((req, res) => {
    const rel = decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/^\/+/, '');
    const file = path.resolve(ROOT, rel || 'index.html');
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'content-type': types[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise(r => server.listen(0, '127.0.0.1', () => r(server)));
}

function walk(dir, base = dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    const full = path.join(dir, e.name);
    return e.isDirectory() ? walk(full, base) : [path.relative(base, full).split(path.sep).join('/')];
  });
}
const sampleFiles = () => Object.fromEntries(walk(SAMPLE).map(rel => [rel, fs.readFileSync(path.join(SAMPLE, rel))]));

// Copy files ({rel: Buffer}) into OPFS directory `dir`, replacing it.
async function putFolder(b, dir, files) {
  const payload = Object.entries(files).map(([rel, buf]) => [rel, buf.toString('base64')]);
  await b.evaluate(`(async () => {
    const root = await navigator.storage.getDirectory();
    try { await root.removeEntry(${JSON.stringify(dir)}, { recursive: true }); } catch {}
    const top = await root.getDirectoryHandle(${JSON.stringify(dir)}, { create: true });
    for (const [rel, b64] of ${JSON.stringify(payload)}) {
      const parts = rel.split('/'); let d = top;
      for (const p of parts.slice(0, -1)) d = await d.getDirectoryHandle(p, { create: true });
      const w = await (await d.getFileHandle(parts.at(-1), { create: true })).createWritable();
      await w.write(Uint8Array.from(atob(b64), c => c.charCodeAt(0))); await w.close();
    }
  })()`);
}

// Read OPFS directory `dir` back as {rel: Buffer}.
async function getFolder(b, dir) {
  const out = await b.evaluate(`(async () => {
    const out = {};
    async function walk(d, prefix) {
      for await (const [name, h] of d.entries()) {
        if (h.kind === 'directory') await walk(h, prefix + name + '/');
        else { const buf = new Uint8Array(await (await h.getFile()).arrayBuffer()); let s = ''; for (const c of buf) s += String.fromCharCode(c); out[prefix + name] = btoa(s); }
      }
    }
    await walk(await (await navigator.storage.getDirectory()).getDirectoryHandle(${JSON.stringify(dir)}), '');
    return out;
  })()`);
  return Object.fromEntries(Object.entries(out).map(([k, v]) => [k, Buffer.from(v, 'base64')]));
}

async function openRound(b, dir = 'round') {
  await b.evaluate(`(async () => { const r = await navigator.storage.getDirectory(); await YOLOUI._openFolder(await r.getDirectoryHandle(${JSON.stringify(dir)})); })()`);
  await b.waitFor(`getComputedStyle(document.getElementById('loadingOverlay')).display === 'none' && YOLOUI._snapshot().count > 0`);
  await b.evaluate('YOLOUI.fitToScreen()');
}
const snap = b => b.evaluate('YOLOUI._snapshot()');
const lineCount = text => String(text).split('\n').filter(l => l.trim()).length;
const settle = async b => { await b.evaluate('YOLOUI._flushSaves()'); await b.waitFor('YOLOUI._snapshot().unsaved === 0'); };

// Drag on the canvas from one normalised image point to another.
async function drag(b, from, to) {
  const pts = await b.evaluate(`YOLOUI._toClient(${JSON.stringify([from, to])})`);
  await b.mouse('mousePressed', pts[0].x, pts[0].y);
  await b.mouse('mouseMoved', (pts[0].x + pts[1].x) / 2, (pts[0].y + pts[1].y) / 2);
  await b.mouse('mouseMoved', pts[1].x, pts[1].y);
  await b.mouse('mouseReleased', pts[1].x, pts[1].y);
}

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
  assert.match(lines[3], /^0 0\.85\d{4} 0\.85\d{4} 0\.1\d{5} 0\.1\d{5}$/);

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
  await b.waitFor(`YOLOUI._snapshot().name === '${IMG3}.jpg'`);
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

module.exports = { putFolder, getFolder, openRound, snap, settle, drag, withBrowser, sampleFiles };
