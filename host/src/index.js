'use strict';
const path = require('path');
const { loadConfig } = require('./config');
const { SessionManager } = require('./session-manager');
const { createApp } = require('./server');
const { getBindAddresses } = require('./net');

const DATA_DIR = path.join(__dirname, '..', 'data');

async function main() {
  const config = loadConfig(DATA_DIR);
  const manager = new SessionManager({
    dataDir: DATA_DIR,
    command: config.claudeCommand,
    args: config.claudeArgs,
    bufferLimit: config.bufferLimit,
  });
  if (manager.tombstones.length > 0) {
    console.log(`注意：上次宿主退出时有 ${manager.tombstones.length} 个会话中断：`);
    for (const t of manager.tombstones) {
      console.log(`  - ${t.name} (${t.cwd})，可在该目录用 claude --resume 恢复上下文`);
    }
  }
  const app = createApp({ manager, config });
  const addrs = getBindAddresses();
  // loopback 必须成功，否则宿主无意义
  await app.listen('127.0.0.1', config.port);
  console.log(`listening on http://127.0.0.1:${config.port}`);
  // Tailscale 地址绑定失败只降级警告（如 Tailscale 正在重连），不拖垮 loopback 服务
  for (const addr of addrs.filter((a) => a !== '127.0.0.1')) {
    try {
      await app.listen(addr, config.port);
      console.log(`listening on http://${addr}:${config.port}`);
    } catch (err) {
      console.warn(`[warn] 无法绑定 ${addr}:${config.port} — ${err.message}`);
    }
  }
  if (addrs.length === 1) {
    // Tailscale IP 在启动时一次性检测；后装/重连 Tailscale 后需重启宿主生效
    console.log('提示：未检测到 Tailscale 网卡，目前只能本机访问（装好 Tailscale 后重启宿主生效）。');
  }
  console.log(`token: ${config.token.slice(0, 8)}…（完整 token 见 host/data/config.json）`);
}

main().catch((err) => {
  console.error('[fatal]', err);
  process.exit(1);
});
