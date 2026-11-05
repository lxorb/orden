"""The tab overview happens in the window, and nothing in it is ever seen twice (#331).

Emil: the overview is not a layer over Orden but a state of the window. Its bar stays, its
sidebars slide away as if shut, and the panes themselves shrink where they are into their
windows - so the window of a pane's tab and the pane are one thing, and no frame of the
way in or out shows a tab twice.

What it checks, on the built web app in Chromium, sampling every frame of the way in and
the way home:

    no frame has a pane and a copy of it: a pane's tab in front has no picture in its
      window, the pane itself is what moves, and it is where it is laid out again at the
      end
    no frame has a tab both in its strip and as a window somewhere else
    the left sidebar is off the window while the overview is out, and back where it was
      after; the bar takes presses all the while
    the canvas is a clear scrim from its first frame, so a web page's live view would be
      behind its picture all the way

    python apps/desktop/test/e2e/overview-in-window.py
"""

from __future__ import annotations

from playwright.sync_api import Browser

from harness import Drive

DRIVE = Drive(__file__)
say, wrong, shot, wait_for = DRIVE.say, DRIVE.wrong, DRIVE.shot, DRIVE.wait_for

SEED = """
async () => {
  const ws = window.nibApp.workspace
  for (const name of ['One', 'Two', 'Three']) ws.openBlank(name, `# ${name}\\n\\nSome words of ${name}.`)
  if (ws.panel !== 'tree') ws.showPanel('tree')
  await new Promise((go) => setTimeout(go, 400))
}
"""

#: Every frame until `stop()`: for each tab, whether its strip tab and its window are seen
#: and where, whether its window draws a picture of a pane, the pane's own drawing, the
#: sidebar's box, and whether the canvas is a scrim that is seen.
SAMPLE = """
() => {
  const frames = []
  const seen = (node) => {
    if (!node) return null
    let alpha = 1
    for (let at = node; at && at !== document.documentElement; at = at.parentElement) {
      const style = getComputedStyle(at)
      if (style.visibility === 'hidden' || style.display === 'none') return null
      alpha *= Number(style.opacity)
    }
    const box = node.getBoundingClientRect()
    return alpha > 0.05 && box.width > 1 && box.height > 1 ? [box.x, box.y, box.width, box.height, alpha] : null
  }
  let going = true
  const look = () => {
    if (!going) return
    const ws = window.nibApp.workspace
    const fronts = new Set(ws.panes.all.map((one) => one.activeTabId))
    const tabs = ws.tabs.filter((one) => ws.panes.at(one.paneId)).map((tab) => {
      const window = [...document.querySelectorAll('.window')].find((one) => one.getAttribute('aria-label') === tab.shown)
      return {
        name: tab.shown,
        front: fronts.has(tab.id),
        strip: seen(document.querySelector(`[data-box="${tab.id}"]`)),
        window: window ? seen(window) : null,
        picture: window ? !!window.querySelector('.face-box > .face') : false,
      }
    })
    const pane = document.querySelector('[data-pane]')
    const side = document.querySelector('[data-chrome="start"]')?.getBoundingClientRect()
    const canvas = document.querySelector('.canvas')
    frames.push({
      tabs,
      pane: pane ? { transform: pane.style.transform, seen: !!seen(pane) } : null,
      side: side ? [side.x, side.width] : null,
      scrim: canvas ? canvas.matches('.nib-scrim') && getComputedStyle(canvas).visibility !== 'hidden' : null,
    })
    requestAnimationFrame(look)
  }
  requestAnimationFrame(look)
  window.__overviewFrames = { stop: () => { going = false; return frames } }
}
"""

SIDE = "() => { const box = document.querySelector('[data-chrome=\"start\"]')?.getBoundingClientRect(); return box ? [box.x, box.width] : null }"


def apart(one: list[float], other: list[float]) -> bool:
    """Whether two boxes on the screen do not meet at all."""
    return (
        one[0] + one[2] <= other[0]
        or other[0] + other[2] <= one[0]
        or one[1] + one[3] <= other[1]
        or other[1] + other[3] <= one[1]
    )


def judged(frames: list[dict], label: str) -> None:
    say(f"[{label}] {len(frames)} frames")
    if len(frames) < 10:
        wrong(f"[{label}] only {len(frames)} frames were drawn")
    for index, frame in enumerate(frames):
        for tab in frame["tabs"]:
            if tab["front"] and tab["picture"]:
                wrong(f"[{label}] frame {index}: the window of {tab['name']} draws a picture of its pane")
                return
            # Both all there, and not on each other: a window being handed over to what
            # it is, in the last few pixels home, is fading as that comes back.
            both = tab["strip"] and tab["window"] and min(tab["strip"][4], tab["window"][4]) > 0.9
            if both and apart(tab["strip"], tab["window"]):
                wrong(f"[{label}] frame {index}: {tab['name']} is in its strip and a window elsewhere at once")
                return
        if frame["scrim"] is False:
            wrong(f"[{label}] frame {index}: the canvas is there but not a scrim a page steps behind")
            return


def drive(browser: Browser) -> None:
    page = DRIVE.page(browser, viewport={"width": 1400, "height": 860})
    DRIVE.open(page)
    page.evaluate(SEED)
    DRIVE.settled(page)
    # Once to fetch the overview, so the run looked at is not waiting on a download.
    page.keyboard.press("Alt")
    page.keyboard.press("Alt")
    wait_for(page, "document.querySelectorAll('.window').length >= 4", "the windows")
    page.wait_for_timeout(1200)
    page.keyboard.press("Escape")
    wait_for(page, "!document.querySelector('.canvas')", "the overview gone")
    before = page.evaluate(SIDE)

    # ── The way in ───────────────────────────────────────────────────
    page.evaluate(SAMPLE)
    page.keyboard.press("Alt")
    page.keyboard.press("Alt")
    page.wait_for_timeout(1400)
    frames = page.evaluate("() => window.__overviewFrames.stop()")
    judged(frames, "in")
    shot(page, "out")
    last = frames[-1] if frames else None
    if last and last["pane"] and "scale(" not in last["pane"]["transform"]:
        wrong("[in] the pane is not what moved into its window")
    side = page.evaluate(SIDE)
    if side and side[0] + side[1] > 1:
        wrong(f"[in] the sidebar did not slide off the window: {side}")
    bar = page.evaluate(
        "() => { const bar = document.querySelector('header[data-chrome=\"top\"]').getBoundingClientRect();"
        " return !!document.elementFromPoint(bar.x + bar.width / 2, bar.y + bar.height / 2)?.closest('header') }"
    )
    if not bar:
        wrong("[in] the bar is under something while the overview is up")

    # ── The way home ─────────────────────────────────────────────────
    page.evaluate(SAMPLE)
    page.keyboard.press("Escape")
    page.wait_for_timeout(1400)
    frames = page.evaluate("() => window.__overviewFrames.stop()")
    judged(frames, "home")
    shot(page, "home")
    last = frames[-1] if frames else None
    if last and last["pane"] and last["pane"]["transform"]:
        wrong(f"[home] the pane is still drawn somewhere else: {last['pane']['transform']}")
    if page.evaluate(SIDE) != before:
        wrong("[home] the sidebar is not back where it was")
    page.close()


if __name__ == "__main__":
    raise SystemExit(DRIVE.run(drive, "the overview happens in the window, nothing seen twice"))
