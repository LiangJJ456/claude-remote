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
