import { TPL, tplOf, canvasBox, initGL, renderCart, forget, onNeedRedraw, loadModels, brandName } from './carts3d.js';
import { SND, play, unlock } from './sound.js';

const $ = s => document.querySelector(s);
const BW = 1280, BH = 800, FR = 18;
const uid = () => Math.random().toString(36).slice(2, 10);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const rnd = (a, b) => a + Math.random() * (b - a);
const pick = a => a[Math.floor(Math.random() * a.length)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const api = () => (window.pywebview && window.pywebview.api && window.pywebview.api.save) ? window.pywebview.api : null;

const SHELLS = ['#a7a6ab', '#5c5c66', '#2b2b31', '#f2f0ea', '#7b5bc0', '#4a3a8f', '#2f6fd6', '#6fc3d9', '#2e9e5b', '#c9d64a', '#f2c230', '#e07a2f', '#d23b3b', '#ff8fb3'];
const LABELS = ['#2f7de0', '#d23b3b', '#2e9e5b', '#f2c230', '#7b5bc0', '#e07a2f', '#1d1d22', '#f4efe6', '#13a3a3', '#c2185b', '#8d6e63', '#546e7a'];
const PINS = ['#e23b3b', '#2f7de0', '#2fb35a', '#f1c40f', '#9b59b6', '#ff7f2a', '#f0f0f0', '#16a9b8'];
const ZCOL = [
  { bg: 'rgba(255,236,150,.17)', paper: '#fbeaa0', ink: '#e07a1f' }, { bg: 'rgba(150,210,255,.17)', paper: '#bfe3ff', ink: '#1f6fd1' },
  { bg: 'rgba(160,240,170,.17)', paper: '#c6f1c4', ink: '#1e9e52' }, { bg: 'rgba(255,170,190,.17)', paper: '#ffc9d6', ink: '#d23b3b' },
  { bg: 'rgba(210,180,255,.17)', paper: '#ddcdff', ink: '#7b4fc0' }, { bg: 'rgba(255,255,255,.10)', paper: '#f4efe6', ink: '#2b2b2b' },
];
const MODES = { normal: '◻ Окно', top: '📌 Поверх всех', desktop: '🖥 На рабочем столе' };
const MODE_ORDER = ['normal', 'top', 'desktop'];
const MAX_TILT = .32;

/* ================= состояние ================= */
let state, topZ = 10, selected = null, drag = null, scale = 1, gl = false;
const board = $('#board'), zonesL = $('#zones'), cartsL = $('#carts');

function defaultState(){
  const z1 = { id: uid(), title: 'Хочу пройти', x: 24, y: 36, w: 400, h: 740, color: 0 };
  const z2 = { id: uid(), title: 'Прохожу сейчас', x: 440, y: 36, w: 400, h: 740, color: 1 };
  const z3 = { id: uid(), title: 'Пройдено', x: 856, y: 36, w: 400, h: 740, color: 2 };
  const mk = (title, platform, shell, labelColor, x, y, rot, z) => ({ id: uid(), title, platform, shell, labelColor, image: null, showTitle: true, note: '', x, y, rot, z, pin: PINS[z % PINS.length] });
  return { version: 2, mode: 'normal', skin: 'cork', sound: true, minimal: false, zones: [z1, z2, z3], carts: [
    mk('Пример: двойной клик — изменить', 'gba', '#7b5bc0', '#f2c230', 90, 130, -4, 11),
    mk('Пример DS', 'ds', '#2b2b31', '#2f7de0', 570, 150, 5, 12),
    mk('Пример GB', 'gb', '#a7a6ab', '#d23b3b', 960, 130, -3, 13),
  ], cartScale: 1.5 };
}

let saveT = null, saveLocked = false;
// В браузере доска хранится в IndexedDB (места гораздо больше, чем в localStorage)
const idb = {
  db: null,
  open(){
    return this.db ||= new Promise((res, rej) => {
      const r = indexedDB.open('corkboard', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('kv');
      r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
    });
  },
  async get(k){ const db = await this.open(); return new Promise((res, rej) => { const q = db.transaction('kv').objectStore('kv').get(k); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); }); },
  async set(k, v){ const db = await this.open(); return new Promise((res, rej) => { const t = db.transaction('kv', 'readwrite'); t.objectStore('kv').put(v, k); t.oncomplete = () => res(); t.onerror = () => rej(t.error); }); },
};
function save(now){
  clearTimeout(saveT);
  if (saveLocked) return;
  const go = () => {
    const s = JSON.stringify(state), a = api();
    if (a) return a.save(s).catch(err => toast('Не удалось сохранить доску: ' + (err && err.message || err)));
    return idb.set('state', s).catch(() => { try { localStorage.setItem('corkboard', s); } catch (e) {} });
  };
  if (now) return go();
  saveT = setTimeout(go, 200);
}
window.addEventListener('pagehide', () => { if (state && saveT) save(true); });

/* ================= 3D: рендер и анимация наклона ================= */
const anim = new Map();      // id -> {x,y,tx,ty,l,tl}  наклон и «подъём»
const dirty = new Set();     // картриджи, которые надо перерисовать
let rafOn = false;
const resFor = () => scale * (window.devicePixelRatio || 1) * 1.1;

function cartCanvas(id){ const n = cartNode(id); return n && n.querySelector('canvas.cv'); }
function drawNow(c){
  const cv = cartCanvas(c.id); if (!cv || !gl) return;
  const a = anim.get(c.id);
  renderCart(c, cv, resFor(), a ? a.x : 0, a ? a.y : 0);
  if (hasFx(c, 'aura')) updateAuraMask(cv);
}
function requestDraw(id){ dirty.add(id); kick(); }
function kick(){ if (!rafOn){ rafOn = true; requestAnimationFrame(loop); } }
function loop(){
  rafOn = false;
  for (const [id, a] of anim){
    a.x += (a.tx - a.x) * .2; a.y += (a.ty - a.y) * .2; a.l += (a.tl - a.l) * .22;
    if (a.decay){ a.tx *= .82; a.ty *= .82; }
    const n = cartNode(id);
    if (n){
      const b = n.querySelector('.body');
      b.style.transform = `translate(${a.y * 9}px, ${a.x * 9}px) scale(${1 + a.l * .06})`;
    }
    dirty.add(id);
    if (Math.abs(a.x - a.tx) + Math.abs(a.y - a.ty) + Math.abs(a.l - a.tl) < .002 && Math.abs(a.tx) + Math.abs(a.ty) + a.tl < .001){
      anim.delete(id); if (n) n.querySelector('.body').style.transform = '';
    }
  }
  let budget = 6;
  for (const id of dirty){
    if (!anim.has(id) && budget-- <= 0) continue;   // остальное — в следующих кадрах
    dirty.delete(id);
    const c = byId(id); if (c) drawNow(c);
  }
  if (anim.size || dirty.size) kick();
}
function animOf(id){ let a = anim.get(id); if (!a){ a = { x: 0, y: 0, tx: 0, ty: 0, l: 0, tl: 0 }; anim.set(id, a); } return a; }
onNeedRedraw(id => requestDraw(id));

let redrawAllT = null;
let lastDrawScale = 0;
function redrawAll(){ clearTimeout(redrawAllT); redrawAllT = setTimeout(() => { lastDrawScale = scale; state.carts.forEach(c => dirty.add(c.id)); kick(); }, 120); }

/* ================= отрисовка DOM ================= */
function makeCart(c){
  const t = tplOf(c);
  const el = document.createElement('div');
  const fx = normFx(c);
  el.className = 'cart' + (selected === c.id ? ' sel' : '') + fxClass(fx);
  setFxVars(el, fx);
  el.dataset.id = c.id;
  el.style.width = t.w + 'px'; el.style.height = t.h + 'px';
  const b = canvasBox(c);
  el.innerHTML = `<div class="body">${gl
      ? `${fx.effects.includes('aura') ? auraHTML(fx.colors) : ''}<canvas class="cv" style="left:${b.left}px;top:${b.top}px;width:${b.width}px;height:${b.height}px"></canvas>`
      : `<div class="fallback" style="background:${c.shell}"><span style="background:${c.labelColor};padding:4px;border-radius:3px">${esc(c.title)}</span></div>`}
    ${fx.effects.includes('sparkle') ? sparksHTML(12, fx.colors) : ''}</div><div class="rot" title="Повернуть (Shift — шаг 15°)">↻</div>`;
  placeCart(el, c);
  return el;
}
function placeCart(el, c){
  el.style.left = c.x + 'px'; el.style.top = c.y + 'px';
  el.style.transform = `rotate(${c.rot || 0}deg)`; el.style.zIndex = c.z;
  return el;
}
function makeZone(z){
  const col = ZCOL[z.color % ZCOL.length];
  const el = document.createElement('div');
  el.className = 'zone'; el.dataset.id = z.id;
  el.style.setProperty('--zbg', col.bg); el.style.setProperty('--zpaper', col.paper); el.style.setProperty('--zink', col.ink);
  el.innerHTML = `<div class="zlabel"><span class="zt">${esc(z.title)}</span><span class="cnt">0</span></div>
    <div class="ztools"><button data-a="rename" title="Переименовать">✎</button><button data-a="color" title="Цвет">🎨</button><button data-a="del" title="Удалить зону">✕</button></div>
    <div class="zresize"></div>`;
  placeZone(el, z);
  return el;
}
function placeZone(el, z){ el.style.left = z.x + 'px'; el.style.top = z.y + 'px'; el.style.width = z.w + 'px'; el.style.height = z.h + 'px'; }

function renderZones(){
  zonesL.innerHTML = '';
  state.zones.forEach(z => zonesL.appendChild(makeZone(z)));
  updateCounts();
}
function render(){
  zonesL.innerHTML = ''; cartsL.innerHTML = '';
  state.zones.forEach(z => zonesL.appendChild(makeZone(z)));
  state.carts.forEach(c => { cartsL.appendChild(makeCart(c)); dirty.add(c.id); });
  updateCounts(); kick();
}

const cartNode = id => cartsL.querySelector(`.cart[data-id="${id}"]`);
const zoneNode = id => zonesL.querySelector(`.zone[data-id="${id}"]`);
const byId = id => state.carts.find(c => c.id === id);
const zoneById = id => state.zones.find(z => z.id === id);

function zoneOf(c){
  const t = tplOf(c), cx = c.x + t.w / 2, cy = c.y + t.h / 2;
  for (let i = state.zones.length - 1; i >= 0; i--){
    const z = state.zones[i];
    if (cx >= z.x && cx <= z.x + z.w && cy >= z.y && cy <= z.y + z.h) return z;
  }
  return null;
}
function updateCounts(){
  const cnt = {};
  state.carts.forEach(c => { const z = zoneOf(c); if (z) cnt[z.id] = (cnt[z.id] || 0) + 1; });
  state.zones.forEach(z => { const n = zoneNode(z.id); if (n){ n.querySelector('.cnt').textContent = cnt[z.id] || 0; n.classList.toggle('empty', !cnt[z.id]); } });
  $('#total').textContent = state.carts.length ? `· ${state.carts.length} шт.` : '';
}
function select(id){
  selected = id;
  cartsL.querySelectorAll('.cart').forEach(n => n.classList.toggle('sel', n.dataset.id === id));
}

/* ================= масштаб ================= */
function fit(){
  const r = $('#stage').getBoundingClientRect(), pad = state && state.minimal ? FR : FR + 12;
  const old = scale;
  scale = Math.max(.1, Math.min((r.width - pad * 2) / BW, (r.height - pad * 2) / BH));
  const ox = (r.width - BW * scale) / 2, oy = (r.height - BH * scale) / 2;
  $('#wrap').style.transform = `translate(${ox}px,${oy}px) scale(${scale})`;
  if (state && Math.abs(lastDrawScale - scale) > .01) redrawAll();
}
window.addEventListener('resize', fit);
function toBoard(e){ const r = board.getBoundingClientRect(); return { x: (e.clientX - r.left) / scale, y: (e.clientY - r.top) / scale }; }
// координаты мыши в системе картриджа, нормированные в [-1..1]
function localNorm(c, p){
  const t = tplOf(c), th = -(c.rot || 0) * Math.PI / 180;
  const dx = p.x - (c.x + t.w / 2), dy = p.y - (c.y + t.h / 2);
  return { x: clamp((dx * Math.cos(th) - dy * Math.sin(th)) / (t.w / 2), -1, 1), y: clamp((dx * Math.sin(th) + dy * Math.cos(th)) / (t.h / 2), -1, 1) };
}

/* ================= наведение ================= */
let hoverId = null;
let tipT = null;
function hideTip(){ clearTimeout(tipT); $('#tip').classList.remove('show'); }
function showTip(c, x, y){
  clearTimeout(tipT);
  tipT = setTimeout(() => {
    if (drag || hoverId !== c.id || detailC) return;
    const i = c.info || {}, z = zoneOf(c), mods = (c.modules || []).filter(m => (m.text || '').trim()).length;
    const sub = [tplOf(c).name, i.dev, i.year].filter(Boolean).join(' · ');
    const fmt = d => d ? new Date(d + 'T00:00').toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' }) : '';
    const rows = [i.start && `▶ начал ${fmt(i.start)}`, i.end && `✔ прошёл ${fmt(i.end)}`, z && `📌 ${z.title}`, mods && `📓 записей: ${mods}`].filter(Boolean);
    const tip = $('#tip');
    tip.innerHTML = `<b>${esc(c.title || 'Без названия')}</b><span>${esc(sub)}</span>${rows.map(r => `<i>${esc(r)}</i>`).join('')}<em>ПКМ — карточка игры</em>`;
    tip.classList.add('show');
    const w = tip.offsetWidth, h = tip.offsetHeight;
    tip.style.left = Math.min(window.innerWidth - w - 8, x + 16) + 'px';
    tip.style.top = Math.min(window.innerHeight - h - 8, y + 18) + 'px';
  }, 550);
}
function setHover(id){
  if (hoverId === id) return;
  hideTip();
  if (hoverId){ const a = animOf(hoverId); a.tx = a.ty = a.tl = 0; const n = cartNode(hoverId); if (n) n.classList.remove('hov'); }
  hoverId = id;
  if (id){ animOf(id).tl = 1; const n = cartNode(id); if (n) n.classList.add('hov'); play('hover'); }
  kick();
}
board.addEventListener('pointermove', e => {
  if (drag) return;
  const cE = e.target.closest('.cart');
  if (!cE){ setHover(null); return; }
  const c = byId(cE.dataset.id); if (!c) return;
  if (hoverId !== c.id){ setHover(c.id); showTip(c, e.clientX, e.clientY); }
  const n = localNorm(c, toBoard(e)), a = animOf(c.id);
  a.decay = false; a.tl = 1;
  a.ty = n.x * MAX_TILT;   // поворот вокруг вертикали
  a.tx = n.y * MAX_TILT;   // поворот вокруг горизонтали
  kick();
});
board.addEventListener('pointerleave', () => { if (!drag) setHover(null); });

/* ================= перетаскивание ================= */
board.addEventListener('pointerdown', e => {
  unlock(); hideTip();
  if (e.button !== 0) return;
  if (e.target.closest('.ztools') || e.target.closest('[contenteditable=true]')) return;
  const p = toBoard(e);
  const cE = e.target.closest('.cart');
  if (cE){
    const c = byId(cE.dataset.id); if (!c) return;
    select(c.id);
    c.z = ++topZ; cE.style.zIndex = c.z;
    if (e.target.closest('.rot')){
      const t = tplOf(c);
      drag = { type: 'rot', c, el: cE, base: Math.atan2(-(t.h / 2 + 13), t.w / 2 + 13) * 180 / Math.PI, lastTick: c.rot };
    } else {
      drag = { type: 'move', c, el: cE, dx: p.x - c.x, dy: p.y - c.y, lx: p.x, ly: p.y };
      cE.classList.add('drag'); play('pick');
      const a = animOf(c.id); a.tl = 1.4; a.decay = true;
    }
  } else if (e.target.closest('.zresize')){
    const zE = e.target.closest('.zone'), z = zoneById(zE.dataset.id);
    drag = { type: 'zsize', z, el: zE, sx: p.x, sy: p.y, w: z.w, h: z.h };
  } else if (e.target.closest('.zlabel')){
    const zE = e.target.closest('.zone'), z = zoneById(zE.dataset.id);
    const members = state.carts.filter(c => zoneOf(c) === z).map(c => ({ c, ox: c.x - z.x, oy: c.y - z.y, el: cartNode(c.id) }));
    drag = { type: 'zmove', z, el: zE, dx: p.x - z.x, dy: p.y - z.y, members };
    play('pick');
  } else {
    select(null);
    // в режиме «только доска» пустое место доски двигает окно
    if (state.minimal && api()){ api().start_drag(); }
    return;
  }
  try { drag.el.setPointerCapture(e.pointerId); } catch (err) {}
  e.preventDefault();
});
window.addEventListener('pointermove', e => {
  if (!drag) return;
  const p = toBoard(e);
  if (drag.type === 'move'){
    const c = drag.c, t = tplOf(c);
    c.x = Math.round(clamp(p.x - drag.dx, -t.w / 2, BW - t.w / 2));
    c.y = Math.round(clamp(p.y - drag.dy, -t.h / 2, BH - t.h / 2));
    placeCart(drag.el, c);
    // инерционный наклон от скорости движения
    const vx = p.x - drag.lx, vy = p.y - drag.ly, th = -(c.rot || 0) * Math.PI / 180;
    const lvx = vx * Math.cos(th) - vy * Math.sin(th), lvy = vx * Math.sin(th) + vy * Math.cos(th);
    const a = animOf(c.id);
    a.ty = clamp(a.ty + lvx * .012, -MAX_TILT, MAX_TILT); a.tx = clamp(a.tx + lvy * .012, -MAX_TILT, MAX_TILT);
    drag.lx = p.x; drag.ly = p.y; kick();
  } else if (drag.type === 'rot'){
    const t = tplOf(drag.c), cx = drag.c.x + t.w / 2, cy = drag.c.y + t.h / 2;
    let a = Math.atan2(p.y - cy, p.x - cx) * 180 / Math.PI - drag.base;
    a = ((a + 540) % 360) - 180;
    if (e.shiftKey) a = Math.round(a / 15) * 15;
    drag.c.rot = Math.round(a * 10) / 10;
    if (Math.abs(drag.c.rot - drag.lastTick) >= 6){ play('tick'); drag.lastTick = drag.c.rot; }
    placeCart(drag.el, drag.c); requestDraw(drag.c.id);
  } else if (drag.type === 'zmove'){
    const z = drag.z;
    z.x = Math.round(clamp(p.x - drag.dx, -z.w + 120, BW - 120));
    z.y = Math.round(clamp(p.y - drag.dy, -10, BH - 60));
    placeZone(drag.el, z);
    drag.members.forEach(m => { m.c.x = z.x + m.ox; m.c.y = z.y + m.oy; if (m.el) placeCart(m.el, m.c); });
  } else if (drag.type === 'zsize'){
    drag.z.w = Math.round(Math.max(220, drag.w + p.x - drag.sx));
    drag.z.h = Math.round(Math.max(160, drag.h + p.y - drag.sy));
    placeZone(drag.el, drag.z);
  }
});
function endDrag(){
  if (!drag) return;
  const d = drag; drag = null;
  d.el.classList.remove('drag');
  if (d.type === 'move' || d.type === 'zmove') play('drop');
  if (d.type === 'move'){ const a = animOf(d.c.id); a.decay = false; a.tx = a.ty = 0; a.tl = hoverId === d.c.id ? 1 : 0; kick(); }
  updateCounts(); save();
}
window.addEventListener('pointerup', endDrag);
window.addEventListener('pointercancel', endDrag);

board.addEventListener('wheel', e => {
  const cE = e.target.closest('.cart'); if (!cE) return;
  e.preventDefault();
  const c = byId(cE.dataset.id), step = e.shiftKey ? 15 : 4;
  c.rot = ((c.rot || 0) + (e.deltaY > 0 ? step : -step) + 540) % 360 - 180;
  placeCart(cE, c); requestDraw(c.id); play('tick'); save();
}, { passive: false });

board.addEventListener('dblclick', e => {
  const cE = e.target.closest('.cart');
  if (cE && !e.target.closest('.rot')) return openDialog(byId(cE.dataset.id));
  const zl = e.target.closest('.zlabel');
  if (zl) renameZone(zoneById(zl.closest('.zone').dataset.id));
});
document.addEventListener('contextmenu', e => {
  if (e.target.closest('input,textarea')) return;
  e.preventDefault();
  const cE = e.target.closest('.cart');
  if (cE && $('#dlgWrap').classList.contains('hidden') && !detailC) openDetail(byId(cE.dataset.id));
});

/* ================= зоны ================= */
zonesL.addEventListener('click', e => {
  const b = e.target.closest('.ztools button'); if (!b) return;
  play('ui');
  const z = zoneById(b.closest('.zone').dataset.id);
  if (b.dataset.a === 'color'){ z.color = (z.color + 1) % ZCOL.length; renderZones(); save(); }
  if (b.dataset.a === 'rename') renameZone(z);
  if (b.dataset.a === 'del'){
    const i = state.zones.indexOf(z);
    state.zones.splice(i, 1); renderZones(); save(); play('del');
    toast(`Зона «${z.title}» удалена`, () => { state.zones.splice(i, 0, z); renderZones(); save(); });
  }
});
function renameZone(z){
  const span = zoneNode(z.id).querySelector('.zt');
  span.contentEditable = 'true'; span.focus();
  document.getSelection().selectAllChildren(span);
  const done = ok => {
    span.removeEventListener('blur', onBlur); span.removeEventListener('keydown', onKey);
    span.contentEditable = 'false';
    const v = span.textContent.trim();
    if (ok && v){ z.title = v.slice(0, 40); save(); }
    span.textContent = z.title;
  };
  const onBlur = () => done(true);
  const onKey = e => { if (e.key === 'Enter'){ e.preventDefault(); span.blur(); } if (e.key === 'Escape') done(false); e.stopPropagation(); };
  span.addEventListener('blur', onBlur); span.addEventListener('keydown', onKey);
}
$('#bZone').onclick = () => {
  const z = { id: uid(), title: 'Новая зона', x: BW / 2 - 220, y: BH / 2 - 160, w: 440, h: 320, color: state.zones.length % ZCOL.length };
  state.zones.push(z); render(); save(); play('snap');
  renameZone(z);
};

/* ================= тост / отмена ================= */
let undoFn = null, toastT = null;
function toast(text, undo){
  undoFn = undo; $('#toastText').textContent = text;
  $('#toastBtn').style.display = undo ? '' : 'none';
  $('#toast').classList.add('show');
  clearTimeout(toastT); toastT = setTimeout(() => { $('#toast').classList.remove('show'); undoFn = null; }, 5000);
}
$('#toastBtn').onclick = () => { if (undoFn) undoFn(); undoFn = null; $('#toast').classList.remove('show'); play('snap'); };
function deleteCart(c){
  if (detailC === c) closeDetail();
  const i = state.carts.indexOf(c); if (i < 0) return;
  state.carts.splice(i, 1); if (selected === c.id) selected = null;
  if (hoverId === c.id) hoverId = null;
  anim.delete(c.id); forget(c.id);
  render(); save(); play('del');
  toast(`«${c.title || 'Картридж'}» снят с доски`, () => { state.carts.splice(i, 0, c); render(); save(); });
}
document.addEventListener('keydown', e => {
  const dlgOpen = !$('#dlgWrap').classList.contains('hidden');
  if (dlgOpen){
    if (e.key === 'Escape') closeDialog();
    if (e.key === 'Enter' && e.ctrlKey) $('#dOk').click();
    return;
  }
  if (detailC){ if (e.key === 'Escape') closeDetail(); return; }
  if (e.target.closest && e.target.closest('input,textarea,[contenteditable=true]')) return;
  const c = selected && byId(selected);
  if ((e.key === 'Delete' || e.key === 'Backspace') && c) deleteCart(c);
  else if (e.key === 'Enter' && c) openDialog(c);
  else if (e.key.toLowerCase() === 'z' && e.ctrlKey && undoFn) $('#toastBtn').click();
  else if (['q', 'й', 'e', 'у'].includes(e.key) && c){
    c.rot = ((c.rot || 0) + ('qй'.includes(e.key) ? -5 : 5) + 540) % 360 - 180;
    placeCart(cartNode(c.id), c); requestDraw(c.id); play('tick'); save();
  } else if (e.key === 'Escape') select(null);
});

/* ================= диалог ================= */
let draft = null, editing = null, lastPlatform = 'gba';
const prevAnim = { x: 0, y: 0, tx: 0, ty: 0, on: false };
function drawPreview(){
  if (!draft || !gl) return;
  const cv = $('#preview'), t = tplOf(draft), box = canvasBox(draft);
  const zoom = Math.min(200 / box.width, 250 / box.height);
  cv.style.width = box.width * zoom + 'px'; cv.style.height = box.height * zoom + 'px';
  renderCart({ ...draft, id: '__preview', rot: 0 }, cv, zoom * (window.devicePixelRatio || 1), prevAnim.x, prevAnim.y);
}
function previewLoop(){
  if (!prevAnim.on) return;
  const dx = prevAnim.tx - prevAnim.x, dy = prevAnim.ty - prevAnim.y;
  if (Math.abs(dx) + Math.abs(dy) > .0008){ prevAnim.x += dx * .15; prevAnim.y += dy * .15; drawPreview(); }
  requestAnimationFrame(previewLoop);
}
$('.dl-right').addEventListener('pointermove', e => {
  const r = e.currentTarget.getBoundingClientRect();
  prevAnim.ty = ((e.clientX - r.left) / r.width * 2 - 1) * .45;
  prevAnim.tx = ((e.clientY - r.top) / r.height * 2 - 1) * .45;
});
$('.dl-right').addEventListener('pointerleave', () => { prevAnim.tx = prevAnim.ty = 0; });

function swatches(box, colors, key){
  box.innerHTML = colors.map(c => `<button data-c="${c}" style="background:${c}"></button>`).join('') + `<input type="color" title="Свой цвет">`;
  box.onclick = e => { const b = e.target.closest('button'); if (!b) return; draft[key] = b.dataset.c; play('ui'); refreshDialog(); };
  box.querySelector('input').oninput = e => { draft[key] = e.target.value; refreshDialog(); };
}
function platIcons(){
  return Object.entries(TPL).map(([k, t]) => {
    let src = '';
    if (gl){
      const cv = document.createElement('canvas');
      renderCart({ id: '__icon_' + k, platform: k, shell: '#b9b6bd', labelColor: '#8c939e', title: ' ', rot: 0 }, cv, 1.2, -.18, .3);
      forget('__icon_' + k);
      src = cv.toDataURL();
    }
    return `<button data-p="${k}">${src ? `<img src="${src}">` : ''}${esc(t.name)}</button>`;
  }).join('');
}
function buildDialog(){
  $('#fPlat').innerHTML = platIcons();
  $('#fPlat').onclick = e => { const b = e.target.closest('button'); if (!b) return; draft.platform = b.dataset.p; play('snap'); fxControls($('#fFx'), draft, refreshDialog); refreshDialog(); };
  swatches($('#fShell'), SHELLS, 'shell');
  swatches($('#fLabel'), LABELS, 'labelColor');
  let tT;
  $('#fTitle').oninput = e => { draft.title = e.target.value; clearTimeout(tT); tT = setTimeout(refreshDialog, 120); };
  $('#fNote').oninput = e => { draft.note = e.target.value; };
  $('#fShowTitle').onchange = e => { draft.showTitle = e.target.checked; refreshDialog(); };
  $('#fImgBtn').onclick = () => $('#fFile').click();
  $('#fImgDel').onclick = () => { draft.image = null; refreshDialog(); };
  $('#fFile').onchange = e => { const f = e.target.files[0]; if (f) loadImage(f); e.target.value = ''; };
  $('#dCancel').onclick = closeDialog;
  $('#dlgWrap').addEventListener('pointerdown', e => { if (e.target.id === 'dlgWrap') closeDialog(); });
  $('#dOk').onclick = commitDialog;
  $('#dDup').onclick = () => {
    const src = editing; commitDialog();
    const t = tplOf(src);
    const c = { ...src, id: uid(), x: clamp(src.x + 28, 0, BW - t.w), y: clamp(src.y + 28, 0, BH - t.h), z: ++topZ, rot: Math.round(rnd(-7, 7)), pin: pick(PINS),
      info: structuredClone(src.info || {}), fx: structuredClone(src.fx || {}), modules: (src.modules || []).map(m => ({ ...m, id: uid() })) };
    state.carts.push(c); selected = c.id; render(); save(); play('drop');
  };
  let armT;
  $('#dDel').onclick = e => {
    const b = e.currentTarget;
    if (!b.classList.contains('armed')){ b.classList.add('armed'); b.textContent = 'Точно удалить?'; clearTimeout(armT); armT = setTimeout(() => { b.classList.remove('armed'); b.textContent = 'Удалить'; }, 3000); return; }
    const c = editing; closeDialog(); deleteCart(c);
  };
  document.addEventListener('paste', e => {
    if ($('#dlgWrap').classList.contains('hidden')) return;
    const item = [...(e.clipboardData?.items || [])].find(i => i.type.startsWith('image/'));
    if (item){ e.preventDefault(); loadImage(item.getAsFile()); }
  });
}
function loadImage(file){
  const url = URL.createObjectURL(file), img = new Image();
  img.onerror = () => { URL.revokeObjectURL(url); toast('Не получилось открыть эту картинку'); };
  img.onload = () => {
    if (!draft){ URL.revokeObjectURL(url); return; }
    const k = Math.min(1, 512 / Math.max(img.width, img.height));
    const cv = document.createElement('canvas');
    cv.width = Math.round(img.width * k); cv.height = Math.round(img.height * k);
    cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
    draft.image = cv.toDataURL('image/webp', .88);
    URL.revokeObjectURL(url); refreshDialog();
  };
  img.src = url;
}
function openDialog(c){
  editing = c || null;
  draft = c ? { ...c } : { id: uid(), title: '', platform: lastPlatform, shell: pick(SHELLS), labelColor: pick(LABELS), image: null, showTitle: true, note: '', rot: Math.round(rnd(-7, 7)), pin: pick(PINS) };
  draft.fx = structuredClone(normFx(c || {}));
  fxControls($('#fFx'), draft, refreshDialog);
  $('#dlg').classList.toggle('isnew', !c);
  $('#dlgTitle').textContent = c ? 'Картридж' : 'Новый картридж';
  $('#fTitle').value = draft.title; $('#fNote').value = draft.note || '';
  $('#fZone').innerHTML = state.zones.map(z => `<option value="${z.id}">${esc(z.title)}</option>`).join('') + '<option value="">— просто на доску —</option>';
  const b = $('#dDel'); b.classList.remove('armed'); b.textContent = 'Удалить';
  $('#dlgWrap').classList.remove('hidden');
  play('open');
  refreshDialog();
  prevAnim.on = true; previewLoop();
  setTimeout(() => $('#fTitle').focus(), 30);
}
function refreshDialog(){
  if (!draft) return;
  $('#fPlat').querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.p === draft.platform));
  $('#fShell').querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.c === draft.shell));
  $('#fLabel').querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.c === draft.labelColor));
  $('#fShell input').value = draft.shell; $('#fLabel input').value = draft.labelColor;
  $('#fShowTitle').checked = !!draft.showTitle;
  $('#fShowTitle').parentElement.style.display = draft.image ? '' : 'none';
  $('#fImgDel').style.display = draft.image ? '' : 'none';
  const dr = $('.dl-right');
  dr.classList.toggle('fx-glow', hasFx(draft, 'glow'));
  dr.classList.toggle('fx-float', hasFx(draft, 'float'));
  setFxVars(dr, draft.fx);
  drawPreview();
}
function closeDialog(){ $('#dlgWrap').classList.add('hidden'); draft = editing = null; prevAnim.on = false; forget('__preview'); }
function commitDialog(){
  draft.title = $('#fTitle').value.trim();
  lastPlatform = draft.platform;
  const t = tplOf(draft);
  if (editing){
    const ot = tplOf(editing);
    draft.x = Math.round(editing.x + (ot.w - t.w) / 2); draft.y = Math.round(editing.y + (ot.h - t.h) / 2);
    Object.assign(editing, draft);
  } else {
    const z = zoneById($('#fZone').value);
    if (z){
      draft.x = Math.round(z.x + 20 + Math.random() * Math.max(0, z.w - 40 - t.w));
      draft.y = Math.round(z.y + 70 + Math.random() * Math.max(0, z.h - 90 - t.h));
    } else { draft.x = Math.round(BW / 2 - t.w / 2 + rnd(-60, 60)); draft.y = Math.round(BH / 2 - t.h / 2 + rnd(-60, 60)); }
    draft.z = ++topZ;
    state.carts.push(draft);
    selected = draft.id;
  }
  const was = editing;
  closeDialog(); render(); save(); play('drop');
  if (detailC && was === detailC) refreshDetail();
}
$('#bAdd').onclick = () => openDialog(null);


