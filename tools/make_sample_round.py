"""Write a synthetic review round folder in the irs round format (version 1).

The images are drawn road scenes with box-shaped vehicles, so the folder is
small and has no real footage in it. Pre-labels imitate a detector: most
vehicles get a box with some position noise and a confidence, a few get the
wrong class or are missed, and a few frames carry deliberate problems for
the validation checks.

    python tools/make_sample_round.py                       # samples/round_sample, 12 frames
    python tools/make_sample_round.py --frames 50 --out %TEMP%/round_050

Needs Pillow. See docs/round_format.md for the layout.
"""

import argparse
import json
import random
from pathlib import Path

from PIL import Image, ImageDraw

CLASSES = ["Car", "Pickup Truck", "Van", "2ax Truck", "3ax Truck", "4ax Truck", "5ax+ Truck", "2ax Bus", "3ax Bus"]
# Drawn size in pixels (length, height) and body colour per class.
SHAPES = {
    0: ((70, 32), (200, 40, 40)),
    1: ((84, 38), (60, 90, 160)),
    2: ((80, 46), (230, 230, 230)),
    3: ((110, 56), (240, 170, 30)),
    4: ((140, 60), (120, 120, 120)),
    5: ((170, 62), (90, 140, 70)),
    6: ((200, 64), (150, 60, 140)),
    7: ((150, 60), (250, 210, 40)),
    8: ((190, 62), (40, 160, 170)),
}
REASON_TEXT = {"rare_class": "rare class: {cls}", "uncertainty": "low confidence: {n} boxes between 0.2 and 0.6",
               "disagreement": "track disagreement: class unstable", "random": "random sample"}
W, H = 640, 360
LANES = (205, 245, 290, 330)


