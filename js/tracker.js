// Dabba Cricket: camera + cube tracking (marker detection, pose, gravity, top-face, settle check)
import { detectMarkers, pose } from './aruco4.js';

export const FACE_NAMES = ['DRIVE', 'PULL', 'CUT', 'LOFT', 'SWEEP', 'BLOCK', 'YORKER', 'BOUNCER', 'SPIN', 'SLOWER', 'WIDE', 'GOOD LENGTH'];
export const FACE_KEYS = ['drive', 'pull', 'cut', 'loft', 'sweep', 'block', 'yorker', 'bouncer', 'spin', 'slower', 'wide', 'goodlength'];
const FACE_M = 0.062;              // printed face size (m)
const MARKER_M = FACE_M * 0.30;    // stamp = 600/2000 of the face
const PROC_W = 1280;               // processing width (px)

export class Tracker {
  constructor(video, opts = {}) {
    this.video = video;
    this.hfov = opts.hfov || 66;    // assumed horizontal field of view (deg)
    this.flipUp = false;
    this.canvas = document.createElement('canvas');
    this.ctx = this.canvas.getContext('2d', { willReadFrequently: true });
    this.grav = null;               // low-passed accelerationIncludingGravity (device frame)
    this.state = { bat: newCube(), bowl: newCube() };
    this.running = false; this.listeners = [];
    this.stats = { ms: 0, fps: 0, w: 0, h: 0, motion: false };
  }
  on(fn) { this.listeners.push(fn); }
  async start() {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: false, video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } } });
    this.video.srcObject = stream; this.video.setAttribute('playsinline', ''); this.video.muted = true;
    await this.video.play();
    window.addEventListener('devicemotion', e => {
      const a = e.accelerationIncludingGravity; if (!a || a.x == null) return;
      const k = 0.15, g = this.grav || [a.x, a.y, a.z];
      this.grav = [g[0] + k * (a.x - g[0]), g[1] + k * (a.y - g[1]), g[2] + k * (a.z - g[2])];
      this.stats.motion = true;
    });
    this.running = true; this.loop();
  }
  stop() { this.running = false; const s = this.video.srcObject; if (s) s.getTracks().forEach(t => t.stop()); }
  upCam() { // world "up" in camera coords (x right, y down, z forward), from gravity + screen orientation
    if (!this.grav) return null;
    const ang = ((screen.orientation && screen.orientation.angle) || window.orientation || 0) * Math.PI / 180;
    const [x, y, z] = this.grav, c = Math.cos(ang), s = Math.sin(ang);
    const xs = x * c - y * s, ys = x * s + y * c, zs = z;
    let u = [xs, -ys, -zs]; const n = Math.hypot(...u) || 1; u = u.map(v => v / n);
    return this.flipUp ? u.map(v => -v) : u;
  }
  loop() {
    if (!this.running) return;
    const v = this.video;
    if (v.readyState >= 2 && v.videoWidth) {
      const w = PROC_W, h = Math.round(PROC_W * v.videoHeight / v.videoWidth);
      if (this.canvas.width !== w) { this.canvas.width = w; this.canvas.height = h; }
      this.ctx.drawImage(v, 0, 0, w, h);
      const t0 = performance.now();
      const d = this.ctx.getImageData(0, 0, w, h).data, g = new Uint8Array(w * h);
      for (let i = 0, j = 0; i < g.length; i++, j += 4) g[i] = (d[j] * 77 + d[j + 1] * 150 + d[j + 2] * 29) >> 8;
      const f = (w / 2) / Math.tan(this.hfov * Math.PI / 360);
      const markers = detectMarkers(g, w, h).map(m => {
        const p = pose(m.corners, MARKER_M, f, w / 2, h / 2);
        return { ...m, normal: p ? p.normal : [0, 0, -1], t: p ? p.t : [0, 0, 1] };
      });
      const ms = performance.now() - t0;
      this.stats.ms = this.stats.ms * 0.8 + ms * 0.2; this.stats.w = w; this.stats.h = h;
      const now = performance.now(); if (this.last) this.stats.fps = this.stats.fps * 0.8 + 200 / (now - this.last); this.last = now;
      this.update(markers, w, h);
    }
    requestAnimationFrame(() => this.loop());
  }
  update(markers, w, h) {
    const up = this.upCam();
    const bat = markers.filter(m => m.id < 6), bowl = markers.filter(m => m.id >= 6);
    let tb = pickTop(bat, up), tw = pickTop(bowl, up);
    if (!up && bat.length && bowl.length) { // no motion sensor: the two top faces are the most parallel pair
      const p = pairTop(bat, bowl); if (p) { tb = { m: p[0], score: p[2] }; tw = { m: p[1], score: p[2] }; }
    }
    settle(this.state.bat, tb.m, tb.score);
    settle(this.state.bowl, tw.m, tw.score);
    const snap = { markers, up, w, h, bat: { ...this.state.bat }, bowl: { ...this.state.bowl }, stats: { ...this.stats } };
    this.listeners.forEach(fn => fn(snap));
  }
  resetReads() { this.state = { bat: newCube(), bowl: newCube() }; }
}
function newCube() { return { top: -1, name: '', count: 0, settled: false, score: 0, center: null, seen: 0 }; }
function pickTop(ms, up) {
  if (!ms.length) return { m: null, score: 0 };
  if (!up) { // single visible face, or the face looking most at the camera
    let best = ms[0]; for (const m of ms) if (-m.normal[2] > -best.normal[2]) best = m; return { m: best, score: ms.length === 1 ? 1 : 0.5 };
  }
  let best = null, bs = -2;
  for (const m of ms) { const s = m.normal[0] * up[0] + m.normal[1] * up[1] + m.normal[2] * up[2]; if (s > bs) { bs = s; best = m; } }
  return { m: best, score: bs };
}
function pairTop(A, B) {
  let best = null, bs = -2;
  for (const a of A) for (const b of B) { const s = a.normal[0] * b.normal[0] + a.normal[1] * b.normal[1] + a.normal[2] * b.normal[2]; if (s > bs) { bs = s; best = [a, b, s]; } }
  return best;
}
function settle(st, m, score) {
  if (!m) { st.seen = Math.max(0, st.seen - 1); if (st.seen === 0) { st.count = 0; st.settled = false; } return; }
  const c = m.corners.reduce((a, p) => [a[0] + p[0] / 4, a[1] + p[1] / 4], [0, 0]);
  const moved = st.center ? Math.hypot(c[0] - st.center[0], c[1] - st.center[1]) : 999;
  if (m.id === st.top && moved < 12) st.count++; else { st.count = 1; st.settled = false; }
  st.top = m.id; st.name = FACE_NAMES[m.id]; st.center = c; st.score = score; st.seen = 4;
  if (st.count >= 6) st.settled = true;
}
