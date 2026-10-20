// Real recordings for four pieces. The Pas de deux has no free recording that I could find,
// so it is performed live from a score on sampled harp, cello and violin.
// Either way both people hear the same moment: playback starts against the shared server clock.

const PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
export const midi = (s) => {
  const m = /^([A-G])(#|b|s)?(-?\d)$/.exec(s);
  if (!m) throw new Error(`bad note ${s}`);
  return 12 * (Number(m[3]) + 1) + PC[m[1]] + (m[2] === '#' || m[2] === 's' ? 1 : m[2] === 'b' ? -1 : 0);
};
const ns = (str) => str.trim().split(/\s+/).map(midi);

const rng = (seed) => () => {
  seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

class Score {
  constructor(bpm, seed = 1) { this.spb = 60 / bpm; this.events = []; this.r = rng(seed); }
  note(beat, n, dur, vel = 0.5, inst = 'harp') {
    const v = Math.max(0.05, Math.min(1, vel + (this.r() - 0.5) * 0.05));
    this.events.push({ t: beat * this.spb + (this.r() - 0.5) * 0.012, n, d: dur * this.spb, v, i: inst });
  }
  chord(beat, notes, dur, vel, inst, roll = 0) { notes.forEach((n, k) => this.note(beat + k * roll, n, dur, vel, inst)); }
  line(beat, spec, vel, inst, shift = 0) {
    let b = beat;
    for (const tok of spec.trim().split(/\s+/)) {
      const [p, d = '1'] = tok.split(':');
      const dur = Number(d);
      if (p !== 'r') p.split('+').forEach((q) => this.note(b, midi(q) + shift, dur * 1.02, vel, inst));
      b += dur;
    }
    return b;
  }
  done() {
    this.events.sort((a, b) => a.t - b.t);
    return { events: this.events, length: this.events.reduce((m, e) => Math.max(m, e.t + e.d), 0) };
  }
}

// ── Tchaikovsky, Pas de deux (The Nutcracker, Act II) — arranged for harp, cello and violins ──
function pasDeDeux() {
  const s = new Score(44, 1892);
  const C = {
    G: 'G2 D3 G3 B3 D4', DF: 'F#2 D3 A3 D4 F#4', Em: 'E2 B2 E3 G3 B3', BmD: 'D2 B2 D3 F#3 B3',
    Cm: 'C3 G3 C4 E4 G4', GB: 'B1 G2 B2 D3 G3', Am: 'A2 E3 A3 C4 E4', D7: 'D2 A2 C3 D3 F#3',
    GD: 'D2 G2 B2 D3 G3', CE: 'E2 G2 C3 E3 G3', EmG: 'G2 B2 E3 G3 B3',
  };
  const fall = ['G', 'DF', 'Em', 'BmD', 'Cm', 'GB', 'Am', 'G'];
  const fallHalf = ['G', 'DF', 'Em', 'BmD', 'Cm', 'GB', 'Am', 'D7'];
  const rise = ['G', 'Cm', 'GD', 'CE', 'DF', 'EmG', 'DF', 'G'];
  const scale = 'G5:1.5 F#5:.5 E5:1 D5:1 C5:1 B4:1 A4:1 G4:1';
  const scaleHalf = 'G5:1.5 F#5:.5 E5:1 D5:1 C5:1 B4:1 A4:1.5 D5:.5';
  const up = 'B4 C5 D5 E5 F#5 G5 A5 B5';

  // The harp rolls each chord in sextuplets, the way it does under the real cello line.
  const harp = (beat, names, vel) => names.forEach((name, k) => {
    const n = ns(C[name]);
    [0, 1, 2, 3, 4, 3].forEach((idx, j) => s.note(beat + k + j / 6, n[idx] + (j ? 12 : 0), 1.4, vel * (j ? 0.85 : 1.1), 'harp'));
  });
  const bass = (beat, names, vel) => names.forEach((name, k) => s.note(beat + k, ns(C[name])[0] + (ns(C[name])[0] < 36 ? 12 : 0), 1.05, vel, 'cello'));

  const phrases = [
    { m: scale, h: fall, mel: [['cello', -24, 0.62]] },
    { m: scaleHalf, h: fallHalf, mel: [['cello', -24, 0.62]] },
    { m: scale, h: fall, mel: [['cello', -24, 0.66], ['violin', -12, 0.38]], b: 0.32 },
    { m: scaleHalf, h: fallHalf, mel: [['cello', -24, 0.66], ['violin', -12, 0.42]], b: 0.32 },
    { m: up, h: rise, mel: [['violin', 0, 0.5], ['cello', -24, 0.5]], b: 0.36 },
    { m: up.replace('B5', 'A5:1.5 D6:.5'), h: rise, mel: [['violin', 0, 0.56], ['cello', -24, 0.56]], b: 0.4 },
    { m: scale, h: fall, mel: [['violin', 12, 0.66], ['violin', 0, 0.5], ['cello', -12, 0.6]], b: 0.48 },
    { m: scaleHalf, h: fallHalf, mel: [['violin', 12, 0.66], ['violin', 0, 0.5], ['cello', -12, 0.6]], b: 0.48 },
    { m: scale, h: fall, mel: [['violin', 0, 0.42], ['cello', -24, 0.5]], b: 0.3 },
    { m: 'G5:2 F#5:1 E5:1 D5:1.5 C5:.5 B4:1 G4:1', h: fall, mel: [['cello', -24, 0.5]] },
  ];
  phrases.forEach((p, k) => {
    const b = k * 8;
    harp(b, p.h, 0.42);
    for (const [inst, shift, vel] of p.mel) s.line(b, p.m, vel, inst, shift);
    if (p.b) bass(b, p.h, p.b);
  });
  const end = phrases.length * 8;
  s.chord(end, ns('G1 G2 D3 G3 B3 D4 G4 B4 D5 G5'), 6, 0.5, 'harp', 0.11);
  s.chord(end, ns('G2 D3 B3'), 6, 0.4, 'cello');
  s.chord(end + 0.5, ns('G4 B4 D5'), 5.5, 0.3, 'violin');
  return s.done();
}

export const PIECES = {
  prelude: {
    title: 'Prelude in C major', opus: 'BWV 846', composer: 'Johann Sebastian Bach', key: 60,
    src: 'music/prelude.m4a', credit: 'Kimiko Ishizaka, Open Well-Tempered Clavier (CC0)',
  },
  canon: {
    title: 'Canon in D', opus: '', composer: 'Johann Pachelbel', key: 62,
    src: 'music/canon.m4a', credit: 'Kevin MacLeod, incompetech.com (CC BY 3.0)',
  },
  clair: {
    title: 'Clair de lune', opus: 'Suite bergamasque', composer: 'Claude Debussy', key: 61,
    src: 'music/clair.m4a', credit: 'Laurens Goedhart, piano (public domain)',
  },
  pasdedeux: {
    title: 'Pas de deux', opus: 'The Nutcracker', composer: 'Pyotr Ilyich Tchaikovsky', key: 67,
    build: pasDeDeux, credit: 'arranged for sampled harp, cello and violin (samples: nbrosowsky/tonejs-instruments, CC BY 3.0)',
  },
  air: {
    title: 'Air', opus: 'Orchestral Suite No. 3, BWV 1068', composer: 'Johann Sebastian Bach', key: 62,
    src: 'music/air.m4a', credit: 'The Air Force Strings, U.S. Air Force Band (public domain)',
  },
};

// ── instruments ────────────────────────────────────────────────────────────────────

const SAMPLES = {
  harp: 'E1 G1 B1 D2 F2 A2 C3 E3 G3 B3 D4 F4 A4 C5 E5 G5 B5 D6 F6 A6 D7',
  cello: 'C2 E2 G2 As2 Cs3 E3 G3 As3 Cs4 E4 G4 B4',
  violin: 'G3 A3 C4 E4 G4 A4 C5 E5 G5 A5 C6 E6 G6 A6 C7',
};

const impulse = (ctx, seconds, decay) => {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len) ** decay;
  }
  return buf;
};

