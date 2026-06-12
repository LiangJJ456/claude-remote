'use strict';
const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');
const { Session } = require('./session');

class SessionManager extends EventEmitter {
  constructor({ dataDir, command, args = [], bufferLimit }) {
    super();
    this.dataDir = dataDir;
    this.command = command;
    this.args = args;
    this.bufferLimit = bufferLimit;
    this.sessions = new Map();
    this.tombstones = this.loadOrphans();
  }

  get persistFile() {
    return path.join(this.dataDir, 'sessions.json');
  }

  loadOrphans() {
    try {
      const list = JSON.parse(fs.readFileSync(this.persistFile, 'utf8'));
      return list.map((s) => ({ ...s, state: 'exited', orphaned: true }));
    } catch {
      return [];
    }
  }

  persist() {
    const live = [...this.sessions.values()]
      .filter((s) => s.state !== 'exited')
      .map((s) => s.info());
    fs.mkdirSync(this.dataDir, { recursive: true });
    fs.writeFileSync(this.persistFile, JSON.stringify(live, null, 2));
  }

  create({ cwd, name }) {
    const session = new Session({
      command: this.command,
      args: this.args,
      cwd,
      name,
      bufferLimit: this.bufferLimit,
    });
    this.sessions.set(session.id, session);
    session.on('state', () => {
      this.persist();
      this.emit('session-state', session);
    });
    this.persist();
    return session;
  }

  get(id) {
    return this.sessions.get(id);
  }

  list() {
    const live = [...this.sessions.values()].map((s) => s.info());
    return [...live, ...this.tombstones];
  }

  kill(id) {
    const session = this.sessions.get(id);
    if (session) {
      session.kill();
      return;
    }
    this.tombstones = this.tombstones.filter((t) => t.id !== id);
    this.emit('session-state', null);
  }
}

module.exports = { SessionManager };
