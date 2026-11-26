// Dabba Cricket: ball flight, fielders and effects, in pitch coordinates.
// Pitch frame F: mid, fwd (batsman -> bowler), side, up, len (metres, world coords).
import { ZONES } from './rules.js?v=9';

const add = (a, b) => a.map((v, i) => v + b[i]), mul = (a, k) => a.map(v => v * k);
export const P = (F, along, across, h = 0) => add(add(add(F.mid, mul(F.fwd, along)), mul(F.side, across)), mul(F.up, h));

// zone angle (degrees) seen from the batsman: 0 = straight back past the bowler, + = leg side
export const ZONE_ANGLE = { 'Long-on': 15, 'Long-off': -15, 'Cover': -55, 'Point': -95, 'Third man': -150, 'Fine leg': 150, 'Square leg': 95, 'Midwicket': 55 };
const DELIVERY = { // where it pitches (fraction from bowler end), sideways drift, time (s), bounce height
  'Yorker': { bounce: 0.97, drift: 0, t: 1.0, h: 0.004 }, 'Bouncer': { bounce: 0.45, drift: 0, t: 0.95, h: 0.05 },
  'Spin': { bounce: 0.7, drift: 0.018, t: 1.35, h: 0.02 }, 'Slower': { bounce: 0.72, drift: 0, t: 1.55, h: 0.022 },
  'Wide line': { bounce: 0.75, drift: -0.03, t: 1.05, h: 0.02 }, 'Good length': { bounce: 0.75, drift: 0, t: 1.05, h: 0.022 } };
export const deliveryTime = d => DELIVERY[d].t;
// progress of the ball along the pitch for time fraction u (0..1): not constant speed, so it can't be counted
export function ease(d, u) {
  u = Math.max(0, Math.min(1, u));
  if (d === 'Slower') return Math.pow(u, 1.7);                       // floats, then arrives late and quick
  if (d === 'Spin') return Math.min(1, u + 0.05 * Math.sin(2 * Math.PI * u));
  if (d === 'Yorker' || d === 'Bouncer') return Math.pow(u, 0.8);   // fast out of the hand
  return Math.pow(u, 0.95);
}

// ball position during the delivery, u = 0..1 (bowler end -> batsman's bat)
export function deliveryPos(F, d, u) {
  const D = DELIVERY[d], L = F.len / 2, start = L - 0.01, end = -L + 0.03;
  const x = start + (end - start) * u;
  const drift = D.drift * Math.max(0, u - D.bounce) / (1 - D.bounce + 1e-6) + (d === 'Wide line' ? D.drift * u : 0);
  let h;
  if (u < D.bounce) { const k = u / D.bounce; h = 0.03 * (1 - k) + 0.002 + 0.01 * Math.sin(Math.PI * k) * 0.6; }
  else { const k = (u - D.bounce) / (1 - D.bounce + 1e-6); h = 0.002 + D.h * Math.sin(Math.PI * Math.min(1, k) * 0.5); }
  return P(F, x, drift, h);
}
// ball after the shot, s = 0..1
export function shotPos(F, r, s) {
  const L = F.len / 2, batX = -L + 0.03;
  if (!r || (r.runs === 0 && !r.out) || r.how === 'bowled' || r.how === 'lbw') {     // dot / bowled: ball stops at the bat or hits stumps
    const x = batX - 0.025 * Math.min(1, s * 2); return P(F, x, 0, 0.004 + 0.01 * Math.max(0, 1 - s * 3));
  }
  const ang = (r.how === 'caught behind' ? 178 : ZONE_ANGLE[r.zone || 'Long-on'] ?? 0) * Math.PI / 180;
  const dist = r.runs >= 6 ? 0.55 : r.runs === 4 ? 0.42 : r.out ? fielderDist(r) : r.runs === 2 ? 0.22 : 0.13;
  const loft = r.runs >= 6 ? 0.22 : (r.cell === 'A' || r.out) ? 0.09 : 0.006;
  const k = Math.min(1, s);
  const along = batX + Math.cos(ang) * dist * k, across = Math.sin(ang) * dist * k;
  const h = 0.01 + loft * 4 * k * (1 - k) + (r.runs >= 6 ? 0 : 0);
  return P(F, along, across, Math.max(0.003, h));
}
const fielderDist = () => 0.26;
export function fielderPos(F, zone) {
  const L = F.len / 2, ang = ZONE_ANGLE[zone] * Math.PI / 180, d = 0.26;
  return P(F, -L + 0.03 + Math.cos(ang) * d, Math.sin(ang) * d, 0);
}

// ---- mesh builders (used by the WebXR renderer) ----
export function addBall(b, pos, F, r = 0.0065) {
  const col = [0.42, 0.78, 0.25, 1], s = [F.side, F.up, F.fwd];
  const pts = [mul(s[0], r), mul(s[0], -r), mul(s[1], r), mul(s[1], -r), mul(s[2], r), mul(s[2], -r)].map(o => add(pos, o));
  const [px, nx, py, ny, pz, nz] = pts;
  for (const [a, c] of [[px, pz], [pz, nx], [nx, nz], [nz, px]]) { b.tri(a, c, py, col); b.tri(c, a, ny, [0.3, 0.6, 0.18, 1]); }
}
export function addFielder(b, F, zone) {
  const base = fielderPos(F, zone), w = 0.008, h = 0.03;
  const col = [0.12, 0.44, 0.7, 1];
  b.quad([add(base, mul(F.side, -w)), add(base, mul(F.side, w)), add(add(base, mul(F.side, w)), mul(F.up, h)), add(add(base, mul(F.side, -w)), mul(F.up, h))], col);
  b.quad([add(base, mul(F.fwd, -w)), add(base, mul(F.fwd, w)), add(add(base, mul(F.fwd, w)), mul(F.up, h)), add(add(base, mul(F.fwd, -w)), mul(F.up, h))], col);
  const head = add(base, mul(F.up, h + 0.006)); addBall(b, head, F, 0.0065);
}
export function addShadow(b, F, pos) { // small dark disc under the ball on the pitch level
  const g = add(pos, mul(F.up, -(dotUp(F, pos) - 0.0008))), r = 0.006, col = [0, 0, 0, 0.25];
  b.quad([add(g, add(mul(F.side, -r), mul(F.fwd, -r))), add(g, add(mul(F.side, r), mul(F.fwd, -r))), add(g, add(mul(F.side, r), mul(F.fwd, r))), add(g, add(mul(F.side, -r), mul(F.fwd, r)))], col);
}
function dotUp(F, p) { const d = p.map((v, i) => v - F.mid[i]); return d[0] * F.up[0] + d[1] * F.up[1] + d[2] * F.up[2]; }
