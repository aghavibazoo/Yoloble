# Yoloble

A single-file YOLO bounding-box editor and the review station of the `irs` labeling loop. Open `index.html` in Chrome, Edge or another Chromium-based browser; there is nothing to install, build or serve.

## Quick start: reviewing an irs round

1. Open `index.html` (double-click is fine; Chromium treats local files as a secure page).
2. **Choose Folder**, pick the round folder (`review_queue/round_NNN`) and allow Yoloble to edit it when the browser asks.
3. For each image: correct the boxes (the dashed ones are the model's pre-labels, with its confidence), then press **Space** to mark the image reviewed and go to the next one. **N** marks an image that has no vehicles.
4. **Finish round** checks that every image is reviewed or deleted, that the labels pass the irs ingest rules, and that everything is saved. Then run `irs ingest --round N`.

Work is saved into the folder as you go: the header says **All changes saved**. If the browser closes or crashes, open `index.html` again and click **Resume "round_NNN"**: Yoloble reopens the folder on the image you were on and offers back any change that had not reached the folder yet. **?** lists every key.

## Folder layout

```
DatasetRoot/
  Images/              required: .png .jpg .jpeg .bmp .webp
  Labels/              YOLO .txt per image, same base name
  classes.txt          one class name per line; line number = class ID
  image_status.json    [{"name": "img.jpg", "status": "unlabeled|labeled|reviewed|deleted"}, ...]
  round.json           irs rounds only: round ID, model, per-image reason and pre-label confidences
  deleted_list.txt     optional, older lists (used when there is no image_status.json)
  labeled_list.txt     optional, older lists
```

The contract with irs is [`docs/round_format.md`](docs/round_format.md) (format version 1).

**What Yoloble writes:** only `Labels/<image>.txt` and `image_status.json` (plus `image_status.json.bak`, a copy of a status file it could not read, made only when you choose to replace that file), only inside the folder you opened, each through a temporary file that is swapped in and read back. It never writes `Images/`, `round.json` or `classes.txt`. Opening a folder does not change it (apart from removing temporary `*.crswap` files left by a save the browser did not finish); a file is written when you change something. If writing fails, a red banner says so, the change is kept and saving is retried; a folder opened without write access gets an amber banner.

**Statuses:** `unlabeled` and `labeled` both mean *not reviewed* (`labeled` only says the image has boxes, for example pre-labels). `reviewed` means a person confirmed the labels; an empty label file on a reviewed image is a confirmed empty frame. `deleted` rejects the image (the file is not removed). Status files from older versions keep working.

## Features

- **Save back to the folder** with a visible save state, error banner, automatic retry and a warning before closing with unsaved changes. **Download Bundle** (ZIP) remains as a fallback.
- **Autosave and recovery:** the session (current image, statuses, edits) is kept in the browser's IndexedDB, so a crash, a closed tab or a full storage quota loses nothing. Status lists that older versions kept in localStorage are moved there once.
- **Reviewed status:** **Space** marks reviewed and moves on; progress (*132 of 200 reviewed*) in the header; **Finish round** lists what is left.
- **Pre-labels:** model boxes from `round.json` are dashed with their confidence until you edit them or mark the image reviewed. **U** zooms to the least confident one.
- **Reason banner:** why irs picked the frame (rare class, low confidence, track disagreement, random sample).
- **Classes:** a distinct colour per class, number keys 0–9 and Shift+0–9 (classes 10–19), **C** for a type-to-search picker; with a box selected these change that box. **L** toggles the class names on boxes.
- **Checks:** out-of-bounds, zero and near-zero size, duplicate boxes, unknown classes and unreadable label lines, with one-click fixes; `classes.txt` differing from `round.json`. The label rules are the same as irs ingest's.
- **Editing:** draw, move, resize by corners and edges, **Shift+arrows** to nudge, **Delete**, undo and redo per image.
- **Thumbnail strip** coloured by status, with filters for not reviewed, reviewed, with problems, reason and class (**T** to hide).
- Smart Filters, class management, statistics and the ZIP bundle as before.

## Keys

| Key | Action |
|---|---|
| Space / Shift+Space | Mark reviewed and go to the next image / even if Checks found a problem |
| N | No vehicles: remove all boxes, mark reviewed |
| A, ← / D, → | Previous / next image |
| U / Shift+U | Next / previous unchecked model box, least confident first |
| 0–9, Shift+0–9 | Class 0–9 / 10–19 (selected box, otherwise new boxes) |
| C | Search classes |
| Tab / Shift+Tab | Next / previous class for new boxes |
| Shift+arrows | Nudge the selected box 1 px (Ctrl+Shift: 10 px) |
| Delete, Backspace | Delete the selected box |
| Esc | Deselect, close a dialog |
| Ctrl+Z / Ctrl+Y, Ctrl+Shift+Z | Undo / redo |
| L, V, T | Class names, boxes, thumbnail strip on/off |
| F, R, +, −, wheel, right-drag | Fit, 100%, zoom, zoom, pan |
| ? | All shortcuts |

## ZIP bundle

**Download Bundle** creates `yolo_editor_bundle.zip`:

```
labels/                YOLO .txt per image (deleted images left out)
classes.txt
dataset_statistics.txt
lists/
  image_status.json    one entry per image of the open dataset, exact names
  deleted_list.txt
  labeled_list.txt
project.json           classes, statuses, round ID
```

`irs ingest --round N --export <zip>` accepts it when the folder cannot be written.

## Browser support and limits

- Chromium-based browsers (Chrome, Edge, Brave): folder access needs the File System Access API.
- Everything works offline, the ZIP export included (JSZip 3.10.1 is inside `index.html`).
- The browser backup is per browser profile: resuming on another computer starts from what is in the folder.
- Two tabs on the same folder both write to it; use one.

## Development

Tests need Node.js 22 or later and nothing else:

```
node --test                            # all tests
node --test tests/core.test.js         # unit tests of the core logic (milliseconds)
node --test tests/e2e.test.js          # end-to-end in headless Chrome or Edge
node --test tests/acceptance.test.js   # 50-frame round, crash and resume (needs Python + Pillow)
```

The pure logic lives in `<script id="yoloble-core">` in `index.html`; the unit tests load that block directly. `tools/make_sample_round.py` writes synthetic rounds; `samples/round_sample` is one. The manual checklist is [`docs/TESTING.md`](docs/TESTING.md).
