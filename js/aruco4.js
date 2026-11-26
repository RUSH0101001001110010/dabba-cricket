// Dabba Cricket: small, dependency-free ArUco detector (DICT_4X4_50, ids 0-11) + planar pose.
// Written for this project. Works on a grayscale Uint8Array (w*h).

export const CODES = [[[1,0,1,1],[0,1,0,1],[0,0,1,1],[0,0,1,0]],[[0,0,0,0],[1,1,1,1],[1,0,0,1],[1,0,1,0]],[[0,0,1,1],[0,0,1,1],[0,0,1,0],[1,1,0,1]],
[[1,0,0,1],[1,0,0,1],[0,1,0,0],[0,1,1,0]],[[0,1,0,1],[0,1,0,0],[1,0,0,1],[1,1,1,0]],[[0,1,1,1],[1,0,0,1],[1,1,0,0],[1,1,0,1]],
[[1,0,0,1],[1,1,1,0],[0,0,1,0],[1,1,1,0]],[[1,1,0,0],[0,1,0,0],[1,1,1,1],[0,0,1,0]],[[1,1,1,1],[1,1,1,0],[1,1,0,1],[1,0,1,0]],
[[1,1,0,0],[1,1,1,1],[0,1,0,1],[0,1,1,0]],[[1,1,1,1],[1,0,0,1],[1,0,0,1],[0,0,0,1]],[[0,0,0,1],[0,0,0,1],[1,0,1,0],[0,1,1,1]]];
const CODEBITS = CODES.map(c => c.flat());

// ---------- adaptive threshold (dark = 1) ----------
function threshold(g, w, h, r, C) {
  const W1 = w + 1, I = new Uint32Array(W1 * (h + 1));
  for (let y = 0; y < h; y++) {
    let row = 0;
    for (let x = 0; x < w; x++) { row += g[y * w + x]; I[(y + 1) * W1 + x + 1] = I[y * W1 + x + 1] + row; }
  }
  const b = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - r), y1 = Math.min(h, y + r + 1);
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - r), x1 = Math.min(w, x + r + 1);
      const s = I[y1 * W1 + x1] - I[y0 * W1 + x1] - I[y1 * W1 + x0] + I[y0 * W1 + x0];
      const n = (x1 - x0) * (y1 - y0);
      b[y * w + x] = g[y * w + x] * n < s - C * n ? 1 : 0;
    }
  }
  return b;
}

// ---------- connected components (4-connected, iterative flood) ----------
function components(b, w, h, minSide, maxSide) {
  const lab = new Int32Array(w * h), stack = new Int32Array(w * h), comps = [];
  let next = 1;
  for (let i = 0; i < w * h; i++) {
    if (!b[i] || lab[i]) continue;
    let sp = 0; stack[sp++] = i; lab[i] = next;
    let minx = w, miny = h, maxx = 0, maxy = 0, n = 0;
    while (sp) {
      const p = stack[--sp], x = p % w, y = (p / w) | 0; n++;
      if (x < minx) minx = x; if (x > maxx) maxx = x; if (y < miny) miny = y; if (y > maxy) maxy = y;
      if (x > 0 && b[p - 1] && !lab[p - 1]) { lab[p - 1] = next; stack[sp++] = p - 1; }
      if (x < w - 1 && b[p + 1] && !lab[p + 1]) { lab[p + 1] = next; stack[sp++] = p + 1; }
      if (y > 0 && b[p - w] && !lab[p - w]) { lab[p - w] = next; stack[sp++] = p - w; }
      if (y < h - 1 && b[p + w] && !lab[p + w]) { lab[p + w] = next; stack[sp++] = p + w; }
    }
    const bw = maxx - minx + 1, bh = maxy - miny + 1;
    if (bw >= minSide && bh >= minSide && bw <= maxSide && bh <= maxSide && n > 0.25 * bw * bh * 0.5)
      comps.push({ id: next, minx, miny, maxx, maxy, n });
    next++;
  }
  return { lab, comps };
}

