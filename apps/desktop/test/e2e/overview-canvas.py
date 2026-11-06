from __future__ import annotations

from playwright.sync_api import Browser, Page

from harness import Drive

DRIVE = Drive(__file__)
say, wrong, shot, wait_for = DRIVE.say, DRIVE.wrong, DRIVE.shot, DRIVE.wait_for

SEED = """
async () => {
  const ws = window.nibApp.workspace
  const home = ws.activeSpace
  for (const name of ['Work', 'Ideas', 'Lab']) {
    if (!ws.spaces.some((one) => one.name === name)) await ws.addSpace(name)
    const space = ws.spaces.find((one) => one.name === name)
    await ws.selectSpace(space.id)
    for (const note of [`${name} one`, `${name} two`]) ws.openBlank(note, `# ${note}`)
    await new Promise((go) => setTimeout(go, 300))
  }
  await ws.selectSpace(home.id)
  for (const name of ['One', 'Two', 'Three']) ws.openBlank(name, `# ${name}\\n\\nSome words of ${name}.`)
  localStorage.setItem('nib:overview-spaces', 'all')
  await new Promise((go) => setTimeout(go, 600))
}
"""

SAMPLE = """
() => {
  const frames = []
  const ws = window.nibApp.workspace
  const front = ws.activeTabId
  const seen = (node) => {
    if (!node) return null
    let alpha = 1
    for (let at = node; at && at !== document.documentElement; at = at.parentElement) {
      const style = getComputedStyle(at)
      if (style.visibility === 'hidden' || style.display === 'none') return null
      alpha *= Number(style.opacity)
    }
    const box = node.getBoundingClientRect()
    return box.width > 1 ? [box.x, box.y, box.width, box.height, alpha] : null
  }
  let going = true
  const look = () => {
    if (!going) return
    const strip = seen(document.querySelector(`[data-box="${front}"]`))
    const riders = [...document.querySelectorAll('.rider')].map((one) => seen(one.firstElementChild)).filter(Boolean)
    frames.push({ strip, rider: riders.sort((a, b) => b[4] - a[4])[0] ?? null })
    requestAnimationFrame(look)
  }
  requestAnimationFrame(look)
  window.__riders = { stop: () => { going = false; return frames } }
}
"""

BAR = """
() => [...document.querySelectorAll('header[data-chrome="top"] button')]
  .filter((one) => !one.closest('[data-overview-keeps]') && !one.closest('[data-box]'))
  .filter((one) => {
    const box = one.getBoundingClientRect()
    if (box.width < 1) return false
    const style = getComputedStyle(one)
    return Number(style.opacity) > 0.05 || style.pointerEvents !== 'none'
  })
  .map((one) => one.getAttribute('aria-label') || one.className)
"""

LAID = """
() => ({
  windows: (() => {
    const [cx, cy, zoom] = (/translate\\(([-\\d.]+)px, ([-\\d.]+)px\\) scale\\(([-\\d.]+)\\)/.exec(document.querySelector('.under .world').style.transform) ?? []).slice(1).map(Number)
    return [...document.querySelectorAll('.window')].map((one) => {
      const [x, y] = (/translate\\(([-\\d.]+)px, ([-\\d.]+)px\\)/.exec(one.style.transform) ?? []).slice(1).map(Number)
      return [one.getAttribute('aria-label'), one.style.width, Math.round((x - cx) / zoom), Math.round((y - cy) / zoom)]
    })
  })(),
  bubbles: [...document.querySelectorAll('.bubble')].map((one) => { const b = one.getBBox(); return [b.x, b.y, b.width, b.height] }),
})
"""

ZOOM = "() => Number(/scale\\(([-\\d.]+)\\)/.exec(document.querySelector('.under .world').style.transform)?.[1] ?? 1)"

CELLS = "() => [...document.querySelectorAll('.bubble')].map((one) => { const b = one.getBoundingClientRect(); return [b.x, b.y, b.width, b.height] })"

FRONTS = "() => { const ws = window.nibApp.workspace; return [ws.activeTabId, ...ws.panes.all.map((one) => one.activeTabId)] }"

CROSSED = """
() => {
  const space = (label) => ['Work', 'Ideas', 'Lab'].find((one) => label.startsWith(one)) ?? 'Notes'
  const all = [...document.querySelectorAll('.window')].map((one) => [one.getAttribute('aria-label'), one.getBoundingClientRect()])
  const out = []
  for (const [a, x] of all) for (const [b, y] of all) {
    if (a >= b || space(a) === space(b)) continue
    if (x.left < y.right && y.left < x.right && x.top < y.bottom && y.top < x.bottom) out.push([a, b])
  }
  return out
}
"""

