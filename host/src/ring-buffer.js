'use strict';

class RingBuffer {
  constructor(limit) {
    if (!Number.isInteger(limit) || limit <= 0) {
      throw new RangeError(`RingBuffer limit must be a positive integer, got ${limit}`);
    }
    this.limit = limit;
    this.chunks = [];
    this.size = 0;
  }

  push(buf) {
    this.chunks.push(buf);
    this.size += buf.length;
    while (this.size > this.limit && this.chunks.length > 1) {
      const dropped = this.chunks.shift();
      this.size -= dropped.length;
    }
    if (this.size > this.limit) {
      const only = this.chunks[0];
      // 必须拷贝：subarray 只是视图，会让超大父 ArrayBuffer 一直驻留内存
      this.chunks[0] = Buffer.from(only.subarray(only.length - this.limit));
      this.size = this.limit;
    }
  }

  snapshot() {
    return Buffer.concat(this.chunks);
  }
}

module.exports = { RingBuffer };
