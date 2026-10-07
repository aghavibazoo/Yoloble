# Testing Yoloble

## Automated tests

Requires Node.js 22 or later. Nothing to install.

```
node --test
```

- `tests/core.test.js` unit-tests the pure logic in the `<script id="yoloble-core">` block of `index.html` (label parsing and writing, validation, status rules, recovery planning, class search, `round.json` parsing). The test loads that block straight from `index.html`, so it tests the shipped code.
- `tests/e2e.test.js` drives `index.html` in headless Chrome or Edge over the DevTools protocol (`tests/cdp.js`, no Playwright needed). The round folder is a copy of `samples/round_sample` in the browser's origin-private file system, which gives Yoloble a real read-write folder handle, so saving goes through the same code as **Choose Folder**. Crashes are simulated by killing the browser and restarting it on the same profile. Skipped if no Chromium browser is found (set `CHROME_PATH`).
- `tests/acceptance.test.js` is the design section 12 acceptance run on a generated 50-frame round (needs Python with Pillow).
- `tests/irs_check_round.py` checks a finished round with irs's own label checker (run it from the irs environment).

What the automated tests cannot cover: the browser's folder picker and permission prompts (the tests hand Yoloble a folder handle directly), a real disk on Windows (OPFS is used instead), real crashes of a visible browser, and how the screen looks. The manual checklist covers those.

## Manual checklist

Use Chrome or Edge. Open `index.html` directly from disk (double-click) unless a step says otherwise. Work on a copy of the sample round, never on the copy in the repository:

```
xcopy /E /I samples\round_sample %TEMP%\round_test
```

Tick each line. Each line was added with the change it covers.

### Core

- [ ] Open a folder that has `Images/`, `Labels/` and `classes.txt`; boxes from existing label files show on the right images, and **Download Bundle** writes label files whose lines read `<class> <x> <y> <w> <h>` with six decimals.
- [ ] Delete an image: the next image appears with its own picture and its own boxes (not the deleted picture).
- [ ] Draw a box, go to the next image and press **Ctrl+Z**: nothing happens there (the **Undo** button is greyed out). Go back: **Ctrl+Z** removes the box you drew.
- [ ] Hold **D** down (key repeat) to race through the images, then come back: every image still shows its own boxes and no label file changed.

### Sample round

- [ ] `python tools/make_sample_round.py --out %TEMP%\round_new` writes `Images/` (12 JPEGs), `Labels/`, `classes.txt` (the 9 irs classes), `image_status.json` (all `unlabeled`) and `round.json` (`format_version` 1), and nothing else. `samples/round_sample` was made this way. Deliberate problems in it: `clark_ave_01__a1b2c3d4__f010808.jpg` has no vehicles (empty pre-label file), `clark_ave_01__e5f60718__f014209.jpg` has a duplicate pre-label and `hwy7_east__0badc0de__f015197.jpg` a near-zero-size one; in `hwy7_east__0badc0de__f008412.jpg` the model missed a vehicle.

### Save back to the folder

