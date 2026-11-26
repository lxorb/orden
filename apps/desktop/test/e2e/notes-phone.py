import json
import os
import re
import shutil
import subprocess
import sys
import time
import urllib.request
from pathlib import Path
from typing import Any
import harness

BUDGET = 1500
PORT = 8799
ID = "so.orden.Orden"
EMAIL = "ada@example.com"
SPACE = "Field notes"
HERON = "A heron stands in the reeds.\n\n" + "\n\n".join(f"Reed {at} bends over the water." for at in range(1, 90))
WS = "window.ordenApp.workspace"
APK = Path(os.environ.get("ORDEN_NOTES_APK", harness.ROOT / "out" / "notes.apk"))
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
CARET = """(() => {
  const picked = getSelection()
  const range = picked && picked.rangeCount ? picked.getRangeAt(0) : null
  const drawn = range ? [...range.getClientRects()].at(-1) ?? range.getBoundingClientRect() : null
  const rect = drawn && drawn.height ? drawn : document.querySelector('.cm-cursor-primary, .cm-cursor')?.getBoundingClientRect()
  return rect && rect.height ? JSON.stringify([Math.round(rect.top), Math.round(rect.bottom)]) : null
})()"""
DRIVE = harness.Drive(__file__, served=False)
say, wrong = DRIVE.say, DRIVE.wrong
def adb(*args: str, check: bool = True) -> str:
    done = subprocess.run(["adb", *args], capture_output=True, text=True, errors="replace", timeout=180, check=False)
    if check and done.returncode != 0:
        raise SystemExit(f"adb {' '.join(args)} failed:\n{done.stdout}\n{done.stderr}")
    return done.stdout
def shot(name: str) -> None:
    DRIVE.shots.mkdir(parents=True, exist_ok=True)
    taken = subprocess.run(["adb", "exec-out", "screencap", "-p"], capture_output=True, timeout=60, check=False)
    (DRIVE.shots / f"{name}.png").write_bytes(taken.stdout)
    say(f"shot {name}.png")
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
    def evaluate(self, expression: str) -> Any:
        self.count += 1
        mine = self.count
        self.socket.send(
            json.dumps(
                {
                    "id": mine,
                    "method": "Runtime.evaluate",
                    "params": {"expression": expression, "awaitPromise": True, "returnByValue": True},
                }
            )
        )
        while True:
            answer = json.loads(self.socket.recv())
            if answer.get("id") != mine:
                continue
            result = answer.get("result", {})
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
        across = int(adb("shell", "wm", "size").strip().split()[-1].split("x")[0]) // 2
        adb("shell", "input", "tap", str(across), str(int((box[0] + box[1]) / 2 * said["ratio"])))
def above_keys(page: Page, name: str, field: str, others: list[str]) -> None:
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
    shot(name)
    say(f"{name}: the keyboard's top is at {edge:.0f} of {said['inner']}; {json.dumps(said)}")
    for selector, box in said["boxes"].items():
        if not box:
            wrong(f"{name}: {selector} is not there")
        elif box[1] > edge + 1:
            wrong(f"{name}: {selector} ends at {box[1]}, under the keyboard that starts at {edge:.0f}")
    covered = said["inner"] - edge
    if abs(said["keyboard"] - covered) > 2:
        wrong(f"{name}: the page was told of {said['keyboard']}px of keyboard, and {covered:.0f}px are covered")
def keys_down(page: Page, name: str) -> None:
    page.evaluate("document.activeElement?.blur()")
    if not keys_gone(8):
        adb("shell", "input", "keyevent", "4")
        if not keys_gone(15):
            raise SystemExit(f"{name}: the keyboard would not go down")
    try:
        page.wait_for(f"{WHERE}([]).includes('\"keyboard\":0,')", "the page to hear the keyboard went", 15)
    except SystemExit:
        wrong(f"{name}: the keyboard is down and the page still says {page.where([])['keyboard']}px")
