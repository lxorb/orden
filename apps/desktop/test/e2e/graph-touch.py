from __future__ import annotations

from typing import Any

from harness import Drive

DRIVE = Drive(__file__)
say, wrong, shot, wait_for = DRIVE.say, DRIVE.wrong, DRIVE.shot, DRIVE.wait_for

SPREAD = """
() => {
  const canvas = document.querySelector('div.graph canvas')
  const context = canvas.getContext('2d')
  const { width, height } = canvas
  const data = context.getImageData(0, 0, width, height).data
  const ground = [data[0], data[1], data[2]]
  let left = width
  let right = -1
  let row = -1
  let top = height
  let bottom = -1
  for (let y = 0; y < height; y += 2) {
    for (let x = 0; x < width; x += 2) {
      const at = (y * width + x) * 4
      if (Math.abs(data[at] - ground[0]) + Math.abs(data[at + 1] - ground[1]) + Math.abs(data[at + 2] - ground[2]) < 60) continue
      if (x < left) {
        left = x
        row = y
      }
      if (x > right) right = x
      if (y < top) top = y
      if (y > bottom) bottom = y
    }
  }
  const box = canvas.getBoundingClientRect()
  const per = box.width / width
  return { across: (right - left) * per, x: box.x + ((left + right) / 2) * per, y: box.y + ((top + bottom) / 2) * per, box: { x: box.x, y: box.y, width: box.width, height: box.height } }
}
"""

BIGGEST = """
() => {
  const canvas = document.querySelector('div.graph canvas')
  const { width, height } = canvas
  const data = canvas.getContext('2d').getImageData(0, 0, width, height).data
  const dark = new Uint8Array(width * height)
  for (let at = 0; at < width * height; at++) {
    const [r, g, b] = [data[at * 4], data[at * 4 + 1], data[at * 4 + 2]]
    const seen = data[at * 4 + 3] > 200
    dark[at] = seen && r + g + b < 360 && Math.max(r, g, b) - Math.min(r, g, b) < 40 ? 1 : 0
  }
  let best = { count: 0, x: 0, y: 0 }
  for (let y = 6; y < height - 6; y++) {
    for (let x = 6; x < width - 6; x++) {
      if (!dark[y * width + x]) continue
      let count = 0
      for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) count += dark[(y + dy) * width + x + dx]
      if (count > best.count) best = { count, x, y }
    }
  }
  const box = canvas.getBoundingClientRect()
  const per = box.width / width
  return { count: best.count, x: box.x + best.x * per, y: box.y + best.y * per }
}
"""

OPEN = "() => window.ordenApp.workspace.tabs.map((one) => one.path ?? one.kind ?? '?').join(' ')"


def drive(browser: Any) -> None:
    page = DRIVE.page(browser, viewport={"width": 1100, "height": 760}, has_touch=True)
    DRIVE.open(page)
    DRIVE.seed(
        page,
        "# Hub\n\n[[North]] [[South]] [[East]] [[West]]",
        "# North\n\n[[Hub]]",
        "# South\n\n[[Hub]]",
        "# East\n\n[[Hub]]",
        "# West\n\n[[Hub]]",
    )
    page.evaluate("() => window.ordenApp.workspace.openGraph()")
    page.wait_for_selector("div.graph canvas", timeout=20000)
    page.wait_for_timeout(4000)
    cdp = page.context.new_cdp_session(page)

    def touch(kind: str, spots: list[tuple[float, float]]) -> None:
        cdp.send(
            "Input.dispatchTouchEvent",
            {"type": kind, "touchPoints": [{"x": x, "y": y, "id": n} for n, (x, y) in enumerate(spots)]},
        )

    before = page.evaluate(SPREAD)
    say(f"before {before}")
    if before["across"] <= 0:
        wrong("the graph drew nothing to measure")
        return

    was = page.evaluate(OPEN)
    spot = page.evaluate(BIGGEST)
    say(f"the biggest node, the hub, is drawn at {spot}")
    touch("touchStart", [(spot["x"], spot["y"])])
    touch("touchCancel", [])
    page.wait_for_timeout(800)
    now = page.evaluate(OPEN)
    say(f"a cancelled touch on a node: active {was} -> {now}")
    if now != was:
        wrong(f"a touch the system cancelled on a node opened {now}")

    touch("touchStart", [(spot["x"], spot["y"])])
    touch("touchEnd", [])
    page.wait_for_timeout(800)
    tapped = page.evaluate(OPEN)
    say(f"a tap on the same node: active {now} -> {tapped}")
    if "Hub.md" not in tapped:
        wrong("a tap on the hub did not open it, so the cancelled touch proved nothing")

    page.evaluate("() => window.ordenApp.workspace.openGraph()")
    page.wait_for_selector("div.graph canvas", timeout=20000)
    page.wait_for_timeout(2500)
    before = page.evaluate(SPREAD)
    box = before["box"]
    mx, my = box["x"] + box["width"] / 2, box["y"] + box["height"] / 2
    touch("touchStart", [(mx - 30, my), (mx + 30, my)])
    for step in range(1, 11):
        apart = 30 + step * 9
        touch("touchMove", [(mx - apart, my), (mx + apart, my)])
        page.wait_for_timeout(16)
    touch("touchEnd", [])
    page.wait_for_timeout(600)

    after = page.evaluate(SPREAD)
    say(f"after a pinch out to four times as far apart {after}")
    if after["across"] < before["across"] * 1.8:
        wrong(f"two fingers spread on the graph did not zoom in: {before['across']:.0f} px across, then {after['across']:.0f}")
    shot(page, "01-pinched")


if __name__ == "__main__":
    raise SystemExit(DRIVE.run(drive))
