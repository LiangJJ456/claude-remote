'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { SessionManager } = require('../src/session-manager');
const { createApp, isLoopback } = require('../src/server');
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

test('create 失败（命令不存在）回 error 且服务不崩', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-host-bad-'));
  const badManager = new SessionManager({
    dataDir,
    command: 'no-such-command-xyz.exe',
    args: [],
    bufferLimit: 1024,
  });
  const badApp = createApp({ manager: badManager, config });
  const badServer = await badApp.listen('127.0.0.1', 0);
  const badPort = badServer.address().port;
  const c = await authedClient(badPort, 'test-token');
  c.send({ type: 'create', cwd: os.tmpdir() });
  const err = await c.next((m) => m.type === 'error');
  assert.match(err.message, /创建会话失败/);
  c.send({ type: 'list' });
  const msg = await c.next((m) => m.type === 'sessions');
  assert.strictEqual(msg.sessions.length, 0);
  c.ws.close();
  badServer.close();
});

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

test('畸形消息不会搞挂服务（input 缺 data、resize 传垃圾）', async () => {
  const c = await authedClient(port, 'test-token');
  c.send({ type: 'create', cwd: os.tmpdir() });
  const { sessionId } = await c.next((m) => m.type === 'created');
  c.send({ type: 'input', sessionId });
  c.send({ type: 'resize', sessionId, cols: 'abc', rows: null });
  c.send({ type: 'list' });
  const msg = await c.next((m) => m.type === 'sessions');
  assert.ok(Array.isArray(msg.sessions));
  manager.kill(sessionId);
  c.ws.close();
});

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

test('isLoopback 判定三种回环形式', () => {
  assert.ok(isLoopback('127.0.0.1'));
  assert.ok(isLoopback('::1'));
  assert.ok(isLoopback('::ffff:127.0.0.1'));
  assert.ok(!isLoopback('100.80.1.2'));
  assert.ok(!isLoopback('192.168.1.5'));
});

test('hook 字段类型不对返回 400', async () => {
  const res = await fetch(`http://127.0.0.1:${port}/hook`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sessionId: 'x', kind: null }),
  });
  assert.strictEqual(res.status, 400);
});

test('isLoopback 拒绝非回环地址（含边界）', () => {
  assert.ok(!isLoopback('100.64.0.1'));      // Tailscale
  assert.ok(!isLoopback('0.0.0.0'));
  assert.ok(!isLoopback('10.0.0.1'));
  assert.ok(!isLoopback(''));
  assert.ok(!isLoopback(undefined));
  assert.ok(!isLoopback('127.0.0.2'));       // 精确匹配，不是整个 127/8
});

test('多客户端并发：c1 的 input 产生的 output 同时到达 c2', async () => {
  const c1 = await authedClient(port, 'test-token');
  c1.send({ type: 'create', cwd: os.tmpdir() });
  const { sessionId } = await c1.next((m) => m.type === 'created');
  c1.send({ type: 'attach', sessionId, cols: 100, rows: 30 });
  const c2 = await authedClient(port, 'test-token');
  c2.send({ type: 'attach', sessionId, cols: 100, rows: 30 });
  // 等两端都 attach 完成（各自先收到一帧快照 output）
  await c1.next((m) => m.type === 'output' && m.sessionId === sessionId);
  await c2.next((m) => m.type === 'output' && m.sessionId === sessionId);
  c1.send({ type: 'input', sessionId, data: Buffer.from('Write-Output dual999\r').toString('base64') });
  async function waitFor999(client) {
    let acc = '';
    while (!acc.includes('dual999')) {
      const m = await client.next((x) => x.type === 'output' && x.sessionId === sessionId);
      acc += Buffer.from(m.data, 'base64').toString('utf8');
    }
  }
  await Promise.all([waitFor999(c1), waitFor999(c2)]);
  manager.kill(sessionId);
  c1.ws.close();
  c2.ws.close();
});
