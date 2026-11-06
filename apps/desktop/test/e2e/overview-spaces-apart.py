from __future__ import annotations

from playwright.sync_api import Browser, Page

from harness import Drive

NEEDS = ("chromium",)

DRIVE = Drive(__file__)
say, wrong, shot, wait_for = DRIVE.say, DRIVE.wrong, DRIVE.shot, DRIVE.wait_for

SEED = """
async () => {
  const ws = window.nibApp.workspace
  const home = ws.activeSpace
  for (const [name, notes] of [['Work', ['Work one', 'Work two']], ['Ideas', ['Ideas one']], ['Empty A', []], ['Empty B', []]]) {
    if (!ws.spaces.some((one) => one.name === name)) await ws.addSpace(name)
    const space = ws.spaces.find((one) => one.name === name)
    await ws.selectSpace(space.id)
    for (const note of notes) ws.openBlank(note, `# ${note}`)
    await new Promise((go) => setTimeout(go, 300))
  }
  await ws.selectSpace(home.id)
  ws.openBlank('Here', '# Here')
  localStorage.setItem('nib:overview-spaces', 'all')
  await new Promise((go) => setTimeout(go, 600))
}
"""

BUBBLES = """
() => {
  const names = [...document.querySelectorAll('[data-space-name]')]
  const paths = [...document.querySelectorAll('.bubble')]
  return names.map((name, index) => {
    const path = paths[index]
    const box = path.getBBox()
    const length = path.getTotalLength()
    const points = Array.from({ length: 96 }, (_, k) => { const p = path.getPointAtLength((k / 96) * length); return [p.x, p.y] })
    const label = name.getBoundingClientRect()
    return { name: name.textContent.trim(), box: [box.x, box.y, box.width, box.height], points, label: [label.x, label.y, label.width, label.height] }
  })
}
"""

CROSSING = """
() => {
  const paths = [...document.querySelectorAll('.bubble')]
  const names = [...document.querySelectorAll('[data-space-name]')].map((one) => one.textContent.trim())
  const out = []
  const svg = paths[0]?.ownerSVGElement
  if (!svg) return out
  paths.forEach((one, i) => paths.forEach((other, j) => {
    if (i === j) return
    const length = one.getTotalLength()
    let inside = 0
    for (let k = 0; k < 96; k++) {
      const p = one.getPointAtLength((k / 96) * length)
      const point = svg.createSVGPoint()
      point.x = p.x
      point.y = p.y
      if (other.isPointInFill(point) && !other.isPointInStroke(point)) inside++
    }
    if (inside > 2) out.push([names[i], names[j], inside])
  }))
  return out
}
"""

CROSSED = """
() => {
  const space = (label) => ['Work', 'Ideas'].find((one) => label.startsWith(one)) ?? 'Here'
  const all = [...document.querySelectorAll('.window')].map((one) => [one.getAttribute('aria-label'), one.getBoundingClientRect()])
  const out = []
  for (const [a, x] of all) for (const [b, y] of all) {
    if (a >= b || space(a) === space(b)) continue
    if (x.left < y.right && y.left < x.right && x.top < y.bottom && y.top < x.bottom) out.push([a, b])
  }
  return out
}
"""

def meet(a: list[float], b: list[float]) -> bool:
    return a[0] < b[0] + b[2] and b[0] < a[0] + a[2] and a[1] < b[1] + b[3] and b[1] < a[1] + a[3]

def at_rest(page: Page, label: str) -> None:
    crossing = page.evaluate(CROSSING)
    if crossing:
        wrong(f"[{label}] bubbles lie on each other: {crossing}")
    crossed = page.evaluate(CROSSED)
    if crossed:
        wrong(f"[{label}] windows of two spaces lie on each other: {crossed}")
    bubbles = page.evaluate(BUBBLES)
    for one in bubbles:
        for other in bubbles:
            if one["name"] < other["name"] and meet(one["label"], other["label"]):
                wrong(f"[{label}] the names of {one['name']} and {other['name']} lie on each other")

