"""Throwaway: resolves a rebase conflict in the locale catalogues by keeping both
sides of it.

Every one of these conflicts has the same shape: the upstream added rows at the
end of the object and so did the commit being replayed, and both belong. Written
as a script because there are four files per commit and five commits.
"""

import re
import subprocess
import sys
from pathlib import Path

PATTERN = re.compile(
    r"<<<<<<< [^\n]*\n(?P<ours>.*?)^=======\n(?P<theirs>.*?)^>>>>>>> [^\n]*\n",
    re.S | re.M,
)

conflicted = subprocess.run(
    ["git", "diff", "--diff-filter=U", "--name-only"],
    capture_output=True,
    text=True,
    check=True,
).stdout.split()

if not conflicted:
    print("nothing conflicted")
    sys.exit(0)

for name in conflicted:
    path = Path(name)
    text = path.read_text(encoding="utf-8")
    out, count = PATTERN.subn(lambda found: found.group("ours") + found.group("theirs"), text)
    if not count or "<<<<<<<" in out:
        print(f"{name}: {count} blocks, markers left: {'<<<<<<<' in out}")
        sys.exit(1)

    path.write_text(out, encoding="utf-8", newline="\n")
    print(f"{name}: {count} kept from both sides")
