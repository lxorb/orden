"""Large files written, saved beside a note and peeked at in the packaged Windows app, timed.

Times write_bytes, save_asset and explorer_peek with a 40 MB file over the raw IPC body,
and write_bytes the old way (a base64 string in a JSON body) to compare, while the page
watches its long tasks. Each file on disk must be the bytes the page sent.
"""

from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import os
import pathlib
import sys
import time
from typing import Any

HERE = pathlib.Path(__file__).resolve().parent
SPACE = "Bytes probe"
NOTE = "Idea"
SIZE = 40 * 1024 * 1024
LONGEST_MS = 400


def windows_side() -> Any:
    sys.path.insert(0, str(HERE))
    from probe_app import close_app, run_probe

    spec = importlib.util.spec_from_file_location("browser_probe", HERE / "default-browser-probe.py")
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return close_app, run_probe, module


def probe(folder: pathlib.Path, worker: str | None) -> str:
    raw_path = str(folder / "raw.bin")
    old_path = str(folder / "old.bin")
    note = str(folder / f"{NOTE}.md")
    return f"""(async () => {{
const long = []
const watch = new PerformanceObserver((list) => {{
  for (const one of list.getEntries()) long.push(Math.round(one.duration))
}})
watch.observe({{ type: 'longtask' }})
const invoke = window.__TAURI_INTERNALS__.invoke
const settle = () => new Promise((done) => setTimeout(done, 500))
const bytes = new Uint8Array({SIZE})
for (let at = 0; at < bytes.length; at += 65536) crypto.getRandomValues(bytes.subarray(at, at + 65536))
const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)))
  .map((one) => one.toString(16).padStart(2, '0')).join('')
const raw = (command, args) =>
  invoke(command, bytes, {{ headers: {{ 'Orden-Args': encodeURIComponent(JSON.stringify(args)) }} }})
const timed = async (name, work) => {{
  await settle()
  long.length = 0
  const began = performance.now()
  let value = null
  let error = null
  try {{ value = await work() }} catch (why) {{ error = String(why) }}
  const ms = Math.round(performance.now() - began)
  await settle()
  return {{ name, ms, error, value, longest: Math.max(0, ...long), long: long.length }}
}}
const said = [digest]
said.push(await timed('write_bytes raw', () => raw('write_bytes', {{ path: {json.dumps(raw_path)} }})))
said.push(await timed('write_bytes base64', () => {{
  let binary = ''
  for (let at = 0; at < bytes.length; at += 0x8000) binary += String.fromCharCode(...bytes.subarray(at, at + 0x8000))
  return invoke('write_bytes', {{ path: {json.dumps(old_path)}, base64: btoa(binary) }})
}}))
said.push(await timed('save_asset raw', () =>
  raw('save_asset', {{ notePath: {json.dumps(note)}, folder: 'attachments', name: 'saved.bin' }})))
await invoke('explorer_list', {{ path: {json.dumps(str(folder))} }}).catch(() => null)
said.push(await timed('explorer_peek raw', async () => {{
  const got = new Uint8Array(await invoke('explorer_peek', {{ path: {json.dumps(raw_path)}, most: {SIZE} }}))
  const kept = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', got.subarray(0, {SIZE}))))
    .map((one) => one.toString(16).padStart(2, '0')).join('')
  return {{ size: got.length, same: kept === digest }}
}}))
const sheet = document.createElement('canvas')
sheet.width = 3840
sheet.height = 2160
const drawing = sheet.getContext('2d')
const grain = drawing.createImageData(sheet.width, sheet.height)
for (let at = 0; at < grain.data.length; at += 65536) crypto.getRandomValues(grain.data.subarray(at, at + 65536))
drawing.putImageData(grain, 0, 0)
said.push(await timed('png 4K on the thread', async () => sheet.toDataURL('image/png').length))
said.push(await timed('png 4K in the worker', async () => {{
  const where = {json.dumps(worker)}
  if (!where) throw new Error('no png-worker in the build')
  const away = new Worker(where, {{ type: 'module' }})
  try {{
    const picture = await createImageBitmap(sheet)
    const png = await new Promise((done, fail) => {{
      away.onmessage = (event) => done(event.data.png)
      away.onerror = (event) => fail(new Error(event.message || 'the worker failed'))
      away.postMessage({{ id: 1, picture }}, [picture])
    }})
    return png && png.startsWith('data:image/png;base64,') ? png.length : `no picture: ${{png}}`
  }} finally {{
    away.terminate()
  }}
}}))
watch.disconnect()
return JSON.stringify(said)
}})()"""


