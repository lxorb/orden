"""Run the endpoint-only drives of the sway suites against a Windows build.

The sway launcher's CLOSING and DOWNLOAD suites need nothing of the desktop but the app's
automation endpoint, so they run here as they do there: a fresh profile, the endpoint
asked for, the first-start question answered, and for CLOSING the app started again
between the two halves. The other suites (OPENS, CHOOSING, SESSION, CARRY, DRAG) move the
pointer or read the windows through sway or X, and are not run here.

    python scripts/windows-suite.py --exe <orden.exe> --identifier <id> --out <folder> closing download
"""
from __future__ import annotations
import argparse
import json
import os
import pathlib
import secrets
import shutil
import subprocess
import sys
import tempfile
import time
from typing import Any

HERE = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from fresh_app import ended, fresh  # noqa: E402
from native_app import config_of, endpoint  # noqa: E402

SUITES = ("closing", "download")
class Launch:
    def __init__(self, exe: pathlib.Path, identifier: str, out: pathlib.Path, environment: dict[str, str], args: list[str]) -> None:
        self.exe, self.identifier, self.out, self.environment, self.args = exe, identifier, out, environment, args
        self.config = config_of(identifier)
        self.process: subprocess.Popen[bytes] | None = None
        self.log = open(out / "app.log", "ab")
    def start(self) -> None:
        secret = secrets.token_hex(32)
        self.config.mkdir(parents=True, exist_ok=True)
        (self.config / "automation.json").write_text(json.dumps({"port": 0, "secret": secret, "eval": True, "pid": 0}), encoding="utf-8")
        self.process = subprocess.Popen([str(self.exe), *self.args], env=self.environment, cwd=str(self.exe.parent), stdout=self.log, stderr=subprocess.STDOUT)
        endpoint(self.config, self.process.pid, secret, 30)
        time.sleep(3)
    def stop(self) -> None:
        if self.process is not None:
            ended(self.process, gentle=True)
            self.process = None
    def again(self) -> None:
        self.stop()
        time.sleep(2)
        self.start()
def drive(script: str, *words: str, environment: dict[str, str]) -> bool:
    print(f"-- {script} {' '.join(words)}", flush=True)
    return subprocess.run([sys.executable, str(HERE / script), *words], env=environment, check=False).returncode == 0
def suite(name: str, args: argparse.Namespace) -> bool:
    out = args.out / name
    out.mkdir(parents=True, exist_ok=True)
    fresh(config_of(args.identifier))
    spaces = pathlib.Path(tempfile.mkdtemp(prefix=f"orden-{name}-spaces-"))
    environment = {
        **os.environ,
        "ORDEN_SPACES_DIR": str(spaces),
        "XDG_CONFIG_HOME": os.environ["APPDATA"],
        "DRIVEN_ID": args.identifier,
    }
    server: subprocess.Popen[bytes] | None = None
    app_args: list[str] = []
    if name == "download":
        downloads = out / "downloads"
        downloads.mkdir(parents=True, exist_ok=True)
        environment["ORDEN_DOWNLOADS_DIR"] = str(downloads.resolve())
        server = subprocess.Popen([sys.executable, str(HERE / "download-server.py"), "8765", str(out / "served.txt")], stdout=subprocess.DEVNULL, stderr=subprocess.STDOUT)
        app_args = ["http://127.0.0.1:8765/"]
    app = Launch(args.exe, args.identifier, out, environment, app_args)
    ok = False
    try:
        app.start()
        if name == "closing":
            ok = drive("closing-drive.py", str(out), "open", environment=environment)
            if ok:
                time.sleep(10)
                app.again()
                ok = drive("closing-drive.py", str(out), "close", environment=environment)
        else:
            ok = drive("download-drive.py", str(out), environment["ORDEN_DOWNLOADS_DIR"], str(out / "served.txt"), environment=environment)
    except SystemExit as stopped:
        print(f"::error::{name}: {stopped}", flush=True)
    finally:
        app.stop()
        if server is not None:
            ended(server)
        shutil.rmtree(spaces, ignore_errors=True)
    print(f"{name}: {'passed' if ok else 'FAILED'}", flush=True)
    return ok
def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--exe", required=True, type=pathlib.Path)
    parser.add_argument("--identifier", required=True)
    parser.add_argument("--out", required=True, type=pathlib.Path)
    parser.add_argument("suites", nargs="*", default=list(SUITES))
    args = parser.parse_args()
    if sys.platform != "win32":
        raise SystemExit("this runs the suites against a Windows build")
    if "probe" not in args.identifier:
        raise SystemExit(f"{args.identifier} is not a probe identifier")
    failed: list[Any] = [one for one in args.suites if not suite(one, args)]
    (args.out / "failed.txt").write_text("\n".join(failed), encoding="utf-8")
    return 1 if failed else 0
if __name__ == "__main__":
    raise SystemExit(main())
