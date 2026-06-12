'use strict';
const fs = require('fs');
const http = require('http');
const path = require('path');
const { WebSocketServer } = require('ws');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
};

function createApp({ manager, config }) {
  const wss = new WebSocketServer({ noServer: true });
  const authed = new Set();

  function send(ws, msg) {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
  }

  function broadcastSessions() {
    const msg = { type: 'sessions', sessions: manager.list() };
    for (const ws of authed) send(ws, msg);
  }

  function broadcastEvent(sessionId, kind) {
    const msg = { type: 'event', sessionId, kind };
    for (const ws of authed) send(ws, msg);
  }

  manager.on('session-state', (session) => {
    broadcastSessions();
    if (session && session.state === 'exited') broadcastEvent(session.id, 'session_exited');
  });

  wss.on('connection', (ws) => {
    let isAuthed = false;
    const attached = new Map();

    ws.on('message', (raw) => {
      let msg;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return send(ws, { type: 'error', message: '无法解析消息' });
      }

      if (!isAuthed) {
        if (msg.type === 'auth' && msg.token === config.token) {
          isAuthed = true;
          authed.add(ws);
          send(ws, { type: 'auth_ok' });
        } else {
          send(ws, { type: 'error', message: '鉴权失败' });
          ws.close();
        }
        return;
      }

      const session = msg.sessionId ? manager.get(msg.sessionId) : null;
      try {
        switch (msg.type) {
          case 'list':
            send(ws, { type: 'sessions', sessions: manager.list() });
            break;
          case 'create': {
            let s;
            try {
              s = manager.create({ cwd: msg.cwd, name: msg.name });
            } catch (e) {
              return send(ws, { type: 'error', message: `创建会话失败: ${e.message}` });
            }
            send(ws, { type: 'created', sessionId: s.id });
            broadcastSessions();
            break;
          }
          case 'attach': {
            if (!session) return send(ws, { type: 'error', message: '会话不存在' });
            const old = attached.get(session.id);
            if (old) {
              session.off('data', old);
              attached.delete(session.id);
            }
            if (Number.isInteger(msg.cols) && Number.isInteger(msg.rows) && msg.cols > 0 && msg.rows > 0) {
              session.resize(msg.cols, msg.rows);
            }
            // 先挂实时流 handler 再发快照：两步在同一同步块内，PTY 数据事件不可能插入其间，
            // 但显式的注册先行让顺序语义不依赖单线程时序推理
            const handler = (buf) =>
              send(ws, { type: 'output', sessionId: session.id, data: buf.toString('base64') });
            session.on('data', handler);
            attached.set(session.id, handler);
            send(ws, {
              type: 'output',
              sessionId: session.id,
              data: session.buffer.snapshot().toString('base64'),
            });
            break;
          }
          case 'input':
            if (session && typeof msg.data === 'string') {
              session.write(Buffer.from(msg.data, 'base64').toString('utf8'));
            }
            break;
          case 'resize':
            if (session && Number.isInteger(msg.cols) && Number.isInteger(msg.rows) && msg.cols > 0 && msg.rows > 0) {
              session.resize(msg.cols, msg.rows);
            }
            break;
          case 'detach': {
            const handler = attached.get(msg.sessionId);
            // session 已不在 manager 中时无需 off：其 PTY 已死，handler 不会再被触发
            if (handler && session) session.off('data', handler);
            attached.delete(msg.sessionId);
            break;
          }
          case 'kill':
            manager.kill(msg.sessionId);
            broadcastSessions();
            break;
          default:
            send(ws, { type: 'error', message: `未知消息类型: ${msg.type}` });
        }
      } catch (e) {
        console.error('[server] 处理消息异常:', e);
        send(ws, { type: 'error', message: '处理消息失败: ' + e.message });
      }
    });

    ws.on('close', () => {
      authed.delete(ws);
      for (const [id, handler] of attached) {
        const s = manager.get(id);
        if (s) s.off('data', handler);
      }
      attached.clear();
    });
  });

  function serveStatic(req, res) {
    const urlPath = req.url === '/' ? '/index.html' : req.url.split('?')[0];
    const file = path.join(PUBLIC_DIR, path.normalize(urlPath).replace(/^([.][.][\\/])+/, ''));
    if (!file.startsWith(PUBLIC_DIR) || !fs.existsSync(file)) {
      res.writeHead(404);
      return res.end('not found');
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  }

  function handleRequest(req, res) {
    serveStatic(req, res);
  }

  function listen(address, port) {
    const server = http.createServer(handleRequest);
    server.on('upgrade', (req, socket, head) => {
      wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
    });
    return new Promise((resolve) => server.listen(port, address, () => resolve(server)));
  }

  return { listen, wss };
}

module.exports = { createApp };
