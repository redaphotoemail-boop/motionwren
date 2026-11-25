#!/usr/bin/env python3
"""The line guard: checks that a scene made by a video engine keeps the photo's straight lines.

Reda's rule (Nov 25, 2026): window frames, door frames, walls and ceiling lines must never
shift, wobble or bend in a film. A camera push-in on a still photograph moves every point of
the picture by one simple transform (a zoom plus a tiny drift), so every straight line of the
photo stays straight and stays where that transform puts it. Anything else is the engine
redrawing the room.

How it checks, with OpenCV only (free, a few seconds per scene):
1. The photo's long straight lines are found (window mullions, frames, walls, ceilings).
2. The clip is sampled a few times a second. For each frame, the transform from the photo to
   the frame is measured from matching details (ORB features + RANSAC homography).
3. Each long line is carried through that transform and looked for in the frame: along the
   line, the strongest edge across it must sit where the transform says. How far it sits off
   (shift) and how much that varies along the line (bend) are measured in pixels.
4. A line that is off by more than SHIFT_PX, or bent by more than BEND_PX, in two samples in a
   row, has moved. A frame that cannot be matched to the photo at all is a frame that shows
   something else.
5. The photo's outline is carried into each frame too: the frame must stay inside the photo
   (COVER_MIN of it), so nothing beyond the photo's edges is ever shown (invented).
The scene fails when any of the photo's long straight lines moves, bends or wobbles, when the
frame leaves the photo, or when too many frames don't match the photo.

Two strictness levels, by the scene's camera move:
- "push" (and a pull made by playing a push backwards): lines may not move at all.
- "arc" (a gentle orbit or slide combined with a push-in): near and far lines may drift apart a
  little, smoothly, as they do through a real camera; they may never bend, wobble or jump.

usage: lines.py clip.mp4 photo.jpg [push|arc]
Prints {"held": bool, "reason": "...", ...numbers...} as JSON.
"""
import json
import math
import sys

import cv2
import numpy as np

WORK_WIDTH = 960           # every check is made at this width
SAMPLES_PER_SECOND = 8
MIN_LINE_SHARE = 0.07      # a line counts when it is at least 7% of the photo's diagonal
MAX_LINES = 60
SHIFT_PX = 2.5             # at 960 wide: about 0.26% of the frame (5 pixels of a 1080p film)
BEND_PX = 1.6
WOBBLE_RMS_PX = 1.0        # a line's path may not stray from a smooth curve by more than this (any move)
MAX_UNMATCHED_SHARE = 0.25
SEARCH_PX = 7              # how far across a line its edge is looked for
POINTS_PER_LINE = 24
START_SKIP_S = 0.15        # the first frames are the photo itself; nothing to learn there
COVER_MIN = 0.97           # share of each frame that must come from inside the photo
ARC_DRIFT_PX = 9.0         # arc: how far a line may drift (smoothly) from the photo's transform


def work_size(image):
    h, w = image.shape[:2]
    scale = WORK_WIDTH / float(w)
    return cv2.resize(image, (WORK_WIDTH, max(16, int(round(h * scale)))), interpolation=cv2.INTER_AREA)


def gray(image):
    return cv2.cvtColor(image, cv2.COLOR_BGR2GRAY) if image.ndim == 3 else image


def long_lines(photo_gray):
    """The photo's long straight lines as (x1, y1, x2, y2), longest first."""
    h, w = photo_gray.shape
    diag = math.hypot(w, h)
    detector = cv2.createLineSegmentDetector(cv2.LSD_REFINE_STD)
    found = detector.detect(cv2.GaussianBlur(photo_gray, (3, 3), 0))[0]
    if found is None:
        return []
    lines = []
    for x1, y1, x2, y2 in found.reshape(-1, 4):
        length = math.hypot(x2 - x1, y2 - y1)
        if length >= MIN_LINE_SHARE * diag:
            lines.append((float(x1), float(y1), float(x2), float(y2), length))
    lines.sort(key=lambda line: -line[4])
    # Drop near-duplicates (LSD often returns both sides of a thin frame): keep the longer one.
    kept = []
    for line in lines:
        mx, my = (line[0] + line[2]) / 2, (line[1] + line[3]) / 2
        angle = math.atan2(line[3] - line[1], line[2] - line[0]) % math.pi
        duplicate = False
        for other in kept:
            ox, oy = (other[0] + other[2]) / 2, (other[1] + other[3]) / 2
            other_angle = math.atan2(other[3] - other[1], other[2] - other[0]) % math.pi
            turn = min(abs(angle - other_angle), math.pi - abs(angle - other_angle))
            if turn < 0.05 and math.hypot(mx - ox, my - oy) < 6:
                duplicate = True
                break
        if not duplicate:
            kept.append(line)
        if len(kept) >= MAX_LINES:
            break
    return kept


