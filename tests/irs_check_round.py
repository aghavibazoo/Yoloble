"""Check a reviewed round folder the way docs/round_format.md says irs ingest reads it.

Run with the irs environment, so the label checks are irs's own code:

    cd ~/irs && python /path/to/Yoloble/tests/irs_check_round.py /path/to/round_NNN

Checks: the layout, format_version, classes.txt against round.json, every
image listed in round.json and image_status.json with a known status, every
image reviewed or deleted, and every label file of a reviewed image through
irs.dataset.labels.check_label_bytes, with the label rules (edge tolerance,
duplicate IoU) loaded from the irs config (configs/pipeline.yaml, or
$IRS_CONFIG). Prints the problems and exits 1 if there are any. This is a
test aid, not a replacement for irs ingest.
"""

import json
import sys
from pathlib import Path

from irs.config import load_config
from irs.dataset.labels import check_label_bytes

STATUSES = {"unlabeled", "labeled", "reviewed", "deleted"}
SUPPORTED_FORMATS = {1}
RULES = load_config().config.dataset.labels


def check(folder: Path) -> list[str]:
    problems: list[str] = []
    # image_status.json.bak: Yoloble's copy of a status file it could not read (proposed for round_format.md)
    expected_top = {"Images", "Labels", "classes.txt", "image_status.json", "round.json", "image_status.json.bak"}
    top = {p.name for p in folder.iterdir()}
    if top - expected_top:
        problems.append(f"unexpected entries in the round folder: {sorted(top - expected_top)}")
    round_json = json.loads((folder / "round.json").read_text(encoding="utf-8"))
    if round_json.get("format_version") not in SUPPORTED_FORMATS:
        problems.append(f"unsupported format_version {round_json.get('format_version')}")
    classes = (folder / "classes.txt").read_text(encoding="utf-8").splitlines()
    if classes != round_json["classes"]:
        problems.append("classes.txt differs from round.json classes")
    images = sorted(p.name for p in (folder / "Images").iterdir())
    labels_dir = folder / "Labels"
    stray = sorted(p.name for p in labels_dir.iterdir() if p.suffix != ".txt" or (folder / "Images" / (p.stem + ".jpg")).exists() is False)
    if stray:
        problems.append(f"files in Labels/ that are not the label file of an image: {stray}")
    status_rows = json.loads((folder / "image_status.json").read_text(encoding="utf-8"))
    status = {r["name"]: r["status"] for r in status_rows}
    if len(status) != len(status_rows):
        problems.append("image_status.json lists an image twice")
    reviewed = deleted = 0
    for name in images:
        if name not in round_json["images"]:
            problems.append(f"{name}: not in round.json")
        st = status.get(name)
        if st not in STATUSES:
            problems.append(f"{name}: status {st!r}")
            continue
        if st == "deleted":
            deleted += 1
            continue
        if st != "reviewed":
            problems.append(f"{name}: not reviewed ({st})")
            continue
        reviewed += 1
        label = labels_dir / (Path(name).stem + ".txt")
        if not label.exists():
            problems.append(f"{name}: reviewed but no label file")
            continue
        result = check_label_bytes(label.read_bytes(), len(classes), RULES)
        problems += [f"Labels/{label.name} line {i.line}: {i.code} {i.message}" for i in result.issues]
    print(f"{len(images)} images: {reviewed} reviewed, {deleted} deleted; {len(problems)} problem(s)")
    return problems


if __name__ == "__main__":
    found = check(Path(sys.argv[1]))
    for p in found:
        print(" -", p)
    sys.exit(1 if found else 0)
