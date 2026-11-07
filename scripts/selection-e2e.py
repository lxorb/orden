from __future__ import annotations

import functools
import http.server
import json
import os
import pathlib
import socket
import statistics
import sys
import time
import threading

from playwright.sync_api import Page, sync_playwright

ROOT = pathlib.Path(__file__).resolve().parent.parent
DIST = ROOT / "apps" / "desktop" / "dist"
OUT = ROOT / "target" / "selection-e2e"

CHROME_HOME = pathlib.Path(os.environ["LOCALAPPDATA"]) / "ms-playwright"

NOTE_PATH = "/Notes/Selection.md"

NOTE = """# Selecting a heading

A paragraph before it, long enough that the selection has to wrap and the block
has to carry two full lines of the same width in the middle of itself.

- a bullet, indented past the margin
- another bullet, longer than the one above it so the block steps
- a third

```ts
const answer = 42
const shape = 'one block, smoothed'
```

A closing paragraph, with enough words in it that a selection can stop in the
middle of a line and leave a step behind it.

עברית קו של טקסט מימין לשמאל, ואחריו עוד מילים כדי שהבחירה תמשך.

The last paragraph of the note.
"""

LONG = "".join(f"Line {number} of a long note, with words enough to wrap.\n\n" for number in range(200))

SEED = """
async ([notePath, note, longPath, long]) => {
  // Whatever version the app made, rather than a number this script would have to
  // keep in step with web/store.ts: the page has already opened the database by the
  // time this runs, so the stores are there.
  const db = await new Promise((resolve, reject) => {
    const request = indexedDB.open('orden')
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })

  // Two rows per file, because the app keeps the listing apart from the words:
  // `files` is what a note is read from and `stats` is what the file list walks.
  // See web/store.ts.
  const put = (row) => new Promise((resolve, reject) => {
    const change = db.transaction(['files', 'stats'], 'readwrite')
    change.objectStore('files').put(row)
    change.objectStore('stats').put({ path: row.path, modified: row.modified, created: row.created })
    change.oncomplete = () => resolve()
    change.onerror = () => reject(change.error)
  })

  const now = Date.now()
  await put({ path: notePath, content: note, modified: now, created: now })
  await put({ path: longPath, content: long, modified: now, created: now })
  return true
}
"""

BLOCKS = """() =>
  [...document.querySelectorAll('.cm-nib-selection-block')].map((block) => {
    const box = block.getBoundingClientRect()
    return {
      left: box.left,
      top: box.top,
      width: box.width,
      height: box.height,
      clip: block.style.clipPath,
      arcs: (block.style.clipPath.match(/A /g) ?? []).length,
    }
  })
"""

WATCH = """() => {
  window.__frames = []
  window.__watching = true
  let last = performance.now()
  const tick = (now) => {
    window.__frames.push(now - last)
    last = now
    if (window.__watching) requestAnimationFrame(tick)
  }
  requestAnimationFrame(tick)
}
"""

DRAWN = """() => ({
  blocks: document.querySelectorAll('.cm-nib-selection-block').length,
  rectangles: [...document.querySelectorAll('.cm-selectionBackground')].filter(
    (one) => getComputedStyle(one).display !== 'none',
  ).length,
})
"""

def say(words: str) -> None:
    print(f"  {words}", flush=True)

def chrome() -> pathlib.Path:
    found = sorted(CHROME_HOME.glob("chromium-1*/chrome-win*/chrome.exe"))
    if not found:
        raise SystemExit(f"no Chromium under {CHROME_HOME}")

    return found[-1]

def free_port() -> int:
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])

class Quiet(http.server.SimpleHTTPRequestHandler):

    def log_message(self, *_args):
        pass

def serve() -> tuple[str, http.server.ThreadingHTTPServer]:
    port = free_port()
    server = http.server.ThreadingHTTPServer(
        ("127.0.0.1", port), functools.partial(Quiet, directory=str(DIST))
    )
    threading.Thread(target=server.serve_forever, daemon=True).start()

    return f"http://127.0.0.1:{port}/", server

def wait_for(page: Page, script: str, what: str, patience: float = 30):
    until = time.monotonic() + patience
    while time.monotonic() < until:
        answer = page.evaluate(script)
        if answer:
            return answer
        page.wait_for_timeout(50)

    raise SystemExit(f"gave up waiting for {what}")

LISTED = """(path) => {
  const walk = (entry) => (entry ? [entry.path, ...(entry.children ?? []).flatMap(walk)] : [])
  return walk(window.ordenApp.workspace.tree).includes(path)
}
"""

def opened(page: Page, path: str) -> None:
    wait_for(page, f"() => ({LISTED})({json.dumps(path)})", f"{path} to be listed")
    page.evaluate(f"() => window.ordenApp.workspace.open({json.dumps(path)})")
    wait_for(page, "() => !!window.orden && !!document.querySelector('.cm-content')", f"{path} to open")
    page.wait_for_timeout(600)

