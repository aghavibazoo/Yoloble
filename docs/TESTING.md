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

### Sample round

- [ ] `python tools/make_sample_round.py --out %TEMP%\round_new` writes `Images/` (12 JPEGs), `Labels/`, `classes.txt` (the 9 irs classes), `image_status.json` (all `unlabeled`) and `round.json` (`format_version` 1), and nothing else. `samples/round_sample` was made this way. Deliberate problems in it: `clark_ave_01__a1b2c3d4__f016352.jpg` has no vehicles, `clark_ave_01__e5f60718__f014209.jpg` has a duplicate pre-label and `hwy7_east__0badc0de__f021759.jpg` a near-zero-size one; in `clark_ave_01__e5f60718__f007343.jpg` the model missed a vehicle.
