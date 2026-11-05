"""Every frame of the tab overview's way in and home, one at a time: none flashes, and no
web page is drawn under it (#1136).

Reported on Windows: the overview flashed for the whole of its way in, and a web tab's
page stood behind it. The page here is the pane's own drawing of it - its bar, its hole
and the picture in the hole - which the pane is to stand back from while the page's
window is on the canvas; a style scoped to the pane never reached the web tab inside it,
so all of that stayed drawn behind the windows.

The clock the overview moves by is stepped by hand, a sixtieth of a second at a time, and
the window photographed after each step, so every frame is seen whatever the machine:

    no frame is far from both of its neighbours while they are near each other
    no frame draws anything of a web tab's pane but its strip while the overview is up

    python apps/desktop/test/e2e/overview-frames.py
"""

from __future__ import annotations

import io

from PIL import Image, ImageChops, ImageStat
from playwright.sync_api import Browser

from harness import Drive

DRIVE = Drive(__file__)
say, wrong, shot, wait_for = DRIVE.say, DRIVE.wrong, DRIVE.shot, DRIVE.wait_for

SEED = """
async () => {
  const ws = window.nibApp.workspace
  for (const name of ['One', 'Two']) ws.openBlank(name, `# ${name}\\n\\nSome words of ${name}.`)
  ws.openPage('https://example.com/')
  if (ws.panel !== 'tree') ws.showPanel('tree')
  await new Promise((go) => setTimeout(go, 400))
}
"""

#: The overview's clock in the drive's hand: a frame is run when the drive says so.
CLOCK = """
() => {
  let now = performance.now()
  let waiting = new Map()
  let next = 1
  performance.now = () => now
  window.requestAnimationFrame = (run) => { waiting.set(next, run); return next++ }
  window.cancelAnimationFrame = (id) => waiting.delete(id)
  window.__frame = () => {
    now += 1000 / 60
    const due = waiting
    waiting = new Map()
    for (const run of due.values()) run(now)
  }
}
"""

#: What of a web tab's pane is drawn, but its strip, while the tab's window is away from it
#: on the canvas. Near home the window is handed over to the pane under it, by design.
WEB_DRAWN = """
() => {
  if (!document.querySelector('.canvas')) return null
  const ws = window.nibApp.workspace
  const drawn = []
  for (const pane of ws.panes.all) {
    const tab = ws.tabs.find((one) => one.id === pane.activeTabId)
    if (tab?.kind !== 'web') continue
    const node = document.querySelector(`[data-pane="${pane.id}"]`)
    const window = [...document.querySelectorAll('.window')].find((one) => one.getAttribute('aria-label') === tab.shown)
    if (!node || !window) continue
    const home = node.getBoundingClientRect()
    const head = node.querySelector(':scope > .head')?.getBoundingClientRect().height ?? 0
    const at = window.getBoundingClientRect()
    const off = Math.abs(at.x - home.x) + Math.abs(at.y - home.y - head) + Math.abs(at.width - home.width) + Math.abs(at.height - home.height + head)
    if (off < 20) continue
    for (const part of node.children) {
      if (part.classList.contains('head')) continue
      let alpha = 1
      for (let at = part; at && at !== document.documentElement; at = at.parentElement) {
        const style = getComputedStyle(at)
        if (style.visibility === 'hidden' || style.display === 'none') alpha = 0
        alpha *= Number(style.opacity)
      }
      const box = part.getBoundingClientRect()
      if (alpha > 0.05 && box.width > 1 && box.height > 1) drawn.push(`${part.className.split(' ')[0]} at ${alpha.toFixed(2)}`)
    }
  }
  return drawn
}
"""


def small(png: bytes) -> Image.Image:
    return Image.open(io.BytesIO(png)).convert("L").resize((160, 100))


def apart(one: Image.Image, other: Image.Image) -> float:
    return ImageStat.Stat(ImageChops.difference(one, other)).mean[0]


def filmed(page, label: str, act) -> None:
    frames = [small(page.screenshot())]
    act()
    for index in range(70):
        page.evaluate("() => window.__frame()")
        frames.append(small(page.screenshot()))
        drawn = page.evaluate(WEB_DRAWN)
        if drawn:
            wrong(f"[{label}] frame {index + 1}: the web tab's pane is drawn under the overview: {', '.join(drawn)}")
            shot(page, f"{label}-drawn")
            return
    steps = [apart(frames[i - 1], frames[i]) for i in range(1, len(frames))]
    say(f"[{label}] {len(frames)} frames, the largest step {max(steps):.1f}")
    for i in range(1, len(frames) - 1):
        before, after = steps[i - 1], steps[i]
        across = apart(frames[i - 1], frames[i + 1])
        if min(before, after) > 3 and across < min(before, after) / 2:
            wrong(f"[{label}] frame {i} flashes: {before:.1f} and {after:.1f} from its neighbours, {across:.1f} between them")


def drive(browser: Browser) -> None:
    page = DRIVE.page(browser, viewport={"width": 1280, "height": 800})
    DRIVE.open(page)
    page.evaluate(SEED)
    DRIVE.settled(page)
    # Once to fetch the overview, so the run looked at is not waiting on a download.
    page.keyboard.press("Alt")
    page.keyboard.press("Alt")
    wait_for(page, "document.querySelectorAll('.window').length >= 3", "the windows")
    page.wait_for_timeout(1200)
    page.keyboard.press("Escape")
    wait_for(page, "!document.querySelector('.canvas')", "the overview gone")
    page.wait_for_timeout(400)
    page.evaluate(CLOCK)

    def opening() -> None:
        page.keyboard.press("Alt")
        page.keyboard.press("Alt")

    filmed(page, "in", opening)
    shot(page, "out")
    filmed(page, "home", lambda: page.keyboard.press("Escape"))
    shot(page, "home")
    page.close()


if __name__ == "__main__":
    raise SystemExit(DRIVE.run(drive, "the overview's frames: none flashes, no web page under it"))
