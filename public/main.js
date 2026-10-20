import * as THREE from 'three';
import { World, Wisp, BOUND } from './world.js';
import { WORLDS } from './worlds.js';
import { Music, PIECES } from './music.js';
import { Link, Clock, Voice } from './net.js';

const COLORS = ['#ffb27a', '#ff8fab', '#9fd8ff', '#9ff0c9', '#e6c6ff', '#fff0a8'];
const COLOR_NAMES = ['ember', 'rose', 'moonlight', 'sea glass', 'lilac', 'candle'];
const REACTIONS = [
  { k: 'heart', key: '1', label: 'heart', verb: 'sent you a heart' },
  { k: 'spark', key: '2', label: 'spark', verb: 'lit a spark' },
  { k: 'wave', key: '3', label: 'hello', verb: 'waved at you' },
  { k: 'bloom', key: '4', label: 'bloom', verb: 'planted flowers for you' },
  { k: 'wish', key: '5', label: 'wish', verb: 'made a wish on a falling star' },
  { k: 'beacon', key: '6', label: 'come here', verb: 'is calling you over' },
];
const ICONS = {
  heart: '<path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"/>',
  spark: '<path d="M12 3l1.6 6.4L20 11l-6.4 1.6L12 19l-1.6-6.4L4 11l6.4-1.6z"/>',
  wave: '<path d="M3 13c2-3 4-3 6 0s4 3 6 0 4-3 6 0" fill="none"/><path d="M3 18c2-3 4-3 6 0s4 3 6 0 4-3 6 0" fill="none" opacity=".5"/>',
  bloom: '<circle cx="12" cy="7.5" r="3"/><circle cx="16.3" cy="10.6" r="3"/><circle cx="14.6" cy="15.6" r="3"/><circle cx="9.4" cy="15.6" r="3"/><circle cx="7.7" cy="10.6" r="3"/><circle cx="12" cy="12" r="2" fill="var(--color-ink)"/>',
  wish: '<path d="M17 5l1 2.6 2.6 1-2.6 1L17 12l-1-2.4-2.6-1 2.6-1z"/><path d="M14 10L4 20" fill="none"/><path d="M11 8L5 14" fill="none" opacity=".5"/>',
  beacon: '<circle cx="12" cy="12" r="2.5"/><circle cx="12" cy="12" r="6" fill="none"/><circle cx="12" cy="12" r="9.5" fill="none" opacity=".45"/>',
};
const SEND_HZ = 12;
const HOLD_RANGE = 22;
const NEAR = 10, FAR = 90;      // closeness: 1 inside NEAR metres, 0 beyond FAR

const $ = (s) => document.querySelector(s);
const store = {
  get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* private mode: fine */ } },
};
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// ── engine ──────────────────────────────────────────────────────────────────────────

const world = new World($('#scene'));
const music = new Music();
const clock = new Clock();
const camera = world.camera;
world.setWorld(WORLDS[2]); // the lobby waits in the moon garden

const me = {
  name: '', color: 0, pos: new THREE.Vector3(0, 8, 10), vel: new THREE.Vector3(),
  yaw: 0, pitch: 0.28, dist: 9, reaching: false, wisp: null, glide: 0, bubble: null,
};
let partner = null;          // { id, name, color, pos, target, yaw, reaching, wisp, el, bubble }
let link = null;
let voice = null;
let myId = null;
let leader = false;
let welcomed = false;
let started = false;
let holding = false;
let autoFollow = false;
let code = null;
let current = { i: -1, start: 0 };
let energy = 0;
let closeness = 1;
let met = false;             // has this world's moment happened yet
let micLevel = null, peerLevel = null, panner = null;

// ── lobby ───────────────────────────────────────────────────────────────────────────

// Letters drift in from a blur, after React Bits' <BlurText>.
const blurIn = (el, text, delay = 0, step = 0.06) => {
  el.textContent = '';
  el.setAttribute('aria-label', text);
  [...text].forEach((ch, i) => {
    const s = document.createElement('span');
    s.className = 'blur-letter';
    s.setAttribute('aria-hidden', 'true');
    s.style.setProperty('--d', `${delay + i * step}s`);
    s.textContent = ch === ' ' ? ' ' : ch;
    el.append(s);
  });
};
blurIn($('#title'), 'duet', 0.2, 0.14);

const swatches = $('#swatches');
COLORS.forEach((c, i) => {
  const id = `c${i}`;
  swatches.insertAdjacentHTML('beforeend',
    `<input type="radio" name="color" id="${id}" value="${i}"><label for="${id}" style="--c:${c}" title="${COLOR_NAMES[i]}"><span class="sr">${COLOR_NAMES[i]}</span></label>`);
});
const savedColor = Number(store.get('duet:color') ?? Math.floor(Math.random() * COLORS.length));
$(`#c${Number.isInteger(savedColor) && savedColor < COLORS.length ? savedColor : 0}`).checked = true;
$('#name').value = store.get('duet:name') ?? '';

