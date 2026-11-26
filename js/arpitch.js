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
  constructor() { this.local = null; this.frame = null; }
  reset() { this.local = null; this.frame = null; }
  // returns {pts: named camera-space points} or null
  update(anchors, up) {
    const A = anchors.bat && anchors.bat.age < 6 ? anchors.bat : null;
    const B = anchors.bowl && anchors.bowl.age < 6 ? anchors.bowl : null;
    let frame = null;
    if (A && B && up) {
      // both cubes: build the pitch frame from their positions, at top-face height
      const top = mul(up, S / 2);
      let d = sub(B.c, A.c); d = sub(d, mul(up, dot(d, up)));              // horizontal direction bat -> bowl
      const dist = Math.hypot(...d); if (dist < 0.05) return this.fromStored(A, B);
      const fwd = norm(d), side = norm(cross(up, fwd));
      const len = dist >= PITCH.snapMin && dist <= PITCH.snapMax ? dist : PITCH.len;   // connect the cubes when they're a sensible distance apart
      const mid = add(mul(add(A.c, B.c), 0.5), top);
      frame = { mid, fwd, side, up, len };
      this.local = { A: { mid: toLocal(A, mid), fwd: toLocalDir(A, fwd), side: toLocalDir(A, side), up: toLocalDir(A, up) },
                     B: { mid: toLocal(B, mid), fwd: toLocalDir(B, fwd), side: toLocalDir(B, side), up: toLocalDir(B, up) }, len };
    } else frame = this.fromStored(A, B);
    if (!frame) return null;
    // light smoothing in camera space
    if (this.frame) { const k = 0.5; for (const key of ['mid', 'fwd', 'side', 'up']) frame[key] = add(this.frame[key], mul(sub(frame[key], this.frame[key]), k)); frame.len = this.frame.len + (frame.len - this.frame.len) * k; }
    this.frame = frame;
    return { frame, pts: geometry(frame) };
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
