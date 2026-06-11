# 会话宿主服务（子项目一）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 Windows 上实现一个 Node.js 会话宿主服务：用 ConPTY 托管 Claude Code 会话，电脑终端/浏览器/（未来的）手机 app 通过 WebSocket 附身操作，Claude Code Hook 事件驱动会话状态与通知（设计文档：`docs/superpowers/specs/2026-06-12-claude-remote-app-design.md`，里程碑 M1–M3）。

**Architecture:** 单进程 Node.js 服务。`Session`（一个 ConPTY 子进程 + 环形回滚缓冲，EventEmitter）→ `SessionManager`（创建/列表/终止/落盘）→ `server.js`（HTTP 静态页 + WebSocket 协议 + 仅限 loopback 的 /hook 端点）。只监听 127.0.0.1 和 Tailscale 虚拟网卡 IP。

**Tech Stack:** Node.js 20+（已装在 `C:\nvm4w\nodejs`）、`@lydell/node-pty`（带预编译二进制的 node-pty 分支，免装 VS Build Tools）、`ws`、xterm.js（CDN，网页客户端）、Node 内置 test runner（`node --test`）。

**约定：** 所有命令在 `C:\Users\galaxy\code\claude_tip` 下用 PowerShell 执行，除非另有说明。

---

## 文件结构

```
host/
  package.json
  src/
    config.js           # 加载/生成配置（端口、token、缓冲上限、claude 命令）
    ring-buffer.js      # 字节环形缓冲
    session.js          # 单个 PTY 会话（spawn、缓冲、状态机、事件）
    session-manager.js  # 会话集合：创建/列表/终止/落盘/孤儿恢复
    net.js              # 绑定地址检测（loopback + Tailscale CGNAT）
    server.js           # HTTP + WS 服务、鉴权、协议路由、/hook 端点
    index.js            # 入口
  public/
    index.html          # 网页客户端（xterm.js CDN）
    app.js
  bin/
    attach-client.js    # 终端附身 CLI（cc 命令的内核）
    cc.ps1              # 启动封装脚本
  test/
    helpers.js          # waitFor 等
    ws-helper.js        # WebSocket 测试客户端
    ring-buffer.test.js
    config.test.js
    session.test.js
    session-manager.test.js
    net.test.js
    server.test.js
  start-host.ps1        # 守护循环（崩溃自动重启）
  register-autostart.ps1
host/data/              # 运行时生成（config.json、sessions.json），gitignore
```

---

### Task 1: 项目脚手架与 PTY 冒烟验证

**Files:**
- Create: `host/package.json`
- Create: `.gitignore`

- [ ] **Step 1: 写 package.json 和 .gitignore**

`host/package.json`:
```json
{
  "name": "claude-remote-host",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "start": "node src/index.js",
    "test": "node --test test/"
  },
  "dependencies": {
    "@lydell/node-pty": "^1.1.0",
    "ws": "^8.18.0"
  }
}
```

`.gitignore`（仓库根）:
```
node_modules/
host/data/
```

- [ ] **Step 2: 安装依赖**

Run: `Set-Location host; npm install`
Expected: 安装成功，无 node-gyp 编译报错（@lydell/node-pty 自带 win32-x64 预编译二进制）。
若安装失败：改用 `npm install node-pty`（需要 VS Build Tools），并把后文所有 `@lydell/node-pty` 的 require 改为 `node-pty`。

- [ ] **Step 3: 冒烟验证 ConPTY 可用**

Run（在 `host` 目录）:
```powershell
node -e "const pty=require('@lydell/node-pty');const p=pty.spawn('powershell.exe',['-NoLogo','-NoProfile','-Command','Write-Output smoke-ok; exit'],{name:'xterm-256color',cols:80,rows:24,cwd:process.cwd()});p.onData(d=>process.stdout.write(d));p.onExit(()=>process.exit(0))"
```
Expected: 输出包含 `smoke-ok`，进程正常退出。

- [ ] **Step 4: Commit**

```powershell
git add .gitignore host/package.json host/package-lock.json
git commit -m "chore(host): 项目脚手架，验证 ConPTY 可用"
```

---

### Task 2: 环形缓冲 RingBuffer

**Files:**
- Create: `host/src/ring-buffer.js`
- Test: `host/test/ring-buffer.test.js`

- [ ] **Step 1: 写失败测试**

`host/test/ring-buffer.test.js`:
```js
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
});

test('单块超过上限时只保留末尾', () => {
  const rb = new RingBuffer(4);
  rb.push(Buffer.from('abcdefgh'));
  assert.strictEqual(rb.snapshot().toString(), 'efgh');
});
```

- [ ] **Step 2: 跑测试确认失败**

Run（在 `host` 目录）: `node --test test/ring-buffer.test.js`
Expected: FAIL，`Cannot find module '../src/ring-buffer'`

- [ ] **Step 3: 最小实现**

`host/src/ring-buffer.js`:
```js
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
```

- [ ] **Step 4: 跑测试确认通过**

Run: `node --test test/ring-buffer.test.js`
Expected: 3 个测试 PASS

- [ ] **Step 5: Commit**

```powershell
git add host/src/ring-buffer.js host/test/ring-buffer.test.js
git commit -m "feat(host): 环形回滚缓冲"
```

---

### Task 3: 配置模块 config.js

**Files:**
- Create: `host/src/config.js`
- Test: `host/test/config.test.js`

- [ ] **Step 1: 写失败测试**

`host/test/config.test.js`:
```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { loadConfig } = require('../src/config');

test('首次加载生成随机 token 并持久化，二次加载结果一致', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-config-'));
  const cfg1 = loadConfig(dir);
  assert.match(cfg1.token, /^[0-9a-f]{64}$/);
  assert.strictEqual(cfg1.port, 8787);
  assert.strictEqual(cfg1.bufferLimit, 1024 * 1024);
  assert.strictEqual(cfg1.claudeCommand, 'claude');
  const cfg2 = loadConfig(dir);
  assert.strictEqual(cfg2.token, cfg1.token);
});

test('已有配置文件中的自定义值生效', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-config-'));
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({ token: 'x', port: 9999 }));
  const cfg = loadConfig(dir);
  assert.strictEqual(cfg.port, 9999);
  assert.strictEqual(cfg.claudeCommand, 'claude');
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test test/config.test.js`
Expected: FAIL，`Cannot find module '../src/config'`

