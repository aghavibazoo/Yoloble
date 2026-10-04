# Round folder format

Format version: 1

This is the contract between the `irs` pipeline and Yoloble. `irs queue` writes a round folder, Yoloble reviews it in place, and `irs ingest` reads it back. The two share no code; this file is the only interface.

The canonical copy lives in the `irs` repository (`docs/round_format.md`). Yoloble keeps a copy on its `review-station` branch. A change is made here first, `format_version` is raised, and then the copy is updated.

## Layout

```
round_NNN/
  Images/                  required; the frames to review
  Labels/                  YOLO .txt per image, same base name as the image
  classes.txt              one class name per line; line number = class ID
  image_status.json        review status per image
  round.json               round metadata written by irs queue
```

Folder and file names are case-sensitive as shown. Yoloble's folder import requires `Images/` and reads `Labels/`, `classes.txt` and `image_status.json` when present.

## Images

- JPEG, full original resolution, unmasked.
- Name: `<site_id>__<video_id>__f<frame>.jpg`, where `frame` is the zero-based frame index in the source video.
- Yoloble never modifies or writes images.

## Labels

- One `.txt` per image, same base name: `Images/a.jpg` ↔ `Labels/a.txt`.
- One box per line: `<class_id> <x_center> <y_center> <width> <height>`, values normalised to 0–1, space-separated.
- As written by `irs queue`, these are model pre-labels (confidence of at least 0.25). After review they are the human-corrected labels.
- An empty file on an image with status `reviewed` means a confirmed empty frame. An empty or missing file on any other image means nothing.

## classes.txt

- UTF-8, one name per line, no blank lines. Line 1 is class ID 0.
- Written by `irs queue` from the current class list. Yoloble must not reorder it. Ingest rejects a round whose `classes.txt` differs from the class list in `round.json`.

## image_status.json

A JSON array, one entry per image, keyed by image file name:

```json
[
  {"name": "clark_ave_01__a1b2c3__f004512.jpg", "status": "unlabeled"},
  {"name": "clark_ave_01__a1b2c3__f009030.jpg", "status": "reviewed"}
]
```

| Status | Set by | Meaning to ingest |
|---|---|---|
| `unlabeled` | `irs queue` (initial value for every image) | Not reviewed. Blocks ingest unless `--allow-unreviewed`. |
| `labeled` | Yoloble, automatically, when an image has at least one box | Not reviewed. Yoloble sets this on load for any image with pre-labels, so it says nothing about human review. Treated like `unlabeled`. |
| `reviewed` | Yoloble, when the reviewer confirms the image (new in format 1) | Labels are human-verified. Ingested. |
| `deleted` | Yoloble, when the reviewer rejects the image | Not ingested; the selection becomes `rejected`. |

Statuses written by older Yoloble versions (`labeled`, `deleted`, `unlabeled` only) remain valid; such a round simply has no `reviewed` images until it is reviewed with a version that supports it.

## round.json

Written by `irs queue`. Yoloble reads it and never changes it.

```json
{
  "format_version": 1,
  "round_id": 3,
  "model_id": "m0005",
  "created": "2026-10-03T20:00:00Z",
  "classes": ["car", "pickup", "..."],
  "images": {
    "clark_ave_01__a1b2c3__f004512.jpg": {
      "reason": "rare_class",
      "reason_text": "rare class: 3ax Bus",
      "scores": {"rarity": 0.82, "uncertainty": 0.10, "disagreement": 0.0},
      "prelabel_conf": [0.91, 0.47, 0.33]
    }
  }
}
```

- `reason` is one of `rare_class`, `uncertainty`, `disagreement`, `random`. `reason_text` is the human-readable banner.
- `prelabel_conf[i]` is the confidence of line `i` of the image's pre-label file as written by `irs queue`. It no longer applies once the reviewer edits the file.
- Ingest refuses a folder whose `format_version` it does not support.

## Yoloble ZIP export (fallback)

When the folder cannot be written, Yoloble's ZIP export is accepted with `irs ingest --round N --export <zip>`. It contains `labels/`, `classes.txt`, `lists/image_status.json` and `project.json`. Deleted images are left out of `labels/`. The same validation applies.

## Rules for writers

- Write each file to a temporary name and rename it into place.
- Never write outside the round folder.
- Never write to `Images/` or `round.json` after `irs queue` has finished.
