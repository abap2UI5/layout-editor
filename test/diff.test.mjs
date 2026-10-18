// The line diff of the Changes view (src/diff.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { diffLines, diffHunks } from '../src/diff.js';

const apply = (d) => d.filter((l) => l.op !== '-').map((l) => l.text);
const original = (d) => d.filter((l) => l.op !== '+').map((l) => l.text);

test('a diff gives back both sides, and changes no more than it has to', () => {
  const a = ['a', 'b', 'c', 'd', 'e'];
  const b = ['a', 'x', 'c', 'd', 'e', 'f'];
  const d = diffLines(a, b);
  assert.deepEqual(original(d), a);
  assert.deepEqual(apply(d), b);
  assert.equal(d.filter((l) => l.op !== ' ').length, 3, 'b out, x in, f in');
});

test('equal sides have no change, empty sides are all one kind', () => {
  assert.ok(diffLines(['a', 'b'], ['a', 'b']).every((l) => l.op === ' '));
  assert.deepEqual(diffLines([], ['a']).map((l) => l.op), ['+']);
  assert.deepEqual(diffLines(['a'], []).map((l) => l.op), ['-']);
});

test('hunks keep the context around a change, count what they leave out, number both sides', () => {
  const a = Array.from({ length: 20 }, (_, i) => `line ${i + 1}`);
  const b = [...a];
  b[9] = 'changed';
  const h = diffHunks(a, b, 2);
  assert.equal(h.added, 1);
  assert.equal(h.removed, 1);
  assert.deepEqual(h.lines.map((l) => l.op), ['…', ' ', ' ', '-', '+', ' ', ' ', '…']);
  assert.equal(h.lines[0].count, 7);
  assert.equal(h.lines.at(-1).count, 8);
  assert.equal(h.lines[3].a, 10);
  assert.equal(h.lines[4].b, 10);
  assert.deepEqual(diffHunks(a, a).lines, [{ op: '…', count: 20 }]);
});