- [ ] **Step 3: 最小实现**

`host/src/config.js`:
```js
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DEFAULTS = {
  port: 8787,
  bufferLimit: 1024 * 1024,
  claudeCommand: 'claude',
  claudeArgs: [],
};

function loadConfig(dataDir) {
  const file = path.join(dataDir, 'config.json');
  if (!fs.existsSync(file)) {
    fs.mkdirSync(dataDir, { recursive: true });
    const cfg = { ...DEFAULTS, token: crypto.randomBytes(32).toString('hex') };
    fs.writeFileSync(file, JSON.stringify(cfg, null, 2));
    return cfg;
  }
  return { ...DEFAULTS, ...JSON.parse(fs.readFileSync(file, 'utf8')) };
}

module.exports = { loadConfig };
```

- [ ] **Step 4: 跑测试确认通过**

Run: `node --test test/config.test.js`
Expected: 2 个测试 PASS

- [ ] **Step 5: Commit**

```powershell
git add host/src/config.js host/test/config.test.js
git commit -m "feat(host): 配置加载与 token 生成"
```

---

### Task 4: Session（单个 PTY 会话）

**Files:**
- Create: `host/src/session.js`
- Create: `host/test/helpers.js`
- Test: `host/test/session.test.js`

- [ ] **Step 1: 写测试辅助 waitFor**

`host/test/helpers.js`:
```js
'use strict';

function waitFor(fn, timeout = 15000, interval = 50) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const timer = setInterval(() => {
      if (fn()) {
        clearInterval(timer);
        resolve();
      } else if (Date.now() - start > timeout) {
        clearInterval(timer);
        reject(new Error('waitFor 超时'));
      }
    }, interval);
  });
}

module.exports = { waitFor };
```

- [ ] **Step 2: 写失败测试**

`host/test/session.test.js`:
```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const os = require('os');
const { Session } = require('../src/session');
const { waitFor } = require('./helpers');

const PS = 'powershell.exe';
const PS_ARGS = ['-NoLogo', '-NoProfile'];

test('捕获子进程输出到缓冲，初始状态 working', async () => {
  const s = new Session({
    command: PS,
    args: [...PS_ARGS, '-Command', 'Write-Output marker123; Start-Sleep -Seconds 30'],
    cwd: os.tmpdir(),
  });
  await waitFor(() => s.buffer.snapshot().toString().includes('marker123'));
  assert.strictEqual(s.state, 'working');
  s.kill();
});

test('write 注入输入并产生输出', async () => {
  const s = new Session({ command: PS, args: PS_ARGS, cwd: os.tmpdir() });
  await waitFor(() => s.buffer.snapshot().toString().includes('PS'));
  s.write('Write-Output pong456\r');
  await waitFor(() => s.buffer.snapshot().toString().includes('pong456'));
  s.kill();
});

test('进程退出后状态为 exited 并 emit state 事件', async () => {
  const s = new Session({ command: PS, args: [...PS_ARGS, '-Command', 'exit'], cwd: os.tmpdir() });
  const states = [];
  s.on('state', (st) => states.push(st));
  await waitFor(() => s.state === 'exited');
  assert.ok(states.includes('exited'));
});

test('PTY 环境中注入 CC_HOST_SESSION_ID', async () => {
  const s = new Session({
    command: PS,
    args: [...PS_ARGS, '-Command', 'Write-Output "ID=$env:CC_HOST_SESSION_ID"; Start-Sleep -Seconds 30'],
    cwd: os.tmpdir(),
  });
  await waitFor(() => s.buffer.snapshot().toString().includes(`ID=${s.id}`));
  s.kill();
});

test('info 返回会话摘要', async () => {
  const s = new Session({ command: PS, args: PS_ARGS, cwd: os.tmpdir(), name: 'demo' });
  const info = s.info();
  assert.strictEqual(info.name, 'demo');
  assert.strictEqual(info.state, 'working');
  assert.ok(info.id && info.cwd && info.createdAt);
  s.kill();
});
```

- [ ] **Step 3: 跑测试确认失败**

Run: `node --test test/session.test.js`
Expected: FAIL，`Cannot find module '../src/session'`

- [ ] **Step 4: 实现 Session**

`host/src/session.js`:
```js
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
```

- [ ] **Step 5: 跑测试确认通过**

Run: `node --test test/session.test.js`
Expected: 5 个测试 PASS（每个会 spawn 真实 PowerShell，总耗时约 10–20 秒属正常）

- [ ] **Step 6: Commit**

```powershell
git add host/src/session.js host/test/session.test.js host/test/helpers.js
git commit -m "feat(host): PTY 会话封装（缓冲、状态机、环境变量注入）"
```

---

### Task 5: SessionManager（会话集合与落盘）

**Files:**
- Create: `host/src/session-manager.js`
- Test: `host/test/session-manager.test.js`

- [ ] **Step 1: 写失败测试**

`host/test/session-manager.test.js`:
```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { SessionManager } = require('../src/session-manager');

const PS = 'powershell.exe';
const PS_ARGS = ['-NoLogo', '-NoProfile'];

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'cc-mgr-'));
}

test('create 后 list 可见且已落盘', () => {
  const dir = tmpDir();
  const m = new SessionManager({ dataDir: dir, command: PS, args: PS_ARGS, bufferLimit: 1024 });
  const s = m.create({ cwd: os.tmpdir(), name: 'demo' });
  assert.strictEqual(m.list()[0].name, 'demo');
  assert.strictEqual(m.get(s.id), s);
  const persisted = JSON.parse(fs.readFileSync(path.join(dir, 'sessions.json'), 'utf8'));
  assert.strictEqual(persisted[0].id, s.id);
  m.kill(s.id);
});

test('上次中断的会话以 orphaned/exited 形式出现，kill 可移除', () => {
  const dir = tmpDir();
  fs.writeFileSync(
    path.join(dir, 'sessions.json'),
    JSON.stringify([{ id: 'old-1', name: 'old', cwd: 'C:/x', createdAt: '2026-01-01T00:00:00Z' }])
  );
  const m = new SessionManager({ dataDir: dir, command: PS, args: PS_ARGS, bufferLimit: 1024 });
  const t = m.list().find((s) => s.id === 'old-1');
  assert.strictEqual(t.state, 'exited');
  assert.ok(t.orphaned);
  m.kill('old-1');
  assert.ok(!m.list().some((s) => s.id === 'old-1'));
});

test('会话状态变化触发 session-state 事件', async () => {
  const dir = tmpDir();
  const m = new SessionManager({ dataDir: dir, command: PS, args: PS_ARGS, bufferLimit: 1024 });
  const events = [];
  m.on('session-state', (s) => events.push(s && s.state));
  const s = m.create({ cwd: os.tmpdir() });
  m.kill(s.id);
  await new Promise((r) => {
    const timer = setInterval(() => {
      if (events.includes('exited')) {
        clearInterval(timer);
        r();
      }
    }, 50);
  });
  assert.ok(events.includes('exited'));
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test test/session-manager.test.js`
Expected: FAIL，`Cannot find module '../src/session-manager'`

