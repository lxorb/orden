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
from typing import Any
from fresh_app import ended, fresh
from native_app import App, endpoint

TYPED = "typed from afar"
KEY = "drive-1063"

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

def value(app: App, code: str, seconds: float | None = None) -> Any:
    said = app.answer(code, seconds)
    if "error" in said:
        raise SystemExit(f"the window answered an error: {said['error']}\n{code}")
    return said.get("value")

def text_on_desktop(name: str) -> str:

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

FILES = {
    "Installed": '{"v":1,"host":"HOST","run":{"kind":"installed","id":"ID","name":"Notepad"}}\n',
    "Program": '{"v":1,"host":"HOST","run":{"kind":"path","path":"C:\\\\Windows\\\\notepad.exe","args":["a b.txt"],"cwd":"C:\\\\Windows"}}\n',
    "Bare": '{"v":1,"host":"HOST","run":{"kind":"path","path":"C:\\\\Windows\\\\notepad.exe","args":[],"cwd":null}}\n',
    "Lines": '{\r\n  "v": 1,\r\n  "host": "HOST",\r\n  "run": { "kind": "path", "path": "notepad.exe" }\r\n}\r\n',
    "Marked": '\ufeff{"v":1,"host":"HOST","run":{"kind":"installed","id":"ID","name":"Notepad"}}',
}

TAB = """
const ws = orden.workspace
if (!ws.spaces.length) { await orden.invoke('create_space', { name: 'Apps' }); await ws.loadSpaces() }
if (!ws.activeSpace && ws.spaces[0]) await ws.showSpace(ws.spaces[0].id)
const root = ws.activeSpace.root.replace(/[\\\\/]+$/, '')
const path = root + '\\\\' + NAME + '.application'
await orden.invoke('write_note', { path, content: TEXT })
await ws.loadTree()
await ws.openEntry(path)
const tab = ws.tabs.find((one) => one.kind === 'application' && one.path === path)
if (!tab) return { said: 'no tab' }
ws.activeTabId = tab.id
await new Promise((done) => setTimeout(done, 3000))
const said = document.querySelector('.application')?.innerText ?? document.body.innerText
ws.closeTab?.(tab.id)
return { said: said.slice(0, 300) }
"""

TURN_ON = """
localStorage.setItem('orden:hidden-kinds', JSON.stringify(['experimental', 'experimental-apps']))
window.__unturned = true
setTimeout(() => location.reload(), 50)
return true
"""

def turned_on(app: App) -> None:
    value(app, TURN_ON)
    ready = "!window.__unturned && !!orden.workspace && JSON.parse(localStorage.getItem('orden:hidden-kinds') ?? '[]').includes('experimental-apps')"
    until = time.monotonic() + 90
    while time.monotonic() < until:
        if app.answer(ready).get("value") is True:
            return
        time.sleep(1)
    raise SystemExit("the app did not come back with applications turned on")

def tabs(app: App, notepad: str) -> list[str]:
    wrong: list[str] = []
    until = time.monotonic() + 60
    while time.monotonic() < until and app.answer("!!orden.workspace.spaces").get("value") is not True:
        time.sleep(1)
    for name, text in FILES.items():
        written = text.replace("HOST", "device-desktop").replace("ID", notepad.replace("\\", "\\\\"))
        opened = value(app, TAB.replace("NAME", json.dumps(name)).replace("TEXT", json.dumps(written)), 60)
        said = str((opened or {}).get("said", ""))
        print(f"{name}.application: {said!r}", flush=True)
        if said == "no tab" or "damaged" in said or "could not be read" in said:
            wrong.append(f"{name}.application did not open: {said!r}")
    return wrong

def drive(app: App, pid: int, shot: pathlib.Path | None) -> list[str]:
    wrong: list[str] = []
    listed = value(app, LISTED, 120)
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
    turned_on(app)
    wrong.extend(tabs(app, notepad[0]))

    before = notepads_here()
    value(app, START.replace("ID", json.dumps(notepad[0])), 60)
    time.sleep(3)
    if notepads_here() > before:
        wrong.append("Notepad opened on the runner's own desktop")

    offered = value(app, OFFER, 60)
    print(f"the host answered: {offered}", flush=True)
    if not isinstance(offered, dict) or "cannot" in offered:
        return [*wrong, f"the host gave no picture: {offered}"]
    looked: dict[str, Any] = {}
    until = time.monotonic() + 60
    while time.monotonic() < until:
        looked = value(app, LOOK)
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
    value(app, SEND.replace("EVENTS", json.dumps(events)))
    desktop = f"orden-app-{pid}-0"
    typed = ""
    until = time.monotonic() + 20
    while time.monotonic() < until and TYPED not in typed:
        time.sleep(1)
        typed = text_on_desktop(desktop)
    if TYPED not in typed:
        wrong.append(f"the text did not reach Notepad; its desktop reads: {typed[:300]!r}")
    later = value(app, LOOK)
    if later.get("decoded", 0) <= looked.get("decoded", 0):
        wrong.append("no new frame came after typing")

    if shot:
        picture = value(app, SHOT)
        if isinstance(picture, str) and picture.startswith("data:image/png;base64,"):
            shot.write_bytes(base64.b64decode(picture.split(",", 1)[1]))
            print(f"the picture is in {shot}", flush=True)
    value(app, STOP)
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
    fresh(config)
    secret = secrets.token_hex(32)
    (config / "automation.json").write_text(json.dumps({"port": 0, "secret": secret, "eval": True}), encoding="utf-8")
    spaces = pathlib.Path(tempfile.mkdtemp(prefix="orden-apps-spaces-"))
    process = subprocess.Popen([str(args.exe)], env={**os.environ, "ORDEN_SPACES_DIR": str(spaces)}, cwd=str(args.exe.parent))
    wrong: list[str] = []
    try:
        app = endpoint(config, process.pid, secret, 30)
        until = time.monotonic() + 90
        while time.monotonic() < until and app.answer("!!orden.workspace").get("value") is not True:
            time.sleep(1)
        wrong = drive(app, process.pid, args.shot)
    finally:
        ended(process)
        shutil.rmtree(spaces, ignore_errors=True)

    for one in wrong:
        print(f"::error::{one}", flush=True)
    if not wrong:
        print("Notepad was listed, run on a desktop of its own, shown in WebView2 and typed into", flush=True)
    return 1 if wrong else 0

if __name__ == "__main__":
    raise SystemExit(main())
