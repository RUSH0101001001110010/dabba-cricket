// Dabba Cricket: paper-puppet characters on the AR pitch (cut-outs of the Assignment 2 character art).
// Raju bats (his pose changes to the shot he plays), Bunty runs in and bowls, Meera and Pinky field,
// Dadi pops up as umpire on a wicket. Each puppet is a flat card that turns to face the phone.
import { P, fielderPos } from './scene.js?v=15';

export const PUPPET_NAMES = ['raju_stance', 'raju_drive', 'raju_pull', 'raju_cut', 'raju_loft', 'raju_sweep', 'raju_block',
  'bunty_stance', 'bunty_run', 'bunty_bowl', 'meera', 'meera2', 'pinky', 'pinky2', 'dadi_out'];
export const puppetUrls = () => Object.fromEntries(PUPPET_NAMES.map(n => [n, `img/puppets/${n}.png?v=15`]));

const H = { bat: 0.07, bowl: 0.068, field: 0.056, dadi: 0.075 };      // card heights in metres (stumps are 0.035)
const FIELDERS = ['meera', 'pinky2', 'meera2', 'pinky', 'meera'];
const up = (F, p, h) => p.map((v, i) => v + F.up[i] * h);

// s = { now, anim, field: [zones], fielders: bool, dadiAt }
export function puppetList(F, s) {
  const L = F.len / 2, out = [], now = s.now, a = s.anim;

  // --- Raju, the batsman: stance, then the pose of the shot he played, with a quick rock like a puppet on a stick
  const bat = { name: 'raju_stance', base: P(F, -L + 0.022, -0.022, 0), h: H.bat, tilt: Math.sin(now / 700) * 0.025 };
  if (a && a.type === 'shot' && a.r) {
    const r = a.r, e = now - a.t0, k = r.shot === 'Block' ? 0.4 : 1;
    bat.name = 'raju_' + r.shot.toLowerCase();
    bat.tilt = k * (e < 110 ? -0.3 * e / 110 : e < 320 ? -0.3 + 0.5 * (e - 110) / 210 : 0.2 * Math.max(0, 1 - (e - 320) / 450));
    if (r.out && e > 700) bat.tilt = Math.min(0.45, (e - 700) / 900 * 0.45);          // out: he slumps
    if (r.runs >= 4 && e > 900) bat.base = up(F, bat.base, 0.006 * Math.abs(Math.sin((e - 900) / 110)));   // boundary: little hops
  }
  out.push(bat);

  // --- Bunty, the bowler: waits at the top of his run-up, runs in (bobbing), bowls, follows through to the side
  let bw = { name: 'bunty_stance', base: P(F, L + 0.11, 0.016, 0), h: H.bowl, tilt: Math.sin(now / 800 + 1) * 0.02 };
  if (a && a.type === 'delivery') {
    const rs = a.runStart ?? a.t0 - 800;
    if (now < a.t0) {
      const k = Math.max(0, Math.min(1, (now - rs) / Math.max(1, a.t0 - rs)));
      bw = { name: k > 0.02 ? 'bunty_run' : 'bunty_stance', base: P(F, L + 0.11 - 0.095 * k, 0.016, 0.005 * Math.abs(Math.sin(k * Math.PI * 5))), h: H.bowl, tilt: Math.sin(k * Math.PI * 10) * 0.07 };
    } else {
      const e = now - a.t0, k = Math.min(1, e / 450);
      bw = { name: e < 450 ? 'bunty_bowl' : 'bunty_stance', base: P(F, L + 0.015 - 0.015 * k, 0.016 + 0.02 * k, 0), h: H.bowl, tilt: e < 450 ? 0.12 * (1 - k) : 0 };
    }
  } else if (a && a.type === 'shot') bw = { name: 'bunty_stance', base: P(F, L, 0.036, 0), h: H.bowl, tilt: 0 };
  out.push(bw);

  // --- fielders: Meera and Pinky cut-outs; the catcher jumps for the catch
  if (s.fielders) s.field.forEach((z, i) => {
    let p = fielderPos(F, z);
    if (a && a.type === 'shot' && a.r && a.r.out && a.r.how === 'caught' && a.r.zone === z) {
      const e = (now - a.t0) / a.D; p = up(F, p, 0.014 * Math.max(0, Math.sin(Math.min(1.2, e) / 1.2 * Math.PI)));
    }
    out.push({ name: FIELDERS[i % FIELDERS.length], base: p, h: H.field, flip: i % 2 === 1, tilt: Math.sin(now / 900 + i) * 0.02 });
  });

  // --- Dadi, umpire: pops up beside the bowler's stumps with her finger raised
  if (s.dadiAt && now >= s.dadiAt) {
    const k = Math.min(1, (now - s.dadiAt) / 260), sc = k < 1 ? 1.15 * k : 1 + 0.15 * Math.max(0, 1 - (now - s.dadiAt - 260) / 200);
    out.push({ name: 'dadi_out', base: P(F, L + 0.035, -0.04, 0), h: H.dadi * sc, tilt: Math.sin((now - s.dadiAt) / 120) * 0.05 * Math.max(0, 1 - (now - s.dadiAt) / 1200) });
  }
  return out;
}