def select(page: Page, anchor: int, head: int) -> list[dict]:
    page.evaluate(
        "([anchor, head]) => {"
        "  window.orden.focus();"
        "  window.orden.dispatch({ selection: { anchor, head }, scrollIntoView: true })"
        "}",
        [anchor, head],
    )
    page.wait_for_timeout(260)

    return page.evaluate(BLOCKS)

def at(page: Page, words: str, offset: int = 0) -> int:
    found = page.evaluate(
        "(words) => window.orden.state.doc.toString().indexOf(words)",
        words,
    )
    if found < 0:
        raise SystemExit(f"the note does not say {words!r}")

    return found + offset

def shot(page: Page, name: str, blocks: list[dict], pad: int = 14) -> None:
    if not blocks:
        raise SystemExit(f"{name}: nothing was drawn")

    left = min(block["left"] for block in blocks)
    top = min(block["top"] for block in blocks)
    right = max(block["left"] + block["width"] for block in blocks)
    bottom = max(block["top"] + block["height"] for block in blocks)
    page.screenshot(
        path=str(OUT / f"{name}.png"),
        clip={
            "x": max(0, left - pad),
            "y": max(0, top - pad),
            "width": min(right - left + pad * 2, 1200),
            "height": min(bottom - top + pad * 2, 900),
        },
    )
    say(f"{name}: {len(blocks)} block, {sum(block['arcs'] for block in blocks)} arcs")

def closeup(page: Page, name: str, room: int = 40) -> None:
    end = page.evaluate(
        "() => { const at = window.orden.coordsAtPos(window.orden.state.selection.main.to);"
        " return at && { left: at.left, top: at.top, bottom: at.bottom } }"
    )
    if not end:
        raise SystemExit(f"{name}: the end of the selection is off the screen")

    page.screenshot(
        path=str(OUT / f"{name}.png"),
        clip={
            "x": max(0, end["left"] - room),
            "y": max(0, end["top"] - room),
            "width": room * 2,
            "height": end["bottom"] - end["top"] + room * 2,
        },
    )
    say(f"{name}: the step, close up")

def behaves(page: Page) -> None:
    select(page, at(page, "A closing paragraph"), at(page, "and leave a step", 10))
    eased = page.evaluate(
        "() => { const block = document.querySelector('.cm-nib-selection-block');"
        " const layer = block.parentElement;"
        " const of = getComputedStyle(block);"
        " return { animation: of.animationName, over: of.animationDuration,"
        "   through: getComputedStyle(layer).pointerEvents, blend: getComputedStyle(layer).mixBlendMode } }"
    )
    say(f"the block: {eased}")
    if eased["animation"] != "cm-nib-selection-in":
        raise SystemExit("the block does not ease in")
    if eased["through"] != "none":
        raise SystemExit("the layer takes the pointer")

    page.emulate_media(reduced_motion="reduce")
    page.wait_for_timeout(150)
    still = page.evaluate(
        "() => getComputedStyle(document.querySelector('.cm-nib-selection-block')).animationDuration"
    )
    page.emulate_media(reduced_motion="no-preference")
    say(f"asked for less motion, the block eases over {still}")
    if still != "0s":
        raise SystemExit("less motion was asked for and the block still eases in")

    blocks = page.evaluate(BLOCKS)
    box = blocks[0]
    page.mouse.click(box["left"] + box["width"] / 2, box["top"] + box["height"] / 2)
    page.wait_for_timeout(200)
    if not page.evaluate("() => window.orden.state.selection.main.empty"):
        raise SystemExit("a click inside the selection did not reach the text")
    say("a click inside the block reaches the text under it")

def scheme(page: Page, which: str) -> None:
    page.evaluate(f"() => window.ordenApp.theme.select({json.dumps(which)})")
    page.wait_for_timeout(300)

def frames(page: Page) -> dict[str, list[float]]:
    box = page.evaluate(
        "() => { const box = document.querySelector('.cm-content').getBoundingClientRect();"
        " return { left: box.left, top: box.top, width: box.width } }"
    )
    top = box["top"] + 40
    x = box["left"] + box["width"] / 2
    height = page.evaluate("() => window.innerHeight") - 4
    steps = 40

    measured: dict[str, list[float]] = {}
    for label, pressed in (("idle", False), ("dragging", True)):
        page.evaluate("() => window.orden.dispatch({ selection: { anchor: 0 }, scrollIntoView: true })")
        page.wait_for_timeout(300)
        page.mouse.move(x, top)
        if pressed:
            page.mouse.down()

        page.evaluate(WATCH)
        for step in range(steps):
            page.mouse.move(x, top + height * (step + 1) / steps)
            page.wait_for_timeout(16)

        for _ in range(260):
            page.mouse.move(x, top + height, steps=1)
            page.wait_for_timeout(16)

        page.evaluate("() => { window.__watching = false }")
        if pressed:
            page.mouse.up()

        measured[label] = page.evaluate("() => window.__frames.slice(1)")
        lines = page.evaluate(
            "() => { const { from, to } = window.orden.state.selection.main;"
            " return window.orden.state.doc.lineAt(to).number - window.orden.state.doc.lineAt(from).number }"
        )
        drawn = page.evaluate(DRAWN)
        say(
            f"{label}: {len(measured[label])} frames, {lines} lines selected,"
            f" {drawn['blocks']} blocks, {drawn['rectangles']} of the view's own rectangles shown"
        )
        if drawn["rectangles"]:
            raise SystemExit("the view is painting its rectangles as well as the block")

    return measured

