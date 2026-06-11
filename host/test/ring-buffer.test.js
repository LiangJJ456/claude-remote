'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { RingBuffer } = require('../src/ring-buffer');

test('保存并完整回放写入内容', () => {
  const rb = new RingBuffer(100);
  rb.push(Buffer.from('hello '));
  rb.push(Buffer.from('world'));
  assert.strictEqual(rb.snapshot().toString(), 'hello world');
});

test('超过上限时丢弃最旧数据', () => {
  const rb = new RingBuffer(10);
  rb.push(Buffer.from('aaaaa'));
  rb.push(Buffer.from('bbbbb'));
  rb.push(Buffer.from('ccccc'));
  const s = rb.snapshot().toString();
  assert.ok(s.length <= 10);
  assert.ok(s.endsWith('ccccc'));
  assert.ok(!s.includes('a'));
  assert.strictEqual(s, 'bbbbbccccc');
});

test('单块超过上限时只保留末尾', () => {
  const rb = new RingBuffer(4);
  rb.push(Buffer.from('abcdefgh'));
  assert.strictEqual(rb.snapshot().toString(), 'efgh');
});

test('limit 非正整数时抛出 RangeError', () => {
  assert.throws(() => new RingBuffer(0), RangeError);
  assert.throws(() => new RingBuffer(-1), RangeError);
});

test('push 空 Buffer 不影响内容', () => {
  const rb = new RingBuffer(10);
  rb.push(Buffer.from('abc'));
  rb.push(Buffer.alloc(0));
  assert.strictEqual(rb.snapshot().toString(), 'abc');
});
