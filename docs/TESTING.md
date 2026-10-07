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

### Sample round

- [ ] `python tools/make_sample_round.py --out %TEMP%\round_new` writes `Images/` (12 JPEGs), `Labels/`, `classes.txt` (the 9 irs classes), `image_status.json` (all `unlabeled`) and `round.json` (`format_version` 1), and nothing else. `samples/round_sample` was made this way. Deliberate problems in it: `clark_ave_01__a1b2c3d4__f016352.jpg` has no vehicles, `clark_ave_01__e5f60718__f014209.jpg` has a duplicate pre-label and `hwy7_east__0badc0de__f021759.jpg` a near-zero-size one; in `clark_ave_01__e5f60718__f007343.jpg` the model missed a vehicle.

### Save back to the folder

- [ ] **Choose Folder** on the round copy and allow editing when Chrome asks. The header shows **All changes saved**. Draw a box: it shows **1 unsaved change**, then **All changes saved** within a second, and `Labels/<image>.txt` (open it in Notepad) has the new line.
- [ ] Delete an image. `image_status.json` lists every image in `Images/`, names unchanged (same upper/lower case), the deleted one as `deleted`.
- [ ] Open the folder again and click **Don't allow** / **Cancel** on the edit prompt (or open it from a read-only location). An amber banner says the folder is read-only and nothing is saved; **Allow saving to folder** asks again and, once allowed, saves.
- [ ] Set `Labels\<current image>.txt` to read-only (Properties > Read-only), then edit that image. A red banner shows the error and the header shows **Save failed (1 unsaved)**; it retries every 5 s. Clear the read-only flag: the banner goes away by itself (or press **Retry now**) and the file holds the edit.
- [ ] With an unsaved change (during the read-only test above), closing the tab makes the browser ask before leaving.
- [ ] After a session, `dir /S /O:D /T:W` on the round folder: only files in `Labels\` and `image_status.json` have new times; nothing new appears in the folder (no temporary files left behind), `Images\`, `round.json` and `classes.txt` are untouched.
