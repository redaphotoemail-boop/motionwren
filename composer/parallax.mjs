/* Depth parallax: a real camera move on one photo.

   A depth map (near = bright) tells how far each part of the photo is. A virtual
   camera then moves (push, pull, orbit, rise...) and every pixel is looked up
   where that camera would see it, so near things slide more than far things:
   real parallax, not a slideshow. Nothing is invented or repainted; every output
   pixel is the photo's own pixel, so nothing in the scene can move or change.

   The photo is framed so the move never runs past its edges (the move starts
   a little pushed in, as much as that move needs). No dependencies: ffmpeg
   decodes and encodes, this file does the maths. */

import { spawn } from "node:child_process";

export const DEPTH_MOVES = ["push", "pull", "orbit-left", "orbit-right", "push-rise", "push-left", "push-right", "pull-rise"];

const smoother = (x) => { const t = Math.max(0, Math.min(1, x)); return t * t * t * (t * (t * 6 - 15) + 10); };
/* 0 → 1 between a and b, eased. */
const seg = (t, a, b) => smoother((t - a) / (b - a));

/* The camera at time t (0..1), in units where the nearest thing is 1 away and the farthest ZFAR away.
   tz: forward (+) / back (-), tx: right (+), ty: up (+), yaw: turn right (+) in radians. */
export const ZFAR = 3;
/* A gimbal's tiny, slow wander: it dies away at both ends so the move starts and stops cleanly. */
function wander(t) {
  const w = Math.pow(Math.sin(Math.PI * Math.min(1, Math.max(0, t))), 0.6);
  return { tx: 0.0045 * w * (Math.sin(2 * Math.PI * 1.1 * t + 0.6) + 0.5 * Math.sin(2 * Math.PI * 2.3 * t + 2.0)) / 1.5, ty: 0.0035 * w * Math.sin(2 * Math.PI * 1.7 * t + 1.1), yaw: 0.0025 * w * Math.sin(2 * Math.PI * 0.9 * t + 0.2) };
}
export function cameraAt(move, t) {
  const base = baseCamera(move, t); const h = wander(t);
  return { tx: base.tx + h.tx, ty: base.ty + h.ty, tz: base.tz, yaw: base.yaw + h.yaw };
}
function baseCamera(move, t) {
  const e = smoother(t);
  switch (move) {
    case "push": return { tx: 0, ty: 0, tz: 0.30 * e, yaw: 0 };
    case "pull": return { tx: 0, ty: 0, tz: 0.30 * (1 - e), yaw: 0 };
    // Orbit: slide sideways while turning to keep the room centred.
    case "orbit-right": return { tx: 0.10 * (e - 0.5) * 2 * 0.6, ty: 0, tz: 0, yaw: -0.055 * (e - 0.5) * 2 };
    case "orbit-left": return { tx: -0.10 * (e - 0.5) * 2 * 0.6, ty: 0, tz: 0, yaw: 0.055 * (e - 0.5) * 2 };
    // Push in, then rise.
    case "push-rise": { const a = seg(t, 0, 0.55), b = seg(t, 0.35, 1); return { tx: 0, ty: 0.11 * b, tz: 0.26 * a, yaw: 0 }; }
    // Pull back, then rise.
    case "pull-rise": { const a = seg(t, 0, 0.55), b = seg(t, 0.35, 1); return { tx: 0, ty: 0.11 * b, tz: 0.26 * (1 - a), yaw: 0 }; }
    // Push in, then drift sideways.
    case "push-right": { const a = seg(t, 0, 0.55), b = seg(t, 0.35, 1); return { tx: 0.09 * b, ty: 0, tz: 0.26 * a, yaw: -0.03 * b }; }
    case "push-left": { const a = seg(t, 0, 0.55), b = seg(t, 0.35, 1); return { tx: -0.09 * b, ty: 0, tz: 0.26 * a, yaw: 0.03 * b }; }
    default: throw new Error(`Unknown move ${move}`);
  }
}

/* z of a pixel from its normalised depth d (1 = nearest). */
const zOf = (d) => 1 + (1 - d) * (ZFAR - 1);

/* Where the camera sees a source point (u,v centred, in focal-length-normalised units) for the given depth. */
function project(u, v, z, cam, extraPush) {
  const tz = cam.tz + extraPush;
  const k = 1 - tz / z;
  return [u * k + (cam.tx / z) - cam.yaw, v * k + (cam.ty / z)];
}

