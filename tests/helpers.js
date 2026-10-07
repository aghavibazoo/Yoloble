'use strict';
// Helpers for the end-to-end tests (tests/e2e.test.js) and for ad-hoc scripts:
// a static server for the repository, and OPFS folder copies driven over CDP.
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');

const ROOT = path.join(__dirname, '..');
const SAMPLE = path.join(ROOT, 'samples', 'round_sample');

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

async function clickAt(b, p) {
  const [c] = await b.evaluate(`YOLOUI._toClient(${JSON.stringify([p])})`);
  await b.mouse('mousePressed', c.x, c.y); await b.mouse('mouseReleased', c.x, c.y);
}
const boxCenter = bx => ({ x: bx.xc, y: bx.yc });

// Slow disk: every write's close() takes `ms` (like a network share), so saves
// stay in flight long enough to race with edits.
const slowDisk = (b, ms) => b.evaluate(`(() => { const P = FileSystemWritableFileStream.prototype;
  if (!P.__realClose) P.__realClose = P.close;
  P.close = async function () { await new Promise(r => setTimeout(r, ${ms})); return P.__realClose.call(this); }; })()`);

module.exports = { slowDisk, ROOT, SAMPLE, serve, walk, sampleFiles, putFolder, getFolder, openRound, snap, lineCount, settle, drag, clickAt, boxCenter };
