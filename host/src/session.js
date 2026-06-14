'use strict';
const path = require('path');
const crypto = require('crypto');
const { EventEmitter } = require('events');
const pty = require('@lydell/node-pty');
const { RingBuffer } = require('./ring-buffer');
const { listTranscripts } = require('./transcript');

// 宿主本身可能是在一个 claude 会话里启动的（开发/嵌套场景）。那样子进程 claude 会继承
// CLAUDE_CODE_* / CLAUDECODE 等“嵌套子会话”标记，进而以子会话模式运行——不落地 transcript
// 文件（只在 hook 里报一个并不存在的 transcript_path）。这里剥掉这些标记，让 spawn 出来的
// claude 当作全新的顶层会话，正常写 transcript，手机通知才能读到回复内容。
const NESTING_ENV_KEYS = [
  'CLAUDECODE', 'CLAUDE_CODE_ENTRYPOINT', 'CLAUDE_CODE_CHILD_SESSION',
  'CLAUDE_CODE_SESSION_ID', 'CLAUDE_CODE_EXECPATH', 'CLAUDE_EFFORT', 'AI_AGENT',
];
function cleanSpawnEnv(hostSessionId) {
  const env = { ...process.env };
  for (const k of NESTING_ENV_KEYS) delete env[k];
  env.CC_HOST_SESSION_ID = hostSessionId;
  return env;
}

class Session extends EventEmitter {
  constructor({ command, args = [], cwd, name, bufferLimit = 1024 * 1024 }) {
    super();
    this.setMaxListeners(100);
    this.id = crypto.randomUUID();
    this.name = name || path.basename(cwd) || cwd;
    this.cwd = cwd;
    this.createdAt = new Date().toISOString();
    // 创建时已存在的 transcript（基线）：会话停下时“新出现的那个”就是它自己的，
    // 这样同一目录下有多个会话也不会取错（见 transcript.findSessionTranscript）。
    this.transcriptBaseline = new Set(listTranscripts(cwd));
    this.state = 'working';
    this.buffer = new RingBuffer(bufferLimit);
    this.pty = pty.spawn(command, args, {
      name: 'xterm-256color',
      cols: 80,
      rows: 24,
      cwd,
      env: cleanSpawnEnv(this.id),
    });
    this.pty.onData((data) => {
      const buf = Buffer.from(data, 'utf8');
      this.buffer.push(buf);
      try {
        this.emit('data', buf);
      } catch (e) {
        console.error('session data listener error:', e);
      }
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
    try {
      this.pty.write(data);
    } catch {
      // PTY 已死但 onExit 尚未触发：直接进入终态
      this.setState('exited');
      return;
    }
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