/* ================= эффекты ================= */
const PALETTES = {
  rainbow: ['#ff4d6d', '#ffb84d', '#f9f871', '#5cff8d', '#4dd8ff', '#7a6bff', '#ff4dd8'],
  neon: ['#39ff14', '#00f0ff', '#ff00e6'],
  sunset: ['#ff5f6d', '#ffc371', '#ff8a3d', '#c850c0'],
  ocean: ['#00c6ff', '#0072ff', '#7afcff', '#3a7bd5'],
  gold: ['#ffd34d', '#fff1a8', '#ff9f1c'],
  sakura: ['#ffb7c5', '#ff77a9', '#fff0f5', '#d291bc'],
  moon: ['#ffffff', '#bfc7d5', '#8fa3c7'],
};
const PAL_NAMES = { rainbow: 'Радуга', neon: 'Неон', sunset: 'Закат', ocean: 'Океан', gold: 'Золото', sakura: 'Сакура', moon: 'Лунный' };
// единый формат эффектов: effects — массив (можно несколько), colors — палитра
function normFx(o){
  const f = o.fx = o.fx || {};
  if (!Array.isArray(f.effects)){
    f.effects = { glow: ['glow'], sparkle: ['sparkle'], both: ['glow', 'sparkle'], aura: ['aura'], float: ['float'] }[f.cart] || [];
  }
  if (!Array.isArray(f.colors) || !f.colors.length) f.colors = f.color && f.color !== '#ffd34d' ? [f.color] : [...PALETTES.rainbow];
  delete f.cart; delete f.color;
  f.label = f.label || 'none'; f.plastic = f.plastic || 'matte';
  return f;
}
const hasFx = (o, e) => !!(o && o.fx && Array.isArray(o.fx.effects) && o.fx.effects.includes(e));
function fxClass(fx){
  const e = fx.effects || [];
  return (e.includes('glow') ? ' fx-glow' : '') + (e.includes('float') ? ' fx-float' : '') + (e.includes('aura') ? ' fx-aura' : '');
}
function setFxVars(el, fx){
  el.style.setProperty('--fxc', fx.colors[0]);
  el.style.setProperty('--fxc2', fx.colors[1] || fx.colors[0]);
}
function sparksHTML(n, colors = PALETTES.gold){
  let h = '<div class="sparks">';
  for (let i = 0; i < n; i++){
    // искорки вдоль периметра, немного за краем картриджа; цвет — из палитры
    const side = i % 4, t = Math.random();
    const x = side === 0 ? t * 100 : side === 1 ? 100 - Math.random() * 14 : side === 2 ? t * 100 : Math.random() * 14;
    const y = side === 0 ? Math.random() * 14 : side === 1 ? t * 100 : side === 2 ? 100 - Math.random() * 14 : t * 100;
    h += `<i style="left:${x.toFixed(1)}%;top:${y.toFixed(1)}%;--fxc:${colors[i % colors.length]};--s:${(13 + Math.random() * 14).toFixed(1)}px;--d:${(1.6 + Math.random() * 2.2).toFixed(2)}s;--dl:${(-Math.random() * 4).toFixed(2)}s"></i>`;
  }
  return h + '</div>';
}

