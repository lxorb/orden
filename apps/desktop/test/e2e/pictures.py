from __future__ import annotations

import base64
import json
import struct
import tempfile
import zipfile
import zlib
from pathlib import Path

from playwright.sync_api import Browser, Page

from harness import Drive

DRIVE = Drive(__file__)
say, wrong, shot, wait_for = DRIVE.say, DRIVE.wrong, DRIVE.shot, DRIVE.wait_for
ORIGIN = DRIVE.origin

def png(width: int, height: int, tint: tuple[int, int, int]) -> bytes:

    def chunk(kind: bytes, body: bytes) -> bytes:
        return (
            struct.pack(">I", len(body))
            + kind
            + body
            + struct.pack(">I", zlib.crc32(kind + body))
        )

    rows = bytearray()
    for y in range(height):
        rows.append(0)
        for x in range(width):
            rows.append(tint[0] * (x + 1) // width)
            rows.append(tint[1] * (y + 1) // height)
            rows.append(tint[2])

    head = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)
    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", head)
        + chunk(b"IDAT", zlib.compress(bytes(rows), 9))
        + chunk(b"IEND", b"")
    )

PASTED = base64.b64encode(png(220, 150, (250, 120, 60))).decode()
DROPPED = base64.b64encode(png(180, 180, (70, 170, 250))).decode()
IMPORTED = png(200, 130, (120, 220, 130))

PLAN = "1a2b3c4d5e6f78901a2b3c4d5e6f7890"
KIT = "aaaabbbbccccddddeeeeffff00001111"

def notion_zip(into: Path) -> Path:
    path = into / "Export-4b7c1d2e.zip"

    with zipfile.ZipFile(path, "w") as zip_file:
        zip_file.writestr(
            f"Plan {PLAN}.md",
            f"# Plan\n\nSee [Kit list](Plan%20{PLAN}/Kit%20list%20{KIT}.md).\n",
        )
        zip_file.writestr(
            f"Plan {PLAN}/Kit list {KIT}.md",
            f"# Kit list\n\nA tent and a stove.\n\n![](tent%20{KIT}.png)\n",
        )
        zip_file.writestr(f"Plan {PLAN}/tent {KIT}.png", IMPORTED)

    return path

NOTE = """# Pictures

Paste one here:

"""

SEED = """
async (note) => {
  const ws = window.nibApp.workspace
  await ws.noteFrom(note, ws.activeSpace.root)
  await ws.loadTree()
  const found = ws.notes.find((one) => one.name.startsWith('Pictures'))
  await ws.openEntry(found.path, { activate: true })
  return { name: found.name, root: ws.activeSpace.root }
}
"""

PASTE = """
([base64, name, selector]) => {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let at = 0; at < binary.length; at++) bytes[at] = binary.charCodeAt(at)

  const data = new DataTransfer()
  data.items.add(new File([bytes], name, { type: 'image/png' }))

  const target = document.querySelector(selector)
  if (!target) return false

  target.focus()
  return target.dispatchEvent(
    new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }),
  )
}
"""

DROP = """
([base64, name, selector]) => {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let at = 0; at < binary.length; at++) bytes[at] = binary.charCodeAt(at)

  const data = new DataTransfer()
  data.items.add(new File([bytes], name, { type: 'image/png' }))

  const plane = document.querySelector(selector)
  if (!plane) return false

  const box = plane.getBoundingClientRect()
  return plane.dispatchEvent(
    new DragEvent('drop', {
      dataTransfer: data,
      bubbles: true,
      cancelable: true,
      clientX: box.left + box.width / 2,
      clientY: box.top + box.height / 2,
    }),
  )
}
"""

DRAWN = """
() => {
  const seen = []
  for (const image of document.querySelectorAll('img[src*="/asset/"]')) {
    const box = image.getBoundingClientRect()
    seen.push({
      src: new URL(image.src).pathname,
      complete: image.complete,
      width: image.naturalWidth,
      height: image.naturalHeight,
      left: Math.round(box.left),
      drawn: Math.round(box.width),
    })
  }
  return {
    controlled: navigator.serviceWorker.controller !== null,
    images: seen,
    // The editor's own placeholder, which is what a picture that did not load
    // leaves behind. Nothing here should be wearing it.
    broken: document.querySelectorAll('.orden-image-frame.is-broken').length,
    loading: document.querySelectorAll('.orden-image-frame.is-loading').length,
  }
}
"""

