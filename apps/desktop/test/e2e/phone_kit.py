from __future__ import annotations
import json
import os
import re
import shutil
import subprocess
import time
import urllib.request
from collections.abc import Callable
from pathlib import Path
from typing import Any
import harness

PORT = 8799
ACTIVITY = "so.orden.Orden.MainActivity"
GRADLE = harness.APP / "src-tauri" / "gen" / "android" / "app" / "build.gradle.kts"
ROW = re.compile(r'"(\w+)" to Triple\("([^"]+)", "([^"]+)", "([^"]+)"\)')
SHOWN = re.compile(
    r"type=ime\s+frame=\[\d+,(\d+)\]\[\d+,(\d+)\](?:\s+visibleFrame=\S+)?\s+visible=true"
    r"|mType=ime\s+mFrame=\[\d+,(\d+)\]\[\d+,(\d+)\]\s+mVisible=true"
)
WHERE = """((selectors) => {
  const root = document.documentElement
  const box = (one) => {
    const found = document.querySelector(one)
    if (!found) return null
    const rect = found.getBoundingClientRect()
    return [Math.round(rect.top), Math.round(rect.bottom)]
  }
  return JSON.stringify({
    boxes: Object.fromEntries(selectors.map((one) => [one, box(one)])),
    keyboard: parseFloat(getComputedStyle(root).getPropertyValue('--keyboard')) || 0,
    inner: innerHeight,
    visual: Math.round(visualViewport.height),
    ratio: devicePixelRatio,
  })
})"""
say = harness.say
def packages() -> dict[str, str]:
    return {app: package for app, package, _, _ in ROW.findall(GRADLE.read_text(encoding="utf-8"))}
def crashes(log: str, package: str) -> list[str]:
    lines = log.splitlines()
    ours = re.compile(rf"\b{re.escape(package)}(?![\w.])")
    found = []
    for at, line in enumerate(lines):
        if "FATAL EXCEPTION" in line:
            if any(f"Process: {package}," in one for one in lines[at : at + 4]):
                found.append(f"crash: {' / '.join(one.split(': ', 1)[-1].strip() for one in lines[at : at + 4])}")
        elif "Fatal signal" in line:
            if line.rstrip().endswith((f"({package})", f"({package[-15:]})", f"({package[:15]})")):
                found.append(f"signal: {line.split(': ', 1)[-1].strip()}")
        elif re.search(r"\bANR in ", line):
            if ours.search(line.split("ANR in ", 1)[1]):
                found.append(f"ANR: {line.split(': ', 1)[-1].strip()}")
        elif "panicked at" in line:
            found.append(f"panic: {line.split(': ', 1)[-1].strip()}")
    return found
def adb(*args: str, check: bool = True) -> str:
    done = subprocess.run(["adb", *args], capture_output=True, text=True, errors="replace", timeout=180, check=False)
    if check and done.returncode != 0:
        raise SystemExit(f"adb {' '.join(args)} failed:\n{done.stdout}\n{done.stderr}")
    return done.stdout
def screen() -> tuple[int, int]:
    across, down = adb("shell", "wm", "size").strip().split()[-1].split("x")
    return int(across), int(down)
def keys_top() -> int | None:
    for found in SHOWN.finditer(adb("shell", "dumpsys", "window", check=False)):
        top, bottom = (int(one) for one in found.groups() if one is not None)
        if bottom > top:
            return top
    return None
def keys_come(patience: float) -> int | None:
    until = time.monotonic() + patience
    while time.monotonic() < until:
        top = keys_top()
        if top is not None:
            time.sleep(1.5)
            return keys_top() or top
        time.sleep(0.5)
    return None
def keys_gone(patience: float) -> bool:
    until = time.monotonic() + patience
    while time.monotonic() < until:
        if keys_top() is None:
            return True
        time.sleep(0.5)
    return False