def typed(page: Page, words: str, mark: str, what: str) -> None:
    size = adb("shell", "wm", "size").strip().split()[-1].split("x")
    for round in range(4):
        page.evaluate("document.querySelector('.cm-content')?.focus()")
        adb("shell", "input", "tap", str(int(size[0]) // 2), str(int(size[1]) // 3))
        time.sleep(2)
        adb("shell", "input", "text", words)
        time.sleep(3)
        if page.evaluate(f"!!{WS}.active?.doc?.includes({json.dumps(mark)})"):
            say(f"{what}: typed on try {round + 1}")
            return
    raise SystemExit(f"gave up typing {what}")
def new_note(page: Page, what: str) -> None:
    page.evaluate(f"{WS}.showPanel('tree')")
    time.sleep(1)
    before = page.evaluate(f"{WS}.active?.id ?? null")
    page.evaluate("document.querySelector(\".panels:not(.right) button[aria-label='New note']\")?.click()")
    page.wait_for(f"{WS}.panel === null && {WS}.active?.id !== {json.dumps(before)}", what)
    time.sleep(1)
def started() -> None:
    adb("install", "-r", str(APK))
    for round in range(4):
        adb("shell", "am", "start", "-W", "-n", f"{ID}/{ID}.MainActivity")
        time.sleep(45)
        if adb("shell", "pidof", ID, check=False).strip():
            say(f"the app stayed up on start {round + 1}")
            return
        say(f"the app was gone after start {round + 1}; starting it again")
    raise SystemExit("the app never stayed up")
def without_an_account(page: Page) -> None:
    page.wait_for("!!window.ordenApp && !!window.ordenApp.workspace", "the app", 120)
    say(f"the web view: {page.evaluate('navigator.userAgent')}")
    time.sleep(3)
    shot("1-first")
    page.evaluate("document.querySelector('.setup button')?.click()")
    page.wait_for("!document.querySelector('.setup')", "the first screen to leave")
    page.wait_for(f"!!{WS}.activeSpace", "a space")
    new_note(page, "a new note")
    typed(page, "kestrel%shovers", "kestrel", "the first note")
    if not page.evaluate(f"{WS}.save({WS}.active)"):
        wrong("the note written without an account was not saved")
    shot("2-written")
def signs_in(page: Page, worker: harness.Worker) -> None:
    already = len(worker.written())
    page.evaluate("window.ordenApp.account.open = true")
    page.wait_for("!!document.querySelector('input[type=email]')", "the sign-in sheet")
    above_keys(page, "3-sign-in-email", "input[type=email]", [".panel button[type=submit]", ".panel[role=dialog]"])
    page.evaluate(
        "(() => { const field = document.querySelector('input[type=email]'); field.focus();"
        f" field.value = {json.dumps(EMAIL)}; field.dispatchEvent(new Event('input', {{ bubbles: true }})) }})()"
    )
    time.sleep(1)
    page.evaluate("document.querySelector('.panel button[type=submit]')?.click()")
    code = worker.waits_for_mail(EMAIL, r"(\d{6}) is your Orden code", "the sign-in code", already).group(1)
    page.wait_for("!!document.querySelector('.digits input')", "the code boxes")
    above_keys(page, "4-sign-in-code", ".digits input", [".panel[role=dialog]"])
    page.evaluate(
        "(() => { const box = document.querySelector('.digits input'); box.focus();"
        f" box.value = {json.dumps(code)}; box.dispatchEvent(new Event('input', {{ bubbles: true }})) }})()"
    )
    page.wait_for("!!window.ordenApp.account.accountToken", "the session")
    for _ in range(10):
        kept = page.evaluate(
            "(() => { const keep = [...document.querySelectorAll('button')].find((one) =>"
            " one.innerText.trim() === 'Keep them'); keep?.click(); return !!keep })()"
        )
        if kept or not page.evaluate("window.ordenApp.account.settling"):
            break
        time.sleep(1)
    shot("5-signed-in")
def other_sheets(page: Page) -> None:
    keys_down(page, "after signing in")
    page.evaluate("void window.ordenApp.prompt.ask({ title: 'Name this', value: 'wren' })")
    page.wait_for("!!document.querySelector('.sheet[role=dialog] form input')", "the prompt sheet")
    above_keys(page, "6-prompt", ".sheet[role=dialog] form input", [".sheet[role=dialog]"])
    page.evaluate("window.ordenApp.prompt.dismiss()")
    page.wait_for("!document.querySelector('.sheet[role=dialog] form input')", "the prompt sheet to leave")
    keys_down(page, "after the prompt sheet")
    page.evaluate(f"{WS}.showPanel('search')")
    page.wait_for("!!document.querySelector('.panels:not(.right) input')", "the search panel")
    time.sleep(1)
    above_keys(page, "7-search", ".panels:not(.right) input", [".panels:not(.right)"])
    keys_down(page, "after searching")
    page.evaluate(f"{WS}.closePanel()")
def syncs_down(page: Page) -> None:
    page.wait_for(f"{WS}.spaces.some((one) => one.name === {json.dumps(SPACE)})", "the account's space to arrive", 150)
    page.evaluate(
        f"(() => {{ const found = {WS}.spaces.find((one) => one.name === {json.dumps(SPACE)});"
        f" {WS}.showSpace(found.id) }})()"
    )
    heron = page.wait_for(
        f"(() => {{ const walk = (e) => (e ? [e.path, ...(e.children ?? []).flatMap(walk)] : []);"
        f" return walk({WS}.tree).find((p) => p.endsWith('Heron.md')) ?? null }})()",
        "the server's note to come down",
        120,
    )
    page.evaluate(f"{WS}.openEntry({json.dumps(heron)})")
    page.wait_for(f"{WS}.active?.doc?.includes('heron')", "the note that came down to open")
    time.sleep(1)
    shot("8-synced-down")
def caret_stays_seen(page: Page) -> None:
    keys_down(page, "before writing in the long note")
    size = [int(one) for one in adb("shell", "wm", "size").strip().split()[-1].split("x")]
    adb("shell", "input", "tap", str(size[0] // 3), str(size[1] * 3 // 4))
    top = keys_come(15)
    if top is None:
        raise SystemExit("the keyboard never came up over the long note")
    time.sleep(2)
    said = page.where([])
    edge = top / said["ratio"]
    caret = page.evaluate(CARET)
    shot("9-caret")
    say(f"the caret is at {caret}; the keyboard's top is at {edge:.0f}")
    if not caret:
        wrong("the caret in the long note could not be found")
    elif json.loads(caret)[1] > edge + 1:
        wrong(f"the caret ends at {json.loads(caret)[1]}, under the keyboard that starts at {edge:.0f}")
def syncs_up(page: Page, worker: harness.Worker, space: str) -> None:
    new_note(page, "a new note in the synced space")
    typed(page, "wren%ssings", "wren", "the second note")
    page.evaluate(f"{WS}.save({WS}.active)")
    arrived = lambda rows: any(one["path"] != "Heron.md" and not one["deleted"] and one["size"] > 0 for one in rows)
    until = time.monotonic() + 120
    rows: list[dict[str, Any]] = []
    while time.monotonic() < until and not arrived(rows):
        time.sleep(2)
        rows = worker.query(f"select path, size, deleted from notes where space_id = '{space}'")
    say(f"the server's notes: {[one['path'] for one in rows]}")
    if not arrived(rows):
        wrong("the note written on the phone never reached the server")
    shot("10-synced-up")
def main() -> int:
    if not shutil.which("adb") or adb("get-state", check=False).strip() != "device":
        say("SKIPPED: no Android device or emulator answers adb")
        return 0
    if not APK.is_file():
        say(f"SKIPPED: no Orden Notes debug APK at {APK} (ORDEN_NOTES_APK)")
        return 0
    harness.worker_port = lambda: PORT
    worker = harness.Worker(DRIVE)
    page = Page()
    DRIVE.shots.mkdir(parents=True, exist_ok=True)
    try:
        worker.start()
        token = worker.account(EMAIL)
        space = harness.request("/v1/spaces", token, {"name": SPACE})["space"]["id"]
        harness.request(f"/v1/spaces/{space}/notes", token, {"path": "Heron.md", "content": HERON})
        adb("reverse", f"tcp:{PORT}", f"tcp:{PORT}")
        adb("logcat", "-c")
        started()
        page.connect()
        without_an_account(page)
        signs_in(page, worker)
        other_sheets(page)
        syncs_down(page)
        caret_stays_seen(page)
        syncs_up(page, worker, space)
    finally:
        (DRIVE.shots / "logcat.log").write_text(adb("logcat", "-d", check=False), encoding="utf-8", errors="replace")
        (DRIVE.shots / "windows.txt").write_text(adb("shell", "dumpsys", "window", check=False), encoding="utf-8")
        worker.close()
    return DRIVE.verdict("Orden Notes on a phone: written, signed in, synced both ways, every field above the keyboard")
if __name__ == "__main__":
    sys.exit(main())
