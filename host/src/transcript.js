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

const DEFAULT_BASE = path.join(os.homedir(), '.claude', 'projects');

/** cwd → Claude 项目目录（非字母数字字符都换成 -）。 */
function projectDir(cwd, baseDir = DEFAULT_BASE) {
  return path.join(baseDir, cwd.replace(/[^a-zA-Z0-9]/g, '-'));
}

/** 列出某 cwd 项目目录下所有 transcript 全路径。 */
function listTranscripts(cwd, baseDir = DEFAULT_BASE) {
  if (!cwd) return [];
  try {
    return fs.readdirSync(projectDir(cwd, baseDir))
      .filter((f) => f.endsWith('.jsonl'))
      .map((f) => path.join(projectDir(cwd, baseDir), f));
  } catch {
    return [];
  }
}

function newestOf(paths) {
  let newest = '';
  let mtime = -1;
  for (const p of paths) {
    try {
      const m = fs.statSync(p).mtimeMs;
      if (m > mtime) { mtime = m; newest = p; }
    } catch {
      // 忽略读不到的
    }
  }
  return newest;
}

/**
 * 找“这个会话自己的” transcript：相对会话创建时的基线（baseline），新出现的那个就是它的。
 * 这样同一目录下有多个会话时也不会选错。没有新文件则退回该目录最新的。
 *
 * @param {string} cwd 会话工作目录
 * @param {Set<string>} baseline 会话创建时已存在的 transcript 路径集合
 */
function findSessionTranscript(cwd, baseline, baseDir = DEFAULT_BASE) {
  const all = listTranscripts(cwd, baseDir);
  const fresh = baseline ? all.filter((p) => !baseline.has(p)) : all;
  return newestOf(fresh.length ? fresh : all);
}

/** 退路：某 cwd 项目目录里最新的 transcript（不区分会话）。 */
function findLatestTranscript(cwd, baseDir = DEFAULT_BASE) {
  return newestOf(listTranscripts(cwd, baseDir));
}

module.exports = { lastAssistantText, listTranscripts, findSessionTranscript, findLatestTranscript };
