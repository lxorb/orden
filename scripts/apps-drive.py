"""A probe build hosts an application on Windows and shows it in WebView2 (#1063).

A probe build is started on the runner's own desktop, and from its window, through the
same commands an Application tab and its host use:

- what this computer has installed is listed, with icons, and holds Notepad;
- Notepad is started on a desktop of its own: no window of it on the runner's desktop;
- WebView2's own `RTCPeerConnection` offers to take its picture, the host answers, and
  frames are decoded;
- a click and text over the data channel type into Notepad, read back off its own
  desktop;
- the picture is saved as a PNG beside the run (`--shot`), and the application stopped.

No account and no relay: the drive hands the offer and the answer between the window and
the host itself, as the relay would.

    python scripts/apps-drive.py --exe <probe build> --identifier <probe id> [--shot out.png]
"""

from __future__ import annotations

import argparse
import base64
import json
import os
import pathlib
import secrets
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.request
from typing import Any

#: What is typed into the application, and looked for in it.
TYPED = "typed from afar"
KEY = "drive-1063"


class App:
    def __init__(self, port: int, secret: str) -> None:
        self.port, self.secret = port, secret

    def eval(self, code: str, seconds: float = 30) -> dict[str, Any]:
        body = json.dumps({"verb": "eval", "args": {"code": code, "yes": True}, "rest": []}).encode()
        asked = urllib.request.Request(
            f"http://127.0.0.1:{self.port}/",
            data=body,
            headers={"authorization": f"Bearer {self.secret}", "content-type": "application/json"},
        )
        try:
            with urllib.request.urlopen(asked, timeout=seconds) as said:
                return json.loads(said.read().decode("utf-8", "replace"))
        except urllib.error.HTTPError as error:
            return {"error": f"{error.code} {error.read().decode('utf-8', 'replace')[:400]}"}
        except (urllib.error.URLError, TimeoutError, OSError) as error:
            return {"error": str(error)}

    def value(self, code: str, seconds: float = 30) -> Any:
        said = self.eval(code, seconds)
        if "error" in said:
            raise SystemExit(f"the window answered an error: {said['error']}\n{code}")
        return said.get("value")


def endpoint(config: pathlib.Path, pid: int, secret: str) -> App:
    path = config / "automation.json"
    until = time.monotonic() + 120
    while time.monotonic() < until:
        try:
            said = json.loads(path.read_text(encoding="utf-8-sig"))
            if said.get("port") and int(said.get("pid") or 0) == pid:
                return App(int(said["port"]), secret)
        except (OSError, ValueError):
            pass
        time.sleep(0.25)
    raise SystemExit(f"the app never wrote {path}")


INVOKE = "window.__TAURI_INTERNALS__.invoke"

LISTED = f"""
const apps = await {INVOKE}('apps_installed');
return {{ count: apps.length, icons: apps.filter((one) => one.icon).length,
  list: apps.map((one) => [one.id, one.name]) }};
"""

START = f"""
const events = window.__TAURI_INTERNALS__.transformCallback(() => undefined);
await {INVOKE}('apps_start', {{ key: '{KEY}', run: {{ kind: 'installed', id: ID }},
  view: {{ width: 800, height: 600, dpr: 1, hz: 30 }}, events: `__CHANNEL__:${{events}}` }});
return true;
"""

OFFER = f"""
const pc = new RTCPeerConnection({{ iceServers: [] }});
pc.addTransceiver('video', {{ direction: 'recvonly' }});
const channel = pc.createDataChannel('input', {{ ordered: true }});
const video = document.createElement('video');
video.muted = true; video.autoplay = true; video.playsInline = true;
video.style.cssText = 'position:fixed;left:0;top:0;width:400px;height:300px;z-index:2147483647';
document.body.append(video);
pc.ontrack = (event) => {{ video.srcObject = event.streams[0] ?? new MediaStream([event.track]) }};
await pc.setLocalDescription(await pc.createOffer());
const said = JSON.parse(await {INVOKE}('apps_signal', {{ key: '{KEY}',
  data: JSON.stringify({{ offer: pc.localDescription.sdp }}) }}));
if (!said.answer) return {{ cannot: said }};
await pc.setRemoteDescription({{ type: 'answer', sdp: said.answer }});
window.__drive = {{ pc, channel, video }};
return {{ codecs: (said.answer.match(/a=rtpmap:\\d+ [A-Za-z0-9]+/g) ?? []).slice(0, 4) }};
"""