ASKED = """
async (path) => {
  const answer = await fetch(path)
  return {
    status: answer.status,
    type: answer.headers.get('content-type'),
    cache: answer.headers.get('cache-control'),
    bytes: (await answer.arrayBuffer()).byteLength,
  }
}
"""

OWN_CHUNK = """
async () => {
  const found = [...document.querySelectorAll('script[src]')]
    .map((one) => one.src)
    .find((one) => one.includes('/assets/'))
  if (!found) return null

  const answer = await fetch(found)
  return { status: answer.status, type: answer.headers.get('content-type') }
}
"""

FIXTURES = Path(tempfile.gettempdir())

def started(page: Page) -> dict:
    wait_for(page, "window.nibApp", "the app")
    wait_for(page, "window.nibApp.workspace.activeSpace", "a space")
    wait_for(page, "window.nib && document.querySelector('.cm-content')", "the editor")
    return page.evaluate("() => ({ root: window.nibApp.workspace.activeSpace.root })")

def fresh(browser: Browser, finger: bool) -> Page:
    context = browser.new_context(
        service_workers="allow",
        viewport={"width": 420, "height": 880} if finger else {"width": 1180, "height": 900},
        color_scheme="light",
        has_touch=finger,
        is_mobile=finger,
        **(
            {
                "user_agent": "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36"
                " (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36"
            }
            if finger
            else {}
        ),
    )
    page = context.new_page()
    DRIVE.choosers(page)
    page.on("pageerror", lambda error: wrong(f"page error: {error}"))
    page.goto(ORIGIN, wait_until="domcontentloaded")

    started(page)
    seeded = page.evaluate(SEED, NOTE)
    say(f"the space {seeded['root']} holds {seeded['name']}")
    wait_for(page, "window.nib && document.querySelector('.cm-content')", "the editor")
    page.wait_for_timeout(600)
    return page

def paste_into_note(page: Page, where: str) -> str:
    page.evaluate(PASTE, [PASTED, "pasted.png", ".cm-content"])
    wait_for(
        page,
        "window.nibApp.workspace.active.doc.includes('](assets/')",
        f"[{where}] the paste to reach the note",
    )

    written = page.evaluate(
        "() => /!\\[\\]\\(([^)]+)\\)/.exec(window.nibApp.workspace.active.doc)?.[1] ?? ''"
    )
    say(f"[{where}] the note now says ![]({written})")
    if not written.startswith("assets/"):
        wrong(f"{where}: the paste wrote {written!r}, not a path beside the note")

    page.wait_for_timeout(700)
    return written

def expect_drawn(page: Page, where: str, most: int, wide: int | None = None) -> dict:
    state = page.evaluate(DRAWN)
    say(f"[{where}] {json.dumps(state)}")

    if not state["controlled"]:
        wrong(f"{where}: no worker is in front of the page, so nothing can answer")
    if len(state["images"]) != most:
        wrong(f"{where}: {len(state['images'])} pictures asked of the store, not {most}")
    if state["broken"]:
        wrong(f"{where}: {state['broken']} pictures wearing the missing placeholder")

    for image in state["images"]:
        if not image["complete"] or image["width"] < 1:
            wrong(f"{where}: {image['src']} did not draw ({image['width']}px wide)")
        if wide is not None and (image["left"] < 0 or image["left"] + image["drawn"] > wide):
            wrong(f"{where}: {image['src']} runs off a {wide}px screen: {image}")

    return state

THREE = """
(relative) => {
  const view = window.nib
  const name = relative.split('/').pop()
  const text = [
    '# Pictures',
    '',
    'Beside the note, as the paste wrote it:',
    '',
    '![pasted](' + relative + ')',
    '',
    'By its name alone, the way Obsidian finds an attachment:',
    '',
    '![[' + name + ']]',
    '',
    'And as plain HTML, which the renderer passes straight through:',
    '',
    '<img src="' + relative + '" alt="as markup" width="120">',
    '',
  ].join('\\n')

  view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } })
  return name
}
"""

