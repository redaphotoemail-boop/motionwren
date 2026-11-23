#!/usr/bin/env python3
"""Reads each photo with OpenCV and prints numbers about it, as JSON.

Used by composer/server.mjs (POST /movements). It only measures; the choice of
camera movement is made from these numbers in app/api/_lib/movement-plan.ts.

usage: movement.py [--thumbs DIR] image [image ...]
Prints {"photos": [ {...numbers...} | {"error": "..."} ]} in the order given.
With --thumbs, also writes DIR/<n>.jpg: a 768-pixel copy for the AI reader.
"""
import json
import math
import sys

import cv2
import numpy as np

WORK_WIDTH = 640


def clamp(value, low=0.0, high=1.0):
    return float(max(low, min(high, value)))


def vanishing(lines, width, height):
    """Where the slanted lines of the picture meet (as fractions of the frame),
    and how many of them agree. Floors, ceilings, walls and roads that run away
    from the camera all point at one place; a flat wall has no such place."""
    slanted = []
    for x1, y1, x2, y2 in lines:
        angle = abs(math.degrees(math.atan2(y2 - y1, x2 - x1))) % 180
        angle = min(angle, 180 - angle)  # 0 = level, 90 = upright
        length = math.hypot(x2 - x1, y2 - y1)
        if 8 <= angle <= 82 and length >= width * 0.08:
            slanted.append((length, (x1, y1, x2, y2)))
    slanted.sort(reverse=True)
    slanted = [segment for _, segment in slanted[:70]]
    if len(slanted) < 6:
        return None, 0.0, len(slanted)
    points = []
    for i in range(len(slanted)):
        x1, y1, x2, y2 = slanted[i]
        a1, b1 = y2 - y1, x1 - x2
        c1 = a1 * x1 + b1 * y1
        for j in range(i + 1, len(slanted)):
            x3, y3, x4, y4 = slanted[j]
            a2, b2 = y4 - y3, x3 - x4
            c2 = a2 * x3 + b2 * y3
            det = a1 * b2 - a2 * b1
            if abs(det) < 1e-6:
                continue
            px = (c1 * b2 - c2 * b1) / det
            py = (a1 * c2 - a2 * c1) / det
            # Only places near the frame count: far away they are just noise.
            if -0.6 * width <= px <= 1.6 * width and -0.6 * height <= py <= 1.6 * height:
                points.append((px / width, py / height))
    if len(points) < 6:
        return None, 0.0, len(slanted)
    grid = np.zeros((16, 16), dtype=np.int32)
    for px, py in points:
        gx = min(15, max(0, int((px + 0.6) / 2.2 * 16)))
        gy = min(15, max(0, int((py + 0.6) / 2.2 * 16)))
        grid[gy, gx] += 1
    gy, gx = np.unravel_index(int(np.argmax(grid)), grid.shape)
    near = [(px, py) for px, py in points if abs((px + 0.6) / 2.2 * 16 - (gx + 0.5)) <= 1.5 and abs((py + 0.6) / 2.2 * 16 - (gy + 0.5)) <= 1.5]
    if not near:
        return None, 0.0, len(slanted)
    vx = float(np.median([p[0] for p in near]))
    vy = float(np.median([p[1] for p in near]))
    share = len(near) / len(points)  # how many line pairs point at this place
    strength = clamp(share * 1.6) * clamp(len(slanted) / 24.0)
    return (vx, vy), strength, len(slanted)


