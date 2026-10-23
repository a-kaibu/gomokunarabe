// 効果音はすべて Web Audio API で合成する（音声ファイルなし）。
let ctx = null;
let master = null;
let volume = 0.7;
let enabled = true;

function ac() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = volume;
    master.connect(ctx.destination);
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

export function setVolume(v) {
  volume = v;
  if (master) master.gain.value = v;
}
export function setEnabled(on) {
  enabled = on;
}
export const unlock = () => ac();

let noiseBuf = null;
function noise() {
  if (!noiseBuf) {
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 0.5, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  const s = ctx.createBufferSource();
  s.buffer = noiseBuf;
  return s;
}

function env(g, t, a, peak, d) {
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + a);
  g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
}

function burst(t, { freq = 1500, q = 1.2, peak = 0.6, dur = 0.08, type = 'bandpass' } = {}) {
  const n = noise();
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  f.Q.value = q;
  const g = ctx.createGain();
  env(g, t, 0.001, peak, dur);
  n.connect(f).connect(g).connect(master);
  n.start(t);
  n.stop(t + dur + 0.05);
}

function tone(t, freq, { type = 'sine', peak = 0.3, a = 0.004, dur = 0.3, slideTo = null } = {}) {
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
  const g = ctx.createGain();
  env(g, t, a, peak, dur);
  o.connect(g).connect(master);
  o.start(t);
  o.stop(t + a + dur + 0.05);
}

// 碁石を榧の盤に打つ「パチッ」
function stone(t, pitch = 1, peak = 1) {
  burst(t, { freq: 3200 * pitch, q: 1.4, peak: 0.9 * peak, dur: 0.025 });
  burst(t, { freq: 1200 * pitch, q: 2.5, peak: 0.45 * peak, dur: 0.05 });
  tone(t, 1050 * pitch, { type: 'triangle', peak: 0.16 * peak, a: 0.001, dur: 0.07, slideTo: 760 * pitch });
  tone(t, 190, { peak: 0.22 * peak, a: 0.002, dur: 0.09, slideTo: 120 });
}

function pluck(t, freq, peak = 0.2) {
  tone(t, freq, { type: 'triangle', peak, dur: 0.9 });
  tone(t, freq * 2, { type: 'sine', peak: peak * 0.35, dur: 0.5 });
  tone(t, freq * 3.01, { type: 'sine', peak: peak * 0.12, dur: 0.25 });
}

// 都節音階
const MIYAKO = [293.66, 311.13, 392.0, 440.0, 466.16, 587.33, 622.25, 783.99, 880.0];

const SOUNDS = {
  place: (t) => stone(t, 1, 1),
  cpu: (t) => stone(t, 0.94, 0.85),
  select: (t) => tone(t, 1500, { peak: 0.05, dur: 0.04 }),
  tap: (t) => tone(t, 1250, { peak: 0.07, dur: 0.05 }),
  undo: (t) => {
    burst(t, { freq: 2400, q: 1, peak: 0.25, dur: 0.03 });
    tone(t, 700, { peak: 0.08, dur: 0.08, slideTo: 1100 });
  },
  start: (t) => {
    pluck(t, MIYAKO[5], 0.12);
    pluck(t + 0.1, MIYAKO[7], 0.1);
  },
  win: (t) => [0, 2, 3, 5, 7, 8].forEach((k, i) => pluck(t + i * 0.1, MIYAKO[k], 0.2)),
  lose: (t) => [8, 6, 4, 1, 0].forEach((k, i) => pluck(t + i * 0.16, MIYAKO[k] / 2, 0.2)),
  draw: (t) => {
    pluck(t, MIYAKO[3], 0.15);
    pluck(t + 0.2, MIYAKO[2], 0.15);
  },
  error: (t) => tone(t, 150, { type: 'square', peak: 0.05, dur: 0.12 }),
  open: (t) => burst(t, { freq: 900, q: 0.5, peak: 0.1, dur: 0.16, type: 'lowpass' }),
};

export function play(name, delay = 0) {
  if (!enabled) return;
  const c = ac();
  if (!c || !SOUNDS[name]) return;
  SOUNDS[name](c.currentTime + 0.01 + delay);
}
