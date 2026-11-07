from __future__ import annotations

import argparse
import ctypes
import json
import os
import pathlib
import shutil
import struct
import subprocess
import sys
import time
import urllib.error
import urllib.request

from probe_app import identifier_of, run_probe, sized

HERE = pathlib.Path(__file__).resolve().parent
ROOT = HERE.parent
WORK = ROOT / "target" / "capture-e2e"
SHOTS = WORK / "shots"

failures: list[str] = []

def say(what: str) -> None:
    print(f"  {what}", flush=True)

def wrong(what: str) -> None:
    failures.append(what)
    print(f"  FAIL {what}", flush=True)

user32 = ctypes.windll.user32 if sys.platform == "win32" else None

class Rect(ctypes.Structure):
    _fields_ = [("left", ctypes.c_long), ("top", ctypes.c_long), ("right", ctypes.c_long), ("bottom", ctypes.c_long)]

def in_front() -> int:
    assert user32
    return int(user32.GetForegroundWindow())

def windows_of(pid: int) -> list[tuple[int, int, int, int, int]]:
    assert user32
    found: list[tuple[int, int, int, int, int]] = []

    @ctypes.WINFUNCTYPE(ctypes.c_bool, ctypes.c_void_p, ctypes.c_void_p)
    def each(hwnd, _param):  # noqa: ANN001, ANN202
        owner = ctypes.c_ulong()
        user32.GetWindowThreadProcessId(hwnd, ctypes.byref(owner))
        if owner.value != pid or not user32.IsWindowVisible(hwnd):
            return True

        box = Rect()
        user32.GetWindowRect(hwnd, ctypes.byref(box))
        wide = box.right - box.left
        tall = box.bottom - box.top
        if wide > 200 and tall > 200:
            found.append((int(hwnd), box.left, box.top, wide, tall))

        return True

    user32.EnumWindows(each, None)
    return sorted(found, key=lambda one: -one[3])

def off_the_screen(hwnd: int, out: pathlib.Path) -> bool:
    ran = subprocess.run(
        [
            shutil.which("powershell") or "powershell",
            "-NoProfile",
            "-ExecutionPolicy",
            "Bypass",
            "-Command",
            "Add-Type -AssemblyName System.Drawing;"
            "Add-Type @'\nusing System;using System.Runtime.InteropServices;\n"
            "public class Grab{[StructLayout(LayoutKind.Sequential)]public struct RECT"
            "{public int Left,Top,Right,Bottom;}"
            '[DllImport("user32.dll")]public static extern bool GetWindowRect(IntPtr h,out RECT r);}\n'
            "'@;"
            f"$r=New-Object Grab+RECT;[void][Grab]::GetWindowRect([IntPtr]{hwnd},[ref]$r);"
            "$b=New-Object System.Drawing.Bitmap ($r.Right-$r.Left),($r.Bottom-$r.Top);"
            "$g=[System.Drawing.Graphics]::FromImage($b);"
            "$g.CopyFromScreen($r.Left,$r.Top,0,0,$b.Size);"
            f'$b.Save("{out.as_posix()}",[System.Drawing.Imaging.ImageFormat]::Png);'
            "$g.Dispose();$b.Dispose();'copied'",
        ],
        capture_output=True,
        text=True,
        check=False,
        timeout=120,
    )

    return out.exists() and ran.returncode == 0

def endpoint_of(identifier: str) -> pathlib.Path:
    return pathlib.Path(os.environ["APPDATA"]) / identifier / "automation.json"

def start(app: pathlib.Path, label: str) -> subprocess.Popen[bytes]:
    spaces = WORK / label / "spaces"
    spaces.mkdir(parents=True, exist_ok=True)

    return run_probe(app, env={**os.environ, "ORDEN_SPACES_DIR": str(spaces)})

def waited_for(path: pathlib.Path, patience: float = 60) -> dict:
    until = time.monotonic() + patience
    while time.monotonic() < until:
        try:
            held = json.loads(path.read_text(encoding="utf-8"))
            if held.get("port") and held.get("secret"):
                return held
        except (OSError, ValueError):
            pass
        time.sleep(0.4)

    raise SystemExit(f"no endpoint at {path} after {patience:.0f}s")

def asked(held: dict, verb: str, args: dict | None = None) -> dict:
    body = json.dumps({"verb": verb, "args": args or {}, "rest": []}).encode()
    request = urllib.request.Request(
        f"http://127.0.0.1:{held['port']}/",
        data=body,
        headers={
            "authorization": f"Bearer {held['secret']}",
            "content-type": "application/json",
        },
    )

    with urllib.request.urlopen(request, timeout=20) as answer:
        return json.loads(answer.read().decode())