/* The least extra push that keeps every output edge point inside the photo for the whole move. */
export function framingPush(move, aspect, samples = 48) {
  const halfW = 0.5, halfH = 0.5 / aspect; // in units of width, focal ≈ 1 width
  const f = 0.9;
  let extra = 0;
  for (let step = 0; step <= samples; step += 1) {
    const cam = cameraAt(move, step / samples);
    for (const z of [1, 1.5, 2, ZFAR]) {
      for (const [cx, cy] of [[halfW, halfH], [-halfW, halfH], [halfW, -halfH], [-halfW, -halfH], [0, halfH], [0, -halfH], [halfW, 0], [-halfW, 0]]) {
        // source = out*(1 - (tz+extra)/z) + tx*f/z - yaw*f... solve for the extra push that brings source inside
        const sx = cx * (1 - cam.tz / z) + cam.tx * f / z - cam.yaw * f;
        const sy = cy * (1 - cam.tz / z) + cam.ty * f / z;
        for (const [s, c, half] of [[sx, cx, halfW], [sy, cy, halfH]]) {
          const over = Math.abs(s) - half * 0.985;
          if (over > 0 && Math.abs(c) > 1e-6) extra = Math.max(extra, over / (Math.abs(c) / z));
        }
      }
    }
  }
  return Math.min(extra * 1.02, 0.55);
}

/* ---------- depth map preparation ---------- */

function boxMin(src, w, h, r, out) {
  const tmp = new Float32Array(w * h);
  for (let y = 0; y < h; y += 1) for (let x = 0; x < w; x += 1) { let m = 1; for (let k = Math.max(0, x - r); k <= Math.min(w - 1, x + r); k += 1) m = Math.min(m, src[y * w + k]); tmp[y * w + x] = m; }
  for (let y = 0; y < h; y += 1) for (let x = 0; x < w; x += 1) { let m = 1; for (let k = Math.max(0, y - r); k <= Math.min(h - 1, y + r); k += 1) m = Math.min(m, tmp[k * w + x]); out[y * w + x] = m; }
}
function blur(src, w, h, r, out) {
  const tmp = new Float32Array(w * h);
  for (let y = 0; y < h; y += 1) { let sum = 0, n = 0; for (let x = 0; x < w + r; x += 1) { if (x < w) { sum += src[y * w + x]; n += 1; } if (x - r - 1 >= 0) { sum -= src[y * w + x - r - 1]; n -= 1; } if (x - r >= 0) tmp[y * w + x - r] = sum / n; } }
  for (let x = 0; x < w; x += 1) { let sum = 0, n = 0; for (let y = 0; y < h + r; y += 1) { if (y < h) { sum += tmp[y * w + x]; n += 1; } if (y - r - 1 >= 0) { sum -= tmp[(y - r - 1) * w + x]; n -= 1; } if (y - r >= 0) out[(y - r) * w + x] = sum / n; } }
}

/* gray8 depth (near bright) → Float32 0..1 (1 near): stretched, edge-safe, smooth. Works at depth-map size. */
export function prepareDepth(gray, w, h) {
  const values = Float32Array.from(gray, (v) => v / 255);
  const sorted = Float32Array.from(values).sort();
  const lo = sorted[Math.floor(sorted.length * 0.02)], hi = sorted[Math.floor(sorted.length * 0.98)];
  const span = Math.max(hi - lo, 0.05);
  const d = values.map((v) => Math.max(0, Math.min(1, (v - lo) / span)));
  // Gentler overall depth: interiors read better with the extremes pulled in a little.
  for (let i = 0; i < d.length; i += 1) d[i] = d[i] * 0.9 + 0.05;
  const r = Math.max(1, Math.round(w / 500));
  const eroded = new Float32Array(w * h); boxMin(d, w, h, r * 2, eroded); // near edges retract a little, so no near smear on far things
  const smooth = new Float32Array(w * h); blur(eroded, w, h, r * 3, smooth); blur(smooth, w, h, r * 3, eroded);
  return eroded;
}

/* ---------- rendering ---------- */

function ffmpegBuffer(args, bytes) {
  return new Promise((resolve, reject) => {
    const child = spawn("ffmpeg", args, { stdio: ["ignore", "pipe", "pipe"] });
    const chunks = []; let err = "";
    child.stdout.on("data", (c) => chunks.push(c)); child.stderr.on("data", (c) => { err += c; if (err.length > 4000) err = err.slice(-4000); });
    child.on("error", reject);
    child.on("close", (code) => { const buffer = Buffer.concat(chunks); if (code !== 0 || buffer.length !== bytes) reject(new Error(`Photo decode failed (${code}, ${buffer.length}/${bytes}): ${err.slice(-300)}`)); else resolve(buffer); });
  });
}

