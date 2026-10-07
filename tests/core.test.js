'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('./load-core').loadCore();

test('splitLines follows Python splitlines for \n, \r\n and a trailing newline', () => {
  assert.deepEqual(C.splitLines(''), []);
  assert.deepEqual(C.splitLines('a\nb\n'), ['a', 'b']);
  assert.deepEqual(C.splitLines('a\r\nb'), ['a', 'b']);
  assert.deepEqual(C.splitLines('a\n\nb'), ['a', '', 'b']);
});

test('parseLabelText keeps line indexes and reports bad lines', () => {
  const r = C.parseLabelText('0 0.5 0.5 0.1 0.2\nbad line\n\n3 0.1 0.2 0.05 0.05\n');
  assert.equal(r.boxes.length, 2);
  assert.deepEqual(r.boxes[0], { cls: 0, xc: 0.5, yc: 0.5, w: 0.1, h: 0.2, line: 0 });
  assert.equal(r.boxes[1].line, 3);
  assert.deepEqual(r.bad.map(b => b.line), [1, 2]);
  assert.equal(r.lineCount, 4);
});

test('parseLabelText treats whitespace-only and BOM-prefixed files sensibly', () => {
  assert.deepEqual(C.parseLabelText('  \n ').boxes, []);
  assert.equal(C.parseLabelText('  \n ').bad.length, 0);
  assert.equal(C.parseLabelText('﻿1 0.5 0.5 0.1 0.1').boxes[0].cls, 1);
});

test('serializeLabels writes six decimals, one box per line, trailing newline', () => {
  assert.equal(C.serializeLabels([]), '');
  assert.equal(C.serializeLabels([{ cls: 2, xc: 0.5, yc: 0.25, w: 0.1, h: 1 / 3 }]), '2 0.500000 0.250000 0.100000 0.333333\n');
  assert.equal(C.serializeLabels([{ cls: 0, xc: -1e-9, yc: 0.5, w: 0.1, h: 0.1 }]).startsWith('0 0.000000 '), true);
});

test('parse then serialize round-trips canonical text', () => {
  const text = '0 0.500000 0.500000 0.100000 0.200000\n8 0.900000 0.100000 0.050000 0.050000\n';
  assert.equal(C.serializeLabels(C.parseLabelText(text).boxes), text);
});

test('iou', () => {
  const a = { xc: 0.5, yc: 0.5, w: 0.2, h: 0.2 };
  assert.ok(Math.abs(C.iou(a, a) - 1) < 1e-12);
  assert.equal(C.iou(a, { xc: 0.9, yc: 0.9, w: 0.1, h: 0.1 }), 0);
  assert.ok(Math.abs(C.iou(a, { xc: 0.6, yc: 0.5, w: 0.2, h: 0.2 }) - 1 / 3) < 1e-12);
});

test('labelFileNameFor swaps only the last extension', () => {
  assert.equal(C.labelFileNameFor('site__vid__f000123.jpg'), 'site__vid__f000123.txt');
  assert.equal(C.labelFileNameFor('a.b.JPEG'), 'a.b.txt');
});