def capture(pid: int, out: pathlib.Path) -> str:
    ran = subprocess.run(
        [
            shutil.which("powershell") or "powershell",
            "-NoProfile",
            "-ExecutionPolicy",
            "Bypass",
            "-File",
            str(HERE / "capture-window.ps1"),
            "-ProcessId",
            str(pid),
            "-Out",
            str(out),
        ],
        capture_output=True,
        text=True,
        check=False,
        timeout=120,
    )
    if ran.returncode != 0:
        wrong(f"the capture of {pid} failed: {ran.stderr.strip()}")
        return ""

    return ran.stdout.strip()

def size_of(png: pathlib.Path) -> tuple[int, int]:
    held = png.read_bytes()
    wide, tall = struct.unpack(">II", held[16:24])
    return wide, tall

def ink_of(png: pathlib.Path) -> int:
    return hash(png.read_bytes())

def drive(apps: list[pathlib.Path], given: list[str]) -> None:
    running: list[tuple[str, subprocess.Popen[bytes], dict]] = []

    try:
        for at, app in enumerate(apps):
            label = "ab"[at]
            identifier = identifier_of(app, given[at] if at < len(given) else None)
            endpoint = endpoint_of(identifier)
            endpoint.unlink(missing_ok=True)

            process = start(app, label)
            held = waited_for(endpoint)
            running.append((label, process, held))
            say(f"[{label}] {identifier} is up on port {held['port']}, pid {held.get('pid')}")

            if held.get("pid") != process.pid:
                wrong(f"[{label}] the endpoint says pid {held.get('pid')}, the process is {process.pid}")

        time.sleep(2.5)

        first = windows_of(running[0][1].pid)
        second = windows_of(running[1][1].pid)
        if not first or not second:
            wrong(f"a window is missing: {len(first)} and {len(second)}")
            return

        sized(first[0][0], 1000, 700)
        sized(second[0][0], 760, 560)
        time.sleep(1.5)

        before = in_front()
        SHOTS.mkdir(parents=True, exist_ok=True)
        pictures: dict[str, pathlib.Path] = {}

        for label, process, held in running:
            out = SHOTS / f"{label}.png"
            said = capture(process.pid, out)
            say(f"[{label}] {said}")
            if not out.exists():
                wrong(f"[{label}] no picture was written")
                continue

            pictures[label] = out
            wide, tall = size_of(out)
            window = windows_of(process.pid)[0]
            if (wide, tall) != (window[3], window[4]):
                wrong(f"[{label}] the picture is {wide}x{tall}, the window is {window[3]}x{window[4]}")
            else:
                say(f"[{label}] the picture is the size of its own window: {wide}x{tall}")

        after = in_front()
        if before != after:
            wrong(f"the window in front changed: {before} then {after}")
        else:
            say("the window in front is the same one before and after")

        if len(pictures) == 2 and size_of(pictures["a"]) == size_of(pictures["b"]):
            wrong("both pictures are the same shape, so one window was photographed twice")
        elif len(pictures) == 2:
            say("the two pictures are two different windows, by their own two shapes")

        screen = SHOTS / "a-off-the-screen.png"
        if not off_the_screen(first[0][0], screen):
            say("the screen could not be copied here, which is answer enough on its own")
        elif ink_of(screen) == ink_of(pictures["a"]):
            wrong("the capture is the same as a copy of the screen, so it is not the window")
        else:
            say(f"a copy of the screen is a different picture ({screen.stat().st_size} bytes)")

    finally:
        for _label, process, _held in running:
            process.terminate()
        time.sleep(1.0)

def main() -> int:
    if sys.platform != "win32":
        print("this drive is about the Windows capture", flush=True)
        return 0

    parser = argparse.ArgumentParser()
    parser.add_argument("--app", action="append", required=True, type=pathlib.Path)
    parser.add_argument("--identifier", action="append", default=[])
    asked_for = parser.parse_args()

    if len(asked_for.app) != 2:
        raise SystemExit("two apps, each built with an identifier of its own")

    shutil.rmtree(SHOTS, ignore_errors=True)
    drive([one.resolve() for one in asked_for.app], asked_for.identifier)

    if failures:
        print("\n%d thing(s) wrong:" % len(failures))
        for one in failures:
            print(f"  - {one}")
        return 1

    print("\nthe picture is of the window that answered, and nothing was raised to take it")
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