const hz = (n) => 440 * 2 ** ((n - 69) / 12);

export class Music {
  ctx = null;
  song = null;
  live = new Set();
  notes = [];          // upcoming notes (scored piece) for the world to bloom with
  buffers = new Map(); // recordings, decoded once
  samples = {};        // instrument → [{n, buf}]
  onEnd = null;
  #flux = { prev: null, avg: 0 };

  async init() {
    if (this.ctx) return this.ctx.resume();
    const ctx = this.ctx = new AudioContext({ latencyHint: 'playback' });
    this.out = ctx.createGain();
    this.out.gain.value = 0.9;

    // Closeness: apart, the music sounds as if from another room; together, it opens up.
    this.near = ctx.createBiquadFilter();
    this.near.type = 'lowpass';
    this.near.frequency.value = 20000;
    this.near.Q.value = 0.4;
    this.nearGain = ctx.createGain();

    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 1024;
    this.analyser.smoothingTimeConstant = 0.6;
    this.freq = new Uint8Array(this.analyser.frequencyBinCount);

    this.input = ctx.createGain();       // scored instruments and chimes
    this.dry = ctx.createGain(); this.dry.gain.value = 0.85;
    this.reverb = ctx.createConvolver(); this.reverb.buffer = impulse(ctx, 4.2, 2.6);
    this.wet = ctx.createGain(); this.wet.gain.value = 0.3;
    this.input.connect(this.dry).connect(this.near);
    this.input.connect(this.reverb).connect(this.wet).connect(this.near);

    this.rec = ctx.createGain();         // recordings skip the synthetic room; they have their own
    this.rec.connect(this.near);

    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.ratio.value = 2.5; comp.attack.value = 0.02; comp.release.value = 0.3;
    this.near.connect(this.nearGain).connect(comp).connect(this.out).connect(ctx.destination);
    this.nearGain.connect(this.analyser);

    this.#wind();
    this.#loadSamples();
    setInterval(() => this.#schedule(), 90);
  }

  async #fetchBuffer(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${url}: ${res.status}`);
    return this.ctx.decodeAudioData(await res.arrayBuffer());
  }

