'use strict';

class RingBuffer {
  constructor(limit) {
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
      this.chunks[0] = only.subarray(only.length - this.limit);
      this.size = this.limit;
    }
  }

  snapshot() {
    return Buffer.concat(this.chunks);
  }
}

module.exports = { RingBuffer };
