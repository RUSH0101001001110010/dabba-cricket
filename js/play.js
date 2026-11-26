// Dabba Cricket: game controller (match flow, UI, AR scene, timing tap)
import { XRDabba, xrSupported, FACE_NAMES } from './xrar.js?v=8';
import { Match, SHOTS, DELS, ZONES, timingWindows, classifyTap } from './rules.js?v=8';
import { deliveryPos, deliveryTime, shotPos, addBall, addFielder, addShadow, ZONE_ANGLE } from './scene.js?v=8';
import { line } from './commentary.js?v=8';

const $ = s => document.querySelector(s);
const show = (sel, on = true) => { for (const s of sel.split(',')) $(s.trim()).hidden = !on; };
const hideAll = () => show('#toss,#conds,#field,#rollPanel,#faces,#chips,#tapzone,#callout,#comm,#resultBtns,#overlay,#hint', false);
const opts = { mode: 'vs', lang: 'ro', easy: false };
let match = null, ar = null, faces = null, anim = null, showField = false, view2d = false;

// ---------- home ----------
for (const b of document.querySelectorAll('#segMode button')) b.onclick = () => {
  document.querySelectorAll('#segMode button').forEach(x => x.classList.toggle('on', x === b)); opts.mode = b.dataset.v; $('#n2wrap').hidden = opts.mode === 'practice'; };
$('#startAR').onclick = async () => {
  if (!(await xrSupported())) { $('#homeMsg').textContent = 'AR is not available in this browser. Use Chrome on an ARCore phone (update "Google Play Services for AR"), or tap PLAY WITHOUT AR.'; return; }
  try {
    ar = new XRDabba($('#gl'), $('#ui')); wireAR(); ar.paused = true;
    await ar.start(); startGame();
  } catch (e) { $('#homeMsg').textContent = 'AR could not start: ' + e.message; ar = null; }
};
$('#startNoAR').onclick = () => { ar = null; view2d = true; $('#view2d').hidden = false; requestAnimationFrame(draw2d); startGame(); };
let menuArmed = 0;
$('#menuBtn').onclick = () => { if (performance.now() - menuArmed < 2500) { goHome(); return; } menuArmed = performance.now(); $('#menuBtn').textContent = 'TAP AGAIN TO EXIT'; setTimeout(() => $('#menuBtn').textContent = 'MENU', 2500); };
function goHome() { if (ar) { try { ar.end(); } catch (e) {} ar = null; } view2d = false; $('#view2d').hidden = true; hideAll(); show('#score,#menuBtn', false); show('#home'); }

// ---------- AR wiring ----------
function wireAR() {
  ar.scene = (F, b) => {
    const now = performance.now();
    if (anim && anim.type === 'delivery') { const u = Math.max(0, Math.min(1, (now - anim.t0) / anim.D)); if (now >= anim.t0) { const p = deliveryPos(F, anim.del, u); addShadow(b, F, p); addBall(b, p, F); } }
    if (anim && anim.type === 'shot') { const s = Math.min(1, (now - anim.t0) / anim.D); const p = shotPos(F, anim.r, s); addShadow(b, F, p); addBall(b, p, F); }
    if (showField && match) for (const z of match.inn.field) addFielder(b, F, z);
  };
  ar.on(e => {
    if (e.type === 'read' && phase === 'roll') { chip('#cBat', e.bat); chip('#cBowl', e.bowl); $('#hint').hidden = e.markers > 0; }
    else if (e.type === 'locked' && phase === 'roll') onLocked(e.locked.bat, e.locked.bowl - 6);
    else if (e.type === 'waiting' && phase === 'roll') { setChipText('#cBat', e.rolled.bat ? 'ROLLED ✓' : 'ROLL…'); setChipText('#cBowl', e.rolled.bowl ? 'ROLLED ✓' : 'ROLL…'); }
    else if (e.type === 'ended') goHome();
  });
}
function chip(sel, v) {
  const el = $(sel), s = el.querySelector('span'); el.classList.remove('ok', 'lock');
  if (!v) { s.textContent = '—'; return; }
  s.textContent = v.moving ? 'ROLLING…' : v.top < 0 ? (v.low ? 'TILT PHONE' : '—') : FACE_NAMES[v.top] + (v.settled ? ' ✓' : '…');
  if (v.settled) el.classList.add('ok');
}
function setChipText(sel, t, lock) { const el = $(sel); el.querySelector('span').textContent = t; el.classList.toggle('lock', !!lock); el.classList.remove('ok'); }

