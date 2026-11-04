#!/usr/bin/env python3
"""Two things only a real pointer on a real X server can say, on Linux's CEF, each looked at.

  tree  A note dragged in the file list with xdotool's pointer, as a hand does it: into the
        order in Manual, then into another note (#427). On CEF the engine's own drag ended
        as it started, so neither did anything; see src-tauri/src/page_drag.rs.
        A drag whose window loses the focus with the button held ends and moves nothing; a
        right button pressed and let go during one leaves it going; a word dragged inside
        the editor moves.
  zoom  Settings > Appearance > Window > Zoom (#680) at each rung: the page's own ratio, the
        sidebar as many screen pixels wider, and the web tab's page, a native window placed
        from the layout, in its hole to the pixel: its colour on the hole's four inside
        corners and not one pixel beyond its left and top edges. Its site's zoom stays.

Run with Orden up on a web tab of one colour (zoom), its endpoint open to `eval`, as
scripts/x11-launch.sh leaves it:

    python3 scripts/page-drive.py <tree|zoom> <out folder>
"""

import json
import os
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

from PIL import Image

WHAT, OUT = sys.argv[1], Path(sys.argv[2])
CONFIG = Path(os.environ.get("XDG_CONFIG_HOME", Path.home() / ".config")) / "ch.emilvinu.nib"
SITE = (255, 0, 255)
failures = []


def fail(what):
    print(f"::error::{what}")
    failures.append(what)


def endpoint():
    for _ in range(120):
        try:
            kept = json.loads((CONFIG / "automation.json").read_text())
            if kept.get("port"):
                return kept["port"], kept["secret"]
        except (OSError, ValueError):
            pass
        time.sleep(0.5)
    raise SystemExit("::error::the app wrote no endpoint")


PORT, SECRET = endpoint()


def run(code):
    body = json.dumps({"verb": "eval", "args": {"code": code, "yes": True}, "rest": []})
    asked = urllib.request.Request(
        f"http://127.0.0.1:{PORT}/",
        data=body.encode(),
        headers={"authorization": f"Bearer {SECRET}", "content-type": "application/json"},
        method="POST",
    )
    for _ in range(6):
        try:
            with urllib.request.urlopen(asked, timeout=10) as answer:
                said = json.loads(answer.read())
            return said.get("value") if said.get("ok") else None
        except (TimeoutError, OSError):
            time.sleep(1)
    return None


def until(code, what, patience=20.0):
    ends = time.monotonic() + patience
    while time.monotonic() < ends:
        said = run(code)
        if said:
            return said
        time.sleep(0.2)
    fail(f"gave up waiting for {what}")
    return None


def xdo(*words):
    subprocess.run(["xdotool", *map(str, words)], capture_output=True, check=False)


def origin():
    """Where the window's page starts on the screen, under whatever frame a desktop gave it."""
    found = subprocess.run(["xdotool", "search", "--name", "Orden"], capture_output=True, text=True, check=False)
    said = subprocess.run(
        ["xwininfo", "-id", found.stdout.split()[0]], capture_output=True, text=True, check=False
    ).stdout
    x = said.split("Absolute upper-left X:")[1].split()[0]
    y = said.split("Absolute upper-left Y:")[1].split()[0]
    return int(x), int(y)


def move(x, y):
    """The pointer to a place in the window's screen pixels."""
    left, top = origin()
    xdo("mousemove", int(x + left), int(y + top))


def picture(name):
    """The whole screen, as the X server has it."""
    path = OUT / f"{name}.png"
    raw = subprocess.run(["xwd", "-root", "-silent"], capture_output=True, check=False).stdout
    subprocess.run(
        ["ffmpeg", "-y", "-v", "error", "-f", "xwd_pipe", "-i", "-", str(path)],
        input=raw,
        check=False,
    )
    return Image.open(path).convert("RGB")


# The rows by where they stand, top first, in the page's own units.
ROWS = """[...document.querySelectorAll('aside:not(.right) .row')].map((row) => {
  const box = row.getBoundingClientRect()
  return { name: row.querySelector('.nib-row-label')?.textContent.trim(), x: box.x, y: box.y, height: box.height }
}).sort((a, b) => a.y - b.y)"""


