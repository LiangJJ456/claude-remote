'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { lastAssistantText, findLatestTranscript, findSessionTranscript, transcriptForClaudeSession, listTranscripts } = require('../src/transcript');

function tmpJsonl(lines) {
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'cc-tr-')), 'transcript.jsonl');
  fs.writeFileSync(f, lines.map((o) => JSON.stringify(o)).join('\n') + '\n');
  return f;
}

test('取最后一条 assistant 的文本', () => {
  const f = tmpJsonl([
    { type: 'user', message: { content: [{ type: 'text', text: '你好' }] } },
    { type: 'assistant', message: { content: [{ type: 'text', text: '第一次回复' }] } },
    { type: 'user', message: { content: [{ type: 'text', text: '讲笑话' }] } },
    { type: 'assistant', message: { content: [{ type: 'text', text: '这是最后的回复' }] } },
  ]);
  assert.strictEqual(lastAssistantText(f), '这是最后的回复');
});

test('跳过 tool_use，只取 text 块', () => {
  const f = tmpJsonl([
    { type: 'assistant', message: { content: [
      { type: 'tool_use', name: 'bash', input: {} },
      { type: 'text', text: '执行完了' },
    ] } },
  ]);
  assert.strictEqual(lastAssistantText(f), '执行完了');
});

test('折叠空白并按 maxLen 截断', () => {
  const long = 'a'.repeat(300)
  const f = tmpJsonl([{ type: 'assistant', message: { content: [{ type: 'text', text: long }] } }])
  const out = lastAssistantText(f, 50)
  assert.strictEqual(out.length, 50)
  assert.ok(out.endsWith('…'))
})

test('多行文本折叠为单行', () => {
  const f = tmpJsonl([{ type: 'assistant', message: { content: [{ type: 'text', text: '行一\n\n行二   行三' }] } }])
  assert.strictEqual(lastAssistantText(f), '行一 行二 行三')
})

test('文件不存在返回空串', () => {
  assert.strictEqual(lastAssistantText('Z:/no/such/file.jsonl'), '');
});

test('无 assistant 消息返回空串', () => {
  const f = tmpJsonl([{ type: 'user', message: { content: [{ type: 'text', text: 'hi' }] } }]);
  assert.strictEqual(lastAssistantText(f), '');
});

test('findLatestTranscript 按 cwd 找最新 jsonl', () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-proj-'));
  const cwd = 'C:\\Users\\me\\code\\proj_x';
  const dir = path.join(base, cwd.replace(/[^a-zA-Z0-9]/g, '-'));
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'old.jsonl'), '{}');
  const newer = path.join(dir, 'new.jsonl');
  fs.writeFileSync(newer, '{}');
  // 确保 new.jsonl 更新（mtime 更大）
  const future = Date.now() / 1000 + 10;
  fs.utimesSync(newer, future, future);
  assert.strictEqual(findLatestTranscript(cwd, base), newer);
});

test('findLatestTranscript 目录不存在返回空', () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-proj-'));
  assert.strictEqual(findLatestTranscript('C:\\no\\such', base), '');
});

test('cwd 净化规则：非字母数字都换成 -', () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-proj-'));
  const cwd = 'C:\\Users\\galaxy\\code\\claude_tip';
  const dir = path.join(base, 'C--Users-galaxy-code-claude-tip');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 's.jsonl'), '{}');
  assert.strictEqual(findLatestTranscript(cwd, base), path.join(dir, 's.jsonl'));
});

test('findSessionTranscript 只取基线之后新出现的那个（同目录多会话不取错）', () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-proj-'));
  const cwd = 'C:\\Users\\me\\code\\multi';
  const dir = path.join(base, cwd.replace(/[^a-zA-Z0-9]/g, '-'));
  fs.mkdirSync(dir, { recursive: true });
  // 会话创建时已有一个别的会话的记录（比如开发会话），且它后来一直在写（mtime 最新）
  const other = path.join(dir, 'other.jsonl');
  fs.writeFileSync(other, '{}');
  const baseline = new Set(listTranscripts(cwd, base));
  // 本会话创建后才出现自己的记录
  const mine = path.join(dir, 'mine.jsonl');
  fs.writeFileSync(mine, '{}');
  // 让 other 的 mtime 比 mine 更新——若按“目录最新”会取错成 other
  const future = Date.now() / 1000 + 10;
  fs.utimesSync(other, future, future);
  assert.strictEqual(findSessionTranscript(cwd, baseline, base), mine);
});

test('findSessionTranscript 没有新文件时退回目录最新', () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-proj-'));
  const cwd = 'C:\\Users\\me\\code\\noNew';
  const dir = path.join(base, cwd.replace(/[^a-zA-Z0-9]/g, '-'));
  fs.mkdirSync(dir, { recursive: true });
  const a = path.join(dir, 'a.jsonl');
  const b = path.join(dir, 'b.jsonl');
  fs.writeFileSync(a, '{}');
  fs.writeFileSync(b, '{}');
  const future = Date.now() / 1000 + 10;
  fs.utimesSync(b, future, future);
  // 基线已包含全部，没有新文件 → 退回最新的 b
  const baseline = new Set([a, b]);
  assert.strictEqual(findSessionTranscript(cwd, baseline, base), b);
});

test('transcriptForClaudeSession 用 session_id 拼出确切文件', () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-proj-'));
  const cwd = 'C:\\Users\\me\\code\\proj';
  const dir = path.join(base, cwd.replace(/[^a-zA-Z0-9]/g, '-'));
  fs.mkdirSync(dir, { recursive: true });
  const sid = '7dec4c2f-2ebf-479e-8c39-5491014775d7';
  const f = path.join(dir, sid + '.jsonl');
  fs.writeFileSync(f, '{}');
  // 同目录还有别的会话文件，不应被选中
  fs.writeFileSync(path.join(dir, 'other.jsonl'), '{}');
  assert.strictEqual(transcriptForClaudeSession(cwd, sid, base), f);
});

test('transcriptForClaudeSession 文件不存在返回空', () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-proj-'));
  assert.strictEqual(transcriptForClaudeSession('C:\\x', 'no-such-id', base), '');
});

test('transcriptForClaudeSession 缺参返回空', () => {
  assert.strictEqual(transcriptForClaudeSession('', 'id'), '');
  assert.strictEqual(transcriptForClaudeSession('C:\\x', ''), '');
});

test('坏行被跳过不崩', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-tr-'));
  const f = path.join(dir, 't.jsonl');
  fs.writeFileSync(f, 'not json\n' + JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'ok' }] } }) + '\n');
  assert.strictEqual(lastAssistantText(f), 'ok');
});
