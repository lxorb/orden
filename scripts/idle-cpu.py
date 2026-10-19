#!/usr/bin/env python3
"""What Orden costs the CPU while nothing happens: the app and every process under it,
by Chromium's process type and by thread, over a while. #427: on KDE the app sat at a
whole core idle, all of it the browser process's main thread (src-tauri/src/
chromium_pump.rs); Firefox and Chromium sit near nothing.

    python3 scripts/idle-cpu.py <app pid> [seconds] [most, in % of one core]

Fails where the whole tree used more than `most` (default 30) over the while, and says
what Chromium's GPU process was started with, where there is one.
"""
import os
import sys
import time

ROOT = int(sys.argv[1])
SPAN = float(sys.argv[2]) if len(sys.argv) > 2 else 20
MOST = float(sys.argv[3]) if len(sys.argv) > 3 else 30
HZ = os.sysconf("SC_CLK_TCK")


def stat(path):
    text = open(path).read()
    return text[text.index("(") + 1 : text.rindex(")")], text.rsplit(")", 1)[1].split()


def tree():
    kids = {}
    for pid in os.listdir("/proc"):
        if pid.isdigit():
            try:
                kids.setdefault(int(stat(f"/proc/{pid}/stat")[1][1]), []).append(int(pid))
            except (OSError, ValueError):
                pass
    found, todo = [], [ROOT]
    while todo:
        pid = todo.pop()
        found.append(pid)
        todo += kids.get(pid, [])
    return found


def args(pid):
    try:
        return open(f"/proc/{pid}/cmdline").read().split("\0")
    except OSError:
        return []


def kind(pid):
    line = args(pid)
    kind = next((a.split("=", 1)[1] for a in line if a.startswith("--type=")), None)
    name = os.path.basename(line[0]) if line and line[0] else "?"
    return f"{name}:{kind}" if kind else name


def ticks(pid):
    try:
        rest = stat(f"/proc/{pid}/stat")[1]
        return int(rest[11]) + int(rest[12])
    except (OSError, ValueError, IndexError):
        return None


def threads(pid):
    found = {}
    try:
        for tid in os.listdir(f"/proc/{pid}/task"):
            try:
                name, rest = stat(f"/proc/{pid}/task/{tid}/stat")
                found[(tid, name)] = int(rest[11]) + int(rest[12])
            except (OSError, ValueError, IndexError):
                pass
    except OSError:
        pass
    return found


pids = tree()
before = {pid: ticks(pid) for pid in pids}
before_threads = {pid: threads(pid) for pid in pids}
time.sleep(SPAN)
total, kinds, busy = 0.0, {}, []
for pid in pids:
    after = ticks(pid)
    if before[pid] is None or after is None:
        continue
    used = (after - before[pid]) / HZ / SPAN * 100
    total += used
    kinds[kind(pid)] = kinds.get(kind(pid), 0) + used
    for key, now in threads(pid).items():
        share = (now - before_threads[pid].get(key, now)) / HZ / SPAN * 100
        if share >= 0.5:
            busy.append((share, kind(pid), key[1]))
print(f"idle: {total:.1f}% of one core over {SPAN:.0f} s, {len(pids)} processes")
for name, used in sorted(kinds.items(), key=lambda one: -one[1]):
    print(f"  {used:6.1f}%  {name}")
for share, name, thread in sorted(busy, reverse=True)[:10]:
    print(f"    {share:5.1f}%  {name} / {thread}")
for pid in pids:
    if kind(pid).endswith(":gpu-process"):
        print("  gpu process:", " ".join(a for a in args(pid) if any(w in a for w in ("gl", "angle", "gpu", "vulkan", "ozone"))))
if total > MOST:
    print(f"::error::idle, Orden used {total:.0f}% of a core, more than {MOST:.0f}%")
    sys.exit(1)