def edge_strength(frame_gray):
    blurred = cv2.GaussianBlur(frame_gray, (3, 3), 0).astype(np.float32)
    return cv2.Sobel(blurred, cv2.CV_32F, 1, 0, ksize=3), cv2.Sobel(blurred, cv2.CV_32F, 0, 1, ksize=3)


def edge_floor(gx, gy):
    """How strong an edge must be to count in this frame (twice its typical texture), measured once per frame."""
    return max(12.0, float(np.median(np.abs(gx[::2, ::2])) + np.median(np.abs(gy[::2, ::2]))) * 2.0)


def line_points(line):
    x1, y1, x2, y2, length = line
    t = np.linspace(0.06, 0.94, POINTS_PER_LINE, dtype=np.float32)
    points = np.stack([x1 + (x2 - x1) * t, y1 + (y2 - y1) * t], axis=1)
    return points


def matcher_for(photo_gray):
    orb = cv2.ORB_create(nfeatures=3000, scaleFactor=1.2, nlevels=8, fastThreshold=12)
    keys, desc = orb.detectAndCompute(photo_gray, None)
    return orb, keys, desc


def homography(orb, photo_keys, photo_desc, frame_gray):
    """Photo → frame, or None when the frame can't be matched to the photo."""
    if photo_desc is None or len(photo_keys) < 40:
        return None, 0
    keys, desc = orb.detectAndCompute(frame_gray, None)
    if desc is None or len(keys) < 40:
        return None, 0
    pairs = cv2.BFMatcher(cv2.NORM_HAMMING).knnMatch(photo_desc, desc, k=2)
    good = [m for m, n in (p for p in pairs if len(p) == 2) if m.distance < 0.78 * n.distance]
    if len(good) < 30:
        return None, len(good)
    src = np.float32([photo_keys[m.queryIdx].pt for m in good]).reshape(-1, 1, 2)
    dst = np.float32([keys[m.trainIdx].pt for m in good]).reshape(-1, 1, 2)
    H, mask = cv2.findHomography(src, dst, cv2.RANSAC, 2.0, maxIters=4000, confidence=0.995)
    inliers = int(mask.sum()) if mask is not None else 0
    if H is None or inliers < 25:
        return None, inliers
    return H, inliers


