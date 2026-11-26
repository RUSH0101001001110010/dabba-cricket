// Dabba Cricket: the AR pitch. Fixed size, at the height of the cubes' top faces,
// laid along the line between the two cubes. Stored in each cube's own frame, so it
// stays in place even when only one cube is visible.
const S = 0.062;                 // cube size (m)
export const PITCH = { len: 0.30, wid: 0.07, stumpH: 0.035, snapMin: 0.22, snapMax: 0.40 };
const add = (a, b) => a.map((v, i) => v + b[i]), sub = (a, b) => a.map((v, i) => v - b[i]), mul = (a, k) => a.map(v => v * k);
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = a => mul(a, 1 / (Math.hypot(...a) || 1));
const toLocal = (A, p) => { const d = sub(p, A.c); return [dot(A.R[0], d), dot(A.R[1], d), dot(A.R[2], d)]; };
const toCam = (A, q) => add(A.c, add(add(mul(A.R[0], q[0]), mul(A.R[1], q[1])), mul(A.R[2], q[2])));

export class PitchAnchor {
  constructor() { this.reset(); }
  reset() { this.local = null; this.frame = null; this.h = null; this.bad = 0; }
  // always returns {frame, pts} or null (never throws on odd input)
  update(anchors, up) {
    const A = anchors.bat && anchors.bat.age < 6 && anchors.bat.R ? anchors.bat : null;
    const B = anchors.bowl && anchors.bowl.age < 6 && anchors.bowl.R ? anchors.bowl : null;
    if (!A && !B) return null;                       // nothing to anchor to: hide the pitch
    let frame = null;
    if (A && B && up) frame = this.fromBoth(A, B, up);
    if (!frame) frame = this.fromStored(A, B);
    if (!frame || frame.mid.some(v => !isFinite(v))) return this.frame ? { frame: this.frame, pts: geometry(this.frame) } : null;
    if (this.frame) {
      // ignore single wild jumps (bad stamp reads); accept if the jump persists (cube really moved)
      const jump = Math.hypot(...sub(frame.mid, this.frame.mid));
      if (jump > 0.06 && ++this.bad < 4) return { frame: this.frame, pts: geometry(this.frame) };
      this.bad = 0;
      const k = 0.3;
      for (const key of ['mid', 'fwd', 'side', 'up']) frame[key] = add(this.frame[key], mul(sub(frame[key], this.frame[key]), k));
      frame.fwd = norm(frame.fwd); frame.side = norm(frame.side); frame.up = norm(frame.up);
      frame.len = this.frame.len + (frame.len - this.frame.len) * k;
    }
    this.frame = frame;
    return { frame, pts: geometry(frame) };
  }
  fromBoth(A, B, up) {
    // both cubes stand on one table: share one plane height, and slide each cube along its camera ray onto it
    const hA = dot(A.c, up), hB = dot(B.c, up), h = (hA + hB) / 2;
    this.h = this.h == null ? h : this.h + 0.15 * (h - this.h);
    const onPlane = C => { const r = dot(C.c, up); const k = this.h / r; return (r !== 0 && k > 0.6 && k < 1.6) ? mul(C.c, k) : C.c; };
    const a = onPlane(A), b = onPlane(B);
    let d = sub(b, a); d = sub(d, mul(up, dot(d, up)));
    const dist = Math.hypot(...d); if (dist < 0.08) return null;           // cubes too close together (e.g. while rolling)
    const fwd = norm(d), side = norm(cross(up, fwd));
    const len = dist >= PITCH.snapMin && dist <= PITCH.snapMax ? dist : PITCH.len;
    const mid = add(mul(add(a, b), 0.5), mul(up, S / 2));
    this.local = { A: { mid: toLocal(A, mid), fwd: toLocalDir(A, fwd), side: toLocalDir(A, side), up: toLocalDir(A, up) },
                   B: { mid: toLocal(B, mid), fwd: toLocalDir(B, fwd), side: toLocalDir(B, side), up: toLocalDir(B, up) }, len };
    return { mid, fwd, side, up, len };
  }
  fromStored(A, B) {
    if (!this.local) return null;
    const C = A || B, L = A ? this.local.A : this.local.B; if (!C) return null;
    return { mid: toCam(C, L.mid), fwd: dirToCam(C, L.fwd), side: dirToCam(C, L.side), up: dirToCam(C, L.up), len: this.local.len };
  }
}
function toLocalDir(A, v) { return [dot(A.R[0], v), dot(A.R[1], v), dot(A.R[2], v)]; }
function dirToCam(A, q) { return add(add(mul(A.R[0], q[0]), mul(A.R[1], q[1])), mul(A.R[2], q[2])); }
export function geometry(F) {
  const P = (along, across, upk = 0) => add(add(add(F.mid, mul(F.fwd, along)), mul(F.side, across)), mul(F.up, upk));
  const h = F.len / 2, w = PITCH.wid / 2;
  const out = { quad: [P(-h, -w), P(-h, w), P(h, w), P(h, -w)], creases: [], stumps: [] };
  for (const e of [-1, 1]) {
    const c = e * (h - 0.018); out.creases.push([P(c, -w), P(c, w)]);
    for (const k of [-0.009, 0, 0.009]) out.stumps.push([P(e * (h - 0.006), k), P(e * (h - 0.006), k, PITCH.stumpH)]);
  }
  return out;
}