- [ ] **Step 3: 实现 SessionManager**

`host/src/session-manager.js`:
```js
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
```

- [ ] **Step 4: 跑测试确认通过**

Run: `node --test test/session-manager.test.js`
Expected: 3 个测试 PASS

- [ ] **Step 5: Commit**

```powershell
git add host/src/session-manager.js host/test/session-manager.test.js
git commit -m "feat(host): 会话管理器（落盘与孤儿会话提示）"
```

---

### Task 6: WebSocket 服务器——鉴权 + list/create

**Files:**
- Create: `host/src/server.js`
- Create: `host/test/ws-helper.js`
- Test: `host/test/server.test.js`

- [ ] **Step 1: 写 WebSocket 测试客户端辅助**

`host/test/ws-helper.js`:
```js
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
```

- [ ] **Step 2: 写失败测试（鉴权 + list + create）**

`host/test/server.test.js`:
```js
'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { SessionManager } = require('../src/session-manager');
const { createApp } = require('../src/server');
const { TestClient, authedClient } = require('./ws-helper');

const PS_ARGS = ['-NoLogo', '-NoProfile'];
const config = { token: 'test-token', port: 0 };
let server;
let port;
let manager;

before(async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-host-test-'));
  manager = new SessionManager({
    dataDir,
    command: 'powershell.exe',
    args: PS_ARGS,
    bufferLimit: 1024 * 1024,
  });
  const app = createApp({ manager, config });
  server = await app.listen('127.0.0.1', 0);
  port = server.address().port;
});

after(() => {
  for (const s of manager.list()) manager.kill(s.id);
  server.close();
});

test('错误 token：收到 error 且连接被关闭', async () => {
  const c = new TestClient(port);
  await c.opened;
  c.send({ type: 'auth', token: 'wrong' });
  await c.next((m) => m.type === 'error');
  await c.closed;
});

test('未鉴权前其他消息不被处理', async () => {
  const c = new TestClient(port);
  await c.opened;
  c.send({ type: 'list' });
  await c.next((m) => m.type === 'error');
  await c.closed;
});

test('鉴权成功后 list 返回会话数组', async () => {
  const c = await authedClient(port, 'test-token');
  c.send({ type: 'list' });
  const msg = await c.next((m) => m.type === 'sessions');
  assert.ok(Array.isArray(msg.sessions));
  c.ws.close();
});

test('create 返回 created 并广播 sessions', async () => {
  const c = await authedClient(port, 'test-token');
  c.send({ type: 'create', cwd: os.tmpdir(), name: 'it-create' });
  const created = await c.next((m) => m.type === 'created');
  assert.ok(created.sessionId);
  const list = await c.next((m) => m.type === 'sessions');
  assert.ok(list.sessions.some((s) => s.id === created.sessionId));
  manager.kill(created.sessionId);
  c.ws.close();
});
```

- [ ] **Step 3: 跑测试确认失败**

Run: `node --test test/server.test.js`
Expected: FAIL，`Cannot find module '../src/server'`

- [ ] **Step 4: 实现 server.js（本任务先实现鉴权/list/create/静态文件骨架，attach 等在 Task 7 补全）**

`host/src/server.js`（完整文件，Task 7、8 会在此基础上扩展 switch 分支和 /hook，本任务先写出全部骨架——switch 中 attach/input/resize/detach/kill 分支与 handleHook 在后续任务填充，本任务先返回未知类型错误即可）:
```js
'use strict';
const fs = require('fs');
const http = require('http');
const path = require('path');
const { WebSocketServer } = require('ws');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
};

function createApp({ manager, config }) {
  const wss = new WebSocketServer({ noServer: true });
  const authed = new Set();

  function send(ws, msg) {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
  }

  function broadcastSessions() {
    const msg = { type: 'sessions', sessions: manager.list() };
    for (const ws of authed) send(ws, msg);
  }

  function broadcastEvent(sessionId, kind) {
    const msg = { type: 'event', sessionId, kind };
    for (const ws of authed) send(ws, msg);
  }

  manager.on('session-state', (session) => {
    broadcastSessions();
    if (session && session.state === 'exited') broadcastEvent(session.id, 'session_exited');
  });

  wss.on('connection', (ws) => {
    let isAuthed = false;
    const attached = new Map();

    ws.on('message', (raw) => {
      let msg;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return send(ws, { type: 'error', message: '无法解析消息' });
      }

      if (!isAuthed) {
        if (msg.type === 'auth' && msg.token === config.token) {
          isAuthed = true;
          authed.add(ws);
          send(ws, { type: 'auth_ok' });
        } else {
          send(ws, { type: 'error', message: '鉴权失败' });
          ws.close();
        }
        return;
      }

      const session = msg.sessionId ? manager.get(msg.sessionId) : null;
      switch (msg.type) {
        case 'list':
          send(ws, { type: 'sessions', sessions: manager.list() });
          break;
        case 'create': {
          const s = manager.create({ cwd: msg.cwd, name: msg.name });
          send(ws, { type: 'created', sessionId: s.id });
          broadcastSessions();
          break;
        }
        default:
          send(ws, { type: 'error', message: `未知消息类型: ${msg.type}` });
      }
    });

    ws.on('close', () => {
      authed.delete(ws);
      for (const [id, handler] of attached) {
        const s = manager.get(id);
        if (s) s.off('data', handler);
      }
      attached.clear();
    });
  });

  function serveStatic(req, res) {
    const urlPath = req.url === '/' ? '/index.html' : req.url.split('?')[0];
    const file = path.join(PUBLIC_DIR, path.normalize(urlPath).replace(/^([.][.][\\/])+/, ''));
    if (!file.startsWith(PUBLIC_DIR) || !fs.existsSync(file)) {
      res.writeHead(404);
      return res.end('not found');
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  }

  function handleRequest(req, res) {
    serveStatic(req, res);
  }

  function listen(address, port) {
    const server = http.createServer(handleRequest);
    server.on('upgrade', (req, socket, head) => {
      wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
    });
    return new Promise((resolve) => server.listen(port, address, () => resolve(server)));
  }

  return { listen, wss };
}

module.exports = { createApp };
```

