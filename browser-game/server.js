// Apoc Arena - statischer Webserver + WebSocket-Relay fuer Online-PvP
const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 3000;
const PUBLIC = path.join(__dirname, 'public');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

const server = http.createServer((req, res) => {
  let urlPath = decodeURIComponent(req.url.split('?')[0]);
  if (urlPath === '/') urlPath = '/index.html';
  const filePath = path.join(PUBLIC, path.normalize(urlPath));
  if (!filePath.startsWith(PUBLIC)) {
    res.writeHead(403);
    return res.end('Forbidden');
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('404 - nicht gefunden');
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
});

// ---- WebSocket-Relay: Raeume mit 4-stelligem Code ----
const wss = new WebSocketServer({ server });
const rooms = new Map(); // code -> { a: ws|null, b: ws|null, seed, rt, size }

// Stabilitaet: tote Verbindungen erkennen (Ping/Pong) und Raeume aufraeumen
setInterval(() => {
  for (const ws of wss.clients) {
    if (ws.isAlive === false) { ws.terminate(); continue; }
    ws.isAlive = false;
    try { ws.ping(); } catch { }
  }
}, 30000);

process.on('uncaughtException', (e) => console.error('Unerwarteter Fehler:', e.message));
process.on('unhandledRejection', (e) => console.error('Unbehandelte Promise:', e));

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function makeCode() {
  let c = '';
  for (let i = 0; i < 4; i++) c += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  return rooms.has(c) ? makeCode() : c;
}

function send(ws, obj) {
  if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj));
}

wss.on('connection', (ws) => {
  ws.room = null;
  ws.side = null;
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
  ws.on('error', () => { });

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    if (msg.t === 'create') {
      const code = makeCode();
      const seed = (Math.random() * 0xffffffff) >>> 0;
      const size = Math.max(2, Math.min(6, Number(msg.size) || 4));
      rooms.set(code, { a: ws, b: null, seed, rt: !!msg.rt, size });
      ws.room = code; ws.side = 'A';
      send(ws, { t: 'created', code });
    }

    else if (msg.t === 'join') {
      const code = String(msg.code || '').toUpperCase().trim();
      const room = rooms.get(code);
      if (!room) return send(ws, { t: 'error', msg: 'Raum nicht gefunden.' });
      if (room.b) return send(ws, { t: 'error', msg: 'Raum ist bereits voll.' });
      room.b = ws;
      ws.room = code; ws.side = 'B';
      send(room.a, { t: 'start', seed: room.seed, side: 'A', rt: room.rt, size: room.size });
      send(room.b, { t: 'start', seed: room.seed, side: 'B', rt: room.rt, size: room.size });
    }

    else if (msg.t === 'cmd') {
      const room = rooms.get(ws.room);
      if (!room) return;
      const other = ws.side === 'A' ? room.b : room.a;
      send(other, { t: 'cmd', data: msg.data });
    }
  });

  ws.on('close', () => {
    const room = rooms.get(ws.room);
    if (!room) return;
    const other = ws.side === 'A' ? room.b : room.a;
    send(other, { t: 'peer_left' });
    rooms.delete(ws.room);
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Apoc Arena laeuft auf http://0.0.0.0:${PORT}`);
});