def dragged(start, end, y):
    """Pressed on a row and let go at `y` of the way down another, in a hand's steps."""
    ratio = run("devicePixelRatio") or 1
    x = (start["x"] + 40) * ratio
    y0 = (start["y"] + start["height"] / 2) * ratio
    y1 = (end["y"] + end["height"] * y) * ratio
    move(x, y0)
    xdo("mousedown", 1)
    for step in range(1, 13):
        move(x, y0 + (y1 - y0) * step / 12)
        time.sleep(0.05)
    # At rest a moment, as a hand comes to rest before it lets go.
    time.sleep(0.5)
    picture(f"over-{end['name']}")
    xdo("mouseup", 1)


def tree():
    run("""(async () => {
      const ws = nib.workspace
      for (const name of ['Lark', 'Plover', 'Wren']) await ws.noteFrom(`# ${name}\\n\\nwords\\n`, ws.activeSpace.root)
      ws.setSort('manual')
      await ws.loadTree()
      return true
    })()""")
    rows = until(f"(() => {{ const rows = {ROWS}; return rows.length >= 3 ? rows : null }})()", "the rows")
    if not rows:
        return
    print("before", [one["name"] for one in rows])
    # Not the first row, which the first run's tip stands over.
    moving, under = rows[-1], rows[1]
    dragged(moving, under, 0.1)
    # Settled, for its order to be read off where the rows stand.
    until(f"(() => !nib.workspace.arranged.dragging && !document.getAnimations().length)()", "the rows settled")
    now = run(ROWS) or []
    names = [one["name"] for one in now]
    print("reordered", names)
    if names[1:2] != [moving["name"]]:
        fail(f"{moving['name']} let go above {under['name']} did not stand there: {names}")

    dragged(now[1], now[2], 0.5)
    paths = until(
        f"""(() => {{
          const paths = nib.workspace.notes.map((one) => one.path)
          return paths.some((one) => one.endsWith('/{now[2]["name"]}/{now[1]["name"]}.md')) ? paths : null
        }})()""",
        f"{now[1]['name']} in {now[2]['name']}",
    )
    print("nested", paths)
    picture("nested")
    stale()
    chord()
    words()


# Every drag event the page hears, for what was said after a given moment.
HEAR = """(() => {
  window.__heard = []
  for (const type of ['dragover', 'drop', 'dragend'])
    window.addEventListener(type, () => window.__heard.push(type), true)
  return true
})()"""


def lifted(start, end):
    """Pressed on a row and held in the middle of another, the button still down."""
    x = (start["x"] + 40)
    y0 = start["y"] + start["height"] / 2
    y1 = end["y"] + end["height"] / 2
    move(x, y0)
    xdo("mousedown", 1)
    for step in range(1, 13):
        move(x, y0 + (y1 - y0) * step / 12)
        time.sleep(0.05)
    time.sleep(0.5)