- [ ] **Step 5: 跑测试确认通过**

Run: `node --test test/server.test.js`
Expected: 4 个测试 PASS

- [ ] **Step 6: Commit**

```powershell
git add host/src/server.js host/test/ws-helper.js host/test/server.test.js
git commit -m "feat(host): WebSocket 服务器（鉴权、list、create）"
```

---

### Task 7: attach / input / resize / detach / kill

**Files:**
- Modify: `host/src/server.js`（switch 增加分支）
- Test: `host/test/server.test.js`（追加用例）

- [ ] **Step 1: 追加失败测试**

在 `host/test/server.test.js` 末尾追加:
```js
test('create → attach → input → output 全流程', async () => {
  const c = await authedClient(port, 'test-token');
  c.send({ type: 'create', cwd: os.tmpdir() });
  const { sessionId } = await c.next((m) => m.type === 'created');
  c.send({ type: 'attach', sessionId, cols: 100, rows: 30 });
  c.send({ type: 'input', sessionId, data: Buffer.from('Write-Output ping123\r').toString('base64') });
  let acc = '';
  while (!acc.includes('ping123')) {
    const m = await c.next((x) => x.type === 'output' && x.sessionId === sessionId);
    acc += Buffer.from(m.data, 'base64').toString('utf8');
  }
  manager.kill(sessionId);
  c.ws.close();
});

test('第二个客户端附身能收到缓冲回放', async () => {
  const c1 = await authedClient(port, 'test-token');
  c1.send({ type: 'create', cwd: os.tmpdir() });
  const { sessionId } = await c1.next((m) => m.type === 'created');
  c1.send({ type: 'attach', sessionId, cols: 100, rows: 30 });
  c1.send({ type: 'input', sessionId, data: Buffer.from('Write-Output replay456\r').toString('base64') });
  let acc = '';
  while (!acc.includes('replay456')) {
    const m = await c1.next((x) => x.type === 'output' && x.sessionId === sessionId);
    acc += Buffer.from(m.data, 'base64').toString('utf8');
  }
  const c2 = await authedClient(port, 'test-token');
  c2.send({ type: 'attach', sessionId, cols: 100, rows: 30 });
  const replay = await c2.next((m) => m.type === 'output' && m.sessionId === sessionId);
  assert.ok(Buffer.from(replay.data, 'base64').toString('utf8').includes('replay456'));
  manager.kill(sessionId);
  c1.ws.close();
  c2.ws.close();
});

test('detach 后不再收到该会话输出', async () => {
  const c = await authedClient(port, 'test-token');
  c.send({ type: 'create', cwd: os.tmpdir() });
  const { sessionId } = await c.next((m) => m.type === 'created');
  c.send({ type: 'attach', sessionId, cols: 100, rows: 30 });
  await c.next((m) => m.type === 'output' && m.sessionId === sessionId);
  c.send({ type: 'detach', sessionId });
  c.send({ type: 'input', sessionId, data: Buffer.from('Write-Output after789\r').toString('base64') });
  await assert.rejects(
    c.next((m) => m.type === 'output' && m.sessionId === sessionId, 3000),
    /超时/
  );
  manager.kill(sessionId);
  c.ws.close();
});

test('kill 后广播 session_exited 事件', async () => {
  const c = await authedClient(port, 'test-token');
  c.send({ type: 'create', cwd: os.tmpdir() });
  const { sessionId } = await c.next((m) => m.type === 'created');
  c.send({ type: 'kill', sessionId });
  await c.next((m) => m.type === 'event' && m.sessionId === sessionId && m.kind === 'session_exited');
  c.ws.close();
});

test('attach 不存在的会话返回 error', async () => {
  const c = await authedClient(port, 'test-token');
  c.send({ type: 'attach', sessionId: 'nope', cols: 80, rows: 24 });
  const err = await c.next((m) => m.type === 'error');
  assert.match(err.message, /不存在/);
  c.ws.close();
});
```

- [ ] **Step 2: 跑测试确认新用例失败**

Run: `node --test test/server.test.js`
Expected: 原 4 个 PASS；新增用例 FAIL（收到"未知消息类型"错误）

- [ ] **Step 3: 在 server.js 的 switch 中、`default` 之前补全分支**

```js
        case 'attach': {
          if (!session) return send(ws, { type: 'error', message: '会话不存在' });
          if (msg.cols && msg.rows) session.resize(msg.cols, msg.rows);
          send(ws, {
            type: 'output',
            sessionId: session.id,
            data: session.buffer.snapshot().toString('base64'),
          });
          const handler = (buf) =>
            send(ws, { type: 'output', sessionId: session.id, data: buf.toString('base64') });
          session.on('data', handler);
          attached.set(session.id, handler);
          break;
        }
        case 'input':
          if (session) session.write(Buffer.from(msg.data, 'base64').toString('utf8'));
          break;
        case 'resize':
          if (session) session.resize(msg.cols, msg.rows);
          break;
        case 'detach': {
          const handler = attached.get(msg.sessionId);
          if (handler && session) session.off('data', handler);
          attached.delete(msg.sessionId);
          break;
        }
        case 'kill':
          manager.kill(msg.sessionId);
          broadcastSessions();
          break;
```

- [ ] **Step 4: 跑测试确认全部通过**

Run: `node --test test/server.test.js`
Expected: 9 个测试 PASS

- [ ] **Step 5: Commit**

```powershell
git add host/src/server.js host/test/server.test.js
git commit -m "feat(host): 附身/输入/缩放/离开/终止 协议分支"
```

---

### Task 8: /hook 端点与状态机联动

**Files:**
- Modify: `host/src/server.js`（handleRequest 增加 /hook 路由）
- Test: `host/test/server.test.js`（追加用例）

- [ ] **Step 1: 追加失败测试**

