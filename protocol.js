// The room protocol, shared by the local Node server (server.js) and the Cloudflare Worker (worker/index.js).

export const ROOM_RE = /^[a-z0-9]{4,16}$/;
export const MAX_PEOPLE = 2;        // a world is for two. that's the whole product.
export const COLORS = 6;
export const WORLDS = 5;
export const MAX_PAYLOAD = 32 * 1024; // SDP offers run a few KB
const REACTIONS = new Set(['heart', 'spark', 'wave', 'bloom', 'wish', 'beacon']);
const BUCKET_SIZE = 120;            // burst allowance per socket
const BUCKET_REFILL = 40;           // messages per second, sustained
const MAX_LEAD_MS = 30_000;         // how far ahead a world change may be scheduled

const finite = (v, limit) => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= limit;
const vec3 = (p) => Array.isArray(p) && p.length === 3 && p.every((x) => finite(x, 5000));
export const cleanText = (v, max) => String(v ?? '').replace(/[\p{C}]/gu, '').trim().slice(0, max);

/** Who someone says they are, made safe. */
export const cleanHello = (m) => ({
  name: cleanText(m.name, 24) || 'someone',
  color: Number.isInteger(m.color) ? Math.abs(m.color) % COLORS : 0,
});

// Every relayed message is rebuilt from known fields, so nothing unexpected passes through.
export const CLEAN = {
  s: (m) => vec3(m.p) && finite(m.yaw, 1000) && { t: 's', p: m.p, yaw: m.yaw },
  react: (m) => REACTIONS.has(m.k) && vec3(m.p) && Number.isInteger(m.seed) && finite(m.seed, 2 ** 31)
    && { t: 'react', k: m.k, p: m.p, seed: m.seed },
  chat: (m) => { const text = cleanText(m.text, 280); return text && { t: 'chat', text }; },
  hold: (m) => ({ t: 'hold', on: m.on === true }),
  rtc: (m) => m.d && typeof m.d === 'object' && { t: 'rtc', d: m.d },
  moment: (m) => Number.isInteger(m.i) && m.i >= 0 && m.i < WORLDS && { t: 'moment', i: m.i },
  world: (m) => {
    if (!Number.isInteger(m.i) || m.i < 0 || m.i >= WORLDS || !finite(m.start, 1e14)) return false;
    const now = Date.now();
    return { t: 'world', i: m.i, start: Math.min(Math.max(m.start, now), now + MAX_LEAD_MS) };
  },
};

/** World changes and meeting moments go to both people, so both take the same path. */
export const TO_BOTH = new Set(['world', 'moment']);

/** A token bucket: `take()` is false once a socket is sending faster than it should. */
export function bucket() {
  let tokens = BUCKET_SIZE;
  let last = Date.now();
  return () => {
    const now = Date.now();
    tokens = Math.min(BUCKET_SIZE, tokens + ((now - last) / 1000) * BUCKET_REFILL);
    last = now;
    if (tokens < 1) return false;
    tokens -= 1;
    return true;
  };
}

export const parse = (raw) => {
  try {
    const m = JSON.parse(raw);
    return m && typeof m === 'object' ? m : null;
  } catch { return null; }
};
