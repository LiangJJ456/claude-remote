'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { lastAssistantText } = require('../src/transcript');

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

test('坏行被跳过不崩', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-tr-'));
  const f = path.join(dir, 't.jsonl');
  fs.writeFileSync(f, 'not json\n' + JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'ok' }] } }) + '\n');
  assert.strictEqual(lastAssistantText(f), 'ok');
});
