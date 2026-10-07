'use strict';
// Generates label files that probe every way JavaScript and Python could read
// a line differently. Output: tests/parity/cases.json ([base64 bytes]).
// Then, from the irs repository: python <Yoloble>/tests/parity/irs_verdicts.py
// writes tests/parity/irs_label_cases.json, which tests/core.test.js checks.
const fs = require('node:fs');
const path = require('node:path');

let seed = 20261006;
const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
const pick = a => a[Math.floor(rnd() * a.length)];

const CLASS = ['0', '1', '3', '8', '9', '12', '01', '1.0', '-1', '+1', 'a', '١', '0x1'];
const NUM = ['0.5', '0.25', '0.1', '1e0', '1E-1', '5e-1', '0x1', '1_0', '0.2_5', '1__0', '.5', '5.', '+.5', '-0', '-0.1', '1.0000004', '0.9999999',
  'inf', '-inf', 'nan', 'Infinity', 'infinity', 'NaN', '1e400', '0.5.5', '', '1e', 'e1', '0.000000', '1', '0'];
const SEP = [' ', ' ', ' ', '  ', '\t', ' ', '　', ' ', '﻿', '\x1f'];
const EOL = ['\n', '\n', '\n', '\r\n', '\r', '\x0c', '\x0b', ' ', '\x85', '\x1c'];

function goodLine() {
  const w = (rnd() * 0.3 + 0.01).toFixed(6), h = (rnd() * 0.3 + 0.01).toFixed(6);
  return [pick(['0', '1', '2', '8']), (0.2 + rnd() * 0.6).toFixed(6), (0.2 + rnd() * 0.6).toFixed(6), w, h];
}
function line() {
  const f = goodLine();
  const k = rnd();
  if (k < 0.25) f[0] = pick(CLASS);
  else if (k < 0.55) f[1 + Math.floor(rnd() * 4)] = pick(NUM);
  else if (k < 0.62) f.pop();
  else if (k < 0.66) f.push('0.1');
  else if (k < 0.70) return pick(['', ' ', '\t', ' ']);
  const sep = rnd() < 0.7 ? ' ' : pick(SEP);
  return (rnd() < 0.08 ? pick([' ', '\t']) : '') + f.join(sep) + (rnd() < 0.08 ? pick([' ', ' ']) : '');
}

const cases = [];
const fixed = ['', ' \n', '\n', '0 0.5 0.5 0.1 0.1', '0 0.5 0.5 0.1 0.1\n', '﻿0 0.5 0.5 0.1 0.1\n', '0 0.5 0.5 0.1 0.1\n﻿', '0x1 0.5 0.5 0.1 0.1\n',
  '1 1e0 0.5 0.1 0.1\n', '1 0.5 0.5 1e-1 1E-1\n', '1.5 0.5 0.5 0.1 0.1\n', '1 0x1 0.5 0.1 0.1\n', '1 0.5 0.5 0.1 0.1\r\n2 0.5 0.5 0.1 0.1\r\n',
  '1 0.5_0 0.5 0.1 0.1\n', '1 0.95 0.5 0.1000004 0.1\n', '1 1.0000004 0.5 0.1 0.1\n', '1 0.5 0.5 0.1 0.1\n', '1﻿0.5 0.5 0.1 0.1\n',
  '0 0.5 0.5 0.2 0.2\n0 0.5005 0.5 0.2 0.2\n', '0 0.5 0.5 0.2 0.2\n1 0.5005 0.5 0.2 0.2\n0 0.5 0.5 0.2 0.2\n', '١ 0.5 0.5 0.1 0.1\n',
  '² 0.5 0.5 0.1 0.1\n', '1 ０.5 0.5 0.1 0.1\n', '1 0.5 0.5 0.1 nan\n', '1 0.5 0.5 1e400 0.1\n'];
for (const t of fixed) cases.push(Buffer.from(t, 'utf8'));
for (let i = 0; i < 1500; i++) {
  const n = Math.floor(rnd() * 5);
  let t = (rnd() < 0.05 ? '﻿' : '') + Array.from({ length: n }, line).join(pick(EOL)) + (rnd() < 0.7 ? pick(EOL) : '');
  let b = Buffer.from(t, 'utf8');
  if (rnd() < 0.03) b = Buffer.concat([b, Buffer.from([0xff, 0x0a])]);       // invalid UTF-8
  if (rnd() < 0.02) b = Buffer.concat([Buffer.from([0xc3]), b]);             // truncated sequence
  cases.push(b);
}
fs.writeFileSync(path.join(__dirname, 'cases.json'), JSON.stringify(cases.map(b => b.toString('base64'))));
console.log('wrote', cases.length, 'cases');