def stale():
    """The window loses the focus with the button down, as alt-tab does: nothing goes on. Only
    a window manager moves the focus as a desktop does, so without one it is not asked."""
    wm = subprocess.run(["xprop", "-root", "_NET_SUPPORTING_WM_CHECK"], capture_output=True, text=True, check=False)
    if "window id" not in wm.stdout:
        print("stale: no window manager to take the focus away, not asked")
        return
    # xterm and not xmessage; see the kwin job in wayland.yml.
    other = subprocess.Popen(["xterm", "-geometry", "20x5+1300+800", "-title", "another app"])
    found = ""
    for _ in range(50):
        found = subprocess.run(["xdotool", "search", "--class", "xterm"], capture_output=True, text=True, check=False).stdout
        if found.split():
            break
        time.sleep(0.1)
    own = subprocess.run(["xdotool", "search", "--name", "Orden"], capture_output=True, text=True, check=False).stdout.split()
    xdo("windowactivate", "--sync", own[0])
    run(HEAR)
    rows = run(ROWS) or []
    # A press of its own first, for the page to have the keyboard, as a hand's would.
    move(600, 400)
    xdo("click", 1)
    time.sleep(0.3)
    before = run("nib.workspace.notes.map((one) => one.path).sort()")
    lifted(rows[-1], rows[1])
    heard = run("window.__heard.splice(0)") or []
    if "dragover" not in heard:
        fail(f"no drag to lose the pointer of: {heard[-5:]}")
    xdo("windowactivate", "--sync", found.split()[0])
    time.sleep(0.5)
    heard = run("window.__heard.splice(0)") or []
    if "dragend" not in heard:
        fail(f"the window lost the focus and the drag went on: {heard[-5:]}")
    # Three times over the rate a resting pointer says `dragover` at.
    time.sleep(1.1)
    late = run("window.__heard.splice(0)") or []
    if late:
        fail(f"a drag over with the focus gone still said {late[:5]}")
    xdo("mouseup", 1)
    time.sleep(0.3)
    other.kill()
    xdo("windowactivate", "--sync", own[0])
    # The next plain click, anywhere, that used to end it on the row it was over.
    move(600, 400)
    xdo("click", 1)
    time.sleep(0.5)
    after = run("nib.workspace.notes.map((one) => one.path).sort()")
    if after != before:
        fail(f"a drag that lost its pointer moved a note: {set(after or []) ^ set(before or [])}")
    if "drop" in (run("window.__heard.splice(0)") or []):
        fail("a drag that lost its pointer dropped")
    print("stale: ended with the focus, nothing moved")


def chord():
    """The right button pressed and let go during a left drag leaves it going."""
    run(HEAR)
    rows = run(ROWS) or []
    lifted(rows[-1], rows[1])
    xdo("mousedown", 3)
    time.sleep(0.1)
    xdo("mouseup", 3)
    time.sleep(0.5)
    heard = run("window.__heard.splice(0)") or []
    if "dragend" in heard or "dragover" not in heard:
        fail(f"another button's release ended the drag: {heard[-5:]}")
    xdo("key", "Escape")
    time.sleep(0.3)
    xdo("mouseup", 1)
    time.sleep(0.3)
    if "dragend" not in (run("window.__heard.splice(0)") or []):
        fail("Escape did not end the drag")
    print("chord: went on, Escape ended it")


# Where a word is on the screen, by a range over its text in the editor.
WORD = """((word) => {
  const walker = document.createTreeWalker(document.querySelector('.cm-content'), NodeFilter.SHOW_TEXT)
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const at = node.textContent.indexOf(word)
    if (at < 0) continue
    const range = document.createRange()
    range.setStart(node, at)
    range.setEnd(node, at + word.length)
    const box = range.getBoundingClientRect()
    return { x: box.x, y: box.y, width: box.width, height: box.height }
  }
  return null
})"""


def words():
    """A word selected in the editor and dragged to another line moves there."""
    run("""(async () => {
      const ws = nib.workspace
      const made = await ws.noteFrom('# Words\\n\\nalpha beta gamma\\n\\ndelta epsilon\\n', ws.activeSpace.root)
      const note = ws.notes.find((one) => one.name.startsWith('Words'))
      await ws.openEntry(note.path, { activate: true })
      return !!made
    })()""")
    until(f"!!{WORD}('beta')", "the note in the editor")
    time.sleep(1)
    word = run(f"{WORD}('beta')")
    goal = run(f"{WORD}('epsilon')")
    x, y = word["x"] + word["width"] / 2, word["y"] + word["height"] / 2
    move(x, y)
    xdo("click", "--repeat", 2, "--delay", 60, 1)
    # Past the time a third press would be a triple click.
    time.sleep(0.8)
    print("selected", run("getSelection().toString()"))
    xdo("mousedown", 1)
    x1, y1 = goal["x"] + goal["width"] + 2, goal["y"] + goal["height"] / 2
    for step in range(1, 13):
        move(x + (x1 - x) * step / 12, y + (y1 - y) * step / 12)
        time.sleep(0.05)
    time.sleep(0.5)
    picture("word-over")
    xdo("mouseup", 1)
    time.sleep(0.8)
    picture("word-dropped")
    text = run("[...document.querySelectorAll('.cm-line')].map((one) => one.textContent)") or []
    print("the note", text)
    first = next((one for one in text if "alpha" in one), "")
    second = next((one for one in text if "delta" in one), "")
    if "beta" in first or "beta" not in second:
        fail(f"the word did not move: {text}")


