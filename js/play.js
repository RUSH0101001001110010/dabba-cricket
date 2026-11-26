// Dabba Cricket: game controller (match flow, UI, AR scene, timing tap, sound + effects)
import { XRDabba, xrSupported, FACE_NAMES } from './xrar.js?v=14';
import { Match, SHOTS, DELS, ZONES, timingWindows, classifyTap, smartField } from './rules.js?v=14';
import { deliveryPos, deliveryTime, shotPos, addBall, addFielder, addShadow, addTrail, addFallingStumps, ZONE_ANGLE, ease } from './scene.js?v=14';
import { line } from './commentary.js?v=14';
import { initAudio, sfx, voice, setMuted, isMuted, ambience } from './sfx.js?v=14';

const $ = s => document.querySelector(s);
const show = (sel, on = true) => { for (const s of sel.split(',')) $(s.trim()).hidden = !on; };
const hideAll = () => show('#toss,#conds,#field,#rollPanel,#faces,#chips,#tapzone,#callout,#perfectTag,#comm,#resultBtns,#overlay,#hint,#vs,#count,#sticker,#crack,#lvl,#replayTag', false);
const wait = ms => new Promise(r => setTimeout(r, ms));
const opts = { mode: 'vs', lang: 'ro', easy: false };
let match = null, ar = null, faces = null, anim = null, showField = false, view2d = false, phase = 'home', autoTimer = null;
// ---------- Gully Challenge: best score (kept on this phone) ----------
const ch = { best: { runs: 0, balls: 0, name: '' }, beat: false, streak: 0, bestStreak: 0, lastBall: null, hot: [] };
try { const b = JSON.parse(localStorage.getItem('dabba_best') || 'null'); if (b && b.runs >= 0) ch.best = b; } catch (e) {}
function saveBest() { try { localStorage.setItem('dabba_best', JSON.stringify(ch.best)); } catch (e) {} }
function bestLine() { $('#bestLine').innerHTML = opts.mode === 'challenge' ? (ch.best.runs ? `YOUR BEST: <b>${ch.best.runs}</b> off ${ch.best.balls} balls` : 'Bat till you\'re out. Set your first best!') : ''; }
const isCh = () => match && match.mode === 'challenge';

// ---------- home ----------
for (const b of document.querySelectorAll('#segMode button')) b.onclick = () => {
  document.querySelectorAll('#segMode button').forEach(x => x.classList.toggle('on', x === b)); opts.mode = b.dataset.v; $('#n2wrap').hidden = opts.mode !== 'vs'; bestLine(); };
$('#startAR').onclick = async () => {
  initAudio();
  if (!(await xrSupported())) { $('#homeMsg').textContent = 'AR is not available in this browser. Use Chrome on an ARCore phone (update "Google Play Services for AR"), or tap PLAY WITHOUT AR.'; return; }
  try { ar = new XRDabba($('#gl'), $('#ui')); wireAR(); ar.paused = true; await ar.start(); startGame(); }
  catch (e) { $('#homeMsg').textContent = 'AR could not start: ' + e.message; ar = null; }
};
$('#startNoAR').onclick = () => { initAudio(); ar = null; view2d = true; $('#view2d').hidden = false; requestAnimationFrame(draw2d); startGame(); };
let menuArmed = 0;
$('#menuBtn').onclick = () => { if (performance.now() - menuArmed < 2500) { goHome(); return; } menuArmed = performance.now(); $('#menuBtn').textContent = 'TAP AGAIN TO EXIT'; setTimeout(() => $('#menuBtn').textContent = 'MENU', 2500); };
$('#muteBtn').onclick = () => { setMuted(!isMuted()); $('#muteBtn').textContent = isMuted() ? '🔇' : '🔊'; };
function goHome() { clearTimeout(autoTimer); if (ar) { try { ar.end(); } catch (e) {} ar = null; } view2d = false; $('#view2d').hidden = true; hideAll(); show('#score,#menuBtn,#muteBtn', false); ambience(false); show('#home'); phase = 'home'; bestLine(); }

