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

test('isSafeFileName refuses paths and reserved names', () => {
  for (const ok of ['a.txt', 'site__vid__f000001.txt', 'image_status.json', 'with space.txt']) assert.equal(C.isSafeFileName(ok), true, ok);
  for (const bad of ['', '.', '..', '../x.txt', 'a/b.txt', 'a\b.txt', 'c:x.txt', 'a\u0000.txt', 'x'.repeat(256)]) assert.equal(C.isSafeFileName(bad), false, JSON.stringify(bad));
});

test('parseStatusJson keeps exact names and skips malformed rows', () => {
  const r = C.parseStatusJson('[{"name":"A.jpg","status":"reviewed"},{"name":"b.jpg"},null,{"name":"c.jpg","status":"deleted"}]');
  assert.equal(r.error, null);
  assert.deepEqual([...r.entries], [['A.jpg', 'reviewed'], ['c.jpg', 'deleted']]);
  assert.match(C.parseStatusJson('{').error, /not valid JSON/);
  assert.match(C.parseStatusJson('{}').error, /not a JSON array/);
});

test('serializeStatusJson writes one sorted entry per name', () => {
  const st = { 'b.jpg': 'reviewed', 'a.jpg': 'deleted' };
  const text = C.serializeStatusJson(['b.jpg', 'a.jpg', 'c.jpg', 'a.jpg'], n => st[n]);
  assert.deepEqual(JSON.parse(text), [
    { name: 'a.jpg', status: 'deleted' }, { name: 'b.jpg', status: 'reviewed' }, { name: 'c.jpg', status: 'unlabeled' }]);
  assert.ok(text.endsWith(']\n'));
});

test('canonicalLabelText ignores formatting but keeps files with bad lines as they are', () => {
  assert.equal(C.canonicalLabelText(null), null);
  assert.equal(C.canonicalLabelText('0 0.5 0.5 0.1 0.1'), '0 0.500000 0.500000 0.100000 0.100000\n');
  assert.equal(C.canonicalLabelText(''), '');
  assert.equal(C.canonicalLabelText('0 0.5 0.5 0.1\n'), '0 0.5 0.5 0.1\n');
});

test('planRecovery restores only changes the folder never received', () => {
  const session = {
    labels: {
      saved: { text: 'A', base: 'old' },        // the folder already has it
      lost: { text: 'B', base: 'old' },         // the folder still has the base: restore
      lostNew: { text: 'C', base: null },       // file never existed: restore
      moved: { text: 'D', base: 'old' },        // folder changed since: conflict
    },
    statuses: { a: 'reviewed', b: 'reviewed', c: 'labeled', d: 'deleted', e: 'reviewed', f: 'reviewed' },
    statusBase: { a: 'unlabeled', b: 'unlabeled', c: 'unlabeled', d: 'unlabeled', e: 'labeled', f: 'unlabeled' },
  };
  const diskLabels = { saved: 'A', lost: 'old', lostNew: null, moved: 'other' };
  const diskStatus = { a: 'reviewed', b: 'unlabeled', c: 'unlabeled', d: 'unlabeled', e: 'unlabeled', f: 'deleted' };
  const plan = C.planRecovery(session, { labelText: n => diskLabels[n], status: n => diskStatus[n] });
  assert.deepEqual(plan.labels, [{ name: 'lost', text: 'B' }, { name: 'lostNew', text: 'C' }]);
  // c only differs by the automatic labeled/unlabeled status: not worth offering.
  // e: the folder moved between the two not-reviewed statuses, so the review is restored.
  // f: the folder marked the image deleted meanwhile: conflict, the folder wins.
  assert.deepEqual(plan.statuses, [{ name: 'b', status: 'reviewed' }, { name: 'd', status: 'deleted' }, { name: 'e', status: 'reviewed' }]);
  assert.deepEqual(plan.conflicts, ['moved', 'f']);
});

test('planRecovery treats a missing label file like an empty one', () => {
  const plan = C.planRecovery({ labels: { a: { text: '', base: null }, b: { text: 'X', base: '' } } },
    { labelText: n => ({ a: null, b: null })[n], status: () => null });
  assert.deepEqual(plan.labels, [{ name: 'b', text: 'X' }]);
  assert.deepEqual(plan.conflicts, []);
});

