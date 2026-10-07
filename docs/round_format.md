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
- Name: `<site_id>__<video_id>__f<frame>.jpg`, where `frame` is the zero-based frame index in the source video, zero-padded to six digits (`f004512`).
- An image of the review backlog (a legacy image whose copies were labeled differently, so it has no source video) is copied unchanged from the dataset pool and named `backlog__<image_sha256><ext>` (`.jpg` for the current backlog).
- Yoloble never modifies or writes images.

## Labels

- One `.txt` per image, same base name: `Images/a.jpg` ↔ `Labels/a.txt`.
- One box per line: `<class_id> <x_center> <y_center> <width> <height>`, values normalised to 0–1, space-separated. Numbers use ASCII digits only: the class id is `[0-9]+`, a coordinate a decimal such as `0.5`, `.5` or `5e-1`; anything else (`²`, full-width `１`, `inf`, `nan`) is an error at ingest.
- As written by `irs queue`, these are model pre-labels (confidence of at least 0.25). After review they are the human-corrected labels.
- An empty file on an image with status `reviewed` means a confirmed empty frame. An empty or missing file on any other image means nothing. A `reviewed` image without a label file is an error at ingest (a missing file is not a decision).
- Label files use LF line endings and end with a final newline (`irs queue` and Yoloble both write it); a file without one is accepted.
- A file name must match its image's name exactly, case included. Two files whose names differ only in case, or a name that differs from the expected one only in case, are errors at ingest.
- `Labels/<name>.txt.crswap` is the browser's temporary file of a save that did not finish (Yoloble crashed or was closed while saving). Yoloble removes it when the folder is reopened. Ingest refuses a folder that holds one: "interrupted save in Yoloble — reopen the folder in Yoloble so it recovers, then re-run".
- Operating-system files (`Thumbs.db`, `desktop.ini`, `.DS_Store`; config `dataset.ignore_files`) in `Images/` or `Labels/` are ignored.

## classes.txt

- UTF-8, one name per line, no blank lines. Line 1 is class ID 0. `irs queue` ends the file with a newline; a file without one (for example in a ZIP export of an older Yoloble) is the same list.
- Written by `irs queue` from the current class list. Yoloble never writes it. Ingest rejects a round whose `classes.txt` differs from the class list in `round.json`.

## image_status.json

A JSON array, one entry per image, keyed by image file name. `irs queue` writes it sorted by name, indented by two spaces; Yoloble writes the names exactly as the image files are named (in the folder and in the ZIP export). Ingest matches names case-insensitively, for status lists written by older Yoloble versions that lower-cased them; two entries for one name with different statuses are an error. An image without an entry is `unlabeled`.

Before replacing a damaged status file, Yoloble may keep its old content as a backup in the round folder: `image_status.json.bak`, or with a UTC time stamp, `image_status.json.<UTC>.bak`. Ingest reads only `image_status.json` and ignores every file matching `image_status.json*.bak`.

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
  "kind": "training",
  "model_id": "m0005",
  "created": "2026-10-03T20:00:00Z",
  "classes": ["car", "pickup", "..."],
  "images": {
    "clark_ave_01__a1b2c3__f004512.jpg": {
      "reason": "rare_class",
      "reason_text": "rare class: 3ax Bus",
      "scores": {"rarity": 0.82, "uncertainty": 0.10, "disagreement": 0.0},
      "prelabel_conf": [0.91, 0.47, 0.33],
      "source": {"site_id": "clark_ave_01", "video_id": "a1b2c3", "frame": 4512,
                 "time_s": 150.4, "local_time": "2025-03-25T17:02:30.400000-07:00",
                 "path": "/mnt/d/.../DSCF0246.MP4"}
    },
    "backlog__e3b0c442...b855.jpg": {
      "reason": "legacy_conflict",
      "reason_text": "legacy image labeled differently in 2 copies (17 vs 19 boxes; split train): correct the boxes, label every vehicle",
      "scores": {"rarity": 0.0, "uncertainty": 0.0, "disagreement": 0.0},
      "prelabel_conf": [0.93, 0.88],
      "legacy_variants": [
        {"path": "train/images/Yolotraining (619).jpg", "split": "train", "boxes": 17, "label_text": "3 0.320196 ..."},
        {"path": "train/images/Yolotraining (76).jpg", "split": "train", "boxes": 19, "label_text": "3 0.319343 ..."}
      ]
    }
  }
}
```

- `kind` is `training` (frames for a new dataset version) or `test` (frames of the held-out test site for the frozen test set: every vehicle must be boxed, the frame measures the model).
- `reason` is one of `rare_class`, `uncertainty`, `disagreement`, `random`, `legacy_conflict` (an image of the review backlog) or `test_set` (a frame of a test round). `reason_text` is the human-readable banner.
- `source` (frames of a video) says where the frame comes from; `legacy_variants` (backlog images) lists the conflicting legacy labels for reference only: the file in `Labels/` holds model pre-labels like every other image. Both are informational; readers ignore keys they do not know.
- `prelabel_conf[i]` is the confidence of line `i` of the image's pre-label file as written by `irs queue`. It no longer applies once the reviewer edits the file.
- Ingest refuses a folder whose `format_version` it does not support.

## Yoloble ZIP export (fallback)

When the folder cannot be written, Yoloble's ZIP export is accepted with `irs ingest --round N --export <zip>`. It contains `labels/`, `classes.txt`, `lists/image_status.json` and `project.json`. Deleted images are left out of `labels/`. The same validation applies.

## Rules for writers

- Write each file to a temporary name and rename it into place.
- Never write outside the round folder.
- Never write to `Images/` or `round.json` after `irs queue` has finished.

## Changes within format version 1

Additions made in phase 3 (2026-10-06). They are compatible: a reader that ignores unknown keys and shows `reason_text` as the banner needs no change, so `format_version` stays 1.

| Change | Yoloble |
|---|---|
| `round.json`: top-level `kind` (`training` or `test`) | may show it (a test round needs complete boxes) |
| `round.json`: `reason` may also be `legacy_conflict` or `test_set` | must accept them (show `reason_text`) |
| `round.json`: per image `source` (frames) and `legacy_variants` (backlog images) | optional to show; must not reject them |
| Review-backlog images named `backlog__<image_sha256><ext>` | nothing (names are opaque) |
| Frame number zero-padded to six digits | nothing |
| `classes.txt` ends with a newline when written by `irs queue` | must not treat the final newline as a blank line or an extra class |
| A `reviewed` image needs a label file (empty = confirmed empty) | save an empty file for a confirmed empty frame |

Second set (phase 3 audit, 2026-10-07), also compatible:

| Change | Yoloble |
|---|---|
| `image_status.json` holds exact-case names (folder and ZIP); ingest still matches case-insensitively | writes exact-case names |
| Label files end with a final newline | writes it |
| `classes.txt` is written by `irs queue` only | never writes it |
| `Labels/<name>.txt.crswap` blocks ingest until Yoloble has recovered the folder | cleans it up on reopen |
| Status backups `image_status.json*.bak` (e.g. `image_status.json.<UTC>.bak`) in the round folder are ignored | may write them |
| `Thumbs.db`, `desktop.ini`, `.DS_Store` in `Images/` or `Labels/` are ignored | nothing |
| File names must match exactly; names differing only in case are errors | never renames files |
| A ZIP's `project.json` may carry `round_id`; ingest refuses a ZIP of another round. A ZIP's images are checked against the round folder when it exists | may add `round_id` to `project.json` |