/* Catmull-Rom weights for a fraction. */
function weights(f, out, o) {
  const f2 = f * f, f3 = f2 * f;
  out[o] = -0.5 * f3 + f2 - 0.5 * f; out[o + 1] = 1.5 * f3 - 2.5 * f2 + 1; out[o + 2] = -1.5 * f3 + 2 * f2 + 0.5 * f; out[o + 3] = 0.5 * f3 - 0.5 * f2;
}

/* One frame: for each output pixel, where the moved camera finds it in the photo. The mapping is worked out on a coarse grid
   (it is smooth) and blended across, then the colour is taken with a sharp (bicubic) lookup. */
const STEPS = 20;
export function renderFrame({ photo, sw, sh, depth, dw, dh, cam, extraPush, width, height, out }) {
  const f = 0.9; // focal length in widths
  const grid = 8;
  const gw = Math.ceil(width / grid) + 1, gh = Math.ceil(height / grid) + 1;
  const mapX = new Float32Array(gw * gh), mapY = new Float32Array(gw * gh);
  const aspect = width / height;
  for (let gy = 0; gy < gh; gy += 1) {
    for (let gx = 0; gx < gw; gx += 1) {
      const px = Math.min(width - 1, gx * grid), py = Math.min(height - 1, gy * grid);
      const u = (px / width - 0.5), v = (py / height - 0.5) / aspect;
      // Ray march from the nearest depth to the farthest: the first surface the ray meets is what the camera sees,
      // so whatever is in front correctly covers what is behind it.
      const tz = cam.tz + extraPush;
      let su = u, sv = v, prevDiff = 0, prevZ = 1, prevU = u, prevV = v;
      for (let i = 0; i <= STEPS; i += 1) {
        const z = 1 + (ZFAR - 1) * (i / STEPS);
        const k = 1 - tz / z;
        const cu = u * k + (cam.tx * f) / z - cam.yaw * f, cv = v * k + (cam.ty * f) / z;
        const fx = Math.min(dw - 1, Math.max(0, (cu + 0.5) * (dw - 1))), fy = Math.min(dh - 1, Math.max(0, (cv * aspect + 0.5) * (dh - 1)));
        const x0 = Math.floor(fx), y0 = Math.floor(fy), x1 = Math.min(dw - 1, x0 + 1), y1 = Math.min(dh - 1, y0 + 1), ax = fx - x0, ay = fy - y0;
        const dd = (depth[y0 * dw + x0] * (1 - ax) + depth[y0 * dw + x1] * ax) * (1 - ay) + (depth[y1 * dw + x0] * (1 - ax) + depth[y1 * dw + x1] * ax) * ay;
        const diff = zOf(dd) - z;
        if (diff <= 0 || i === STEPS) {
          const a = i === 0 || prevDiff <= 0 ? 1 : prevDiff / (prevDiff - diff); // where between the two steps the surface is
          su = prevU + (cu - prevU) * a; sv = prevV + (cv - prevV) * a;
          break;
        }
        prevDiff = diff; prevZ = z; prevU = cu; prevV = cv;
      }
      void prevZ;
      mapX[gy * gw + gx] = (su + 0.5) * sw - 0.5;
      mapY[gy * gw + gx] = (sv * aspect + 0.5) * sh - 0.5;
    }
  }
  const wts = new Float32Array(8);
  const stride = sw * 3, maxX = sw - 1, maxY = sh - 1;
  for (let y = 0; y < height; y += 1) {
    const gy = y / grid, gy0 = Math.floor(gy), fy = gy - gy0;
    for (let x = 0; x < width; x += 1) {
      const gx = x / grid, gx0 = Math.floor(gx), fx = gx - gx0;
      const i00 = gy0 * gw + gx0, i10 = i00 + 1, i01 = i00 + gw, i11 = i01 + 1;
      const mx = (mapX[i00] * (1 - fx) + mapX[i10] * fx) * (1 - fy) + (mapX[i01] * (1 - fx) + mapX[i11] * fx) * fy;
      const my = (mapY[i00] * (1 - fx) + mapY[i10] * fx) * (1 - fy) + (mapY[i01] * (1 - fx) + mapY[i11] * fx) * fy;
      const ix = Math.floor(mx), iy = Math.floor(my);
      weights(mx - ix, wts, 0); weights(my - iy, wts, 4);
      let r = 0, g = 0, b = 0;
      if (ix >= 1 && iy >= 1 && ix < maxX - 1 && iy < maxY - 1) {
        let base = (iy - 1) * stride + (ix - 1) * 3;
        for (let j = 0; j < 4; j += 1, base += stride) {
          const wy = wts[4 + j];
          const w0 = wts[0] * wy, w1 = wts[1] * wy, w2 = wts[2] * wy, w3 = wts[3] * wy;
          r += photo[base] * w0 + photo[base + 3] * w1 + photo[base + 6] * w2 + photo[base + 9] * w3;
          g += photo[base + 1] * w0 + photo[base + 4] * w1 + photo[base + 7] * w2 + photo[base + 10] * w3;
          b += photo[base + 2] * w0 + photo[base + 5] * w1 + photo[base + 8] * w2 + photo[base + 11] * w3;
        }
      } else {
        for (let j = 0; j < 4; j += 1) {
          const yy = Math.min(maxY, Math.max(0, iy - 1 + j)) * stride;
          for (let i = 0; i < 4; i += 1) {
            const o = yy + Math.min(maxX, Math.max(0, ix - 1 + i)) * 3; const wgt = wts[i] * wts[4 + j];
            r += photo[o] * wgt; g += photo[o + 1] * wgt; b += photo[o + 2] * wgt;
          }
        }
      }
      const o = (y * width + x) * 3;
      out[o] = r < 0 ? 0 : r > 255 ? 255 : r; out[o + 1] = g < 0 ? 0 : g > 255 ? 255 : g; out[o + 2] = b < 0 ? 0 : b > 255 ? 255 : b;
    }
  }
}