test('planRecovery with no session or nothing lost is empty', () => {
  const disk = { labelText: () => null, status: () => null };
  assert.deepEqual(C.planRecovery(null, disk), { labels: [], statuses: [], conflicts: [] });
  assert.deepEqual(C.planRecovery({ labels: {}, statuses: {} }, disk), { labels: [], statuses: [], conflicts: [] });
});

const IRS_CLASSES = ['Car', 'Pickup Truck', 'Van', '2ax Truck', '3ax Truck', '4ax Truck', '5ax+ Truck', '2ax Bus', '3ax Bus'];

test('class colours are distinct for the first twenty classes and defined beyond', () => {
  const first = Array.from({ length: 20 }, (_, i) => C.classColor(i));
  assert.equal(new Set(first).size, 20);
  assert.match(C.classColor(25), /^hsl\(\d+,75%,60%\)$/);
  assert.equal(C.textColorOn('#ffe119'), '#000');
  assert.equal(C.textColorOn('#000075'), '#fff');
});

test('classForKey maps 0-9 and Shift+0-9 to classes 0-19', () => {
  assert.equal(C.classForKey('Digit3', false), 3);
  assert.equal(C.classForKey('Numpad0', false), 0);
  assert.equal(C.classForKey('Digit0', true), 10);
  assert.equal(C.classForKey('Digit9', true), 19);
  assert.equal(C.classForKey('KeyA', false), -1);
  assert.equal(C.classForKey(undefined, false), -1);
});

test('searchClasses ranks ID, prefix, word prefix, substring and multi-word matches', () => {
  assert.deepEqual(C.searchClasses(IRS_CLASSES, ''), [0, 1, 2, 3, 4, 5, 6, 7, 8]);
  assert.deepEqual(C.searchClasses(IRS_CLASSES, '8'), [8]);
  assert.deepEqual(C.searchClasses(IRS_CLASSES, 'car'), [0]);
  assert.deepEqual(C.searchClasses(IRS_CLASSES, 'pick'), [1]);
  assert.deepEqual(C.searchClasses(IRS_CLASSES, 'bus'), [7, 8]);
  assert.deepEqual(C.searchClasses(IRS_CLASSES, '3ax'), [4, 8]);
  assert.deepEqual(C.searchClasses(IRS_CLASSES, '3 bus'), [8]);
  assert.deepEqual(C.searchClasses(IRS_CLASSES, 'TRUCK'), [1, 3, 4, 5, 6]);
  assert.deepEqual(C.searchClasses(IRS_CLASSES, 'ruc'), [1, 3, 4, 5, 6]);
  assert.deepEqual(C.searchClasses(IRS_CLASSES, 'zebra'), []);
  const eleven = [...IRS_CLASSES, 'Pedestrian', 'Bicycle'];
  assert.deepEqual(C.searchClasses(eleven, '10'), [10]);
  assert.deepEqual(C.searchClasses(eleven, 'bi'), [10]);
});

test('autoStatus never overrides reviewed or deleted, and labeled means boxes, not review', () => {
  assert.equal(C.autoStatus('unlabeled', true), 'labeled');
  assert.equal(C.autoStatus(undefined, true), 'labeled');
  assert.equal(C.autoStatus('unlabeled', false), 'unlabeled');
  assert.equal(C.autoStatus('labeled', false), 'labeled', 'older "No Label" marking is kept');
  assert.equal(C.autoStatus('reviewed', true), 'reviewed');
  assert.equal(C.autoStatus('reviewed', false), 'reviewed', 'confirmed empty frame stays reviewed');
  assert.equal(C.autoStatus('deleted', true), 'deleted');
  assert.deepEqual(C.STATUSES, ['unlabeled', 'labeled', 'reviewed', 'deleted']);
  assert.equal(C.isDecided('labeled'), false);
  assert.equal(C.isDecided('reviewed'), true);
  assert.equal(C.isDecided('deleted'), true);
});

