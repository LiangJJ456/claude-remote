'use strict';
const fs = require('fs');
const os = require('os');
const http = require('http');
const path = require('path');
const { WebSocketServer } = require('ws');
const { lastAssistantText } = require('./transcript');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');

function isLoopback(address) {
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
};

function createApp({ manager, config }) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });
  const authed = new Set();

  function send(ws, msg) {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
  }

  function broadcastSessions() {
    const msg = { type: 'sessions', sessions: manager.list() };
    for (const ws of authed) send(ws, msg);
  }

  function broadcastEvent(sessionId, kind, preview) {
    const msg = { type: 'event', sessionId, kind };
    if (preview) msg.preview = preview;
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
          case 'listdir': {
            const dir = (typeof msg.path === 'string' && msg.path) ? msg.path : os.homedir();
            // 特殊路径 "::drives"：返回所有可用盘符根（C:\、D:\…），entries 为完整盘根
            if (dir === '::drives') {
              const drives = [];
              for (let c = 65; c <= 90; c++) {
                const root = String.fromCharCode(c) + ':\\';
                try { fs.accessSync(root); drives.push(root); } catch {}
              }
              send(ws, { type: 'dir', path: '::drives', parent: '', entries: drives });
              break;
            }
            // 盘符根（C:\）的上一级指向磁盘列表，便于切换其它盘
            const isDriveRoot = /^[A-Za-z]:[\\/]?$/.test(dir);
            const parent = isDriveRoot ? '::drives' : path.dirname(dir);
            try {
              const entries = fs.readdirSync(dir, { withFileTypes: true })
                .filter((d) => d.isDirectory() && !d.name.startsWith('.'))
                .map((d) => d.name)
                .sort((a, b) => a.localeCompare(b));
              send(ws, { type: 'dir', path: dir, parent, entries });
            } catch (e) {
              send(ws, { type: 'dir', path: dir, parent, entries: [] });
            }
            break;
          }
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
    if (req.method === 'POST' && req.url.split('?')[0] === '/hook') return handleHook(req, res);
    serveStatic(req, res);
  }

  function handleHook(req, res) {
    if (!isLoopback(req.socket.remoteAddress)) {
      res.writeHead(403);
      return res.end();
    }
    const MAX_BODY = 64 * 1024;
    let body = '';
    req.on('data', (c) => {
      body += c;
      if (Buffer.byteLength(body) > MAX_BODY) req.destroy();
    });
    req.on('end', () => {
      try {
        const { sessionId, kind, transcriptPath, message } = JSON.parse(body);
        if (typeof sessionId !== 'string' || typeof kind !== 'string') {
          res.writeHead(400);
          return res.end();
        }
        const session = manager.get(sessionId);
        if (session) {
          // 预览文本：stop 时读 transcript 取最后一条 Claude 回复；其它（授权）用 hook 的 message
          let preview = '';
          if (kind === 'stop' && typeof transcriptPath === 'string' && transcriptPath) {
            preview = lastAssistantText(transcriptPath);
          } else if (typeof message === 'string') {
            preview = message;
          }
          // event 先于状态变化广播；stop 的 setState 会经 manager 监听器触发唯一一次 sessions 广播
          broadcastEvent(sessionId, kind, preview);
          if (kind === 'stop') session.setState('waiting');
          else broadcastSessions();
        }
        res.writeHead(204);
        res.end();
      } catch {
        res.writeHead(400);
        res.end();
      }
    });
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

module.exports = { createApp, isLoopback };