/* ---- контурная аура: светящийся ореол точно по силуэту картриджа, цвета палитры бегут по кругу ---- */
// Маска ореола (размытый силуэт с вырезанной серединой) считается редко и в половинном разрешении,
// а бегущие цвета — это вращающийся conic-gradient под CSS-маской: крутит видеокарта, процессор не занят.
const auraHTML = colors => `<div class="aura-cv"><i style="background:conic-gradient(${[...colors, colors[0]].join(',')})"></i></div>`;
const auraT = new WeakMap();
const auraMaskCv = document.createElement('canvas');
function updateAuraMask(src){
  let st = auraT.get(src); if (!st){ st = { t: 0, h: 0 }; auraT.set(src, st); }
  clearTimeout(st.h);
  const wait = 160 - (performance.now() - st.t);
  if (wait > 0) st.h = setTimeout(() => buildAura(src, st), wait);   // при вращении — не чаще ~6 раз/с
  else buildAura(src, st);
}
function buildAura(src, st){
  st.t = performance.now();
  const a = src.isConnected && src.parentElement.querySelector('.aura-cv');
  if (!a || !src.width) return;
  const cssW = parseFloat(src.style.width) || src.width, cssH = parseFloat(src.style.height) || src.height;
  const f = Math.min(2.6, Math.max(1, cssW / 170));        // в карточке игры картридж крупный — ореол шире
  const q = .5, padC = Math.round(20 * f);                 // 1 пиксель маски = 2 css-пикселя
  const w = Math.ceil(cssW * q), h = Math.ceil(cssH * q), pad = Math.round(padC * q);
  const m = auraMaskCv; m.width = w + pad * 2; m.height = h + pad * 2;
  const x = m.getContext('2d');
  x.shadowColor = '#fff'; x.shadowOffsetX = 20000;
  for (const b of [14, 6, 2]){ x.shadowBlur = b * f * q; x.drawImage(src, pad - 20000, pad, w, h); x.drawImage(src, pad - 20000, pad, w, h); }
  x.shadowColor = 'transparent';
  x.globalCompositeOperation = 'destination-out'; x.drawImage(src, pad, pad, w, h);   // светится только контур
  x.globalCompositeOperation = 'source-over';
  const url = `url(${m.toDataURL()})`;
  const W = cssW + padC * 2, H = cssH + padC * 2;
  Object.assign(a.style, { left: src.offsetLeft - padC + 'px', top: src.offsetTop - padC + 'px', width: W + 'px', height: H + 'px',
    maskImage: url, webkitMaskImage: url });
  a.style.setProperty('--d', Math.ceil(Math.hypot(W, H)) + 'px');
}