def draw_frame(rng, vehicles, frame_no):
    img = Image.new("RGB", (W, H), (135, 170, 200))
    d = ImageDraw.Draw(img)
    d.rectangle([0, 150, W, H], fill=(70, 72, 75))
    d.rectangle([0, 140, W, 150], fill=(90, 130, 70))
    for y in (225, 268, 310):
        for x in range(0, W, 60):
            d.rectangle([x, y, x + 30, y + 3], fill=(220, 220, 200))
    for x in range(30, W, 140):
        d.rectangle([x, 70, x + 8, 150], fill=(60, 50, 40))
        d.ellipse([x - 25, 30, x + 33, 90], fill=(60, 110, 60))
    for v in vehicles:
        x1, y1, x2, y2 = v["box"]
        d.rectangle([x1, y1, x2, y2 - 8], fill=v["colour"], outline=(20, 20, 20))
        d.rectangle([x1 + 6, y1 + 4, x1 + 24, y1 + 16], fill=(170, 200, 220))
        wheel = 9
        for wx in (x1 + 14, x2 - 14) if v["cls"] < 3 else (x1 + 14, (x1 + x2) // 2, x2 - 14):
            d.ellipse([wx - wheel, y2 - 2 * wheel, wx + wheel, y2], fill=(15, 15, 15))
    d.text((8, 8), f"synthetic frame {frame_no}", fill=(255, 255, 255))
    noise = Image.effect_noise((W, H), 12).convert("RGB")
    return Image.blend(img, noise, 0.06)


def place_vehicles(rng, classes):
    out = []
    for cls in classes:
        (length, height), colour = SHAPES[cls]
        for _ in range(30):
            lane = rng.choice(LANES)
            x1 = rng.randint(-10, W - length + 10)
            box = (max(0, x1), lane - height, min(W - 1, x1 + length), lane)
            if all(box[2] < o["box"][0] or box[0] > o["box"][2] or abs(box[3] - o["box"][3]) > 20 for o in out):
                out.append({"cls": cls, "box": box, "colour": colour})
                break
    return out


def yolo(box):
    x1, y1, x2, y2 = box
    return ((x1 + x2) / 2 / W, (y1 + y2) / 2 / H, (x2 - x1) / W, (y2 - y1) / H)


def prelabels(rng, vehicles, special):
    """Return [(cls, xc, yc, w, h, conf)] as a detector would write them."""
    rows = []
    for i, v in enumerate(vehicles):
        if special == "missed" and i == 0:
            continue  # the model missed this vehicle; the reviewer must add it
        cls = v["cls"]
        conf = round(rng.uniform(0.55, 0.97), 2)
        if special == "uncertainty" and i < 2:
            conf = round(rng.uniform(0.26, 0.55), 2)
            cls = min(8, cls + 1)  # unsure and wrong
        x1, y1, x2, y2 = v["box"]
        j = lambda: rng.uniform(-4, 4)  # noqa: E731 - small position noise
        box = (max(0, x1 + j()), max(0, y1 + j()), min(W, x2 + j()), min(H, y2 + j()))
        rows.append((cls, *yolo(box), conf))
    if special == "duplicate" and rows:
        c, xc, yc, w, h, _ = rows[0]
        rows.append((c, xc + 0.001, yc, w, h, 0.31))  # double detection, IoU > 0.95
    if special == "tiny":
        rows.append((0, 0.95, 0.30, 0.0015, 0.002, 0.27))  # a speck the model took for a car
    rows.sort(key=lambda r: -r[5])  # detectors write boxes by descending confidence
    return rows


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--out", default=str(Path(__file__).resolve().parent.parent / "samples" / "round_sample"))
    ap.add_argument("--frames", type=int, default=12)
    ap.add_argument("--round-id", type=int, default=3)
    ap.add_argument("--seed", type=int, default=7)
    args = ap.parse_args()

    rng = random.Random(args.seed)
    out = Path(args.out)
    if out.exists() and any(out.iterdir()):
        raise SystemExit(f"{out} exists and is not empty; remove it first")
    (out / "Images").mkdir(parents=True, exist_ok=True)
    (out / "Labels").mkdir(exist_ok=True)

    specials = ["rare", "uncertainty", "missed", "empty", "duplicate", "tiny"]
    sites = [("clark_ave_01", "a1b2c3d4"), ("clark_ave_01", "e5f60718"), ("hwy7_east", "0badc0de")]
    images, status = {}, []
    frame = 4512
    for n in range(args.frames):
        site, video = sites[n % len(sites)]
        frame += rng.randint(300, 4000)
        name = f"{site}__{video}__f{frame:06d}.jpg"
        special = specials[n] if n < len(specials) else rng.choice(["none"] * 6 + ["missed", "uncertainty"])
        if special == "empty":
            classes = []
        elif special == "rare":
            classes = [8, 0, 0]
        else:
            classes = [rng.choices(range(9), weights=[40, 15, 10, 8, 5, 4, 6, 3, 1])[0] for _ in range(rng.randint(1, 5))]
        vehicles = place_vehicles(rng, classes)
        draw_frame(rng, vehicles, frame).save(out / "Images" / name, quality=80)
        rows = prelabels(rng, vehicles, special)
        (out / "Labels" / (name[:-4] + ".txt")).write_text(
            "".join(f"{c} {x:.6f} {y:.6f} {w:.6f} {h:.6f}\n" for c, x, y, w, h, _ in rows), encoding="utf-8", newline="\n")
        unsure = sum(0.2 <= r[5] <= 0.6 for r in rows)
        reason = ("rare_class" if special == "rare" else "uncertainty" if unsure >= 2 else
                  "random" if special in ("empty", "none") and n % 2 == 0 else "disagreement" if special == "missed" else
                  "uncertainty" if unsure else "random")
        images[name] = {
            "reason": reason,
            "reason_text": REASON_TEXT[reason].format(cls=CLASSES[8], n=unsure),
            "scores": {"rarity": round(0.82 if reason == "rare_class" else rng.uniform(0, 0.3), 2),
                       "uncertainty": round(min(1.0, unsure / 3), 2),
                       "disagreement": 1.0 if reason == "disagreement" else 0.0},
            "prelabel_conf": [r[5] for r in rows],
        }
        status.append({"name": name, "status": "unlabeled"})

    (out / "classes.txt").write_text("".join(c + "\n" for c in CLASSES), encoding="utf-8", newline="\n")
    (out / "image_status.json").write_text(json.dumps(status, indent=2) + "\n", encoding="utf-8", newline="\n")
    rnd = {"format_version": 1, "round_id": args.round_id, "model_id": "m0005", "created": "2026-10-03T20:00:00Z",
           "classes": CLASSES, "images": images}
    (out / "round.json").write_text(json.dumps(rnd, indent=2) + "\n", encoding="utf-8", newline="\n")
    print(f"wrote {args.frames} frames to {out}")


if __name__ == "__main__":
    main()
