'use strict';
/**
 * M1 协议级端到端验证脚本
 * 用法: node host/scripts/m1-verify.js [ws://127.0.0.1:8787]
 *
 * 流程: auth → list → create(os.tmpdir()) → attach → 收到 output → kill → 退出
 * 依赖: host/node_modules/ws, host/data/config.json
 */
const path = require('path');
const os = require('os');
const fs = require('fs');

// 允许从任意目录运行
const HOST_DIR = path.join(__dirname, '..');
const WS = require(path.join(HOST_DIR, 'node_modules', 'ws'));

const configPath = path.join(HOST_DIR, 'data', 'config.json');
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));

const url = process.argv[2] || `ws://127.0.0.1:${config.port}`;
const token = config.token;

const TIMEOUT_MS = 20000; // 20s 总超时

function log(label, msg) {
  const ts = new Date().toISOString().slice(11, 23);
  console.log(`[${ts}] ${label}: ${msg}`);
}

async function run() {
  log('INFO', `连接 ${url}`);
  const ws = new WS(url);

  let sessionId = null;
  let outputReceived = false;
  let resolve, reject;

  const done = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });

  const timer = setTimeout(() => reject(new Error('超时：未在 20s 内完成验证')), TIMEOUT_MS);

  ws.on('open', () => {
    log('WS', 'connected');
    ws.send(JSON.stringify({ type: 'auth', token }));
  });

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch (e) {
      log('ERR', `无法解析消息: ${raw}`);
      return;
    }

    log('RECV', JSON.stringify(msg).slice(0, 120));

    switch (msg.type) {
      case 'auth_ok':
        log('AUTH', 'ok');
        ws.send(JSON.stringify({ type: 'list' }));
        // 用 os.tmpdir() 作为 cwd；claudeCommand 能否启动不是本脚本的责任
        // 只要 create 被接受、created 回来即验证协议通路
        ws.send(JSON.stringify({ type: 'create', cwd: os.tmpdir() }));
        break;

      case 'sessions':
        log('LIST', `会话数 ${msg.sessions.length}`);
        break;

      case 'created':
        sessionId = msg.sessionId;
        log('CREATED', `sessionId=${sessionId}`);
        ws.send(JSON.stringify({ type: 'attach', sessionId, cols: 80, rows: 24 }));
        break;

      case 'output':
        if (msg.sessionId === sessionId && !outputReceived) {
          outputReceived = true;
          const bytes = Buffer.from(msg.data, 'base64');
          log('OUTPUT', `收到 ${bytes.length} 字节 (base64 快照/实时流均可)`);
          // kill session，然后收尾
          ws.send(JSON.stringify({ type: 'kill', sessionId }));
          // 稍等一下让 kill 消息被服务端处理
          setTimeout(() => {
            ws.close();
            clearTimeout(timer);
            resolve({ sessionId, outputBytes: bytes.length });
          }, 500);
        }
        break;

      case 'event':
        log('EVENT', `${msg.kind} for ${msg.sessionId}`);
        break;

      case 'error':
        log('ERR', msg.message);
        // 鉴权失败或创建失败都立即退出
        if (msg.message && (msg.message.includes('鉴权') || msg.message.includes('创建会话失败'))) {
          clearTimeout(timer);
          ws.close();
          reject(new Error(msg.message));
        }
        break;

      default:
        log('UNKNOWN', msg.type);
    }
  });

  ws.on('error', (err) => {
    clearTimeout(timer);
    reject(err);
  });

  ws.on('close', () => {
    log('WS', 'closed');
  });

  const result = await done;
  return result;
}

run()
  .then((result) => {
    console.log('\n[PASS] M1 协议验证通过');
    console.log(`  sessionId : ${result.sessionId}`);
    console.log(`  output 字节: ${result.outputBytes}`);
    process.exit(0);
  })
  .catch((err) => {
    console.error('\n[FAIL]', err.message);
    process.exit(1);
  });