def drive(browser: Browser) -> None:
    page = DRIVE.page(browser, viewport={"width": 1400, "height": 860})
    DRIVE.open(page)
    page.evaluate(SEED)
    DRIVE.settled(page)
    page.keyboard.press("Alt")
    page.keyboard.press("Alt")
    wait_for(page, "document.querySelectorAll('[data-space-name]').length >= 5", "every space's bubble")
    page.wait_for_timeout(1400)
    page.click(".tidy")
    page.wait_for_timeout(1400)
    shot(page, "packed")

    bubbles = {one["name"]: one for one in page.evaluate(BUBBLES)}
    one_window = bubbles.get("Ideas")
    empties = [bubbles.get("Empty A"), bubbles.get("Empty B")]
    if not one_window or not all(empties):
        wrong(f"[empty] not every space has a bubble: {sorted(bubbles)}")
        page.close()
        return
    for empty in empties:
        wide = empty["box"][2] / one_window["box"][2]
        tall = empty["box"][3] / one_window["box"][3]
        say(f"[empty] {empty['name']} is {wide:.2f} as wide and {tall:.2f} as tall as Ideas")
        if not (0.35 < wide < 0.7 and 0.35 < tall < 0.75):
            wrong(f"[empty] {empty['name']}'s bubble is not about half a one-window bubble: {wide:.2f} x {tall:.2f}")
    at_rest(page, "empty")

    ideas = bubbles["Ideas"]
    work = bubbles.get("Work")
    zoom = page.evaluate(
        "() => Number(/scale\\(([-\\d.]+)\\)/.exec(document.querySelector('.under .world').style.transform)?.[1] ?? 1)"
    )
    if not work:
        wrong("[carry] Work has no bubble")
        page.close()
        return
    start = [work["label"][0] + work["label"][2] / 2, work["label"][1] + work["label"][3] / 2]
    ideas_middle = page.evaluate(
        "() => { const n = [...document.querySelectorAll('[data-space-name]')].findIndex((one) => one.textContent.trim() === 'Ideas');"
        " const b = document.querySelectorAll('.bubble')[n].getBoundingClientRect(); return [b.x + b.width / 2, b.y + b.height / 2] }"
    )
    work_middle = page.evaluate(
        "() => { const n = [...document.querySelectorAll('[data-space-name]')].findIndex((one) => one.textContent.trim() === 'Work');"
        " const b = document.querySelectorAll('.bubble')[n].getBoundingClientRect(); return [b.x + b.width / 2, b.y + b.height / 2] }"
    )
    dx = ideas_middle[0] - work_middle[0]
    dy = ideas_middle[1] - work_middle[1]
    say(f"[carry] carrying Work {dx:.0f}, {dy:.0f} px onto Ideas at zoom {zoom:.2f}")
    page.mouse.move(start[0], start[1])
    page.mouse.down()
    steps = 60
    for step in range(1, steps + 1):
        page.mouse.move(start[0] + dx * step / steps, start[1] + dy * step / steps)
        page.wait_for_timeout(16)
        crossed = page.evaluate(CROSSED)
        if crossed:
            wrong(f"[carry] step {step}: windows of two spaces lie on each other: {crossed}")
            break
        crossing = page.evaluate(CROSSING)
        if crossing:
            wrong(f"[carry] step {step}: bubbles lie on each other: {crossing}")
            break
    page.wait_for_timeout(600)
    shot(page, "pushed")
    at_rest(page, "pushed")
    page.mouse.up()
    page.wait_for_timeout(1600)
    shot(page, "let-go")
    after = {one["name"]: one for one in page.evaluate(BUBBLES)}
    back = after.get("Ideas")
    if back:
        off = max(abs(back["box"][0] - ideas["box"][0]), abs(back["box"][1] - ideas["box"][1]))
        if off > 8:
            wrong(f"[let go] Ideas did not go back where it was: {off:.0f} away")
    at_rest(page, "let go")
    page.close()

if __name__ == "__main__":
    raise SystemExit(DRIVE.run(drive, "no two spaces' bubbles on each other"))
