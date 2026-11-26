// Dabba Cricket: sound effects made in code with WebAudio (no sound files needed), plus optional voice clips.
let ctx = null, master = null, noiseBuf = null, muted = false;
export function initAudio() {
  if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
  try { ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { return; }
  master = ctx.createGain(); master.gain.value = 0.8; master.connect(ctx.destination);
  noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
  const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
}
export function setMuted(m) { muted = m; if (master) master.gain.value = m ? 0 : 0.8; }
const now = () => ctx.currentTime;
function noise(t0, dur, { type = 'bandpass', freq = 1000, q = 1, gain = 0.5, attack = 0.005, release = dur } = {}) {
  const s = ctx.createBufferSource(); s.buffer = noiseBuf; s.loop = true;
  const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
  const g = ctx.createGain(); g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(gain, t0 + attack); g.gain.exponentialRampToValueAtTime(0.0008, t0 + attack + release);
  s.connect(f); f.connect(g); g.connect(master); s.start(t0, Math.random()); s.stop(t0 + attack + release + 0.05); return { f, g };
}
function tone(t0, dur, { freq = 440, to = null, type = 'sine', gain = 0.3, attack = 0.004 } = {}) {
  const o = ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(freq, t0); if (to) o.frequency.exponentialRampToValueAtTime(to, t0 + dur);
  const g = ctx.createGain(); g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(gain, t0 + attack); g.gain.exponentialRampToValueAtTime(0.0008, t0 + dur);
  o.connect(g); g.connect(master); o.start(t0); o.stop(t0 + dur + 0.05);
}
const ok = () => ctx && !muted;
export const sfx = {
  bat(perfect) { if (!ok()) return; const t = now();                    // crack of tape-ball on bat
    noise(t, 0.08, { type: 'highpass', freq: perfect ? 2500 : 1500, gain: perfect ? 0.9 : 0.6, release: perfect ? 0.12 : 0.08 });
    tone(t, 0.09, { freq: perfect ? 1400 : 900, to: 300, type: 'triangle', gain: perfect ? 0.5 : 0.35 });
    if (perfect) tone(t + 0.01, 0.25, { freq: 2600, to: 1800, gain: 0.12 }); },
  whoosh() { if (!ok()) return; const t = now(); const n = noise(t, 0.25, { freq: 600, q: 2, gain: 0.25, attack: 0.08, release: 0.2 }); n.f.frequency.exponentialRampToValueAtTime(2400, t + 0.25); },
  bounce() { if (!ok()) return; tone(now(), 0.07, { freq: 220, to: 120, type: 'triangle', gain: 0.25 }); },
  thud() { if (!ok()) return; tone(now(), 0.12, { freq: 160, to: 70, gain: 0.35 }); },
  crowd(level = 1, dur = 2.2) { if (!ok()) return; const t = now();     // cheering: wide noise swells
    noise(t, dur, { freq: 900, q: 0.6, gain: 0.25 * level, attack: 0.25, release: dur });
    noise(t + 0.05, dur, { freq: 2200, q: 0.8, gain: 0.12 * level, attack: 0.3, release: dur * 0.9 });
    for (let i = 0; i < 6 * level; i++) tone(t + 0.1 + Math.random() * 0.8, 0.25, { freq: 700 + Math.random() * 900, to: 500 + Math.random() * 600, type: 'sawtooth', gain: 0.025 }); },
  groan() { if (!ok()) return; const t = now(); noise(t, 1.2, { freq: 400, q: 0.7, gain: 0.25, attack: 0.15, release: 1.1 }); tone(t, 1.0, { freq: 300, to: 160, type: 'sawtooth', gain: 0.04 }); },
  glass() { if (!ok()) return; const t = now();                         // window smash
    noise(t, 0.4, { type: 'highpass', freq: 3000, gain: 0.7, release: 0.45 });
    for (let i = 0; i < 9; i++) tone(t + Math.random() * 0.35, 0.3, { freq: 2500 + Math.random() * 4000, gain: 0.08 }); },
  stumps() { if (!ok()) return; const t = now(); for (let i = 0; i < 3; i++) tone(t + i * 0.06, 0.12, { freq: 520 - i * 60, to: 250, type: 'triangle', gain: 0.35 }); noise(t, 0.1, { freq: 1800, gain: 0.3 }); },
  heartbeat(n = 3, gap = 0.55) { if (!ok()) return; const t = now(); for (let i = 0; i < n; i++) { tone(t + i * gap, 0.12, { freq: 70, to: 45, gain: 0.5 }); tone(t + i * gap + 0.16, 0.1, { freq: 60, to: 40, gain: 0.35 }); } },
  drumroll(dur = 0.9) { if (!ok()) return; const t = now(); for (let x = 0; x < dur; x += 0.045) noise(t + x, 0.04, { freq: 260, q: 1.5, gain: 0.18 + 0.25 * (x / dur), release: 0.04 }); },
  slam() { if (!ok()) return; const t = now(); tone(t, 0.25, { freq: 120, to: 50, gain: 0.6 }); noise(t, 0.2, { freq: 800, gain: 0.4 }); },
  pop() { if (!ok()) return; tone(now(), 0.08, { freq: 900, to: 1400, gain: 0.15 }); },
  fanfare() { if (!ok()) return; const t = now(); [523, 659, 784, 1046].forEach((f, i) => tone(t + i * 0.12, 0.3, { freq: f, type: 'square', gain: 0.08 })); },
};
// recorded voice clips (e.g. the student's Chacha lines): voice/<ID>.mp3, silently skipped if missing
const voiceCache = new Map(); let voiceIds = null;
fetch('voice/manifest.json').then(r => r.ok ? r.json() : []).then(a => { voiceIds = new Set(a); }).catch(() => { voiceIds = new Set(); });
export function voice(id) {
  if (muted || !id || !voiceIds || !voiceIds.has(id)) return;
  let a = voiceCache.get(id);
  if (a === null) return;
  if (!a) { a = new Audio(`voice/${id}.mp3`); a.addEventListener('error', () => voiceCache.set(id, null)); voiceCache.set(id, a); }
  try { a.currentTime = 0; a.play().catch(() => {}); } catch (e) {}
}
