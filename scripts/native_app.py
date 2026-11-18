import json
import os
import pathlib
import sys
import time
import urllib.error
import urllib.request
from typing import Any

import crash_told

def config_of(identifier: str) -> pathlib.Path:
    if sys.platform == "win32":
        return pathlib.Path(os.environ["APPDATA"]) / identifier
    if sys.platform == "darwin":
        return pathlib.Path.home() / "Library" / "Application Support" / identifier
    return pathlib.Path(os.environ.get("XDG_CONFIG_HOME") or pathlib.Path.home() / ".config") / identifier

def failed(said: Any) -> bool:
    return said in (None, False) or (isinstance(said, dict) and "error" in said)

class App:
    def __init__(self, port: int, secret: str, patience: float = 20) -> None:
        self.port, self.secret, self.patience = port, secret, patience

    def answer(self, code: str, seconds: float | None = None, verb: str = "eval", args: dict[str, Any] | None = None) -> dict[str, Any]:
        body = json.dumps({"verb": verb, "args": args or {"code": code, "yes": True}, "rest": []}).encode()
        asked = urllib.request.Request(
            f"http://127.0.0.1:{self.port}/",
            data=body,
            headers={"authorization": f"Bearer {self.secret}", "content-type": "application/json"},
        )
        try:
            with urllib.request.urlopen(asked, timeout=seconds or self.patience) as said:
                return json.loads(said.read().decode("utf-8", "replace"))
        except urllib.error.HTTPError as error:
            return {"error": f"{error.code} {error.read().decode('utf-8', 'replace')[:400]}"}
        except (urllib.error.URLError, TimeoutError, OSError, ValueError) as error:
            return {"error": str(error)}

    def eval(self, code: str, seconds: float | None = None) -> Any:
        said = self.answer(code, seconds)
        return said.get("value") if said.get("ok", said.get("status") == "ok") else said

    def until(self, code: str, seconds: float = 30, every: float = 0.25) -> Any:
        last: Any = None
        stop = time.monotonic() + seconds
        while time.monotonic() < stop:
            last = self.eval(code)
            if not failed(last):
                return last
            time.sleep(every)
        return None if isinstance(last, dict) else last

def endpoint(config: pathlib.Path, pid: int, secret: str, patience: float = 20, seconds: float = 120) -> App:
    path = config / "automation.json"
    stop = time.monotonic() + seconds
    while time.monotonic() < stop:
        try:
            said = json.loads(path.read_text(encoding="utf-8-sig"))
            if said.get("port") and int(said.get("pid") or 0) == pid:
                crash_told.told(int(said["port"]), secret)
                return App(int(said["port"]), secret, patience)
        except (OSError, ValueError):
            pass
        time.sleep(0.25)
    raise SystemExit(f"the app never wrote {path}")

INNER = (
    "const i = window.__TAURI_INTERNALS__;"
    "const at = await i.invoke('plugin:window|inner_position', { label: 'main' });"
    "const scale = await i.invoke('plugin:window|scale_factor', { label: 'main' });"
    "return { x: at.x, y: at.y, scale, ratio: devicePixelRatio }"
)

def forward(app: App, pid: int) -> None:
    app.eval("await window.__TAURI_INTERNALS__.invoke('plugin:window|set_focus', { label: 'main' }); return true")
    if sys.platform != "win32":
        return
    import ctypes

    from probe_app import main_window

    user32 = ctypes.WinDLL("user32", use_last_error=True)
    hwnd = main_window(pid)
    theirs = user32.GetWindowThreadProcessId(user32.GetForegroundWindow(), None)
    ours = ctypes.windll.kernel32.GetCurrentThreadId()
    user32.AttachThreadInput(ours, theirs, True)
    user32.ShowWindow(hwnd, 9)
    user32.SetForegroundWindow(hwnd)
    user32.BringWindowToTop(hwnd)
    user32.AttachThreadInput(ours, theirs, False)

def known(issue: int, what: str) -> None:
    print(f"::warning::known (#{issue}): {what}", flush=True)