const params = new URLSearchParams(location.search);
const invited = params.get('r');
if (invited && /^[a-z0-9]{4,16}$/.test(invited)) {
  $('#code').value = invited;
  $('#go').textContent = 'step inside';
  fetch(`/api/room?c=${encodeURIComponent(invited)}`).then((r) => r.json()).then(({ here, full }) => {
    const note = $('#invited');
    note.hidden = false;
    note.textContent = full ? 'This world already holds two people.' : here.length ? `${here[0]} is waiting for you.` : 'Someone made a world for you.';
  }).catch(() => {});
}

const newCode = () => {
  const abc = 'abcdefghjkmnpqrstuvwxyz23456789';
  return [...crypto.getRandomValues(new Uint8Array(6))].map((b) => abc[b % abc.length]).join('');
};

$('#enter').addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = $('#name').value.replace(/[\p{C}]/gu, '').trim().slice(0, 24);
  if (!name) return $('#name').focus();
  const typed = $('#code').value.trim().toLowerCase();
  if (typed && !/^[a-z0-9]{4,16}$/.test(typed)) { $('#invited').hidden = false; $('#invited').textContent = 'That code doesn’t look right.'; return; }
  me.name = name;
  me.color = Number(new FormData(e.target).get('color')) || 0;
  store.set('duet:name', name);
  store.set('duet:color', String(me.color));
  code = typed || newCode();
  await begin();
});

// ── stepping in ─────────────────────────────────────────────────────────────────────

async function begin() {
  await music.init();
  music.preload(WORLDS[0].piece);
  music.onEnd = () => { if (leader) requestWorld((current.i + 1) % WORLDS.length, 4200); };
  history.replaceState(null, '', `?r=${code}`);
  me.wisp = new Wisp(world.scene, COLORS[me.color]);
  started = true;
  document.body.classList.add('inside');
  $('#hud').hidden = false;
  buildHud();
  showHint();

  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  link = new Link(`${proto}://${location.host}/ws?room=${code}`, () => ({ t: 'hello', room: code, name: me.name, color: me.color }));
  voice = new Voice({ send: (d) => link.send({ t: 'rtc', d }), onStream: hearPartner });
  link
    .on('open', syncClock)
    .on('pong', (m) => clock.sample(m.c, m.s))
    .on('welcome', onWelcome)
    .on('full', () => { toast('This world already holds two people. Opening a new one for you.'); code = newCode(); history.replaceState(null, '', `?r=${code}`); location.reload(); })
    .on('peer', (m) => { setPartner(m); toast(`${partner.name} is here`); music.chime('hello'); sendState(true); if (me.reaching) link.send({ t: 'hold', on: true }); })
    .on('bye', () => { if (partner) toast(`${partner.name} stepped out. The world will wait.`); dropPartner(); })
    .on('leader', () => { leader = true; })
    .on('s', onState)
    .on('react', (m) => partner && perform(m.k, m.p, m.seed, COLORS[partner.color], false))
    .on('chat', (m) => partner && say(partner, m.text))
    .on('hold', (m) => {
      if (!partner) return;
      partner.reaching = m.on;
      if (m.on && !me.reaching) toast(`${partner.name} is reaching for your hand — press H`);
    })
    .on('world', (m) => enterWorld(m.i, m.start))
    .on('moment', (m) => { if (m.i === current.i) happen(); })
    .on('rtc', (m) => voice.signal(m.d));

  // No server (opened as plain files)? Wander alone rather than wait forever.
  setTimeout(() => { if (!welcomed) { leader = true; requestWorld(0, 2600); } }, 2500);
}

function syncClock() {
  for (let k = 0; k < 6; k++) setTimeout(() => link.send({ t: 'ping', c: Date.now() }), k * 180);
}
setInterval(() => link?.send({ t: 'ping', c: Date.now() }), 20_000);

function onWelcome(m) {
  welcomed = true;
  if (clock.offset === 0) clock.offset = m.now - Date.now(); // rough until the pings land
  myId = m.id;
  leader = m.leader;
  if (m.peer) setPartner(m.peer);
  else if (!partner) $('#invite').classList.add('nudge');
  if (m.world) enterWorld(m.world.i, m.world.start);
  else if (leader && current.i < 0) requestWorld(0, 2600);
}

function requestWorld(i, lead = 3200) {
  const start = clock.now() + lead;
  if (!link?.send({ t: 'world', i, start })) enterWorld(i, start);
}

// ── partner ─────────────────────────────────────────────────────────────────────────

