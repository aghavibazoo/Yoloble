// Minimal Chrome DevTools Protocol driver for the end-to-end tests.
// Uses only Node built-ins (child_process, fs, WebSocket in Node >= 22).
'use strict';
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const CANDIDATES = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].filter(Boolean);

function findChrome() { return CANDIDATES.find(p => { try { return fs.statSync(p).isFile(); } catch { return false; } }) || null; }

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function launch({ userDataDir, port = 9300 + Math.floor(Math.random() * 500) } = {}) {
  const exe = findChrome();
  if (!exe) throw new Error('No Chromium-based browser found (set CHROME_PATH)');
  const dir = userDataDir || fs.mkdtempSync(path.join(os.tmpdir(), 'yoloble-e2e-'));
  const proc = spawn(exe, [
    '--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${dir}`,
    '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--window-size=1600,1000', 'about:blank',
  ], { stdio: 'ignore' });
  let targets;
  for (let i = 0; i < 100; i++) {
    try { targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json(); if (targets.length) break; } catch {}
    await sleep(100);
  }
  if (!targets) { proc.kill(); throw new Error('browser did not start'); }
  const page = targets.find(t => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0; const pending = new Map(); const listeners = [];
  ws.onmessage = ev => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) { const { res, rej } = pending.get(msg.id); pending.delete(msg.id); msg.error ? rej(new Error(msg.error.message)) : res(msg.result); }
    else if (msg.method) listeners.forEach(l => l(msg));
  };
  const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); });
  const consoleLog = [], dialogs = []; let dialogAccept = true;
  listeners.push(m => {
    if (m.method === 'Runtime.consoleAPICalled') consoleLog.push(m.params.args.map(a => a.value ?? a.description).join(' '));
    if (m.method === 'Runtime.exceptionThrown') consoleLog.push('EXCEPTION ' + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text));
    if (m.method === 'Page.javascriptDialogOpening') { dialogs.push(m.params.message); send('Page.handleJavaScriptDialog', { accept: dialogAccept }).catch(() => {}); }
  });
  await send('Runtime.enable'); await send('Page.enable');
  async function evaluate(expr) {
    const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, userGesture: true });
    if (r.exceptionDetails) throw new Error('evaluate failed: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
    return r.result.value;
  }
  async function goto(url) {
    const loaded = new Promise(res => listeners.push(m => { if (m.method === 'Page.loadEventFired') res(); }));
    await send('Page.navigate', { url }); await loaded;
  }
  async function waitFor(expr, timeout = 10000) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeout) { if (await evaluate(expr)) return true; await sleep(50); }
    throw new Error('timeout waiting for: ' + expr);
  }
  async function key(k, opts = {}) {
    const code = opts.code || (k.length === 1 ? (/[a-z]/i.test(k) ? 'Key' + k.toUpperCase() : /\d/.test(k) ? 'Digit' + k : k === ' ' ? 'Space' : k) : k);
    const mods = (opts.alt ? 1 : 0) | (opts.ctrl ? 2 : 0) | (opts.meta ? 4 : 0) | (opts.shift ? 8 : 0);
    const keyCode = opts.keyCode || (k === ' ' ? 32 : k.length === 1 ? k.toUpperCase().charCodeAt(0) : 0);
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code, modifiers: mods, windowsVirtualKeyCode: keyCode, text: k.length === 1 && !opts.ctrl ? k : undefined });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, modifiers: mods, windowsVirtualKeyCode: keyCode });
  }
  async function mouse(type, x, y, button = 'left') {
    await send('Input.dispatchMouseEvent', { type, x, y, button, buttons: type === 'mouseReleased' ? 0 : (button === 'left' ? 1 : 2), clickCount: 1 });
  }
  async function screenshot(file) {
    const r = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(file, Buffer.from(r.data, 'base64'));
  }
  // Simulates a crash: the browser process is killed without shutting down.
  async function kill() {
    try { ws.close(); } catch {}
    proc.kill('SIGKILL');
    await new Promise(r => { if (proc.exitCode !== null) return r(); proc.on('exit', r); setTimeout(r, 5000); });
    await sleep(1500); // let child processes release the profile
  }
  async function close() {
    try { await send('Browser.close'); } catch {}
    await new Promise(r => { if (proc.exitCode !== null) return r(); proc.on('exit', r); setTimeout(r, 5000); });
  }
  return { send, evaluate, goto, waitFor, key, mouse, screenshot, close, kill, consoleLog, dialogs, setDialogAccept: v => { dialogAccept = v; }, userDataDir: dir };
}

module.exports = { launch, findChrome, sleep };