function fxControls(box, obj, onChange){
  const fx = normFx(obj);
  const chips = (k, list) => `<div class="chips" data-k="${k}">${list.map(([v, n]) => `<button data-v="${v}" class="${fx[k] === v ? 'on' : ''}">${n}</button>`).join('')}</div>`;
  const multi = list => `<div class="chips">${list.map(([v, n]) => `<button data-e="${v}" class="${fx.effects.includes(v) ? 'on' : ''}">${n}</button>`).join('')}</div>`;
  const pals = Object.entries(PALETTES).map(([k, cols]) => `<button class="pal" data-p="${k}" title="${PAL_NAMES[k]}" style="background:linear-gradient(90deg,${cols.join(',')})"></button>`).join('');
  const sw = fx.colors.map((c, i) => `<label class="pc" style="background:${c}" title="Изменить цвет"><input type="color" data-i="${i}" value="${c}"></label>`).join('');
  box.innerHTML = `<div class="lab">Пластик</div>${chips('plastic', [['matte', 'Шероховатый'], ['gloss', 'Глянцевый'], ['clear', 'Прозрачный'], ['glitter', 'С блёстками'], ['metal', 'Металлик']])}
    <div class="lab">Эффекты картриджа <span class="hint">— можно несколько</span></div>${multi([['glow', '✨ Свечение'], ['sparkle', '⭐ Искорки'], ['aura', '🌈 Контурная аура'], ['float', '🎈 Парит']])}
    <div class="lab">Палитра эффектов</div><div class="pals">${pals}</div>
    <div class="pcs">${sw}${fx.colors.length < 7 ? '<button class="pcadd" title="Добавить цвет">＋</button>' : ''}${fx.colors.length > 1 ? '<button class="pcdel" title="Убрать последний цвет">－</button>' : ''}</div>
    <div class="lab">Наклейка</div>${chips('label', [['none', 'Обычная'], ['gloss', 'Глянец'], ['pearl', 'Перламутр'], ['holo', 'Голограмма'], ['glitter', 'Блёстки'], ['gold', 'Золотая фольга'], ['swirl', 'Серебряный вихрь'], ['prism', 'Призма'], ['poly', 'Радужная фольга']])}
    ${brandName(obj.platform) ? `<div class="lab">Логотип консоли</div><div class="chips"><button data-brand="1" class="${fx.brand ? 'on' : ''}">🏷 Полоска «${brandName(obj.platform)}»</button></div>` : ''}`;
  box.onclick = e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.e){ const i = fx.effects.indexOf(b.dataset.e); if (i < 0) fx.effects.push(b.dataset.e); else fx.effects.splice(i, 1); }
    else if (b.dataset.p) fx.colors = [...PALETTES[b.dataset.p]];
    else if (b.dataset.brand) fx.brand = !fx.brand;
    else if (b.classList.contains('pcadd')) fx.colors.push(fx.colors[fx.colors.length - 1]);
    else if (b.classList.contains('pcdel')) fx.colors.pop();
    else if (b.dataset.v) fx[b.closest('.chips').dataset.k] = b.dataset.v;
    else return;
    play('ui'); fxControls(box, obj, onChange); onChange();
  };
  let ct = null;
  box.querySelectorAll('.pc input').forEach(inp => inp.oninput = () => {
    fx.colors[+inp.dataset.i] = inp.value; inp.parentElement.style.background = inp.value;
    clearTimeout(ct); ct = setTimeout(onChange, 60);
  });
}

