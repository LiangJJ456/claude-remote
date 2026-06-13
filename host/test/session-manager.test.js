'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { SessionManager } = require('../src/session-manager');
const { waitFor } = require('./helpers');

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
  await waitFor(() => events.includes('exited'));
  assert.ok(events.includes('exited'));
});

test('create 失败（命令不存在）抛错且不污染会话表', () => {
  const dir = tmpDir();
  const m = new SessionManager({ dataDir: dir, command: 'no-such-command-xyz.exe', args: [], bufferLimit: 1024 });
  assert.throws(() => m.create({ cwd: os.tmpdir() }));
  assert.strictEqual(m.list().length, 0);
});
