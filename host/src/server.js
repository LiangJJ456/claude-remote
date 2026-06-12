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
        default:
          send(ws, { type: 'error', message: `未知消息类型: ${msg.type}` });
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
