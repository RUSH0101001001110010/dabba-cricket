// Dabba Cricket: WebXR (ARCore) version. ARCore tracks the room; we read the cubes from the
// camera image, convert them into room (world) coordinates, and pin the pitch there.
// After the lock, face reading stops: the pitch stays fixed in the room even if the cubes leave view.
import { topFromCube, CubeReader } from './cubepose.js?v=14';
import { geometry, PITCH } from './arpitch.js?v=14';

export const FACE_NAMES = ['DRIVE', 'PULL', 'CUT', 'LOFT', 'SWEEP', 'BLOCK', 'YORKER', 'BOUNCER', 'SPIN', 'SLOWER', 'WIDE', 'GOOD LENGTH'];
const S = 0.062, MARKER = S * 0.30, STAMP_OFF = 0.27 * S, PROC_LONG = 1280, MIN_SCORE = 0.6;
const NETF = [[[1,0,0],[0,0,1],[0,1,0]],[[1,0,0],[0,-1,0],[0,0,1]],[[0,0,1],[0,-1,0],[-1,0,0]],[[0,0,-1],[0,-1,0],[1,0,0]],[[1,0,0],[0,0,-1],[0,-1,0]],[[1,0,0],[0,1,0],[0,0,-1]]];
const add = (a, b) => a.map((v, i) => v + b[i]), sub = (a, b) => a.map((v, i) => v - b[i]), mul = (a, k) => a.map(v => v * k);
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = a => mul(a, 1 / (Math.hypot(...a) || 1));
// column-major 4x4 helpers
const xfPoint = (M, p) => [M[0] * p[0] + M[4] * p[1] + M[8] * p[2] + M[12], M[1] * p[0] + M[5] * p[1] + M[9] * p[2] + M[13], M[2] * p[0] + M[6] * p[1] + M[10] * p[2] + M[14]];
const xfDir = (M, p) => [M[0] * p[0] + M[4] * p[1] + M[8] * p[2], M[1] * p[0] + M[5] * p[1] + M[9] * p[2], M[2] * p[0] + M[6] * p[1] + M[10] * p[2]];
const xfDirT = (M, p) => [M[0] * p[0] + M[1] * p[1] + M[2] * p[2], M[4] * p[0] + M[5] * p[1] + M[6] * p[2], M[8] * p[0] + M[9] * p[1] + M[10] * p[2]];
const cvToView = v => [v[0], -v[1], -v[2]];          // OpenCV camera (y down, z forward) -> WebXR view (y up, z back)

export async function xrSupported() {
  try { return !!(navigator.xr && await navigator.xr.isSessionSupported('immersive-ar')); } catch (e) { return false; }
}

export class XRDabba {
  constructor(canvas, overlay) {
    this.canvas = canvas; this.overlay = overlay; this.listeners = [];
    this.mode = 'reading'; this.locked = null; this.pitch = null;      // pitch frame in world coords once locked
    this.readers = { bat: new CubeReader(), bowl: new CubeReader() };
    this.cubes = { bat: null, bowl: null };                             // world positions (smoothed) + history
    this.tableY = null; this.frameNo = 0; this.busy = false; this.pending = null;
    this.stats = { ms: 0, fps: 0, cam: 0 }; this.scene = null; this.paused = false;
    this.worker = new Worker(new URL('./detect-worker.js?v=14', import.meta.url), { type: 'module' });
    this.worker.onmessage = e => this.onDetect(e.data);
  }
  on(fn) { this.listeners.push(fn); }
  emit(o) { this.listeners.forEach(fn => fn(o)); }

  async start() {
    const session = await navigator.xr.requestSession('immersive-ar', {
      requiredFeatures: ['local', 'camera-access'], optionalFeatures: ['dom-overlay'], domOverlay: { root: this.overlay } });
    this.session = session;
    const gl = this.gl = this.canvas.getContext('webgl2', { xrCompatible: true, alpha: true, antialias: true });
    await gl.makeXRCompatible();
    session.updateRenderState({ baseLayer: new XRWebGLLayer(session, gl) });
    this.ref = await session.requestReferenceSpace('local');
    this.binding = new XRWebGLBinding(session, gl);
    this.initGL();
    session.addEventListener('end', () => this.emit({ type: 'ended' }));
    session.requestAnimationFrame((t, f) => this.onFrame(t, f));
  }
  end() { if (this.session) this.session.end(); }

