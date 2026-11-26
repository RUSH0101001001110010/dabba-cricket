// Dabba Cricket: game rules and match state (pure logic, no UI). Based on the approved Phase 04 model.
export const SHOTS = ['Drive', 'Pull', 'Cut', 'Loft', 'Sweep', 'Block'];
export const DELS = ['Yorker', 'Bouncer', 'Spin', 'Slower', 'Wide line', 'Good length'];
const PACE = new Set(['Yorker', 'Bouncer', 'Good length']), SPIN = new Set(['Spin', 'Slower']);
// cell types: G<n> ground shot worth n, A aerial (catchable), E edge risk, D defended, W wicket attack
export const MATRIX = {
  Drive: ['D', 'D', 'G4', 'A', 'G4', 'G4'],
  Pull: ['W', 'A', 'G4', 'E', 'G2', 'G1'],
  Cut: ['D', 'A', 'G2', 'G2', 'G4', 'G1'],
  Loft: ['E', 'E', 'A', 'A', 'A', 'A'],
  Sweep: ['W', 'E', 'G4', 'G2', 'D', 'G1'],
  Block: ['D', 'D', 'G1', 'G1', 'D', 'D'],
};
export const ZONES = ['Fine leg', 'Square leg', 'Midwicket', 'Long-on', 'Long-off', 'Cover', 'Point', 'Third man'];
export const SHOT_ZONE = { Drive: 'Cover', Pull: 'Midwicket', Cut: 'Point', Loft: 'Long-on', Sweep: 'Fine leg', Block: null };
export const GROUNDS = { gully: { name: 'Gully lane', fielders: 3, window: true }, rooftop: { name: 'Rooftop', fielders: 3, window: false },
  maidan: { name: 'Maidan', fielders: 4, window: false }, stadium: { name: 'Stadium', fielders: 5, window: false, lights: true } };

// timing windows (ms either side of the ball reaching the bat)
export function timingWindows(delivery, cond, easy = false) {
  let perfect = 55, good = 140;
  const harder = (cond.pitch === 'Green' && PACE.has(delivery)) || (cond.pitch === 'Dusty' && SPIN.has(delivery));
  if (harder) { perfect *= 0.75; good *= 0.85; }
  if (cond.pitch === 'Flat') { perfect *= 1.2; good *= 1.1; }
  if (cond.light === 'Floodlights') perfect *= 0.9;
  if (easy) { perfect *= 1.5; good *= 1.3; }
  return { perfect, good };
}
export function classifyTap(dtMs, win) { // dt < 0 = early, > 0 = late; null = no tap (late)
  if (dtMs == null) return 'Late';
  const a = Math.abs(dtMs);
  if (a <= win.perfect) return 'Perfect';
  if (a <= win.good) return 'Good';
  return dtMs < 0 ? 'Early' : 'Late';
}

// resolve one ball -> {runs, out, how, cell, zone, fielded, key}
export function resolve(shot, delivery, timing, field, ground = 'gully') {
  const cell = MATRIX[shot][DELS.indexOf(delivery)], zone = SHOT_ZONE[shot], fielded = !!zone && field.has(zone);
  const gullyWindow = GROUNDS[ground].window;
  let runs = 0, out = false, how = null;
  if (cell[0] === 'G') {
    const n = +cell[1];
    runs = { Perfect: { 1: 2, 2: 4, 4: 4 }, Good: { 1: 1, 2: 2, 4: 4 }, Early: { 1: 0, 2: 1, 4: 1 }, Late: { 1: 0, 2: 0, 4: 1 } }[timing][n];
    if (timing !== 'Perfect' && fielded) runs = runs === 4 ? 2 : runs === 2 ? 1 : runs;
  } else if (cell === 'A') {
    if (timing === 'Perfect') runs = 6;
    else if (timing === 'Good') { if (fielded) { out = true; how = 'caught'; } else runs = 4; }
    else if (timing === 'Early') runs = fielded ? 1 : 2;
    else if (gullyWindow && (shot === 'Pull' || shot === 'Loft')) { out = true; how = 'window'; }
    else if (fielded) { out = true; how = 'caught'; } else runs = 1;
  } else if (cell === 'E') { ({ runs, out } = { Perfect: { runs: 2, out: false }, Good: { runs: 1, out: false }, Early: { runs: 0, out: false }, Late: { runs: 0, out: true } }[timing]); if (out) how = 'caught behind'; }
  else if (cell === 'D') runs = timing === 'Perfect' ? 1 : 0;
  else if (cell === 'W') { ({ runs, out } = { Perfect: { runs: 1, out: false }, Good: { runs: 0, out: false }, Early: { runs: 0, out: false }, Late: { runs: 0, out: true } }[timing]); if (out) how = delivery === 'Yorker' ? 'bowled' : 'lbw'; }
  const key = out ? (how === 'window' ? 'OUT_WINDOW' : how === 'caught' || how === 'caught behind' ? 'OUT_CAUGHT' : 'OUT_BOWLED')
            : runs === 6 ? 'SIX' : runs === 4 ? 'FOUR' : runs === 2 ? 'DOUBLE' : runs === 1 ? 'SINGLE' : 'DOT';
  return { runs, out, how, cell, zone, fielded, key, shot, delivery, timing };
}

