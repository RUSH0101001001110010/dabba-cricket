// Dabba Cricket: camera + cube tracking (stamp detection in a worker, pose, gravity, any-angle top face, settle check)
import { topFromCube } from './cubepose.js';

export const FACE_NAMES = ['DRIVE', 'PULL', 'CUT', 'LOFT', 'SWEEP', 'BLOCK', 'YORKER', 'BOUNCER', 'SPIN', 'SLOWER', 'WIDE', 'GOOD LENGTH'];
export const FACE_KEYS = ['drive', 'pull', 'cut', 'loft', 'sweep', 'block', 'yorker', 'bouncer', 'spin', 'slower', 'wide', 'goodlength'];
const FACE_M = 0.062, MARKER_M = FACE_M * 0.30;
const MIN_SCORE = 0.6, SETTLE_FRAMES = 5;

export class Tracker {
  constructor(video, opts = {}) {
    this.video = video;
    this.fovLong = opts.fovLong || 68;     // field of view across the LONG side of the image (deg)
    this.procLong = 1280;                  // processing size, long side (px); drops to 960 if slow
    this.flipUp = false;
    this.grav = null; this.state = { bat: newCube(), bowl: newCube() };
    this.running = false; this.busy = false; this.listeners = []; this.seq = 0;
    this.stats = { ms: 0, fps: 0, w: 0, h: 0, motion: false, cam: '' };
    this.worker = new Worker(new URL('./detect-worker.js', import.meta.url), { type: 'module' });
    this.worker.onmessage = (e) => this.onResult(e.data);
    this.cams = []; this.camIndex = 0;
  }
  on(fn) { this.listeners.push(fn); }
  async listBackCameras() {
    const devs = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'videoinput');
    let back = devs.filter(d => /back|rear|environment/i.test(d.label));
    if (!back.length) back = devs;
    // Samsung/Android labels look like "camera2 0, facing back": the lowest number is usually the main (1x) camera
    back.sort((a, b) => (parseInt((a.label.match(/(\d+)/) || [0, 99])[1]) - parseInt((b.label.match(/(\d+)/) || [0, 99])[1])));
    return back;
  }
  async openCamera(deviceId) {
    if (this.video.srcObject) this.video.srcObject.getTracks().forEach(t => t.stop());
    const video = deviceId ? { deviceId: { exact: deviceId }, width: { ideal: 1920 }, height: { ideal: 1080 } }
                           : { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } };
    const stream = await navigator.mediaDevices.getUserMedia({ audio: false, video });
    this.video.srcObject = stream; this.video.setAttribute('playsinline', ''); this.video.muted = true;
    await this.video.play();
    const track = stream.getVideoTracks()[0];
    try { const c = track.getCapabilities && track.getCapabilities(); if (c && c.focusMode && c.focusMode.includes('continuous')) await track.applyConstraints({ advanced: [{ focusMode: 'continuous' }] }); } catch (e) {}
    this.stats.cam = track.label || '';
  }
  async start() {
    await this.openCamera(null);                       // first call asks permission, then labels become visible
    this.cams = await this.listBackCameras();
    let saved = null; try { saved = localStorage.getItem('dabba-cam'); } catch (e) {}
    let idx = this.cams.findIndex(c => c.deviceId === saved);
    if (idx < 0) idx = 0;
    if (this.cams[idx] && this.cams[idx].label !== this.stats.cam) { try { await this.openCamera(this.cams[idx].deviceId); } catch (e) {} }
    this.camIndex = idx;
    window.addEventListener('devicemotion', e => {
      const a = e.accelerationIncludingGravity; if (!a || a.x == null) return;
      const k = 0.15, g = this.grav || [a.x, a.y, a.z];
      this.grav = [g[0] + k * (a.x - g[0]), g[1] + k * (a.y - g[1]), g[2] + k * (a.z - g[2])];
      this.stats.motion = true;
    });
    this.running = true; this.loop();
  }
  async nextCamera() {
    if (!this.cams.length) return '';
    this.camIndex = (this.camIndex + 1) % this.cams.length;
    const c = this.cams[this.camIndex];
    await this.openCamera(c.deviceId); try { localStorage.setItem('dabba-cam', c.deviceId); } catch (e) {}
    this.resetReads(); return c.label;
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
  async loop() {
    if (!this.running) return;
    const v = this.video;
    if (!this.busy && v.readyState >= 2 && v.videoWidth) {
      const sc = this.procLong / Math.max(v.videoWidth, v.videoHeight);
      const w = Math.round(v.videoWidth * sc), h = Math.round(v.videoHeight * sc);
      const f = (Math.max(w, h) / 2) / Math.tan(this.fovLong * Math.PI / 360);
      try {
        const bitmap = await createImageBitmap(v, { resizeWidth: w, resizeHeight: h, resizeQuality: 'low' });
        this.busy = true; this.frameUp = this.upCam();
        this.worker.postMessage({ bitmap, w, h, f, size: MARKER_M, id: ++this.seq }, [bitmap]);
      } catch (e) { /* frame not ready */ }
    }
    requestAnimationFrame(() => this.loop());
  }
  onResult({ markers, ms, w, h }) {
    this.busy = false;
    this.stats.ms = this.stats.ms * 0.8 + ms * 0.2; this.stats.w = w; this.stats.h = h;
    const now = performance.now(); if (this.last) this.stats.fps = this.stats.fps * 0.8 + 200 / (now - this.last); this.last = now;
    if (this.stats.ms > 140 && this.procLong > 960) this.procLong = 960;   // keep it responsive on slower phones
    this.update(markers, w, h, this.frameUp);
  }
  update(markers, w, h, up) {
    const bat = markers.filter(m => m.id < 6), bowl = markers.filter(m => m.id >= 6);
    let tb, tw;
    if (up) { tb = topFromCube(bat, 0, up); tw = topFromCube(bowl, 6, up); }
    else { const p = pairTop(bat, bowl); tb = p ? { face: p[0].id, score: p[2] } : single(bat); tw = p ? { face: p[1].id, score: p[2] } : single(bowl); }
    settle(this.state.bat, tb, bat); settle(this.state.bowl, tw, bowl);
    const snap = { markers, up, w, h, bat: { ...this.state.bat }, bowl: { ...this.state.bowl }, stats: { ...this.stats } };
    this.listeners.forEach(fn => fn(snap));
  }
  resetReads() { this.state = { bat: newCube(), bowl: newCube() }; }
}
function newCube() { return { top: -1, name: '', count: 0, settled: false, score: 0, center: null, seen: 0, low: false }; }
function single(ms) { return ms.length === 1 ? { face: ms[0].id, score: 0.7 } : null; }
function pairTop(A, B) {
  let best = null, bs = -2;
  for (const a of A) for (const b of B) { const s = a.normal[0] * b.normal[0] + a.normal[1] * b.normal[1] + a.normal[2] * b.normal[2]; if (s > bs) { bs = s; best = [a, b, s]; } }
  return best;
}
function settle(st, res, ms) {
  if (!res || !ms.length) { st.seen = Math.max(0, st.seen - 1); if (st.seen === 0) { st.count = 0; st.settled = false; st.top = -1; } return; }
  const c = ms.reduce((a, m) => { const k = m.corners.reduce((s, p) => [s[0] + p[0] / 4, s[1] + p[1] / 4], [0, 0]); return [a[0] + k[0] / ms.length, a[1] + k[1] / ms.length]; }, [0, 0]);
  const moved = st.center ? Math.hypot(c[0] - st.center[0], c[1] - st.center[1]) : 999;
  st.low = res.score < MIN_SCORE;
  if (res.face === st.top && moved < 14 && !st.low) st.count++; else { st.count = st.low ? 0 : 1; st.settled = false; }
  st.top = res.face; st.name = FACE_NAMES[res.face]; st.center = c; st.score = res.score; st.seen = 4;
  if (st.count >= SETTLE_FRAMES) st.settled = true;
}
