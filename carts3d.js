// 3D-модели картриджей: процедурная геометрия по реальным размерам (мм) + рендер в 2D-холсты.
import * as THREE from 'three';
import { RoomEnvironment } from './vendor/RoomEnvironment.js';
import { GLTFLoader } from './vendor/loaders/GLTFLoader.js';

/* ---------- контуры ---------- */
// точки [x, y, r]: r>0 — скругление, r<0 — фаска, 0 — острый угол. Ось Y вверх, мм.
function poly(pts, path = new THREE.Shape()){
  const n = pts.length;
  for (let i = 0; i < n; i++){
    const [x, y, r = 0] = pts[i], [px, py] = pts[(i - 1 + n) % n], [nx, ny] = pts[(i + 1) % n];
    if (!r){ i ? path.lineTo(x, y) : path.moveTo(x, y); continue; }
    const ra = Math.abs(r), d1 = Math.hypot(px - x, py - y), d2 = Math.hypot(nx - x, ny - y);
    const a = [x + (px - x) / d1 * ra, y + (py - y) / d1 * ra], b = [x + (nx - x) / d2 * ra, y + (ny - y) / d2 * ra];
    i ? path.lineTo(...a) : path.moveTo(...a);
    if (r > 0) path.quadraticCurveTo(x, y, ...b); else path.lineTo(...b);
  }
  path.closePath();
  return path;
}
const rr = (x0, y0, x1, y1, r) => [[x0, y0, r], [x1, y0, r], [x1, y1, r], [x0, y1, r]];
const circ = (cx, cy, r) => { const p = new THREE.Path(); p.absarc(cx, cy, r, 0, Math.PI * 2, true); return p; };
const lines = (n, f) => Array.from({ length: n }, (_, i) => f(i));