在 `host/test/server.test.js` 末尾追加:
```js
test('hook 上报 stop：状态变 waiting 并广播事件', async () => {
  const c = await authedClient(port, 'test-token');
  c.send({ type: 'create', cwd: os.tmpdir() });
  const { sessionId } = await c.next((m) => m.type === 'created');
  const res = await fetch(`http://127.0.0.1:${port}/hook`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sessionId, kind: 'stop' }),
  });
  assert.strictEqual(res.status, 204);
  await c.next((m) => m.type === 'event' && m.sessionId === sessionId && m.kind === 'stop');
  const list = await c.next(
    (m) =>
      m.type === 'sessions' &&
      m.sessions.some((s) => s.id === sessionId && s.state === 'waiting')
  );
  assert.ok(list);
  manager.kill(sessionId);
  c.ws.close();
});

test('hook 上报 permission_request 原样广播', async () => {
  const c = await authedClient(port, 'test-token');
  c.send({ type: 'create', cwd: os.tmpdir() });
  const { sessionId } = await c.next((m) => m.type === 'created');
  await fetch(`http://127.0.0.1:${port}/hook`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sessionId, kind: 'permission_request' }),
  });
  await c.next(
    (m) => m.type === 'event' && m.sessionId === sessionId && m.kind === 'permission_request'
  );
  manager.kill(sessionId);
  c.ws.close();
});

test('hook 收到非法 JSON 返回 400', async () => {
  const res = await fetch(`http://127.0.0.1:${port}/hook`, { method: 'POST', body: 'not-json' });
  assert.strictEqual(res.status, 400);
});
```

- [ ] **Step 2: 跑测试确认新用例失败**

Run: `node --test test/server.test.js`
Expected: 新增 3 个用例 FAIL（/hook 现在走静态文件处理返回 404）

- [ ] **Step 3: 实现 /hook**

在 `server.js` 中把 `handleRequest` 替换为：
```js
  function handleRequest(req, res) {
    if (req.method === 'POST' && req.url === '/hook') return handleHook(req, res);
    serveStatic(req, res);
  }

  function handleHook(req, res) {
    const remote = req.socket.remoteAddress;
    if (remote !== '127.0.0.1' && remote !== '::1' && remote !== '::ffff:127.0.0.1') {
      res.writeHead(403);
      return res.end();
    }
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      try {
        const { sessionId, kind } = JSON.parse(body);
        const session = manager.get(sessionId);
        if (session) {
          if (kind === 'stop') session.setState('waiting');
          broadcastEvent(sessionId, kind);
          broadcastSessions();
        }
        res.writeHead(204);
        res.end();
      } catch {
        res.writeHead(400);
        res.end();
      }
    });
  }
```

说明：`/hook` 只接受 loopback 来源（hook 与宿主同机），所以不需要 token；Tailscale 来源一律 403。`stop` 之外的 kind（如 `permission_request`）只广播不改状态——会话是否在等输入由 `stop` 事件与后续 `input`（见 `Session.write` 置回 `working`）共同决定。

- [ ] **Step 4: 跑测试确认全部通过**

Run: `node --test test/`
Expected: 全部测试 PASS（ring-buffer 3 + config 2 + session 5 + manager 3 + server 12）

- [ ] **Step 5: Commit**

```powershell
git add host/src/server.js host/test/server.test.js
git commit -m "feat(host): /hook 端点（仅 loopback），stop 事件驱动状态机"
```

---

### Task 9: 绑定地址检测 + 服务入口 index.js

**Files:**
- Create: `host/src/net.js`
- Create: `host/src/index.js`
- Test: `host/test/net.test.js`

- [ ] **Step 1: 写失败测试**

`host/test/net.test.js`:
```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { getBindAddresses, isTailscaleIPv4 } = require('../src/net');

test('识别 Tailscale CGNAT 地址（100.64.0.0/10）', () => {
  assert.ok(isTailscaleIPv4('100.64.0.1'));
  assert.ok(isTailscaleIPv4('100.101.102.103'));
  assert.ok(isTailscaleIPv4('100.127.255.254'));
  assert.ok(!isTailscaleIPv4('100.63.0.1'));
  assert.ok(!isTailscaleIPv4('100.128.0.1'));
  assert.ok(!isTailscaleIPv4('192.168.1.2'));
});

test('从接口列表提取绑定地址：loopback 永远在，Tailscale 有则加', () => {
  const fake = {
    Loopback: [{ family: 'IPv4', address: '127.0.0.1' }],
    Ethernet: [{ family: 'IPv4', address: '192.168.1.5' }],
    Tailscale: [
      { family: 'IPv4', address: '100.80.1.2' },
      { family: 'IPv6', address: 'fd7a::1' },
    ],
  };
  assert.deepStrictEqual(getBindAddresses(fake), ['127.0.0.1', '100.80.1.2']);
});