def boxes_of(page: Page, label: str) -> list[float] | None:
    return page.evaluate(
        "(label) => { const one = [...document.querySelectorAll('.window')].find((w) => w.getAttribute('aria-label') === label);"
        " if (!one) return null; const b = one.getBoundingClientRect(); return [b.x, b.y, b.width, b.height] }",
        label,
    )

def settle(page: Page) -> None:
    page.wait_for_timeout(1300)

def drive(browser: Browser) -> None:
    page = DRIVE.page(browser, viewport={"width": 1400, "height": 860})
    DRIVE.open(page)
    page.evaluate(SEED)
    DRIVE.settled(page)
    page.keyboard.press("Alt")
    page.keyboard.press("Alt")
    wait_for(page, "document.querySelectorAll('.window').length >= 4", "the windows")
    settle(page)
    page.keyboard.press("Escape")
    wait_for(page, "!document.querySelector('.canvas')", "the overview gone")

    page.evaluate(SAMPLE)
    page.keyboard.press("Alt")
    page.keyboard.press("Alt")
    page.wait_for_timeout(90)
    shot(page, "riding")
    page.wait_for_timeout(1300)
    frames = page.evaluate("() => window.__riders.stop()")
    seen = [f for f in frames if f["strip"] or f["rider"]]
    first = next((i for i, f in enumerate(frames) if not f["strip"]), None)
    if first is None:
        wrong("[ride] the tab in front never left its strip")
    else:
        rider = frames[first]["rider"]
        before = frames[first - 1]["strip"] if first > 0 else None
        if not rider or rider[4] < 0.8:
            wrong(f"[ride] the tab in front vanished from the bar as the overview began: {frames[first]}")
        elif before and (abs(rider[0] - before[0]) > 40 or abs(rider[1] - before[1]) > 40):
            wrong(f"[ride] the tab riding its window did not start where the tab was: {rider} vs {before}")
    say(f"[ride] {len(seen)} of {len(frames)} frames show the tab in front somewhere")

    left = page.evaluate(BAR)
    if left:
        wrong(f"[bar] still there in the overview: {left}")
    shot(page, "out")

    page.keyboard.press("Shift")
    page.keyboard.press("Shift")
    wait_for(page, "!!document.querySelector('.palette')", "the palette")
    page.wait_for_timeout(400)
    over = page.evaluate(
        "() => { const b = document.querySelector('.palette').getBoundingClientRect();"
        " return [[0.5, 0.2], [0.5, 0.6], [0.1, 0.5], [0.9, 0.5]].every(([fx, fy]) =>"
        " document.elementFromPoint(b.x + b.width * fx, b.y + b.height * fy)?.closest('.palette')) }"
    )
    shot(page, "palette")
    if not over:
        wrong("[palette] the palette is not drawn over the overview")
    page.keyboard.press("Escape")
    page.wait_for_timeout(400)

    before = page.evaluate(LAID)
    page.mouse.move(700, 500)
    for _ in range(6):
        page.mouse.wheel(0, 100)
        page.wait_for_timeout(60)
    settle(page)
    zoom = page.evaluate(ZOOM)
    after = page.evaluate(LAID)
    shot(page, "zoomed-out")
    if zoom > 0.8:
        wrong(f"[zoom] the wheel did not zoom out: {zoom}")
    if after["windows"] != before["windows"]:
        wrong(f"[zoom] the windows were laid out again as the camera zoomed: {before['windows']} -> {after['windows']}")
    for one, other in zip(before["bubbles"], after["bubbles"]):
        if any(abs(a - b) > 4 for a, b in zip(one, other)):
            wrong(f"[zoom] a bubble changed with the zoom: {one} -> {other}")
    stroke = page.evaluate("() => parseFloat(getComputedStyle(document.querySelector('.bubble')).strokeWidth)")
    if abs(stroke * zoom - 3) > 0.3:
        wrong(f"[zoom] a bubble's line is {stroke * zoom:.2f}px on the screen at zoom {zoom:.2f}, not 3")
    ring = page.evaluate(
        "() => { const ring = document.querySelector('.window .ring'); const s = getComputedStyle(ring);"
        " return [parseFloat(s.borderTopWidth), ring.getBoundingClientRect().width / ring.offsetWidth] }"
    )
    if abs(ring[0] * ring[1] - 1.5) > 0.3 and abs(ring[0] * ring[1] - 2) > 0.3:
        wrong(f"[zoom] a window's ring is {ring[0] * ring[1]:.2f}px on the screen")

    page.click("button.tidy")
    settle(page)
    cells = page.evaluate(CELLS)
    shot(page, "tidied")
    if len(cells) < 4:
        wrong(f"[tidy] only {len(cells)} spaces on the canvas")
    else:
        rows = {round((c[1] + c[3] / 2) / 40) for c in cells}
        columns = {round((c[0] + c[2] / 2) / 40) for c in cells}
        if len(rows) < 2 or len(columns) < 2:
            wrong(f"[tidy] the spaces lie in a line: {cells}")
        for i, one in enumerate(cells):
            for other in cells[i + 1 :]:
                if not (
                    one[0] + one[2] <= other[0] + 1
                    or other[0] + other[2] <= one[0] + 1
                    or one[1] + one[3] <= other[1] + 1
                    or other[1] + other[3] <= one[1] + 1
                ):
                    wrong(f"[tidy] two spaces overlap: {one} {other}")

    one, two = "One", "Two"
    a = boxes_of(page, one)
    b = boxes_of(page, two)
    if not a or not b:
        wrong("[choose] no windows One and Two")
    else:
        page.keyboard.down("Control")
        page.mouse.click(a[0] + a[2] / 2, a[1] + a[3] / 2)
        page.mouse.click(b[0] + b[2] / 2, b[1] + b[3] / 2)
        page.keyboard.up("Control")
        chosen = page.evaluate("() => document.querySelectorAll('.window.is-chosen').length")
        if chosen != 2:
            wrong(f"[choose] {chosen} windows chosen, not 2")
        fronts = page.evaluate(FRONTS)
        page.mouse.move(a[0] + a[2] / 2, a[1] + a[3] / 2)
        page.mouse.down()
        for step in range(1, 11):
            page.mouse.move(a[0] + a[2] / 2 + step * 6, a[1] + a[3] / 2 + step * 9)
            page.wait_for_timeout(16)
        shot(page, "two-held")
        a2 = boxes_of(page, one)
        b2 = boxes_of(page, two)
        page.mouse.up()
        settle(page)
        if a2 and b2:
            da = (a2[0] - a[0], a2[1] - a[1])
            db = (b2[0] - b[0], b2[1] - b[1])
            if abs(da[0] - db[0]) > 3 or abs(da[1] - db[1]) > 3 or abs(da[1]) < 40:
                wrong(f"[choose] the two chosen did not move together: {da} {db}")
        if page.evaluate(FRONTS) != fronts:
            wrong(f"[choose] letting go changed the tab in front: {fronts} -> {page.evaluate(FRONTS)}")
        crossed = page.evaluate(CROSSED)
        if crossed:
            wrong(f"[choose] windows of two spaces lie on each other once let go: {crossed}")

    name = page.evaluate(
        "() => { const n = [...document.querySelectorAll('[data-space-name]')].find((one) => one.textContent.trim() === 'Work');"
        " if (!n) return null; const b = n.getBoundingClientRect(); return [b.x + b.width / 2, b.y + b.height / 2] }"
    )
    lab = page.evaluate("() => [...document.querySelectorAll('.window')].filter((one) => one.getAttribute('aria-label').startsWith('Work')).map((one) => { const b = one.getBoundingClientRect(); return [b.x, b.y] })")
    if not name or len(lab) < 2:
        wrong(f"[carry] no name or windows for Work: {name} {lab}")
    else:
        page.mouse.move(name[0], name[1])
        page.mouse.down()
        for step in range(1, 11):
            page.mouse.move(name[0] + step * 5, name[1] - step * 4)
            page.wait_for_timeout(16)
        page.mouse.up()
        settle(page)
        moved = page.evaluate("() => [...document.querySelectorAll('.window')].filter((one) => one.getAttribute('aria-label').startsWith('Work')).map((one) => { const b = one.getBoundingClientRect(); return [b.x, b.y] })")
        shot(page, "carried")
        deltas = [(m[0] - w[0], m[1] - w[1]) for w, m in zip(lab, moved)]
        if not page.evaluate("() => !!document.querySelector('.canvas')"):
            wrong("[carry] a press on a space's name put the overview away")
        elif any(abs(d[0]) < 20 for d in deltas) or max(d[0] for d in deltas) - min(d[0] for d in deltas) > 3:
            wrong(f"[carry] the space's windows did not move together with its name: {deltas}")
        crossed = page.evaluate(CROSSED)
        if crossed:
            wrong(f"[carry] windows of two spaces lie on each other once let go: {crossed}")
    page.close()

if __name__ == "__main__":
    raise SystemExit(DRIVE.run(drive, "the overview's canvas: riding tabs, a quiet bar, zoom, tidy, choosing, carrying"))
