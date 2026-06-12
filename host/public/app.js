'use strict';

const KEYMAP = { enter: '\r', esc: '\x1b', up: '\x1b[A', down: '\x1b[B', 1: '1', 2: '2', 3: '3' };

let token = localStorage.getItem('token');
if (!token) {
  token = prompt('输入宿主 token（host/data/config.json 里的 token 字段）');
  localStorage.setItem('token', token);
}

const term = new Terminal({ fontSize: 14, scrollback: 5000 });
const fit = new FitAddon.FitAddon();
term.loadAddon(fit);
term.open(document.getElementById('term'));

let ws;
let current = null;

function b64encode(str) {
  return btoa(String.fromCharCode(...new TextEncoder().encode(str)));
}
function b64decode(b64) {
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}
function send(msg) {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}

function connect() {
  ws = new WebSocket(`ws://${location.host}`);
  ws.onopen = () => send({ type: 'auth', token });
  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    if (msg.type === 'auth_ok') {
      send({ type: 'list' });
      if (current) send({ type: 'attach', sessionId: current, cols: term.cols, rows: term.rows });
    }
    if (msg.type === 'sessions') renderSessions(msg.sessions);
    if (msg.type === 'created') attach(msg.sessionId);
    if (msg.type === 'output' && msg.sessionId === current) term.write(b64decode(msg.data));
    if (msg.type === 'error') {
      console.error(msg.message);
      if (msg.message.includes('鉴权')) {
        localStorage.removeItem('token');
        alert('token 错误，请刷新重输');
      }
    }
  };
  ws.onclose = () => setTimeout(connect, 1000);
}

function renderSessions(sessions) {
  const el = document.getElementById('sessions');
  el.innerHTML = '';
  for (const s of sessions) {
    const div = document.createElement('div');
    div.className = 'session';
    const stateText = { working: '干活中', waiting: '等输入', exited: '已结束' }[s.state] || s.state;
    div.innerHTML = `<span>${s.name}</span><span class="state-${s.state}">${stateText}${s.orphaned ? '（中断）' : ''}</span>`;
    div.onclick = () => (s.state === 'exited' && s.orphaned ? null : attach(s.id));
    el.appendChild(div);
  }
}

function attach(id) {
  current = id;
  document.getElementById('list-view').style.display = 'none';
  document.getElementById('term-view').style.display = 'flex';
  term.reset();
  fit.fit();
  send({ type: 'attach', sessionId: id, cols: term.cols, rows: term.rows });
  term.focus();
}

function backToList() {
  if (current) send({ type: 'detach', sessionId: current });
  current = null;
  document.getElementById('term-view').style.display = 'none';
  document.getElementById('list-view').style.display = 'block';
  send({ type: 'list' });
}

term.onData((d) => {
  if (current) send({ type: 'input', sessionId: current, data: b64encode(d) });
});

window.addEventListener('resize', () => {
  if (!current) return;
  fit.fit();
  send({ type: 'resize', sessionId: current, cols: term.cols, rows: term.rows });
});

document.getElementById('new-session').onclick = () => {
  const cwd = prompt('在哪个目录启动 claude？', 'C:\\Users\\galaxy\\code');
  if (cwd) send({ type: 'create', cwd });
};

for (const btn of document.querySelectorAll('#bar button')) {
  btn.onclick = () => {
    const k = btn.dataset.key;
    if (k === 'back') return backToList();
    if (current) send({ type: 'input', sessionId: current, data: b64encode(KEYMAP[k]) });
  };
}

connect();