function setPartner(m) {
  if (partner) dropPartner();
  const color = Number.isInteger(m.color) ? m.color % COLORS.length : 0;
  partner = {
    id: m.id, name: String(m.name ?? 'someone').slice(0, 24), color,
    pos: me.pos.clone().add(new THREE.Vector3(6, 0, 0)), target: null, yaw: 0, reaching: false,
    wisp: new Wisp(world.scene, COLORS[color]),
    el: Object.assign(document.createElement('div'), { className: 'tag' }),
    bubble: null,
  };
  partner.el.textContent = partner.name;
  partner.el.style.setProperty('--c', COLORS[color]);
  partner.wisp.visible = false; // until their first position arrives
  $('#labels').append(partner.el);
  $('#invite').classList.remove('nudge');
  document.documentElement.style.setProperty('--them', COLORS[color]);
  voice?.joined(myId > partner.id);
  updatePresence();
}

function dropPartner() {
  if (!partner) return;
  partner.wisp.dispose(world.scene);
  partner.el.remove();
  partner.bubble?.el.remove();
  partner = null;
  holding = false;
  voice?.left();
  peerLevel = null; panner = null;
  $('#seek').hidden = true;
  world.setPlayer(1, new THREE.Vector3(0, -999, 0), new THREE.Color(0), 0);
  updatePresence();
}

const finite = (v) => typeof v === 'number' && Number.isFinite(v);
function onState(m) {
  if (!partner || !Array.isArray(m.p) || !m.p.every(finite)) return;
  const t = new THREE.Vector3(...m.p);
  if (!partner.target || partner.target.distanceTo(t) > 80) { partner.pos.copy(t); partner.wisp.teleport(); } // a new world, or a big jump
  partner.target = t;
  partner.yaw = finite(m.yaw) ? m.yaw : 0;
  partner.wisp.visible = true;
}

let lastSent = 0, sentAt = 0;
const sentPos = new THREE.Vector3();
function sendState(force = false) {
  const now = performance.now();
  if (!force && now - lastSent < 1000 / SEND_HZ) return;
  if (!force && sentPos.distanceToSquared(me.pos) < 0.0004 && now - sentAt < 1000) return;
  lastSent = now;
  sentAt = now;
  sentPos.copy(me.pos);
  link?.send({ t: 's', p: [+me.pos.x.toFixed(2), +me.pos.y.toFixed(2), +me.pos.z.toFixed(2)], yaw: +me.yaw.toFixed(3) });
}

// ── worlds ──────────────────────────────────────────────────────────────────────────

let swapTimer = 0, cardTimer = 0;
function enterWorld(i, start) {
  if (current.i === i && current.start === start) return;
  const w = WORLDS[i];
  const lead = start - clock.now();
  clearTimeout(swapTimer);
  music.stop(1.6);
  music.preload(w.piece);
  const veil = $('#veil');
  veil.style.setProperty('--veil', w.fog.color);
  veil.classList.add('on');
  showCard(w);
  swapTimer = setTimeout(() => {
    world.setWorld(w);
    current = { i, start };
    met = false;
    spawn();
    music.play(w.piece, start, clock);
    music.setWind(w.wind);
    music.preload(WORLDS[(i + 1) % WORLDS.length].piece); // the next piece, ready before it's needed
    updateWhere(w);
    setTimeout(() => veil.classList.remove('on'), 400);
  }, Math.max(0, Math.min(lead - 700, 1600)));
}

function showCard(w) {
  const p = PIECES[w.piece];
  const card = $('#card');
  card.querySelector('.card-num').textContent = w.numeral;
  blurIn(card.querySelector('.card-name'), w.name, 0.15, 0.045);
  card.querySelector('.card-line').textContent = w.line;
  card.querySelector('.card-piece').textContent = `${p.title}${p.opus ? ` · ${p.opus}` : ''}`;
  card.querySelector('.card-composer').textContent = p.composer;
  card.querySelector('.card-credit').textContent = p.credit;
  card.classList.remove('on'); void card.offsetWidth; card.classList.add('on'); // restart the animation
  document.body.classList.add('card-on');
  clearTimeout(cardTimer);
  cardTimer = setTimeout(() => { card.classList.remove('on'); document.body.classList.remove('card-on'); }, 7000);
}

function spawn() {
  const side = leader ? -1 : 1;
  me.pos.set(side * 3.5, 0, 10);
  me.pos.y = world.surfaceAt(me.pos.x, me.pos.z) + (world.w.islands ? 24 : 2.6); // above the clouds, arrive among the islands
  me.vel.set(0, 0, 0);
  me.yaw = 0; me.pitch = 0.22;
  me.wisp?.teleport();
  snapCamera();
  sendState(true);
}

// The meeting place: when you are both there, the world answers, for both of you at once.
function checkMeeting() {
  if (met || !partner?.wisp.visible || current.i < 0) return;
  const L = WORLDS[current.i].landmark;
  const reach = L.radius + 5;
  if (me.pos.distanceTo(world.markPos) < reach && partner.pos.distanceTo(world.markPos) < reach && leader) {
    met = true;
    if (!link.send({ t: 'moment', i: current.i })) happen();
  }
}