/* ---------- шаблоны: размеры и детали ---------- */
// k — пикселей доски на мм; T — толщина; label — прямоугольник этикетки [x0,y0,x1,y1,r]; extras — рёбра [cx,cy,w,h,d]
export const TPL = {
  gb: { name: 'Game Boy', k: 2.0, T: 7.7,
    outline: [[-28.5, -32.5, 2.5], [28.5, -32.5, 2.5], [28.5, 27.5], [23.5, 32.5], [-28.5, 32.5, 2.5]],
    label: [-24.5, -22, 24.5, 21, 1.5],
    extras: [[-2, 26.8, 40, 5, .45], ...lines(5, i => [0, -25 - i * 1.5, 30, .7, .45])] },
  gba: { name: 'GBA', k: 2.2, T: 8,
    outline: [[-28.5, -17.5, 2], [28.5, -17.5, 2], [28.5, 14.5, 2], [15.5, 14.5, 1.2], [13.5, 17.8, 1.5], [-13.5, 17.8, 1.5], [-15.5, 14.5, 1.2], [-28.5, 14.5, 2]],
    label: [-25, -14.5, 25, 11.5, 1.2],
    extras: [[0, 15.7, 20, .55, .35], [0, 16.8, 16, .55, .35]] },
  ds: { name: 'DS', k: 2.7, T: 3.8,
    outline: [[-16.5, -17.5, 1], [16.5, -17.5, 1], [16.5, 17.5, 1], [-13.5, 17.5], [-16.5, 14.5]],
    label: [-14, -15.5, 14, 10.5, 1],
    extras: lines(3, i => [.8, 12.6 + i * 1.5, 22, .6, .3]) },
  n3ds: { name: '3DS', k: 2.7, T: 3.8,
    outline: [[-16.5, -17.5, 1], [16.5, -17.5, 1], [16.5, 9], [17.9, 9.4, .5], [17.9, 12.6, .5], [16.5, 13], [16.5, 17.5, 1], [-13.5, 17.5], [-16.5, 14.5]],
    label: [-14, -15.5, 14, 10.5, 1],
    extras: lines(3, i => [.8, 12.6 + i * 1.5, 22, .6, .3]) },
  vita: { name: 'PS Vita', k: 3.0, T: 2.2,
    outline: [[-11, -15, 1.2], [11, -15, 1.2], [11, 15, 1.2], [-8.5, 15], [-11, 12.5]],
    label: [-9.6, -13.6, 9.6, 10.6, .8],
    extras: lines(3, i => [.8, 12 + i * 1, 14, .45, .25]) },
  sw: { name: 'Switch', k: 3.0, T: 3.3,
    outline: [[-10.5, -15.5, 1.4], [10.5, -15.5, 1.4], [10.5, 14], [9, 15.5], [-10.5, 15.5, 1.4]],
    label: [-9.2, -14.2, 9.2, 10.2, .8],
    extras: lines(3, i => [0, 11.6 + i * 1.1, 15, .5, .3]) },
  umd: { name: 'PSP · UMD', k: 1.95, T: 4.2,
    outline: [[-32, 32.5, 3.5], [32, 32.5, 3.5], [32, -32.5, 22], [-32, -32.5, 22]],
    disc: { cx: 0, cy: -4, r: 26 }, strip: [-26, 21, 26, 29, 1],
    extras: [] },
  home: { name: 'Домашняя', k: 1.25, T: 16,
    outline: [[-60, -67.5, 3], [60, -67.5, 3], [60, 67.5, 3], [-60, 67.5, 3]],
    label: [-50, -26, 50, 58, 2],
    extras: [...lines(7, i => [-56, 44 - i * 4, 5, 1.6, .6]), ...lines(7, i => [56, 44 - i * 4, 5, 1.6, .6]), ...lines(5, i => [0, -38 - i * 3.2, 76, 1.2, .6])] },
};
for (const t of Object.values(TPL)){
  t.k *= 1.5;   // картриджи на доске крупнее
  const xs = t.outline.map(p => p[0]), ys = t.outline.map(p => p[1]);
  t.bb = { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
  t.bb.W = t.bb.x1 - t.bb.x0; t.bb.H = t.bb.y1 - t.bb.y0;
  t.w = Math.round(t.bb.W * t.k); t.h = Math.round(t.bb.H * t.k);
  t.M = Math.max(t.bb.W, t.bb.H) * .1 + t.T * .5;   // поля холста под наклон
}
export const tplOf = c => TPL[c.platform] || TPL.gb;

// Простая UV-проекция: фактура пластика должна лечь на любую грань
function addUV(g){
  const p = g.attributes.position, n = g.attributes.normal, uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++){
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const ax = n ? Math.abs(n.getX(i)) : 0, ay = n ? Math.abs(n.getY(i)) : 0;
    let u, v;
    if (ax > .6){ u = z; v = y; } else if (ay > .6){ u = x; v = z; } else { u = x; v = y; }
    uv[i * 2] = u / 18; uv[i * 2 + 1] = v / 18;
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
}

/* ---------- фактура пластика: мелкое зерно для рельефа и шероховатости ---------- */
let grainTex = null;
function grain(){
  if (grainTex) return grainTex;
  const S = 256, cv = document.createElement('canvas'); cv.width = cv.height = S;
  const x = cv.getContext('2d'), img = x.createImageData(S, S);
  for (let i = 0; i < S * S; i++){
    const n = 150 + (Math.random() * 2 - 1) * 55 + (Math.random() < .015 ? 35 : 0);
    img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = n; img.data[i * 4 + 3] = 255;
  }
  x.putImageData(img, 0, 0);
  x.globalAlpha = .5; x.filter = 'blur(.6px)'; x.drawImage(cv, 0, 0);
  grainTex = new THREE.CanvasTexture(cv);
  grainTex.wrapS = grainTex.wrapT = THREE.RepeatWrapping;
  grainTex.colorSpace = THREE.NoColorSpace;
  return grainTex;
}

// блёстки в пластике: B — металл (хлопья), G — шероховатость
let flakeTex = null;
function flakes(){
  if (flakeTex) return flakeTex;
  const S = 256, cv = document.createElement('canvas'); cv.width = cv.height = S;
  const x = cv.getContext('2d');
  x.fillStyle = 'rgb(0,150,0)'; x.fillRect(0, 0, S, S);
  for (let i = 0; i < 1400; i++){
    const r = 1 + Math.random() * 1.6, px = Math.random() * S, py = Math.random() * S;
    x.fillStyle = `rgb(0,${20 + Math.random() * 40 | 0},${200 + Math.random() * 55 | 0})`;
    x.fillRect(px, py, r, r);
  }
  flakeTex = new THREE.CanvasTexture(cv);
  flakeTex.wrapS = flakeTex.wrapT = THREE.RepeatWrapping; flakeTex.colorSpace = THREE.NoColorSpace;
  flakeTex.magFilter = THREE.NearestFilter;
  return flakeTex;
}
// плата внутри полупрозрачного корпуса
let pcbTex = null;
function pcb(){
  if (pcbTex) return pcbTex;
  const W = 256, H = 256, cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const x = cv.getContext('2d');
  x.fillStyle = '#1d5e36'; x.fillRect(0, 0, W, H);
  x.strokeStyle = '#c9a24a'; x.lineWidth = 2; x.globalAlpha = .7;
  for (let i = 0; i < 26; i++){
    let px = Math.random() * W, py = Math.random() * H; x.beginPath(); x.moveTo(px, py);
    for (let k = 0; k < 4; k++){ if (Math.random() < .5) px += (Math.random() - .5) * 120; else py += (Math.random() - .5) * 120; x.lineTo(px, py); }
    x.stroke();
  }
  x.globalAlpha = 1;
  for (const [cx, cy, w, h] of [[70, 80, 70, 60], [160, 150, 50, 40]]){ x.fillStyle = '#16181b'; x.fillRect(cx, cy, w, h); x.fillStyle = '#9aa0a6'; for (let i = 0; i < 6; i++){ x.fillRect(cx - 5, cy + 5 + i * (h - 10) / 6, 5, 3); x.fillRect(cx + w, cy + 5 + i * (h - 10) / 6, 5, 3); } }
  x.fillStyle = '#d7b452'; for (let i = 0; i < 14; i++) x.fillRect(20 + i * 16, H - 26, 10, 22);
  pcbTex = new THREE.CanvasTexture(cv); pcbTex.colorSpace = THREE.SRGBColorSpace;
  return pcbTex;
}

/* ---------- логотипы консолей ---------- */
const LOGO = {};
const loadLogo = k => new Promise(res => { const im = new Image(); im.onload = () => { LOGO[k] = im; res(); }; im.onerror = () => res(); im.src = `models/logos/${k}.png`; });
// полоска с логотипом сверху этикетки (по желанию): h — доля высоты этикетки
const BRAND = { ds: { img: 'ds', bg: '#fbfbfb', h: .17, line: '#c9cdd2' }, n3ds: { img: 'n3ds', bg: '#fbfbfb', h: .17, line: '#c9cdd2' }, sw: { img: 'sw', bg: '#e60012', h: .19 } };
export const brandName = p => ({ ds: 'Nintendo DS', n3ds: 'Nintendo 3DS', sw: 'Nintendo Switch' })[p] || '';
// рельефная надпись на корпусе над этикеткой: прямоугольник [cx, cy, w, h] в мм
const EMBOSS = { gb: [-1, 22.5, 40, 7], gba: [0, 11, 27.4, 3.2] };

// Готовые модели: models/manifest.json + *.glb (мм, лицом к +Z, верх +Y, центр в 0)
export async function loadModels(){
  await Promise.all(['ds', 'n3ds', 'sw', 'gba-plate', 'gba-letters'].map(loadLogo));
  try {
    const mf = await (await fetch('models/manifest.json', { cache: 'no-store' })).json();
    const loader = new GLTFLoader();
    await Promise.all(Object.entries(mf).map(async ([plat, m]) => {
      const t = TPL[plat]; if (!t) return;
      const g = await loader.loadAsync(m.file);
      g.scene.updateMatrixWorld(true);
      const parts = [];
      g.scene.traverse(o => { if (o.isMesh){ const geo = o.geometry.clone().applyMatrix4(o.matrixWorld); addUV(geo); parts.push({ geo, mat: (o.material && o.material.name) || 'cb_shell' }); } });
      const [x0, y0, x1, y1] = m.bb;
      t.bb = { x0, y0, x1, y1, W: x1 - x0, H: y1 - y0 };
      t.T = m.T; t.round = !!m.round;
      t.w = Math.round(t.bb.W * t.k); t.h = Math.round(t.bb.H * t.k);
      t.M = Math.max(t.bb.W, t.bb.H) * .1 + t.T * .5;
      const [lx0, ly0, lx1, ly1] = m.label;
      let lg;
      if (t.round){
        const cx = (lx0 + lx1) / 2, cy = (ly0 + ly1) / 2, r = (lx1 - lx0) / 2;
        lg = new THREE.RingGeometry(r * .3, r, 72, 1).translate(cx, cy, 0);
      } else lg = uvNormalize(new THREE.ShapeGeometry(poly(rr(lx0, ly0, lx1, ly1, 1)), 12), lx0, ly0, lx1 - lx0, ly1 - ly0);
      lg.translate(0, 0, m.labelZ + .04);
      t.label = [lx0, ly0, lx1, ly1, 1];
      t.glb = { parts, labelGeo: lg };
      t.disc = null;
      const e = EMBOSS[plat];
      if (e){
        // высота лицевой поверхности под надписью — лучом сверху
        const meshes = parts.map(p => new THREE.Mesh(p.geo));
        const hit = new THREE.Raycaster(new THREE.Vector3(e[0], e[1], 100), new THREE.Vector3(0, 0, -1)).intersectObjects(meshes)[0];
        t.emb = { geo: new THREE.PlaneGeometry(e[2], e[3]).translate(e[0], e[1], (hit ? hit.point.z : m.labelZ) + .03), w: e[2], h: e[3] };
      }
    }));
    return true;
  } catch (e){ console.warn('модели не загружены:', e); return false; }
}
export function canvasBox(c){
  const t = tplOf(c);
  return { left: -t.M * t.k, top: -t.M * t.k, width: (t.bb.W + 2 * t.M) * t.k, height: (t.bb.H + 2 * t.M) * t.k };
}

/* ---------- геометрия (кэш по платформе) ---------- */
const RIM = .9, BEV = .7;
function uvNormalize(g, x0, y0, w, h){
  const p = g.attributes.position, uv = g.attributes.uv;
  for (let i = 0; i < p.count; i++) uv.setXY(i, (p.getX(i) - x0) / w, (p.getY(i) - y0) / h);
  uv.needsUpdate = true;
  return g;
}
const geoCache = {};
function geos(key){
  if (geoCache[key]) return geoCache[key];
  const t = TPL[key], T = t.T, G = {};
  const bevel = Math.min(BEV, T * .18);
  const bodyShape = poly(t.outline);
  if (t.disc) bodyShape.holes.push(circ(t.disc.cx, t.disc.cy, t.disc.r));
  G.body = new THREE.ExtrudeGeometry(bodyShape, { depth: Math.max(.1, T - RIM - 2 * bevel), bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelOffset: -bevel, bevelSegments: 3, curveSegments: 20 });
  G.body.translate(0, 0, bevel);
  const rimShape = poly(t.outline);
  if (t.label) rimShape.holes.push(poly(rr(...t.label.slice(0, 4), t.label[4]), new THREE.Path()));
  if (t.disc) rimShape.holes.push(circ(t.disc.cx, t.disc.cy, t.disc.r + 1.2));
  if (t.strip) rimShape.holes.push(poly(rr(...t.strip.slice(0, 4), t.strip[4]), new THREE.Path()));
  G.rim = new THREE.ExtrudeGeometry(rimShape, { depth: RIM - .3, bevelEnabled: true, bevelThickness: .15, bevelSize: .2, bevelOffset: -.2, bevelSegments: 2, curveSegments: 20 });
  G.rim.translate(0, 0, T - RIM + .15);
  if (t.label){
    const [x0, y0, x1, y1, r] = t.label;
    G.label = uvNormalize(new THREE.ShapeGeometry(poly(rr(x0, y0, x1, y1, r)), 12), x0, y0, x1 - x0, y1 - y0);
    G.label.translate(0, 0, T - RIM + .03);
  }
  if (t.disc){
    const { cx, cy, r } = t.disc;
    G.back = new THREE.CircleGeometry(r + .5, 64).translate(cx, cy, .25);
    G.disc = new THREE.CylinderGeometry(r - .6, r - .6, 1.1, 72).rotateX(Math.PI / 2).translate(cx, cy, 1.6);
    G.ring = new THREE.RingGeometry(6.8, r - 3.2, 72, 1).translate(cx, cy, 2.17);
    G.hub = new THREE.CylinderGeometry(6.2, 6.2, .5, 48).rotateX(Math.PI / 2).translate(cx, cy, 2.3);
    G.hole = new THREE.CircleGeometry(2.2, 32).translate(cx, cy, 2.56);
    G.glass = new THREE.CircleGeometry(r + 1.2, 72).translate(cx, cy, T - .08);
  }
  G.extras = t.extras.map(([cx, cy, w, h, d]) => new THREE.BoxGeometry(w, h, d).translate(cx, cy, T + d / 2 - .05));
  return geoCache[key] = G;
}

/* ---------- этикетка ---------- */
const imgCache = new Map();
let redrawHook = () => {};
export const onNeedRedraw = f => { redrawHook = f; };
function getImg(src, id){
  let im = imgCache.get(src);
  if (!im){ im = new Image(); im.onload = () => { for (const [cid, m] of models) if (m.src === src) { m.key = ''; redrawHook(cid); } }; im.src = src; imgCache.set(src, im); }
  return im.complete && im.naturalWidth ? im : null;
}
const rgb = h => { h = h.replace('#', ''); const n = parseInt(h.length === 3 ? h.split('').map(x => x + x).join('') : h, 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; };
const mix = (h, to, a) => '#' + rgb(h).map((v, i) => Math.round(v + (to[i] - v) * a).toString(16).padStart(2, '0')).join('');
const lum = h => { const [r, g, b] = rgb(h); return (.299 * r + .587 * g + .114 * b) / 255; };

function fitText(ctx, text, maxW, maxH, maxSize, weight = 800){
  const words = text.split(/\s+/).filter(Boolean);
  for (let s = maxSize; s >= 10; s -= 2){
    ctx.font = `${weight} ${s}px "Segoe UI", system-ui, sans-serif`;
    const out = []; let cur = '', ok = true;
    for (const w of words){
      if (ctx.measureText(w).width > maxW){ ok = false; break; }
      const t = cur ? cur + ' ' + w : w;
      if (ctx.measureText(t).width <= maxW) cur = t; else { out.push(cur); cur = w; }
    }
    if (!ok) continue;
    if (cur) out.push(cur);
    if (out.length * s * 1.08 <= maxH) return { size: s, lines: out };
  }
  ctx.font = `${weight} 10px "Segoe UI", sans-serif`;
  return { size: 10, lines: [text.slice(0, 40)] };
}

function edgeShade(x, W, H, round){
  x.save();
  x.globalCompositeOperation = 'source-over';
  if (round){
    const g = x.createRadialGradient(W / 2, H / 2, W * .38, W / 2, H / 2, W * .5);
    g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(.75, 'rgba(0,0,0,.28)'); g.addColorStop(1, 'rgba(0,0,0,.6)');
    x.fillStyle = g; x.fillRect(0, 0, W, H);
  } else {
    const d = Math.min(W, H) * .07;
    const side = (x0, y0, x1, y1, a) => { const g = x.createLinearGradient(x0, y0, x1, y1); g.addColorStop(0, `rgba(0,0,0,${a})`); g.addColorStop(1, 'rgba(0,0,0,0)'); x.fillStyle = g; };
    side(0, 0, 0, d, .55); x.fillRect(0, 0, W, d);            // сверху тень от бортика сильнее (свет сверху-слева)
    side(0, 0, d, 0, .5); x.fillRect(0, 0, d, H);
    side(0, H, 0, H - d * .7, .3); x.fillRect(0, H - d, W, d);
    side(W, 0, W - d * .7, 0, .3); x.fillRect(W - d, 0, d, H);
    x.strokeStyle = 'rgba(0,0,0,.55)'; x.lineWidth = Math.max(2, Math.min(W, H) * .008); x.strokeRect(1, 1, W - 2, H - 2);
    x.strokeStyle = 'rgba(255,255,255,.25)'; x.lineWidth = 1.5; x.beginPath(); x.moveTo(W - 2, 3); x.lineTo(W - 2, H - 2); x.lineTo(3, H - 2); x.stroke();
  }
  x.restore();
}
function drawLabel(c, t, round){
  const lw = round ? 1 : t.label[2] - t.label[0], lh = round ? 1 : t.label[3] - t.label[1];
  const S = 512, W = Math.round(lw >= lh ? S : S * lw / lh), H = Math.round(lh >= lw ? S : S * lh / lw);
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const x = cv.getContext('2d');
  const br = !round && c.fx && c.fx.brand && BRAND[c.platform], logo = br && LOGO[br.img];
  if (logo){
    // сверху — полоска с логотипом консоли, ниже — сама этикетка
    const sh = Math.round(H * br.h), face = document.createElement('canvas');
    face.width = W; face.height = H - sh;
    drawFace(c, t, false, face.getContext('2d'), W, H - sh, true);
    x.drawImage(face, 0, sh);
    x.fillStyle = br.bg; x.fillRect(0, 0, W, sh);
    if (br.line){ x.fillStyle = br.line; x.fillRect(0, sh - 2, W, 2); }
    const k = Math.min(W * .84 / logo.width, sh * .58 / logo.height), lw2 = logo.width * k, lh2 = logo.height * k;
    x.drawImage(logo, (W - lw2) / 2, (sh - lh2) / 2 + sh * .03, lw2, lh2);
  } else drawFace(c, t, round, x, W, H, false);
  edgeShade(x, W, H, round);
  return cv;
}
function drawFace(c, t, round, x, W, H, branded){
  const lc = c.labelColor || '#2f7de0';
  const img = c.image ? getImg(c.image, c.id) : null;
  if (img){
    const k = Math.max(W / img.width, H / img.height);
    x.drawImage(img, (W - img.width * k) / 2, (H - img.height * k) / 2, img.width * k, img.height * k);
    if (c.showTitle && c.title){
      const { size, lines } = fitText(x, c.title, W * (round ? .5 : .9), H * .14, Math.round(H * .085), 700);
      const bh = size * 1.35 * lines.length + 10, by = round ? H * .63 : H - bh;
      x.fillStyle = 'rgba(0,0,0,.62)';
      x.fillRect(round ? W * .22 : 0, by, round ? W * .56 : W, bh);
      x.fillStyle = '#fff'; x.textAlign = 'center'; x.textBaseline = 'top';
      lines.forEach((l, i) => x.fillText(l, W / 2, by + 5 + i * size * 1.3));
    }
    return;
  }
  const g = round ? x.createRadialGradient(W * .4, H * .35, 10, W / 2, H / 2, W * .6) : x.createLinearGradient(0, 0, W * .6, H);
  g.addColorStop(0, mix(lc, [255, 255, 255], .22)); g.addColorStop(.5, lc); g.addColorStop(1, mix(lc, [0, 0, 0], .4));
  x.fillStyle = g; x.fillRect(0, 0, W, H);
  x.globalAlpha = .06; x.fillStyle = '#fff';
  for (let yy = 0; yy < H; yy += 8) x.fillRect(0, yy, W, 3);
  x.globalAlpha = 1;
  const dark = lum(lc) > .66, col = dark ? '#2a1a0e' : '#fff';
  x.fillStyle = col; x.textAlign = 'center'; x.textBaseline = 'top';
  x.font = `800 ${Math.round(Math.min(W, H) * .07)}px "Segoe UI", sans-serif`;
  if (!branded && !t.emb){   // есть логотип консоли или надпись на корпусе — мелкая подпись не нужна
    x.globalAlpha = .75;
    if (x.letterSpacing !== undefined) x.letterSpacing = '4px';
    x.fillText(t.name.toUpperCase(), W / 2, round ? H * .8 : H * .05);
    if (x.letterSpacing !== undefined) x.letterSpacing = '0px';
    x.globalAlpha = 1;
  }
  const title = c.title || 'Без названия';
  const box = round ? { w: W * .56, h: H * .26, y: H * .14 } : branded ? { w: W * .86, h: H * .84, y: H * .08 } : { w: W * .86, h: H * .74, y: H * .17 };
  const { size, lines } = fitText(x, title, box.w, box.h, Math.round(Math.min(W, H) * .2));
  x.shadowColor = dark ? 'rgba(255,255,255,.35)' : 'rgba(0,0,0,.45)'; x.shadowBlur = 4; x.shadowOffsetY = 2;
  const total = lines.length * size * 1.08, y0 = box.y + (box.h - total) / 2;
  lines.forEach((l, i) => x.fillText(l, W / 2, y0 + i * size * 1.08));
  x.shadowColor = 'transparent';
}

/* ---------- рельефная надпись на корпусе (GB, GBA) ---------- */
const embCache = new Map();
function tinted(mask, color, W, H){
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const x = c.getContext('2d'); x.drawImage(mask, 0, 0, W, H);
  x.globalCompositeOperation = 'source-in'; x.fillStyle = color; x.fillRect(0, 0, W, H);
  return c;
}
// выпуклая (raised) или вдавленная форма: свет сверху-слева
function relief(x, mask, W, H, d, body, hi, lo, raised = true){
  x.drawImage(tinted(mask, raised ? hi : lo, W, H), -d, -d);
  x.drawImage(tinted(mask, raised ? lo : hi, W, H), d, d);
  x.drawImage(tinted(mask, body, W, H), 0, 0);
}
function gbMask(W, H){
  // «Nintendo» в овальной рамке + «GAME BOY™» курсивом
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const x = c.getContext('2d'); x.fillStyle = x.strokeStyle = '#fff'; x.textBaseline = 'middle';
  const pw = W * .3, ph = H * .62, py = (H - ph) / 2, lw = H * .07;
  x.lineWidth = lw; x.beginPath(); x.roundRect(lw, py, pw, ph, ph / 2); x.stroke();
  x.font = `700 ${Math.round(ph * .62)}px "Segoe UI", system-ui, sans-serif`; x.textAlign = 'center';
  x.fillText('Nintendo', lw + pw / 2, H / 2 + ph * .02, pw * .84);
  x.font = `italic 900 ${Math.round(H * .78)}px "Arial Black", "Segoe UI", sans-serif`; x.textAlign = 'left';
  const gx = lw + pw + W * .035;
  x.fillText('GAME BOY', gx, H / 2 + H * .04, W - gx - W * .05);
  x.font = `700 ${Math.round(H * .2)}px "Segoe UI", sans-serif`; x.fillText('TM', W - W * .045, H * .2);
  return c;
}
function embossTex(plat, shell){
  const key = plat + shell;
  if (embCache.has(key)) return embCache.get(key);
  const e = TPL[plat].emb, W = 1024, H = Math.round(W * e.h / e.w);
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const x = cv.getContext('2d'), d = Math.max(2, H * .022);
  const hi = mix(shell, [255, 255, 255], .4), lo = mix(shell, [0, 0, 0], .5);
  if (plat === 'gba'){
    if (!LOGO['gba-plate']) return null;
    relief(x, LOGO['gba-plate'], W, H, d, mix(shell, [255, 255, 255], .05), hi, lo, true);
    relief(x, LOGO['gba-letters'], W, H, d * .8, mix(shell, [0, 0, 0], .12), hi, lo, false);
  } else relief(x, gbMask(W, H), W, H, d * 1.3, mix(shell, [255, 255, 255], .04), hi, lo, true);
  const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
  if (embCache.size > 40){ for (const t of embCache.values()) t && t.dispose(); embCache.clear(); }
  embCache.set(key, tex);
  return tex;
}


/* ---------- эффекты наклейки: накладываемый слой (аддитивно) ---------- */
const FX_VERT = `varying vec2 vUv; varying vec3 vN; varying vec3 vV;
void main(){ vUv = uv; vec4 mv = modelViewMatrix * vec4(position, 1.0); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }`;
const FX_FRAG = `uniform int uMode; varying vec2 vUv; varying vec3 vN; varying vec3 vV;
vec3 hsv(float h, float s, float v){ vec3 k = clamp(abs(mod(h * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0); return v * mix(vec3(1.0), k, s); }
float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
void main(){
  vec2 sh = vN.xy * 2.6 + vV.xy * 0.6;
  vec3 col;
  if (uMode == 3){            // голографическая фольга
    float h = fract(vUv.x * 0.9 + vUv.y * 0.7 + sh.x * 0.9 + sh.y * 0.7);
    float lines = 0.55 + 0.45 * sin((vUv.x * 0.8 + vUv.y) * 140.0 + sh.x * 6.0);
    vec2 cell = floor(vUv * 70.0);
    float tw = step(0.975, hash(cell)) * pow(max(0.0, sin(hash(cell + 7.0) * 40.0 + sh.x * 18.0 + sh.y * 14.0)), 6.0);
    col = hsv(h, 0.85, 1.0) * (0.11 * lines + 0.03) + vec3(tw) * 0.55;
  } else if (uMode == 4){     // разноцветные блёстки
    vec2 cell = floor(vUv * 110.0);
    float r = hash(cell);
    float tw = step(0.9, r) * pow(max(0.0, sin(hash(cell + 3.0) * 50.0 + sh.x * 22.0 + sh.y * 17.0)), 8.0);
    col = hsv(hash(cell + 11.0), 0.55, 1.0) * tw * 0.75;
  } else if (uMode == 5){     // золотая фольга: тёплый бегущий блик
    float d = (vUv.x * 0.7 + vUv.y) * 0.6 - (0.55 + sh.x * 0.45 - sh.y * 0.35);
    col = vec3(1.0, 0.78, 0.38) * (exp(-d * d * 60.0) * 0.3 + 0.06);
  } else if (uMode == 6){     // серебряный вихрь: гравированные кольца, блик-«бабочка» вращается при наклоне
    vec2 p = vUv - 0.5 - sh * 0.06;
    float r = length(p), a = atan(p.y, p.x);
    float rings = 0.5 + 0.5 * sin(r * 120.0 + a * 1.0 - sh.x * 4.0);
    float glint = pow(max(0.0, cos(a * 2.0 - (sh.x - sh.y) * 2.6)), 5.0);
    col = vec3(0.93, 0.96, 1.0) * (0.035 + rings * (0.035 + 0.22 * glint));
  } else if (uMode == 7){     // призма: пастельные осколки, у каждого свой цвет и вспышка
    vec2 q = vec2(vUv.x + vUv.y, vUv.x - vUv.y) * 8.0;
    vec2 cell = floor(q), f = fract(q) - 0.5;
    float tri = step(f.x, f.y), rnd = hash(cell + tri * 17.0);
    float h = fract(rnd * 0.5 + sh.x * 0.8 + sh.y * 0.6 + (vUv.x + vUv.y) * 0.35);
    float flash = pow(0.5 + 0.5 * sin(rnd * 31.0 + sh.x * 9.0 - sh.y * 7.0), 3.0);
    float edge = smoothstep(0.46, 0.5, max(abs(f.x), abs(f.y))) + smoothstep(0.035, 0.0, abs(f.x - f.y));
    col = hsv(h, 0.38, 1.0) * (0.05 + 0.13 * flash) + vec3(edge * 0.06);
  } else if (uMode == 8){     // радужная фольга: плавная радуга по диагонали, плывёт при наклоне
    float h = fract((vUv.y * 0.8 - vUv.x * 0.45) * 0.9 + sh.x * 0.6 + sh.y * 0.5);
    float band = 0.5 + 0.5 * sin((vUv.x - vUv.y) * 6.0 + sh.x * 5.0);
    col = hsv(h, 0.75, 1.0) * (0.13 + 0.1 * band);
  } else if (uMode == 2){     // перламутр
    float h = fract(0.55 + (vUv.y - vUv.x) * 0.35 + sh.x * 0.45 + sh.y * 0.35);
    float wave = 0.5 + 0.5 * sin((vUv.x + vUv.y * 1.3) * 9.0 + sh.x * 4.0);
    col = hsv(h, 0.4, 1.0) * (0.05 + 0.06 * wave);
  } else {                    // глянец: бегущий блик
    float d = (vUv.x + vUv.y) * 0.5 - (0.5 + sh.x * 0.4 - sh.y * 0.4);
    col = vec3(exp(-d * d * 140.0) * 0.26 + exp(-d * d * 14.0) * 0.04);
  }
  gl_FragColor = vec4(col, 1.0);
}`;

/* ---------- модели (кэш по картриджу) ---------- */
const models = new Map();
function disposeModel(m){
  // общие текстуры (зерно, блёстки, плата) не трогаем — освобождаем только свою этикетку
  if (m.tex) m.tex.dispose();
  m.mats.forEach(mt => mt.dispose());
}
function modelFor(c){
  const t = tplOf(c), key = TPL[c.platform] ? c.platform : 'gb';
  const sig = [key, c.shell, c.labelColor, c.title, c.image ? c.image.length + c.image.slice(-40) : '', c.showTitle, c.image ? !!getImg(c.image, c.id) : 0, (c.fx && c.fx.label) || '', (c.fx && c.fx.plastic) || '', c.fx && c.fx.brand && BRAND[c.platform] ? 1 : 0].join('|');
  let m = models.get(c.id);
  if (m && m.key === sig) return m;
  if (m){ disposeModel(m); if (m.src && m.src !== c.image) queueMicrotask(pruneImages); }
  const G = t.glb ? null : geos(key), grp = new THREE.Group(), mats = [];
  const mk = o => { const mt = new THREE.MeshPhysicalMaterial(o); mats.push(mt); return mt; };
  const G0 = grain(), plastic = (c.fx && c.fx.plastic) || 'matte', col = new THREE.Color(c.shell || '#999');
  const PL = {
    matte:   { roughness: .62, roughnessMap: G0, bumpMap: G0, bumpScale: .9, clearcoat: .12, clearcoatRoughness: .55, sheen: .25, sheenRoughness: .8, sheenColor: new THREE.Color(0xffffff) },
    gloss:   { roughness: .14, bumpMap: G0, bumpScale: .15, clearcoat: 1, clearcoatRoughness: .04 },
    clear:   { roughness: .18, clearcoat: 1, clearcoatRoughness: .05, transparent: true, opacity: .5, depthWrite: false, side: THREE.DoubleSide },
    glitter: { roughness: 1, roughnessMap: flakes(), metalness: 1, metalnessMap: flakes(), clearcoat: 1, clearcoatRoughness: .06 },
    metal:   { roughness: .32, roughnessMap: G0, metalness: .85, bumpMap: G0, bumpScale: .5, clearcoat: .35, clearcoatRoughness: .2 },
  };
  const shell = mk({ color: col, metalness: 0, ...(PL[plastic] || PL.matte) });
  const ridge = plastic === 'matte' ? mk({ color: col.clone().multiplyScalar(.85), roughness: .7, roughnessMap: G0, bumpMap: G0, bumpScale: .9, clearcoat: .05 }) : shell;
  if (plastic === 'clear'){
    // плата внутри прозрачного корпуса
    const bw = t.bb.W * .72, bh = t.bb.H * .7;
    t.pcbGeo = t.pcbGeo || new THREE.PlaneGeometry(bw, bh);
    const board = new THREE.Mesh(t.pcbGeo, mk({ map: pcb(), roughness: .5, metalness: .1 }));
    board.position.set((t.bb.x0 + t.bb.x1) / 2, (t.bb.y0 + t.bb.y1) / 2 - t.bb.H * .08, t.glb ? 0 : t.T / 2);
    grp.add(board);
  }
  if (t.glb){
    const extra = {
      cb_metal: mk({ color: 0xc9a24a, metalness: 1, roughness: .32 }),
      cb_dark: mk({ color: 0x1a1d22, roughness: .55 }),
      cb_disc: mk({ color: 0xe3e7ec, metalness: 1, roughness: .18 }),
      cb_glass: mk({ color: 0xc4d2e0, transparent: true, opacity: .14, roughness: .03, clearcoat: 1, depthWrite: false }),
    };
    t.glb.parts.forEach(p => grp.add(new THREE.Mesh(p.geo, extra[p.mat] || shell)));
    const et = t.emb && embossTex(key, c.shell || '#999999');
    if (et){
      // надпись консоли на корпусе — тот же пластик, рисунок рельефа в текстуре
      const em = new THREE.Mesh(t.emb.geo, mk({ ...(PL[plastic] || PL.matte), bumpMap: null, roughnessMap: null, metalnessMap: null, color: 0xffffff, map: et, transparent: true, depthWrite: false, opacity: plastic === 'clear' ? .7 : 1 }));
      em.renderOrder = 4; grp.add(em);
    }
  } else {
    grp.add(new THREE.Mesh(G.body, shell), new THREE.Mesh(G.rim, shell));
    G.extras.forEach(g => grp.add(new THREE.Mesh(g, ridge)));
  }
  const tex = new THREE.CanvasTexture(drawLabel(c, t, !!t.disc || !!t.round));
  tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
  const lfx = (c.fx && c.fx.label) || 'none';
  const lblOpts = { map: tex, roughness: .42, clearcoat: .3, clearcoatRoughness: .3 };
  if (lfx === 'gloss') Object.assign(lblOpts, { roughness: .2, clearcoat: .7, clearcoatRoughness: .12 });
  if (lfx === 'pearl') Object.assign(lblOpts, { roughness: .22, clearcoat: 1, clearcoatRoughness: .1, iridescence: .45, iridescenceIOR: 1.3, iridescenceThicknessRange: [180, 520], sheen: .35, sheenColor: new THREE.Color(0xf4e8ff) });
  if (lfx === 'gold') Object.assign(lblOpts, { color: new THREE.Color(0xfff0c8), metalness: .4, roughness: .3, clearcoat: .6, clearcoatRoughness: .1, emissive: new THREE.Color(0x3a2a08) });
  if (lfx === 'glitter') Object.assign(lblOpts, { roughness: .35, clearcoat: .8, clearcoatRoughness: .08 });
  if (lfx === 'holo') Object.assign(lblOpts, { roughness: .3, metalness: 0, clearcoat: .6, clearcoatRoughness: .15, iridescence: .55, iridescenceIOR: 1.5, iridescenceThicknessRange: [250, 900] });
  if (lfx === 'swirl') Object.assign(lblOpts, { color: new THREE.Color(0xe4e9f2), metalness: .45, roughness: .26, clearcoat: .8, clearcoatRoughness: .1 });
  if (lfx === 'prism') Object.assign(lblOpts, { roughness: .24, clearcoat: .9, clearcoatRoughness: .08, iridescence: .35, iridescenceIOR: 1.4, iridescenceThicknessRange: [200, 700] });
  if (lfx === 'poly') Object.assign(lblOpts, { roughness: .24, clearcoat: .9, clearcoatRoughness: .08, iridescence: .6, iridescenceIOR: 1.45, iridescenceThicknessRange: [250, 950] });
  if (plastic === 'clear') Object.assign(lblOpts, { transparent: true, opacity: 1, depthWrite: true });
  const lblMat = mk(lblOpts);
  let overlay = null;
  if (lfx !== 'none'){ overlay = new THREE.ShaderMaterial({ uniforms: { uMode: { value: { gloss: 1, pearl: 2, holo: 3, glitter: 4, gold: 5, swirl: 6, prism: 7, poly: 8 }[lfx] || 1 } }, vertexShader: FX_VERT, fragmentShader: FX_FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }); mats.push(overlay); }
  const LG = t.glb ? t.glb.labelGeo : G.label;
  if (LG){ const lm = new THREE.Mesh(LG, lblMat); lm.renderOrder = 5; grp.add(lm); if (overlay){ const om = new THREE.Mesh(LG, overlay).translateZ(.02); om.renderOrder = 6; grp.add(om); } }
  if (!t.glb && t.disc){
    grp.add(new THREE.Mesh(G.back, mk({ color: 0x15181c, roughness: .6 })));
    grp.add(new THREE.Mesh(G.disc, mk({ color: 0xe6eaee, metalness: 1, roughness: .16 })));
    grp.add(new THREE.Mesh(G.ring, lblMat));
    if (overlay) grp.add(new THREE.Mesh(G.ring, overlay).translateZ(.02));
    grp.add(new THREE.Mesh(G.hub, mk({ color: 0xd8dde2, roughness: .35, metalness: .2 })));
    grp.add(new THREE.Mesh(G.hole, mk({ color: 0x202428, roughness: .8 })));
    grp.add(new THREE.Mesh(G.glass, mk({ color: 0xb8c6d4, transparent: true, opacity: .16, roughness: .04, clearcoat: 1, depthWrite: false })));
  }
  grp.position.set(-(t.bb.x0 + t.bb.x1) / 2, -(t.bb.y0 + t.bb.y1) / 2, t.glb ? 0 : -t.T / 2);
  grp.traverse(o => { if (o.isMesh && !(o.material && (o.material.transparent || o.material.isShaderMaterial))){ o.castShadow = true; o.receiveShadow = true; } });
  m = { key: sig, group: grp, mats, src: c.image || null, tex };
  models.set(c.id, m);
  return m;
}
export function forget(id){ const m = models.get(id); if (m){ disposeModel(m); models.delete(id); pruneImages(); } }
function pruneImages(){
  const used = new Set([...models.values()].map(m => m.src).filter(Boolean));
  for (const k of imgCache.keys()) if (!used.has(k)) imgCache.delete(k);
}

/* ---------- рендерер ---------- */
let R = null;
export function initGL(){
  try {
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true, premultipliedAlpha: false });
    renderer.setPixelRatio(1);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.NeutralToneMapping;
    renderer.setClearColor(0x000000, 0);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    const scene = new THREE.Scene();
    const pm = new THREE.PMREMGenerator(renderer);
    scene.environment = pm.fromScene(new RoomEnvironment(), .04).texture;
    scene.environmentIntensity = .5;
    const key = new THREE.DirectionalLight(0xfff6ea, 2.4);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.bias = -.0004; key.shadow.normalBias = .04; key.shadow.radius = 3;
    Object.assign(key.shadow.camera, { near: 1, far: 400, left: -60, right: 60, top: 60, bottom: -60 });
    const fill = new THREE.DirectionalLight(0xdfe8ff, .35); fill.position.set(40, -50, 30);
    scene.add(key, key.target, fill, new THREE.HemisphereLight(0xffffff, 0x6b5a48, .35));
    const pivot = new THREE.Group(); scene.add(pivot);
    const camera = new THREE.PerspectiveCamera(18, 1, 1, 3000);
    R = { renderer, scene, key, pivot, camera, w: 0, h: 0 };
    return true;
  } catch (e){ console.error(e); return false; }
}