LOOK = """
const { pc, channel, video } = window.__drive;
let decoded = 0, codec = '';
(await pc.getStats()).forEach((one) => {
  if (one.type === 'inbound-rtp' && one.kind === 'video') decoded = one.framesDecoded ?? 0;
  if (one.type === 'codec' && one.mimeType?.startsWith('video/')) codec = one.mimeType;
});
return { state: pc.connectionState, channel: channel.readyState, decoded, codec,
  width: video.videoWidth, height: video.videoHeight };
"""

SEND = """
const { channel } = window.__drive;
for (const one of EVENTS) channel.send(JSON.stringify(one));
return true;
"""

SHOT = """
const { video } = window.__drive;
const canvas = document.createElement('canvas');
canvas.width = video.videoWidth; canvas.height = video.videoHeight;
canvas.getContext('2d').drawImage(video, 0, 0);
return canvas.toDataURL('image/png');
"""

STOP = f"""
await {INVOKE}('apps_stop', {{ key: '{KEY}' }});
window.__drive?.pc.close();
return true;
"""


def text_on_desktop(name: str) -> str:
    """Every window's text on a desktop of ours, read by a thread moved onto it: Windows
    passes no message from one desktop to another."""

    import ctypes
    from ctypes import wintypes

    user32 = ctypes.WinDLL("user32", use_last_error=True)
    user32.OpenDesktopW.restype = wintypes.HANDLE
    found: list[str] = []

    def read() -> None:
        desk = user32.OpenDesktopW(name, 0, False, 0x10000000)
        if not desk or not user32.SetThreadDesktop(desk):
            found.append(f"<could not go to {name}: {ctypes.get_last_error()}>")
            return
        kind = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)

        def child(hwnd: int, _lparam: int) -> bool:
            buffer = ctypes.create_unicode_buffer(4096)
            result = ctypes.c_size_t()
            user32.SendMessageTimeoutW(hwnd, 0x000D, 4096, buffer, 0x0002, 2000, ctypes.byref(result))
            found.append(buffer.value)
            return True

        def top(hwnd: int, _lparam: int) -> bool:
            user32.EnumChildWindows(hwnd, kind(child), 0)
            return True

        user32.EnumDesktopWindows(desk, kind(top), 0)

    thread = threading.Thread(target=read)
    thread.start()
    thread.join(30)
    return "\n".join(found)


def notepads_here() -> int:
    """How many Notepad windows the runner's own desktop has."""

    import ctypes
    from ctypes import wintypes

    user32 = ctypes.WinDLL("user32", use_last_error=True)
    count = 0

    def each(hwnd: int, _lparam: int) -> bool:
        nonlocal count
        name = ctypes.create_unicode_buffer(256)
        user32.GetClassNameW(hwnd, name, 256)
        if name.value == "Notepad" and user32.IsWindowVisible(hwnd):
            count += 1
        return True

    user32.EnumWindows(ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)(each), 0)
    return count


