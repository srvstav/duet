import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { ROOM_RE, MAX_PEOPLE, MAX_PAYLOAD, CLEAN, TO_BOTH, bucket, cleanHello, parse } from './protocol.js';

const PORT = Number(process.env.PORT ?? 8080);
const PUBLIC = fileURLToPath(new URL('./public/', import.meta.url));
const HEARTBEAT_MS = 10_000;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.jpg': 'image/jpeg',
  '.m4a': 'audio/mp4',
};

/** code → { people: Map<id, {ws, name, color}>, leader: id|null, world: {i, start}|null } */
const rooms = new Map();

const send = (ws, msg) => ws.readyState === ws.OPEN && ws.send(JSON.stringify(msg));
const others = (room, id) => [...room.people].filter(([pid]) => pid !== id).map(([, p]) => p);

const httpServer = http.createServer(async (req, res) => {
  const { pathname, searchParams } = new URL(req.url, 'http://x');

  // Lets an invite link say "Mira is waiting for you" before you step in.
  if (pathname === '/api/room') {
    const room = rooms.get(searchParams.get('c') ?? '');
    const here = room ? [...room.people.values()].map((p) => p.name) : [];
    return res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
      .end(JSON.stringify({ here, full: here.length >= MAX_PEOPLE }));
  }

  const file = path.normalize(path.join(PUBLIC, pathname === '/' ? 'index.html' : pathname));
  if (!file.startsWith(PUBLIC) || !TYPES[path.extname(file)]) return res.writeHead(404).end('not here');
  try {
    const body = await fs.readFile(file);
    const ext = path.extname(file);
    const cache = ext === '.m4a' || ext === '.jpg' ? 'public, max-age=86400' : 'no-cache'; // media never changes; code does
    res.writeHead(200, { 'Content-Type': TYPES[ext], 'Cache-Control': cache }).end(body);
  } catch (err) {
    res.writeHead(err.code === 'ENOENT' ? 404 : 500).end();
  }
});

const wss = new WebSocketServer({ server: httpServer, path: '/ws', maxPayload: MAX_PAYLOAD });

wss.on('connection', (ws) => {
  const id = randomUUID().slice(0, 8);
  let room = null;
  let code = null;
  const take = bucket();
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });

  const leave = () => {
    if (!room) return;
    room.people.delete(id);
    for (const p of room.people.values()) send(p.ws, { t: 'bye' });
    if (room.people.size === 0) rooms.delete(code);
    else if (room.leader === id) {
      room.leader = room.people.keys().next().value;
      send(room.people.get(room.leader).ws, { t: 'leader' });
    }
    room = null;
  };

  ws.on('message', (raw) => {
    if (!take()) return;
    const m = parse(raw);
    if (!m) return;

    if (m.t === 'ping') return send(ws, { t: 'pong', c: m.c, s: Date.now() });

    if (m.t === 'hello') {
      if (room || typeof m.room !== 'string' || !ROOM_RE.test(m.room)) return;
      const r = rooms.get(m.room) ?? { people: new Map(), leader: null, world: null };
      if (r.people.size >= MAX_PEOPLE) return send(ws, { t: 'full' });
      const me = { ws, ...cleanHello(m) };
      code = m.room;
      room = r;
      rooms.set(code, r);
      r.people.set(id, me);
      r.leader ??= id;
      const peer = others(r, id)[0];
      const peerId = [...r.people.keys()].find((pid) => pid !== id);
      send(ws, {
        t: 'welcome', id, leader: r.leader === id, world: r.world, now: Date.now(),
        peer: peer ? { id: peerId, name: peer.name, color: peer.color } : null,
      });
      if (peer) send(peer.ws, { t: 'peer', id, name: me.name, color: me.color });
      return;
    }

    if (!room) return;
    const clean = CLEAN[m.t]?.(m);
    if (!clean) return;
    if (TO_BOTH.has(clean.t)) {
      if (clean.t === 'world') room.world = { i: clean.i, start: clean.start };
      for (const p of room.people.values()) send(p.ws, clean);
      return;
    }
    for (const p of others(room, id)) send(p.ws, clean);
  });

  ws.on('close', leave);
  ws.on('error', leave);
});

// Drop sockets that vanished without a close, so a ghost never holds someone's seat.
const heartbeat = setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) { ws.terminate(); continue; }
    ws.isAlive = false;
    ws.ping();
  }
}, HEARTBEAT_MS);
wss.on('close', () => clearInterval(heartbeat));

httpServer.listen(PORT, () => console.log(`duet → http://localhost:${PORT}`));
