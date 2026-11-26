// Runs the stamp detector off the main thread so the camera view stays smooth.
import { detectMarkers, pose } from './aruco4.js?v=5';
let cvs = null, cx = null;
self.onmessage = (e) => {
  const { bitmap, w, h, f, size, id } = e.data;
  if (!cvs || cvs.width !== w || cvs.height !== h) { cvs = new OffscreenCanvas(w, h); cx = cvs.getContext('2d', { willReadFrequently: true }); }
  cx.drawImage(bitmap, 0, 0, w, h); bitmap.close();
  const t0 = performance.now();
  const d = cx.getImageData(0, 0, w, h).data, g = new Uint8Array(w * h);
  for (let i = 0, j = 0; i < g.length; i++, j += 4) g[i] = (d[j] * 77 + d[j + 1] * 150 + d[j + 2] * 29) >> 8;
  const markers = detectMarkers(g, w, h).map(m => {
    const p = pose(m.corners, size, f, w / 2, h / 2);
    return { id: m.id, corners: m.corners, area: m.area, R: p ? p.R : null, normal: p ? p.normal : [0, 0, -1], t: p ? p.t : [0, 0, 1] };
  }).filter(m => m.R);
  self.postMessage({ id, markers, ms: performance.now() - t0, w, h });
};
