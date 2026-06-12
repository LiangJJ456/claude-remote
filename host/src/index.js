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
  for (const addr of addrs) {
    await app.listen(addr, config.port);
    console.log(`listening on http://${addr}:${config.port}`);
  }
  if (addrs.length === 1) {
    console.log('提示：未检测到 Tailscale 网卡，目前只能本机访问。');
  }
  console.log(`token: ${config.token}`);
}

main();
