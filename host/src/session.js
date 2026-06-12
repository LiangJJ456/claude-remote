'use strict';
const path = require('path');
const crypto = require('crypto');
const { EventEmitter } = require('events');
const pty = require('@lydell/node-pty');
const { RingBuffer } = require('./ring-buffer');

class Session extends EventEmitter {
  constructor({ command, args = [], cwd, name, bufferLimit = 1024 * 1024 }) {
    super();
    this.setMaxListeners(100);
    this.id = crypto.randomUUID();
    this.name = name || path.basename(cwd);
    this.cwd = cwd;
    this.createdAt = new Date().toISOString();
    this.state = 'working';
    this.buffer = new RingBuffer(bufferLimit);
    this.pty = pty.spawn(command, args, {
      name: 'xterm-256color',
      cols: 80,
      rows: 24,
      cwd,
      env: { ...process.env, CC_HOST_SESSION_ID: this.id },
    });
    this.pty.onData((data) => {
      const buf = Buffer.from(data, 'utf8');
      this.buffer.push(buf);
      this.emit('data', buf);
    });
    this.pty.onExit(() => this.setState('exited'));
  }

  setState(state) {
    if (this.state === state || this.state === 'exited') return;
    this.state = state;
    this.emit('state', state);
  }

  write(data) {
    if (this.state === 'exited') return;
    this.pty.write(data);
    this.setState('working');
  }

  resize(cols, rows) {
    if (this.state === 'exited') return;
    this.pty.resize(cols, rows);
  }

  kill() {
    if (this.state !== 'exited') this.pty.kill();
  }

  info() {
    const { id, name, cwd, state, createdAt } = this;
    return { id, name, cwd, state, createdAt };
  }
}

module.exports = { Session };