class Page:
    def __init__(self) -> None:
        self.socket: Any = None
        self.count = 0
    def connect(self) -> None:
        import websocket
        until = time.monotonic() + 120
        name = None
        while time.monotonic() < until and not name:
            found = re.search(r"webview_devtools_remote_\d+", adb("shell", "cat", "/proc/net/unix", check=False))
            name = found.group(0) if found else None
            if not name:
                time.sleep(1)
        if not name:
            raise SystemExit("the web view offers no devtools socket")
        adb("forward", "tcp:9222", f"localabstract:{name}")
        until = time.monotonic() + 60
        target = None
        while time.monotonic() < until and not target:
            try:
                pages = json.loads(harness.opened(urllib.request.Request("http://127.0.0.1:9222/json"), timeout=5))
            except OSError:
                pages = []
            target = next(
                (one for one in pages if one.get("type") == "page" and "localhost" in one.get("url", "")), None
            )
            if not target:
                time.sleep(1)
        if not target:
            raise SystemExit("the app's page is not among the web view's targets")
        self.socket = websocket.create_connection(target["webSocketDebuggerUrl"], timeout=60, suppress_origin=True)
    def send(self, method: str, params: dict[str, Any] | None = None) -> dict[str, Any]:
        self.count += 1
        mine = self.count
        self.socket.send(json.dumps({"id": mine, "method": method, "params": params or {}}))
        while True:
            answer = json.loads(self.socket.recv())
            if answer.get("id") != mine:
                continue
            if "error" in answer:
                raise RuntimeError(json.dumps(answer["error"])[:600])
            return answer.get("result", {})
    def evaluate(self, expression: str) -> Any:
        result = self.send(
            "Runtime.evaluate", {"expression": expression, "awaitPromise": True, "returnByValue": True}
        )
        if "exceptionDetails" in result:
            raise RuntimeError(json.dumps(result["exceptionDetails"])[:600])
        return result.get("result", {}).get("value")
    def wait_for(self, expression: str, what: str, patience: float = 60) -> Any:
        until = time.monotonic() + patience
        last = None
        while time.monotonic() < until:
            try:
                last = self.evaluate(expression)
            except RuntimeError as error:
                last = f"threw {error}"
            else:
                if last:
                    return last
            time.sleep(0.5)
        raise SystemExit(f"gave up waiting for {what}; last: {last!r}")
    def where(self, selectors: list[str]) -> dict[str, Any]:
        return json.loads(self.evaluate(f"{WHERE}({json.dumps(selectors)})"))
    def tap(self, selector: str) -> None:
        said = self.where([selector])
        box = said["boxes"][selector]
        if not box:
            raise SystemExit(f"nothing to tap at {selector}")
        adb("shell", "input", "tap", str(screen()[0] // 2), str(int((box[0] + box[1]) / 2 * said["ratio"])))
class Phone:
    def __init__(self, file: str, app: str) -> None:
        self.app = app
        self.package = packages()[app]
        self.drive = harness.Drive(file, served=False)
        self.shots = self.drive.shots
        self.say, self.wrong = self.drive.say, self.drive.wrong
        self.apk = Path(os.environ.get(f"ORDEN_{app.upper()}_APK", harness.ROOT / "out" / f"{app}.apk"))
        self.page = Page()
    def shot(self, name: str) -> None:
        self.shots.mkdir(parents=True, exist_ok=True)
        taken = subprocess.run(["adb", "exec-out", "screencap", "-p"], capture_output=True, timeout=60, check=False)
        (self.shots / f"{name}.png").write_bytes(taken.stdout)
        say(f"shot {name}.png")
    def above_keys(self, name: str, field: str, others: list[str]) -> None:
        page = self.page
        page.evaluate(f"document.querySelector({json.dumps(field)})?.focus()")
        top = keys_come(8)
        if top is None:
            page.tap(field)
            top = keys_come(15)
        if top is None:
            raise SystemExit(f"{name}: the keyboard never came up")
        time.sleep(1)
        said = page.where([field, *others])
        edge = top / said["ratio"]
        self.shot(name)
        say(f"{name}: the keyboard's top is at {edge:.0f} of {said['inner']}; {json.dumps(said)}")
        for selector, box in said["boxes"].items():
            if not box:
                self.wrong(f"{name}: {selector} is not there")
            elif box[1] > edge + 1:
                self.wrong(f"{name}: {selector} ends at {box[1]}, under the keyboard that starts at {edge:.0f}")
        covered = said["inner"] - edge
        if abs(said["keyboard"] - covered) > 2:
            told = said["keyboard"]
            self.wrong(f"{name}: the page was told of {told}px of keyboard, and {covered:.0f}px are covered")
    def keys_down(self, name: str) -> None:
        page = self.page
        page.evaluate("document.activeElement?.blur()")
        if not keys_gone(8):
            adb("shell", "input", "keyevent", "4")
            if not keys_gone(15):
                raise SystemExit(f"{name}: the keyboard would not go down")
        try:
            page.wait_for(f"{WHERE}([]).includes('\"keyboard\":0,')", "the page to hear the keyboard went", 15)
        except SystemExit:
            self.wrong(f"{name}: the keyboard is down and the page still says {page.where([])['keyboard']}px")
    def started(self) -> None:
        adb("install", "-r", str(self.apk))
        for round in range(4):
            adb("shell", "am", "start", "-W", "-n", f"{self.package}/{ACTIVITY}")
            time.sleep(45)
            if adb("shell", "pidof", self.package, check=False).strip():
                say(f"the app stayed up on start {round + 1}")
                return
            say(f"the app was gone after start {round + 1}; starting it again")
        raise SystemExit("the app never stayed up")
    def missing(self) -> str:
        if not shutil.which("adb") or adb("get-state", check=False).strip() != "device":
            return "no Android device or emulator answers adb"
        if not self.apk.is_file():
            return f"no debug APK of {self.app} at {self.apk} (ORDEN_{self.app.upper()}_APK)"
        return ""
    def run(self, steps: Callable[[harness.Worker], None], seed: Callable[[harness.Worker], None], passed: str) -> int:
        why = self.missing()
        if why:
            say(f"SKIPPED: {why}")
            return 0
        harness.worker_port = lambda: PORT
        worker = harness.Worker(self.drive)
        self.shots.mkdir(parents=True, exist_ok=True)
        try:
            worker.start()
            seed(worker)
            adb("reverse", f"tcp:{PORT}", f"tcp:{PORT}")
            adb("logcat", "-c")
            self.started()
            self.page.connect()
            steps(worker)
        finally:
            log = adb("logcat", "-d", check=False)
            (self.shots / "logcat.log").write_text(log, encoding="utf-8", errors="replace")
            (self.shots / "windows.txt").write_text(adb("shell", "dumpsys", "window", check=False), encoding="utf-8")
            for one in crashes(log, self.package):
                self.wrong(one)
            worker.close()
        return self.drive.verdict(passed)