// ---------- AR wiring ----------
function wireAR() {
  ar.scene = (F, b) => {
    const now = performance.now();
    if (anim && anim.type === 'delivery' && now >= anim.t0) { const p = deliveryPos(F, anim.del, ease(anim.del, (now - anim.t0) / anim.D)); addShadow(b, F, p); addBall(b, p, F); }
    if (anim && anim.type === 'shot') {
      const s = shotProgress(now), at = x => shotPos(F, anim.r, x), p = at(s);
      if (anim.r.runs >= 4 || anim.r.out) addTrail(b, F, at, s);
      addShadow(b, F, p); addBall(b, p, F);
      if (anim.r.how === 'bowled' || anim.r.how === 'lbw') addFallingStumps(b, F, Math.min(1, (now - anim.t0) / 700));
    }
    if (showField && match) for (const z of match.inn.field) addFielder(b, F, z);
  };
  ar.on(e => {
    if (e.type === 'read' && phase === 'roll') { chip('#cBat', e.bat); chip('#cBowl', e.bowl); $('#hint').hidden = e.markers > 0; }
    else if (e.type === 'locked' && phase === 'roll') onLocked(e.locked.bat, e.locked.bowl - 6);
    else if (e.type === 'waiting' && phase === 'roll') { setChipText('#cBat', e.rolled.bat ? 'ROLLED ✓' : 'ROLL…'); setChipText('#cBowl', e.rolled.bowl ? 'ROLLED ✓' : 'ROLL…'); }
    else if (e.type === 'ended') goHome();
  });
}
// slow-motion for perfect hits: the first part of the flight plays at half speed
function shotProgress(now) { const u = Math.min(1, (now - anim.t0) / anim.D); return anim.slow ? (u < 0.5 ? u * 0.5 : 0.25 + (u - 0.5) * 1.5) : u; }
function chip(sel, v) {
  const el = $(sel), s = el.querySelector('span'); el.classList.remove('ok', 'lock');
  if (!v) { s.textContent = '—'; return; }
  s.textContent = v.moving ? 'ROLLING…' : v.top < 0 ? (v.low ? 'TILT PHONE' : '—') : FACE_NAMES[v.top] + (v.settled ? ' ✓' : '…');
  if (v.settled) el.classList.add('ok');
}
function setChipText(sel, t, lock) { const el = $(sel); el.querySelector('span').textContent = t; el.classList.toggle('lock', !!lock); el.classList.remove('ok'); }

