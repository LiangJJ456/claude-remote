'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

// 在用户的 shell 启动文件里登记一个 `cc` 命令，转发到 host/bin 下对应的 cc 脚本。
// 这样开机自启的宿主一起来，以后任意“新开”的终端敲 `cc` 就能在当前目录起一个
// 宿主托管的 claude 会话（手机即可接管/共看）。只动下面这对标记包起来的块，
// 不碰文件里的其它内容；想撤就删这三行。`#` 在 PowerShell / sh / fish 里都是注释。
const BEGIN = '# >>> claude-remote cc (auto) >>>';
const END = '# <<< claude-remote cc (auto) <<<';

/**
 * 确保 filePath 里有这对标记包着的 body（幂等）。纯文件逻辑，便于单测：
 * 不存在则建并写，已存在但内容变了则替换块，已是最新则跳过。
 *
 * @returns {'created'|'updated'|'unchanged'} 实际做了什么
 */
function ensureMarkedBlock({ filePath, body }) {
  const desired = `${BEGIN}\n${body}\n${END}`;
  let content = '';
  let exists = false;
  try {
    content = fs.readFileSync(filePath, 'utf8');
    exists = true;
  } catch {
    // 文件不存在：当作空内容，下面会连目录一起建
  }

  const re = new RegExp(escapeRe(BEGIN) + '[\\s\\S]*?' + escapeRe(END));
  if (re.test(content)) {
    const next = content.replace(re, desired);
    if (next === content) return 'unchanged';
    fs.writeFileSync(filePath, next);
    return 'updated';
  }

  const sep = content === '' ? '' : content.endsWith('\n') ? '\n' : '\n\n';
  if (!exists) fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content + sep + desired + '\n');
  return 'created';
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// —— 各 shell 的 cc 函数体 ——
// PowerShell：转发到 cc.ps1，原样透传参数。
function psBody(scriptPath) {
  return `function cc { & "${scriptPath}" @args }`;
}
// bash/zsh/sh：经 sh 跑 cc.sh（不依赖脚本的可执行位）。
function posixBody(scriptPath) {
  return `cc() { sh "${scriptPath}" "$@"; }`;
}
// fish：语法不同，单列。
function fishBody(scriptPath) {
  return `function cc; sh "${scriptPath}" $argv; end`;
}

/** 问 PowerShell 要当前用户 profile 的真实路径（能正确处理 Documents 被重定向的情况）。 */
function resolvePsProfilePath() {
  const out = execFileSync(
    'powershell',
    ['-NoProfile', '-Command', '$PROFILE.CurrentUserCurrentHost'],
    { encoding: 'utf8' }
  );
  return out.trim();
}

/**
 * 按 $SHELL 决定 POSIX 平台上 cc 该写进哪个 rc 文件，以及用哪种语法。
 * 可注入 platform/shell/home 便于单测。
 *
 * @returns {{ file: string, kind: 'posix'|'fish' }}
 */
function resolvePosixRc({ platform = process.platform, shell = process.env.SHELL || '', home = os.homedir() } = {}) {
  const name = path.basename(shell);
  if (name === 'fish') return { file: path.join(home, '.config', 'fish', 'config.fish'), kind: 'fish' };
  if (name === 'zsh') return { file: path.join(home, '.zshrc'), kind: 'posix' };
  if (name === 'bash') {
    // mac 的终端默认开 login shell（读 .bash_profile），Linux 交互非 login 读 .bashrc
    return { file: path.join(home, platform === 'darwin' ? '.bash_profile' : '.bashrc'), kind: 'posix' };
  }
  return { file: path.join(home, '.profile'), kind: 'posix' };
}

/**
 * 启动时调用：best-effort 注册 cc，结果打到日志。任何失败只 warn，绝不抛——
 * 启动文件解析/写入失败不该拖垮宿主。
 *
 * @param {string} winScript   Windows 下 cc.ps1 的绝对路径
 * @param {string} posixScript Mac/Linux 下 cc.sh 的绝对路径
 */
function registerCcOnStartup({ winScript, posixScript, log = console } = {}) {
  try {
    let filePath;
    let body;
    if (process.platform === 'win32') {
      filePath = resolvePsProfilePath();
      if (!filePath) {
        log.warn('[cc] 无法解析 PowerShell profile 路径，跳过 cc 自动注册');
        return;
      }
      body = psBody(winScript);
    } else {
      const rc = resolvePosixRc();
      filePath = rc.file;
      body = rc.kind === 'fish' ? fishBody(posixScript) : posixBody(posixScript);
    }

    const result = ensureMarkedBlock({ filePath, body });
    if (result === 'unchanged') {
      log.log('[cc] 已注册（新开终端即可使用 cc）');
    } else {
      const verb = result === 'created' ? '已写入' : '已更新';
      log.log(`[cc] ${verb} ${filePath} —— 新开一个终端后敲 cc 即可起会话`);
    }
  } catch (err) {
    log.warn(`[cc] 自动注册失败（不影响宿主）：${err.message}`);
  }
}

module.exports = {
  ensureMarkedBlock,
  psBody,
  posixBody,
  fishBody,
  resolvePsProfilePath,
  resolvePosixRc,
  registerCcOnStartup,
  BEGIN,
  END,
};