/* ================= карточка игры (правый клик) ================= */
let detailC = null;
const DT = { rx: 0, ry: 0, vx: 0, vy: 0, zoom: 1, drag: null, raf: 0, dirty: true, lastTick: 0, hx: 0, hy: 0, thx: 0, thy: 0 };
const MOD_PRESETS = [['Заметки по игре', 'lined'], ['Общая рецензия', 'yellow'], ['Где остановился', 'pink'], ['Записка', 'grid'], ['Цитаты и моменты', 'kraft'], ['Свой модуль', 'lined']];
const PAPERS = ['lined', 'yellow', 'grid', 'pink', 'kraft'];

function openDetail(c){
  if (!c) return;
  detailC = c; setHover(null);
  c.info = c.info || {}; c.modules = c.modules || [];
  Object.assign(DT, { rx: 0, ry: 0, vx: 0, vy: .035, zoom: 1, drag: null, dirty: true });
  $('#detail').classList.remove('hidden');
  play('open');
  refreshDetail();
  if (!DT.raf) DT.raf = requestAnimationFrame(detailLoop);
}
function closeDetail(){
  if (!detailC) return;
  const c = detailC; detailC = null;
  $('#detail').classList.add('hidden'); $('#dtMenu').classList.add('hidden');
  cancelAnimationFrame(DT.raf); DT.raf = 0;
  const n = cartNode(c.id); if (n){ const nn = makeCart(c); n.replaceWith(nn); requestDraw(c.id); }
  save(); play('ui');
}
function refreshDetail(){
  const c = detailC; if (!c) return;
  $('#iTitle').value = c.title || ''; $('#iDev').value = c.info.dev || ''; $('#iYear').value = c.info.year || '';
  $('#iStart').value = c.info.start || ''; $('#iEnd').value = c.info.end || '';
  updateMeta();
  $('#dtFxBox').classList.toggle('folded', !!state.fxFolded);
  fxControls($('#dtFx'), c, onDetailFx);
  onDetailFx(true);
  renderMods();
}
function updateMeta(){
  const c = detailC, z = zoneOf(c);
  $('#iMeta').textContent = `${tplOf(c).name}${z ? ' · ' + z.title : ''}`;
  $('#dtTitle').textContent = c.title || '';
}
function onDetailFx(silent){
  const c = detailC, fx = normFx(c);
  const st = $('#dtStage');
  st.className = fxClass(fx).trim();
  setFxVars(st, fx);
  st.querySelectorAll('.sparks,.aura,.aura-cv').forEach(x => x.remove());
  if (fx.effects.includes('aura')) st.insertAdjacentHTML('afterbegin', auraHTML(fx.colors));
  if (fx.effects.includes('sparkle')) st.insertAdjacentHTML('beforeend', sparksHTML(22, fx.colors).replace('class="sparks"', 'class="sparks" style="inset:2%;--sc:2"').replace(/--s:([\d.]+)px/g, (m, v) => `--s:${(v * 1.9).toFixed(1)}px`));
  DT.dirty = true;
  if (silent !== true){ save(); const n = cartNode(c.id); if (n){ n.replaceWith(makeCart(c)); requestDraw(c.id); } }
}
function detailLoop(){
  DT.raf = 0; if (!detailC) return;
  if (!DT.drag && (Math.abs(DT.vx) + Math.abs(DT.vy) > .0004)){
    DT.rx += DT.vx; DT.ry += DT.vy; DT.vx *= .95; DT.vy *= .95; DT.dirty = true;
  }
  const ex = DT.thx - DT.hx, ey = DT.thy - DT.hy;
  if (Math.abs(ex) + Math.abs(ey) > .0005){ DT.hx += ex * .14; DT.hy += ey * .14; DT.dirty = true; }
  if (DT.dirty){ drawDetail(); DT.dirty = false; }
  DT.raf = requestAnimationFrame(detailLoop);
}
function drawDetail(){
  const c = detailC, box = $('#dtCenter').getBoundingClientRect();
  const t = tplOf(c), D = Math.hypot(t.bb.W, t.bb.H, t.T) * 1.04, unit = D * t.k;
  // сам картридж (а не холст под вращение) занимает ~70% свободного места — на любом экране
  const fitPx = Math.min(box.width - 20, box.height - 110) * .64;
  const size = Math.max(200, fitPx * D / Math.max(t.bb.W, t.bb.H) * DT.zoom);
  const cv = $('#dtCanvas');
  cv.style.width = cv.style.height = size + 'px';
  $('#dtStage').style.setProperty('--sz', size + 'px');
  $('#dtStage').style.transform = `translate(${DT.hy * 22}px, ${DT.hx * 22}px)`;
  renderCart({ ...c, rot: 0 }, cv, size * (window.devicePixelRatio || 1) / unit, DT.rx + DT.hx, DT.ry + DT.hy, { orbit: true, maxPx: DT.drag || Math.abs(DT.vx) + Math.abs(DT.vy) > .002 ? 1200 : 1800 });
  if (hasFx(c, 'aura')) updateAuraMask(cv);
}
const dc = $('#dtCenter');
dc.addEventListener('pointerdown', e => {
  if (e.button !== 0 || e.target.closest('button')) return;
  DT.drag = { x: e.clientX, y: e.clientY, t: performance.now() }; DT.vx = DT.vy = 0; DT.thx = DT.thy = 0;
  dc.classList.add('grab'); dc.setPointerCapture(e.pointerId); play('pick');
});
dc.addEventListener('pointermove', e => {
  if (!DT.drag) return;
  const dx = e.clientX - DT.drag.x, dy = e.clientY - DT.drag.y;
  DT.drag.x = e.clientX; DT.drag.y = e.clientY;
  DT.ry += dx * .011; DT.rx += dy * .011; DT.vy = dx * .011; DT.vx = dy * .011;
  DT.rx = clamp(DT.rx, -1.45, 1.45);
  if (Math.abs(DT.ry - DT.lastTick) > .45){ DT.lastTick = DT.ry; play('tick'); }
  DT.dirty = true;
});
const dtUp = () => { if (DT.drag){ DT.drag = null; dc.classList.remove('grab'); } };
dc.addEventListener('pointerleave', () => { DT.thx = DT.thy = 0; });
dc.addEventListener('pointerup', dtUp); dc.addEventListener('pointercancel', dtUp);
dc.addEventListener('wheel', e => { e.preventDefault(); DT.zoom = clamp(DT.zoom * (e.deltaY > 0 ? .92 : 1.08), .5, 1.6); DT.dirty = true; }, { passive: false });
const resetView = () => { DT.rx = DT.ry = DT.vx = DT.vy = 0; DT.zoom = 1; DT.dirty = true; play('snap'); };
dc.addEventListener('dblclick', resetView);
$('#dtReset').onclick = resetView;
$('#dtClose').onclick = closeDetail;
// блок «Эффекты» в карточке сворачивается; состояние запоминается
$('#dtFxHead').onclick = () => {
  state.fxFolded = !state.fxFolded;
  $('#dtFxBox').classList.toggle('folded', state.fxFolded);
  play('ui'); save();
};
$('#dtLook').onclick = () => openDialog(detailC);
window.addEventListener('resize', () => { if (detailC) DT.dirty = true; });