// ---------- commentary ----------
function say(key, append = false) {
  const l = line(key, opts.lang); if (!l) return;
  const html = `<div><b>${l.who.toUpperCase()}:</b> ${escapeHtml(l.text)}</div>`;
  $('#comm').innerHTML = append ? $('#comm').innerHTML + html : html; show('#comm'); voice(l.id);
}
function escapeHtml(s) { return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
// a card that waits for a tap or a timeout, whichever comes first
function tapOrWait(el, ms) { return new Promise(res => { let done = false; const fin = () => { if (done) return; done = true; el.removeEventListener('pointerdown', fin); res(); }; el.addEventListener('pointerdown', fin); setTimeout(fin, ms); }); }

// ---------- match start ----------
async function startGame() {
  clearTimeout(autoTimer);
  opts.lang = $('#lang').value; opts.easy = $('#easy').checked;
  const names = [$('#n1').value.trim() || 'Player 1', opts.mode !== 'vs' ? 'Computer' : ($('#n2').value.trim() || 'Player 2')];
  match = opts.mode === 'challenge' ? new Match({ mode: 'challenge', names, overs: Infinity, wickets: 1 }) : new Match({ mode: opts.mode, names }); firstBall = true;
  Object.assign(ch, { beat: false, streak: 0, bestStreak: 0, lastBall: null, hot: [] });
  show('#home', false); hideAll(); show('#score,#menuBtn,#muteBtn'); updateScore(); ambience(true);
  phase = 'toss';
  let bat = 0;
  if (opts.mode === 'challenge') {
    $('#lvlSmall').textContent = 'SOLO · ONE WICKET'; $('#lvlTxt').textContent = 'GULLY CHALLENGE';
    $('#lvlEff').textContent = (ch.best.runs ? `Your best: ${ch.best.runs}. ` : '') + 'Roll both dabbas every ball: one is your shot, the other is the computer\'s ball. Every over gets harder, and the computer captain moves fielders to where you score.';
    show('#lvl'); sfx.drumroll(0.8); await tapOrWait($('#lvl'), 5000); show('#lvl', false);
  }
  if (opts.mode === 'vs') {
    $('#tossTxt').textContent = 'TOSS…'; $('#coin').hidden = false; show('#toss'); sfx.drumroll(1.1); await wait(1200);
    bat = Math.random() < 0.5 ? 0 : 1; $('#coin').hidden = true; $('#tossTxt').innerHTML = `${escapeHtml(names[bat].toUpperCase())} WINS THE TOSS<br>· BATTING FIRST ·`; sfx.slam(); await tapOrWait($('#toss'), 1600); show('#toss', false);
  }
  match.toss(bat);
  const c = match.cond, eff = { Dusty: 'The ball will turn. Spin and slower balls are harder to time.', Green: 'Help for the fast bowlers. Pace balls are harder to time.', Flat: 'A batting track. Easier timing on every ball.' }[c.pitch];
  $('#condTxt').textContent = `${PITCH_NAME[c.pitch]} · ${c.light === 'Floodlights' ? 'DAY-NIGHT' : 'DAY MATCH'}`;
  $('#condEff').textContent = eff + (c.light === 'Floodlights' ? ' Under the lights, perfect timing is a bit harder.' : '');
  phase = 'conds'; show('#conds'); sfx.slam(); say('CONDITIONS_' + c.pitch.toUpperCase());
  await tapOrWait($('#conds'), 2600); show('#conds', false);
  say('MATCH_START'); beginOver();
}

let firstBall = true;
async function beginOver() {
  hideAll(); updateScore();
  if (match.mode === 'challenge') { await levelUp(); beginBall(); return; }
  if (match.mode === 'practice') { match.autoField(); beginBall(); return; }
  phase = 'field'; buildField(); show('#field');
  $('#fieldTitle').textContent = `${match.names[match.inn.bowl].toUpperCase()}: SET YOUR FIELD`;
}
// challenge: each new over the computer captain sets a field from your scoring shots, and timing gets tighter
async function levelUp() {
  const o = match.over, n = match.fielders, sf = smartField(n, match.inn.log); match.setField(sf.field); ch.hot = sf.hot;
  if (o === 0) return;
  phase = 'level';
  $('#lvlSmall').textContent = `OVER ${o + 1} · LEVEL ${o + 1}`; $('#lvlTxt').textContent = 'LEVEL UP!';
  $('#lvlEff').textContent = `${n} fielders · timing ${Math.round((1 - lvlScale()) * 100)}% tighter.` + (sf.hot.length ? ` Computer captain put fielders at ${sf.hot.join(', ')}.` : '');
  show('#lvl'); sfx.slam(); sfx.drumroll(0.6); await tapOrWait($('#lvl'), 3200); show('#lvl', false);
}
const lvlScale = () => isCh() ? Math.max(0.55, Math.pow(0.92, match.over)) : 1;
let chosen = new Set();
function buildField() {
  const g = $('#field .ground'); g.querySelectorAll('.z').forEach(n => n.remove()); chosen = new Set();
  $('#fieldN').textContent = match.fielders; $('#fieldOk').disabled = true;
  for (const z of ZONES) {
    const da = { 'Long-on': 30, 'Long-off': -30 }[z] ?? ZONE_ANGLE[z], a = da * Math.PI / 180, r = 40, x = 50 + Math.sin(a) * r, y = 62 - Math.cos(a) * r;
    const b = document.createElement('button'); b.className = 'z'; b.textContent = z; b.style.left = x + '%'; b.style.top = y + '%';
    b.onclick = () => { sfx.pop(); if (chosen.has(z)) chosen.delete(z); else if (chosen.size < match.fielders) chosen.add(z); b.classList.toggle('on', chosen.has(z));
      $('#fieldOk').disabled = chosen.size !== match.fielders; };
    g.appendChild(b);
  }
}
$('#fieldAuto').onclick = () => { match.autoField(); say('FIELD_SET'); beginBall(); };
$('#fieldOk').onclick = () => { match.setField(chosen); say('FIELD_SET'); beginBall(); };

// ---------- roll + read ----------
function beginBall() {
  phase = 'roll'; faces = null; showField = false; anim = null; if (ar) ar.hideBatStumps = false;
  hideAll(); updateScore(); show('#rollPanel,#chips'); show('#manualBtn', !!ar);
  $('#rollTitle').textContent = `${match.names[match.inn.bat].toUpperCase()} vs ${match.names[match.inn.bowl].toUpperCase()}: ROLL!`;
  $('#rollSub').textContent = ar ? 'Roll both dabbas, then point the phone at them.' : 'Roll both dabbas, then tap the faces on top.';
  setChipText('#cBat', '—'); setChipText('#cBowl', '—');
  if (ar) { ar.paused = false; if (firstBall) ar.readNow(); else ar.newRoll(); firstBall = false; show('#hint'); $('#hint').textContent = 'Keep both dabbas in view · about a ruler apart'; sfx.drumroll(0.6); }
  else openFaces();
}
async function onLocked(batFace, bowlFace) {
  if (phase !== 'roll') return;
  phase = 'reveal'; faces = { bat: batFace, bowl: bowlFace }; if (ar) ar.paused = true;
  hideAll(); show('#chips');
  setChipText('#cBat', '🔒 ' + SHOTS[batFace].toUpperCase(), true); setChipText('#cBowl', '🔒 ' + DELS[bowlFace].toUpperCase(), true);
  if (navigator.vibrate) navigator.vibrate(60);
  // VS reveal card
  $('#vsBat').src = `img/faces/F${String(batFace + 1).padStart(2, '0')}.jpg`; $('#vsBowl').src = `img/faces/F${String(bowlFace + 7).padStart(2, '0')}.jpg`;
  $('#vsBatTxt').textContent = SHOTS[batFace].toUpperCase(); $('#vsBowlTxt').textContent = DELS[bowlFace].toUpperCase();
  show('#vs'); sfx.slam();
  await tapOrWait($('#vs'), 1500); show('#vs', false);
  // 3-2-1, bowler running in
  show('#count'); sfx.heartbeat(3, 0.5);
  for (const n of ['3', '2', '1']) { $('#count').textContent = n; $('#count').classList.remove('go'); await wait(500); }
  show('#count', false);
  startDelivery();
}
function openFaces() {
  const sel = { bat: -1, bowl: -1 };
  const mk = (id, names, key) => { const g = $(id); g.innerHTML = ''; names.forEach((n, i) => { const b = document.createElement('button'); b.textContent = n.toUpperCase(); b.className = 'alt';
    b.onclick = () => { sfx.pop(); sel[key] = i; g.querySelectorAll('button').forEach((x, j) => x.classList.toggle('on', j === i)); $('#facesOk').disabled = sel.bat < 0 || sel.bowl < 0; }; g.appendChild(b); }); };
  mk('#gBat', SHOTS, 'bat'); mk('#gBowl', DELS, 'bowl'); $('#facesOk').disabled = true;
  $('#facesOk').onclick = () => { phase = 'roll'; onLocked(sel.bat, sel.bowl); };
  show('#faces'); show('#rollPanel', false);
}
$('#manualBtn').onclick = () => { if (ar) ar.paused = true; openFaces(); };

// ---------- delivery + timing tap ----------
function startDelivery() {
  phase = 'bowl'; hideAll(); show('#tapzone');
  const del = DELS[faces.bowl], shot = SHOTS[faces.bat];
  const D = deliveryTime(del) * 1000 * (0.8 + Math.random() * 0.45);          // every ball a different speed
  const t0 = performance.now() + 400 + Math.random() * 900;                     // the run-up isn't always the same length
  anim = { type: 'delivery', del, D, t0, arrive: t0 + D, tapped: null, done: false, bounced: false };
  anim.win = timingWindows(del, match.cond, opts.easy, shot); const k = lvlScale(); anim.win.perfect *= k; anim.win.good *= k;
  anim.target = 55 + Math.random() * 35;                                        // the bat sits somewhere different on the bar each ball
  const bat = $('#meter .bat') || Object.assign(document.createElement('div'), { className: 'bat' }); bat.style.left = anim.target + '%'; $('#meter').appendChild(bat);
  $('#meter .good').style.width = '0'; $('#meter .perf').style.width = '0';
  setTimeout(() => sfx.whoosh(), Math.max(0, t0 - performance.now()));
  meterLoop();
}
function meterLoop() {
  if (!anim || anim.type !== 'delivery') return;
  const now = performance.now(), el = $('#meter .dot');
  const u = (now - anim.t0) / anim.D, prog = u <= 1 ? ease(anim.del, u) : 1 + (u - 1);
  el.style.left = Math.max(0, Math.min(100, prog * anim.target)) + '%'; el.style.opacity = now < anim.t0 ? 0.25 : 1;
  if (!anim.bounced && u > 0.72) { anim.bounced = true; sfx.bounce(); }
  if (!anim.done && now > anim.arrive + anim.win.good + 120 && anim.tapped == null) finishDelivery(null);
  else if (!anim.done && anim.tapped != null && now >= Math.max(anim.arrive, anim.tapAt)) finishDelivery(anim.tapped);
  if (anim && anim.type === 'delivery') requestAnimationFrame(meterLoop);
}
$('#tapzone').addEventListener('pointerdown', () => {
  if (!anim || anim.type !== 'delivery' || anim.tapped != null) return;
  const now = performance.now(); if (now < anim.t0) { anim.tapped = -9999; anim.tapAt = now; return; }
  anim.tapped = now - anim.arrive; anim.tapAt = now;
});
function finishDelivery(dt) {
  anim.done = true;
  const timing = classifyTap(dt, anim.win);
  const r = match.playBall(faces.bat, faces.bowl, timing); r.dt = dt;
  const contact = timing === 'Perfect' || timing === 'Good' || (r.runs > 0 && !r.out);
  if (contact) sfx.bat(timing === 'Perfect'); else if (r.how === 'bowled' || r.how === 'lbw') sfx.stumps(); else sfx.whoosh();
  ch.lastBall = { del: anim.del, D: anim.D, r };
  const slow = timing === 'Perfect' && r.runs >= 4;
  anim = { type: 'shot', r, t0: performance.now(), D: (r.runs >= 4 ? 1400 : 1000) * (slow ? 1.6 : 1), slow };
  show('#tapzone', false);
  if (slow) { show('#perfectTag'); flash(); }
  if (r.how === 'bowled' || r.how === 'lbw') { if (ar) ar.hideBatStumps = true; }
  setTimeout(() => showResult(r), anim.D * 0.85);
}
// ---------- result + effects ----------
function flash() { const f = $('#flash'); f.hidden = true; void f.offsetWidth; f.hidden = false; setTimeout(() => f.hidden = true, 400); }
function shake() { const u = $('#ui'); u.classList.remove('shake'); void u.offsetWidth; u.classList.add('shake'); setTimeout(() => u.classList.remove('shake'), 600); }
function petals(n = 40) {
  const fx = $('#fx'), cols = ['#F7C51E', '#F2711C', '#D62828', '#E8338B', '#FAF4E6'];
  for (let i = 0; i < n; i++) { const p = document.createElement('i'); p.style.left = '50%'; p.style.top = '32%'; p.style.background = cols[i % cols.length];
    p.style.setProperty('--dx', (Math.random() - 0.5) * 110 + 'vw'); p.style.setProperty('--dy', (Math.random() * 70 - 15) + 'vh'); p.style.setProperty('--r', (Math.random() * 720 - 360) + 'deg');
    p.style.animationDelay = Math.random() * 0.15 + 's'; fx.appendChild(p); setTimeout(() => p.remove(), 2200); }
}
function crack() { // cracked glass across the screen, from where the ball hit
  const svg = $('#crack'), cx = 30 + Math.random() * 40, cy = 25 + Math.random() * 30; let d = '';
  for (let i = 0; i < 14; i++) { const a = i / 14 * Math.PI * 2 + Math.random() * 0.3; let x = cx, y = cy; d += `M${cx},${cy} `;
    for (let k = 0; k < 4; k++) { x += Math.cos(a + (Math.random() - 0.5) * 0.6) * (6 + Math.random() * 10); y += Math.sin(a + (Math.random() - 0.5) * 0.6) * (6 + Math.random() * 10); d += `L${x.toFixed(1)},${y.toFixed(1)} `; } }
  for (const r of [4, 9]) d += `M${cx + r},${cy} A${r},${r} 0 1,1 ${cx + r - 0.1},${cy} `;
  svg.innerHTML = `<path d="${d}" fill="none" stroke="#fff" stroke-width="0.35" opacity=".95"/><path d="${d}" fill="none" stroke="#000" stroke-width="0.12" opacity=".5"/>`;
  show('#crack');
}
function showResult(r) {
  phase = 'result'; showField = true; updateScore(); show('#perfectTag', false); $('#perfectTag').textContent = 'PERFECT TIMING!';
  const C = CALL[opts.lang] || CALL.ro;
  const big = r.out ? (r.how === 'window' ? C.window : r.how === 'bowled' ? C.bowled : r.how === 'lbw' ? C.lbw : C.catch)
            : r.runs === 6 ? C.six : r.runs === 4 ? C.four : r.runs === 0 ? C.dot : C.run(r.runs);
  const c = $('#callout'); c.textContent = big; c.classList.toggle('out', r.out); c.hidden = true; void c.offsetWidth; c.hidden = false;
  // feel
  if (r.runs === 6) { petals(36); sfx.six(); sfx.crowd(1.4); flash(); }
  else if (r.runs === 4) { petals(18); sfx.four(); sfx.crowd(1); }
  else if (r.out) { shake(); show('#sticker'); if (r.how === 'window') { crack(); sfx.glass(); setTimeout(() => sfx.groan(), 500); } else sfx.groan(); }
  else if (r.runs === 0) sfx.thud(); else sfx.pop();
  if (navigator.vibrate) navigator.vibrate(r.out ? [90, 60, 90] : r.runs >= 4 ? 150 : 30);
  say(r.key);
  if (r.out) say('OUT_CALL', true);
  if (isCh()) {
    const R = match.inn.runs; ch.streak = r.runs > 0 ? ch.streak + 1 : 0; ch.bestStreak = Math.max(ch.bestStreak, ch.streak); updateScore();
    if (!ch.beat && ch.best.runs > 0 && R > ch.best.runs) { ch.beat = true; $('#perfectTag').textContent = 'NEW BEST!'; show('#perfectTag'); sfx.fanfare(); petals(30); }
    else if ([25, 50, 100].some(m => R >= m && R - r.runs < m)) { $('#perfectTag').textContent = R >= 100 ? 'HUNDRED!' : R >= 50 ? 'FIFTY!' : '25 UP!'; show('#perfectTag'); sfx.fanfare(); }
  }
  $('#comm').innerHTML += `<div style="font:12px Bungee;color:#F7C51E;margin-top:3px">${r.shot.toUpperCase()} vs ${r.delivery.toUpperCase()} · ${r.timing.toUpperCase()}${r.dt != null && Math.abs(r.dt) < 2000 ? ` (${r.dt > 0 ? '+' : ''}${Math.round(r.dt)} ms)` : r.dt == null ? ' (NO SHOT)' : ''}${r.fielded ? ' · FIELDER AT ' + r.zone.toUpperCase() : ''}</div>`;
  show('#resultBtns');
  // move on automatically (tap anywhere to go now)
  clearTimeout(autoTimer); autoTimer = setTimeout(next, r.out || r.runs >= 4 ? 3800 : 2800);
}
function next() {
  if (phase !== 'result') return; clearTimeout(autoTimer);
  anim = null; showField = false; show('#callout,#comm,#resultBtns,#sticker,#crack,#perfectTag', false); if (ar) ar.hideBatStumps = false;
  if (match.phase === 'roll') beginBall();
  else if (match.phase === 'field') beginOver();
  else if (match.phase === 'inningsBreak') overlay('INNINGS BREAK', `${match.names[match.inn.bat]} scored ${match.scoreText()}. ${match.names[match.inn.bowl]} needs ${match.inn.runs + 1} to win. Pass the phone!`, 'START CHASE', () => { match.startNextInnings(); beginOver(); });
  else if (match.phase === 'superOver') { say('SUPER_OVER'); sfx.drumroll(1.2); sfx.cooker(); overlay('SUPER OVER!', 'Scores are level. One over, one wicket each.', 'PLAY SUPER OVER', () => { match.startNextInnings(); beginOver(); }); }
  else if (match.phase === 'matchEnd') endMatch();
}
$('#nextBtn').onclick = next;
$('#ui').addEventListener('pointerdown', e => { if (phase === 'result' && !e.target.closest('button')) next(); });
function overlay(title, txt, btn, fn, home = false, html = false) {
  phase = 'overlay'; $('#ovTitle').textContent = title; $('#ovTxt')[html ? 'innerHTML' : 'textContent'] = txt; $('#ovBtn').textContent = btn; show('#ovHome', home); show('#ovShare', html && isCh());
  $('#ovBtn').onclick = () => { show('#overlay', false); fn(); }; show('#overlay');
}
$('#ovHome').onclick = () => goHome();
function endMatch() {
  if (isCh()) { challengeEnd(); return; }
  const w = match.winner, n = match.innings.length, a = match.innings[n - 2], b = match.innings[n - 1];
  const txt = w < 0 ? `It's a tie! ${a.runs} each.` : `${match.names[w]} wins! ${match.names[a.bat]} ${a.runs}/${a.wkts} · ${match.names[b.bat]} ${b.runs}/${b.wkts}`;
  say(match.mode === 'practice' && w !== 0 ? 'LOSE' : 'WIN'); sfx.fanfare(); sfx.crowd(1.5, 3); petals(50);
  overlay(w < 0 ? 'TIE!' : 'MOHALLA CHAMPION!', txt, 'REMATCH', () => startGame(), true);
}
function updateScore() {
  $('#score').hidden = !(match && match.inn) || phase === 'home';
  if (isCh() && match.inn) { scoreChallenge(); return; }
  if (!match || !match.inn) { ['#sTeam', '#sRuns', '#sOvers', '#sOther', '#sTarget', '#sBalls', '#sCond'].forEach(s => $(s).textContent = ''); return; }
  const I = match.inn, n = match.innings.length, prev = n > 1 ? match.innings[n - 2] : null;
  $('#sTeam').textContent = match.names[I.bat].toUpperCase(); $('#sRuns').textContent = match.scoreText(); $('#sOvers').textContent = `${match.oversText()}/${I.overs} ov`;
  // second line: the other side's score once they've batted, else who's bowling
  $('#sOther').textContent = prev && I.target ? `${match.names[prev.bat]} ${prev.runs}/${prev.wkts}` : match.mode === 'practice' ? '' : `bowler: ${match.names[I.bowl]}`;
  const left = I.overs * 6 - I.balls, need = I.target ? Math.max(0, I.target - I.runs) : 0;
  $('#sTarget').textContent = I.target ? `NEED ${need} OFF ${left} BALL${left === 1 ? '' : 'S'}` : (match.innings.length === 1 ? '1ST INNINGS' : '');
  $('#sTarget').classList.toggle('hot', !!I.target && left <= 6 && need > 0);
  // this over, ball by ball
  const inOver = I.balls % 6 === 0 && I.balls > 0 && phase === 'result' ? 6 : I.balls % 6, last = I.log.slice(I.log.length - inOver);
  $('#sBalls').innerHTML = last.map(r => r.out ? '<i class="bw">W</i>' : `<i class="b${r.runs >= 6 ? 6 : r.runs >= 4 ? 4 : r.runs ? 'r' : 0}">${r.runs ? r.runs : '•'}</i>`).join('') + '<i class="e"></i>'.repeat(Math.max(0, 6 - last.length));
  $('#sCond').textContent = `${PITCH_NAME[match.cond.pitch]} · ${match.cond.light === 'Floodlights' ? 'DAY-NIGHT' : 'DAY'} · ${I.wickets - I.wkts} WKT${I.wickets - I.wkts === 1 ? '' : 'S'} LEFT`;
}
function scoreChallenge() {
  const I = match.inn, R = I.runs, B = ch.best.runs;
  $('#sTeam').textContent = match.names[0].toUpperCase(); $('#sRuns').textContent = R; $('#sOvers').textContent = `(${I.balls} ball${I.balls === 1 ? '' : 's'})`;
  $('#sOther').textContent = B ? `best: ${B}` : 'first try: set a best!';
  const need = B - R + 1;
  $('#sTarget').textContent = !B ? 'GULLY CHALLENGE' : ch.beat ? 'NEW BEST! KEEP GOING' : `${need} TO BEAT YOUR BEST`;
  $('#sTarget').classList.toggle('hot', !!B && !ch.beat && need <= 6);
  const inOver = I.balls % 6 === 0 && I.balls > 0 && phase === 'result' ? 6 : I.balls % 6, last = I.log.slice(I.log.length - inOver);
  $('#sBalls').innerHTML = last.map(r => r.out ? '<i class="bw">W</i>' : `<i class="b${r.runs >= 6 ? 6 : r.runs >= 4 ? 4 : r.runs ? 'r' : 0}">${r.runs ? r.runs : '•'}</i>`).join('') + '<i class="e"></i>'.repeat(Math.max(0, 6 - last.length));
  $('#sCond').textContent = `LEVEL ${match.over + 1} · ${match.fielders} FIELDERS${ch.streak >= 2 ? ` · STREAK ${ch.streak}` : ''}`;
}
// ---------- challenge end: instant replay, best score, share ----------
async function replay() {
  const L = ch.lastBall; if (!L) return;
  phase = 'replay'; hideAll(); show('#replayTag'); showField = true; if (ar) ar.hideBatStumps = false;
  const D = L.D * 1.6, t0 = performance.now() + 250;
  anim = { type: 'delivery', del: L.del, D, t0, arrive: t0 + D, done: true }; sfx.whoosh();
  await wait(250 + D);
  const r = L.r; anim = { type: 'shot', r, t0: performance.now(), D: 1800, slow: false };
  if (r.how === 'bowled' || r.how === 'lbw') { if (ar) ar.hideBatStumps = true; sfx.stumps(); } else if (r.how === 'window') sfx.glass(); else sfx.bat(false);
  await wait(2000); show('#replayTag', false);
}
async function challengeEnd() {
  await replay();
  const I = match.inn, R = I.runs, old = ch.best.runs, isNew = R > old;
  if (isNew) { ch.best = { runs: R, balls: I.balls, name: match.names[0] }; saveBest(); }
  anim = null; showField = false; if (ar) ar.hideBatStumps = false;
  if (isNew) { sfx.fanfare(); sfx.crowd(1.5, 3); petals(50); say('WIN'); } else say('LOSE');
  const how = { caught: 'catch out', 'caught behind': 'catch out (edge)', bowled: 'clean bowled', lbw: 'LBW', window: 'window broken' }[I.log[I.log.length - 1].how] || 'out';
  overlay(isNew ? (old ? 'NEW BEST!' : 'FIRST BEST SET!') : 'OUT!',
    `<b>${R} off ${I.balls}</b>${escapeHtml(match.names[0])}, ${how} in level ${match.over + 1}. Longest streak: ${ch.bestStreak}.<br>${isNew ? (old ? `Old best was ${old}.` : 'Now beat it!') : `Your best is still ${ch.best.runs}. ${ch.best.runs - R + 1} more next time!`}`,
    'PLAY AGAIN', () => startGame(), true, true);
}
async function shareCard() {
  const I = match.inn, R = I.runs, name = match.names[0], url = location.origin + location.pathname.replace(/[^/]*$/, '');
  try { await document.fonts.load('80px Bungee'); } catch (e) {}
  const c = document.createElement('canvas'); c.width = 1080; c.height = 1080; const g = c.getContext('2d');
  g.fillStyle = '#F7C51E'; g.fillRect(0, 0, 1080, 1080);
  const cols = ['#D62828', '#F2711C', '#E8338B', '#1F6FB2', '#5DB33B'];
  for (let i = 0; i < 36; i++) { g.fillStyle = cols[i % 5]; g.fillRect(i * 30, 0, 30, 34); g.fillRect(i * 30, 1046, 30, 34); }
  g.fillStyle = '#2B2B2B'; g.textAlign = 'center';
  g.font = '92px Bungee'; g.fillText('DABBA CRICKET', 540, 170);
  g.font = '40px Bungee'; g.fillText('GULLY CHALLENGE', 540, 240);
  g.font = '48px Bungee'; g.fillText(name.toUpperCase() + ' SCORED', 540, 380);
  g.font = '300px Bungee'; g.fillStyle = '#D62828'; g.fillText(String(R), 540, 650); g.fillStyle = '#2B2B2B';
  g.font = '44px Bungee'; g.fillText(`OFF ${I.balls} BALLS · LEVEL ${match.over + 1}`, 540, 740);
  g.font = '60px Bungee'; g.fillText('CAN YOU BEAT ME?', 540, 880);
  g.font = '30px sans-serif'; g.fillText(url.replace(/^https?:\/\//, ''), 540, 960);
  window.__shareCard = c.toDataURL('image/png');
  const text = `I scored ${R} off ${I.balls} balls in Dabba Cricket's Gully Challenge! Can you beat me? ${url}`;
  const blob = await new Promise(r => c.toBlob(r, 'image/png'));
  try {
    const file = new File([blob], 'dabba-cricket-challenge.png', { type: 'image/png' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], text }); return; }
    if (navigator.share) { await navigator.share({ text }); return; }
  } catch (e) { if (e && e.name === 'AbortError') return; }
  window.open('https://wa.me/?text=' + encodeURIComponent(text), '_blank');
}
$('#ovShare').onclick = () => shareCard();
// Indian TV / gully words for the big result text, per commentary language
const CALL = {
  ro: { six: 'CHHAKKA!', four: 'CHAUKA!', catch: 'CATCH OUT!', bowled: 'CLEAN BOWLED!', lbw: 'LBW OUT!', window: 'KHIDKI TOOTI! OUT!', dot: 'DOT BALL', run: n => `${n} RUN${n > 1 ? 'S' : ''}` },
  en: { six: 'SIX!', four: 'FOUR!', catch: 'CATCH OUT!', bowled: 'CLEAN BOWLED!', lbw: 'LBW OUT!', window: 'WINDOW BROKEN! OUT!', dot: 'DOT BALL', run: n => `${n} RUN${n > 1 ? 'S' : ''}` },
  hi: { six: 'छक्का!', four: 'चौका!', catch: 'कैच आउट!', bowled: 'क्लीन बोल्ड!', lbw: 'LBW आउट!', window: 'खिड़की टूटी! आउट!', dot: 'डॉट बॉल', run: n => `${n} रन` },
};
const PITCH_NAME = { Dusty: 'DRY TURNER', Green: 'GREEN TOP', Flat: 'FLAT TRACK' };

// ---------- 2D view (no AR) ----------
const F2 = { mid: [0, 0, 0], fwd: [1, 0, 0], side: [0, 1, 0], up: [0, 0, 1], len: 0.30 };
function draw2d() {
  if (!view2d) return;
  const c = $('#view2d'), dpr = devicePixelRatio || 1, W = c.clientWidth, H = c.clientHeight;
  if (c.width !== W * dpr) { c.width = W * dpr; c.height = H * dpr; }
  const g = c.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H);
  const sc = Math.min(W / 0.75, H / 0.75), cx = W / 2, cy = H * 0.52;
  const pr = p => [cx - p[1] * sc, cy - p[0] * sc - p[2] * sc * 1.3];
  g.fillStyle = '#5DB33B'; g.beginPath(); g.arc(cx, cy + 0.12 * sc, 0.5 * sc, 0, 7); g.fill();
  const L = F2.len / 2, w = 0.035, q = [[-L, -w, 0], [-L, w, 0], [L, w, 0], [L, -w, 0]].map(pr);
  g.fillStyle = '#dec480'; g.strokeStyle = '#2B2B2B'; g.lineWidth = 3; g.beginPath(); q.forEach((p, i) => i ? g.lineTo(...p) : g.moveTo(...p)); g.closePath(); g.fill(); g.stroke();
  const now = performance.now(), fallen = anim && anim.type === 'shot' && (anim.r.how === 'bowled' || anim.r.how === 'lbw') ? Math.min(1, (now - anim.t0) / 600) : 0;
  g.fillStyle = '#F7C51E'; for (const e of [-1, 1]) for (const k of [-0.009, 0, 0.009]) { const [x, y] = pr([e * (L - 0.006), k, 0]);
    if (e < 0 && fallen) { g.save(); g.translate(x, y); g.rotate(fallen * (1.2 + k * 40)); g.fillRect(-2, -14, 4, 14); g.restore(); } else g.fillRect(x - 2, y - 14, 4, 14); }
  if (showField && match) for (const z of match.inn.field) { const a = ZONE_ANGLE[z] * Math.PI / 180, [x, y] = pr([-L + 0.03 + Math.cos(a) * 0.26, Math.sin(a) * 0.26, 0]);
    g.fillStyle = '#1F6FB2'; g.beginPath(); g.arc(x, y, 9, 0, 7); g.fill(); g.fillStyle = '#fff'; g.font = '11px Baloo'; g.fillText(z, x + 11, y + 4); }
  let p = null, trail = [];
  if (anim && anim.type === 'delivery' && now >= anim.t0) p = deliveryPos(F2, anim.del, ease(anim.del, (now - anim.t0) / anim.D));
  if (anim && anim.type === 'shot') { const s = shotProgress(now); p = shotPos(F2, anim.r, s); if (anim.r.runs >= 4 || anim.r.out) for (let k = 1; k <= 6; k++) if (s - k * 0.03 > 0) trail.push(shotPos(F2, anim.r, s - k * 0.03)); }
  trail.forEach((t, i) => { const [x, y] = pr(t); g.fillStyle = `rgba(247,197,30,${0.5 - i * 0.07})`; g.beginPath(); g.arc(x, y, 6 - i * 0.7, 0, 7); g.fill(); });
  if (p) { const sh = pr([p[0], p[1], 0]); g.fillStyle = '#0005'; g.beginPath(); g.ellipse(sh[0], sh[1], 7, 4, 0, 0, 7); g.fill();
    const [x, y] = pr(p); g.fillStyle = '#6cc63f'; g.strokeStyle = '#2B2B2B'; g.lineWidth = 2; g.beginPath(); g.arc(x, y, 7, 0, 7); g.fill(); g.stroke(); }
  requestAnimationFrame(draw2d);
}
window.__game = () => ({ phase, match, faces, anim });