test('没有 Tailscale 接口时只绑 loopback', () => {
  const fake = { Ethernet: [{ family: 'IPv4', address: '192.168.1.5' }] };
  assert.deepStrictEqual(getBindAddresses(fake), ['127.0.0.1']);
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test test/net.test.js`
Expected: FAIL，`Cannot find module '../src/net'`

- [ ] **Step 3: 实现 net.js**

`host/src/net.js`:
```js
'use strict';
const os = require('os');

function isTailscaleIPv4(address) {
  const parts = address.split('.').map(Number);
  return parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127;
}

function getBindAddresses(interfaces = os.networkInterfaces()) {
  const addrs = ['127.0.0.1'];
  for (const list of Object.values(interfaces)) {
    for (const iface of list || []) {
      if (iface.family === 'IPv4' && isTailscaleIPv4(iface.address)) {
        addrs.push(iface.address);
      }
    }
  }
  return addrs;
}

module.exports = { getBindAddresses, isTailscaleIPv4 };
```

- [ ] **Step 4: 跑测试确认通过**

Run: `node --test test/net.test.js`
Expected: 3 个测试 PASS

- [ ] **Step 5: 写入口 index.js**

`host/src/index.js`:
```js
'use strict';
const path = require('path');
const { loadConfig } = require('./config');
const { SessionManager } = require('./session-manager');
const { createApp } = require('./server');
const { getBindAddresses } = require('./net');

const DATA_DIR = path.join(__dirname, '..', 'data');

async function main() {
  const config = loadConfig(DATA_DIR);
  const manager = new SessionManager({
    dataDir: DATA_DIR,
    command: config.claudeCommand,
    args: config.claudeArgs,
    bufferLimit: config.bufferLimit,
  });
  if (manager.tombstones.length > 0) {
    console.log(`注意：上次宿主退出时有 ${manager.tombstones.length} 个会话中断：`);
    for (const t of manager.tombstones) {
      console.log(`  - ${t.name} (${t.cwd})，可在该目录用 claude --resume 恢复上下文`);
    }
  }
  const app = createApp({ manager, config });
  const addrs = getBindAddresses();
  for (const addr of addrs) {
    await app.listen(addr, config.port);
    console.log(`listening on http://${addr}:${config.port}`);
  }
  if (addrs.length === 1) {
    console.log('提示：未检测到 Tailscale 网卡，目前只能本机访问。');
  }
  console.log(`token: ${config.token}`);
}

main();
```

- [ ] **Step 6: 手动验证入口可启动**

Run（在 `host` 目录）: `npm start`
Expected: 打印 `listening on http://127.0.0.1:8787`（装了 Tailscale 还会多一行 100.x 地址）和 token。Ctrl+C 退出。

- [ ] **Step 7: Commit**

```powershell
git add host/src/net.js host/src/index.js host/test/net.test.js
git commit -m "feat(host): 绑定地址检测（loopback+Tailscale）与服务入口"
```

---

### Task 10: 网页客户端（里程碑 M1）

**Files:**
- Create: `host/public/index.html`
- Create: `host/public/app.js`

- [ ] **Step 1: 写 index.html**

`host/public/index.html`:
```html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1">
<title>Claude Remote</title>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@xterm/xterm@5.5.0/css/xterm.min.css">
<style>
  body { margin: 0; background: #1e1e1e; color: #ddd; font-family: sans-serif; }
  #list-view { padding: 12px; }
  #new-session { background: #3a6ea5; color: #fff; border: 0; border-radius: 6px; padding: 10px 16px; margin-bottom: 8px; }
  .session { padding: 12px; margin: 6px 0; background: #2d2d2d; border-radius: 6px; cursor: pointer; display: flex; justify-content: space-between; }
  .state-working { color: #6ec1ff; }
  .state-waiting { color: #ffd866; }
  .state-exited { color: #888; }
  #term-view { display: none; height: 100vh; flex-direction: column; }
  #term { flex: 1; min-height: 0; }
  #bar { display: flex; gap: 6px; padding: 6px; background: #2d2d2d; flex-wrap: wrap; }
  #bar button { background: #444; color: #eee; border: 0; border-radius: 4px; padding: 8px 14px; }
</style>
</head>
<body>
<div id="list-view">
  <button id="new-session">新建会话</button>
  <div id="sessions"></div>
</div>
<div id="term-view">
  <div id="term"></div>
  <div id="bar">
    <button data-key="back">← 列表</button>
    <button data-key="enter">回车</button>
    <button data-key="esc">ESC</button>
    <button data-key="up">↑</button>
    <button data-key="down">↓</button>
    <button data-key="1">1</button>
    <button data-key="2">2</button>
    <button data-key="3">3</button>
  </div>
</div>
<script src="https://cdn.jsdelivr.net/npm/@xterm/xterm@5.5.0/lib/xterm.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/@xterm/addon-fit@0.10.0/lib/addon-fit.min.js"></script>
<script src="app.js"></script>
</body>
</html>
```

- [ ] **Step 2: 写 app.js**

`host/public/app.js`:
```js
'use strict';

const KEYMAP = { enter: '\r', esc: '\x1b', up: '\x1b[A', down: '\x1b[B', 1: '1', 2: '2', 3: '3' };

let token = localStorage.getItem('token');
if (!token) {
  token = prompt('输入宿主 token（host/data/config.json 里的 token 字段）');
  localStorage.setItem('token', token);
}

const term = new Terminal({ fontSize: 14, scrollback: 5000 });
const fit = new FitAddon.FitAddon();
term.loadAddon(fit);
term.open(document.getElementById('term'));

let ws;
let current = null;

function b64encode(str) {
  return btoa(String.fromCharCode(...new TextEncoder().encode(str)));
}
function b64decode(b64) {
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}
function send(msg) {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}

function connect() {
  ws = new WebSocket(`ws://${location.host}`);
  ws.onopen = () => send({ type: 'auth', token });
  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    if (msg.type === 'auth_ok') {
      send({ type: 'list' });
      if (current) send({ type: 'attach', sessionId: current, cols: term.cols, rows: term.rows });
    }
    if (msg.type === 'sessions') renderSessions(msg.sessions);
    if (msg.type === 'created') attach(msg.sessionId);
    if (msg.type === 'output' && msg.sessionId === current) term.write(b64decode(msg.data));
    if (msg.type === 'error') {
      console.error(msg.message);
      if (msg.message.includes('鉴权')) {
        localStorage.removeItem('token');
        alert('token 错误，请刷新重输');
      }
    }
  };
  ws.onclose = () => setTimeout(connect, 1000);
}

function renderSessions(sessions) {
  const el = document.getElementById('sessions');
  el.innerHTML = '';
  for (const s of sessions) {
    const div = document.createElement('div');
    div.className = 'session';
    const stateText = { working: '干活中', waiting: '等输入', exited: '已结束' }[s.state] || s.state;
    div.innerHTML = `<span>${s.name}</span><span class="state-${s.state}">${stateText}${s.orphaned ? '（中断）' : ''}</span>`;
    div.onclick = () => (s.state === 'exited' && s.orphaned ? null : attach(s.id));
    el.appendChild(div);
  }
}

function attach(id) {
  current = id;
  document.getElementById('list-view').style.display = 'none';
  document.getElementById('term-view').style.display = 'flex';
  term.reset();
  fit.fit();
  send({ type: 'attach', sessionId: id, cols: term.cols, rows: term.rows });
  term.focus();
}

function backToList() {
  if (current) send({ type: 'detach', sessionId: current });
  current = null;
  document.getElementById('term-view').style.display = 'none';
  document.getElementById('list-view').style.display = 'block';
  send({ type: 'list' });
}

term.onData((d) => {
  if (current) send({ type: 'input', sessionId: current, data: b64encode(d) });
});

window.addEventListener('resize', () => {
  if (!current) return;
  fit.fit();
  send({ type: 'resize', sessionId: current, cols: term.cols, rows: term.rows });
});

document.getElementById('new-session').onclick = () => {
  const cwd = prompt('在哪个目录启动 claude？', 'C:\\Users\\galaxy\\code');
  if (cwd) send({ type: 'create', cwd });
};

