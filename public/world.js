import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { Water } from 'three/addons/objects/Water.js';
import { Tree } from '@dgreenheck/ez-tree';

export const TERRAIN_SIZE = 900;
export const BOUND = 330;
const SEGMENTS = 256;
const RES = SEGMENTS + 1;
const FLOWER_EXTRA = 2500; // room for the flowers you plant together
const QUALITY = new URLSearchParams(location.search).get('q') === 'low' ? 0.45 : 1;
const GRASS_TILE = 100;
const GRASS_BLADES = Math.round(200_000 * QUALITY);

const col = (c) => new THREE.Color(c);
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

export const rng = (seed) => () => {
  seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

// 2D simplex noise (after Stefan Gustavson), seeded so both people walk the same hills.
function simplex(seed) {
  const r = rng(seed);
  const p = Array.from({ length: 256 }, (_, i) => i);
  for (let i = 255; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [p[i], p[j]] = [p[j], p[i]]; }
  const perm = new Uint8Array(512).map((_, i) => p[i & 255]);
  const G = [[1, 1], [-1, 1], [1, -1], [-1, -1], [1, 0], [-1, 0], [0, 1], [0, -1]];
  const F2 = 0.5 * (Math.sqrt(3) - 1), G2 = (3 - Math.sqrt(3)) / 6;
  const corner = (x, y, gi) => {
    let t = 0.5 - x * x - y * y;
    if (t < 0) return 0;
    t *= t;
    const g = G[gi & 7];
    return t * t * (g[0] * x + g[1] * y);
  };
  return (x, y) => {
    const s = (x + y) * F2;
    const i = Math.floor(x + s), j = Math.floor(y + s);
    const t = (i + j) * G2;
    const x0 = x - (i - t), y0 = y - (j - t);
    const [i1, j1] = x0 > y0 ? [1, 0] : [0, 1];
    const x1 = x0 - i1 + G2, y1 = y0 - j1 + G2, x2 = x0 - 1 + 2 * G2, y2 = y0 - 1 + 2 * G2;
    const ii = i & 255, jj = j & 255;
    return 70 * (corner(x0, y0, perm[ii + perm[jj]]) + corner(x1, y1, perm[ii + i1 + perm[jj + j1]]) + corner(x2, y2, perm[ii + 1 + perm[jj + 1]]));
  };
}

export function heightField(w) {
  const n = simplex(w.seed);
  const t = w.terrain;
  const natural = (x, z) => {
    let h = 0, a = 1, f = t.freq, sum = 0;
    for (let o = 0; o < 6; o++) { h += a * n(x * f, z * f); sum += a; a *= 0.5; f *= 2.03; } // O(octaves) per sample
    let y = (h / sum) * t.amp + t.base;
    const r2 = x * x + z * z;
    y += t.hill * Math.exp(-r2 / 900); // a soft rise where you both arrive, always dry land
    if (t.lake) {
      const [lx, lz, lr, depth] = t.lake;
      const d = Math.hypot(x - lx, z - lz) / lr;
      y -= depth * (1 - smooth(0.2, 1.4, d));
    }
    y += Math.max(0, Math.sqrt(r2) - 270) * 0.4 * t.rim; // far hills close the world like a bowl
    return y;
  };
  // The meeting place sits on a gentle rise of dry ground, so it can be seen and reached.
  const L = w.landmark;
  if (!['oak', 'gate'].includes(L?.kind)) return natural;
  const [lx, lz] = L.pos;
  const top = Math.max(natural(lx, lz), (w.water?.level ?? -99) + 3) + 1.5;
  return (x, z) => {
    const y = natural(x, z);
    const k = 1 - smooth(L.radius * 0.6, L.radius * 3, Math.hypot(x - lx, z - lz));
    return y + (top - y) * k;
  };
}

// ── textures ────────────────────────────────────────────────────────────────────────

const canvasTex = (draw, size = 128) => {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  draw(c.getContext('2d'), size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
};

export const glowTex = canvasTex((g, s) => {
  const r = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(0.2, 'rgba(255,255,255,0.6)');
  r.addColorStop(0.5, 'rgba(255,255,255,0.15)'); r.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = r; g.fillRect(0, 0, s, s);
});

const heartTex = canvasTex((g, s) => {
  g.translate(s / 2, s / 2 + s * 0.04);
  g.scale(s / 46, s / 46);
  g.shadowColor = 'white'; g.shadowBlur = 6;
  g.fillStyle = 'white';
  g.beginPath();
  g.moveTo(0, 11);
  g.bezierCurveTo(-19, -1, -11, -19, 0, -8);
  g.bezierCurveTo(11, -19, 19, -1, 0, 11);
  g.fill();
});

const sparkTex = canvasTex((g, s) => {
  const c = s / 2;
  const r = g.createRadialGradient(c, c, 0, c, c, c);
  r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(0.15, 'rgba(255,255,255,0.5)'); r.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = r; g.fillRect(0, 0, s, s);
  g.fillStyle = 'white';
  for (const [w, h] of [[s * 0.05, s * 0.48], [s * 0.48, s * 0.05]]) {
    g.beginPath(); g.moveTo(c, c - h); g.lineTo(c + w, c); g.lineTo(c, c + h); g.lineTo(c - w, c); g.closePath(); g.fill();
  }
});

const lanternTex = canvasTex((g, s) => {
  const r = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  r.addColorStop(0, 'rgba(255,220,170,.9)'); r.addColorStop(0.4, 'rgba(255,170,90,.25)'); r.addColorStop(1, 'rgba(255,140,60,0)');
  g.fillStyle = r; g.fillRect(0, 0, s, s);
  g.fillStyle = 'rgba(255,236,200,1)';
  g.beginPath(); g.roundRect(s * 0.38, s * 0.3, s * 0.24, s * 0.36, s * 0.06); g.fill();
});

const flowerTex = canvasTex((g, s) => {
  g.translate(s / 2, s / 2);
  g.fillStyle = 'white';
  for (let i = 0; i < 5; i++) {
    g.rotate((Math.PI * 2) / 5);
    g.beginPath(); g.ellipse(0, -s * 0.2, s * 0.13, s * 0.22, 0, 0, Math.PI * 2); g.fill();
  }
  g.fillStyle = '#ffe9a8';
  g.beginPath(); g.arc(0, 0, s * 0.1, 0, Math.PI * 2); g.fill();
}, 64);

const puffTex = canvasTex((g, s) => {
  const r = rng(77);
  for (let i = 0; i < 26; i++) {
    const x = s * (0.25 + r() * 0.5), y = s * (0.3 + r() * 0.45), rad = s * (0.1 + r() * 0.2);
    const gr = g.createRadialGradient(x, y, 0, x, y, rad);
    gr.addColorStop(0, 'rgba(255,255,255,0.5)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, s, s);
  }
}, 256);

const loader = new THREE.TextureLoader();
const avgColor = (img) => {
  const c = document.createElement('canvas');
  c.width = c.height = 8;
  const g = c.getContext('2d');
  g.drawImage(img, 0, 0, 8, 8);
  const d = g.getImageData(0, 0, 8, 8).data;
  const sum = [0, 0, 0];
  for (let i = 0; i < d.length; i += 4) for (let k = 0; k < 3; k++) sum[k] += d[i + k];
  return new THREE.Color().setRGB(sum[0] / 64 / 255, sum[1] / 64 / 255, sum[2] / 64 / 255, THREE.SRGBColorSpace);
};
// Poly Haven textures (CC0). The average colour is measured so each world can tint them freely.
function groundTexture(name, renderer, avgUniform) {
  const prep = (t, srgb) => {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    return t;
  };
  const diff = prep(loader.load(`textures/${name}_diff.jpg`, (t) => { avgUniform.value.copy(avgColor(t.image)); }), true);
  const nor = prep(loader.load(`textures/${name}_nor_gl.jpg`), false);
  return { diff, nor };
}

// ── shaders ─────────────────────────────────────────────────────────────────────────

const NOISE_GLSL = /* glsl */`
float h21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h21(i), h21(i + vec2(1, 0)), f.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), f.x), f.y);
}
float fbm(vec2 p) { float s = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { s += a * vnoise(p); p = p * 2.03 + vec2(1.7, 9.2); a *= 0.5; } return s; }`;

const SKY_VERT = /* glsl */`
varying vec3 vDir;
void main() { vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;

const SKY_FRAG = /* glsl */`
uniform vec3 top, horizon, fogColor, sunColor, sunDir, cloudLit, cloudShade;
uniform float sunSize, stars, time, aurora, clouds, sunBoost;
varying vec3 vDir;
${NOISE_GLSL}
float hash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
void main() {
  vec3 d = normalize(vDir);
  float h = d.y;
  vec3 sd3 = normalize(sunDir);
  float sd = max(dot(d, sd3), 0.0);
  vec3 col = mix(horizon, top, pow(smoothstep(0.0, 1.0, max(h, 0.0)), 0.5));
  col += sunColor * (pow(sd, 6.0) * (0.3 + sunBoost) + pow(sd, 60.0) * 0.5);
  col = mix(fogColor, col, smoothstep(-0.03, 0.14, h)); // melt into the fog so land and sky meet without a seam

  if (stars > 0.0) {
    vec3 sp = d * 300.0;
    float s = hash(floor(sp));
    float dot_ = smoothstep(0.42, 0.0, length(fract(sp) - 0.5));
    float tw = 0.55 + 0.45 * sin(time * (1.0 + s * 3.0) + s * 60.0);
    col += stars * step(0.9965, s) * dot_ * tw * smoothstep(0.02, 0.3, h) * vec3(1.8);
    vec3 mw = normalize(vec3(0.35, 0.55, 0.75));
    float band = exp(-pow(dot(d, mw) / 0.17, 2.0));
    col += stars * band * (0.025 + 0.09 * fbm(d.xz * 9.0 + d.y * 4.0)) * vec3(0.55, 0.6, 1.0) * smoothstep(0.0, 0.25, h);
  }

  float disc = smoothstep(1.0 - sunSize, 1.0 - sunSize * 0.55, sd);
  vec3 face = sunColor * 2.4;
  if (stars > 0.5) face *= 0.8 + 0.2 * fbm((d.xy - sd3.xy) * 90.0); // a moon has a face
  col = mix(col, face, disc);

  if (clouds > 0.0 && h > 0.0) {
    vec2 cuv = d.xz / (h + 0.09) * 0.8 + vec2(time * 0.006, time * 0.002);
    float c = fbm(cuv * 1.4);
    float cover = smoothstep(1.02 - clouds, 1.25 - clouds * 0.7, c + 0.25) * smoothstep(0.0, 0.14, h);
    float lit = clamp((c - fbm(cuv * 1.4 - sd3.xz * 0.18)) * 3.0 + 0.55, 0.0, 1.0); // a crude self-shadow toward the sun
    vec3 cc = mix(cloudShade, cloudLit, lit);
    cc += sunColor * pow(sd, 10.0) * 0.9;
    col = mix(col, cc, cover * 0.9);
  }

  if (aurora > 0.0) {
    float a = 0.0;
    for (int i = 0; i < 4; i++) {
      float fi = float(i);
      float band = 0.22 + 0.06 * fi + 0.05 * sin(d.x * 2.6 + time * 0.12 + fi * 1.7) + 0.035 * sin(d.z * 4.3 - time * 0.17);
      float curtain = 0.5 + 0.5 * sin(d.x * 18.0 + d.z * 9.0 + time * 0.5 + fi * 2.1 + fbm(d.xz * 4.0 + time * 0.05) * 6.0);
      a += smoothstep(0.08, 0.0, abs(h - band)) * curtain * smoothstep(band + 0.12, band - 0.02, h + 0.04);
    }
    col += aurora * a * mix(vec3(0.15, 1.0, 0.55), vec3(0.6, 0.3, 1.0), smoothstep(0.22, 0.46, h)) * 0.5;
  }
  gl_FragColor = vec4(col, 1.0);
}`;

const TERRAIN_HEAD = /* glsl */`
uniform sampler2D tGrass, tGrassN, tRock, tRockN, tSand, tSnow, tSnowN;
uniform vec3 uGrass, uRock, uSand, uSnow, aGrass, aRock, aSand, aSnow;
uniform float uSnowLine, uWater;
varying vec3 vWPos;
varying vec3 vWNormal;
${NOISE_GLSL}
float wRock, wSand, wSnow;
vec2 p1;`;

// Splat four photographed ground textures by slope, height and noise, then tint them to the world.
const TERRAIN_SPLAT = /* glsl */`
vec3 wn = normalize(vWNormal);
float slope = 1.0 - wn.y;
float mac = vnoise(vWPos.xz * 0.018) * 0.6 + vnoise(vWPos.xz * 0.1) * 0.4;
p1 = vWPos.xz / 15.0;
vec3 g = mix(texture2D(tGrass, p1).rgb, texture2D(tGrass, vWPos.xz / 53.0 + 0.37).rgb, mac) / aGrass;
vec3 r = mix(texture2D(tRock, vWPos.xz / 10.0).rgb, texture2D(tRock, vWPos.xz / 34.0 + 0.3).rgb, 0.5) / aRock;
vec3 sa = texture2D(tSand, vWPos.xz / 12.0).rgb / aSand;
vec3 sn = texture2D(tSnow, vWPos.xz / 8.0).rgb / aSnow;
wRock = smoothstep(0.2, 0.42, slope + (mac - 0.5) * 0.18);
wSand = 1.0 - smoothstep(uWater + 0.3, uWater + 1.9, vWPos.y + (mac - 0.5) * 1.4);
wSnow = smoothstep(uSnowLine - 4.0, uSnowLine + 2.0, vWPos.y + (mac - 0.5) * 6.0);
vec3 c = g * uGrass;
c = mix(c, r * uRock, wRock);
c = mix(c, sa * uSand, wSand);
c = mix(c, sn * uSnow, wSnow * (1.0 - wRock * 0.6));
c *= 0.82 + 0.36 * mac;
diffuseColor.rgb *= c;`;

const TERRAIN_NORMAL = /* glsl */`
vec3 tn = texture2D(tGrassN, p1).xyz * 2.0 - 1.0;
tn = mix(tn, texture2D(tRockN, vWPos.xz / 10.0).xyz * 2.0 - 1.0, wRock);
tn = mix(tn, texture2D(tSnowN, vWPos.xz / 8.0).xyz * 2.0 - 1.0, wSnow);
vec3 pw = normalize(normalize(vWNormal) + vec3(tn.x, 0.0, -tn.y) * 0.55);
normal = normalize((viewMatrix * vec4(pw, 0.0)).xyz);`;

// Grass: every blade is drawn on the GPU around the camera, sits on the terrain via a height texture,
// sways in the wind, and parts around the two of you.
const GRASS_VERT = /* glsl */`
uniform sampler2D uHeight;
uniform float uTime, uTile, uSize, uRes, uBlade, uWidth;
uniform vec3 uCenter, uP0, uP1;
uniform vec2 uWind;
attribute vec4 aSeed;
varying float vY, vRnd;
varying vec3 vWorld, vN;
vec4 terrainAt(vec2 xz) {
  vec2 g = clamp((xz / uSize + 0.5) * (uRes - 1.0), vec2(0.0), vec2(uRes - 1.001));
  ivec2 i = ivec2(floor(g));
  vec2 f = fract(g);
  ivec2 j = min(i + 1, ivec2(int(uRes) - 1));
  vec4 a = texelFetch(uHeight, i, 0), b = texelFetch(uHeight, ivec2(j.x, i.y), 0);
  vec4 c = texelFetch(uHeight, ivec2(i.x, j.y), 0), d = texelFetch(uHeight, j, 0);
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
vec2 part(vec2 xz, vec3 p, float ground) {
  vec2 dv = xz - p.xz;
  float near = (1.0 - smoothstep(0.0, 3.0, length(dv))) * (1.0 - smoothstep(1.5, 5.0, p.y - ground));
  return normalize(dv + 1e-4) * near * 1.8;
}
void main() {
  vec2 xz = mod(aSeed.xy * uTile - uCenter.xz + uTile * 0.5, uTile) - uTile * 0.5 + uCenter.xz;
  vec4 T = terrainAt(xz);
  float d = length(xz - uCenter.xz);
  float keep = step(fract(aSeed.w * 3.7), T.g) * smoothstep(uTile * 0.5, uTile * 0.3, d);
  float h = (0.55 + 0.9 * fract(aSeed.w * 7.13)) * uBlade * keep;
  float ang = aSeed.z * 6.2831;
  vec2 side = vec2(cos(ang), sin(ang));
  float y = position.y;
  float gust = sin(xz.x * 0.05 + uTime * 1.1) * 0.5 + sin(xz.y * 0.08 + uTime * 0.8 + 1.7) * 0.5 + sin((xz.x + xz.y) * 0.23 + uTime * 2.6) * 0.22;
  vec2 bend = uWind * (0.4 + 0.6 * gust) + part(xz, uP0, T.r) + part(xz, uP1, T.r);
  float k = y * y;
  vec3 p = vec3(xz.x, T.r - 0.05, xz.y);
  p.xz += side * position.x * uWidth * (1.0 - y * 0.88) * keep;
  p.xz += bend * k * h * 0.55;
  p.y += y * h * (1.0 - 0.22 * min(length(bend), 1.5) * k);
  vY = y; vWorld = p; vRnd = fract(aSeed.w * 13.7);
  vN = normalize(vec3(-side.y, 0.8, side.x));
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}`;

const GRASS_FRAG = /* glsl */`
uniform vec3 uBase, uTip, uSunDir, uSunCol, uAmb, uFogColor, uCam, uGlowCol, uC0, uC1, uP0, uP1;
uniform float uFog, uGlow, uL0, uL1;
varying float vY, vRnd;
varying vec3 vWorld, vN;
void main() {
  vec3 c = mix(uBase, uTip, smoothstep(0.0, 1.0, vY)) * (0.8 + 0.4 * vRnd);
  float diff = 0.5 + 0.5 * abs(dot(normalize(vN), uSunDir));
  vec3 v = normalize(uCam - vWorld);
  float through = pow(max(dot(v, -uSunDir), 0.0), 5.0) * vY; // light through the blades when you face the sun
  vec3 lit = c * (uAmb + uSunCol * diff * 0.7) + uSunCol * c * through * 0.9;
  vec3 a = vWorld - uP0, b = vWorld - uP1;
  lit += c * (uC0 * uL0 / (1.0 + dot(a, a) * 0.12) + uC1 * uL1 / (1.0 + dot(b, b) * 0.12)) * 3.0;
  lit += uGlowCol * uGlow * pow(vY, 4.0);
  float dist = length(uCam - vWorld);
  gl_FragColor = vec4(mix(lit, uFogColor, 1.0 - exp(-uFog * uFog * dist * dist)), 1.0);
}`;

// GPU-only drifting particles: each point wraps around a box that follows the camera, so the air is never empty.
const AMBIENT_VERT = /* glsl */`
attribute vec4 seed;
uniform float time, size, sway, twinkle;
uniform vec3 center, box, vel;
varying float vTw, vFade, vMix;
void main() {
  vec3 p = seed.xyz * box + vel * time * (0.6 + 0.8 * seed.w)
         + vec3(sin(time * 0.7 + seed.w * 40.0), sin(time * 0.9 + seed.x * 20.0) * 0.4, cos(time * 0.5 + seed.w * 30.0)) * sway;
  p = mod(p - center + box * 0.5, box) - box * 0.5 + center;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = size * (0.5 + seed.w) * (300.0 / -mv.z);
  float tw = 0.5 + 0.5 * sin(time * (1.2 + seed.w * 3.0) + seed.x * 60.0);
  vTw = mix(1.0, pow(tw, 3.0), twinkle);
  vFade = smoothstep(box.x * 0.5, box.x * 0.25, length(p.xz - center.xz));
  vMix = seed.w;
}`;

const AMBIENT_FRAG = /* glsl */`
uniform vec3 color, color2;
uniform float energy, shape;
varying float vTw, vFade, vMix;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float d = length(c);
  float a = smoothstep(0.5, 0.0, d);
  if (shape > 0.5) {
    float core = smoothstep(0.2, 0.16, max(abs(c.x) * 1.25, abs(c.y)));
    a = core + smoothstep(0.5, 0.0, d) * 0.45;
  }
  vec3 col = mix(color, color2, vMix) * (1.0 + energy * 0.9);
  gl_FragColor = vec4(col, a * vTw * vFade);
}`;

const POINT_VERT = /* glsl */`
attribute float size;
attribute float alpha;
attribute vec3 tint;
varying float vA;
varying vec3 vC;
void main() {
  vA = alpha; vC = tint;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = size * (420.0 / -mv.z);
}`;

const POINT_FRAG = /* glsl */`
uniform sampler2D map;
varying float vA;
varying vec3 vC;
void main() {
  vec4 t = texture2D(map, vec2(gl_PointCoord.x, 1.0 - gl_PointCoord.y));
  gl_FragColor = vec4(vC * t.rgb * 1.6, t.a * vA);
}`;

const pointMaterial = (map) => new THREE.ShaderMaterial({
  uniforms: { map: { value: map } }, vertexShader: POINT_VERT, fragmentShader: POINT_FRAG,
  transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
});

// Billboarded cloud puffs for the sea of clouds.
const PUFF_VERT = /* glsl */`
attribute vec4 aPuff;
attribute float aRot;
varying vec2 vUv;
varying float vY, vDist;
void main() {
  vec4 mv = viewMatrix * vec4(aPuff.xyz, 1.0);
  float c = cos(aRot), s = sin(aRot);
  mv.xy += mat2(c, -s, s, c) * position.xy * aPuff.w * vec2(1.0, 0.42); // wide and low, like a sea
  vUv = uv; vY = position.y + 0.5; vDist = -mv.z;
  gl_Position = projectionMatrix * mv;
}`;
const PUFF_FRAG = /* glsl */`
uniform sampler2D map;
uniform vec3 uLit, uShade, uFogColor, uSun;
uniform float uFog;
varying vec2 vUv;
varying float vY, vDist;
void main() {
  float a = texture2D(map, vUv).a;
  vec3 c = mix(uShade, uLit, smoothstep(0.1, 0.9, vY)) + uSun * pow(vY, 3.0) * 0.25;
  c = mix(c, uFogColor, 1.0 - exp(-uFog * uFog * vDist * vDist));
  gl_FragColor = vec4(c, a * 0.95);
}`;

// Post: a light grade, a vignette and a breath of film grain, so the frame reads as one picture.
const GradeShader = {
  uniforms: { tDiffuse: { value: null }, uTime: { value: 0 }, uSat: { value: 1 }, uWarm: { value: new THREE.Vector3(1, 1, 1) }, uVignette: { value: 0.32 } },
  vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: /* glsl */`
uniform sampler2D tDiffuse;
uniform float uTime, uSat, uVignette;
uniform vec3 uWarm;
varying vec2 vUv;
float rnd(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
void main() {
  vec4 t = texture2D(tDiffuse, vUv);
  vec3 c = t.rgb * uWarm;
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = mix(vec3(l), c, uSat);
  vec2 q = vUv - 0.5;
  c *= 1.0 - uVignette * smoothstep(0.25, 0.85, length(q * vec2(1.15, 1.0)));
  c += (rnd(vUv * 1000.0 + fract(uTime)) - 0.5) * 0.022;
  gl_FragColor = vec4(c, t.a);
}`,
};

// ── particle bursts (hearts, sparks, lanterns, the light that notes leave behind) ─────

class Burst {
  constructor(scene, map, cap) {
    this.cap = cap;
    this.n = 0;
    this.pos = new Float32Array(cap * 3);
    this.vel = new Float32Array(cap * 3);
    this.tint = new Float32Array(cap * 3);
    this.size = new Float32Array(cap);
    this.base = new Float32Array(cap);
    this.alpha = new Float32Array(cap);
    this.life = new Float32Array(cap);
    this.max = new Float32Array(cap);
    this.grav = new Float32Array(cap);
    const g = new THREE.BufferGeometry();
    const attr = (name, arr, k) => g.setAttribute(name, new THREE.BufferAttribute(arr, k).setUsage(THREE.DynamicDrawUsage));
    attr('position', this.pos, 3); attr('tint', this.tint, 3); attr('size', this.size, 1); attr('alpha', this.alpha, 1);
    this.geo = g;
    this.points = new THREE.Points(g, pointMaterial(map));
    this.points.frustumCulled = false;
    scene.add(this.points);
  }

  emit(p, v, c, size, life, grav = 0.4) {
    const i = this.n < this.cap ? this.n++ : Math.floor(Math.random() * this.cap);
    this.pos.set([p.x, p.y, p.z], i * 3);
    this.vel.set([v.x, v.y, v.z], i * 3);
    this.tint.set([c.r, c.g, c.b], i * 3);
    this.base[i] = size; this.life[i] = 0; this.max[i] = life; this.grav[i] = grav;
  }

  #move(from, to) {
    for (const a of [this.pos, this.vel, this.tint]) a.copyWithin(to * 3, from * 3, from * 3 + 3);
    for (const a of [this.base, this.life, this.max, this.grav, this.size, this.alpha]) a[to] = a[from];
  }

  update(dt, drag = 0.9) {
    const damp = Math.exp(-dt * drag);
    for (let i = 0; i < this.n; i++) {
      this.life[i] += dt;
      if (this.life[i] >= this.max[i]) { this.#move(--this.n, i); i--; continue; }
      const k = this.life[i] / this.max[i];
      const j = i * 3;
      this.vel[j + 1] += this.grav[i] * dt;
      for (let a = 0; a < 3; a++) { this.vel[j + a] *= damp; this.pos[j + a] += this.vel[j + a] * dt; }
      this.alpha[i] = (k < 0.12 ? k / 0.12 : 1 - (k - 0.12) / 0.88) ** 1.2;
      this.size[i] = this.base[i] * (0.7 + 0.3 * Math.sin(k * Math.PI));
    }
    for (const name of ['position', 'tint', 'size', 'alpha']) this.geo.attributes[name].needsUpdate = true;
    this.geo.setDrawRange(0, this.n);
  }
}

// ── a person, as light ──────────────────────────────────────────────────────────────

const TRAIL = 46;

export class Wisp {
  constructor(scene, color) {
    this.color = col(color);
    this.group = new THREE.Group();
    this.core = new THREE.Mesh(new THREE.SphereGeometry(0.34, 32, 20), new THREE.ShaderMaterial({
      uniforms: { uCol: { value: this.color.clone() } },
      vertexShader: 'varying vec3 vN, vV; void main() { vec4 mv = modelViewMatrix * vec4(position, 1.0); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }',
      fragmentShader: 'uniform vec3 uCol; varying vec3 vN, vV; void main() { float f = pow(1.0 - max(dot(vN, vV), 0.0), 1.6); gl_FragColor = vec4(mix(vec3(2.2), uCol * 1.8, f), 1.0); }',
    }));
    this.heart = new THREE.Mesh(new THREE.SphereGeometry(0.16, 16, 12), new THREE.MeshBasicMaterial({ color: new THREE.Color(2, 2, 2), toneMapped: false }));
    this.halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: this.color, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.5 }));
    this.halo.scale.setScalar(2.6);
    this.light = new THREE.PointLight(this.color, 1.6, 28, 0); // no falloff curve: a soft pool, not a hot spot
    this.group.add(this.core, this.heart, this.halo, this.light);
    scene.add(this.group);

    this.trailPos = new Float32Array(TRAIL * 3);
    const tg = new THREE.BufferGeometry();
    tg.setAttribute('position', new THREE.BufferAttribute(this.trailPos, 3).setUsage(THREE.DynamicDrawUsage));
    tg.setAttribute('tint', new THREE.BufferAttribute(new Float32Array(TRAIL * 3).map((_, i) => this.color.toArray()[i % 3]), 3));
    tg.setAttribute('size', new THREE.BufferAttribute(Float32Array.from({ length: TRAIL }, (_, i) => 0.2 + 0.75 * (1 - i / TRAIL) ** 1.5), 1));
    this.trailBase = Float32Array.from({ length: TRAIL }, (_, i) => 0.55 * (1 - i / TRAIL) ** 1.6);
    tg.setAttribute('alpha', new THREE.BufferAttribute(new Float32Array(TRAIL), 1).setUsage(THREE.DynamicDrawUsage));
    this.trail = new THREE.Points(tg, pointMaterial(glowTex));
    this.trail.frustumCulled = false;
    scene.add(this.trail);
    this.trailGeo = tg;
    this.trailInit = false;

    this.pos = new THREE.Vector3();
    this.pulse = 0;
    this.spin = 0;
    this.voice = 0;
    this.reach = 0;
    this.phase = Math.random() * 10;
  }

  update(dt, t, energy, glow = 1) {
    const g = this.group.position.copy(this.pos);
    g.y += Math.sin(t * 1.8 + this.phase) * 0.16;
    if (this.spin > 0) {
      this.spin = Math.max(0, this.spin - dt);
      const a = (1 - this.spin / 1.1) * Math.PI * 2;
      g.y += Math.sin(a) * 1.1;
      g.x += (Math.cos(a) - 1) * -0.6;
    }
    this.pulse = Math.max(0, this.pulse - dt * 1.6);
    const flicker = this.reach * (0.5 + 0.5 * Math.sin(t * 9));
    this.halo.scale.setScalar(2.4 + energy * 0.8 + this.pulse * 2.5 + this.voice * 1.6 + flicker * 0.8);
    this.light.intensity = (1.6 + energy * 0.8 + this.pulse * 2.5 + this.voice * 1) * glow;

    if (!this.trailInit) { for (let i = 0; i < TRAIL; i++) this.trailPos.set([g.x, g.y, g.z], i * 3); this.trailInit = true; }
    // A rope of light: each bead follows the one ahead, and fades as the rope goes slack.
    const P = this.trailPos, A = this.trailGeo.attributes.alpha.array;
    const k = 1 - Math.exp(-dt * 14);
    P.set([g.x, g.y, g.z], 0);
    for (let i = 1; i < TRAIL; i++) {
      const j = i * 3;
      const dx = P[j - 3] - P[j], dy = P[j - 2] - P[j + 1], dz = P[j - 1] - P[j + 2];
      P[j] += dx * k; P[j + 1] += dy * k; P[j + 2] += dz * k;
      A[i] = this.trailBase[i] * Math.min(1, Math.sqrt(dx * dx + dy * dy + dz * dz) / 0.12);
    }
    A[0] = 0;
    this.trailGeo.attributes.position.needsUpdate = true;
    this.trailGeo.attributes.alpha.needsUpdate = true;
  }

  get visible() { return this.group.visible; }
  set visible(v) { this.group.visible = v; this.trail.visible = v; }
  teleport() { this.trailInit = false; }

  dispose(scene) {
    scene.remove(this.group, this.trail);
    this.group.traverse((o) => { o.geometry?.dispose(); o.material?.dispose(); });
    this.trailGeo.dispose(); this.trail.material.dispose();
  }
}

// ── trees, grown by ez-tree (Daniel Greenheck, MIT) ─────────────────────────────────

const TREE_HEIGHT = { Large: 14, Medium: 9.5, Small: 5.5, Bush: 2.2 };
const treeCache = new Map();
function treeVariant(preset, leafTint, seed) {
  const key = `${preset}|${leafTint ?? ''}|${seed}`;
  if (treeCache.has(key)) return treeCache.get(key);
  const tree = new Tree();
  tree.loadPreset(preset);
  tree.options.seed = seed;
  if (leafTint) tree.options.leaves.tint = new THREE.Color(leafTint).getHex();
  tree.generate();
  // ez-tree's wind shader rewrites the leaves' projection and drops instancing; put instanceMatrix back,
  // or every instanced canopy lands at the origin.
  const leaves = tree.leavesMesh.material;
  const windCompile = leaves.onBeforeCompile;
  leaves.onBeforeCompile = (sh, renderer) => {
    windCompile(sh, renderer);
    sh.vertexShader = sh.vertexShader.replace('vec4 mvPosition = vec4(transformed, 1.0);',
      'vec4 mvPosition = vec4(transformed, 1.0);\n#ifdef USE_INSTANCING\nmvPosition = instanceMatrix * mvPosition;\n#endif');
  };
  leaves.customProgramCacheKey = () => 'ez-tree-leaves-instanced';
  leaves.alphaTest = 0.35;        // mipmapped leaf alpha thins with distance; a lower cut keeps far canopies full
  leaves.alphaToCoverage = true;  // and soft edges up close, with MSAA
  tree.branchesMesh.geometry.computeBoundingBox();
  tree.leavesMesh.geometry.computeBoundingBox();
  const box = tree.branchesMesh.geometry.boundingBox.clone().union(tree.leavesMesh.geometry.boundingBox);
  const size = Object.entries(TREE_HEIGHT).find(([k]) => preset.includes(k))?.[1] ?? 10;
  const v = { tree, unit: size / Math.max(1, box.max.y - box.min.y) };
  treeCache.set(key, v);
  return v;
}

// Two crossed quads, so a flower reads from any side.
function crossQuad(size) {
  const a = new THREE.PlaneGeometry(size, size);
  const b = new THREE.PlaneGeometry(size, size).rotateY(Math.PI / 2);
  const geo = new THREE.BufferGeometry();
  const n = a.attributes.position.count;
  geo.setAttribute('position', new THREE.Float32BufferAttribute([...a.attributes.position.array, ...b.attributes.position.array], 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute([...a.attributes.uv.array, ...b.attributes.uv.array], 2));
  geo.setIndex([...a.index.array, ...[...b.index.array].map((i) => i + n)]);
  return geo;
}

// ── the world ───────────────────────────────────────────────────────────────────────

const disposeTree = (obj) => obj?.traverse((o) => {
  if (o.userData.shared) return;
  o.geometry?.dispose();
  (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => m?.dispose());
});

export class World {
  constructor(canvas) {
    const r = this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    r.setPixelRatio(Math.min(devicePixelRatio, 1.6));
    r.setSize(innerWidth, innerHeight, false);
    r.toneMapping = THREE.ACESFilmicToneMapping;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(58, innerWidth / innerHeight, 0.1, 5000);
    this.composer = new EffectComposer(r);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.6, 0.5, 0.88);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    this.grade = new ShaderPass(GradeShader);
    this.composer.addPass(this.grade);

    this.hemi = new THREE.HemisphereLight();
    this.sun = new THREE.DirectionalLight();
    this.scene.add(this.hemi, this.sun);
    this.scene.fog = new THREE.FogExp2(0xffffff, 0.004);

    const u = (v) => ({ value: v });
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(1800, 48, 24), new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, vertexShader: SKY_VERT, fragmentShader: SKY_FRAG,
      uniforms: {
        top: u(col(0)), horizon: u(col(0)), fogColor: u(col(0)), sunColor: u(col(0)), sunDir: u(new THREE.Vector3()), sunSize: u(0),
        stars: u(0), time: u(0), aurora: u(0), clouds: u(0), cloudLit: u(col(0)), cloudShade: u(col(0)), sunBoost: u(0),
      },
    }));
    this.sky.renderOrder = -1;
    this.sky.frustumCulled = false;
    this.scene.add(this.sky);

    // Ground textures and the terrain's shared uniforms.
    const tu = this.terrainU = {
      uGrass: u(col(1)), uRock: u(col(1)), uSand: u(col(1)), uSnow: u(col(1)), uSnowLine: u(999), uWater: u(-99),
      aGrass: u(new THREE.Color(0.25, 0.25, 0.25)), aRock: u(new THREE.Color(0.25, 0.25, 0.25)), aSand: u(new THREE.Color(0.4, 0.4, 0.4)), aSnow: u(new THREE.Color(0.8, 0.8, 0.8)),
    };
    const grass = groundTexture('aerial_grass_rock', r, tu.aGrass);
    const rock = groundTexture('rocky_terrain_02', r, tu.aRock);
    const sand = groundTexture('aerial_beach_01', r, tu.aSand);
    const snow = groundTexture('snow_02', r, tu.aSnow);
    Object.assign(tu, { tGrass: u(grass.diff), tGrassN: u(grass.nor), tRock: u(rock.diff), tRockN: u(rock.nor), tSand: u(sand.diff), tSnow: u(snow.diff), tSnowN: u(snow.nor) });
    this.rockTex = rock.diff;
    this.terrainMat = new THREE.MeshStandardMaterial({ roughness: 0.95, metalness: 0 });
    this.terrainMat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, tu);
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;\nvarying vec3 vWNormal;')
        .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvWNormal = normalize(mat3(modelMatrix) * objectNormal);');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', `#include <common>\n${TERRAIN_HEAD}`)
        .replace('#include <map_fragment>', TERRAIN_SPLAT)
        .replace('#include <normal_fragment_maps>', TERRAIN_NORMAL);
    };

    // Real reflective water (three.js Water, after the Ocean demo).
    const normals = loader.load('textures/waternormals.jpg', (t) => { t.wrapS = t.wrapT = THREE.RepeatWrapping; });
    this.water = new Water(new THREE.PlaneGeometry(2600, 2600), {
      textureWidth: 512, textureHeight: 512, waterNormals: normals, sunDirection: new THREE.Vector3(0, 1, 0),
      sunColor: 0xffffff, waterColor: 0x1d2a3a, distortionScale: 2, fog: true,
    });
    this.water.rotation.x = -Math.PI / 2;
    this.water.material.uniforms.size.value = 2.5;
    const reflect = this.water.onBeforeRender.bind(this.water);
    this.water.onBeforeRender = (...args) => { // grass stays out of the mirror; you would never see it there, and it is costly
      const was = this.grass.visible;
      this.grass.visible = false;
      reflect(...args);
      this.grass.visible = was;
    };
    this.scene.add(this.water);

    this.#makeGrass();

    this.hearts = new Burst(this.scene, heartTex, 500);
    this.sparks = new Burst(this.scene, sparkTex, 2200);
    this.glows = new Burst(this.scene, glowTex, 1400);
    this.lanterns = new Burst(this.scene, lanternTex, 420);

    // The thread: always between you, faint when apart, bright when held.
    this.threadN = 96;
    const tg = new THREE.BufferGeometry();
    for (const [name, k] of [['position', 3], ['tint', 3], ['size', 1], ['alpha', 1]]) {
      tg.setAttribute(name, new THREE.BufferAttribute(new Float32Array(this.threadN * k), k).setUsage(THREE.DynamicDrawUsage));
    }
    this.thread = new THREE.Points(tg, pointMaterial(sparkTex));
    this.thread.frustumCulled = false;
    this.scene.add(this.thread);
    this.threadAlpha = 0;

    this.growing = [];
    this.beacons = [];
    this.wishes = [];
    this.islandTops = [];
    this.treeSources = new Set();
    this.boost = { aurora: 0, sun: 0, gate: 0, stars: 0 };
    this.closeness = 1;
    this.focus = new THREE.Vector3();
    this.markPos = new THREE.Vector3();
    this.players = [new THREE.Vector3(0, -999, 0), new THREE.Vector3(0, -999, 0)];
    this.playerLights = [[col(0), 0], [col(0), 0]];
    this._m = new THREE.Matrix4(); this._q = new THREE.Quaternion(); this._s = new THREE.Vector3(); this._v = new THREE.Vector3(); this._c = new THREE.Color();

    addEventListener('resize', () => this.resize());
  }

  resize() {
    this.camera.aspect = innerWidth / innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(innerWidth, innerHeight, false);
    this.composer.setSize(innerWidth, innerHeight);
  }

  /** Where a body comes to rest: ground, water, ice, a pier or the top of a floating island. */
  surfaceAt(x, z) {
    let y = this.w.terrain.hidden ? 3 : this.h(x, z); // above the clouds, the cloud tops are the floor
    if (this.w.water) y = Math.max(y, this.w.water.level);
    for (const s of this.islandTops) {
      const dx = x - s.x, dz = z - s.z;
      if (dx * dx + dz * dz < s.r * s.r) y = Math.max(y, s.y);
    }
    if (this.pier && Math.abs(x - this.pier.x) < 1.8 && z < this.pier.z0 && z > this.pier.z1) y = Math.max(y, this.pier.y);
    return y;
  }

  setWorld(w) {
    this.w = w;
    this.h = heightField(w);
    const su = this.sky.material.uniforms;
    su.top.value.set(w.sky.top); su.horizon.value.set(w.sky.horizon); su.fogColor.value.set(w.fog.color);
    su.sunColor.value.set(w.sky.sun); su.sunDir.value.set(...w.sky.sunDir).normalize();
    su.sunSize.value = w.sky.sunSize; su.stars.value = w.sky.stars; su.aurora.value = w.sky.aurora;
    su.clouds.value = w.sky.clouds; su.cloudLit.value.set(w.sky.cloudLit); su.cloudShade.value.set(w.sky.cloudShade);
    this.scene.fog.color.set(w.fog.color);
    this.scene.fog.density = w.fog.density;
    this.hemi.color.set(w.light.sky); this.hemi.groundColor.set(w.light.ground); this.hemi.intensity = w.light.hemi;
    this.sun.color.set(w.light.sun); this.sun.intensity = w.light.sunI;
    this.sun.position.copy(su.sunDir.value).multiplyScalar(300);
    this.renderer.toneMappingExposure = w.exposure;
    this.bloom.strength = w.bloom;
    this.grade.uniforms.uWarm.value.set(...w.grade.warm);
    this.boost = { aurora: 0, sun: 0, gate: 0, stars: 0 };
    this.metFlag = false;

    const t = w.terrain, tu = this.terrainU;
    tu.uGrass.value.set(t.grass); tu.uRock.value.set(t.rock); tu.uSand.value.set(t.sand); tu.uSnow.value.set(t.snow);
    tu.uSnowLine.value = t.snowLine; tu.uWater.value = w.water ? w.water.level : -99;

    this.water.visible = !!w.water;
    if (w.water) {
      const wu = this.water.material.uniforms;
      this.water.position.y = w.water.level;
      wu.waterColor.value.set(w.water.color);
      wu.sunColor.value.set(w.water.sun);
      wu.sunDirection.value.copy(su.sunDir.value);
      wu.distortionScale.value = w.water.distortion;
      wu.size.value = w.water.ice ? 0.6 : 2.5;
    }

    this.#terrain();
    this.#props();
    this.#ambient();
    this.#landmark();
    for (const b of this.beacons) { this.scene.remove(b.mesh); b.mesh.geometry.dispose(); b.mesh.material.dispose(); }
    this.beacons = []; this.wishes = [];

    const gu = this.grass.material.uniforms, g = w.grass;
    this.grass.visible = g.amount > 0;
    if (g.amount > 0) {
      gu.uBase.value.set(g.base); gu.uTip.value.set(g.tip); gu.uBlade.value = g.height;
      gu.uGlow.value = g.glow; gu.uGlowCol.value.set(g.glowColor);
      gu.uSunDir.value.copy(su.sunDir.value); gu.uSunCol.value.set(w.light.sun).multiplyScalar(w.light.sunI * 0.28);
      gu.uAmb.value.set(w.light.sky).multiplyScalar(w.light.hemi * 0.45);
      gu.uFogColor.value.set(w.fog.color); gu.uFog.value = w.fog.density;
    }
  }

  #terrain() {
    const w = this.w, t = w.terrain;
    const geo = new THREE.PlaneGeometry(TERRAIN_SIZE, TERRAIN_SIZE, SEGMENTS, SEGMENTS).rotateX(-Math.PI / 2);
    const p = geo.attributes.position;
    for (let i = 0; i < p.count; i++) p.setY(i, this.h(p.getX(i), p.getZ(i)));
    geo.computeVertexNormals();
    // Height and grass density, for the GPU grass to stand on.
    const nrm = geo.attributes.normal;
    const data = new Float32Array(RES * RES * 4);
    const water = w.water?.level ?? -99;
    const amount = w.grass.amount ?? 0;
    for (let i = 0; i < p.count; i++) {
      const y = p.getY(i), slope = 1 - nrm.getY(i);
      data[i * 4] = y;
      data[i * 4 + 1] = amount * (1 - smooth(0.16, 0.32, slope)) * smooth(water + 0.7, water + 1.8, y) * (y < t.snowLine - 3 ? 1 : 0);
    }
    this.heightTex?.dispose();
    this.heightTex = new THREE.DataTexture(data, RES, RES, THREE.RGBAFormat, THREE.FloatType);
    this.heightTex.needsUpdate = true;
    this.heightData = data;
    this.grass.material.uniforms.uHeight.value = this.heightTex;

    if (this.ground) { this.scene.remove(this.ground); this.ground.geometry.dispose(); }
    this.ground = new THREE.Mesh(geo, this.terrainMat);
    this.ground.visible = !t.hidden;
    this.scene.add(this.ground);
  }

  /** Grass density at a point, from the same map the blades use. */
  grassAt(x, z) {
    const gx = Math.round((x / TERRAIN_SIZE + 0.5) * SEGMENTS), gz = Math.round((z / TERRAIN_SIZE + 0.5) * SEGMENTS);
    if (gx < 0 || gz < 0 || gx > SEGMENTS || gz > SEGMENTS) return 0;
    return this.heightData[(gz * RES + gx) * 4 + 1];
  }

  slopeOk(x, z) {
    const e = 2;
    return Math.abs(this.h(x + e, z) - this.h(x - e, z)) + Math.abs(this.h(x, z + e) - this.h(x, z - e)) < 2.6;
  }

  #makeGrass() {
    const S = 4;
    const pos = [];
    for (let k = 0; k < S; k++) pos.push(-0.5, k / S, 0, 0.5, k / S, 0);
    pos.push(0, 1, 0);
    const idx = [];
    for (let k = 0; k < S - 1; k++) { const a = k * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    idx.push((S - 1) * 2, (S - 1) * 2 + 1, S * 2);
    const geo = new THREE.InstancedBufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setIndex(idx);
    const r = rng(4242);
    geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(Float32Array.from({ length: GRASS_BLADES * 4 }, () => r()), 4));
    geo.instanceCount = GRASS_BLADES;
    const u = (v) => ({ value: v });
    const mat = new THREE.ShaderMaterial({
      vertexShader: GRASS_VERT, fragmentShader: GRASS_FRAG, side: THREE.DoubleSide,
      uniforms: {
        uHeight: u(null), uTime: u(0), uTile: u(GRASS_TILE), uSize: u(TERRAIN_SIZE), uRes: u(RES), uBlade: u(1), uWidth: u(0.075),
        uCenter: u(new THREE.Vector3()), uP0: u(new THREE.Vector3(0, -999, 0)), uP1: u(new THREE.Vector3(0, -999, 0)), uWind: u(new THREE.Vector2(0.5, 0.2)),
        uBase: u(col(0)), uTip: u(col(0)), uSunDir: u(new THREE.Vector3(0, 1, 0)), uSunCol: u(col(0)), uAmb: u(col(0)), uFogColor: u(col(0)),
        uCam: u(new THREE.Vector3()), uGlowCol: u(col(0)), uC0: u(col(0)), uC1: u(col(0)), uFog: u(0), uGlow: u(0), uL0: u(0), uL1: u(0),
      },
    });
    this.grass = new THREE.Mesh(geo, mat);
    this.grass.frustumCulled = false;
    this.scene.add(this.grass);
  }

  #place(r, count, minR, maxR, ok) {
    const out = [];
    for (let tries = 0; out.length < count && tries < count * 30; tries++) {
      const a = r() * Math.PI * 2, d = minR + Math.sqrt(r()) * (maxR - minR);
      const x = Math.cos(a) * d, z = Math.sin(a) * d, y = this.h(x, z);
      if (ok(x, y, z)) out.push([x, y, z]);
    }
    return out;
  }

  #instanceTrees(group, r, spots, preset, leafTint, scaleBy = 1) {
    if (!spots.length) return;
    const v = treeVariant(preset, leafTint, 1000 + Math.floor(r() * 4)); // a few shapes per species, reused
    this.treeSources.add(v.tree);
    for (const mesh of [v.tree.branchesMesh, v.tree.leavesMesh]) {
      const inst = new THREE.InstancedMesh(mesh.geometry, mesh.material, spots.length);
      inst.userData.shared = true; // geometry and material belong to the cached tree
      spots.forEach(([x, y, z, s0], i) => {
        const s = v.unit * scaleBy * (s0 ?? (0.8 + r() * 0.45));
        this._q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, r() * Math.PI * 2);
        inst.setMatrixAt(i, this._m.compose(this._v.set(x, y - 0.3, z), this._q, this._s.set(s, s, s)));
      });
      inst.computeBoundingSphere();
      group.add(inst);
    }
  }

  #props() {
    const w = this.w;
    if (this.props) { this.scene.remove(this.props); disposeTree(this.props); }
    const g = this.props = new THREE.Group();
    this.treeSources = new Set();
    this.islandTops = [];
    this.growing = [];
    const r = rng(w.seed * 31 + 1);
    const water = w.water?.level ?? -99;
    const [lx, lz] = w.landmark.pos;
    const free = (x, z, pad) => Math.hypot(x, z - 6) > 34 && Math.hypot(x - lx, z - lz) > w.landmark.radius + pad; // a clearing where you arrive

    if (!w.terrain.hidden) {
      for (const tr of w.trees) {
        // Two shapes per species, so a forest doesn't look stamped.
        for (let half = 0; half < 2; half++) {
          const spots = this.#place(r, Math.round((tr.count / 2) * (QUALITY < 1 ? 0.6 : 1)), 14, BOUND + 30,
            (x, y, z) => y > water + 1.5 && free(x, z, 6) && this.slopeOk(x, z));
          this.#instanceTrees(g, r, spots, tr.preset, tr.leafTint, tr.scale);
        }
      }
    }

    // Flowers grow in drifts, the way they do in real fields.
    const cap = w.flowers.count + FLOWER_EXTRA;
    const fl = this.flowers = new THREE.InstancedMesh(crossQuad(0.5), new THREE.MeshBasicMaterial({
      map: flowerTex, alphaTest: 0.5, side: THREE.DoubleSide, toneMapped: !w.flowers.glow,
    }), cap);
    fl.count = 0;
    fl.frustumCulled = false;
    if (w.flowers.count) {
      const clusters = this.#place(r, Math.ceil(w.flowers.count / 18), 6, BOUND, (x, y, z) => this.grassAt(x, z) > 0.5 && free(x, z, 0));
      for (let i = 0; i < w.flowers.count && clusters.length; i++) {
        const [cx, , cz] = clusters[i % clusters.length];
        const x = cx + (r() + r() + r() - 1.5) * 10, z = cz + (r() + r() + r() - 1.5) * 10;
        if (this.grassAt(x, z) < 0.3) continue;
        this.#setFlower(fl.count++, x, this.h(x, z) + 0.32 + r() * 0.2, z, 0.55 + r() * 0.6, w.flowers.colors[Math.floor(r() * w.flowers.colors.length)], r());
      }
    }
    g.add(fl);

    if (w.cloudSea) this.#cloudSea(g, r);
    if (w.islands) this.#islands(g, r);
    this.scene.add(g);
  }

  #setFlower(i, x, y, z, s, color, spin) {
    this._q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, spin * Math.PI);
    this.flowers.setMatrixAt(i, this._m.compose(this._v.set(x, y, z), this._q, this._s.set(s, s, s)));
    this.flowers.setColorAt(i, this._c.set(color));
    this.flowers.instanceMatrix.needsUpdate = true;
    this.flowers.instanceColor.needsUpdate = true;
  }

  /** Plant a flower that grows in over a second. Returns false once the field is full. */
  plant(x, z, color, delay = 0) {
    if (this.flowers.count >= this.flowers.instanceMatrix.count) return false;
    const y = this.surfaceAt(x, z);
    if ((this.w.water && y <= this.w.water.level + 0.3) || this.w.terrain.hidden) return false; // no flowers on water or cloud
    const i = this.flowers.count++;
    this.#setFlower(i, x, y + 0.3, z, 0.001, color, Math.random());
    this.growing.push({ i, x, y: y + 0.3, z, t: -delay, s: 0.6 + Math.random() * 0.5 });
    return true;
  }

  #cloudSea(group, r) {
    const C = this.w.cloudSea;
    const n = Math.round(C.count * (QUALITY < 1 ? 0.6 : 1));
    const geo = new THREE.InstancedBufferGeometry().copy(new THREE.PlaneGeometry(1, 1));
    geo.instanceCount = n;
    const puff = new Float32Array(n * 4), rot = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const a = r() * Math.PI * 2, d = Math.sqrt(r()) * 520;
      puff.set([Math.cos(a) * d, -20 + r() * 9 - (d > 380 ? (d - 380) * 0.05 : 0), Math.sin(a) * d, 30 + r() * 45], i * 4);
      rot[i] = r() * Math.PI * 2;
    }
    geo.setAttribute('aPuff', new THREE.InstancedBufferAttribute(puff, 4));
    geo.setAttribute('aRot', new THREE.InstancedBufferAttribute(rot, 1));
    const u = (v) => ({ value: v });
    const mesh = new THREE.Mesh(geo, new THREE.ShaderMaterial({
      vertexShader: PUFF_VERT, fragmentShader: PUFF_FRAG, transparent: true, depthWrite: false,
      uniforms: { map: u(puffTex), uLit: u(col(C.lit)), uShade: u(col(C.shade)), uFogColor: u(col(this.w.fog.color)), uSun: u(col(this.w.light.sun)), uFog: u(this.w.fog.density) },
    }));
    mesh.frustumCulled = false;
    mesh.renderOrder = 1;
    group.add(mesh);
  }

  #islandGeometry(seed) {
    const geo = new THREE.IcosahedronGeometry(1, 5);
    const n = simplex(seed);
    const p = geo.attributes.position;
    const colors = new Float32Array(p.count * 3);
    const top = col('#9cc46e'), rock = col('#d8cdd6'), deep = col('#b4a6bf'), c = new THREE.Color();
    for (let i = 0; i < p.count; i++) {
      let x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      const wob = 1 + n(x * 2.1, z * 2.1) * 0.18;
      if (y > 0) { y = 0.04 * n(x * 4, z * 4); x *= wob; z *= wob; c.copy(top).offsetHSL(0, 0, n(x * 6, z * 6) * 0.05); }
      else {
        const k = -y;
        x *= wob * (1 - k * k * 0.6); z *= wob * (1 - k * k * 0.6); y = -k * (0.95 + n(x * 3, z * 3) * 0.3);
        c.copy(rock).lerp(deep, k);
      }
      p.setXYZ(i, x, y, z);
      c.toArray(colors, i * 3);
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();
    return geo;
  }

  #islands(group, r) {
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, map: this.rockTex, emissive: col('#4a3d52'), emissiveIntensity: 0.55 }); // lit from the clouds below
    const kinds = [0, 1, 2].map((k) => ({ geo: this.#islandGeometry(this.w.seed + k * 13), spots: [] }));
    const trees = [];
    const [lx, lz] = this.w.landmark.pos;
    for (let i = 0; i < this.w.islands; i++) {
      const a = r() * Math.PI * 2, d = 40 + Math.sqrt(r()) * (BOUND - 40);
      const x = Math.cos(a) * d, z = Math.sin(a) * d;
      if (Math.hypot(x - lx, z - lz) < 40) continue;
      const y = 10 + r() * 50, s = 6 + r() * 11;
      kinds[i % 3].spots.push([x, y, z, s]);
      this.islandTops.push({ x, y: y + 0.2, z, r: s * 0.85 });
      for (let k = Math.floor(r() * 4); k > 0; k--) {
        const ta = r() * Math.PI * 2, td = r() * s * 0.55;
        trees.push([x + Math.cos(ta) * td, y + 0.25, z + Math.sin(ta) * td]);
      }
    }
    for (const k of kinds) {
      if (!k.spots.length) continue;
      const inst = new THREE.InstancedMesh(k.geo, mat, k.spots.length);
      k.spots.forEach(([x, y, z, s], i) => {
        this._q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, r() * Math.PI * 2);
        inst.setMatrixAt(i, this._m.compose(this._v.set(x, y, z), this._q, this._s.set(s, s * (0.8 + r() * 0.6), s)));
      });
      inst.computeBoundingSphere();
      group.add(inst);
    }
    const half = Math.ceil(trees.length / 2);
    this.#instanceTrees(group, r, trees.slice(0, half), this.w.trees[0].preset, null, 0.8);
    this.#instanceTrees(group, r, trees.slice(half), this.w.trees[1].preset, null, 1);
    this.islandMat = mat;
    this.islandGeo = kinds[0].geo;
  }

  // ── the meeting place ──

  #landmark() {
    const w = this.w, L = w.landmark;
    if (this.mark) { this.scene.remove(this.mark); disposeTree(this.mark); }
    const g = this.mark = new THREE.Group();
    const [x, z] = L.pos;
    const r = rng(w.seed + 5);
    this.pier = null;
    this.gate = null;
    this.stonesMat = null;
    let y = this.surfaceAt(x, z);
    this.markPos.set(x, y + 1.6, z);
    const wood = new THREE.MeshStandardMaterial({ color: '#5a4030', roughness: 0.85 });
    const glowMat = (c) => new THREE.MeshBasicMaterial({ color: col(c).multiplyScalar(2), toneMapped: false });

    if (L.kind === 'oak') {
      this.#instanceTrees(g, r, [[x, y, z, 1.35]], 'Oak Large', null, 1);
      for (let i = 0; i < 36; i++) {
        const a = (i / 36) * Math.PI * 2, d = 6 + r() * 2;
        this.plant(x + Math.cos(a) * d, z + Math.sin(a) * d, '#fff3c4');
      }
    } else if (L.kind === 'pier') {
      const water = w.water.level;
      const z0 = z + 10, z1 = z - 22, deck = water + 0.9;
      for (let k = z0; k > z1; k -= 0.95) {
        const plank = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.12, 0.85), wood);
        plank.position.set(x + (r() - 0.5) * 0.06, deck, k);
        plank.rotation.y = (r() - 0.5) * 0.03;
        g.add(plank);
      }
      for (let k = z0; k > z1; k -= 4) for (const sx of [-1.5, 1.5]) {
        const post = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.15, 5, 8), wood);
        post.position.set(x + sx, deck - 2.2, k);
        g.add(post);
      }
      for (const sx of [-1.5, 1.5]) {
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.08, 2.6, 6), wood);
        pole.position.set(x + sx, deck + 1.3, z1 + 0.6);
        const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.46, 0.34), glowMat('#ffb36a'));
        lamp.position.set(x + sx, deck + 2.75, z1 + 0.6);
        const light = new THREE.PointLight('#ffb36a', 2.5, 22, 0);
        light.position.copy(lamp.position);
        g.add(pole, lamp, light);
      }
      this.pier = { x, z0, z1, y: deck + 0.1 };
      y = deck;
      this.markPos.set(x, deck + 1.5, z1 + 2);
    } else if (L.kind === 'gate') {
      const stone = new THREE.MeshStandardMaterial({ color: '#9aa0b8', roughness: 0.9, map: this.rockTex });
      const ring = new THREE.Mesh(new THREE.TorusGeometry(4.6, 0.55, 20, 72), stone);
      ring.position.set(x, y + 4.4, z);
      ring.lookAt(0, y + 4.4, 6);
      const base = new THREE.Mesh(new THREE.CylinderGeometry(2.4, 2.8, 0.6, 24), stone);
      base.position.set(x, y + 0.1, z);
      const disc = new THREE.Mesh(new THREE.CircleGeometry(4.1, 64), new THREE.ShaderMaterial({
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
        uniforms: { uOpen: { value: 0 }, uTime: { value: 0 }, uCol: { value: col('#bfe6ff') } },
        vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); }',
        fragmentShader: `uniform float uOpen, uTime; uniform vec3 uCol; varying vec2 vUv;
          void main(){ vec2 q = vUv - .5; float r = length(q);
            float sw = .5 + .5 * sin(r * 40. - uTime * 2. + atan(q.y, q.x) * 3.);
            float a = (smoothstep(.5, .1, r) * (.25 + .75 * sw) + smoothstep(.5, .46, r) * .6) * (0.06 + uOpen);
            gl_FragColor = vec4(uCol * 1.6, a); }`,
      }));
      disc.position.copy(ring.position);
      disc.quaternion.copy(ring.quaternion);
      this.gate = disc;
      g.add(ring, base, disc);
    } else if (L.kind === 'stones') {
      y = w.water.level;
      const ice = new THREE.MeshStandardMaterial({ color: '#d6ebff', emissive: '#5f8fe0', emissiveIntensity: 0.35, roughness: 0.15, metalness: 0.1, flatShading: true });
      for (let i = 0; i < 9; i++) {
        const a = (i / 9) * Math.PI * 2, h = 2.5 + r() * 3;
        const s = new THREE.Mesh(new THREE.OctahedronGeometry(1, 0), ice);
        s.scale.set(0.8 + r() * 0.4, h, 0.8 + r() * 0.4);
        s.position.set(x + Math.cos(a) * L.radius, y + h * 0.6, z + Math.sin(a) * L.radius);
        s.rotation.y = r() * Math.PI;
        g.add(s);
      }
      this.stonesMat = ice;
      this.markPos.set(x, y + 1.6, z);
    } else if (L.kind === 'island') {
      y = L.height;
      const big = new THREE.Mesh(this.islandGeo, this.islandMat);
      big.userData.shared = true;
      big.position.set(x, y, z);
      big.scale.set(L.radius * 1.6, L.radius * 1.4, L.radius * 1.6);
      g.add(big);
      this.islandTops.push({ x, y: y + 0.2, z, r: L.radius * 1.4 });
      this.#instanceTrees(g, r, [[x + 3, y + 0.25, z - 2, 1.2]], 'Oak Large', null, 1);
      this.markPos.set(x, y + 1.6, z);
    }

    // A faint column of light, so the place can be found from anywhere.
    const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 1.6, 320, 24, 1, true).translate(0, 160, 0), new THREE.ShaderMaterial({
      transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
      uniforms: { uCol: { value: col(w.particles.color) }, opacity: { value: 0.06 } },
      vertexShader: `varying float vEdge, vY;
        void main() { vec4 mv = modelViewMatrix * vec4(position, 1.0); vec3 n = normalize(normalMatrix * normal);
          vEdge = abs(dot(n, normalize(-mv.xyz))); vY = uv.y; gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `uniform vec3 uCol; uniform float opacity; varying float vEdge, vY;
        void main() { gl_FragColor = vec4(uCol, pow(vEdge, 4.0) * (1.0 - vY) * opacity * 2.6); }`,
    }));
    pillar.position.set(x, y, z);
    this.pillar = pillar;
    g.add(pillar);
    this.scene.add(g);
  }

  /** Two people at the meeting place: the world answers. */
  moment(kind) {
    const p = this.markPos, w = this.w;
    const r = Math.random;
    if (kind === 'petals') {
      for (let i = 0; i < 700; i++) {
        const a = r() * Math.PI * 2, d = r() * 14;
        this.glows.emit({ x: p.x + Math.cos(a) * d, y: p.y + r() * 3, z: p.z + Math.sin(a) * d }, { x: Math.cos(a) * 2, y: 2 + r() * 5, z: Math.sin(a) * 2 },
          this._c.set(w.flowers.colors[i % w.flowers.colors.length]), 0.35 + r() * 0.4, 6 + r() * 6, -0.1);
      }
      for (let i = 0; i < 220; i++) {
        const a = r() * Math.PI * 2, d = 3 + Math.sqrt(r()) * 28;
        this.plant(p.x + Math.cos(a) * d, p.z + Math.sin(a) * d, w.flowers.colors[i % w.flowers.colors.length], d * 0.06);
      }
    } else if (kind === 'lanterns') {
      for (let i = 0; i < 360; i++) {
        const a = r() * Math.PI * 2, d = 4 + Math.sqrt(r()) * 70;
        this.lanterns.emit({ x: p.x + Math.cos(a) * d, y: w.water.level + 0.6, z: p.z - 20 + Math.sin(a) * d }, { x: (r() - 0.5) * 0.4, y: 0.6 + r() * 1.2, z: (r() - 0.5) * 0.4 },
          this._c.set(i % 3 ? '#ffb35c' : '#ff8a4a'), 1.4 + r() * 1.2, 40 + r() * 20, 0.02);
      }
    } else if (kind === 'gate') {
      this.boost.gate = 1;
      this.boost.stars = 1;
      for (let i = 0; i < 420; i++) {
        const a = r() * Math.PI * 2, d = 2 + r() * 30;
        this.glows.emit({ x: p.x + Math.cos(a) * d, y: p.y + r() * 6, z: p.z + Math.sin(a) * d }, { x: -Math.cos(a) * 1.2, y: 0.3 + r(), z: -Math.sin(a) * 1.2 },
          this._c.set(i % 2 ? '#d8ff8a' : '#8affd6'), 0.4, 8 + r() * 6, 0);
      }
    } else if (kind === 'aurora') {
      this.boost.aurora = 2.6;
      for (let i = 0; i < 300; i++) this.sparks.emit(p, { x: (r() - 0.5) * 12, y: 4 + r() * 16, z: (r() - 0.5) * 12 }, this._c.set(i % 2 ? '#7dffb2' : '#b28cff'), 0.5, 4, -0.8);
    } else if (kind === 'sunrise') {
      this.boost.sun = 1.6;
      for (let i = 0; i < 500; i++) {
        const a = r() * Math.PI * 2, d = r() * 20;
        this.glows.emit({ x: p.x + Math.cos(a) * d, y: p.y + r() * 4, z: p.z + Math.sin(a) * d }, { x: Math.cos(a) * 3, y: 1 + r() * 4, z: Math.sin(a) * 3 },
          this._c.set(i % 2 ? '#ffe3a6' : '#ffffff'), 0.5, 7 + r() * 5, -0.05);
      }
    }
  }

  #ambient() {
    const P = this.w.particles;
    if (this.air) { this.scene.remove(this.air); disposeTree(this.air); }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(P.count * 3), 3));
    const r = rng(this.w.seed + 99);
    g.setAttribute('seed', new THREE.BufferAttribute(Float32Array.from({ length: P.count * 4 }, () => r()), 4));
    const u = (v) => ({ value: v });
    this.air = new THREE.Points(g, new THREE.ShaderMaterial({
      vertexShader: AMBIENT_VERT, fragmentShader: AMBIENT_FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: {
        time: u(0), size: u(P.size), sway: u(P.sway), twinkle: u(P.twinkle), center: u(new THREE.Vector3()),
        box: u(new THREE.Vector3(...P.box)), vel: u(new THREE.Vector3(...P.vel)), color: u(col(P.color)), color2: u(col(P.color2)),
        energy: u(0), shape: u(P.kind === 'lantern' ? 1 : 0),
      },
    }));
    this.air.frustumCulled = false;
    this.scene.add(this.air);
  }

  // ── things people do ──

  /** Light that rises from each note of the music, tinted by its pitch. */
  mote(n, v) {
    const P = this.w.particles;
    this._c.set(P.color).lerp(col(P.color2), (((n % 12) + 12) % 12) / 11);
    const a = Math.random() * Math.PI * 2, d = 3 + Math.random() * 10;
    this._v.set(this.focus.x + Math.cos(a) * d, this.focus.y - 1 + Math.random() * 3, this.focus.z + Math.sin(a) * d);
    this.glows.emit(this._v, { x: 0, y: 0.6 + v, z: 0 }, this._c, 0.3 + v * 0.8, 2.6 + v * 2, 0.1);
  }

  /** Tell the grass and the light where the two of you are. */
  setPlayer(i, pos, color, light) {
    this.players[i].copy(pos);
    this.playerLights[i][0].copy(color);
    this.playerLights[i][1] = light;
  }

  burst(kind, p, colorHex, seed) {
    const r = rng(seed);
    const c = col(colorHex);
    const pos = new THREE.Vector3(...p);
    const rnd = () => r() * 2 - 1;
    if (kind === 'heart') {
      const pink = col('#ff7aa2');
      for (let i = 0; i < 26; i++) this.hearts.emit(pos, { x: rnd() * 3, y: 1.5 + r() * 3.5, z: rnd() * 3 }, this._c.copy(c).lerp(pink, r() * 0.7), 0.6 + r() * 0.8, 2.6 + r() * 1.6, 0.5);
    } else if (kind === 'spark') {
      for (let i = 0; i < 90; i++) {
        const v = new THREE.Vector3(rnd(), rnd(), rnd()).normalize().multiplyScalar(4 + r() * 6);
        this.sparks.emit(pos, v, this._c.copy(c).lerp(col('#ffffff'), r() * 0.6), 0.25 + r() * 0.45, 1.4 + r(), -0.6);
      }
    } else if (kind === 'wave') {
      for (let i = 0; i < 48; i++) {
        const a = (i / 48) * Math.PI * 2;
        this.sparks.emit(pos, { x: Math.cos(a) * 7, y: 0.4, z: Math.sin(a) * 7 }, c, 0.45, 1.6, 0);
      }
    } else if (kind === 'bloom') {
      const palette = this.w.flowers.count ? this.w.flowers.colors : ['#ffd6e8', '#fff3c4', '#ffffff'];
      for (let ring = 0; ring < 3; ring++) {
        const count = 10 + ring * 8;
        for (let i = 0; i < count; i++) {
          const a = (i / count) * Math.PI * 2 + r(), d = 1.8 + ring * 1.7 + r();
          this.plant(pos.x + Math.cos(a) * d, pos.z + Math.sin(a) * d, palette[Math.floor(r() * palette.length)], ring * 0.25 + r() * 0.2);
        }
      }
      for (let i = 0; i < 40; i++) this.glows.emit(pos, { x: rnd() * 2, y: 1 + r() * 2, z: rnd() * 2 }, c, 0.5, 2.5, 0.2);
    } else if (kind === 'wish') {
      const a = r() * Math.PI * 2;
      const from = new THREE.Vector3(pos.x + Math.cos(a) * 380, pos.y + 220 + r() * 80, pos.z + Math.sin(a) * 380);
      const to = from.clone().add(new THREE.Vector3(Math.cos(a + 1.9) * 420, -140, Math.sin(a + 1.9) * 420));
      this.wishes.push({ from, to, t: 0, dur: 2.2, color: c });
    } else if (kind === 'beacon') {
      const mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 1.4, 260, 18, 1, true).translate(0, 130, 0), new THREE.MeshBasicMaterial({
        color: c.clone().multiplyScalar(1.8), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false,
      }));
      mesh.position.set(pos.x, this.surfaceAt(pos.x, pos.z), pos.z);
      this.scene.add(mesh);
      this.beacons.push({ mesh, t: 0 });
      for (let i = 0; i < 60; i++) this.sparks.emit(mesh.position, { x: rnd() * 1.5, y: 6 + r() * 14, z: rnd() * 1.5 }, c, 0.6, 3, -0.5);
    }
  }

  /** The thread between you. `strength` 0..1 is how close you are; held hands make it blaze. */
  setThread(a, b, ca, cb, strength, held, t, dt) {
    const target = b ? (held ? 1 : 0.12 + 0.45 * strength) : 0;
    this.threadAlpha += (target - this.threadAlpha) * Math.min(1, dt * 3);
    this.thread.visible = !!b && this.threadAlpha > 0.01;
    if (!this.thread.visible) return;
    const g = this.thread.geometry, P = g.attributes.position.array, T = g.attributes.tint.array, S = g.attributes.size.array, A = g.attributes.alpha.array;
    const dist = a.distanceTo(b);
    const sag = Math.min(held ? 4 : 16, dist * 0.18);
    const n = this.threadN;
    const far = Math.max(1, dist / 30); // further apart, bigger beads, so the thread reads across the land
    for (let i = 0; i < n; i++) {
      const k = i / (n - 1);
      const lift = Math.sin(k * Math.PI);
      P[i * 3] = a.x + (b.x - a.x) * k;
      P[i * 3 + 1] = a.y + (b.y - a.y) * k - sag * lift + Math.sin(t * 3 + k * 12) * 0.12 * lift;
      P[i * 3 + 2] = a.z + (b.z - a.z) * k;
      this._c.copy(ca).lerp(cb, k).toArray(T, i * 3);
      S[i] = (held ? 0.24 : 0.15) * far + 0.16 * Math.sin(t * 6 - k * 20) ** 2;
      A[i] = this.threadAlpha * (0.5 + 0.5 * Math.sin(t * 4 - k * 14) ** 2);
    }
    for (const name of ['position', 'tint', 'size', 'alpha']) g.attributes[name].needsUpdate = true;
  }

  setCloseness(k) { this.closeness = k; }

  /** Once the meeting place has answered, its light column dims: the job is done. */
  set met(v) { this.metFlag = v; }

  render(dt, t, energy) {
    const cam = this.camera.position;
    this.sky.position.copy(cam);
    const su = this.sky.material.uniforms;
    for (const k of Object.keys(this.boost)) this.boost[k] = Math.max(0, this.boost[k] - dt * (k === 'gate' ? 0.04 : 0.05));
    su.time.value = t;
    su.aurora.value = this.w.sky.aurora * (1 + this.boost.aurora) + this.boost.aurora * 0.3;
    su.stars.value = this.w.sky.stars * (1 + this.boost.stars * 0.8);
    su.sunBoost.value = this.boost.sun;
    if (this.gate) { this.gate.material.uniforms.uOpen.value = Math.min(1, this.boost.gate * 1.4); this.gate.material.uniforms.uTime.value = t; }
    if (this.stonesMat) this.stonesMat.emissiveIntensity = 0.35 + this.boost.aurora * 0.8;
    if (this.pillar) this.pillar.material.uniforms.opacity.value = this.metFlag ? 0.02 : 0.05 + 0.025 * Math.sin(t * 0.8);

    this.water.material.uniforms.time.value += dt * (this.w.water?.ice ? 0.05 : 0.45);

    const gu = this.grass.material.uniforms;
    gu.uTime.value = t;
    gu.uCenter.value.copy(cam);
    gu.uCam.value.copy(cam);
    gu.uP0.value.copy(this.players[0]); gu.uP1.value.copy(this.players[1]);
    gu.uC0.value.copy(this.playerLights[0][0]); gu.uL0.value = this.playerLights[0][1] * 0.25;
    gu.uC1.value.copy(this.playerLights[1][0]); gu.uL1.value = this.playerLights[1][1] * 0.25;
    gu.uWind.value.set(Math.sin(t * 0.13) * 0.25 + 0.45 * this.w.wind, Math.cos(t * 0.09) * 0.2 + 0.2 * this.w.wind);

    for (const tree of this.treeSources) tree.update(t);

    const au = this.air.material.uniforms;
    au.time.value = t; au.center.value.copy(cam); au.energy.value = energy * (0.6 + 0.6 * this.closeness);

    // Together, the world is a little warmer and brighter; apart, a little greyer.
    this.grade.uniforms.uSat.value = this.w.grade.sat * (0.82 + 0.22 * this.closeness);
    this.grade.uniforms.uTime.value = t;
    this.bloom.strength = this.w.bloom * (0.8 + 0.35 * this.closeness) + energy * 0.15;

    for (let k = this.growing.length - 1; k >= 0; k--) {
      const f = this.growing[k];
      f.t += dt;
      if (f.t < 0) continue;
      const g = Math.min(1, f.t / 0.9);
      const s = f.s * (1 + 0.25 * Math.sin(g * Math.PI)) * g;
      this._q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, f.i);
      this.flowers.setMatrixAt(f.i, this._m.compose(this._v.set(f.x, f.y, f.z), this._q, this._s.set(s, s, s)));
      this.flowers.instanceMatrix.needsUpdate = true;
      if (g >= 1) this.growing.splice(k, 1);
    }

    for (let k = this.beacons.length - 1; k >= 0; k--) {
      const b = this.beacons[k];
      b.t += dt;
      b.mesh.material.opacity = Math.min(1, b.t * 2) * Math.max(0, 1 - b.t / 8) * 0.55;
      if (b.t > 8) { this.scene.remove(b.mesh); b.mesh.geometry.dispose(); b.mesh.material.dispose(); this.beacons.splice(k, 1); }
    }

    for (let k = this.wishes.length - 1; k >= 0; k--) {
      const s = this.wishes[k];
      s.t += dt;
      const p = this._v.copy(s.from).lerp(s.to, Math.min(1, s.t / s.dur));
      for (let i = 0; i < 5; i++) this.sparks.emit(p, { x: (Math.random() - 0.5) * 2, y: (Math.random() - 0.5) * 2, z: (Math.random() - 0.5) * 2 }, s.color, 9 - i, 0.9 + Math.random() * 0.6, 0);
      if (s.t > s.dur) this.wishes.splice(k, 1);
    }

    this.hearts.update(dt);
    this.sparks.update(dt);
    this.glows.update(dt);
    this.lanterns.update(dt, 0.02);
    this.composer.render(dt);
  }
}
