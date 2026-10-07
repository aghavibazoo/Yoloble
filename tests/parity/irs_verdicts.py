"""Record irs's verdict on every label file in tests/parity/cases.json.

First `node tests/parity/make_cases.js`, then from the irs repository with the
irs environment:

    cd ~/irs && python /path/to/Yoloble/tests/parity/irs_verdicts.py

Writes tests/parity/irs_label_cases.json: [{"b64": ..., "issues": [[code, line], ...]}].
tests/core.test.js checks that Yoloble reads every case the same way. The
label rules (edge tolerance, duplicate IoU) come from the irs config.
"""

import base64
import json
from pathlib import Path

from irs.config import load_config
from irs.dataset.labels import check_label_bytes

NUM_CLASSES = 9  # the cases use classes 0-8, like the irs class list
RULES = load_config().config.dataset.labels

here = Path(__file__).resolve().parent
cases = json.loads((here / "cases.json").read_text())
out = []
for b64 in cases:
    issues = check_label_bytes(base64.b64decode(b64), NUM_CLASSES, RULES).issues
    out.append({"b64": b64, "issues": [[str(i.code), i.line] for i in issues]})
(here / "irs_label_cases.json").write_text(json.dumps(out, separators=(",", ":")) + "\n")
print(f"{len(out)} cases, {sum(1 for c in out if c['issues'])} with issues; rules {RULES}")