function happen() {
  met = true;
  const w = WORLDS[current.i];
  world.moment(w.moment);
  world.met = true;
  music.chime('moment');
  toast(`you found ${w.landmark.label} together`);
  $('#goal').classList.add('done');
}

// ── HUD ─────────────────────────────────────────────────────────────────────────────

function buildHud() {
  const dock = $('#reacts');
  for (const r of REACTIONS) {
    const b = document.createElement('button');
    b.className = 'react spark-click';
    b.dataset.k = r.k;
    b.title = `${r.label} (${r.key})`;
    b.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[r.k]}</svg><span class="react-label">${r.label} <kbd>${r.key}</kbd></span>`;
    b.addEventListener('click', () => react(r.k));
    dock.append(b);
  }
  $('#hand').addEventListener('click', toggleReach);

  const nav = $('#journey');
  WORLDS.forEach((w, i) => {
    const b = document.createElement('button');
    b.className = 'star';
    b.dataset.i = i;
    b.title = `${w.numeral} · ${w.name} — ${PIECES[w.piece].title}`;
    b.innerHTML = `<span class="star-dot"></span><span class="star-tip"><b>${w.numeral}</b> ${w.name}<em>${PIECES[w.piece].title}</em></span>`;
    b.addEventListener('click', () => { if (i !== current.i) requestWorld(i); });
    nav.append(b);
  });

  $('#invite').addEventListener('click', invite);
  $('#presence').addEventListener('click', () => { if (partner) { autoFollow = true; toast(`gliding to ${partner.name}`); } else invite(); });
  $('#voice').addEventListener('click', toggleVoice);
  $('#vol').addEventListener('input', (e) => music.setVolume(Number(e.target.value)));
  $('#help').addEventListener('click', showHint);
  document.documentElement.style.setProperty('--me', COLORS[me.color]);
  updatePresence();
}

function updateWhere(w) {
  const p = PIECES[w.piece];
  $('#where-num').textContent = w.numeral;
  $('#where-name').textContent = w.name;
  $('#where-piece').textContent = `${p.title} — ${p.composer}`;
  document.querySelectorAll('.star').forEach((b) => {
    const k = Number(b.dataset.i);
    b.classList.toggle('active', k === current.i);
    b.classList.toggle('past', k < current.i);
  });
  $('#goal').classList.remove('done');
  document.documentElement.style.setProperty('--world-tint', w.fog.color);
}

function updatePresence() {
  const chip = $('#presence');
  if (!chip) return;
  const text = chip.querySelector('.presence-text');
  chip.classList.toggle('alone', !partner);
  if (!partner) { text.textContent = 'waiting for them'; return; }
  const d = Math.round(me.pos.distanceTo(partner.pos));
  text.innerHTML = '';
  const b = document.createElement('b');
  b.textContent = partner.name;
  text.append(b, document.createTextNode(holding ? ' · hand in hand' : d < 5 ? ' · beside you' : ` · ${d} m`));
}

function updateGoal() {
  const g = $('#goal');
  if (current.i < 0) return;
  const L = WORLDS[current.i].landmark;
  const d = Math.round(me.pos.distanceTo(world.markPos));
  const label = g.querySelector('.goal-text');
  if (met) label.textContent = `${L.label} · found together`;
  else if (!partner) label.textContent = `${L.label} · ${d} m · waits for two`;
  else {
    const them = Math.round(partner.pos.distanceTo(world.markPos));
    label.textContent = d < L.radius + 5 && them >= L.radius + 5 ? `${L.label} · waiting for ${partner.name} (${them} m)` : `meet at ${L.label} · ${d} m`;
  }
  // A little compass needle toward the meeting place.
  v3.copy(world.markPos).sub(me.pos);
  const ang = Math.atan2(-v3.x, -v3.z) - me.yaw;
  g.querySelector('.goal-needle').style.transform = `rotate(${-ang}rad)`;
}

async function invite() {
  const url = `${location.origin}/?r=${code}`;
  try {
    if (navigator.share && matchMedia('(pointer: coarse)').matches) await navigator.share({ title: 'duet', text: `${me.name} made a world for you`, url });
    else { await navigator.clipboard.writeText(url); toast('invite link copied — send it to them'); }
  } catch { toast(url); }
}

let hintTimer = 0;
function showHint() {
  const h = $('#hint');
  h.classList.add('on');
  clearTimeout(hintTimer);
  hintTimer = setTimeout(() => h.classList.remove('on'), 14_000);
}

let toastTimer = 0;
function toast(text) {
  const t = $('#toast');
  t.textContent = text;
  t.classList.remove('on'); void t.offsetWidth; t.classList.add('on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('on'), 4200);
}

// Small sparks where you click, after React Bits' <ClickSpark>.
document.addEventListener('pointerdown', (e) => {
  const el = e.target.closest?.('.spark-click, .primary');
  if (!el) return;
  for (let i = 0; i < 8; i++) {
    const s = document.createElement('i');
    s.className = 'click-spark';
    s.style.left = `${e.clientX}px`;
    s.style.top = `${e.clientY}px`;
    s.style.setProperty('--a', `${i * 45}deg`);
    document.body.append(s);
    s.addEventListener('animationend', () => s.remove());
  }
});

// ── doing things together ───────────────────────────────────────────────────────────

let lastReact = 0;
function react(kind) {
  if (!started) return;
  const now = performance.now();
  if (now - lastReact < 350) return;
  lastReact = now;
  const seed = Math.floor(Math.random() * 2 ** 31);
  const p = [me.pos.x, me.pos.y, me.pos.z];
  perform(kind, p, seed, COLORS[me.color], true);
  link?.send({ t: 'react', k: kind, p, seed });
}

function perform(kind, p, seed, color, mine) {
  if (!REACTIONS.some((r) => r.k === kind) || !p.every(finite)) return;
  world.burst(kind, p, color, seed);
  music.chime(kind);
  const wisp = mine ? me.wisp : partner?.wisp;
  if (wisp) { wisp.pulse = 1; if (kind === 'wave') wisp.spin = 1.1; }
  if (!mine && partner) {
    toast(`${partner.name} ${REACTIONS.find((r) => r.k === kind).verb}`);
    if (kind === 'beacon') $('#seek').classList.add('calling');
  }
}

function toggleReach() {
  me.reaching = !me.reaching;
  $('#hand').classList.toggle('on', me.reaching);
  link?.send({ t: 'hold', on: me.reaching });
  if (me.reaching && partner && !partner.reaching) toast(`reaching for ${partner.name}’s hand…`);
  if (me.reaching && !partner) toast('your hand is open, for when they arrive');
}

// Speech bubbles float above whoever said it.
function say(who, text) {
  const isMe = who === me;
  who.bubble?.el.remove();
  const el = document.createElement('div');
  el.className = 'bubble';
  el.textContent = text;
  el.style.setProperty('--c', COLORS[who.color]);
  $('#labels').append(el);
  who.bubble = { el, until: performance.now() + 6500 + text.length * 40 };
  const li = document.createElement('li');
  const b = document.createElement('b');
  b.textContent = who.name;
  b.style.color = COLORS[who.color];
  li.append(b, document.createTextNode(` ${text}`));
  const log = $('#log');
  log.append(li);
  while (log.children.length > 5) log.firstElementChild.remove();
  if (!isMe) music.chime('heart');
}

const sayInput = $('#say');
sayInput.addEventListener('keydown', (e) => {
  e.stopPropagation();
  if (e.key === 'Enter') {
    const text = sayInput.value.replace(/[\p{C}]/gu, '').trim().slice(0, 280);
    if (text) { say(me, text); link?.send({ t: 'chat', text }); }
    sayInput.value = '';
    sayInput.blur();
  } else if (e.key === 'Escape') sayInput.blur();
});

// ── voice ───────────────────────────────────────────────────────────────────────────

const levelOf = (analyser, buf) => {
  analyser.getByteTimeDomainData(buf);
  let sum = 0;
  for (const v of buf) sum += (v - 128) ** 2;
  return Math.min(1, Math.sqrt(sum / buf.length) / 30);
};

async function toggleVoice() {
  const btn = $('#voice');
  if (voice.stream) {
    voice.disable();
    micLevel = null;
    btn.classList.remove('on');
    btn.title = 'talk (V)';
    return;
  }
  try {
    const stream = await voice.enable();
    const a = music.ctx.createAnalyser();
    a.fftSize = 512;
    music.ctx.createMediaStreamSource(stream).connect(a);
    micLevel = { a, buf: new Uint8Array(a.fftSize) };
    btn.classList.add('on');
    btn.title = 'voice on (V)';
    toast(partner ? `${partner.name} can hear you` : 'your voice will reach them when they arrive');
  } catch {
    toast('the microphone needs permission, and https or localhost');
  }
}

// Their voice comes from where their light is.
function hearPartner(stream) {
  const ctx = music.ctx;
  const el = new Audio();
  el.srcObject = stream; // Chrome only feeds WebRTC audio into Web Audio while an element holds the stream
  el.muted = true;
  el.play().catch(() => {});
  const src = ctx.createMediaStreamSource(stream);
  panner = ctx.createPanner();
  Object.assign(panner, { panningModel: 'HRTF', distanceModel: 'inverse', refDistance: 7, rolloffFactor: 0.6, maxDistance: 500 });
  const gain = ctx.createGain();
  gain.gain.value = 1.4;
  src.connect(panner).connect(gain).connect(ctx.destination);
  const a = ctx.createAnalyser();
  a.fftSize = 512;
  src.connect(a);
  peerLevel = { a, buf: new Uint8Array(a.fftSize) };
}

const setParam = (node, names, values, legacy) => {
  if (node[names[0]]) names.forEach((n, i) => { node[n].value = values[i]; });
  else node[legacy]?.(...values);
};

// ── input ───────────────────────────────────────────────────────────────────────────

const keys = new Set();
const stick = { x: 0, y: 0 };
let vertical = 0;

addEventListener('keydown', (e) => {
  if (!started || e.target === sayInput) return;
  if (e.key === 'Enter') { e.preventDefault(); sayInput.focus(); return; }
  if (e.repeat) { keys.add(e.code); return; }
  keys.add(e.code);
  const r = REACTIONS.find((x) => x.key === e.key);
  if (r) react(r.k);
  else if (e.code === 'KeyH') toggleReach();
  else if (e.code === 'KeyF' && partner) autoFollow = true;
  else if (e.key === '?') showHint();
  else if (e.code === 'KeyV') toggleVoice();
  else if (e.code === 'Space') e.preventDefault();
});
addEventListener('keyup', (e) => keys.delete(e.code));
addEventListener('blur', () => keys.clear());

const canvas = $('#scene');
let drag = null;
canvas.addEventListener('pointerdown', (e) => {
  drag = { x: e.clientX, y: e.clientY, id: e.pointerId };
  canvas.setPointerCapture(e.pointerId);
  sayInput.blur();
});
canvas.addEventListener('pointermove', (e) => {
  if (!drag || e.pointerId !== drag.id || !started) return;
  me.yaw -= (e.clientX - drag.x) * 0.0045;
  me.pitch = Math.min(1.15, Math.max(-0.2, me.pitch + (e.clientY - drag.y) * 0.003));
  drag.x = e.clientX; drag.y = e.clientY;
});
const endDrag = () => { drag = null; };
canvas.addEventListener('pointerup', endDrag);
canvas.addEventListener('pointercancel', endDrag);
canvas.addEventListener('wheel', (e) => { me.dist = Math.min(24, Math.max(4.5, me.dist + e.deltaY * 0.01)); }, { passive: true });

// The thumb stick on phones.
const stickEl = $('#stick');
stickEl.addEventListener('pointerdown', (e) => {
  stickEl.setPointerCapture(e.pointerId);
  const move = (ev) => {
    const r = stickEl.getBoundingClientRect();
    let dx = ev.clientX - (r.left + r.width / 2), dy = ev.clientY - (r.top + r.height / 2);
    const len = Math.hypot(dx, dy), max = r.width / 2;
    if (len > max) { dx *= max / len; dy *= max / len; }
    stick.x = dx / max; stick.y = -dy / max;
    stickEl.firstElementChild.style.transform = `translate(${dx}px, ${dy}px)`;
  };
  const up = () => {
    stick.x = stick.y = 0;
    stickEl.firstElementChild.style.transform = '';
    stickEl.removeEventListener('pointermove', move);
    stickEl.removeEventListener('pointerup', up);
    stickEl.removeEventListener('pointercancel', up);
  };
  move(e);
  stickEl.addEventListener('pointermove', move);
  stickEl.addEventListener('pointerup', up);
  stickEl.addEventListener('pointercancel', up);
});
document.querySelectorAll('#updown button').forEach((b) => {
  b.addEventListener('pointerdown', () => { vertical = Number(b.dataset.v); });
  for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) b.addEventListener(ev, () => { vertical = 0; });
});

// ── the loop ────────────────────────────────────────────────────────────────────────

const v3 = new THREE.Vector3(), fwd = new THREE.Vector3(), right = new THREE.Vector3(), want = new THREE.Vector3();
const timer = new THREE.Clock();
let t = 0, plantClock = 0, hudClock = 0;

function snapCamera() {
  cameraTarget(v3);
  camera.position.copy(v3);
  camera.lookAt(me.pos.x, me.pos.y + 0.8, me.pos.z);
}

function cameraTarget(out) {
  const cp = Math.cos(me.pitch);
  const d = me.dist + (holding ? 2.5 : 0); // hand in hand, the camera eases back so both of you are in the frame
  out.set(me.pos.x + Math.sin(me.yaw) * cp * d, me.pos.y + 1.2 + Math.sin(me.pitch) * d, me.pos.z + Math.cos(me.yaw) * cp * d);
  out.y = Math.max(out.y, world.surfaceAt(out.x, out.z) + 0.8);
  return out;
}

function move(dt) {
  const k = (c) => (keys.has(c) ? 1 : 0);
  let ahead = k('KeyW') + k('ArrowUp') - k('KeyS') - k('ArrowDown') + stick.y;
  const side = k('KeyD') - k('KeyA') + stick.x;
  me.yaw += (k('KeyQ') + k('ArrowLeft') - k('KeyE') - k('ArrowRight')) * dt * 1.6;
  const up = k('Space') - k('ShiftLeft') - k('ShiftRight') + vertical;

  fwd.set(-Math.sin(me.yaw), 0, -Math.cos(me.yaw));
  right.set(Math.cos(me.yaw), 0, -Math.sin(me.yaw));

  if (Math.abs(ahead) + Math.abs(side) + Math.abs(up) > 0.1) autoFollow = false;
  if (autoFollow && partner) {
    v3.subVectors(partner.pos, me.pos);
    const d = v3.length();
    if (d < 5) autoFollow = false;
    else {
      const targetYaw = Math.atan2(-v3.x, -v3.z);
      let dy = targetYaw - me.yaw;
      dy = Math.atan2(Math.sin(dy), Math.cos(dy));
      me.yaw += dy * Math.min(1, dt * 2.5);
      ahead = 1;
    }
  }

  me.glide = ahead > 0.5 ? Math.min(1, me.glide + dt * 0.5) : Math.max(0, me.glide - dt);
  const speed = 10 + me.glide * 10 + (autoFollow ? 8 : 0);
  want.set(0, 0, 0).addScaledVector(fwd, ahead * speed).addScaledVector(right, side * speed * 0.8);
  want.y = up * 8;
  me.vel.lerp(want, 1 - Math.exp(-dt * 2.6));

  // Held hands pull gently, so you drift together instead of apart.
  if (holding && partner) {
    v3.subVectors(partner.pos, me.pos);
    const d = v3.length();
    if (d > 6) me.vel.addScaledVector(v3.normalize(), (d - 6) * 1.4 * dt);
  }

  me.pos.addScaledVector(me.vel, dt);
  const floor = world.surfaceAt(me.pos.x, me.pos.z) + 1.5;
  if (me.pos.y < floor) { me.pos.y = floor; me.vel.y = Math.max(0, me.vel.y); }
  else if (!up && !world.w.islands && me.pos.y > floor + 2) me.pos.y -= Math.min(me.pos.y - floor - 2, dt * 0.9); // a slow settle, like a leaf
  me.pos.y = Math.min(me.pos.y, 150);
  const r = Math.hypot(me.pos.x, me.pos.z);
  if (r > BOUND) me.pos.multiplyScalar(1 - ((r - BOUND) / r) * Math.min(1, dt * 3)); // the edge of the world is soft
}

function project(p, out) {
  v3.copy(p).project(camera);
  out.behind = v3.z > 1;
  out.x = (v3.x * 0.5 + 0.5) * innerWidth;
  out.y = (-v3.y * 0.5 + 0.5) * innerHeight;
  out.on = !out.behind && v3.x > -1 && v3.x < 1 && v3.y > -1 && v3.y < 1;
  return out;
}

const scr = {};
const above = new THREE.Vector3();
function overlay() {
  const now = performance.now();
  for (const who of [me, partner]) {
    const b = who?.bubble;
    if (!b) continue;
    if (now > b.until) { b.el.remove(); who.bubble = null; continue; }
    above.copy(who.wisp.group.position).y += 1.6;
    project(above, scr);
    b.el.style.opacity = scr.behind ? 0 : Math.min(1, (b.until - now) / 800);
    b.el.style.transform = `translate(${scr.x}px, ${scr.y}px) translate(-50%, -100%)`;
  }
  const seek = $('#seek');
  if (!partner || !partner.wisp.visible) { seek.hidden = true; return; }
  const d = me.pos.distanceTo(partner.pos);
  above.copy(partner.wisp.group.position).y += 1.1;
  project(above, scr);
  partner.el.style.opacity = scr.on && d < 180 ? 1 : 0;
  partner.el.style.transform = `translate(${scr.x}px, ${scr.y}px) translate(-50%, -100%)`;
  partner.el.classList.toggle('reaching', partner.reaching && !holding);

  seek.hidden = scr.on;
  if (!scr.on) {
    let dx = scr.x - innerWidth / 2, dy = scr.y - innerHeight / 2;
    if (scr.behind) { dx = -dx; dy = -dy; }
    const pad = 64, sx = (innerWidth / 2 - pad) / Math.abs(dx || 1e-3), sy = (innerHeight / 2 - pad - 40) / Math.abs(dy || 1e-3);
    const s = Math.min(sx, sy);
    seek.style.transform = `translate(${innerWidth / 2 + dx * s}px, ${innerHeight / 2 + dy * s}px) translate(-50%, -50%)`;
    seek.querySelector('.seek-arrow').style.transform = `rotate(${Math.atan2(dy, dx)}rad)`;
    seek.querySelector('.seek-name').textContent = `${partner.name} · ${Math.round(d)} m`;
    seek.style.setProperty('--c', COLORS[partner.color]);
  } else seek.classList.remove('calling');
}

function frame() {
  requestAnimationFrame(frame);
  const dt = Math.min(timer.getDelta(), 0.05);
  t += dt;
  energy += (music.energy() - energy) * 0.12;

  if (!started) {
    // The lobby: a slow orbit of the moon garden.
    const a = t * 0.035;
    camera.position.set(Math.cos(a) * 46, 0, Math.sin(a) * 46 + 10);
    camera.position.y = world.surfaceAt(camera.position.x, camera.position.z) + 9;
    camera.lookAt(0, world.surfaceAt(0, 0) + 7, -30);
    world.focus.copy(camera.position);
    world.render(dt, t, 0.15);
    return;
  }

  move(dt);
  me.wisp.pos.copy(me.pos);
  me.wisp.voice = micLevel ? levelOf(micLevel.a, micLevel.buf) : 0;
  me.wisp.reach = me.reaching && !holding ? 1 : 0;
  me.wisp.update(dt, t, energy, world.w.glow);
  world.setPlayer(0, me.pos, me.wisp.color, me.wisp.light.intensity);

  cameraTarget(want);
  camera.position.lerp(want, 1 - Math.exp(-dt * 5));
  camera.lookAt(me.pos.x, me.pos.y + 0.8, me.pos.z);
  world.focus.copy(me.pos);

  const dist = partner?.wisp.visible ? me.pos.distanceTo(partner.pos) : 0;
  if (partner) {
    if (partner.target) partner.pos.lerp(partner.target, 1 - Math.exp(-dt * 9));
    partner.wisp.pos.copy(partner.pos);
    partner.wisp.voice = peerLevel ? levelOf(peerLevel.a, peerLevel.buf) : 0;
    partner.wisp.reach = partner.reaching && !holding ? 1 : 0;
    partner.wisp.update(dt, t, energy, world.w.glow);
    world.setPlayer(1, partner.pos, partner.wisp.color, partner.wisp.light.intensity);
    if (panner) setParam(panner, ['positionX', 'positionY', 'positionZ'], [partner.pos.x, partner.pos.y, partner.pos.z], 'setPosition');
  }

  // How close you are colours everything: the music, the light, the thread.
  const want_k = partner?.wisp.visible ? 1 - smooth(NEAR, FAR, dist) : 1;
  closeness += (want_k - closeness) * Math.min(1, dt * 1.5);
  music.setCloseness(closeness, holding);
  world.setCloseness(closeness);
  document.documentElement.style.setProperty('--close', closeness.toFixed(3));

  // Two open hands, close enough, become one held hand. It stays held until either lets go.
  const both = me.reaching && partner?.reaching;
  if (both && (holding || dist < HOLD_RANGE)) {
    if (!holding) { holding = true; music.chime('hand'); toast(`hand in hand with ${partner.name}`); }
  } else if (holding) holding = false;
  document.body.classList.toggle('holding', holding);
  if (partner?.wisp.visible) world.setThread(me.wisp.group.position, partner.wisp.group.position, me.wisp.color, partner.wisp.color, closeness, holding, t, dt);
  else world.setThread(me.pos, null, me.wisp.color, me.wisp.color, 0, false, t, dt);

  // Flowers follow two people holding hands.
  plantClock += dt;
  if (holding && plantClock > 0.3) {
    plantClock = 0;
    for (const [p, c] of [[me.pos, me.color], [partner.pos, partner.color]]) {
      if (p.y - world.surfaceAt(p.x, p.z) < 7) world.plant(p.x + (Math.random() - 0.5) * 2, p.z + (Math.random() - 0.5) * 2, COLORS[c]);
    }
  }
  checkMeeting();

  // Let the music leave light in the air: scored notes when we have them, heard onsets otherwise.
  const now = music.ctx.currentTime;
  for (let k = 0; k < 6 && music.notes.length && music.notes[0].when <= now; k++) {
    const n = music.notes.shift();
    if (Math.random() < 0.55) world.mote(n.n, n.v);
  }
  if (music.notes.length > 400) music.notes.splice(0, music.notes.length - 400);
  if (music.song?.recorded) {
    const hit = music.onset();
    if (hit) for (let k = 0; k < 1 + Math.round(hit.v * 3); k++) world.mote(hit.n + k * 4, hit.v);
  }

  const L = music.ctx.listener;
  camera.getWorldDirection(v3);
  setParam(L, ['positionX', 'positionY', 'positionZ'], [camera.position.x, camera.position.y, camera.position.z], 'setPosition');
  setParam(L, ['forwardX', 'forwardY', 'forwardZ', 'upX', 'upY', 'upZ'], [v3.x, v3.y, v3.z, 0, 1, 0], 'setOrientation');

  sendState();
  world.render(dt, t, energy);
  overlay();
  hudClock += dt;
  if (hudClock > 0.25) {
    hudClock = 0;
    updatePresence();
    updateGoal();
    const { at, length } = music.progress();
    document.documentElement.style.setProperty('--song', length ? Math.min(1, at / length).toFixed(4) : '0');
  }
}
requestAnimationFrame(frame);
window.__duet = { world, music, me }; // for poking at from the console