// ---------- geometry helpers ----------
function hull(pts) { // monotone chain, returns CCW in math coords (= CW-ish in image), no duplicates
  pts.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo = [], up = [];
  for (const p of pts) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop(); lo.push(p); }
  for (let i = pts.length - 1; i >= 0; i--) { const p = pts[i]; while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], p) <= 0) up.pop(); up.push(p); }
  up.pop(); lo.pop(); return lo.concat(up);
}
function polyArea(P) { let a = 0; for (let i = 0; i < P.length; i++) { const p = P[i], q = P[(i + 1) % P.length]; a += p[0] * q[1] - q[0] * p[1]; } return a / 2; }
function distLine(p, a, b) { const dx = b[0] - a[0], dy = b[1] - a[1]; return ((p[0] - a[0]) * dy - (p[1] - a[1]) * dx) / Math.hypot(dx, dy); }
function quadFromHull(H) { // pick 4 hull vertices maximizing area (diagonal heuristic)
  const n = H.length; if (n < 4) return null;
  let bi = 0, bj = 0, bd = -1;
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) { const d = (H[i][0] - H[j][0]) ** 2 + (H[i][1] - H[j][1]) ** 2; if (d > bd) { bd = d; bi = i; bj = j; } }
  let k1 = -1, k2 = -1, d1 = 0, d2 = 0;
  for (let k = 0; k < n; k++) { const d = distLine(H[k], H[bi], H[bj]); if (d > d1) { d1 = d; k1 = k; } if (d < d2) { d2 = d; k2 = k; } }
  if (k1 < 0 || k2 < 0) return null;
  const idx = [bi, k1, bj, k2].sort((a, b) => a - b);
  return idx.map(i => H[i]);
}
// solve 8x8 linear system (Gaussian elimination)
function solve(A, b) {
  const n = b.length;
  for (let i = 0; i < n; i++) {
    let m = i; for (let r = i + 1; r < n; r++) if (Math.abs(A[r][i]) > Math.abs(A[m][i])) m = r;
    [A[i], A[m]] = [A[m], A[i]]; [b[i], b[m]] = [b[m], b[i]];
    if (Math.abs(A[i][i]) < 1e-12) return null;
    for (let r = i + 1; r < n; r++) { const f = A[r][i] / A[i][i]; for (let c = i; c < n; c++) A[r][c] -= f * A[i][c]; b[r] -= f * b[i]; }
  }
  const x = new Array(n);
  for (let i = n - 1; i >= 0; i--) { let s = b[i]; for (let c = i + 1; c < n; c++) s -= A[i][c] * x[c]; x[i] = s / A[i][i]; }
  return x;
}
export function homography(src, dst) { // maps src[i] -> dst[i], 4 points
  const A = [], b = [];
  for (let i = 0; i < 4; i++) {
    const [x, y] = src[i], [u, v] = dst[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); b.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]); b.push(v);
  }
  const h = solve(A, b); if (!h) return null; h.push(1); return h;
}
function apply(H, x, y) { const z = H[6] * x + H[7] * y + H[8]; return [(H[0] * x + H[1] * y + H[2]) / z, (H[3] * x + H[4] * y + H[5]) / z]; }