  async #loadSamples() {
    await Promise.all(Object.entries(SAMPLES).map(async ([inst, list]) => {
      const got = await Promise.all(list.split(' ').map(async (name) => {
        try { return { n: midi(name), buf: await this.#fetchBuffer(`samples/${inst}/${name}.m4a`) }; } catch { return null; }
      }));
      this.samples[inst] = got.filter(Boolean);
    }));
  }

  /** Fetch and decode a recording ahead of time, so the next world starts on cue. */
  preload(id) {
    const p = PIECES[id];
    if (!p?.src || this.buffers.has(id)) return this.buffers.get(id);
    const job = this.#fetchBuffer(p.src).catch((err) => { this.buffers.delete(id); throw err; });
    this.buffers.set(id, job);
    return job;
  }

  #wind() {
    const ctx = this.ctx;
    const buf = ctx.createBuffer(1, ctx.sampleRate * 3, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < d.length; i++) { last = last * 0.985 + (Math.random() * 2 - 1) * 0.015; d[i] = last * 6; } // brown-ish noise
    const src = ctx.createBufferSource(); src.buffer = buf; src.loop = true;
    const band = ctx.createBiquadFilter(); band.type = 'bandpass'; band.frequency.value = 420; band.Q.value = 0.5;
    this.windGain = ctx.createGain(); this.windGain.gain.value = 0;
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.06;
    const depth = ctx.createGain(); depth.gain.value = 180;
    lfo.connect(depth).connect(band.frequency);
    src.connect(band).connect(this.windGain).connect(this.out);
    src.start(); lfo.start();
  }

