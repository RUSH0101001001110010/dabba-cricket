// Dabba Cricket: top face of a cube from ANY visible face, using the folded-net geometry + gravity.
// Net positions j: 0 top, 1 front, 2 left, 3 right, 4 bottom, 5 back (see cube_face_builder_v2.py)
// For each face: outward normal n, image-right u, image-down v, in cube coordinates.
const NET = [
  { n: [0, 1, 0], u: [1, 0, 0], v: [0, 0, 1] },
  { n: [0, 0, 1], u: [1, 0, 0], v: [0, -1, 0] },
  { n: [-1, 0, 0], u: [0, 0, 1], v: [0, -1, 0] },
  { n: [1, 0, 0], u: [0, 0, -1], v: [0, -1, 0] },
  { n: [0, -1, 0], u: [1, 0, 0], v: [0, 0, -1] },
  { n: [0, 0, -1], u: [1, 0, 0], v: [0, 1, 0] },
];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
// marker pose R = [x, y, z] (marker axes in camera coords; z points into the face)
// up_cube = R_cube^T up_cam, where R_cube = R_marker * F^T and F = [u v -n]  =>  up_cube = F * (R_marker^T up_cam)
export function upInCube(R, faceIndex, upCam) {
  const [x, y, z] = R, f = NET[faceIndex];
  const a = [dot(x, upCam), dot(y, upCam), dot(z, upCam)];   // up in marker frame
  return [0, 1, 2].map(i => f.u[i] * a[0] + f.v[i] * a[1] - f.n[i] * a[2]);
}
// markers: [{id, R, area}] for ONE cube (ids base..base+5). Returns {face, score, votes}
export function topFromCube(markers, base, upCam) {
  if (!markers.length || !upCam) return null;
  let acc = [0, 0, 0];
  for (const m of markers) {
    const u = upInCube(m.R, m.id - base, upCam);
    // faces seen straight-on give a much more precise rotation than very slanted ones
    const facing = Math.max(0.05, -(m.normal ? m.normal[2] : -1));
    const w = Math.sqrt(m.area || 1) * facing * facing;
    acc = acc.map((v, i) => v + u[i] * w);
  }
  const n = Math.hypot(...acc) || 1; acc = acc.map(v => v / n);
  let best = -1, bs = -2;
  NET.forEach((f, j) => { const s = dot(f.n, acc); if (s > bs) { bs = s; best = j; } });
  return { face: base + best, score: bs, votes: markers.length };
}

// ---- stable reading: voting window + hysteresis, so the answer doesn't flicker ----
export class CubeReader {
  constructor(opts = {}) { this.win = opts.win || 8; this.need = opts.need || 5; this.reset(); }
  reset() { this.hist = []; this.prev = new Map(); this.top = -1; this.settled = false; this.guess = -1; this.unseen = 0; this.moving = false; }
  // res: {face, score} or null; markers: visible markers of this cube (with corners, id)
  push(res, markers, minScore = 0.6) {
    // movement: mean shift of the same stamps between frames, relative to stamp size
    let shift = 0, n = 0, size = 0; const cur = new Map();
    for (const m of markers) {
      const c = m.corners.reduce((a, p) => [a[0] + p[0] / 4, a[1] + p[1] / 4], [0, 0]); cur.set(m.id, c);
      const side = Math.hypot(m.corners[0][0] - m.corners[2][0], m.corners[0][1] - m.corners[2][1]) / 1.414; size += side;
      const p = this.prev.get(m.id); if (p) { shift += Math.hypot(c[0] - p[0], c[1] - p[1]) / side; n++; }
    }
    this.prev = cur;
    this.moving = n > 0 && shift / n > 0.35;
    if (this.moving) { this.hist = []; this.settled = false; }
    if (!markers.length) { if (++this.unseen > 12) { this.reset(); } return this.view(); }
    this.unseen = 0;
    const f = res && res.score >= minScore ? res.face : -1;
    this.hist.push(f); if (this.hist.length > this.win) this.hist.shift();
    const counts = new Map(); for (const h of this.hist) if (h >= 0) counts.set(h, (counts.get(h) || 0) + 1);
    let mode = -1, mc = 0; for (const [k, c] of counts) if (c > mc) { mc = c; mode = k; }
    this.guess = mode;
    if (!this.settled) { if (mode >= 0 && mc >= this.need) { this.settled = true; this.top = mode; } }
    else if (mode !== this.top && mc >= this.need) { this.top = mode; }   // only switch on a clear new majority
    return this.view();
  }
  view() { return { top: this.settled ? this.top : this.guess, settled: this.settled, moving: this.moving, low: this.guess < 0 && this.hist.length > 0 }; }
}
