'use strict';
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');

let config;
try {
  config = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'config.json'), 'utf8'));
} catch (e) {
  process.stderr.write(`[cc] 无法读取配置：${e.message}\n请先在 host/ 目录启动宿主：npm start\n`);
  process.exit(1);
}
const args = process.argv.slice(2);
function arg(name) {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

let sessionId = arg('--attach');
const ws = new WebSocket(`ws://127.0.0.1:${config.port}`);

function send(msg) {
  ws.send(JSON.stringify(msg));
}

function quit(code, msg) {
  if (msg) process.stdout.write(msg);
  try {
    process.stdin.setRawMode(false);
  } catch {}
  process.exit(code);
}

ws.on('open', () => send({ type: 'auth', token: config.token }));
ws.on('error', (e) => quit(1, `\n[无法连接宿主：${e.message}。宿主跑起来了吗？]\n`));
ws.on('close', () => quit(1, '\n[连接已断开]\n'));
ws.on('message', (raw) => {
  let msg;
  try {
    msg = JSON.parse(raw.toString());
  } catch {
    return quit(1, '\n[消息解析失败]\n');
  }
  if (msg.type === 'auth_ok') {
    if (sessionId) doAttach();
    else send({ type: 'create', cwd: arg('--cwd') || process.cwd(), name: arg('--name') });
  }
  if (msg.type === 'created') {
    sessionId = msg.sessionId;
    doAttach();
  }
  if (msg.type === 'output' && msg.sessionId === sessionId) {
    process.stdout.write(Buffer.from(msg.data, 'base64'));
  }
  if (msg.type === 'event' && msg.sessionId === sessionId && msg.kind === 'session_exited') {
    quit(0, '\n[会话已结束]\n');
  }
  if (msg.type === 'error') {
    quit(1, `\n[错误：${msg.message}]\n`);
  }
});

function doAttach() {
  if (!process.stdin.isTTY) {
    return quit(1, '[cc] 需要在交互终端中运行\n');
  }
  send({ type: 'attach', sessionId, cols: process.stdout.columns, rows: process.stdout.rows });
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.on('data', (buf) => {
    if (buf.length === 1 && buf[0] === 0x11) {
      // Ctrl+Q
      return quit(0, '\n[已离开会话，会话仍在后台运行；cc -Attach 可回来]\n');
    }
    send({ type: 'input', sessionId, data: buf.toString('base64') });
  });
  process.stdout.on('resize', () =>
    send({ type: 'resize', sessionId, cols: process.stdout.columns, rows: process.stdout.rows })
  );
}
