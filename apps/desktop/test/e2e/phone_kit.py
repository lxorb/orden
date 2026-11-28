from __future__ import annotations
import json
import os
import re
import shutil
import subprocess
import time
import urllib.request
from collections.abc import Callable, Mapping
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
PROBE = """(() => {
  const TAPS = 'button, a[href], input:not([type=hidden]), select, textarea, summary, [role=button], [role=link],' +
    ' [role=tab], [role=menuitem], [role=menuitemcheckbox], [role=menuitemradio], [role=option], [role=checkbox],' +
    ' [role=radio], [role=switch], [role=treeitem], [onclick], [tabindex]:not([tabindex="-1"])'
  const style = (el) => getComputedStyle(el)
  const seen = (el) => {
    const rect = el.getBoundingClientRect()
    const drawn = style(el)
    return rect.width > 0 && rect.height > 0 && drawn.visibility !== 'hidden' && rect.bottom > 0 &&
      rect.top < innerHeight && rect.right > 0 && rect.left < innerWidth
  }
  const onTop = (el, rect = el.getBoundingClientRect()) => {
    const x = Math.min(innerWidth - 1, Math.max(0, rect.left + rect.width / 2))
    const y = Math.min(innerHeight - 1, Math.max(0, rect.top + rect.height / 2))
    const hit = document.elementFromPoint(x, y)
    return !!hit && (el === hit || el.contains(hit) || hit.contains(el))
  }
  const named = (el) => {
    const kind = typeof el.className === 'string' && el.className.trim()
      ? '.' + el.className.trim().split(/\\s+/).slice(0, 2).join('.') : ''
    const words = (el.getAttribute('aria-label') || el.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 30)
    return `${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}${kind} "${words}"`
  }
  const all = [...document.querySelectorAll('body *')].filter(seen)
  const small = all
    .filter((el) => el.matches(TAPS) && !el.matches(':disabled, [aria-disabled=true]') && onTop(el))
    .filter((el) => !(el.tagName === 'A' && style(el).display.startsWith('inline')))
    .map((el) => [el, el.getBoundingClientRect()])
    .filter(([, rect]) => rect.width < 47.5 || rect.height < 47.5)
    .map(([el, rect]) => `${named(el)} is ${Math.round(rect.width)} by ${Math.round(rect.height)}`)
  const taps = all
    .filter((el) => el.matches(TAPS) && !el.matches(':disabled, [aria-disabled=true]') && onTop(el))
    .map((el) => [el, el.getBoundingClientRect()])
  const crowded = []
  for (let a = 0; a < taps.length; a++) {
    for (let b = a + 1; b < taps.length; b++) {
      const [one, first] = taps[a]
      const [other, second] = taps[b]
      if (one.contains(other) || other.contains(one)) continue
      const wide = Math.min(first.right, second.right) - Math.max(first.left, second.left)
      const tall = Math.min(first.bottom, second.bottom) - Math.max(first.top, second.top)
      if (wide > 1 && tall > 1) crowded.push(`${named(one)} over ${named(other)}`)
    }
  }
  const texts = all
    .filter((el) => [...el.childNodes].some((node) => node.nodeType === 3 && node.textContent.trim()))
    .map((el) => {
      const range = document.createRange()
      range.selectNodeContents(el)
      return [el, range.getBoundingClientRect()]
    })
    .filter(([el, rect]) => rect.width > 0 && rect.height > 0 && onTop(el, rect))
  const meant = (drawn) => drawn.textOverflow === 'ellipsis' || (drawn.webkitLineClamp || 'none') !== 'none'
  const rolls = (value) => value === 'auto' || value === 'scroll'
  const clipped = texts.filter(([el, rect]) => {
    if (meant(style(el))) return false
    for (let up = el; up && up !== document.documentElement; up = up.parentElement) {
      const drawn = style(up)
      if (up !== el && meant(drawn)) return false
      if (rolls(drawn.overflowX) || rolls(drawn.overflowY)) return false
      if (drawn.overflowX === 'visible' && drawn.overflowY === 'visible') continue
      const box = up.getBoundingClientRect()
      if (drawn.overflowX !== 'visible' && (rect.right > box.right + 1 || rect.left < box.left - 1)) return true
      if (drawn.overflowY !== 'visible' && (rect.bottom > box.bottom + 1 || rect.top < box.top - 1)) return true
    }
    return rect.right > innerWidth + 1 || rect.left < -1
  }).map(([el]) => named(el))
  const lines = (el) => {
    const range = document.createRange()
    range.selectNodeContents(el)
    return [...range.getClientRects()].filter((rect) => rect.width > 0 && rect.height > 0)
  }
  const crossing = (one, other) =>
    lines(one).some((first) =>
      lines(other).some(
        (second) =>
          Math.min(first.right, second.right) - Math.max(first.left, second.left) > 2 &&
          Math.min(first.bottom, second.bottom) - Math.max(first.top, second.top) > 2,
      ),
    )
  const overlapping = []
  for (let a = 0; a < texts.length; a++) {
    for (let b = a + 1; b < texts.length; b++) {
      const [one, first] = texts[a]
      const [other, second] = texts[b]
      if (one.contains(other) || other.contains(one)) continue
      const wide = Math.min(first.right, second.right) - Math.max(first.left, second.left)
      const tall = Math.min(first.bottom, second.bottom) - Math.max(first.top, second.top)
      if (wide > 2 && tall > 2 && crossing(one, other)) overlapping.push(`${named(one)} over ${named(other)}`)
    }
  }
  const context = Object.assign(document.createElement('canvas'), { width: 1, height: 1 })
    .getContext('2d', { willReadFrequently: true })
  const laid = (colors, last, alpha) => {
    context.globalAlpha = 1
    context.fillStyle = '#fff'
    context.fillRect(0, 0, 1, 1)
    for (const color of colors) {
      context.fillStyle = color
      context.fillRect(0, 0, 1, 1)
    }
    if (last) {
      context.globalAlpha = alpha
      context.fillStyle = last
      context.fillRect(0, 0, 1, 1)
    }
    return [...context.getImageData(0, 0, 1, 1).data].slice(0, 3)
  }
  const light = (rgb) => {
    const [r, g, b] = rgb.map((one) => {
      const part = one / 255
      return part <= 0.03928 ? part / 12.92 : ((part + 0.055) / 1.055) ** 2.4
    })
    return 0.2126 * r + 0.7152 * g + 0.0722 * b
  }
  const faint = new Map()
  let unknown = 0
  for (const [el] of texts) {
    if (el.closest(':disabled, [aria-disabled=true]')) continue
    const grounds = []
    let alpha = 1
    let pictured = false
    for (let up = el; up; up = up.parentElement) {
      const drawn = style(up)
      if (drawn.backgroundImage !== 'none') pictured = true
      grounds.unshift(drawn.backgroundColor)
      alpha *= Number(drawn.opacity)
    }
    if (pictured) {
      unknown++
      continue
    }
    const drawn = style(el)
    const ground = light(laid(grounds))
    const ink = light(laid(grounds, drawn.color, alpha))
    const ratio = (Math.max(ground, ink) + 0.05) / (Math.min(ground, ink) + 0.05)
    const size = parseFloat(drawn.fontSize)
    const large = size >= 24 || (size >= 18.66 && Number(drawn.fontWeight) >= 700)
    const under = grounds.filter((one) => one !== 'rgba(0, 0, 0, 0)').at(-1)
    if (ratio < (large ? 3 : 4.5)) faint.set(`${drawn.color} on ${under}`, `${named(el)} at ${ratio.toFixed(2)}`)
  }
  return JSON.stringify({
    small,
    crowded,
    clipped,
    overlapping,
    faint: [...faint.values()],
    unknown,
    wide: document.documentElement.scrollWidth > innerWidth + 1,
    dark: matchMedia('(prefers-color-scheme: dark)').matches,
    ratio: devicePixelRatio,
    inner: [innerWidth, innerHeight],
    text: (() => {
      const probe = document.body.appendChild(document.createElement('span'))
      probe.style.cssText = 'position:fixed;left:0;top:0;visibility:hidden;font:16px/1 sans-serif'
      probe.textContent = 'Orden'
      const tall = probe.getBoundingClientRect().height
      probe.remove()
      return tall
    })(),
  })
})()"""
CONTROLS = {
    "button",
    "link",
    "textbox",
    "searchbox",
    "checkbox",
    "radio",
    "switch",
    "tab",
    "menuitem",
    "menuitemcheckbox",
    "menuitemradio",
    "combobox",
    "slider",
    "spinbutton",
}
PAINTED = """(() => {
  const shell = performance.getEntriesByName('orden: shell painted')[0]
  const frame = performance.getEntriesByName('orden: first frame painted')[0]
  const at = (mark) => (mark ? performance.timeOrigin + mark.startTime : null)
  return frame ? JSON.stringify([at(shell), at(frame)]) : null
})()"""
FLINGS = 5
NIGHT = os.environ.get("ORDEN_PHONE_NIGHT") == "true"
OPENS = 50
AWAY = 120
WATCHED = 60
STARTS = 20
say = harness.say
def ranked(values: list[float], percent: float) -> float:
    held = sorted(values)
    return held[min(len(held) - 1, max(0, -(-len(held) * percent // 100) - 1))] if held else float("nan")
VSYNC = 1e9 / 60
def frames(stats: str) -> list[tuple[float, bool]]:
    found = []
    names: list[str] = []
    for line in stats.splitlines():
        cells = [one for one in line.strip().split(",") if one]
        if cells[:1] == ["Flags"] and "IntendedVsync" in cells and "FrameCompleted" in cells:
            names = cells
        elif names and len(cells) >= len(names) and cells[0].isdigit():
            row = dict(zip(names, (int(one) for one in cells), strict=False))
            if row["Flags"] != 0 or row["FrameCompleted"] <= 0:
                continue
            due = row.get("FrameDeadline") or row["IntendedVsync"] + VSYNC
            lasted = (row["FrameCompleted"] - row["IntendedVsync"]) / 1e6
            found.append((lasted, row["FrameCompleted"] <= due))
        elif line.startswith("---PROFILEDATA---"):
            names = []
    return found
def refresh() -> float:
    found = re.search(r"fps=([\d.]+)", adb("shell", "dumpsys", "display", check=False))
    return float(found.group(1)) if found else 0.0
def fully_drawn(log: str, package: str) -> list[float]:
    found = []
    for line in log.splitlines():
        said = re.search(rf"Fully drawn {re.escape(package)}/\S+: \+(?:(\d+)m)?(?:(\d+)s)?(\d+)ms", line)
        if said:
            minutes, seconds, millis = (int(one or 0) for one in said.groups())
            found.append(float(minutes * 60000 + seconds * 1000 + millis))
    return found
def pss(said: str, pids: list[str]) -> float:
    by_process = said.split("Total PSS by process:", 1)[-1].split("Total PSS by OOM adjustment:", 1)[0]
    held = re.findall(r"^\s*([\d,]+)K: \S+ \(pid (\d+)", by_process, re.MULTILINE)
    return sum(int(size.replace(",", "")) for size, pid in held if pid in pids) / 1024
def ticks(stat: str) -> int | None:
    cells = stat.rsplit(")", 1)[-1].split()
    return int(cells[11]) + int(cells[12]) if len(cells) > 12 and cells[11].isdigit() and cells[12].isdigit() else None
def held_awake(power: str, package: str, uid: str) -> list[str]:
    found = []
    inside = False
    for line in power.splitlines():
        if line.startswith("Wake Locks:"):
            inside = True
        elif inside and not line.strip():
            inside = False
        elif inside and (package in line or (uid and re.search(rf"\buid={uid}\b", line))):
            found.append(line.strip())
    return found
def janky(stats: str) -> float | None:
    found = re.search(r"Janky frames: \d+ \(([\d.]+)%\)", stats)
    return float(found.group(1)) if found else None
def launched(said: str) -> float:
    found = re.search(r"TotalTime:\s*(\d+)", said)
    if not found:
        raise SystemExit(f"am start did not say how long it took:\n{said}")
    return float(found.group(1))
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
def swipe(across: int, start: int, end: int) -> None:
    adb("shell", "input", "swipe", str(across), str(start), str(across), str(end), "120")
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
            for one in pages:
                if one.get("type") != "page" or "localhost" not in one.get("url", ""):
                    continue
                self.socket = websocket.create_connection(
                    one["webSocketDebuggerUrl"], timeout=60, suppress_origin=True
                )
                try:
                    seen = self.evaluate("document.visibilityState === 'visible'")
                except RuntimeError:
                    seen = False
                if seen:
                    target = one
                    break
                self.socket.close()
            if not target:
                time.sleep(1)
        if not target:
            raise SystemExit("the app's page is not among the web view's targets")
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
    def press(self, selector: str) -> None:
        said = self.evaluate(
            f"(() => {{ const found = document.querySelector({json.dumps(selector)}); if (!found) return null;"
            " const rect = found.getBoundingClientRect();"
            " return JSON.stringify([rect.left + rect.width / 2, rect.top + rect.height / 2, devicePixelRatio]) })()"
        )
        if not said:
            raise SystemExit(f"nothing to press at {selector}")
        across, down, ratio = json.loads(said)
        adb("shell", "input", "tap", str(int(across * ratio)), str(int(down * ratio)))
    def tap(self, selector: str) -> None:
        said = self.where([selector])
        box = said["boxes"][selector]
        if not box:
            raise SystemExit(f"nothing to tap at {selector}")
        adb("shell", "input", "tap", str(screen()[0] // 2), str(int((box[0] + box[1]) / 2 * said["ratio"])))
FIRST = ".setup, [data-sign-in]"
def alone(page: Page) -> None:
    page.wait_for(f"!!document.querySelector({json.dumps(FIRST)})", "the first screen")
    pressed = page.evaluate(
        f"(() => {{ const first = document.querySelector({json.dumps(FIRST)});"
        " const go = [...first.querySelectorAll('button')].find((one) =>"
        " one.innerText.trim() === 'Use without an account'); go?.click(); return !!go })()"
    )
    if not pressed:
        raise SystemExit("the first screen offers no way on without an account")
    page.wait_for(f"!document.querySelector({json.dumps(FIRST)})", "the first screen to leave")
def notified(package: str, title: str, action: str = "") -> bool:
    said = adb("shell", "dumpsys", "notification", "--noredact", check=False)
    records = said.split("NotificationRecord(")[1:]
    return any(
        f"pkg={package} " in one and f"android.title=String ({title})" in one and (not action or f'"{action}"' in one)
        for one in records
    )
def broadcast(package: str, receiver: str, action: str) -> bool:
    said = adb("shell", "am", "broadcast", "-n", f"{package}/so.orden.Orden.{receiver}", "-a", action, check=False)
    return "Broadcast completed" in said
def shade_press(words: str, shots: Path) -> bool:
    adb("shell", "cmd", "statusbar", "expand-notifications")
    time.sleep(3)
    drawn = adb("exec-out", "uiautomator", "dump", "/dev/tty", check=False)
    if "<node" not in drawn:
        said = adb("shell", "uiautomator", "dump", "/data/local/tmp/shade.xml", check=False)
        say(f"the phone would not describe the notification shade: {drawn[:160]!r} {said[:160]!r}")
        drawn = adb("shell", "cat", "/data/local/tmp/shade.xml", check=False)
    (shots / "shade.xml").write_text(drawn, encoding="utf-8")
    found = re.search(rf'text="{re.escape(words)}"[^>]*bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"', drawn, re.IGNORECASE)
    if found:
        left, top, right, bottom = (int(one) for one in found.groups())
        adb("shell", "input", "tap", str((left + right) // 2), str((top + bottom) // 2))
        time.sleep(2)
    adb("shell", "cmd", "statusbar", "collapse")
    time.sleep(1)
    return found is not None
class Phone:
    def __init__(
        self,
        file: str,
        app: str,
        known: Mapping[str, str] | None = None,
        ready: str = "!!window.ordenApp && !!window.ordenApp.workspace",
    ) -> None:
        self.app = app
        self.ready = ready
        self.package = packages()[app]
        self.drive = harness.Drive(file, served=False, known=known)
        self.shots = self.drive.shots
        self.say, self.wrong = self.drive.say, self.drive.wrong
        self.apk = Path(os.environ.get(f"ORDEN_{app.upper()}_APK", harness.ROOT / "out" / f"{app}.apk"))
        self.page = Page()
        self.gates: dict[str, float] = {}
        self.notes: dict[str, float] = {}
        self.logs: list[str] = []
        self.asked: Callable[[], int] = lambda: 0
        self.found: set[str] = set()
        self.looks: dict[str, Any] = {}
    def count(self, kind: str, where: str, found: list[str]) -> None:
        for one in found:
            what = f"{kind} at {where}: {one}"
            if what not in self.found:
                self.found.add(what)
                self.wrong(what)
    def unnamed(self) -> list[str]:
        page = self.page
        page.send("Accessibility.enable")
        nodes = page.send("Accessibility.getFullAXTree").get("nodes", [])
        found = []
        for node in nodes:
            role = node.get("role", {}).get("value", "")
            if node.get("ignored") or role not in CONTROLS or node.get("name", {}).get("value", "").strip():
                continue
            what = role
            if "backendDOMNodeId" in node:
                try:
                    held = page.send("DOM.resolveNode", {"backendNodeId": node["backendDOMNodeId"]})["object"]
                    drawn = page.send(
                        "Runtime.callFunctionOn",
                        {
                            "objectId": held["objectId"],
                            "functionDeclaration": "function () { return this.outerHTML.slice(0, 120) }",
                            "returnByValue": True,
                        },
                    )
                    what = f"{role} {drawn.get('result', {}).get('value', '')}"
                except (RuntimeError, KeyError):
                    pass
            found.append(what)
        return found
    def look(self, name: str, shape: str = "") -> dict[str, Any]:
        said = json.loads(self.page.evaluate(PROBE))
        where = f"{name}{' ' + shape if shape else ''}{' dark' if said['dark'] else ''}"
        self.looks[where] = said
        wide = ["the page is wider than the screen"] if said["wide"] else []
        self.count("clipped text", where, [*said["clipped"], *wide])
        self.count("overlapping text", where, said["overlapping"])
        if not shape:
            self.count("small target", where, said["small"])
            self.count("touch targets on each other", where, said["crowded"])
            self.count("faint text", where, said["faint"])
            self.count("unnamed control", where, self.unnamed())
        return said
    def night(self, on: bool) -> None:
        adb("shell", "cmd", "uimode", "night", "yes" if on else "no")
        time.sleep(3)
    def resumed(self) -> bool:
        said = adb("shell", "dumpsys", "activity", "activities", check=False)
        top = re.findall(r"(?:topResumedActivity|mResumedActivity|ResumedActivity)[=:].*", said)
        return any(f"{self.package}/" in one for one in top)
    def back(self) -> None:
        adb("shell", "input", "keyevent", "4")
    def steps_out(self, kept: Callable[[], Any]) -> None:
        pid = adb("shell", "pidof", self.package, check=False).strip()
        for press in range(1, 9):
            self.back()
            time.sleep(2)
            if not self.resumed():
                say(f"with nothing left to close, Back put the app in the background on press {press}")
                break
        else:
            self.wrong("Back never leaves the app")
            return
        if adb("shell", "pidof", self.package, check=False).strip() != pid:
            self.wrong("Back on the first screen ended the app instead of keeping it in the background")
        before = kept() if self.lives_hidden() else None
        adb("shell", "am", "start", "-W", "-n", f"{self.package}/{ACTIVITY}")
        time.sleep(3)
        if not self.resumed():
            self.wrong("the app did not come back to the front")
        if not self.lives():
            self.wrong("coming back after Back started the page again")
            self.page = Page()
            self.page.connect()
            self.page.wait_for(self.ready, "the app to come back", 120)
        elif before is not None and kept() != before:
            self.wrong(f"coming back after Back lost state: {before!r} became {kept()!r}")
    def again(self) -> None:
        adb("shell", "am", "start", "-W", "-n", f"{self.package}/{ACTIVITY}")
        time.sleep(5)
        self.page = Page()
        self.page.connect()
        self.page.wait_for(self.ready, "the app to come back", 120)
    def lives_hidden(self) -> bool:
        try:
            return self.page.evaluate("document.visibilityState") in ("hidden", "visible")
        except (RuntimeError, OSError):
            return False
    def lives(self) -> bool:
        try:
            return bool(self.page.evaluate("document.visibilityState === 'visible'"))
        except (RuntimeError, OSError):
            return False
    def settles(self, wide: Callable[[int, int], bool], what: str) -> None:
        until = time.monotonic() + 40
        size = [0, 0]
        while time.monotonic() < until:
            if self.lives():
                size = self.page.evaluate("[innerWidth, innerHeight]")
                if wide(size[0], size[1]):
                    time.sleep(2)
                    return
            time.sleep(1)
        self.wrong(f"{what} ({size})")
    def still(self, name: str, what: str, before: Any, kept: Callable[[], Any]) -> None:
        if not self.lives():
            self.wrong(f"{name}: {what} started the page again")
            self.page = Page()
            self.page.connect()
            self.page.wait_for(self.ready, "the app to come back", 120)
            time.sleep(3)
        after = kept()
        if after != before:
            self.wrong(f"{name}: {what} lost state: {before!r} became {after!r}")
    def shaped(self, name: str, kept: Callable[[], Any], again: Callable[[], None]) -> None:
        before = kept()
        normal = json.loads(self.page.evaluate(PROBE))["text"]
        try:
            adb("shell", "settings", "put", "system", "font_scale", "2.0")
            time.sleep(8)
            self.still(name, "a larger system font", before, kept)
            large = self.look(name, "large text")
            self.shot(f"{name}-large-text")
            self.gates["textScaleFollowed"] = float(large["text"] >= normal * 1.5)
        finally:
            adb("shell", "settings", "put", "system", "font_scale", "1.0")
            time.sleep(8)
        if not self.lives() or kept() != before:
            self.page = Page()
            self.page.connect()
            again()
            before = kept()
        try:
            adb("shell", "settings", "put", "system", "accelerometer_rotation", "0")
            adb("shell", "settings", "put", "system", "user_rotation", "1")
            self.settles(lambda across, down: across > down, f"{name}: the page did not turn with the phone")
            self.still(name, "turning the phone", before, kept)
            self.look(name, "turned")
            self.shot(f"{name}-turned")
        finally:
            adb("shell", "settings", "put", "system", "user_rotation", "0")
        self.settles(lambda across, down: across < down, f"{name}: the page did not turn back with the phone")
        self.still(name, "turning the phone back", before, kept)
        try:
            adb("shell", "wm", "size", "1200x1920")
            adb("shell", "wm", "density", "320")
            self.settles(lambda across, down: across >= 600, f"{name}: at 600dp the page is narrower than the screen")
            self.still(name, "a 600dp screen", before, kept)
            self.look(name, "tablet")
            self.shot(f"{name}-tablet")
        finally:
            adb("shell", "wm", "size", "reset")
            adb("shell", "wm", "density", "reset")
            time.sleep(6)
    def flung(self, name: str) -> None:
        across, down = screen()
        within, longest, slow, summed = [], [], [], []
        for turn in range(FLINGS):
            adb("shell", "dumpsys", "gfxinfo", self.package, "reset", check=False)
            for _ in range(3):
                swipe(across // 2, down * 3 // 4, down // 4)
                time.sleep(0.6)
            stats = adb("shell", "dumpsys", "gfxinfo", self.package, "framestats", check=False)
            (self.shots / f"frames-{turn + 1}.txt").write_text(stats, encoding="utf-8")
            drawn = frames(stats)
            for _ in range(3):
                swipe(across // 2, down // 4, down * 3 // 4)
            time.sleep(1)
            if not drawn:
                continue
            within.append(100 * sum(1 for one in drawn if one[1]) / len(drawn))
            longest.append(max(one[0] for one in drawn))
            slow.append(ranked([one[0] for one in drawn], 90))
            said = janky(stats)
            if said is not None:
                summed.append(100 - said)
            told = f"{len(drawn)} frames, {within[-1]:.1f}% by their deadline, {longest[-1]:.0f} ms longest"
            say(f"{name}: fling {turn + 1}: {told}; the phone's own count: {said}% janky")
        if len(within) < 3:
            raise SystemExit(f"{name}: the phone drew no frames to measure")
        rate = refresh()
        say(f"{name}: the screen draws {rate:.0f} times a second")
        self.gates["framesInTime"] = round(ranked(within, 50), 1)
        self.gates["flingsWithLongFrame"] = float(sum(1 for one in longest if one > 700))
        self.notes["frameP90"] = round(ranked(slow, 50), 1)
        self.notes["refreshRate"] = rate
        if summed:
            self.notes["framesInTimeByThePhone"] = round(ranked(summed, 50), 1)
            if abs(ranked(summed, 50) - ranked(within, 50)) > 10:
                self.wrong(
                    f"{name}: {ranked(within, 50):.1f}% of frames met their deadline,"
                    f" and the phone's own count says {ranked(summed, 50):.1f}%"
                )
    def starts(self) -> None:
        component = f"{self.package}/{ACTIVITY}"
        shown, shell, painted, warm = [], [], [], []
        for turn in range(STARTS):
            adb("shell", "am", "force-stop", self.package)
            time.sleep(1)
            said = adb("shell", f"date +%s%N; am start -W -n {component}")
            began = int(said.split()[0]) / 1e6
            shown.append(launched(said))
            self.page = Page()
            self.page.connect()
            marks = json.loads(self.page.wait_for(PAINTED, "the mark of a painted first frame", 120))
            if marks[0] is not None:
                shell.append(marks[0] - began)
            painted.append(marks[1] - began)
            self.page.socket.close()
            told = f"shown in {shown[-1]:.0f} ms, shell painted in {shell[-1] if shell else float('nan'):.0f} ms"
            say(f"cold start {turn + 1}: {told}, first frame in {painted[-1]:.0f} ms")
        for _ in range(STARTS):
            adb("shell", "input", "keyevent", "3")
            time.sleep(1)
            warm.append(launched(adb("shell", "am", "start", "-W", "-n", component)))
        say(f"warm starts: {sorted(warm)}")
        self.notes["coldShownDebugP50"] = ranked(shown, 50)
        self.notes["coldShownDebugP95"] = ranked(shown, 95)
        if shell:
            self.notes["coldShellDebugP50"] = round(ranked(shell, 50), 0)
            self.notes["coldShellDebugP95"] = round(ranked(shell, 95), 0)
        else:
            self.wrong("the app never marks its shell as painted, so a release build cannot say when it can be used")
        self.notes["coldFirstFrameP50"] = round(ranked(painted, 50), 0)
        self.notes["coldFirstFrameP95"] = round(ranked(painted, 95), 0)
        self.gates["warmP95"] = ranked(warm, 95)
        self.page = Page()
        self.page.connect()
    def processes(self) -> list[str]:
        own = adb("shell", "pidof", self.package, check=False).split()
        listed = adb("shell", "ps", "-A", "-o", "PID,NAME", check=False).splitlines()
        drawing = [one.split()[0] for one in listed if "sandboxed_process" in one and one.split()[0].isdigit()]
        return [*own, *drawing]
    def weighs(self) -> float:
        taken = []
        for _ in range(3):
            taken.append(pss(adb("shell", "dumpsys", "meminfo", check=False), self.processes()))
            time.sleep(2)
        return ranked(taken, 50)
    def memory(self, cycle: Callable[[], None]) -> None:
        time.sleep(5)
        before = self.weighs()
        for _ in range(OPENS):
            cycle()
        time.sleep(10)
        after = self.weighs()
        say(f"memory: {before:.0f} MB after the main path, {after:.0f} MB after {OPENS} opens and closes")
        if before <= 0:
            raise SystemExit("the phone would not say how much memory the app holds")
        self.gates["memoryPss"] = round(before, 0)
        self.gates["memoryGrowth"] = round(max(0.0, after - before), 0)
    def background(self, requests: Callable[[], int]) -> None:
        uid = re.search(r"userId=(\d+)", adb("shell", "dumpsys", "package", self.package, check=False))
        adb("shell", "input", "keyevent", "3")
        time.sleep(AWAY)
        watched = self.processes()
        spent = lambda: [ticks(adb("shell", "cat", f"/proc/{one}/stat", check=False)) for one in watched]
        asked, began = requests(), spent()
        time.sleep(WATCHED)
        ended = spent()
        awake = held_awake(adb("shell", "dumpsys", "power", check=False), self.package, uid.group(1) if uid else "")
        if any(one is None for one in [*began, *ended]):
            raise SystemExit("the phone would not say how much processor time the app took")
        spent_ticks = sum(last - first for first, last in zip(began, ended, strict=True) if last and first)
        busy = 100 * spent_ticks / 100 / WATCHED
        said = f"{requests() - asked} requests, {busy:.2f}% of a processor, {len(awake)} wake locks {awake}"
        say(f"in the background, from {AWAY} s on, over {WATCHED} s: {said}")
        self.gates["backgroundRequests"] = float(requests() - asked)
        self.gates["backgroundCpu"] = round(busy, 2)
        self.gates["backgroundWakeLocks"] = float(len(awake))
        adb("shell", "am", "start", "-W", "-n", f"{self.package}/{ACTIVITY}")
        time.sleep(3)
    def released(self) -> None:
        at = harness.ROOT / "out" / f"{self.app}-release.apk"
        apk = Path(os.environ.get(f"ORDEN_{self.app.upper()}_RELEASE_APK", at))
        if not apk.is_file():
            say(f"no release APK at {apk}: the cold start of a release build is not measured")
            return
        component = f"{self.package}/{ACTIVITY}"
        self.logs.append(adb("logcat", "-d", check=False))
        adb("logcat", "-c")
        adb("uninstall", self.package, check=False)
        adb("install", str(apk))
        for _ in range(3):
            adb("shell", "am", "start", "-W", "-n", component)
            time.sleep(20)
        shown, drawn = [], []
        for turn in range(STARTS):
            adb("shell", "am", "force-stop", self.package)
            self.logs.append(adb("logcat", "-d", check=False))
            adb("logcat", "-c")
            time.sleep(1)
            shown.append(launched(adb("shell", "am", "start", "-W", "-n", component)))
            until = time.monotonic() + 60
            took: list[float] = []
            while time.monotonic() < until and not took:
                time.sleep(1)
                took = fully_drawn(adb("logcat", "-d", "-s", "ActivityTaskManager:I", check=False), self.package)
            if not took:
                raise SystemExit(f"cold start {turn + 1} of the release build never said it was fully drawn")
            drawn.append(took[0])
            say(f"release cold start {turn + 1}: shown in {shown[-1]:.0f} ms, usable in {drawn[-1]:.0f} ms")
        self.gates["coldStartP50"] = ranked(drawn, 50)
        self.gates["coldStartP95"] = ranked(drawn, 95)
        self.notes["coldShownReleaseP50"] = ranked(shown, 50)
        self.notes["coldShownReleaseP95"] = ranked(shown, 95)
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
        adb("shell", "pm", "grant", self.package, "android.permission.POST_NOTIFICATIONS", check=False)
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
        self.asked = lambda: worker.log.read_text(encoding="utf-8", errors="replace").count("[wrangler:info]")
        self.shots.mkdir(parents=True, exist_ok=True)
        try:
            worker.start()
            seed(worker)
            if "already running as root" not in adb("root", check=False):
                time.sleep(4)
                adb("wait-for-device", check=False)
            adb("reverse", f"tcp:{PORT}", f"tcp:{PORT}")
            adb("logcat", "-c")
            self.started()
            self.page.connect()
            steps(worker)
        finally:
            log = "".join([*self.logs, adb("logcat", "-d", check=False)])
            (self.shots / "logcat.log").write_text(log, encoding="utf-8", errors="replace")
            (self.shots / "windows.txt").write_text(adb("shell", "dumpsys", "window", check=False), encoding="utf-8")
            for one in crashes(log, self.package):
                self.wrong(one)
            (self.shots / "gates.json").write_text(json.dumps(self.gates, indent=2), encoding="utf-8")
            (self.shots / "looks.json").write_text(json.dumps(self.looks, indent=2), encoding="utf-8")
            (self.shots / "measured.json").write_text(json.dumps(self.notes, indent=2), encoding="utf-8")
            say(f"gates: {json.dumps(self.gates)}; also measured: {json.dumps(self.notes)}")
            worker.close()
        return self.drive.verdict(passed)