def three_ways(page: Page, where: str, relative: str) -> None:
    name = relative.split("/")[-1]
    page.evaluate("() => window.nibApp.workspace.loadTree()")
    page.evaluate("() => window.nibApp.links.build(window.nibApp.workspace.activeSpace.root)")
    wait_for(page, f"window.nibApp.links.fileNamed('{name}')", f"[{where}] the index to know it")

    page.evaluate(THREE, relative)
    page.wait_for_timeout(1200)

OPEN_NAMED = """
async (stem) => {
  const ws = window.nibApp.workspace
  await ws.loadTree()
  const found = ws.notes.find((one) => one.name.startsWith(stem))
  if (!found) return null
  await ws.openEntry(found.path, { activate: true })
  return found.path
}
"""

def imported(page: Page, where: str, zip_path: Path) -> None:
    page.wait_for_function("() => !!window.nibApp.importing", timeout=20000)
    page.evaluate("() => window.nibApp.importing.show()")
    page.wait_for_selector("button.drop", timeout=20000)
    page.wait_for_timeout(450)

    with page.expect_file_chooser() as chooser:
        page.click("button.drop")
    chooser.value.set_files(str(zip_path))

    page.wait_for_function("() => window.nibApp.importing.stage === 'ready'", timeout=30000)
    say(f"[{where}] the sheet read a {page.evaluate('() => window.nibApp.importing.format')}")
    page.click("button.orden-button")
    page.wait_for_function("() => window.nibApp.importing.stage === 'done'", timeout=60000)
    page.evaluate("() => window.nibApp.importing.close()")
    page.wait_for_timeout(400)

    opened = page.evaluate(OPEN_NAMED, "Kit list")
    if not opened:
        wrong(f"{where}: nothing called Kit list arrived")
        return

    page.wait_for_timeout(1200)
    say(f"[{where}] {opened} says {page.evaluate('() => window.nibApp.workspace.active.doc')!r}")

def drive(browser: Browser) -> None:
    page = fresh(browser, finger=False)
    root = page.evaluate("() => window.nibApp.workspace.activeSpace.root")

    relative = paste_into_note(page, "editor")
    shot(page, "01-editor-pasted")
    expect_drawn(page, "editor", 1)

    three_ways(page, "editor", relative)
    shot(page, "02-editor-three-ways")
    expect_drawn(page, "editor three ways", 3)

    page.evaluate("() => window.nibApp.workspace.toggleReading()")
    page.wait_for_timeout(1200)
    shot(page, "03-reading-three-ways")
    expect_drawn(page, "reading", 3)

    page.reload(wait_until="domcontentloaded")
    started(page)
    page.wait_for_timeout(1400)
    shot(page, "04-editor-after-reload")
    expect_drawn(page, "editor after a reload", 3)

    page.evaluate("() => window.nibApp.workspace.toggleReading()")
    page.wait_for_timeout(1200)
    shot(page, "05-reading-after-reload")
    expect_drawn(page, "reading after a reload", 3)

    space = root.strip("/")
    name = relative.split("/")[-1]
    hit = page.evaluate(ASKED, f"/asset/{space}/{relative}")
    say(f"[worker] a hit: {json.dumps(hit)}")
    if hit["status"] != 200:
        wrong(f"the worker answered {hit['status']} for a picture that is there")
    if hit["type"] != "image/png":
        wrong(f"the worker called a PNG {hit['type']!r}")
    if hit["bytes"] < 100:
        wrong(f"the worker answered with {hit['bytes']} bytes")
    if "immutable" not in (hit["cache"] or ""):
        wrong(f"a picture named {name} was not offered for keeping: {hit['cache']!r}")

    miss = page.evaluate(ASKED, f"/asset/{space}/assets/nowhere.png")
    say(f"[worker] a miss: {json.dumps(miss)}")
    if miss["status"] != 404:
        wrong(f"a picture that is not there answered {miss['status']}, not 404")

    chunk = page.evaluate(OWN_CHUNK)
    say(f"[worker] the app's own chunk: {json.dumps(chunk)}")
    if not chunk:
        wrong("the page carries no chunk under /assets/ to check")
    elif chunk["status"] != 200 or "javascript" not in (chunk["type"] or ""):
        wrong(f"the worker answered for the app's own code: {chunk}")

    page.evaluate("() => window.nibApp.workspace.toggleReading()")
    page.wait_for_timeout(500)

    imported(page, "import", notion_zip(FIXTURES))
    shot(page, "06-editor-imported")
    expect_drawn(page, "the imported note", 1)

    brought = page.evaluate(
        "() => new URL(document.querySelector('img[src*=\"/asset/\"]').src).pathname"
    )
    asked = page.evaluate(ASKED, brought)
    say(f"[worker] the imported picture: {brought} {json.dumps(asked)}")
    if asked["type"] != "image/png":
        wrong(f"the imported picture is served as {asked['type']!r}")
    if asked["cache"] != "no-cache":
        wrong(f"a picture named by a person was offered for keeping: {asked['cache']!r}")

    page.evaluate("() => window.nibApp.workspace.toggleReading()")
    page.wait_for_timeout(1200)
    shot(page, "07-reading-imported")
    expect_drawn(page, "the imported note, read", 1)
    page.evaluate("() => window.nibApp.workspace.toggleReading()")
    page.wait_for_timeout(400)

    opened = "window.nibApp.workspace.active?.path?.endsWith('.canvas')"
    for _try in range(4):
        page.evaluate("() => window.nibApp.workspace.createCanvas()")
        page.wait_for_timeout(700)
        if page.evaluate(f"() => !!({opened})"):
            break
    else:
        wrong("no canvas ever opened")
        page.context.close()
        return

    page.wait_for_selector(".canvas", timeout=15000)
    page.evaluate(DROP, [DROPPED, "dropped.png", ".canvas"])
    page.wait_for_timeout(1600)

    plane = page.evaluate(
        """() => {
          const found = document.querySelector('.canvas img.picture')
          if (!found) return null
          return {
            src: new URL(found.src).pathname,
            complete: found.complete,
            width: found.naturalWidth,
          }
        }"""
    )
    say(f"[plane] {json.dumps(plane)}")
    shot(page, "08-plane-dropped")
    if not plane:
        wrong("a picture dropped on the plane is not on the plane")
    else:
        if "/asset/" not in plane["src"]:
            wrong(f"the plane asks for {plane['src']}, not the asset store")
        if not plane["complete"] or plane["width"] < 1:
            wrong(f"the picture on the plane did not draw: {plane}")
    if page.evaluate("() => document.querySelectorAll('.canvas .missing').length"):
        wrong("the plane says there is nothing there")

    page.context.close()

