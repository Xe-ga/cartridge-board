// Мягкие «деревянно-стеклянные» ноты: короткие тёплые тона из пентатоники + лёгкое эхо комнаты.
// Без резких щелчков и шума. Всё синтезируется через WebAudio, без файлов.
let ctx = null, master = null, wet = null;
export const SND = { on: true, skin: 'cork' };

function init(){
  if (!ctx){
    try { ctx = new AudioContext(); } catch (e){ return false; }
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 4200; lp.Q.value = .4;
    master = ctx.createGain(); master.gain.value = .7;
    master.connect(lp).connect(ctx.destination);
    // маленькая «комната»: затухающий шумовой импульс
    const len = ctx.sampleRate * .9, ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++){ const d = ir.getChannelData(ch); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.2); }
    const conv = ctx.createConvolver(); conv.buffer = ir;
    wet = ctx.createGain(); wet.gain.value = .22;
    wet.connect(conv).connect(lp);
  }
  if (ctx.state === 'suspended') ctx.resume();
  return true;
}
// нота: основной тон + тихая октава + лёгкая квинта, мягкая атака, плавное затухание
function note(freq, { at = 0, dur = .35, gain = .12, bright = 1 } = {}){
  const t = ctx.currentTime + at, out = ctx.createGain();
  out.gain.setValueAtTime(0, t);
  out.gain.linearRampToValueAtTime(gain, t + .012);
  out.gain.exponentialRampToValueAtTime(.0004, t + dur);
  const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.setValueAtTime(freq * 6 * bright, t); f.frequency.exponentialRampToValueAtTime(freq * 1.5, t + dur);
  out.connect(f); f.connect(master); f.connect(wet);
  [[1, 1, 'sine'], [2, .28, 'sine'], [3, .08, 'triangle']].forEach(([m, g, type]) => {
    const o = ctx.createOscillator(), v = ctx.createGain();
    o.type = type; o.frequency.value = freq * m; v.gain.value = g;
    o.connect(v).connect(out); o.start(t); o.stop(t + dur + .05);
  });
}
// мягкий низкий «тум» — касание о доску
function soft(freq, at = 0, gain = .1, dur = .14){
  const t = ctx.currentTime + at, o = ctx.createOscillator(), v = ctx.createGain();
  o.type = 'sine'; o.frequency.setValueAtTime(freq, t); o.frequency.exponentialRampToValueAtTime(freq * .55, t + dur);
  v.gain.setValueAtTime(0, t); v.gain.linearRampToValueAtTime(gain, t + .01); v.gain.exponentialRampToValueAtTime(.0004, t + dur);
  o.connect(v).connect(master); o.start(t); o.stop(t + dur + .03);
}
// пентатоника (ми-мажор-ish), чтобы любые сочетания звучали приятно
const SCALE = [329.63, 369.99, 415.3, 493.88, 554.37, 659.25, 739.99, 830.61, 987.77];
const pick = (a, b) => SCALE[a + Math.floor(Math.random() * (b - a + 1))];
// небольшая мелодия в той же пентатонике (ми мажор): вопрос — ответ
const N = { E4: 329.63, Fs4: 369.99, Gs4: 415.3, B4: 493.88, Cs5: 554.37, E5: 659.25, Fs5: 739.99, Gs5: 830.61 };
const MELODY = [N.E4, N.Gs4, N.B4, N.E5, N.Cs5, N.B4, N.Gs4, N.B4,
                N.Fs4, N.Gs4, N.B4, N.Cs5, N.B4, N.Gs4, N.Fs4, N.E4,
                N.B4, N.Cs5, N.E5, N.Fs5, N.Gs5, N.Fs5, N.E5, N.Cs5,
                N.B4, N.Gs4, N.B4, N.Cs5, N.B4, N.Gs4, N.Fs4, N.E4];
const melody = { i: 0, last: -10 };

const sounds = {
  hover(){ note(pick(5, 8), { dur: .18, gain: .025, bright: .6 }); },
  pick(){ note(pick(3, 5), { dur: .28, gain: .09 }); },
  drop(){
    soft(SND.skin === 'white' ? 190 : 140, 0, .14);
    note(pick(0, 3), { at: .015, dur: .4, gain: .09, bright: .8 });
  },
  // вращение: каждая «щёлкнувшая» ступень — следующая нота мелодии; пауза > 1.4 с — мелодия с начала
  tick(){
    const now = ctx.currentTime;
    if (now - melody.last < .08) return;          // быстрое вращение не сливается в кашу
    if (now - melody.last > 1.4) melody.i = 0;
    melody.last = now;
    note(MELODY[melody.i % MELODY.length], { dur: .32, gain: .055, bright: .7 });
    melody.i++;
  },
  ui(){ note(SCALE[4], { dur: .22, gain: .07 }); },
  open(){ note(SCALE[2], { dur: .4, gain: .07 }); note(SCALE[4], { at: .07, dur: .4, gain: .06 }); note(SCALE[6], { at: .14, dur: .5, gain: .05 }); },
  del(){ note(SCALE[4], { dur: .3, gain: .07 }); note(SCALE[1], { at: .09, dur: .45, gain: .07, bright: .7 }); },
  snap(){ note(SCALE[3], { dur: .25, gain: .07 }); note(SCALE[5], { at: .06, dur: .35, gain: .06 }); },
};
export function play(name){
  if (!SND.on || !init()) return;
  try { sounds[name](); } catch (e){}
}
export const unlock = () => init();
