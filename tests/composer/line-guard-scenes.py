"""Synthetic scenes for the line guard test (tests/composer/line-guard.test.mjs): a glass room with black mullions over a textured valley. usage: line-guard-scenes.py OUT_DIR"""
import sys, subprocess, cv2, numpy as np
out = sys.argv[1]
rng = np.random.default_rng(7)
W, H = 1920, 1080
# valley: smooth noise texture at several scales
tex = np.zeros((H, W), np.float32)
for s in (8, 32, 128):
    n = rng.random((H // s + 2, W // s + 2)).astype(np.float32)
    tex += cv2.resize(n, (W + 2 * s, H + 2 * s), interpolation=cv2.INTER_CUBIC)[s:s + H, s:s + W] / 3
img = np.dstack([tex * 90 + 40, tex * 140 + 50, tex * 80 + 30]).astype(np.uint8)
img[:300] = (235, 225, 215)                       # sky
img[:120] = (60, 50, 45)                          # ceiling
cv2.rectangle(img, (0, 780), (W, H), (120, 140, 160), -1)  # floor
for x in (420, 880, 1300, 1650):                  # black mullions
    cv2.rectangle(img, (x, 120), (x + 18, 780), (20, 20, 20), -1)
cv2.line(img, (0, 120), (W, 120), (15, 15, 15), 6)
cv2.line(img, (0, 780), (W, 780), (30, 30, 30), 5)
cv2.rectangle(img, (600, 650), (1500, 1000), (90, 110, 150), -1)  # island
cv2.line(img, (600, 650), (1500, 650), (200, 210, 220), 4)
img = cv2.GaussianBlur(img, (3, 3), 0)
cv2.imwrite(f"{out}/photo.jpg", img, [cv2.IMWRITE_JPEG_QUALITY, 92])

def render(name, fn, seconds=5, fps=24):
    raw = f"{out}/{name}.avi"
    vw = cv2.VideoWriter(raw, cv2.VideoWriter_fourcc(*"MJPG"), fps, (1280, 720))
    n = seconds * fps
    for i in range(n):
        vw.write(cv2.resize(fn(i / (n - 1)), (1280, 720), interpolation=cv2.INTER_AREA))
    vw.release()
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", raw, "-c:v", "libx264", "-crf", "23", "-pix_fmt", "yuv420p", f"{out}/{name}.mp4"], check=True)

def zoom(t, z0=1.0, z1=1.12, cx=W / 2, cy=H / 2, src=img):
    z = z0 + (z1 - z0) * (0.5 - 0.5 * np.cos(np.pi * t))
    M = np.float32([[z, 0, (1 - z) * cx], [0, z, (1 - z) * cy]])
    return cv2.warpAffine(src, M, (W, H), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT)

render("push_ok", lambda t: zoom(t))
render("pull_reversed_ok", lambda t: zoom(1 - t))

def wobble(t):
    f = zoom(t)
    # the mullion at x≈1300 shifts left and right by a few pixels mid-shot (what Reda saw)
    dx = 7 * np.sin(2 * np.pi * 2.5 * t) * np.sin(np.pi * t)
    band = f[:, 1100:1560].copy()
    M = np.float32([[1, 0, dx], [0, 1, 0]])
    f[:, 1100:1560] = cv2.warpAffine(band, M, (band.shape[1], band.shape[0]), borderMode=cv2.BORDER_REFLECT)
    return f
render("push_wobble", wobble)

def bend(t):
    f = zoom(t)
    ys, xs = np.mgrid[0:H, 0:W].astype(np.float32)
    amp = 9 * np.sin(np.pi * t)
    mapx = xs + amp * np.sin(ys / H * np.pi * 2) * np.exp(-((xs - 900) / 220) ** 2)
    return cv2.remap(f, mapx.astype(np.float32), ys, cv2.INTER_LINEAR)
render("push_bend", bend)

render("pull_beyond", lambda t: zoom(t, 1.0, 0.85))  # pulls back past the photo's edges

def arc(t, wob=False):
    # a push-in with a small sideways arc: near (floor, island) moves more than far (valley, mullions)
    f = zoom(t, 1.0, 1.1)
    ys, xs = np.mgrid[0:H, 0:W].astype(np.float32)
    depth_near = np.clip((ys - 600) / 480, 0, 1)  # lower part is nearer
    shift = 14 * (0.5 - 0.5 * np.cos(np.pi * t)) * depth_near
    if wob:
        shift = shift + 6 * np.sin(2 * np.pi * 3 * t) * np.exp(-((xs - 1300) / 60) ** 2) * (ys > 120)
    return cv2.remap(f, (xs + shift).astype(np.float32), ys, cv2.INTER_LINEAR)
render("arc_ok", lambda t: arc(t))
render("arc_wobble", lambda t: arc(t, True))