  // ---------- GL ----------
  initGL() {
    const gl = this.gl;
    const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
    const prog = (vs, fs) => { const p = gl.createProgram(); gl.attachShader(p, sh(gl.VERTEX_SHADER, vs)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs)); gl.linkProgram(p); return p; };
    // camera blit: copy the opaque camera texture into our own small framebuffer, then read pixels
    this.blitProg = prog(`#version 300 es
      in vec2 p; out vec2 uv; void main(){ uv = p*0.5+0.5; gl_Position = vec4(p,0.,1.); }`,
      `#version 300 es
      precision mediump float; in vec2 uv; uniform sampler2D cam; out vec4 o; void main(){ o = texture(cam, uv); }`);
    this.quadBuf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    this.fbo = gl.createFramebuffer(); this.fboTex = gl.createTexture(); this.fboW = 0; this.fboH = 0;
    // coloured triangles for the pitch
    this.meshProg = prog(`#version 300 es
      in vec3 p; in vec4 c; uniform mat4 P, V; out vec4 vc; void main(){ vc = c; gl_Position = P*V*vec4(p,1.); }`,
      `#version 300 es
      precision mediump float; in vec4 vc; out vec4 o; void main(){ o = vc; }`);
    this.meshBuf = gl.createBuffer(); this.meshCount = 0;
  }
  readCamera(view, camera) {
    const gl = this.gl, tex = this.binding.getCameraImage(camera); if (!tex) return null;
    const sc = PROC_LONG / Math.max(camera.width, camera.height), w = Math.round(camera.width * sc), h = Math.round(camera.height * sc);
    if (w !== this.fboW || h !== this.fboH) {
      gl.bindTexture(gl.TEXTURE_2D, this.fboTex); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.fboTex, 0);
      this.fboW = w; this.fboH = h;
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo); gl.viewport(0, 0, w, h);
    gl.useProgram(this.blitProg); gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.uniform1i(gl.getUniformLocation(this.blitProg, 'cam'), 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuf); const loc = gl.getAttribLocation(this.blitProg, 'p');
    gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    gl.disable(gl.DEPTH_TEST); gl.disable(gl.BLEND); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    const px = new Uint8Array(w * h * 4); gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
    gl.disableVertexAttribArray(loc);
    // camera intrinsics from the view's projection matrix (image y down)
    const P = view.projectionMatrix;
    const fx = P[0] * w / 2, fy = P[5] * h / 2, cx = (1 - P[8]) * w / 2, cy = (1 + P[9]) * h / 2;
    return { px, w, h, f: (fx + fy) / 2, cx, cy };
  }

  // ---------- per frame ----------
  onFrame(t, frame) {
    const session = frame.session; session.requestAnimationFrame((t2, f2) => this.onFrame(t2, f2));
    const pose = frame.getViewerPose(this.ref); if (!pose) return;
    const gl = this.gl, layer = session.renderState.baseLayer;
    const view = pose.views[0];
    if (this.last) this.stats.fps = this.stats.fps * 0.9 + 100 / (t - this.last); this.last = t;
    // read the camera only while we still need the faces (not after the lock)
    this.frameNo++;
    if (this.mode !== 'locked' && !this.paused && !this.busy && view.camera && this.frameNo % 2 === 0) {
      try {
        const img = this.readCamera(view, view.camera);
        if (img) {
          this.busy = true;
          this.pending = { M: Float32Array.from(view.transform.matrix), camPos: [view.transform.position.x, view.transform.position.y, view.transform.position.z] };
          this.worker.postMessage({ rgba: img.px.buffer, w: img.w, h: img.h, f: img.f, cx: img.cx, cy: img.cy, size: MARKER, id: this.frameNo }, [img.px.buffer]);
        }
      } catch (e) { this.emit({ type: 'error', message: e.message }); }
    }
    // draw
    gl.bindFramebuffer(gl.FRAMEBUFFER, layer.framebuffer);
    gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    const pitch = this.pitch || this.previewPitch;
    if (pitch) {
      this.buildMesh(pitch);
      for (const v of pose.views) {
        const vp = layer.getViewport(v); gl.viewport(vp.x, vp.y, vp.width, vp.height);
        this.drawMesh(v.projectionMatrix, v.transform.inverse.matrix);
      }
    }
    this.emit({ type: 'frame', mode: this.mode, locked: this.locked, stats: this.stats });
  }

  // ---------- detection results ----------
  onDetect({ markers, ms }) {
    this.busy = false; const P = this.pending; if (!P) return;
    this.stats.ms = this.stats.ms * 0.8 + ms * 0.2;
    // world up (local space is gravity aligned: +Y up) expressed in OpenCV camera coords
    const upView = xfDirT(P.M, [0, 1, 0]), upCv = [upView[0], -upView[1], -upView[2]];
    const bat = markers.filter(m => m.id < 6), bowl = markers.filter(m => m.id >= 6);
    const wb = this.worldCube(bat, 0, P), ww = this.worldCube(bowl, 6, P);
    this.track('bat', wb); this.track('bowl', ww);
    if (this.mode === 'reading') {
      const vb = this.readers.bat.push(topFromCube(bat, 0, upCv), bat, MIN_SCORE);
      const vw = this.readers.bowl.push(topFromCube(bowl, 6, upCv), bowl, MIN_SCORE);
      this.previewPitch = this.pitchFrame();
      this.emit({ type: 'read', bat: vb, bowl: vw, markers: markers.length });
      if (vb.settled && vw.settled && this.cubes.bat && this.cubes.bowl) this.lock(vb.top, vw.top);
    } else if (this.mode === 'waitRoll') {
      // a roll: a cube's position in the ROOM moved (camera movement doesn't change room positions)
      for (const k of ['bat', 'bowl']) {
        const c = this.cubes[k], L = this.lockedPos && this.lockedPos[k];
        if (c && L && Math.hypot(...sub(c.p, L)) > 0.04) this.rolled[k] = true;
        if (!c || c.age > 8) this.rolled[k] = true;
      }
      this.emit({ type: 'waiting', rolled: { ...this.rolled } });
      if (this.rolled.bat && this.rolled.bowl) this.readNow();
    }
  }
  // cube centre in world coords from its most straight-on stamp
  worldCube(ms, base, P) {
    if (!ms.length) return null;
    let best = null, bw = -1;
    for (const m of ms) { const w = -m.normal[2] * Math.sqrt(m.area || 1); if (w > bw) { bw = w; best = m; } }
    const [x, y] = best.R, n = best.normal, t = best.t;
    const cen = [0, 1, 2].map(i => t[i] - (x[i] + y[i]) * STAMP_OFF - n[i] * S / 2);   // camera (CV) coords
    return { p: xfPoint(P.M, cvToView(cen)), cam: P.camPos, facing: -n[2] };
  }
  track(k, obs) {
    const c = this.cubes[k];
    if (!obs) { if (c) c.age++; return; }
    let p = obs.p;
    // both cubes stand on the same table: estimate its height, then slide the cube along the camera ray onto it
    // table height = median of recent straight-on readings (robust to odd stamps)
    if (obs.facing > 0.5 || this.tableY == null) { (this.yHist = this.yHist || []).push(p[1] - S / 2); if (this.yHist.length > 40) this.yHist.shift();
      const sorted = [...this.yHist].sort((a, b) => a - b); this.tableY = sorted[sorted.length >> 1]; }
    const ray = sub(p, obs.cam), targetY = this.tableY + S / 2;
    if (Math.abs(ray[1]) > 1e-3) { const k2 = (targetY - obs.cam[1]) / ray[1]; if (k2 > 0.5 && k2 < 2) p = add(obs.cam, mul(ray, k2)); }
    if (!c || c.age > 8) { this.cubes[k] = { p, age: 0, hist: [p], far: 0 }; return; }
    if (Math.hypot(...sub(p, c.p)) > 0.08) {                     // a far-off reading: trust it only if it repeats (cube really moved)
      if (++c.far >= 3) this.cubes[k] = { p, age: 0, hist: [p], far: 0 }; else c.age = 0;
      return;
    }
    c.far = 0; c.p = add(c.p, mul(sub(p, c.p), 0.3)); c.age = 0; c.hist.push(p); if (c.hist.length > 12) c.hist.shift();
  }
  pitchFrame(fromHist) {
    const A = this.cubes.bat, B = this.cubes.bowl; if (!A || !B || A.age > 8 || B.age > 8) return null;
    const avg = h => [0, 1, 2].map(i => { const v = h.map(p => p[i]).sort((x, y) => x - y); return v[v.length >> 1]; });   // per-axis median
    const a = fromHist ? avg(A.hist) : A.p, b = fromHist ? avg(B.hist) : B.p, up = [0, 1, 0];
    let d = sub(b, a); d[1] = 0; const dist = Math.hypot(...d); if (dist < 0.08) return null;
    const fwd = norm(d), side = norm(cross(up, fwd));
    const len = dist >= PITCH.snapMin && dist <= PITCH.snapMax ? dist : PITCH.len;
    const mid = add(mul(add(a, b), 0.5), [0, S / 2, 0]);
    return { mid, fwd, side, up, len };
  }
  lock(bt, wt) {
    this.mode = 'locked';
    this.pitch = this.pitchFrame(true) || this.previewPitch;           // averaged over the last readings, then FROZEN in the room
    this.lockedPos = { bat: this.cubes.bat.p, bowl: this.cubes.bowl.p };
    this.locked = { bat: bt, bowl: wt, batName: FACE_NAMES[bt], bowlName: FACE_NAMES[wt] };
    this.emit({ type: 'locked', locked: this.locked });
  }
  newRoll(only) { this.mode = 'waitRoll'; this.rolled = { bat: only === 'bowl', bowl: only === 'bat' }; this.locked = null; this.readers.bat.reset(); this.readers.bowl.reset(); }
  readNow() { this.mode = 'reading'; this.locked = null; this.pitch = null; this.previewPitch = null; this.readers.bat.reset(); this.readers.bowl.reset();
    this.cubes = { bat: null, bowl: null }; this.yHist = []; this.tableY = null; this.emit({ type: 'reading' }); }

  // ---------- pitch mesh ----------
  buildMesh(F) {
    const g = geometry(F), v = [];
    const tri = (a, b, c, col) => { for (const p of [a, b, c]) v.push(p[0], p[1], p[2], ...col); };
    const quad = (q, col) => { tri(q[0], q[1], q[2], col); tri(q[0], q[2], q[3], col); };
    const lift = (p, k) => add(p, mul(F.up, k));
    quad(g.quad, [0.87, 0.77, 0.50, this.pitch ? 0.95 : 0.55]);                 // pitch (lighter while still reading)
    const bw = 0.0025;
    for (const [a, b] of g.creases) quad([lift(add(a, mul(F.fwd, -bw)), 0.0005), lift(add(b, mul(F.fwd, -bw)), 0.0005), lift(add(b, mul(F.fwd, bw)), 0.0005), lift(add(a, mul(F.fwd, bw)), 0.0005)], [1, 1, 1, 1]);
    const sw = 0.0022;
    for (const [a, b] of g.stumps.slice(this.hideBatStumps ? 3 : 0)) {         // two crossed thin quads per stump (batsman's stumps can be hidden while they fly)
      quad([add(a, mul(F.side, -sw)), add(a, mul(F.side, sw)), add(b, mul(F.side, sw)), add(b, mul(F.side, -sw))], [0.97, 0.77, 0.12, 1]);
      quad([add(a, mul(F.fwd, -sw)), add(a, mul(F.fwd, sw)), add(b, mul(F.fwd, sw)), add(b, mul(F.fwd, -sw))], [0.97, 0.77, 0.12, 1]);
    }
    if (this.pitch && this.scene) { try { this.scene(F, { tri, quad, v }); } catch (e) { this.emit({ type: 'error', message: 'scene: ' + e.message }); } }
    const gl = this.gl; gl.bindBuffer(gl.ARRAY_BUFFER, this.meshBuf); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(v), gl.DYNAMIC_DRAW);
    this.meshCount = v.length / 7;
  }
  drawMesh(Pm, Vm) {
    const gl = this.gl, p = this.meshProg; gl.useProgram(p);
    gl.uniformMatrix4fv(gl.getUniformLocation(p, 'P'), false, Pm); gl.uniformMatrix4fv(gl.getUniformLocation(p, 'V'), false, Vm);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.meshBuf);
    const lp = gl.getAttribLocation(p, 'p'), lc = gl.getAttribLocation(p, 'c');
    gl.enableVertexAttribArray(lp); gl.vertexAttribPointer(lp, 3, gl.FLOAT, false, 28, 0);
    gl.enableVertexAttribArray(lc); gl.vertexAttribPointer(lc, 4, gl.FLOAT, false, 28, 12);
    gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); gl.disable(gl.CULL_FACE); gl.enable(gl.DEPTH_TEST);
    gl.drawArrays(gl.TRIANGLES, 0, this.meshCount);
    gl.disableVertexAttribArray(lp); gl.disableVertexAttribArray(lc);
  }
}
