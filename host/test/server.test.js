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