def drive(app: App, pid: int, shot: pathlib.Path | None) -> list[str]:
    wrong: list[str] = []
    listed = app.value(LISTED, 120)
    names = [name for _, name in listed["list"]]
    print(f"{listed['count']} applications, {listed['icons']} with icons: {names}", flush=True)
    if listed["count"] == 0:
        return ["no application was listed"]
    if listed["icons"] * 2 < listed["count"]:
        wrong.append(f"only {listed['icons']} of {listed['count']} applications have icons")
    if any("uninstall" in name.lower() for name in names):
        wrong.append("an uninstaller was listed")
    if len(set(names)) != len(names):
        wrong.append("a name was listed twice")
    notepad = next((one for one in listed["list"] if one[1].lower().startswith("notepad")), None)
    if not notepad:
        return [*wrong, "Notepad was not listed"]

    before = notepads_here()
    app.value(START.replace("ID", json.dumps(notepad[0])), 60)
    time.sleep(3)
    if notepads_here() > before:
        wrong.append("Notepad opened on the runner's own desktop")

    offered = app.value(OFFER, 60)
    print(f"the host answered: {offered}", flush=True)
    if not isinstance(offered, dict) or "cannot" in offered:
        return [*wrong, f"the host gave no picture: {offered}"]
    looked: dict[str, Any] = {}
    until = time.monotonic() + 60
    while time.monotonic() < until:
        looked = app.value(LOOK)
        if looked.get("decoded", 0) >= 3 and looked.get("channel") == "open":
            break
        time.sleep(1)
    print(f"the picture: {looked}", flush=True)
    if looked.get("decoded", 0) < 3:
        return [*wrong, f"no picture was decoded: {looked}"]

    events = [
        {"t": "move", "x": 400, "y": 300},
        {"t": "button", "button": 0, "down": True},
        {"t": "button", "button": 0, "down": False},
        {"t": "text", "text": TYPED},
    ]
    app.value(SEND.replace("EVENTS", json.dumps(events)))
    desktop = f"orden-app-{pid}-0"
    typed = ""
    until = time.monotonic() + 20
    while time.monotonic() < until and TYPED not in typed:
        time.sleep(1)
        typed = text_on_desktop(desktop)
    if TYPED not in typed:
        wrong.append(f"the text did not reach Notepad; its desktop reads: {typed[:300]!r}")
    later = app.value(LOOK)
    if later.get("decoded", 0) <= looked.get("decoded", 0):
        wrong.append("no new frame came after typing")

    if shot:
        picture = app.value(SHOT)
        if isinstance(picture, str) and picture.startswith("data:image/png;base64,"):
            shot.write_bytes(base64.b64decode(picture.split(",", 1)[1]))
            print(f"the picture is in {shot}", flush=True)
    app.value(STOP)
    return wrong


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--exe", required=True, type=pathlib.Path)
    parser.add_argument("--identifier", required=True)
    parser.add_argument("--shot", type=pathlib.Path)
    args = parser.parse_args()
    if "probe" not in args.identifier:
        raise SystemExit(f"{args.identifier} is not a probe identifier")
    if sys.platform != "win32":
        raise SystemExit("this drive is Windows'")

    config = pathlib.Path(os.environ["APPDATA"]) / args.identifier
    shutil.rmtree(config, ignore_errors=True)
    config.mkdir(parents=True)
    secret = secrets.token_hex(32)
    (config / "automation.json").write_text(json.dumps({"port": 0, "secret": secret, "eval": True}), encoding="utf-8")
    spaces = pathlib.Path(tempfile.mkdtemp(prefix="nib-apps-spaces-"))
    process = subprocess.Popen([str(args.exe)], env={**os.environ, "NIB_SPACES_DIR": str(spaces)}, cwd=str(args.exe.parent))
    wrong: list[str] = []
    try:
        app = endpoint(config, process.pid, secret)
        until = time.monotonic() + 90
        while time.monotonic() < until and app.eval("!!nib.workspace").get("value") is not True:
            time.sleep(1)
        wrong = drive(app, process.pid, args.shot)
    finally:
        process.kill()
        process.wait(20)
        shutil.rmtree(spaces, ignore_errors=True)

    for one in wrong:
        print(f"::error::{one}", flush=True)
    if not wrong:
        print("Notepad was listed, run on a desktop of its own, shown in WebView2 and typed into", flush=True)
    return 1 if wrong else 0


if __name__ == "__main__":
    raise SystemExit(main())
