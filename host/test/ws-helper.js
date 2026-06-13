'use strict';
const WebSocket = require('ws');

class TestClient {
  constructor(port) {
    this.ws = new WebSocket(`ws://127.0.0.1:${port}`);
    this.queue = [];
    this.waiters = [];
    this.ws.on('message', (raw) => {
      const msg = JSON.parse(raw.toString());
      const i = this.waiters.findIndex((w) => w.match(msg));
      if (i >= 0) this.waiters.splice(i, 1)[0].resolve(msg);
      else this.queue.push(msg);
    });
    this.opened = new Promise((r) => this.ws.on('open', r));
    this.closed = new Promise((r) => this.ws.on('close', r));
  }

  send(msg) {
    this.ws.send(JSON.stringify(msg));
  }

  next(match = () => true, timeout = 15000) {
    const i = this.queue.findIndex(match);
    if (i >= 0) return Promise.resolve(this.queue.splice(i, 1)[0]);
    return new Promise((resolve, reject) => {
      const waiter = { match, resolve };
      this.waiters.push(waiter);
      setTimeout(() => {
        const idx = this.waiters.indexOf(waiter);
        if (idx >= 0) {
          this.waiters.splice(idx, 1);
          reject(new Error('等待消息超时'));
        }
      }, timeout).unref();
    });
  }
}

async function authedClient(port, token) {
  const c = new TestClient(port);
  await c.opened;
  c.send({ type: 'auth', token });
  await c.next((m) => m.type === 'auth_ok');
  return c;
}

module.exports = { TestClient, authedClient };