  setWind(level) { this.windGain?.gain.setTargetAtTime(level * 0.1, this.ctx.currentTime, 2); }
  setVolume(v) { this.out?.gain.setTargetAtTime(v, this.ctx.currentTime, 0.1); }

  /** 0 = far apart, 1 = side by side. Held hands add a little more room to the sound. */
  setCloseness(k, holding) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.near.frequency.setTargetAtTime(900 * 22 ** k, t, 0.6);   // 900 Hz apart → ~20 kHz together
    this.nearGain.gain.setTargetAtTime(0.62 + 0.38 * k, t, 0.6);
    this.wet.gain.setTargetAtTime(0.3 + (holding ? 0.2 : 0), t, 1.5);
  }

  /** Overall loudness, 0..1. */
  energy() {
    if (!this.analyser) return 0;
    this.analyser.getByteFrequencyData(this.freq);
    let sum = 0;
    for (let i = 2; i < 80; i++) sum += this.freq[i];
    return Math.min(1, sum / (78 * 140));
  }

  /** A new note just sounded? Spectral flux over the last frame; returns the strongest bin's pitch. */
  onset() {
    if (!this.analyser) return null;
    const f = this.freq; // filled by energy() this frame
    const prev = this.#flux.prev ?? new Uint8Array(f.length);
    let flux = 0, top = 0, topBin = 0;
    for (let i = 3; i < 200; i++) {
      const d = f[i] - prev[i];
      if (d > 0) flux += d;
      if (f[i] > top) { top = f[i]; topBin = i; }
    }
    this.#flux.prev = f.slice();
    const avg = this.#flux.avg = this.#flux.avg * 0.92 + flux * 0.08;
    if (flux < avg * 1.6 || flux < 120) return null;
    const freqHz = (topBin * this.ctx.sampleRate) / this.analyser.fftSize;
    return { n: Math.round(69 + 12 * Math.log2(Math.max(freqHz, 30) / 440)), v: Math.min(1, flux / 900) };
  }

  /** Start piece `id` so that its first note falls at server time `start`. */
  async play(id, start, clock) {
    this.stop(1.4);
    const piece = PIECES[id];
    const token = Symbol(id);
    this.token = token;
    if (piece.src) {
      let buf;
      try { buf = await this.preload(id); } catch (err) { console.warn('recording unavailable', err); return; }
      if (this.token !== token) return; // another world was chosen while this one loaded
      const ctx = this.ctx;
      const delay = (start - clock.now()) / 1000;
      const src = ctx.createBufferSource();
      src.buffer = buf;
      const g = ctx.createGain();
      g.gain.value = 0;
      src.connect(g).connect(this.rec);
      const when = ctx.currentTime + Math.max(0, delay);
      const offset = Math.max(0, -delay);
      if (offset >= buf.duration - 1) { this.onEnd?.(id); return; }
      g.gain.setTargetAtTime(1, when, offset > 0 ? 0.6 : 0.02); // joining late fades in rather than jolts
      src.start(when, offset);
      const v = { release: (t, fade) => { g.gain.cancelScheduledValues(t); g.gain.setTargetAtTime(0, t, fade / 4); try { src.stop(t + fade); } catch {} } };
      this.live.add(v);
      this.song = { id, piece, start, clock, recorded: true, anchor: when - offset, length: buf.duration, ended: false };
      src.onended = () => {
        this.live.delete(v);
        if (this.song?.id === id && this.token === token && !this.song.ended) { this.song.ended = true; this.onEnd?.(id); }
      };
      return;
    }
    piece.cache ??= piece.build();
    this.song = { id, piece, ...piece.cache, start, clock, idx: 0, ended: false, anchor: this.ctx.currentTime + (start - clock.now()) / 1000, checked: 0 };
  }

  stop(fade = 1) {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    for (const v of this.live) v.release(now, fade);
    this.live.clear();
    this.song = null;
    this.notes.length = 0;
  }

  /** Seconds into the current piece, and its length. */
  progress() {
    if (!this.song) return { at: 0, length: 0 };
    return { at: Math.max(0, this.ctx.currentTime - this.song.anchor), length: this.song.length };
  }

  #schedule() {
    const song = this.song;
    if (!song || song.recorded || !this.ctx) return;
    const now = this.ctx.currentTime;
    if (now - song.checked > 5) {
      song.checked = now;
      const fresh = this.ctx.currentTime + (song.start - song.clock.now()) / 1000;
      if (Math.abs(fresh - song.anchor) > 0.06) song.anchor = fresh;
    }
    const horizon = now + 1.2; // generous, so a throttled background tab keeps playing
    const ev = song.events;
    while (song.idx < ev.length && song.anchor + ev[song.idx].t < horizon) {
      const e = ev[song.idx++];
      const when = song.anchor + e.t;
      if (when < now - 0.03) continue;
      this.#voice(e, Math.max(when, now));
      this.notes.push({ when: Math.max(when, now), n: e.n, v: e.v });
    }
    if (!song.ended && song.idx >= ev.length && now > song.anchor + song.length + 2.5) {
      song.ended = true;
      this.onEnd?.(song.id);
    }
  }

  #voice(e, when) {
    const set = this.samples[e.i];
    if (!set?.length) return this.#fallback(e, when);
    const ctx = this.ctx;
    const s = set.reduce((a, b) => (Math.abs(b.n - e.n) < Math.abs(a.n - e.n) ? b : a));
    const src = ctx.createBufferSource();
    src.buffer = s.buf;
    src.playbackRate.value = 2 ** ((e.n - s.n) / 12);
    const g = ctx.createGain();
    const bowed = e.i !== 'harp';
    const peak = e.v ** 1.3 * (bowed ? 0.75 : 0.85);
    g.gain.setValueAtTime(0, when);
    g.gain.linearRampToValueAtTime(peak, when + (bowed ? 0.12 : 0.005));
    const off = when + Math.max(e.d, 0.2);
    g.gain.setTargetAtTime(0, off, bowed ? 0.25 : 0.6);
    src.connect(g).connect(this.input);
    src.start(when);
    src.stop(off + 3);
    const v = { release: (t, fade) => { g.gain.cancelScheduledValues(t); g.gain.setTargetAtTime(0, t, fade / 4); try { src.stop(t + fade); } catch {} } };
    this.live.add(v);
    src.onended = () => { g.disconnect(); this.live.delete(v); };
  }

  // Until the samples arrive (or if they can't), a soft plucked tone stands in.
  #fallback(e, when) {
    const ctx = this.ctx;
    const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = hz(e.n);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, when);
    g.gain.linearRampToValueAtTime(e.v * 0.25, when + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, when + Math.max(e.d, 0.4) + 0.8);
    o.connect(g).connect(this.input);
    o.start(when); o.stop(when + e.d + 1);
  }

  /** A small bell for reactions, in the key of whatever is playing. */
  chime(kind) {
    if (!this.ctx) return;
    const root = (this.song?.piece.key ?? 62) + 24;
    const shapes = { heart: [0, 7], spark: [12, 16, 19], wave: [0, 4, 7], bloom: [0, 4, 7, 12, 16], wish: [12, 7, 4, 0, -5], beacon: [0, 12], hello: [7, 12], hand: [0, 4, 7, 11, 14], moment: [0, 7, 12, 16, 19, 24] };
    const now = this.ctx.currentTime;
    (shapes[kind] ?? [0]).forEach((iv, k) => {
      const t = now + k * (kind === 'wish' || kind === 'moment' ? 0.13 : 0.08);
      const f = hz(root + iv);
      [1, 2.76, 5.4].forEach((mult, p) => {
        const o = this.ctx.createOscillator(); o.frequency.value = f * mult;
        const g = this.ctx.createGain();
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(0.04 / (p + 1), t + 0.004);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 2.4 / (p + 1));
        o.connect(g).connect(this.input);
        o.start(t); o.stop(t + 2.5);
      });
    });
  }
}