def measure_line(points, H, gx, gy, width, height, search=SEARCH_PX, polarity=0, reference=0.0, floor=None):
    """Where the line's edge sits across the line, against where the photo's transform puts it.
    Returns (shift_px, bend_px) or None when too little of the line is in the frame."""
    mapped = cv2.perspectiveTransform(points.reshape(-1, 1, 2), H).reshape(-1, 2)
    direction = mapped[-1] - mapped[0]
    norm = float(np.hypot(*direction))
    if norm < 8:
        return None
    nx, ny = -direction[1] / norm, direction[0] / norm
    offsets = np.arange(-search, search + 1, dtype=np.float32)
    xs = mapped[:, 0:1] + offsets[None, :] * nx
    ys = mapped[:, 1:2] + offsets[None, :] * ny
    inside = (xs.min(axis=1) > 2) & (xs.max(axis=1) < width - 3) & (ys.min(axis=1) > 2) & (ys.max(axis=1) < height - 3)
    if inside.sum() < POINTS_PER_LINE // 3:
        return None
    xs, ys = xs[inside], ys[inside]
    sx = cv2.remap(gx, xs, ys, cv2.INTER_LINEAR)
    sy = cv2.remap(gy, xs, ys, cv2.INTER_LINEAR)
    signed = sx * nx + sy * ny  # only edges that run along the line count
    # A line has a dark side and a light side; a thin frame has two lines of opposite sides. Only an
    # edge facing the same way as in the photo is the same line.
    across = np.maximum(signed * polarity, 0) if polarity else np.abs(signed)
    strength = across.max(axis=1)
    # The edge nearest to where it should be, among those about as strong as the line is in the photo
    # (not simply the strongest: a bright window next to a dark frame would always win).
    bar = (0.4 * reference) if reference else (0.6 * strength[:, None])
    near = np.where(across >= bar, -np.abs(offsets)[None, :], -1e9)
    peak = near.argmax(axis=1)
    strength = np.where(near.max(axis=1) > -1e9, across[np.arange(len(across)), peak], 0)
    if floor is None:
        floor = edge_floor(gx, gy)
    strong = strength > floor
    if polarity == 0:
        at_line = signed[:, len(offsets) // 2]
        return (float(np.sign(np.median(at_line))) or 1.0, float(np.median(np.abs(at_line))))
    if strong.sum() < POINTS_PER_LINE // 4:
        # The line is gone from where it should be: treat as moved by the whole search width.
        return float(search), 0.0
    # Sub-pixel: the top of the edge between the samples on either side of the peak.
    rows = np.arange(len(across))
    left = across[rows, np.clip(peak - 1, 0, len(offsets) - 1)]
    mid = across[rows, peak]
    right = across[rows, np.clip(peak + 1, 0, len(offsets) - 1)]
    curve = left - 2 * mid + right
    nudge = np.where((peak > 0) & (peak < len(offsets) - 1) & (curve < 0), 0.5 * (left - right) / np.where(curve < 0, curve, -1), 0)
    found = (offsets[peak] + np.clip(nudge, -0.5, 0.5))[strong]
    shift = float(np.median(found))  # signed: which side of where it should be
    bend = float(np.median(np.abs(found - np.median(found))))
    return shift, bend


def covered(H, photo_w, photo_h, frame_w, frame_h):
    """How much of the frame shows the inside of the photo (1.0 = all of it)."""
    corners = np.float32([[0, 0], [photo_w, 0], [photo_w, photo_h], [0, photo_h]]).reshape(-1, 1, 2)
    outline = cv2.perspectiveTransform(corners, H).reshape(-1, 2)
    frame = np.float32([[0, 0], [frame_w, 0], [frame_w, frame_h], [0, frame_h]])
    try:
        area, _ = cv2.intersectConvexConvex(outline.astype(np.float32), frame)
    except cv2.error:
        return 0.0
    return float(area) / float(frame_w * frame_h)


def smooth_wobble(times, shifts):
    """How far a line's path strays from a smooth (quadratic) curve: (rms, largest single stray)."""
    if len(shifts) < 5:
        return 0.0, 0.0
    t = np.asarray(times, dtype=np.float64)
    s = np.asarray(shifts, dtype=np.float64)
    fit = np.polyval(np.polyfit(t, s, 2), t)
    stray = s - fit
    return float(np.sqrt(np.mean(stray ** 2))), float(np.max(np.abs(np.diff(stray)))) if len(stray) > 1 else 0.0


def check(clip_path, photo_path, mode="push"):
    arc = mode == "arc"
    photo = cv2.imread(photo_path, cv2.IMREAD_COLOR)
    if photo is None:
        raise ValueError("The photo could not be read.")
    photo_gray = gray(work_size(photo))
    lines = long_lines(photo_gray)
    if len(lines) < 2:
        return {"held": True, "reason": "The photo has no long straight lines to guard.", "lines": len(lines)}
    orb, photo_keys, photo_desc = matcher_for(photo_gray)
    points = [line_points(line) for line in lines]
    # Which way each line's edge faces in the photo itself.
    pgx, pgy = edge_strength(photo_gray)
    identity = np.eye(3, dtype=np.float64)
    facing = [measure_line(p, identity, pgx, pgy, photo_gray.shape[1], photo_gray.shape[0], 1, 0) for p in points]
    polarity = [value[0] if isinstance(value, tuple) else 1.0 for value in facing]
    reference = [value[1] if isinstance(value, tuple) else 0.0 for value in facing]
    total_length = sum(line[4] for line in lines)

    video = cv2.VideoCapture(clip_path)
    if not video.isOpened():
        raise ValueError("The clip could not be read.")
    fps = video.get(cv2.CAP_PROP_FPS) or 24.0
    step = max(1, int(round(fps / SAMPLES_PER_SECOND)))
    frame_index = -1
    samples = 0
    unmatched = 0
    streak = [0] * len(lines)
    moved = [False] * len(lines)
    worst = {"shift": 0.0, "bend": 0.0, "line": None, "at": None}
    paths = [([], []) for _ in lines]  # arc: each line's (time, shift) path
    low_cover = 0
    cover_streak = 0
    least_cover = 1.0
    ph, pw = photo_gray.shape
    while True:
        ok, frame = video.read()
        if not ok:
            break
        frame_index += 1
        if frame_index % step or frame_index / fps < START_SKIP_S:
            continue
        samples += 1
        frame_gray = gray(work_size(frame))
        H, _ = homography(orb, photo_keys, photo_desc, frame_gray)
        if H is None:
            unmatched += 1
            streak = [0] * len(lines)
            continue
        gx, gy = edge_strength(frame_gray)
        floor = edge_floor(gx, gy)
        fh, fw = frame_gray.shape
        share = covered(H, pw, ph, fw, fh)
        least_cover = min(least_cover, share)
        cover_streak = cover_streak + 1 if share < COVER_MIN else 0
        if cover_streak >= 2:
            low_cover += 1
        for index, line_pts in enumerate(points):
            result = measure_line(line_pts, H, gx, gy, fw, fh, int(ARC_DRIFT_PX) + 3 if arc else SEARCH_PX, polarity[index], reference[index], floor)
            if result is None:
                streak[index] = 0
                continue
            shift, bend = result
            paths[index][0].append(frame_index / fps)
            paths[index][1].append(shift)
            off = bend > BEND_PX or (abs(shift) > (ARC_DRIFT_PX if arc else SHIFT_PX))
            shift = abs(shift)
            streak[index] = streak[index] + 1 if off else 0
            if streak[index] >= 2:
                moved[index] = True
            if shift + bend > worst["shift"] + worst["bend"] and off:
                worst = {"shift": round(shift, 2), "bend": round(bend, 2), "line": index, "at": round(frame_index / fps, 2)}
    video.release()
    if samples < 3:
        raise ValueError("The clip is too short to check.")
    wobbly = []
    for index, (times, shifts) in enumerate(paths):
        rms, _ = smooth_wobble(times, shifts)
        if rms > WOBBLE_RMS_PX:  # shifting back and forth: the engine redrawing the line
            moved[index] = True
            wobbly.append(index)
    moved_length = sum(line[4] for line, gone in zip(lines, moved) if gone)
    # Reda's rule is "never": any long straight line that moves, bends or wobbles fails the scene.
    key_moved = [index for index in range(len(lines)) if moved[index]]
    unmatched_share = unmatched / samples
    out = {
        "lines": len(lines),
        "samples": samples,
        "unmatched": unmatched,
        "moved": sum(moved),
        "movedShare": round(moved_length / total_length, 3) if total_length else 0,
        "keyMoved": key_moved,
        "worst": worst,
        "mode": "arc" if arc else "push",
        "leastCover": round(least_cover, 3),
        "wobbly": len(wobbly),
    }
    if unmatched_share > MAX_UNMATCHED_SHARE:
        return {**out, "held": False, "reason": f"{unmatched} of {samples} moments don't match the photo."}
    if low_cover:
        return {**out, "held": False, "reason": f"The camera showed space beyond the photo's edges (only {round(least_cover * 100)}% of the frame came from the photo)."}
    if key_moved:
        detail = f" (worst {worst['shift']} px off, {worst['bend']} px bent, at {worst['at']} s)" if worst["line"] is not None else " (shifting back and forth)"
        return {**out, "held": False, "reason": f"{len(key_moved)} of the photo's straight lines moved, bent or wobbled{detail}."}
    return {**out, "held": True, "reason": "Every main straight line held."}


def main(argv):
    if len(argv) not in (2, 3):
        print(json.dumps({"error": "usage: lines.py clip.mp4 photo.jpg [push|arc]"}))
        return 2
    try:
        print(json.dumps(check(argv[0], argv[1], argv[2] if len(argv) == 3 else "push")))
        return 0
    except Exception as error:  # the caller decides what an unreadable clip means
        print(json.dumps({"error": str(error)[:300]}))
        return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