def finger(browser: Browser) -> None:
    page = fresh(browser, finger=True)

    relative = paste_into_note(page, "phone editor")
    shot(page, "10-phone-editor")
    expect_drawn(page, "phone editor", 1, wide=420)

    three_ways(page, "phone", relative)
    page.evaluate("() => window.nibApp.workspace.toggleReading()")
    page.wait_for_timeout(1400)
    shot(page, "11-phone-reading")
    expect_drawn(page, "phone reading", 3, wide=420)

    page.reload(wait_until="domcontentloaded")
    started(page)
    page.wait_for_timeout(1400)
    shot(page, "12-phone-after-reload")
    expect_drawn(page, "phone editor after a reload", 3, wide=420)

    page.evaluate("() => window.nibApp.workspace.toggleReading()")
    page.wait_for_timeout(1200)
    shot(page, "13-phone-reading-after-reload")
    expect_drawn(page, "phone reading after a reload", 3, wide=420)
    page.evaluate("() => window.nibApp.workspace.toggleReading()")
    page.wait_for_timeout(400)

    imported(page, "phone import", notion_zip(FIXTURES))
    shot(page, "14-phone-imported")
    expect_drawn(page, "the imported note on a phone", 1, wide=420)

    page.evaluate("() => window.nibApp.workspace.toggleReading()")
    page.wait_for_timeout(1200)
    shot(page, "15-phone-reading-imported")
    expect_drawn(page, "the imported note read on a phone", 1, wide=420)

    page.context.close()

def main() -> int:
    global FIXTURES

    with tempfile.TemporaryDirectory() as made:
        FIXTURES = Path(made)
        with DRIVE.session() as browser:
            say("--- a pointer ---")
            drive(browser)
            say("--- a finger ---")
            finger(browser)

    return DRIVE.verdict("a picture pasted, named, imported and dropped draws everywhere")

if __name__ == "__main__":
    raise SystemExit(main())