def measure(path, thumbs_dir, index):
    image = cv2.imread(path, cv2.IMREAD_COLOR)
    if image is None:
        return {"error": "The photo could not be opened."}
    full_h, full_w = image.shape[:2]
    if thumbs_dir:
        scale = 768.0 / max(full_w, full_h)
        small = image if scale >= 1 else cv2.resize(image, (int(full_w * scale), int(full_h * scale)), interpolation=cv2.INTER_AREA)
        cv2.imwrite(f"{thumbs_dir}/{index}.jpg", small, [cv2.IMWRITE_JPEG_QUALITY, 82])
    scale = WORK_WIDTH / float(full_w)
    if scale < 1:
        image = cv2.resize(image, (WORK_WIDTH, max(1, int(full_h * scale))), interpolation=cv2.INTER_AREA)
    height, width = image.shape[:2]
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    hsv = cv2.cvtColor(image, cv2.COLOR_BGR2HSV)
    blurred = cv2.GaussianBlur(gray, (5, 5), 0)
    median = float(np.median(blurred))
    edges = cv2.Canny(blurred, max(20, 0.66 * median), min(250, 1.33 * median + 20))

    lines = cv2.HoughLinesP(edges, 1, np.pi / 180, threshold=60, minLineLength=int(width * 0.08), maxLineGap=int(width * 0.015))
    segments = [tuple(int(v) for v in row) for row in np.asarray(lines).reshape(-1, 4)] if lines is not None else []
    point, convergence, slanted = vanishing(segments, width, height)

    level = upright = 0
    tilts = []
    for x1, y1, x2, y2 in segments:
        angle = math.degrees(math.atan2(y2 - y1, x2 - x1))
        folded = ((angle + 90) % 180) - 90  # -90..90, 0 = level
        if abs(folded) <= 8:
            level += 1
            tilts.append(folded)
        elif abs(folded) >= 82:
            upright += 1
    total_lines = max(1, len(segments))

    edge_density = float(np.count_nonzero(edges)) / edges.size
    top = slice(0, int(height * 0.35))
    sky_mask = ((hsv[:, :, 0] >= 85) & (hsv[:, :, 0] <= 130) & (hsv[:, :, 1] >= 35) & (hsv[:, :, 2] >= 110))
    # Blue sky only: a white ceiling is just as bright and flat, and must not read as outdoors.
    sky_ratio = float(np.mean(sky_mask[top]))
    green_ratio = float(np.mean((hsv[:, :, 0] >= 35) & (hsv[:, :, 0] <= 85) & (hsv[:, :, 1] >= 50) & (hsv[:, :, 2] >= 40)))

    # Is there one thing in the middle of the picture? Detail and colour there against the rest.
    detail = cv2.GaussianBlur(np.abs(cv2.Laplacian(gray, cv2.CV_32F)), (0, 0), 6) + 0.5 * cv2.GaussianBlur(hsv[:, :, 1].astype(np.float32), (0, 0), 6) * 0.1
    cy0, cy1, cx0, cx1 = int(height * 0.3), int(height * 0.7), int(width * 0.3), int(width * 0.7)
    centre = float(np.mean(detail[cy0:cy1, cx0:cx1]))
    overall = float(np.mean(detail)) + 1e-6
    centre_weight = clamp((centre / overall - 1.0) / 1.0)

    # An open floor or path: a calm lower third.
    low = edges[int(height * 0.62):, :]
    floor_open = clamp(1.0 - float(np.count_nonzero(low)) / low.size / 0.12)

    return {
        "width": full_w,
        "height": full_h,
        "aspect": round(full_w / float(full_h), 3),
        "vanishing": {"x": round(point[0], 3), "y": round(point[1], 3)} if point else None,
        "convergence": round(convergence, 3),
        "slantedLines": slanted,
        "levelShare": round(level / total_lines, 3),
        "uprightShare": round(upright / total_lines, 3),
        "horizonTilt": round(float(np.median(tilts)), 2) if tilts else 0.0,
        "edgeDensity": round(edge_density, 4),
        "brightness": round(float(np.mean(gray)) / 255.0, 3),
        "skyRatio": round(sky_ratio, 3),
        "greenRatio": round(green_ratio, 3),
        "centreWeight": round(centre_weight, 3),
        "floorOpen": round(floor_open, 3),
    }


def main(argv):
    thumbs = None
    if len(argv) >= 2 and argv[0] == "--thumbs":
        thumbs, argv = argv[1], argv[2:]
    out = []
    for index, path in enumerate(argv):
        try:
            out.append(measure(path, thumbs, index))
        except Exception as error:  # one bad photo never stops the others
            out.append({"error": str(error)[:200]})
    print(json.dumps({"opencv": cv2.__version__, "photos": out}))


if __name__ == "__main__":
    main(sys.argv[1:])
