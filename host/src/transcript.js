'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');

/**
 * 从 Claude Code 的对话记录（JSONL，每行一个事件）里提取最后一条 assistant 的纯文本。
 * 用于通知预览——读结构化记录，不抠终端画面。失败/无内容返回 ''。
 *
 * @param {string} filePath transcript_path
 * @param {number} maxLen 预览最大字符数
 */
function lastAssistantText(filePath, maxLen = 200) {
  let raw;
  try {
    raw = fs.readFileSync(filePath, 'utf8');
  } catch {
    return '';
  }
  const lines = raw.split('\n').filter((l) => l.trim());
  // 从后往前找最后一条 assistant 消息
  for (let i = lines.length - 1; i >= 0; i--) {
    let obj;
    try {
      obj = JSON.parse(lines[i]);
    } catch {
      continue;
    }
    if (obj.type !== 'assistant') continue;
    const content = obj.message && obj.message.content;
    if (!Array.isArray(content)) continue;
    const text = content
      .filter((b) => b && b.type === 'text' && typeof b.text === 'string')
      .map((b) => b.text)
      .join('\n')
      .trim();
    if (text) return collapse(text, maxLen);
  }
  return '';
}

/** 折叠空白、截断到 maxLen，加省略号。 */
function collapse(text, maxLen) {
  const s = text.replace(/\s+/g, ' ').trim();
  return s.length > maxLen ? s.slice(0, maxLen - 1) + '…' : s;
}

/**
 * 根据会话 cwd 找该项目最新的 transcript（.jsonl）。Claude Code 把对话记录存在
 * ~/.claude/projects/<把 cwd 的非字母数字字符都换成 - 的目录名>/<会话uuid>.jsonl。
 * 一个会话停下时它的记录就是该目录里最新的那个。找不到返回 ''。
 *
 * @param {string} cwd 会话工作目录
 * @param {string} baseDir projects 根目录（默认 ~/.claude/projects），便于测试注入
 */
function findLatestTranscript(cwd, baseDir = path.join(os.homedir(), '.claude', 'projects')) {
  if (!cwd) return '';
  const dir = path.join(baseDir, cwd.replace(/[^a-zA-Z0-9]/g, '-'));
  let files;
  try {
    files = fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl'));
  } catch {
    return '';
  }
  let newest = '';
  let mtime = -1;
  for (const f of files) {
    const full = path.join(dir, f);
    try {
      const m = fs.statSync(full).mtimeMs;
      if (m > mtime) { mtime = m; newest = full; }
    } catch {
      // 忽略读不到的文件
    }
  }
  return newest;
}

module.exports = { lastAssistantText, findLatestTranscript };