const rnd = a => a[Math.floor(Math.random() * a.length)];
export function randomConditions(ground = 'gully') {
  return { pitch: rnd(['Dusty', 'Green', 'Flat']), light: GROUNDS[ground].lights ? 'Floodlights' : rnd(['Day', 'Floodlights']) };
}
export function randomField(n) { const z = [...ZONES].sort(() => Math.random() - 0.5); return new Set(z.slice(0, n)); }

// ---------------- match ----------------
export class Match {
  constructor({ mode = 'vs', ground = 'gully', names = ['Player 1', 'Player 2'], overs = 2, wickets = 2 } = {}) {
    Object.assign(this, { mode, ground, names, overs, wickets });
    this.cond = randomConditions(ground);
    this.innings = []; this.phase = 'toss'; this.super = false; this.winner = null;
  }
  get inn() { return this.innings[this.innings.length - 1]; }
  get fielders() { return GROUNDS[this.ground].fielders; }
  toss(batFirst) { // batFirst = index of the player who bats first
    this.innings.push(this.newInnings(batFirst)); this.phase = 'field'; return this;
  }
  newInnings(bat, overs = this.overs, wickets = this.wickets) {
    return { bat, bowl: 1 - bat, runs: 0, wkts: 0, balls: 0, overs, wickets, log: [], field: new Set(), rerolls: { bat: 1, bowl: 1 },
      target: null };
  }
  setField(zones) { this.inn.field = new Set(zones); this.phase = 'roll'; }
  autoField() { this.setField(randomField(this.fielders)); }
  useReroll(side) { if (this.inn.rerolls[side] > 0) { this.inn.rerolls[side]--; return true; } return false; }
  playBall(shotIdx, delIdx, timing) {
    const I = this.inn, r = resolve(SHOTS[shotIdx], DELS[delIdx], timing, I.field, this.ground);
    I.runs += r.runs; if (r.out) I.wkts++; I.balls++; I.log.push(r);
    r.overBall = `${Math.floor((I.balls - 1) / 6)}.${((I.balls - 1) % 6) + 1}`;
    r.inningsOver = I.wkts >= I.wickets || I.balls >= I.overs * 6 || (I.target != null && I.runs >= I.target);
    r.overDone = !r.inningsOver && I.balls % 6 === 0;
    if (r.overDone) I.rerolls = { bat: 1, bowl: 1 };
    this.phase = r.inningsOver ? 'inningsEnd' : r.overDone ? 'field' : 'roll';
    if (r.inningsOver) this.endInnings();
    return r;
  }
  endInnings() {
    const n = this.innings.length;
    if (n % 2 === 1) { this.phase = 'inningsBreak'; return; }
    const a = this.innings[n - 2], b = this.innings[n - 1];
    if (b.runs > a.runs) this.winner = b.bat; else if (a.runs > b.runs) this.winner = a.bat;
    else if (this.mode === 'vs') { this.phase = 'superOver'; this.super = true; return; }
    else this.winner = -1;
    this.phase = 'matchEnd';
  }
  startNextInnings() {
    const n = this.innings.length, prev = this.inn;
    if (this.phase === 'superOver') {         // the side that batted second bats first in the super over
      const I = this.newInnings(prev.bat, 1, 1); I.target = null; this.innings.push(I);
    } else {
      const I = this.newInnings(prev.bowl, prev.overs, prev.wickets); I.target = prev.runs + 1; this.innings.push(I);
    }
    this.phase = 'field';
  }
  scoreText(I = this.inn) { return `${I.runs}/${I.wkts}`; }
  oversText(I = this.inn) { return `${Math.floor(I.balls / 6)}.${I.balls % 6}`; }
}
