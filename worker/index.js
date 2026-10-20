// duet on Cloudflare: static files are served as Worker assets; each room is one Durable Object
// holding at most two WebSockets. Same protocol as server.js, via protocol.js.
import { DurableObject } from 'cloudflare:workers';
import { ROOM_RE, MAX_PEOPLE, MAX_PAYLOAD, CLEAN, TO_BOTH, bucket, cleanHello, parse } from '../protocol.js';

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (url.pathname === '/ws' || url.pathname === '/api/room') {
      const code = url.searchParams.get(url.pathname === '/ws' ? 'room' : 'c') ?? '';
      if (!ROOM_RE.test(code)) return new Response('bad room', { status: 400 });
      if (url.pathname === '/ws' && req.headers.get('Upgrade') !== 'websocket') return new Response('expected a websocket', { status: 426 });
      const res = await env.ROOM.get(env.ROOM.idFromName(code)).fetch(req);
      if (url.pathname === '/ws') return res;
      // The GitHub Pages copy of duet asks who's waiting from another origin.
      const out = new Response(res.body, res);
      out.headers.set('Access-Control-Allow-Origin', '*');
      return out;
    }
    return env.ASSETS.fetch(req);
  },
};

const send = (ws, msg) => { try { ws.send(JSON.stringify(msg)); } catch { /* already gone */ } };

/**
 * One room. Uses WebSocket hibernation, so an idle room costs nothing; who's who lives in each
 * socket's attachment, and the current world in storage.
 */
export class Room extends DurableObject {
  buckets = new Map(); // socket → token bucket (lost on hibernation, which is fine)

  #people(except) {
    return this.ctx.getWebSockets().filter((ws) => ws !== except && ws.deserializeAttachment()?.joined);
  }

  async fetch(req) {
    if (new URL(req.url).pathname === '/api/room') {
      const here = this.#people().map((ws) => ws.deserializeAttachment().name);
      return Response.json({ here, full: here.length >= MAX_PEOPLE }, { headers: { 'Cache-Control': 'no-store' } });
    }
    const { 0: client, 1: server } = new WebSocketPair();
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ id: crypto.randomUUID().slice(0, 8), joined: false });
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws, raw) {
    if (typeof raw !== 'string' || raw.length > MAX_PAYLOAD) return;
    let take = this.buckets.get(ws);
    if (!take) this.buckets.set(ws, (take = bucket()));
    if (!take()) return;
    const m = parse(raw);
    if (!m) return;
    const me = ws.deserializeAttachment();

    if (m.t === 'ping') return send(ws, { t: 'pong', c: m.c, s: Date.now() });

    if (m.t === 'hello') {
      if (me.joined) return;
      const others = this.#people(ws);
      if (others.length >= MAX_PEOPLE) return send(ws, { t: 'full' });
      const leader = !others.some((o) => o.deserializeAttachment().leader);
      Object.assign(me, cleanHello(m), { joined: true, leader });
      ws.serializeAttachment(me);
      const peer = others[0]?.deserializeAttachment();
      send(ws, {
        t: 'welcome', id: me.id, leader, world: (await this.ctx.storage.get('world')) ?? null, now: Date.now(),
        peer: peer ? { id: peer.id, name: peer.name, color: peer.color } : null,
      });
      for (const o of others) send(o, { t: 'peer', id: me.id, name: me.name, color: me.color });
      return;
    }

    if (!me.joined) return;
    const clean = CLEAN[m.t]?.(m);
    if (!clean) return;
    if (TO_BOTH.has(clean.t)) {
      if (clean.t === 'world') await this.ctx.storage.put('world', { i: clean.i, start: clean.start });
      for (const o of this.#people()) send(o, clean);
      return;
    }
    for (const o of this.#people(ws)) send(o, clean);
  }

  async webSocketClose(ws, code) {
    this.#leave(ws);
    try { ws.close(code === 1005 ? 1000 : code, 'bye'); } catch { /* already closed */ }
  }

  async webSocketError(ws) { this.#leave(ws); }

  async #leave(ws) {
    const me = ws.deserializeAttachment();
    this.buckets.delete(ws);
    if (!me?.joined) return;
    ws.serializeAttachment({ ...me, joined: false });
    const others = this.#people(ws);
    for (const o of others) send(o, { t: 'bye' });
    if (!others.length) { await this.ctx.storage.deleteAll(); return; } // an empty room forgets everything
    if (me.leader) {
      const next = others[0];
      next.serializeAttachment({ ...next.deserializeAttachment(), leader: true });
      send(next, { t: 'leader' });
    }
  }
}
