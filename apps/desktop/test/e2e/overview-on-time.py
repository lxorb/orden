"""Every frame of the tab overview's way in and way home is on time (#331).

Emil, on Windows: the Alt Alt animation is not quite smooth, a short spike in the middle
of it. Two things made frames late while the windows flew, and this drive measures both
on the built web app in Chromium, the engine WebView2 is, through a DevTools trace:

    no frame of the way in or the way home has the engine work out the style of the
      whole window again: each frame restyles a few hundred elements at most, never the
      panes and every window's picture under a value they all inherit
    no window's picture is drawn into after the windows have begun to move: what each
      shows is there before the first frame of the way in, and none is filled in
      half-way, which was a long frame in the middle of the way in
    no window flies as a blank box: each shows its picture, or its mark until that is
      drawn
    the tab worked in is over every other window on every frame that moves (Emil: the
      others flew over it as it shrank)

    python apps/desktop/test/e2e/overview-on-time.py
"""

from __future__ import annotations

import json
import tempfile
from pathlib import Path

from playwright.sync_api import Browser, Page

from harness import Drive

NEEDS = ("chromium",)

DRIVE = Drive(__file__)
say, wrong, wait_for = DRIVE.say, DRIVE.wrong, DRIVE.wait_for

SEED = """
async () => {
  const ws = window.nibApp.workspace
  const body = Array.from({ length: 120 }, (_, i) =>
    `Line ${i} with some **words**, a [link](https://example.com) and more to fill it.`).join('\\n\\n')
  for (let i = 0; i < 10; i++) ws.openBlank(`Note ${i}`, `# Note ${i}\\n\\n${body}`)
  if (ws.panel !== 'tree') ws.showPanel('tree')
  await new Promise((go) => setTimeout(go, 600))
}
"""

#: Every frame until `stop()`: when it was, whether any window moved since the frame
#: before, and how many changes were made inside the windows' pictures since then.
SAMPLE = """
() => {
  const frames = []
  const elements = document.querySelectorAll('*').length
  let drawn = 0
  const seen = new MutationObserver((changes) => {
    for (const change of changes) if (change.target.closest?.('.window .face') || change.target.parentElement?.closest('.window .face')) drawn++
  })
  seen.observe(document.body, { childList: true, subtree: true, characterData: true })
  let before = ''
  let going = true
  const look = (at) => {
    if (!going) return
    const now = [...document.querySelectorAll('.window')].map((one) => one.style.transform).join('|')
    const ws = window.nibApp.workspace
    const pane = document.querySelector(`[data-pane="${ws.panes.at(ws.tabs.find((one) => one.id === ws.activeTabId)?.paneId)?.id}"]`)
    const active = ws.tabs.find((one) => one.id === ws.activeTabId)?.shown
    const others = [...document.querySelectorAll('.window')]
      .filter((one) => one.getAttribute('aria-label') !== active)
      .map((one) => Number(getComputedStyle(one).zIndex) || 0)
    const blank = [...document.querySelectorAll('.window .face')].filter((face) =>
      !face.querySelector('.mark, .screen, .kept, img.is-drawn') && !face.querySelector('.read article')?.childElementCount).length
    frames.push({
      at,
      moved: now !== before && before !== '',
      drawn,
      blank,
      over: pane && others.length ? others.every((one) => Number(getComputedStyle(pane).zIndex) > one) : null,
    })
    before = now
    drawn = 0
    requestAnimationFrame(look)
  }
  requestAnimationFrame(look)
  window.__overviewFrames = {
    stop: () => {
      going = false
      seen.disconnect()
      return { frames, elements: Math.max(elements, document.querySelectorAll('*').length) }
    },
  }
}
"""

CATEGORIES = ["devtools.timeline", "disabled-by-default-devtools.timeline"]


def restyled(trace: Path) -> list[int]:
    """How many elements each style recalculation on the page's main thread touched."""
    data = json.loads(trace.read_text())
    events = data["traceEvents"] if isinstance(data, dict) else data
    main = next(
        (one["pid"], one["tid"])
        for one in events
        if one.get("name") == "thread_name" and one["args"].get("name") == "CrRendererMain"
    )
    counts = []
    for one in events:
        if one.get("name") != "UpdateLayoutTree" or (one.get("pid"), one.get("tid")) != main:
            continue
        args = one.get("args", {})
        count = args.get("elementCount") or (args.get("endData") or {}).get("elementCount")
        if count:
            counts.append(int(count))
    return counts


def run(browser: Browser, page: Page, label: str, keys: list[str], folder: Path) -> None:
    trace = folder / f"{label}.json"
    page.evaluate(SAMPLE)
    browser.start_tracing(page=page, path=str(trace), categories=CATEGORIES)
    for key in keys:
        page.keyboard.press(key)
    page.wait_for_timeout(1600)
    browser.stop_tracing()
    seen = page.evaluate("() => window.__overviewFrames.stop()")
    frames = seen["frames"]
    moving = [index for index, frame in enumerate(frames) if frame["moved"]]
    say(f"[{label}] {len(frames)} frames, {len(moving)} of them moving, {seen['elements']} elements")
    if len(moving) < 10:
        wrong(f"[{label}] only {len(moving)} frames moved a window")
        return
    late = [
        (index, frame["drawn"])
        for index, frame in enumerate(frames)
        if moving[0] < index <= moving[-1] and frame["drawn"]
    ]
    if late:
        wrong(f"[{label}] a window's picture was drawn into while the windows moved: {late}")
    blank = [index for index in moving if frames[index]["blank"]]
    if blank:
        wrong(f"[{label}] a window flew as a blank box, its picture not drawn, on frames {blank[:5]}")
    # The last frame that moves is the one they land in, all of them where they go.
    under = [index for index in moving[:-1] if frames[index]["over"] is False]
    if under:
        wrong(f"[{label}] the tab worked in was under the other windows on frames {under[:5]}")
    counts = restyled(trace)
    # The frame the overview begins in and the one it ends in restyle what they change -
    # the strip, the bar, the sidebars - once; every frame between restyles only what
    # moves in it.
    between = sorted(counts)[:-3] if len(counts) > 3 else counts
    most = max(between, default=0)
    say(f"[{label}] at most {most} elements restyled in a frame, of {seen['elements']}")
    if most > seen["elements"] / 4:
        wrong(f"[{label}] a frame restyled {most} of the window's {seen['elements']} elements")


def drive(browser: Browser) -> None:
    page = DRIVE.page(browser, viewport={"width": 1600, "height": 960})
    DRIVE.open(page)
    page.evaluate(SEED)
    DRIVE.settled(page)
    # Once to fetch the overview, so the run looked at is not waiting on a download.
    page.keyboard.press("Alt")
    page.keyboard.press("Alt")
    wait_for(page, "document.querySelectorAll('.window').length >= 10", "the windows")
    page.wait_for_timeout(1400)
    page.keyboard.press("Escape")
    wait_for(page, "!document.querySelector('.canvas')", "the overview gone")
    page.wait_for_timeout(600)
    with tempfile.TemporaryDirectory() as folder:
        run(browser, page, "in", ["Alt", "Alt"], Path(folder))
        run(browser, page, "home", ["Escape"], Path(folder))
    page.close()


if __name__ == "__main__":
    raise SystemExit(DRIVE.run(drive, "every frame of the overview's way in and home is on time"))