for (const btn of document.querySelectorAll('#bar button')) {
  btn.onclick = () => {
    const k = btn.dataset.key;
    if (k === 'back') return backToList();
    if (current) send({ type: 'input', sessionId: current, data: b64encode(KEYMAP[k]) });
  };
}

connect();
```

- [ ] **Step 3: 手动验证里程碑 M1（电脑浏览器完整操作 claude 会话）**

1. `host` 目录运行 `npm start`
2. 浏览器打开 `http://127.0.0.1:8787`，输入 `host/data/config.json` 里的 token
3. 点"新建会话"，目录填一个真实项目目录
4. Expected: 终端视图出现 Claude Code 启动画面；能打字、回车发消息、用快捷按钮选选项
5. 若 claude 启动失败（窗口闪退）：把 `host/data/config.json` 的 `claudeCommand` 改为 `(Get-Command claude).Source` 输出的完整路径，重启宿主再试
6. 关掉浏览器标签页重开、重新附身：Expected 缓冲回放，能看到之前的画面

- [ ] **Step 4: Commit**

```powershell
git add host/public/index.html host/public/app.js
git commit -m "feat(host): 网页客户端（M1：浏览器完整操作 claude 会话）"
```

---

### Task 11: cc 命令与终端附身客户端（里程碑 M2）

**Files:**
- Create: `host/bin/attach-client.js`
- Create: `host/bin/cc.ps1`

- [ ] **Step 1: 写 attach-client.js**

`host/bin/attach-client.js`:
```js
'use strict';
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');

const config = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'data', 'config.json'), 'utf8')
);
const args = process.argv.slice(2);
function arg(name) {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

let sessionId = arg('--attach');
const ws = new WebSocket(`ws://127.0.0.1:${config.port}`);

function send(msg) {
  ws.send(JSON.stringify(msg));
}

function quit(code, msg) {
  if (msg) process.stdout.write(msg);
  try {
    process.stdin.setRawMode(false);
  } catch {}
  process.exit(code);
}

ws.on('open', () => send({ type: 'auth', token: config.token }));
ws.on('error', (e) => quit(1, `\n[无法连接宿主：${e.message}。宿主跑起来了吗？]\n`));
ws.on('close', () => quit(1, '\n[连接已断开]\n'));
ws.on('message', (raw) => {
  const msg = JSON.parse(raw.toString());
  if (msg.type === 'auth_ok') {
    if (sessionId) doAttach();
    else send({ type: 'create', cwd: arg('--cwd') || process.cwd(), name: arg('--name') });
  }
  if (msg.type === 'created') {
    sessionId = msg.sessionId;
    doAttach();
  }
  if (msg.type === 'output' && msg.sessionId === sessionId) {
    process.stdout.write(Buffer.from(msg.data, 'base64'));
  }
  if (msg.type === 'event' && msg.sessionId === sessionId && msg.kind === 'session_exited') {
    quit(0, '\n[会话已结束]\n');
  }
  if (msg.type === 'error') {
    quit(1, `\n[错误：${msg.message}]\n`);
  }
});

function doAttach() {
  send({ type: 'attach', sessionId, cols: process.stdout.columns, rows: process.stdout.rows });
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.on('data', (buf) => {
    if (buf.length === 1 && buf[0] === 0x11) {
      // Ctrl+Q
      return quit(0, '\n[已离开会话，会话仍在后台运行；cc -Attach 可回来]\n');
    }
    send({ type: 'input', sessionId, data: buf.toString('base64') });
  });
  process.stdout.on('resize', () =>
    send({ type: 'resize', sessionId, cols: process.stdout.columns, rows: process.stdout.rows })
  );
}
```

- [ ] **Step 2: 写 cc.ps1**

`host/bin/cc.ps1`:
```powershell
# cc —— 通过会话宿主启动/附身 Claude Code 会话
# 用法：cc            在当前目录新建会话
#       cc -Name foo  新建并命名
#       cc -Attach <sessionId 前几位>  附身已有会话
param(
  [string]$Name = "",
  [string]$Attach = ""
)
$here = Split-Path -Parent $MyInvocation.MyCommand.Path

if ($Attach) {
  node "$here\attach-client.js" --attach $Attach
} else {
  $argv = @("$here\attach-client.js", "--create", "--cwd", (Get-Location).Path)
  if ($Name) { $argv += @("--name", $Name) }
  node @argv
}
```

- [ ] **Step 3: 手动验证里程碑 M2**

1. 宿主保持运行（`npm start`）
2. 新开一个 PowerShell 窗口，cd 到任一项目目录，运行 `C:\Users\galaxy\code\claude_tip\host\bin\cc.ps1`
3. Expected: 当前终端里出现 Claude Code 画面，可正常对话
4. 按 Ctrl+Q：Expected 打印"已离开会话"，但浏览器里该会话还在、画面还在更新
5. 把 `host\bin` 加进 PATH（或在 PowerShell `$PROFILE` 里加 `Set-Alias cc C:\Users\galaxy\code\claude_tip\host\bin\cc.ps1`），之后任何目录敲 `cc` 即可

- [ ] **Step 4: Commit**

```powershell
git add host/bin/attach-client.js host/bin/cc.ps1
git commit -m "feat(host): cc 命令与终端附身客户端（M2）"
```

---

### Task 12: Claude Code Hook 接入（里程碑 M3）

**Files:**
- Modify: `C:\Users\galaxy\.claude\settings.json`（用户全局配置，不在仓库内）

- [ ] **Step 1: 合并 hooks 配置**

读取现有 `~/.claude/settings.json`（里面已有一个弹 Windows 通知的 Stop hook，保留它），在 `hooks.Stop` 数组追加一个组、并新增 `hooks.Notification`：

在 `"Stop"` 数组中追加：
```json
{
  "hooks": [
    {
      "type": "command",
      "shell": "powershell",
      "command": "if ($env:CC_HOST_SESSION_ID) { try { Invoke-RestMethod -Uri 'http://127.0.0.1:8787/hook' -Method Post -ContentType 'application/json' -Body ('{\"sessionId\":\"' + $env:CC_HOST_SESSION_ID + '\",\"kind\":\"stop\"}') -TimeoutSec 3 | Out-Null } catch {} }",
      "timeout": 10,
      "async": true
    }
  ]
}
```

新增 `"Notification"` 键（与 `"Stop"` 平级）：
```json
"Notification": [
  {
    "hooks": [
      {
        "type": "command",
        "shell": "powershell",
        "command": "if ($env:CC_HOST_SESSION_ID) { try { Invoke-RestMethod -Uri 'http://127.0.0.1:8787/hook' -Method Post -ContentType 'application/json' -Body ('{\"sessionId\":\"' + $env:CC_HOST_SESSION_ID + '\",\"kind\":\"permission_request\"}') -TimeoutSec 3 | Out-Null } catch {} }",
        "timeout": 10,
        "async": true
      }
    ]
  }
]
```

要点：`if ($env:CC_HOST_SESSION_ID)` 保证只有宿主托管的会话才上报，普通终端里直接跑的 claude 不受影响。端口 8787 必须与 `host/data/config.json` 的 `port` 一致。

- [ ] **Step 2: 管道测试 hook 命令**

Run:
```powershell
$env:CC_HOST_SESSION_ID = 'pipe-test'; Invoke-RestMethod -Uri 'http://127.0.0.1:8787/hook' -Method Post -ContentType 'application/json' -Body '{"sessionId":"pipe-test","kind":"stop"}' -TimeoutSec 3; $env:CC_HOST_SESSION_ID = $null
```
Expected: 不报错（宿主对未知 sessionId 静默返回 204）

- [ ] **Step 3: 验证 settings.json 仍是合法 JSON**

Run:
```powershell
Get-Content "$env:USERPROFILE\.claude\settings.json" -Raw -Encoding UTF8 | ConvertFrom-Json | Out-Null; if ($?) { 'JSON valid' }
```
Expected: `JSON valid`

- [ ] **Step 4: 手动验证里程碑 M3（端到端）**

1. 宿主运行中；浏览器开着 `http://127.0.0.1:8787` 的会话列表页
2. 用 `cc` 新建一个会话，发给 Claude 一个小任务（比如"列出当前目录文件"）
3. Expected: 会话在列表里先显示"干活中"，Claude 答完停下后几秒内变成"等输入"
4. 手机连上 Tailscale，浏览器打开 `http://<电脑的100.x地址>:8787`，输入 token
5. Expected: 手机上看到同样的列表和终端画面，可以继续对话——**至此手机已经可用（浏览器版）**