// поля «Об игре»
let titleT = null;
$('#iTitle').oninput = e => {
  detailC.title = e.target.value; updateMeta(); save();
  const tid = detailC.id;
  clearTimeout(titleT); titleT = setTimeout(() => { if (detailC) DT.dirty = true; requestDraw(tid); }, 250);
};
[['#iDev', 'dev'], ['#iYear', 'year'], ['#iStart', 'start'], ['#iEnd', 'end']].forEach(([sel, k]) => {
  $(sel).oninput = e => { detailC.info[k] = k === 'year' ? e.target.value.replace(/\D/g, '').slice(0, 4) : e.target.value; if (k === 'year') e.target.value = detailC.info.year; save(); };
});

// модули-блокноты
function autoGrow(ta){ ta.style.height = 'auto'; ta.style.height = Math.max(84, Math.ceil(ta.scrollHeight / 28) * 28) + 'px'; }
function renderMods(){
  const box = $('#dtMods'), mods = detailC.modules;
  box.innerHTML = mods.length ? '' : '<div class="dt-empty">Здесь пока пусто. Нажмите «＋ Модуль», чтобы завести заметки, рецензию или записку.</div>';
  mods.forEach((m, i) => {
    const el = document.createElement('div');
    el.className = `notebook mod p-${m.paper || 'lined'}${m.folded ? ' folded' : ''}`; el.dataset.id = m.id;
    el.style.setProperty('--tilt', (((i * 37) % 7) - 3) * .25 + 'deg');
    el.innerHTML = `<div class="mhead"><button class="mfold" data-a="fold" title="Свернуть / развернуть">▼</button><input class="mname" maxlength="40" value="${esc(m.name)}"></div>
      <div class="mprev">${esc((m.text || '').split('\n')[0] || 'пусто')}</div>
      <textarea class="mtext" placeholder="Пишите здесь…">${esc(m.text)}</textarea>
      <span class="mtools"><button data-a="up" title="Выше">↑</button><button data-a="down" title="Ниже">↓</button><button data-a="paper" title="Другая бумага">🎨</button><button data-a="del" title="Удалить">✕</button></span>`;
    box.appendChild(el);
    const ta = el.querySelector('textarea');
    requestAnimationFrame(() => autoGrow(ta));
    ta.oninput = () => { m.text = ta.value; autoGrow(ta); save(); };
    el.querySelector('.mname').oninput = e => { m.name = e.target.value; save(); };
  });
}
$('#dtMods').addEventListener('click', e => {
  const b = e.target.closest('.mtools button, .mfold'); if (!b) return;
  const mods = detailC.modules, id = b.closest('.mod').dataset.id, i = mods.findIndex(m => m.id === id), m = mods[i];
  if (b.dataset.a === 'up' && i > 0){ mods.splice(i - 1, 0, mods.splice(i, 1)[0]); play('ui'); }
  else if (b.dataset.a === 'down' && i < mods.length - 1){ mods.splice(i + 1, 0, mods.splice(i, 1)[0]); play('ui'); }
  else if (b.dataset.a === 'fold'){ m.folded = !m.folded; play('ui'); }
  else if (b.dataset.a === 'paper'){ m.paper = PAPERS[(PAPERS.indexOf(m.paper) + 1) % PAPERS.length]; play('ui'); }
  else if (b.dataset.a === 'del'){
    if (!b.classList.contains('armed')){ b.classList.add('armed'); b.textContent = '?'; b.title = 'Нажмите ещё раз, чтобы удалить'; setTimeout(() => { b.classList.remove('armed'); b.textContent = '✕'; }, 2500); return; }
    mods.splice(i, 1); play('del');
  } else return;
  save(); renderMods();
});
$('#dtAdd').onclick = e => {
  e.stopPropagation();
  const menu = $('#dtMenu');
  menu.innerHTML = MOD_PRESETS.map(([n, p], i) => `<button data-i="${i}">${esc(n)}</button>`).join('');
  menu.classList.toggle('hidden'); play('ui');
};
$('#dtMenu').onclick = e => {
  const b = e.target.closest('button'); if (!b) return;
  const [name, paper] = MOD_PRESETS[+b.dataset.i];
  const m = { id: uid(), name: name === 'Свой модуль' ? 'Новый модуль' : name, paper, text: '' };
  detailC.modules.push(m); $('#dtMenu').classList.add('hidden');
  save(); renderMods(); play('snap');
  const el = $(`#dtMods .mod[data-id="${m.id}"]`);
  if (el){ el.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); const inp = el.querySelector(name === 'Свой модуль' ? '.mname' : 'textarea'); inp.focus(); if (inp.select && name === 'Свой модуль') inp.select(); }
};
document.addEventListener('pointerdown', e => { if (!e.target.closest('#dtMenu,#dtAdd')) $('#dtMenu').classList.add('hidden'); });