// ---------- match flow ----------
let phase = 'home';
function say(key) { const l = line(key, opts.lang); if (!l) return; $('#comm').innerHTML = `<b>${l.who.toUpperCase()}:</b> ${escapeHtml(l.text)}`; show('#comm'); }
function escapeHtml(s) { return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function startGame() {
  opts.lang = $('#lang').value; opts.easy = $('#easy').checked;
  const names = [$('#n1').value.trim() || 'Player 1', opts.mode === 'practice' ? 'Computer' : ($('#n2').value.trim() || 'Player 2')];
  match = new Match({ mode: opts.mode, names });
  show('#home', false); hideAll(); show('#score,#menuBtn'); updateScore();
  $('#t0').textContent = names[0]; $('#t1').textContent = names[1]; $('#tossTxt').textContent = '';
  if (opts.mode === 'practice') { match.toss(0); showConditions(); } else { phase = 'toss'; show('#toss'); }
}
$('#t0').onclick = () => { match.toss(0); showConditions(); };
$('#t1').onclick = () => { match.toss(1); showConditions(); };
$('#tR').onclick = () => { const w = Math.random() < 0.5 ? 0 : 1; $('#tossTxt').textContent = `${match.names[w]} wins the toss and bats!`; setTimeout(() => { match.toss(w); showConditions(); }, 1200); };
function showConditions() {
  phase = 'conds'; hideAll(); updateScore();
  const c = match.cond, eff = { Dusty: 'Spin and slower balls are harder to time.', Green: 'Pace (yorker, bouncer, good length) is harder to time.', Flat: 'Easier timing on every ball.' }[c.pitch];
  $('#condTxt').textContent = `${c.pitch.toUpperCase()} PITCH · ${c.light.toUpperCase()}`;
  $('#condEff').textContent = eff + (c.light === 'Floodlights' ? ' Floodlights: perfect timing is a little harder.' : '');
  show('#conds'); say('CONDITIONS_' + c.pitch.toUpperCase());
}
$('#condOk').onclick = () => { say('MATCH_START'); beginOver(true); };

let firstBall = true;
function beginOver(first) {
  firstBall = !!first || firstBall;
  hideAll(); updateScore();
  if (match.mode === 'practice') { match.autoField(); beginBall(); return; }
  phase = 'field'; buildField(); show('#field');
  $('#fieldTitle').textContent = `${match.names[match.inn.bowl].toUpperCase()}: SET YOUR FIELD`;
}
// field setter (top-down, batsman at the bottom of the strip, bowler at the top)
let chosen = new Set();
function buildField() {
  const g = $('#field .ground'); g.querySelectorAll('.z').forEach(n => n.remove()); chosen = new Set();
  $('#fieldN').textContent = match.fielders; $('#fieldOk').disabled = true;
  for (const z of ZONES) {
    const da = { 'Long-on': 30, 'Long-off': -30 }[z] ?? ZONE_ANGLE[z], a = da * Math.PI / 180, r = 40, x = 50 + Math.sin(a) * r, y = 62 - Math.cos(a) * r;
    const b = document.createElement('button'); b.className = 'z'; b.textContent = z; b.style.left = x + '%'; b.style.top = y + '%';
    b.onclick = () => { if (chosen.has(z)) chosen.delete(z); else if (chosen.size < match.fielders) chosen.add(z); b.classList.toggle('on', chosen.has(z));
      $('#fieldOk').disabled = chosen.size !== match.fielders; };
    g.appendChild(b);
  }
}
$('#fieldAuto').onclick = () => { match.autoField(); say('FIELD_SET'); beginBall(); };
$('#fieldOk').onclick = () => { match.setField(chosen); say('FIELD_SET'); beginBall(); };

function beginBall() {
  phase = 'roll'; faces = null; showField = false; hideAll(); updateScore();
  show('#rollPanel,#chips'); show('#lockRow', false); show('#manualBtn', !!ar);
  $('#rollTitle').textContent = `${match.names[match.inn.bat].toUpperCase()} vs ${match.names[match.inn.bowl].toUpperCase()}: ROLL!`;
  $('#rollSub').textContent = ar ? 'Roll both dabbas, then point the phone at them.' : 'Roll both dabbas, then tap the faces on top.';
  setChipText('#cBat', '—'); setChipText('#cBowl', '—');
  if (ar) { ar.paused = false; if (firstBall) ar.readNow(); else ar.newRoll(); firstBall = false; show('#hint'); $('#hint').textContent = 'Keep both dabbas in view · about a ruler apart'; }
  else openFaces();
}
function onLocked(batFace, bowlFace) {
  faces = { bat: batFace, bowl: bowlFace }; if (ar) ar.paused = true;
  setChipText('#cBat', '🔒 ' + SHOTS[batFace].toUpperCase(), true); setChipText('#cBowl', '🔒 ' + DELS[bowlFace].toUpperCase(), true);
  $('#rollTitle').textContent = `${SHOTS[batFace].toUpperCase()} vs ${DELS[bowlFace].toUpperCase()}`;
  $('#rollSub').textContent = 'Locked! Re-roll once per over, or bowl.'; show('#hint', false); show('#faces', false); show('#rollPanel,#chips');
  $('#rrBat').disabled = match.inn.rerolls.bat < 1 || !ar; $('#rrBowl').disabled = match.inn.rerolls.bowl < 1 || !ar;
  show('#lockRow');
  if (navigator.vibrate) navigator.vibrate(60);
}
$('#rrBat').onclick = () => reroll('bat');
$('#rrBowl').onclick = () => reroll('bowl');
function reroll(side) {
  if (!match.useReroll(side)) return; say('REROLL'); show('#lockRow', false); faces = null;
  $('#rollSub').textContent = side === 'bat' ? 'Batsman: roll your dabba again.' : 'Bowler: roll your dabba again.';
  if (ar) { ar.paused = false; ar.newRoll(side); }
}
// manual faces
function openFaces() {
  const sel = { bat: -1, bowl: -1 };
  const mk = (id, names, key) => { const g = $(id); g.innerHTML = ''; names.forEach((n, i) => { const b = document.createElement('button'); b.textContent = n.toUpperCase(); b.className = 'alt';
    b.onclick = () => { sel[key] = i; g.querySelectorAll('button').forEach((x, j) => x.classList.toggle('on', j === i)); $('#facesOk').disabled = sel.bat < 0 || sel.bowl < 0; }; g.appendChild(b); }); };
  mk('#gBat', SHOTS, 'bat'); mk('#gBowl', DELS, 'bowl'); $('#facesOk').disabled = true;
  $('#facesOk').onclick = () => onLocked(sel.bat, sel.bowl);
  show('#faces'); show('#rollPanel', false);
}
$('#manualBtn').onclick = () => { if (ar) ar.paused = true; openFaces(); };

// ---------- delivery + timing tap ----------
$('#bowlBtn').onclick = () => {
  if (!faces) return;
  phase = 'bowl'; hideAll(); show('#tapzone');
  const del = DELS[faces.bowl], D = deliveryTime(del) * 1000, t0 = performance.now() + 700;
  anim = { type: 'delivery', del, D, t0, arrive: t0 + D, tapped: null, done: false };
  anim.win = timingWindows(del, match.cond, opts.easy);
  const span = D + anim.win.good + 150, pct = ms => Math.max(0, Math.min(100, 100 * ms / span));
  const gEl = $('#meter .good'), pEl = $('#meter .perf');
  gEl.style.left = pct(D - anim.win.good) + '%'; gEl.style.width = (pct(D + anim.win.good) - pct(D - anim.win.good)) + '%';
  pEl.style.left = pct(D - anim.win.perfect) + '%'; pEl.style.width = (pct(D + anim.win.perfect) - pct(D - anim.win.perfect)) + '%';
  anim.span = span; meterLoop();
};
function meterLoop() {
  if (!anim || anim.type !== 'delivery') return;
  const now = performance.now(), el = $('#meter .dot');
  el.style.left = Math.max(0, Math.min(100, 100 * (now - anim.t0) / anim.span)) + '%';
  if (!anim.done && now > anim.arrive + anim.win.good + 120 && anim.tapped == null) finishDelivery(null);
  else if (!anim.done && anim.tapped != null && now >= Math.max(anim.arrive, anim.tapAt)) finishDelivery(anim.tapped);
  if (anim && anim.type === 'delivery') requestAnimationFrame(meterLoop);
}
$('#tapzone').addEventListener('pointerdown', () => {
  if (!anim || anim.type !== 'delivery' || anim.tapped != null) return;
  const now = performance.now(); if (now < anim.t0) return;            // too soon: ignore taps before the ball is bowled
  anim.tapped = now - anim.arrive; anim.tapAt = now;
});
function finishDelivery(dt) {
  anim.done = true;
  const timing = classifyTap(dt, anim.win);
  const r = match.playBall(faces.bat, faces.bowl, timing);
  anim = { type: 'shot', r, t0: performance.now(), D: r.runs >= 4 ? 1400 : 1000 };
  show('#tapzone', false);
  setTimeout(() => showResult(r), anim.D + 100);
}
function showResult(r) {
  phase = 'result'; showField = true; updateScore();
  const big = r.out ? (r.how === 'window' ? 'WINDOW! OUT!' : r.how === 'bowled' ? 'BOWLED!' : r.how === 'lbw' ? 'LBW! OUT!' : 'CAUGHT!')
            : r.runs === 6 ? 'SIX!' : r.runs === 4 ? 'FOUR!' : r.runs === 0 ? 'DOT BALL' : `${r.runs} RUN${r.runs > 1 ? 'S' : ''}`;
  $('#callout').textContent = big; $('#callout').classList.toggle('out', r.out); show('#callout');
  say(r.key);
  if (!r.out && r.runs === 0 && r.timing !== 'Good') say('TIMING_' + r.timing.toUpperCase());
  $('#comm').innerHTML += `<div style="font:12px Bungee;color:#F7C51E;margin-top:3px">${r.shot.toUpperCase()} vs ${r.delivery.toUpperCase()} · TIMING: ${r.timing.toUpperCase()}${r.fielded ? ' · FIELDER AT ' + r.zone.toUpperCase() : ''}</div>`;
  const label = { roll: 'NEXT BALL', field: 'NEW OVER', inningsBreak: 'INNINGS BREAK', superOver: 'SUPER OVER!', matchEnd: 'RESULT' }[match.phase] || 'NEXT';
  $('#nextBtn').textContent = label; show('#resultBtns');
  if (navigator.vibrate) navigator.vibrate(r.out ? [80, 60, 80] : r.runs >= 4 ? 120 : 30);
}
$('#nextBtn').onclick = () => {
  anim = null; showField = false; show('#callout,#comm,#resultBtns', false);
  if (match.phase === 'roll') beginBall();
  else if (match.phase === 'field') beginOver();
  else if (match.phase === 'inningsBreak') overlay('INNINGS BREAK', `${match.names[match.inn.bat]} scored ${match.scoreText()}. ${match.names[match.inn.bowl]} needs ${match.inn.runs + 1} to win. Pass the phone!`, 'START CHASE', () => { match.startNextInnings(); beginOver(); });
  else if (match.phase === 'superOver') { say('SUPER_OVER'); overlay('SUPER OVER!', 'Scores are level. One over, one wicket each.', 'PLAY SUPER OVER', () => { match.startNextInnings(); beginOver(); }); }
  else if (match.phase === 'matchEnd') endMatch();
};
function overlay(title, txt, btn, fn, home = false) {
  phase = 'overlay'; $('#ovTitle').textContent = title; $('#ovTxt').textContent = txt; $('#ovBtn').textContent = btn; show('#ovHome', home);
  $('#ovBtn').onclick = () => { show('#overlay', false); fn(); }; show('#overlay');
}
$('#ovHome').onclick = () => goHome();
function endMatch() {
  const w = match.winner, n = match.innings.length, a = match.innings[n - 2], b = match.innings[n - 1];
  const txt = w < 0 ? `It's a tie! ${a.runs} each.` : `${match.names[w]} wins! ${match.names[a.bat]} ${a.runs}/${a.wkts} · ${match.names[b.bat]} ${b.runs}/${b.wkts}`;
  say(match.mode === 'practice' && w !== 0 ? 'LOSE' : 'WIN');
  overlay(w < 0 ? 'TIE!' : 'MOHALLA CHAMPION!', txt, 'REMATCH', () => { firstBall = true; startGame(); }, true);
}
function updateScore() {
  if (!match || !match.inn) { $('#sTeam').textContent = ''; $('#sRuns').textContent = ''; $('#sOvers').textContent = ''; $('#sTarget').textContent = ''; $('#sCond').textContent = match ? match.cond.pitch.toUpperCase() : ''; return; }
  const I = match.inn;
  $('#sTeam').textContent = match.names[I.bat].toUpperCase(); $('#sRuns').textContent = match.scoreText(); $('#sOvers').textContent = `(${match.oversText()}/${I.overs})`;
  $('#sTarget').textContent = I.target ? `NEED ${Math.max(0, I.target - I.runs)} OFF ${I.overs * 6 - I.balls}` : '';
  $('#sCond').textContent = `${match.cond.pitch.toUpperCase()}${match.cond.light === 'Floodlights' ? ' · LIGHTS' : ''}`;
}

// ---------- 2D view (no AR) ----------
const F2 = { mid: [0, 0, 0], fwd: [1, 0, 0], side: [0, 1, 0], up: [0, 0, 1], len: 0.30 };
function draw2d() {
  if (!view2d) return;
  const c = $('#view2d'), dpr = devicePixelRatio || 1, W = c.clientWidth, H = c.clientHeight;
  if (c.width !== W * dpr) { c.width = W * dpr; c.height = H * dpr; }
  const g = c.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H);
  const sc = Math.min(W / 0.75, H / 0.75), cx = W / 2, cy = H * 0.52;
  const pr = p => [cx - p[1] * sc, cy - p[0] * sc - p[2] * sc * 1.3];        // bowler at the top, batsman at the bottom
  g.fillStyle = '#5DB33B'; g.beginPath(); g.arc(cx, cy + 0.12 * sc, 0.5 * sc, 0, 7); g.fill();
  const L = F2.len / 2, w = 0.035, q = [[-L, -w, 0], [-L, w, 0], [L, w, 0], [L, -w, 0]].map(pr);
  g.fillStyle = '#dec480'; g.strokeStyle = '#2B2B2B'; g.lineWidth = 3; g.beginPath(); q.forEach((p, i) => i ? g.lineTo(...p) : g.moveTo(...p)); g.closePath(); g.fill(); g.stroke();
  g.fillStyle = '#F7C51E'; for (const e of [-1, 1]) for (const k of [-0.009, 0, 0.009]) { const [x, y] = pr([e * (L - 0.006), k, 0]); g.fillRect(x - 2, y - 14, 4, 14); }
  if (showField && match) for (const z of match.inn.field) { const a = ZONE_ANGLE[z] * Math.PI / 180, [x, y] = pr([-L + 0.03 + Math.cos(a) * 0.26, Math.sin(a) * 0.26, 0]);
    g.fillStyle = '#1F6FB2'; g.beginPath(); g.arc(x, y, 9, 0, 7); g.fill(); g.fillStyle = '#fff'; g.font = '11px Baloo'; g.fillText(z, x + 11, y + 4); }
  const now = performance.now(); let p = null;
  if (anim && anim.type === 'delivery' && now >= anim.t0) p = deliveryPos(F2, anim.del, Math.min(1, (now - anim.t0) / anim.D));
  if (anim && anim.type === 'shot') p = shotPos(F2, anim.r, Math.min(1, (now - anim.t0) / anim.D));
  if (p) { const sh = pr([p[0], p[1], 0]); g.fillStyle = '#0005'; g.beginPath(); g.ellipse(sh[0], sh[1], 7, 4, 0, 0, 7); g.fill();
    const [x, y] = pr(p); g.fillStyle = '#6cc63f'; g.strokeStyle = '#2B2B2B'; g.lineWidth = 2; g.beginPath(); g.arc(x, y, 7, 0, 7); g.fill(); g.stroke(); }
  requestAnimationFrame(draw2d);
}
window.__game = () => ({ phase, match, faces, anim });
