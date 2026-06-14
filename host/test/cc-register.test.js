'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  ensureMarkedBlock,
  psBody,
  posixBody,
  fishBody,
  resolvePosixRc,
  BEGIN,
  END,
} = require('../src/cc-register');

function tmpFile(name = 'rc') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-reg-'));
  return path.join(dir, name);
}

// —— ensureMarkedBlock：平台无关的幂等写入 ——

test('文件不存在时创建文件并写入标记块', () => {
  const p = tmpFile();
  const r = ensureMarkedBlock({ filePath: p, body: 'BODY-1' });
  assert.strictEqual(r, 'created');
  const txt = fs.readFileSync(p, 'utf8');
  assert.ok(txt.includes(BEGIN) && txt.includes(END) && txt.includes('BODY-1'));
});

test('内容相同时跳过，不重复写', () => {
  const p = tmpFile();
  ensureMarkedBlock({ filePath: p, body: 'BODY-1' });
  const r = ensureMarkedBlock({ filePath: p, body: 'BODY-1' });
  assert.strictEqual(r, 'unchanged');
  const txt = fs.readFileSync(p, 'utf8');
  assert.strictEqual(txt.split(BEGIN).length - 1, 1, '标记块只应出现一次');
});

test('内容变了时替换块，仍只有一个块', () => {
  const p = tmpFile();
  ensureMarkedBlock({ filePath: p, body: 'OLD' });
  const r = ensureMarkedBlock({ filePath: p, body: 'NEW' });
  assert.strictEqual(r, 'updated');
  const txt = fs.readFileSync(p, 'utf8');
  assert.strictEqual(txt.split(BEGIN).length - 1, 1);
  assert.ok(txt.includes('NEW') && !txt.includes('OLD'));
});

test('保留文件里已有的其它内容', () => {
  const p = tmpFile();
  fs.writeFileSync(p, '# 我的现有配置\nalias g=git\n');
  ensureMarkedBlock({ filePath: p, body: 'BODY-1' });
  const txt = fs.readFileSync(p, 'utf8');
  assert.ok(txt.includes('alias g=git'), '不应动用户原有内容');
  assert.ok(txt.includes(BEGIN));
});

test('缺目录时自动建目录（如 fish 的 ~/.config/fish/）', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-reg-'));
  const p = path.join(dir, '.config', 'fish', 'config.fish');
  const r = ensureMarkedBlock({ filePath: p, body: 'BODY-1' });
  assert.strictEqual(r, 'created');
  assert.ok(fs.existsSync(p));
});

// —— 各 shell 的函数体 ——

test('psBody/posixBody/fishBody 生成各自语法且含脚本路径', () => {
  assert.strictEqual(psBody('C:\\h\\cc.ps1'), 'function cc { & "C:\\h\\cc.ps1" @args }');
  assert.strictEqual(posixBody('/h/cc.sh'), 'cc() { sh "/h/cc.sh" "$@"; }');
  assert.strictEqual(fishBody('/h/cc.sh'), 'function cc; sh "/h/cc.sh" $argv; end');
});

// —— resolvePosixRc：按 $SHELL 选 rc 文件与语法 ——

// 注：resolvePosixRc 用 path.join，本机跑测试是 Windows 会出反斜杠，故期望值也用 path.join 拼。
test('zsh → ~/.zshrc (posix)', () => {
  const r = resolvePosixRc({ platform: 'linux', shell: '/usr/bin/zsh', home: '/home/u' });
  assert.deepStrictEqual(r, { file: path.join('/home/u', '.zshrc'), kind: 'posix' });
});

test('bash 在 linux → ~/.bashrc，在 mac → ~/.bash_profile', () => {
  assert.strictEqual(resolvePosixRc({ platform: 'linux', shell: '/bin/bash', home: '/home/u' }).file, path.join('/home/u', '.bashrc'));
  assert.strictEqual(resolvePosixRc({ platform: 'darwin', shell: '/bin/bash', home: '/Users/u' }).file, path.join('/Users/u', '.bash_profile'));
});

test('fish → ~/.config/fish/config.fish (fish)', () => {
  const r = resolvePosixRc({ platform: 'linux', shell: '/usr/bin/fish', home: '/home/u' });
  assert.strictEqual(r.kind, 'fish');
  assert.ok(r.file.endsWith(path.join('.config', 'fish', 'config.fish')));
});

test('未知/空 shell → ~/.profile (posix) 兜底', () => {
  const r = resolvePosixRc({ platform: 'linux', shell: '', home: '/home/u' });
  assert.deepStrictEqual(r, { file: path.join('/home/u', '.profile'), kind: 'posix' });
});