// tiltX/tiltY — наклон в радианах; res — пикселей холста на пиксель доски
export function renderCart(c, canvas, res = 1, tiltX = 0, tiltY = 0, opts = {}){
  if (!R) return;
  const t = tplOf(c), m = modelFor(c), { renderer, scene, key, pivot, camera } = R;
  pivot.add(m.group);
  pivot.rotation.set(tiltX, tiltY, 0, opts.orbit ? 'YXZ' : 'XYZ');
  // свет закреплён относительно экрана, а холст повёрнут CSS — компенсируем
  const th = (c.rot || 0) * Math.PI / 180, cs = Math.cos(th), sn = Math.sin(th);
  const lx = -40, ly = 60;
  key.position.set(lx * cs - ly * sn, lx * sn + ly * cs, 42);
  const sz = Math.hypot(t.bb.W, t.bb.H) * .62 + 4;
  const sc = key.shadow.camera;
  if (sc.right !== sz){ sc.left = -sz; sc.right = sz; sc.top = sz; sc.bottom = -sz; sc.updateProjectionMatrix(); }
  scene.environmentRotation.set(0, 0, th);
  const D = Math.hypot(t.bb.W, t.bb.H, t.T) * 1.04;
  const W2 = opts.orbit ? D : t.bb.W + 2 * t.M, H2 = opts.orbit ? D : t.bb.H + 2 * t.M;
  camera.aspect = W2 / H2;
  camera.position.set(0, 0, (opts.orbit ? D / 2 : t.T / 2) + (H2 / 2) / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)));
  camera.updateProjectionMatrix();
  const k = Math.min(res, (opts.maxPx || 640) / (Math.max(W2, H2) * t.k));
  const cw = Math.max(8, Math.round(W2 * t.k * k)), ch = Math.max(8, Math.round(H2 * t.k * k));
  if (cw > R.w || ch > R.h){ R.w = Math.max(R.w, cw); R.h = Math.max(R.h, ch); renderer.setSize(R.w, R.h, false); }
  renderer.setViewport(0, 0, cw, ch); renderer.setScissor(0, 0, cw, ch); renderer.setScissorTest(true);
  renderer.render(scene, camera);
  renderer.setScissorTest(false);
  pivot.remove(m.group);
  if (canvas.width !== cw || canvas.height !== ch){ canvas.width = cw; canvas.height = ch; }
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, cw, ch);
  ctx.drawImage(renderer.domElement, 0, R.h - ch, cw, ch, 0, 0, cw, ch);
}
