from __future__ import annotations

import base64
import json
import math
import shutil
import struct
import subprocess
import tempfile
from pathlib import Path

from playwright.sync_api import Browser

from harness import Drive

DRIVE = Drive(__file__)
say, wrong, wait_for = DRIVE.say, DRIVE.wrong, DRIVE.wait_for

SECONDS = 6
AT = 3

def wav() -> bytes:
    rate = 22_050
    frames = bytearray()
    for at in range(rate * SECONDS):
        frames += struct.pack("<h", int(math.sin(2 * math.pi * 330 * at / rate) * 9000))
    head = b"RIFF" + struct.pack("<I", 36 + len(frames)) + b"WAVEfmt "
    head += struct.pack("<IHHIIHH", 16, 1, 1, rate, rate * 2, 2, 16)
    return head + b"data" + struct.pack("<I", len(frames)) + bytes(frames)

def clips() -> dict[str, bytes]:
    made = {"/Media/assets/tone.wav": wav()}
    if not shutil.which("ffmpeg"):
        say("no ffmpeg here, so the sound alone")
        return made
    for name, codec in (("clip.mp4", ["-c:v", "libx264", "-pix_fmt", "yuv420p"]), ("clip.webm", ["-c:v", "libvpx"])):
        out = Path(tempfile.mkdtemp()) / name
        source = f"testsrc=duration={SECONDS}:size=160x120:rate=15"
        ran = subprocess.run(["ffmpeg", "-loglevel", "error", "-f", "lavfi", "-i", source, *codec, str(out)], check=False)
        if ran.returncode == 0:
            made[f"/Media/assets/{name}"] = out.read_bytes()
    return made

PUT = """
async (rows) => {
  const db = await new Promise((done, failed) => {
    const asked = indexedDB.open('nib')
    asked.onsuccess = () => done(asked.result)
    asked.onerror = () => failed(asked.error)
  })
  await new Promise((done, failed) => {
    const change = db.transaction('assets', 'readwrite')
    for (const row of rows) change.objectStore('assets').put(row)
    change.oncomplete = done
    change.onerror = () => failed(change.error)
  })
}
"""

PLAY = """
async ([src, tag, at]) => {
  const player = document.createElement(tag)
  player.muted = true
  player.preload = 'auto'
  document.body.append(player)
  const read = await new Promise((done) => {
    const late = setTimeout(() => done('nothing in eight seconds'), 8000)
    player.addEventListener('loadedmetadata', () => { clearTimeout(late); done('read') })
    player.addEventListener('error', () => { clearTimeout(late); done(`error ${player.error?.code} ${player.error?.message ?? ''}`) })
    player.src = src
  })
  let seeked = null
  if (read === 'read') {
    seeked = await new Promise((done) => {
      const late = setTimeout(() => done(null), 6000)
      player.addEventListener('seeked', () => { clearTimeout(late); done(player.currentTime) }, { once: true })
      player.currentTime = at
    })
  }
  const out = {
    read,
    duration: player.duration,
    seekable: player.seekable.length ? player.seekable.end(player.seekable.length - 1) : 0,
    seeked,
  }
  player.remove()
  return out
}
"""

def drive(browser: Browser) -> None:
    context = browser.new_context(service_workers="allow")
    page = context.new_page()
    page.on("pageerror", lambda error: wrong(f"page error: {error}"))
    DRIVE.open(page)
    wait_for(page, "window.nibApp && window.nibApp.workspace.active", "the app")
    wait_for(page, "navigator.serviceWorker.controller", "the asset worker")

    files = clips()
    page.evaluate(PUT, [{"path": path, "type": "", "data": base64.b64encode(data).decode(), "modified": 1} for path, data in files.items()])

    for path in files:
        tag = "audio" if path.endswith(".wav") else "video"
        played = page.evaluate(PLAY, [f"/asset{path}", tag, AT])
        say(f"{path}: {json.dumps(played)}")
        if played["read"] != "read":
            wrong(f"{path} would not play from the space: {played['read']}")
            continue
        if played["seekable"] < SECONDS - 0.5:
            wrong(f"{path} can be sought only to {played['seekable']} of {played['duration']} seconds")
        if played["seeked"] is None or abs(played["seeked"] - AT) > 0.5:
            wrong(f"{path} was moved to {AT} seconds and stood at {played['seeked']}")
    context.close()

if __name__ == "__main__":
    raise SystemExit(DRIVE.run(drive))
