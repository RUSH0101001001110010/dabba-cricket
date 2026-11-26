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
    const w = Math.sqrt(m.area || 1);                       // bigger (closer, flatter) markers count more
    acc = acc.map((v, i) => v + u[i] * w);
  }
  const n = Math.hypot(...acc) || 1; acc = acc.map(v => v / n);
  let best = -1, bs = -2;
  NET.forEach((f, j) => { const s = dot(f.n, acc); if (s > bs) { bs = s; best = j; } });
  return { face: base + best, score: bs, votes: markers.length };
}
