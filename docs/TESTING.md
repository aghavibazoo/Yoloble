# Testing Yoloble

## Automated tests

Requires Node.js 22 or later. Nothing to install.

```
node --test
```

- `tests/core.test.js` unit-tests the pure logic in the `<script id="yoloble-core">` block of `index.html` (label parsing and writing, validation, status rules, `round.json` parsing). The test loads that block straight from `index.html`, so it tests the shipped code.

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
- [ ] In DevTools > Application > IndexedDB, delete database `yoloble` while Yoloble is open, then edit: a yellow banner says the browser backup failed, and saving to the folder carries on.

### Classes

- [ ] Each class has its own colour (sidebar list, box outline, name tag, box list); the nine irs classes are easy to tell apart on the sample images.
- [ ] Click a box, press **8**: it becomes 3ax Bus. Press **C**, type `pick`, **Enter**: it becomes Pickup Truck. **Ctrl+Z** / **Undo** brings back 3ax Bus. Click empty space or press **Esc**, then **2**: the chip **New boxes: Van** changes and the next box drawn is a Van.
- [ ] In the **C** picker: `bus` lists both buses, `3 bus` finds 3ax Bus, `8` finds class 8, arrow keys move the highlight, **Esc** closes without change. The sidebar search box filters the same way and **Enter** picks the first match.
- [ ] More than ten classes: **Edit Classes** > **+ Add** twice (11 classes). **Shift+0** picks class 10, **Shift+1** class 11 does nothing (no such class), keys 0–9 still pick 0–9. A box drawn with class 10 is saved as `10 …`.
- [ ] **L** (or the **Class names** checkbox) hides the name tags on boxes (the selected box keeps its tag); the setting is remembered after a reload.
- [ ] With a folder open, removing a class or **Reset** is refused with a message; renaming and adding still work and never change `classes.txt`.

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
- [ ] `hwy7_east__0badc0de__f015197.jpg`: an orange ring shows a box too small to see; Checks says *near zero size (1.0×0.7 px)*. **Space** refuses, **Shift+Space** marks it reviewed anyway.
- [ ] Draw a box starting outside the image: it is clipped to the image edge. Drag a box past the edge: it stops at the edge.
- [ ] Edit a label file in Notepad so a box sticks out of the image (e.g. x centre 0.99, width 0.1) and reopen: Checks offers **Clip to image**. A line like `3 0.5 oops 0.1 0.1` gives a warning on opening and *unreadable line* in Checks; moving to another image leaves the file alone; **Rewrite file** removes the line.
- [ ] Change `Van` to `van` in `classes.txt` and reopen: **Finish round** lists *classes.txt line 3 is "van", round.json has "Van"*. An extra image copied into `Images/` is listed as *not listed in round.json*. Problems are listed per image; clicking a name opens it.
- [ ] Optional cross-check against irs itself: after a session, run irs's `check_label_bytes` (irs/dataset/labels.py) on every `Labels/*.txt` of non-deleted images: no issues.
