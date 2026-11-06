from __future__ import annotations

import json
import os
import sys

def main() -> int:
    args = sys.argv[1:]
    log = os.environ.get("FAKE_SSH_LOG")
    if log:
        with open(log, "a", encoding="utf-8") as out:
            out.write(json.dumps(args) + "\n")

    destination = args[args.index("--") + 1] if "--" in args and args.index("--") + 1 < len(args) else "?"
    sys.stdout.write(f"fake ssh: connected to {destination}\r\n")
    while True:
        sys.stdout.write(f"{destination}$ ")
        sys.stdout.flush()
        line = sys.stdin.readline()
        if not line:
            return 255
        said = line.strip()
        if said == "exit":
            return 0
        if said == "drop":
            sys.stdout.write(f"Connection to {destination} closed by remote host.\r\n")
            sys.stdout.flush()
            return 255
        sys.stdout.write(f"you said: {said}\r\n")

if __name__ == "__main__":
    raise SystemExit(main())