- [ ] **Step 5: Commit（记录配置说明而非用户文件本身）**

无仓库文件变更则跳过 commit；若 README（Task 13）尚未建，把 hooks 配置说明留给 Task 13 记录。

---

### Task 13: 开机自启 + README

**Files:**
- Create: `host/start-host.ps1`
- Create: `host/register-autostart.ps1`
- Create: `host/README.md`

- [ ] **Step 1: 写守护循环脚本**

`host/start-host.ps1`:
```powershell
# 守护循环：宿主崩溃后 2 秒自动重启
Set-Location $PSScriptRoot
while ($true) {
  node src\index.js
  Start-Sleep -Seconds 2
}
```

- [ ] **Step 2: 写自启注册脚本**

`host/register-autostart.ps1`:
```powershell
# 注册登录时自动启动（隐藏窗口运行守护循环）
$action = New-ScheduledTaskAction -Execute "powershell.exe" `
  -Argument "-WindowStyle Hidden -ExecutionPolicy Bypass -File `"$PSScriptRoot\start-host.ps1`""
$trigger = New-ScheduledTaskTrigger -AtLogOn
Register-ScheduledTask -TaskName "ClaudeSessionHost" -Action $action -Trigger $trigger `
  -Description "Claude Remote 会话宿主" -Force
Write-Host "已注册开机自启任务 ClaudeSessionHost。立即启动：Start-ScheduledTask -TaskName ClaudeSessionHost"
```

- [ ] **Step 3: 写 README**

`host/README.md`:
```markdown
# Claude Remote 会话宿主

托管 Claude Code 会话，让电脑终端 / 浏览器 / 手机 app 随时附身操作。
设计文档见 `../docs/superpowers/specs/2026-06-12-claude-remote-app-design.md`。

## 启动

    cd host
    npm install
    npm start            # 前台运行
    .\register-autostart.ps1   # 注册开机自启（守护循环，崩溃自动重启）

首次启动会生成 `data/config.json`（端口、token、claude 命令路径，可改）。

## 使用

- 电脑浏览器 / 手机（连 Tailscale）：打开 `http://<IP>:8787`，输入 token
- 终端：`bin\cc.ps1`（建议加 PATH 或别名）在当前目录新建会话；Ctrl+Q 离开（会话不死）
- Hook 接入：见 `~/.claude/settings.json` 的 Stop / Notification hooks，
  只在存在 CC_HOST_SESSION_ID 环境变量（即宿主托管的会话）时上报

## 测试

    npm test

## 安全

- 只监听 127.0.0.1 和 Tailscale 网卡（100.64.0.0/10），绝不监听 0.0.0.0
- /hook 端点只接受 loopback 来源
- WebSocket 需 token 鉴权（data/config.json）
```

- [ ] **Step 4: 验证自启脚本**

Run: `powershell -ExecutionPolicy Bypass -File host\register-autostart.ps1`
Expected: 打印"已注册开机自启任务"。然后 `Start-ScheduledTask -TaskName ClaudeSessionHost`，等 3 秒，浏览器访问 `http://127.0.0.1:8787` 应有响应。
（验证后如不想立即常驻可 `Stop-ScheduledTask -TaskName ClaudeSessionHost`）

- [ ] **Step 5: 跑全量测试收尾**

Run（`host` 目录）: `npm test`
Expected: 全部 PASS

- [ ] **Step 6: Commit**

```powershell
git add host/start-host.ps1 host/register-autostart.ps1 host/README.md
git commit -m "feat(host): 开机自启守护与 README（子项目一完成）"
```

---

## 里程碑对照

| 里程碑 | 完成于 |
|---|---|
| M1 网页客户端完整操作 claude 会话 | Task 10 |
| M2 `cc` 命令可用 | Task 11 |
| M3 Hook 事件推送 + 手机浏览器可用 | Task 12 |

## 已知边界（留给子项目二或后续）

- 多客户端同时输入没有互斥（设计如此：谁都能打字，像 tmux）
- 宿主崩溃会话即死，靠守护循环重启 + 孤儿提示 + `claude --resume` 兜底
- 通知目前只到浏览器事件层面；手机系统级推送通知属于子项目二（安卓 app 前台服务）