# Where the web tab's hole is, in the page's own units, and what the zoom has made of the page.
HOLE = """(() => {
  const hole = document.querySelector('.hole')
  const aside = document.querySelector('aside:not(.right)')
  if (!hole || !aside) return null
  const box = hole.getBoundingClientRect()
  return {
    x: box.x, y: box.y, width: box.width, height: box.height, ratio: devicePixelRatio,
    sidebar: aside.getBoundingClientRect().width, inner: innerWidth, overflow: document.documentElement.scrollWidth - innerWidth,
  }
})()"""


def corners(shot, hole, label):
    """The site's colour in the hole's four inside corners, and not beyond two of its edges."""
    ratio = hole["ratio"]
    at_x, at_y = origin()
    left, top = hole["x"] * ratio + at_x, hole["y"] * ratio + at_y
    right, bottom = left + hole["width"] * ratio, top + hole["height"] * ratio
    # Five pixels in, past a pane's rounded corner; two out, past a rounded fractional edge.
    for x, y, name in (
        (left + 8, top + 8, "top left"),
        (right - 8, top + 8, "top right"),
        (left + 8, bottom - 8, "bottom left"),
        (right - 8, bottom - 8, "bottom right"),
    ):
        pixel = shot.getpixel((int(x), int(y)))
        if pixel != SITE:
            fail(f"{label}: the hole's {name} ({int(x)}, {int(y)}) is {pixel}, not the page")
    for x, y, name in ((left - 3, (top + bottom) / 2, "left of"), ((left + right) / 2, top - 3, "above")):
        pixel = shot.getpixel((int(x), int(y)))
        if pixel == SITE:
            fail(f"{label}: the page is drawn {name} its hole, at ({int(x)}, {int(y)})")


def zoom():
    # In front again, whatever ran before it: the tree's last drive leaves a note there.
    front = run("""(() => {
      const ws = nib.workspace
      const tab = ws.tabs.find((one) => one.kind === 'web')
      if (!tab) return false
      ws.activate(tab.id)
      return true
    })()""")
    if not front:
        fail("no web tab to zoom over")
        return
    first = until(HOLE, "the web tab's hole")
    if not first:
        return
    site = run("nib.workspace")  # Only that the endpoint answers.
    width = first["sidebar"] * first["ratio"]
    print("at 100%", first, site is not None)
    corners(picture("zoom-100"), first, "100%")
    for factor in (1.25, 0.8, 1.5, 2, 1):
        run(f"window.__TAURI_INTERNALS__.invoke('interface_zoom_choose', {{ factor: {factor} }}).then(() => true)")
        until(f"Math.abs(devicePixelRatio - {factor}) < 0.01", f"the page at {factor}")
        # The rungs are a layout and a placement away from the ratio.
        hole = None
        for _ in range(40):
            time.sleep(0.25)
            hole = run(HOLE)
            if hole:
                shot = picture(f"zoom-{int(factor * 100)}")
                at_x, at_y = origin()
                inside = (int((hole["x"] + 8) * hole["ratio"]) + at_x, int((hole["y"] + 8) * hole["ratio"]) + at_y)
                if shot.getpixel(inside) == SITE:
                    break
        print(f"at {int(factor * 100)}%", hole)
        if not hole:
            fail(f"{factor}: no hole")
            continue
        grown = hole["sidebar"] * hole["ratio"]
        if abs(grown - width * factor) > 2:
            fail(f"{factor}: the sidebar is {grown} screen pixels, not {width * factor}")
        if hole["overflow"] > 0:
            fail(f"{factor}: the page runs {hole['overflow']} past the window")
        corners(shot, hole, f"{int(factor * 100)}%")
    kept = (CONFIG / "interface-zoom").read_text().strip()
    if float(kept) != 1:
        fail(f"the file keeps {kept}, not the last chosen")


{"tree": tree, "zoom": zoom}[WHAT]()
print(f"{WHAT}: {len(failures)} failures")
sys.exit(1 if failures else 0)
