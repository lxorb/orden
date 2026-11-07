from __future__ import annotations

from playwright.sync_api import Browser

from harness import Drive

DRIVE = Drive(__file__)
say, wrong, shot, wait_for = DRIVE.say, DRIVE.wrong, DRIVE.shot, DRIVE.wait_for

SEED = """
async () => {
  const ws = window.ordenApp.workspace
  for (const name of ['One', 'Two', 'Three']) ws.openBlank(name, `# ${name}\\n\\nSome words of ${name}.`)
  if (ws.panel !== 'tree') ws.showPanel('tree')
  await new Promise((go) => setTimeout(go, 400))
}
"""

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
    const ws = window.ordenApp.workspace
    const fronts = new Set(ws.panes.all.map((one) => one.activeTabId))
    const tabs = ws.tabs.filter((one) => ws.panes.at(one.paneId)).map((tab) => {
      const window = [...document.querySelectorAll('.window')].find((one) => one.getAttribute('aria-label') === tab.shown)
      return {
        name: tab.shown,
        front: fronts.has(tab.id),
        strip: seen(document.querySelector(`[data-box="${tab.id}"]`)),
        window: window ? seen(fronts.has(tab.id) ? (window.nextElementSibling?.nextElementSibling?.matches('.rider') ? window.nextElementSibling.nextElementSibling.firstElementChild : null) : window) : null,
        picture: window ? !!window.querySelector('.face-box > .face') : false,
      }
    })
    const pane = document.querySelector('[data-pane]')
    const side = document.querySelector('[data-chrome="start"]')?.getBoundingClientRect()
    frames.push({
      tabs,
      pane: pane ? { transform: pane.style.transform, seen: !!seen(pane) } : null,
      side: side ? [side.x, side.width] : null,
    })
    requestAnimationFrame(look)
  }
  requestAnimationFrame(look)
  window.__overviewFrames = { stop: () => { going = false; return frames } }
}
"""

SIDE = "() => { const box = document.querySelector('[data-chrome=\"start\"]')?.getBoundingClientRect(); return box ? [box.x, box.width] : null }"

def apart(one: list[float], other: list[float]) -> bool:
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
            both = tab["strip"] and tab["window"] and tab["strip"][4] > 0.9 and tab["window"][4] > 0.999
            if both and apart(tab["strip"], tab["window"]):
                wrong(f"[{label}] frame {index}: {tab['name']} is in its strip and a window elsewhere at once: {tab}")
                return

def drive(browser: Browser) -> None:
    page = DRIVE.page(browser, viewport={"width": 1400, "height": 860})
    DRIVE.open(page)
    page.evaluate(SEED)
    DRIVE.settled(page)
    page.keyboard.press("Alt")
    page.keyboard.press("Alt")
    wait_for(page, "document.querySelectorAll('.window').length >= 4", "the windows")
    page.wait_for_timeout(1200)
    page.keyboard.press("Escape")
    wait_for(page, "!document.querySelector('.canvas')", "the overview gone")
    before = page.evaluate(SIDE)

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
