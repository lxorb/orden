from __future__ import annotations

import pathlib
import shutil
import subprocess
import sys
import time


def fresh(folder: pathlib.Path, seconds: float = 30) -> None:
    until = time.monotonic() + seconds
    while folder.exists() and time.monotonic() < until:
        shutil.rmtree(folder, ignore_errors=True)
        if folder.exists():
            time.sleep(0.5)
    folder.mkdir(parents=True, exist_ok=True)


def ended(process: subprocess.Popen[bytes], seconds: float = 20, gentle: bool = False) -> None:
    if sys.platform == "win32" and process.poll() is None:
        subprocess.run(["taskkill", "/T", "/F", "/PID", str(process.pid)], capture_output=True, check=False)
    elif gentle and process.poll() is None:
        process.terminate()
        try:
            process.wait(seconds)
            return
        except subprocess.TimeoutExpired:
            pass
    process.kill()
    process.wait(seconds)