// refine each corner: fit lines to boundary pixels near each quad side, intersect
function refine(quad, bpts) {
  const lines = [];
  for (let s = 0; s < 4; s++) {
    const a = quad[s], b = quad[(s + 1) % 4], L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    let sx = 0, sy = 0, n = 0; const sel = [];
    for (const p of bpts) {
      const t = ((p[0] - a[0]) * (b[0] - a[0]) + (p[1] - a[1]) * (b[1] - a[1])) / (L * L);
      if (t < 0.12 || t > 0.88) continue;
      if (Math.abs(distLine(p, a, b)) > Math.max(2, L * 0.06)) continue;
      sel.push(p); sx += p[0]; sy += p[1]; n++;
    }
    if (n < 6) return quad;
    const mx = sx / n, my = sy / n; let xx = 0, xy = 0, yy = 0;
    for (const p of sel) { const dx = p[0] - mx, dy = p[1] - my; xx += dx * dx; xy += dx * dy; yy += dy * dy; }
    const ang = 0.5 * Math.atan2(2 * xy, xx - yy);
    lines.push([mx, my, Math.cos(ang), Math.sin(ang)]);
  }
  const out = [];
  for (let s = 0; s < 4; s++) {
    const L1 = lines[(s + 3) % 4], L2 = lines[s];
    const det = L1[2] * (-L2[3]) - L1[3] * (-L2[2]); if (Math.abs(det) < 1e-6) return quad;
    const dx = L2[0] - L1[0], dy = L2[1] - L1[1];
    const t = (dx * (-L2[3]) - dy * (-L2[2])) / det;
    out.push([L1[0] + t * L1[2], L1[1] + t * L1[3]]);
  }
  // sanity: refined corners close to rough ones
  for (let s = 0; s < 4; s++) if (Math.hypot(out[s][0] - quad[s][0], out[s][1] - quad[s][1]) > 8) return quad;
  return out;
}

function sampleCell(g, w, h, H, cx, cy) {
  let s = 0, n = 0;
  for (const dy of [-0.2, 0, 0.2]) for (const dx of [-0.2, 0, 0.2]) {
    const [u, v] = apply(H, cx + dx, cy + dy); const x = Math.round(u), y = Math.round(v);
    if (x < 0 || y < 0 || x >= w || y >= h) return -1;
    s += g[y * w + x]; n++;
  }
  return s / n;
}
function otsu(vals) {
  const s = [...vals].sort((a, b) => a - b); let best = 0, bt = s[0];
  for (let i = 1; i < s.length; i++) {
    const a = s.slice(0, i), b = s.slice(i);
    const ma = a.reduce((x, y) => x + y, 0) / a.length, mb = b.reduce((x, y) => x + y, 0) / b.length;
    const v = a.length * b.length * (ma - mb) ** 2; if (v > best) { best = v; bt = (s[i - 1] + s[i]) / 2; }
  }
  return { t: bt, sep: s[s.length - 1] - s[0] };
}