def main() -> int:
    parsed = argparse.ArgumentParser(description=__doc__)
    parsed.add_argument("--exe", type=pathlib.Path, required=True)
    parsed.add_argument("--identifier", required=True)
    options = parsed.parse_args()
    if sys.platform != "win32":
        print("this probe drives a Windows build")
        return 0

    close_app, run_probe, browser = windows_side()
    browser.wipe(options.identifier)
    folder = browser.spaces_root() / SPACE
    folder.mkdir(parents=True)
    (folder / f"{NOTE}.md").write_text(f"# {NOTE}\n\nA note to open the space on.\n", encoding="utf-8")

    wrong: list[str] = []
    running = None
    try:
        running = run_probe(options.exe, quiet=True)
        port, secret = browser.endpoint(options.identifier, 90, running.pid)
        browser.shown(running.pid)
        browser.act(port, secret, "open", {"path": f"{NOTE}.md", "space": SPACE})
        time.sleep(3)
        if not close_app(running):
            running.terminate()
        running.wait(timeout=30)
        browser.allow_eval(options.identifier)

        running = run_probe(options.exe, quiet=True)
        port, secret = browser.endpoint(options.identifier, 90, running.pid)
        browser.shown(running.pid)
        until = time.perf_counter() + 60
        while browser.ask(port, secret, "1 + 1") != 2 and time.perf_counter() < until:
            time.sleep(1)
        time.sleep(5)

        built = sorted((HERE.parent / "apps" / "desktop" / "dist" / "assets").glob("png-worker*.js"))
        worker = f"/assets/{built[0].name}" if built else None
        said = browser.ask(port, secret, probe(folder, worker))
        if isinstance(said, str):
            said = json.loads(said)
        if not isinstance(said, list) or not said:
            wrong.append(f"the page answered {said}")
            return finish([], wrong)
        digest, *timings = said
        for one in timings:
            print(f"{one['name']:20} {one['ms']:6} ms  longest task {one['longest']:5} ms  ({one['long']} long)  {one['error'] or one['value'] or ''}")
            if one["error"]:
                wrong.append(f"{one['name']}: {one['error']}")
            elif ("raw" in one["name"] or "worker" in one["name"]) and one["longest"] > LONGEST_MS:
                wrong.append(f"{one['name']}: the window's JS thread was held for {one['longest']} ms")
        for name in ("raw.bin", "old.bin", "attachments/saved.bin"):
            path = folder / name
            if not path.exists() or hashlib.sha256(path.read_bytes()).hexdigest() != digest:
                wrong.append(f"{name} on disk is not the bytes the page sent")
        peeked = next((one for one in timings if one["name"] == "explorer_peek raw"), None)
        if peeked and not peeked["error"] and not (peeked["value"] or {}).get("same"):
            wrong.append(f"the peek read back other bytes: {peeked['value']}")
    finally:
        if running and running.poll() is None:
            if not close_app(running):
                running.terminate()
    return finish([], wrong)


def finish(_: list[Any], wrong: list[str]) -> int:
    for one in wrong:
        print(f"WRONG: {one}")
    return 1 if wrong else 0


if __name__ == "__main__":
    os.environ.setdefault("PYTHONIOENCODING", "utf-8")
    sys.exit(main())