def report(measured: dict[str, list[float]]) -> None:
    lines = []
    for label, times in measured.items():
        ordered = sorted(times)
        worst = ordered[-1] if ordered else 0
        late = [one for one in times if one > 20]
        lines.append(
            f"{label}: median {statistics.median(ordered):.1f} ms, "
            f"95th {ordered[int(len(ordered) * 0.95)]:.1f} ms, worst {worst:.1f} ms, "
            f"{len(late)} of {len(times)} frames over 20 ms"
        )

    (OUT / "frames.txt").write_text("\n".join(lines) + "\n", encoding="utf-8")
    for line in lines:
        say(line)

def main() -> int:
    if not (DIST / "index.html").exists():
        raise SystemExit(f"no build under {DIST}")

    OUT.mkdir(parents=True, exist_ok=True)
    origin, server = serve()
    say(f"serving the build on {origin}")

    with sync_playwright() as play:
        browser = play.chromium.launch(executable_path=str(chrome()))
        try:
            context = browser.new_context(
                viewport={"width": 1100, "height": 760}, device_scale_factor=3
            )
            page = context.new_page()
            page.on("pageerror", lambda error: say(f"page error: {error}"))
            page.goto(origin, wait_until="domcontentloaded")
            wait_for(page, "() => !!window.ordenApp", "the app to start")
            wait_for(page, "() => !!window.ordenApp.workspace.activeSpace", "the space")
            page.evaluate(SEED, [NOTE_PATH, NOTE, "/Notes/Long.md", LONG])
            page.reload(wait_until="domcontentloaded")
            wait_for(page, "() => !!window.ordenApp", "the app to start again")
            opened(page, NOTE_PATH)
            radius = page.evaluate(
                "() => getComputedStyle(document.querySelector('.cm-content'))"
                ".getPropertyValue('--selection-radius')"
            )
            say(f"the theme asks for a corner of {radius.strip() or '(nothing)'}")

            for label, name in (("dark", "dark"), ("light", "light")):
                scheme(page, label)

                start = at(page, "long enough that")
                shot(page, f"{name}-one-line", select(page, start, start + 22))

                shot(
                    page,
                    f"{name}-heading-and-list",
                    select(page, at(page, "# Selecting"), at(page, "- another bullet", 14)),
                )

                shot(
                    page,
                    f"{name}-code-block",
                    select(page, at(page, "```ts"), at(page, "const shape", 20)),
                )

                shot(
                    page,
                    f"{name}-ends-mid-line",
                    select(page, at(page, "A closing paragraph"), at(page, "and leave a step", 10)),
                )
                closeup(page, f"{name}-fillet")

                shot(
                    page,
                    f"{name}-apart",
                    select(page, at(page, "can stop in the"), at(page, "middle of a line", 6)),
                )

                shot(
                    page,
                    f"{name}-wrapped-paragraph",
                    select(page, at(page, "A paragraph before"), at(page, "middle of itself", 12)),
                )

                start = at(page, "עברית")
                shot(page, f"{name}-right-to-left", select(page, start, start + 30))

            page.evaluate("() => window.ordenApp.modes.toggleRightToLeft(window.orden)")
            page.wait_for_timeout(300)
            start = at(page, "עברית")
            shot(page, "light-right-to-left-mode", select(page, start - 40, start + 30))
            page.evaluate("() => window.ordenApp.modes.toggleRightToLeft(window.orden)")

            scheme(page, "dark")
            page.evaluate("() => window.ordenApp.modes.setZoom(1.6)")
            page.wait_for_timeout(400)
            start = at(page, "long enough that")
            shot(page, "dark-zoomed", select(page, start, start + 60))
            page.evaluate("() => window.ordenApp.modes.setZoom(1)")

            behaves(page)

            say("dragging a selection down two hundred lines")
            opened(page, "/Notes/Long.md")
            report(frames(page))

            context.close()
        finally:
            browser.close()
            server.shutdown()
            server.server_close()

    say(f"the shots are under {OUT}")

    return 0

if __name__ == "__main__":
    sys.exit(main())
