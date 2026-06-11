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