- [ ] **Choose Folder** on the round copy and allow editing when Chrome asks. The header shows **All changes saved**. Draw a box: it shows **1 unsaved change**, then **All changes saved** within a second, and `Labels/<image>.txt` (open it in Notepad) has the new line.
- [ ] Delete an image. `image_status.json` lists every image in `Images/`, names unchanged (same upper/lower case), the deleted one as `deleted`.
- [ ] Open the folder again and click **Don't allow** / **Cancel** on the edit prompt (or open it from a read-only location). An amber banner says the folder is read-only and nothing is saved; **Allow saving to folder** asks again and, once allowed, saves.
- [ ] Set `Labels\<current image>.txt` to read-only (Properties > Read-only), then edit that image. A red banner shows the error and the header shows **Save failed (1 unsaved)**; it retries every 5 s. Clear the read-only flag: the banner goes away by itself (or press **Retry now**) and the file holds the edit.
- [ ] With an unsaved change (during the read-only test above), closing the tab makes the browser ask before leaving.
- [ ] Leftovers of an interrupted save: create empty files `image_status.json.crswap` in the round folder and `x.txt.crswap` in `Labels\`, then open the folder with write access: both are gone and nothing else changed.
- [ ] After a session, `dir /S /O:D /T:W` on the round folder: only files in `Labels\` and `image_status.json` have new times; nothing new appears in the folder (no temporary files left behind), `Images\`, `round.json` and `classes.txt` are untouched.

### Autosave and recovery

- [ ] **Close the browser mid-round, reopen, nothing lost.** Review a few images, edit one, then end Chrome in Task Manager (a crash, not a normal close). Open `index.html` again: the header shows **Resume "round_test"**. Click it: Yoloble opens the folder on the image you were on, every edit is there, and the header shows **All changes saved**.
- [ ] Make `Labels\<image>.txt` read-only, edit that image (header: **Save failed**), close the browser and accept leaving. Clear the read-only flag and reopen the folder: a dialog names the image and offers to restore the unsaved edit. **OK** restores it and writes it into the folder.
- [ ] Repeat, but press **Cancel** in that dialog: the edit is discarded, the folder keeps its version, and reopening the folder does not ask again.
- [ ] Change a label file in Notepad while Yoloble is closed, after Yoloble had an unsaved edit for it: on reopening, the folder's version is kept and a banner says one image was changed outside Yoloble.
- [ ] Older state: in DevTools > Application > Local Storage, add key `yolo_image_status` with `[{"name":"<an image>.jpg","status":"deleted"}]` and reload. The key is gone, IndexedDB `yoloble` > `meta` has `legacyStatus`, and opening a folder without `image_status.json` hides that image as before.
- [ ] Drag images and their label files in together, edit, reload the page and drag the same files in: Yoloble offers the edits back.
- [ ] Full browser storage: DevTools > Application > Storage > tick **Simulate custom storage quota** and set it very low (e.g. 0.01 MB), then edit: a yellow banner says the browser backup failed, and saving to the folder carries on. Untick it: the next edit clears the banner.

### Classes

- [ ] Each class has its own colour (sidebar list, box outline, name tag, box list); the nine irs classes are easy to tell apart on the sample images.
- [ ] Click a box, press **8**: it becomes 3ax Bus. Press **C**, type `pick`, **Enter**: it becomes Pickup Truck. **Ctrl+Z** / **Undo** brings back 3ax Bus. Click empty space or press **Esc**, then **2**: the chip **New boxes: Van** changes and the next box drawn is a Van.
- [ ] In the **C** picker: `bus` lists both buses, `3 bus` finds 3ax Bus, `8` finds class 8, arrow keys move the highlight, **Esc** closes without change. The sidebar search box filters the same way and **Enter** picks the first match.
- [ ] More than ten classes, on a copy of the sample without `round.json` (a round's class list is fixed): **Edit Classes** > **+ Add** twice (11 classes). **Shift+0** picks class 10, **Shift+1** class 11 does nothing (no such class), keys 0–9 still pick 0–9. A box drawn with class 10 is saved as `10 …`.
- [ ] **L** (or the **Class names** checkbox) hides the name tags on boxes (the selected box keeps its tag); the setting is remembered after a reload.
- [ ] With any folder open, removing a class or **Reset** is refused with a message. In a folder without `round.json`, renaming and adding still work and never change `classes.txt`.

### Reviewed status

- [ ] On opening the sample round the header says **0 of 12 reviewed** and the image shows **Not reviewed**, although the pre-labeled images are `labeled`: boxes alone never count as reviewed.
- [ ] **Space** (or **Reviewed ✓**) marks the image reviewed and shows the next one; the counter goes up and `image_status.json` has `"reviewed"` for it. Holding Space does not skip through images.
- [ ] On `clark_ave_01__a1b2c3d4__f010808.jpg` (no vehicles) press **N**: no question, it is reviewed and its label file stays empty. On an image with boxes, **N** asks first, then removes the boxes, marks it reviewed and writes an empty label file; **Ctrl+Z** on that image brings the boxes back.
- [ ] Edit a reviewed image: it stays reviewed. Click the green **Reviewed ✓** pill: it goes back to **Not reviewed** (`labeled` in the file).
- [ ] **Finish round** with images left: the dialog lists them (click one to go there) and warns that irs ingest stops on unreviewed images. Clicking the progress counter goes to the next unreviewed image.
- [ ] Review the rest (deleting one): after the last one a message says everything is done; **Finish round** says the round is ready for irs ingest. Smart Filters **Only Not reviewed** / **Only Reviewed** show the expected images.
- [ ] Older status lists: a folder whose `image_status.json` only has `labeled`/`unlabeled`/`deleted` opens as before (0 reviewed).

### Pre-label display

- [ ] On the sample round, model boxes are dashed and their tag shows the confidence from `round.json` (first image: 0.81, 0.79, 0.65); the box list marks them **model 0.81** etc., below 0.5 in orange.
- [ ] Move or resize a dashed box, or change its class: it turns solid (confirmed); the others stay dashed. **Ctrl+Z** makes it dashed again.
- [ ] Close and reopen the folder: boxes still unchecked are dashed again with their confidence; edited ones are solid.
- [ ] Mark an image reviewed, go back: all its boxes are solid. Reopen the folder: still solid.
- [ ] Add a line to a pre-label file in Notepad before opening: that image's boxes are all solid (its file no longer matches `prelabel_conf`), the other images are unaffected.
- [ ] A folder without `round.json` shows no dashed boxes and works as before. A `round.json` with `"format_version": 2` gives a yellow banner saying this Yoloble reads version 1, and no dashed boxes.
- [ ] In a round folder, **Edit Classes** > **+ Add** is refused (the class list comes from `round.json`).

### Reason banner

- [ ] On the sample round a banner above the image says why it was picked (**RARE CLASS** rare class: 3ax Bus; **LOW CONFIDENCE** …; **TRACK DISAGREEMENT** …; **RANDOM SAMPLE** random sample). Hovering it shows the selection scores. The header shows **Round 3 · model m0005**.
- [ ] An image missing from `round.json` shows **NOT IN ROUND**. A folder without `round.json` shows no banner and no round in the header.

### Validation

- [ ] `clark_ave_01__e5f60718__f014209.jpg`: **Checks** says *Box 4 duplicates box 3*, the box has a red ring. **Space** does not mark it reviewed: a message says why and selects the box. **Delete box** in Checks fixes it; then **Space** works.
- [ ] `hwy7_east__0badc0de__f015197.jpg`: an orange ring shows a box too small to see; Checks says *near zero size (1.0×0.7 px)* (a warning: irs accepts it).
- [ ] Draw a box starting outside the image: it is clipped to the image edge. Drag a box past the edge: it stops at the edge.
- [ ] Edit a label file in Notepad so a box sticks out of the image (e.g. x centre 0.99, width 0.1) and reopen: Checks offers **Clip to image**. A line like `3 0.5 oops 0.1 0.1` gives a warning on opening and *unreadable line* in Checks; moving to another image leaves the file alone; **Rewrite file** removes the line.
- [ ] Change `Van` to `van` in `classes.txt` and reopen: **Finish round** lists *classes.txt line 3 is "van", round.json has "Van"*. An extra image copied into `Images/` is listed as *not listed in round.json*. Problems are listed per image; clicking a name opens it.
- [ ] Optional cross-check against irs itself: after a session, run irs's `check_label_bytes` (irs/dataset/labels.py) on every `Labels/*.txt` of non-deleted images: no issues.

### Acceptance (design section 12)

- [ ] Automated: `node --test tests/acceptance.test.js` generates a 50-frame round, reviews it (edits, reclassifications, deletions, empty frames, fixes), kills the browser after 25 frames, resumes with **Resume**, finishes, and checks the folder field by field against `docs/round_format.md`. `KEEP_ROUND=1` keeps the finished folder and prints its path.
- [ ] Manual, 50 frames: `python tools/make_sample_round.py --frames 50 --out %TEMP%\round_050`, open it with **Choose Folder** and review every frame without using **Download Bundle**. Halfway, end Chrome in Task Manager; reopen `index.html`, click **Resume "round_050"**: same image, nothing lost. Finish: **Finish round** says the round is ready.
- [ ] **irs ingest accepts the folder.** Run `irs ingest --round N` on the finished folder (once ingest exists), or meanwhile, from the irs repository: `python <Yoloble>/tests/irs_check_round.py <round folder>`, which reads the folder as `round_format.md` describes and checks every label file with irs's own `check_label_bytes`: it reports 0 problems.

### Jump to uncertain boxes

- [ ] On `hwy7_east__0badc0de__f015197.jpg` press **U** repeatedly: Yoloble selects and zooms to the unchecked model boxes in order 0.27, 0.58, 0.63, 0.68, 0.78, 0.86, then starts again; a message names each. **Shift+U** goes back. **F** fits the image again. On an image with no dashed boxes, **U** says there are none.

### Finer box editing

- [ ] A selected box has handles on all four corners and all four edges; dragging an edge handle changes only that side (the cursor shows the direction).
- [ ] **Shift+arrow** moves the selected box by one image pixel, **Ctrl+Shift+arrow** by ten; it stops at the image edge. Plain arrows still change image. A run of nudges is undone with one **Ctrl+Z**.
- [ ] **Ctrl+Y** or **Ctrl+Shift+Z** (or **Redo**) redoes what was undone; clicking a box without moving it keeps the redo history; a new edit clears it.

### Thumbnail strip

- [ ] Below the image, a strip shows every image with its number: green border and ✓ when reviewed, amber when it has unchecked boxes, grey when it has none; a red **!** when Checks finds a problem; the current image is outlined and stays in view while you move.
- [ ] Filters: **Not reviewed**, **Reviewed**, **With problems** (sample: the duplicate and the near-zero box images), a reason (only for rounds), a class. The count shows how many are shown. Clicking a thumbnail opens that image.
- [ ] **T** (or **Thumbnails**) hides and shows the strip; the canvas grows to fill the space; the choice is remembered.

### Shortcut overlay

- [ ] **?** (or the **?** button) lists every key, grouped (Review, Boxes, Classes, View); while it is open keys do not act on the image; **Esc** or **Close** closes it.

### ZIP export (fallback)

- [ ] After reviewing a few images and deleting one, **Download Bundle**: the ZIP has `labels/` (no file for the deleted image), `classes.txt` identical to the folder's, `lists/image_status.json` with exactly the images of this folder and their names unchanged (also when an older Yoloble left other statuses in the browser), `lists/deleted_list.txt`, `lists/labeled_list.txt` and `project.json` (with the round ID). `irs ingest --round N --export <zip>` accepts it.

### Undo a delete

- [ ] Edit and review an image, then **Delete Image**: a message says it was deleted, with **Undo**. **Undo** within 8 s brings the image back at its place, with its boxes and its previous status (`image_status.json` follows).

### Robustness (from the code review)

- [ ] Smart Filters **Any Class** = 3, go to an image with a 3ax Truck, change that box to Car: Yoloble stays on that image, and only its label file changes.
- [ ] Smart Filters **Only Not reviewed**, then **Space** several times: each press reviews the image shown and moves to the next unreviewed one; no label file changes.
- [ ] With a folder open, drop a `.txt` label file onto the window: Yoloble refuses with a message and nothing changes on disk.
- [ ] A label line with class `12` (9 classes) and an image file that is not a real JPEG: the folder still opens; Checks flags the class; the broken image shows a message and can be deleted.
- [ ] Copy a round without `classes.txt`: the class names come from `round.json` (Finish round still reports the missing file).

### round.json additions within format 1

- [ ] In a copy of the sample, set `"kind": "test"` in `round.json` and give one image `"reason": "legacy_conflict"` with a `legacy_variants` list: the header shows **TEST round 3** (hover: box every vehicle), the banner shows **LEGACY CONFLICT** with its `reason_text`, and hovering lists the legacy copies. Hovering the banner on a normal frame shows its source (site, video, frame, local time). Unknown keys in `round.json` are ignored.

### Audit fixes

- [ ] Save race (B1): on a slow disk (a network share or a slow USB stick), draw a box and press **Ctrl+Z** right away: after **All changes saved**, the label file matches the screen (the box is gone).
- [ ] Drop (B2): drag `a.jpg`, `b.jpg`, `c.jpg`, their `.txt` labels and a `deleted_list.txt` naming `a.jpg` into the window at once: `b.jpg` and `c.jpg` show their own boxes.
- [ ] Drop (M6): drag two images in, then their two label files: the boxes appear at once; **D** then **A** keeps them.
- [ ] Old status names (M1): a folder with `Images/Frame_A.jpg` and an `image_status.json` saying `frame_a.jpg`: review it; the file then lists `Frame_A.jpg` once (no lower-cased duplicate), and reopening shows it reviewed.
- [ ] Recovery vs. another reviewer (M3): leave an unsaved edit on an image (read-only label file), close Yoloble, mark that image `reviewed` in `image_status.json` by hand, reopen: the edit is not restored, and the banner names the image as changed since.
- [ ] Raw label bytes (M4): in a label file add the line `1 1.0000004 0.5 0.1 0.1`, in another write a coordinate as `0x1`, and save one with a UTF-8 BOM (Notepad "UTF-8 with BOM"): on opening, Checks and **Finish round** report each (the BOM as a problem on line 1), exactly as `irs ingest` would; **Clip** / **Rewrite file** fix them.
- [ ] Broken status file (M5): truncate `image_status.json` (or put a row without `"status"`) and open the folder: a banner says what is wrong and that the folder is read-only; edits are not written. **Replace image_status.json (keep a backup)** writes `image_status.json.bak` with the old bytes, then the new status file and the pending edits.
- [ ] Two windows (M2): open the round folder in two tabs: the second says it is open in another window and is read-only; edits there are not written. Edit `image_status.json` in Notepad (mark an image `deleted`) while Yoloble has the folder open, then review an image in Yoloble: the file keeps both changes and a banner says so.
- [ ] Warnings do not block: on `hwy7_east__0badc0de__f015197.jpg` **Space** marks it reviewed and a message repeats the near-zero-size warning; on the duplicate image **Space** still refuses.
- [ ] Pre-label trust: open the round once, close Yoloble, change one number in a pre-label file of an image you did not open (same number of lines), reopen: that image shows solid boxes, the others still dashed.
- [ ] Delete a reviewed image's label file and add `Labels/stray.txt`, reopen: **Finish round** lists *is reviewed but has no label file* and *Labels/stray.txt belongs to no image*.