// ---------- main ----------
export function detectMarkers(g, w, h, opt = {}) {
  const r = opt.radius || Math.max(5, Math.round(Math.min(w, h) / 70));
  const b = threshold(g, w, h, r, opt.C ?? 7);
  const { lab, comps } = components(b, w, h, opt.minSide || 14, Math.min(w, h) * 0.9);
  const found = [];
  for (const c of comps) {
    // boundary pixels of the component
    const bp = [];
    for (let y = c.miny; y <= c.maxy; y++) for (let x = c.minx; x <= c.maxx; x++) {
      const p = y * w + x; if (lab[p] !== c.id) continue;
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1 || lab[p - 1] !== c.id || lab[p + 1] !== c.id || lab[p - w] !== c.id || lab[p + w] !== c.id) bp.push([x, y]);
    }
    if (bp.length < 30) continue;
    const Hh = hull(bp.map(p => [p[0], p[1]]));
    let q = quadFromHull(Hh); if (!q) continue;
    const ha = Math.abs(polyArea(Hh)), qa = Math.abs(polyArea(q));
    if (qa < 150 || qa / ha < 0.88) continue;           // hull must be quad-like
    if (polyArea(q) < 0) q.reverse();                     // force clockwise in image coords
    // convexity / aspect sanity
    let ok = true;
    for (let i = 0; i < 4; i++) { const a = q[i], bb = q[(i + 1) % 4]; if (Math.hypot(bb[0] - a[0], bb[1] - a[1]) < 10) ok = false; }
    if (!ok) continue;
    q = refine(q, bp);
    // decode with the 4 cyclic corner orders
    const Hm = homography([[0, 0], [6, 0], [6, 6], [0, 6]], q); if (!Hm) continue;
    const cells = []; let bad = false;
    for (let rr = 0; rr < 6 && !bad; rr++) for (let cc = 0; cc < 6; cc++) { const v = sampleCell(g, w, h, Hm, cc + 0.5, rr + 0.5); if (v < 0) { bad = true; break; } cells.push(v); }
    if (bad) continue;
    const { t, sep } = otsu(cells); if (sep < 30) continue;
    const bits = cells.map(v => (v > t ? 1 : 0));
    let border = 0; for (let i = 0; i < 6; i++) { border += bits[i] + bits[30 + i] + (i > 0 && i < 5 ? bits[i * 6] + bits[i * 6 + 5] : 0); }
    if (border > 1) continue;
    const inner = []; for (let rr = 1; rr <= 4; rr++) for (let cc = 1; cc <= 4; cc++) inner.push(bits[rr * 6 + cc]);
    let best = { d: 99 };
    for (let rot = 0; rot < 4; rot++) {
      // rotate observed 4x4 by rot*90 (clockwise) to compare
      const o = new Array(16);
      for (let rr = 0; rr < 4; rr++) for (let cc = 0; cc < 4; cc++) {
        let sr = rr, sc = cc; for (let k = 0; k < rot; k++) { const t2 = sr; sr = 3 - sc; sc = t2; }
        o[rr * 4 + cc] = inner[sr * 4 + sc];
      }
      for (let id = 0; id < CODEBITS.length; id++) {
        let d = 0; for (let i = 0; i < 16; i++) d += o[i] !== CODEBITS[id][i];
        if (d < best.d) best = { d, id, rot };
      }
    }
    if (best.d > 1) continue;
    // reorder corners so corners[0] is the marker's own top-left
    const order = [0, 1, 2, 3].map(i => q[(i + best.rot) % 4]);
    found.push({ id: best.id, corners: order, err: best.d });
  }
  // keep one per id (largest)
  const byId = new Map();
  for (const m of found) { const a = Math.abs(polyArea(m.corners)); const o = byId.get(m.id); if (!o || a > o.area) byId.set(m.id, { ...m, area: a }); }
  return [...byId.values()];
}

// pose of a square marker of side `size` (m), corners ordered TL,TR,BR,BL; camera f,cx,cy (px)
export function pose(corners, size, f, cx, cy) {
  const h = size / 2;
  const obj = [[-h, -h], [h, -h], [h, h], [-h, h]];             // marker plane: X right, Y down
  const img = corners.map(p => [(p[0] - cx) / f, (p[1] - cy) / f]); // normalized image coords
  const H = homography(obj, img); if (!H) return null;
  let r1 = [H[0], H[3], H[6]], r2 = [H[1], H[4], H[7]], t = [H[2], H[5], H[8]];
  const n1 = Math.hypot(...r1), n2 = Math.hypot(...r2), l = 2 / (n1 + n2);
  r1 = r1.map(v => v * l); r2 = r2.map(v => v * l); t = t.map(v => v * l);
  if (t[2] < 0) { r1 = r1.map(v => -v); r2 = r2.map(v => -v); t = t.map(v => -v); }
  // orthonormalize r1, r2
  const nr = v => { const n = Math.hypot(...v); return v.map(x => x / n); };
  const a = nr(r1), bb = nr(r2), c = nr([a[0] + bb[0], a[1] + bb[1], a[2] + bb[2]]);
  const cr = (u, v) => [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
  const z = nr(cr(a, bb)), e = nr(cr(z, c));
  const s2 = Math.SQRT1_2;
  const x = nr([(c[0] - e[0]) * s2, (c[1] - e[1]) * s2, (c[2] - e[2]) * s2]);
  const y = nr([(c[0] + e[0]) * s2, (c[1] + e[1]) * s2, (c[2] + e[2]) * s2]);
  const zz = cr(x, y);
  return { R: [x, y, zz], t, normal: zz.map(v => -v) };  // normal points out of the face, towards the camera side
}