/* ================= скин / звук / только доска ================= */
function applySkin(){
  document.body.classList.toggle('skin-cork', state.skin !== 'white');
  document.body.classList.toggle('skin-white', state.skin === 'white');
  $('#appName').textContent = state.skin === 'white' ? 'Маркерная доска' : 'Пробковая доска';
  SND.skin = state.skin;
}
$('#bSkin').onclick = () => { state.skin = state.skin === 'white' ? 'cork' : 'white'; applySkin(); play('snap'); save(); };
function applySound(){ SND.on = state.sound !== false; $('#bSound').textContent = SND.on ? '🔊' : '🔇'; }
$('#bSound').onclick = () => { state.sound = !SND.on; applySound(); play('ui'); save(); };

async function applyMinimal(lockWindow){
  document.body.classList.toggle('minimal', !!state.minimal);
  document.body.classList.remove('showbar');
  fit();
  if (lockWindow && state.minimal && api()){
    // подгоняем окно под пропорции доски, чтобы вокруг не было пустых полей
    const [, , w] = await api().get_rect();
    const k = w / window.innerWidth, pad = FR * k;
    await api().set_size(Math.round(w), Math.round((w - 2 * pad) * BH / BW + 2 * pad));
  }
}
$('#bMinimal').onclick = () => {
  state.minimal = !state.minimal; play('ui'); save(); applyMinimal(true);
  if (state.minimal) toast('Панель спрятана — подведите мышь к верхнему краю. Окно двигается за пустое место доски.');
};
let barT = null;
document.addEventListener('mousemove', e => {
  if (!state || !state.minimal) return;
  const near = e.clientY < 14 || e.target.closest('#bar');
  if (near){ clearTimeout(barT); barT = null; document.body.classList.add('showbar'); }
  else if (document.body.classList.contains('showbar') && !barT){
    barT = setTimeout(() => { document.body.classList.remove('showbar'); barT = null; }, 700);
  }
});