test('reviewProgress counts reviewed and deleted; labeled is not reviewed', () => {
  const st = { a: 'reviewed', b: 'labeled', c: 'deleted', d: 'unlabeled', e: 'reviewed' };
  assert.deepEqual(C.reviewProgress(Object.keys(st), n => st[n]), { total: 5, reviewed: 2, deleted: 1, remaining: 2 });
  assert.deepEqual(C.reviewProgress([], () => null), { total: 0, reviewed: 0, deleted: 0, remaining: 0 });
});

test('parseRoundJson reads the sample round', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const text = fs.readFileSync(path.join(__dirname, '..', 'samples', 'round_sample', 'round.json'), 'utf8');
  const r = C.parseRoundJson(text);
  assert.equal(r.ok, true);
  assert.deepEqual(r.warnings, []);
  assert.equal(r.round.formatVersion, 1);
  assert.equal(r.round.roundId, 3);
  assert.equal(r.round.modelId, 'm0005');
  assert.deepEqual(r.round.classes, IRS_CLASSES);
  const e = r.round.images.get('clark_ave_01__a1b2c3d4__f006138.jpg');
  assert.deepEqual(e, { reason: 'rare_class', reasonText: 'rare class: 3ax Bus', scores: { rarity: 0.82, uncertainty: 0, disagreement: 0 }, prelabelConf: [0.81, 0.79, 0.65] });
});

test('parseRoundJson refuses bad JSON and unsupported versions, and warns on bad entries', () => {
  assert.match(C.parseRoundJson('{').error, /not valid JSON/);
  assert.match(C.parseRoundJson('[]').error, /not a JSON object/);
  assert.match(C.parseRoundJson('{"round_id":1}').error, /no integer format_version/);
  const v2 = C.parseRoundJson('{"format_version":2}');
  assert.equal(v2.ok, false); assert.equal(v2.unsupported, true); assert.match(v2.error, /format_version 2.*reads version 1/);
  const r = C.parseRoundJson(JSON.stringify({ format_version: 1, classes: ['a'], images: { 'x.jpg': { prelabel_conf: [0.5, 'x'] }, 'y.jpg': 3 } }));
  assert.equal(r.ok, true);
  assert.equal(r.round.images.get('x.jpg').prelabelConf, null);
  assert.equal(r.warnings.length, 2);
  assert.match(C.parseRoundJson('{"format_version":1}').warnings.join(), /no valid "classes".*no "images"/);
});

test('prelabelApplies only while the pre-label file is untouched and not reviewed', () => {
  const base = { status: 'labeled', conf: [0.9, 0.4], lineCount: 2, edited: false };
  assert.equal(C.prelabelApplies(base), true);
  assert.equal(C.prelabelApplies({ ...base, status: 'unlabeled' }), true);
  assert.equal(C.prelabelApplies({ ...base, status: 'reviewed' }), false);
  assert.equal(C.prelabelApplies({ ...base, status: 'deleted' }), false);
  assert.equal(C.prelabelApplies({ ...base, edited: true }), false);
  assert.equal(C.prelabelApplies({ ...base, lineCount: 3 }), false, 'a line was added: the file is not the pre-label file');
  assert.equal(C.prelabelApplies({ ...base, conf: null }), false);
  assert.equal(C.prelabelApplies({ ...base, conf: [], lineCount: 0 }), false);
});

test('attachPrelabels matches confidence by line, and confirmBox drops it', () => {
  const parsed = C.parseLabelText('0 0.5 0.5 0.1 0.1\n2 0.2 0.2 0.1 0.1\n').boxes;
  const pre = C.attachPrelabels(parsed, [0.91, 0.33]);
  assert.deepEqual(pre, [
    { cls: 0, xc: 0.5, yc: 0.5, w: 0.1, h: 0.1, pre: true, conf: 0.91 },
    { cls: 2, xc: 0.2, yc: 0.2, w: 0.1, h: 0.1, pre: true, conf: 0.33 }]);
  assert.deepEqual(C.confirmBox(pre[1]), { cls: 2, xc: 0.2, yc: 0.2, w: 0.1, h: 0.1 });
  assert.equal(C.serializeLabels(pre), C.serializeLabels(parsed), 'pre-label flags never reach the file');
});