/* Makes the clip: photo + depth map files → an mp4 of the camera move. */
export async function renderParallaxClip({ image, depthImage, move, width, height, fps, seconds, output, crf = 14 }) {
  const aspect = width / height;
  // Source working size: as wide as the output needs for the deepest push (about 1:1), never bigger than the photo gives.
  const extraPush = framingPush(move, aspect);
  const sw = Math.round(Math.min(2560, width * 1.45) / 2) * 2, sh = Math.round(sw / aspect / 2) * 2;
  const photo = await ffmpegBuffer(["-hide_banner", "-loglevel", "error", "-i", image, "-vf", `scale=${sw}:${sh}:force_original_aspect_ratio=increase:flags=lanczos,crop=${sw}:${sh}`, "-f", "rawvideo", "-pix_fmt", "rgb24", "pipe:1"], sw * sh * 3);
  const dw = Math.round(width / 4), dh = Math.round(dw / aspect);
  const grayRaw = await ffmpegBuffer(["-hide_banner", "-loglevel", "error", "-i", depthImage, "-vf", `scale=${dw}:${dh}:force_original_aspect_ratio=increase:flags=bicubic,crop=${dw}:${dh},format=gray`, "-f", "rawvideo", "-pix_fmt", "gray", "pipe:1"], dw * dh);
  const depth = prepareDepth(grayRaw, dw, dh);
  const frames = Math.max(2, Math.ceil(seconds * fps));
  const encoder = spawn("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", `${width}x${height}`, "-r", String(fps), "-i", "pipe:0", "-c:v", "libx264", "-preset", "fast", "-crf", String(crf), "-pix_fmt", "yuv420p", "-an", output], { stdio: ["pipe", "ignore", "pipe"] });
  let err = ""; encoder.stderr.on("data", (c) => { err += c; if (err.length > 4000) err = err.slice(-4000); });
  const done = new Promise((resolve, reject) => { encoder.on("error", reject); encoder.on("close", (code) => code === 0 ? resolve() : reject(new Error(`Encoder failed (${code}): ${err.slice(-300)}`))); });
  const frame = Buffer.alloc(width * height * 3);
  for (let n = 0; n < frames; n += 1) {
    renderFrame({ photo, sw, sh, depth, dw, dh, cam: cameraAt(move, frames > 1 ? n / (frames - 1) : 0), extraPush, width, height, out: frame });
    if (!encoder.stdin.write(Buffer.from(frame))) await new Promise((resolve) => encoder.stdin.once("drain", resolve));
  }
  encoder.stdin.end();
  await done;
}