/* ================= окно (pywebview) ================= */
document.querySelectorAll('[data-drag]').forEach(el => el.addEventListener('pointerdown', e => {
  if (e.button === 0 && api() && (e.target === el || el.contains(e.target) && !e.target.closest('button'))){ e.preventDefault(); api().start_drag(); }
}));
function setModeBtn(){ $('#bMode').textContent = MODES[state.mode] || MODES.normal; }
$('#bMode').onclick = () => {
  state.mode = MODE_ORDER[(MODE_ORDER.indexOf(state.mode) + 1) % MODE_ORDER.length];
  setModeBtn(); save(); play('ui'); api() && api().set_mode(state.mode);
  toast({ normal: 'Обычное окно', top: 'Окно всегда поверх остальных', desktop: 'Режим виджета: доска уходит под окна, когда вы переключаетесь на другое' }[state.mode]);
};
window.addEventListener('blur', () => { if (state && state.mode === 'desktop' && api()) api().sink(); setHover(null); });
$('#bAuto').onclick = async () => {
  const on = !$('#bAuto').classList.contains('on');
  const res = await api().set_autostart(on);
  $('#bAuto').classList.toggle('on', !!res); play('ui');
  toast(res ? 'Доска будет запускаться вместе с Windows' : 'Автозапуск выключен');
};
$('#bMin').onclick = () => { play('ui'); api().minimize(); };
$('#bClose').onclick = async () => { await save(true); api().close(); };
$('#grip').addEventListener('pointerdown', e => {
  if (!api()) return;
  e.preventDefault();
  api().start_resize(state.minimal ? BH / BW : 0, FR, window.innerWidth);
});

/* ================= экспорт / импорт коллекции ================= */
$('#bExport').onclick = () => {
  const blob = new Blob([JSON.stringify(state, null, 1)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `korkboard-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  play('ui'); toast('Коллекция сохранена в файл');
};
$('#bImport').onclick = () => $('#fImport').click();
$('#fImport').onchange = async e => {
  const f = e.target.files[0]; e.target.value = ''; if (!f) return;
  let data = null;
  try { data = JSON.parse(await f.text()); } catch (err) {}
  if (!data || !Array.isArray(data.carts)){ toast('Это не файл коллекции'); return; }
  if (!confirm(`Заменить текущую доску коллекцией из файла (${data.carts.length} шт.)?`)) return;
  const prev = state;
  state = data; state.zones = state.zones || [];
  state.carts.forEach(c => { if (!TPL[c.platform]) c.platform = 'gb'; normFx(c); });
  topZ = Math.max(10, ...state.carts.map(c => c.z || 0));
  saveLocked = false; applySkin(); applySound(); render(); save(); play('snap');
  toast('Коллекция загружена', () => { state = prev; render(); save(); });
};

/* ================= запуск ================= */
let booted = false;
async function boot(){
  if (booted) return; booted = true;
  let raw = null;
  try {
    if (api()) raw = await api().load();
    else {
      raw = await idb.get('state').catch(() => null);
      if (!raw){ try { raw = localStorage.getItem('corkboard'); if (raw) setTimeout(() => save(), 500); } catch (e) {} }   // перенос со старой версии
    }
  } catch (e) {}
  try { state = raw ? JSON.parse(raw) : null; } catch (e) { state = null; }
  if (raw && (!state || !Array.isArray(state.carts))){
    // файл есть, но не читается — показываем пример, а сам файл не трогаем
    saveLocked = true;
    setTimeout(() => toast('data.json повреждён — изменения не сохраняются, файл не тронут. Проверьте копию data.json.bak'), 800);
  }
  if (!state || !Array.isArray(state.carts)) state = defaultState();
  state.zones = state.zones || []; state.mode = state.mode || 'normal'; state.skin = state.skin || 'cork';
  state.carts.forEach(c => { if (!TPL[c.platform]) c.platform = 'gb'; normFx(c); });   // Game Gear убран; эффекты — в новый формат
  topZ = Math.max(10, ...state.carts.map(c => c.z || 0));
  gl = initGL();
  if (gl) await loadModels();
  // картриджи стали крупнее на 50% — сохраняем центры на прежних местах
  if (!state.cartScale){ state.carts.forEach(c => { const t = tplOf(c); c.x = Math.round(c.x - t.w / 6); c.y = Math.round(c.y - t.h / 6); }); state.cartScale = 1.5; save(); }
  applySkin(); applySound();
  document.body.classList.toggle('minimal', !!state.minimal);
  fit(); buildDialog(); render();
  requestAnimationFrame(() => requestAnimationFrame(() => document.body.classList.remove('loading')));
  if (api()){
    document.body.classList.add('app');
    setModeBtn();
    api().set_mode(state.mode);
    api().get_autostart().then(on => $('#bAuto').classList.toggle('on', !!on));
    if (state.minimal) applyMinimal(true);
  }
  document.addEventListener('pointerdown', unlock, { once: true });
}
window.addEventListener('pywebviewready', boot);
if (api()) boot();
setTimeout(() => { if (!window.pywebview) boot(); }, 1200);
