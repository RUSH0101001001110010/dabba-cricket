// Runs the stamp detector off the main thread so the camera view stays smooth.
// Accepts either an ImageBitmap (camera page) or raw RGBA pixels (WebXR page, rows bottom-up).
import { detectMarkers, pose } from './aruco4.js?v=7';
let cvs = null, cx = null;
self.onmessage = (e) => {
  const D = e.data, w = D.w, h = D.h, g = new Uint8Array(w * h);
  const t0 = performance.now();
  if (D.bitmap) {
    if (!cvs || cvs.width !== w || cvs.height !== h) { cvs = new OffscreenCanvas(w, h); cx = cvs.getContext('2d', { willReadFrequently: true }); }
    cx.drawImage(D.bitmap, 0, 0, w, h); D.bitmap.close();
    const d = cx.getImageData(0, 0, w, h).data;
    for (let i = 0, j = 0; i < g.length; i++, j += 4) g[i] = (d[j] * 77 + d[j + 1] * 150 + d[j + 2] * 29) >> 8;
  } else {
    const d = new Uint8Array(D.rgba);
    for (let y = 0; y < h; y++) { const src = (h - 1 - y) * w * 4, dst = y * w;          // flip: GL rows are bottom-up
      for (let x = 0, j = src; x < w; x++, j += 4) g[dst + x] = (d[j] * 77 + d[j + 1] * 150 + d[j + 2] * 29) >> 8; }
  }
  const f = D.f, pcx = D.cx ?? w / 2, pcy = D.cy ?? h / 2;
  const markers = detectMarkers(g, w, h).map(m => {
    const p = pose(m.corners, D.size, f, pcx, pcy);
    return { id: m.id, corners: m.corners, area: m.area, R: p ? p.R : null, normal: p ? p.normal : [0, 0, -1], t: p ? p.t : [0, 0, 1] };
  }).filter(m => m.R);
  self.postMessage({ id: D.id, markers, ms: performance.now() - t0, w, h });
};
