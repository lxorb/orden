import json

from playwright.sync_api import Browser, Page

from harness import Drive

NEEDS = ("chromium",)

DRIVE = Drive(__file__)
say, wrong, shot, wait_for = DRIVE.say, DRIVE.wrong, DRIVE.shot, DRIVE.wait_for

SEED = """
async () => {
  const ws = window.ordenApp.workspace
  const home = ws.activeSpace
  for (const [name, notes] of [['Orga', ['today:', 'GitHub', 'A rather long title for a window that should end in dots']], ['Ideas', ['Ideas one']]]) {
    if (!ws.spaces.some((one) => one.name === name)) await ws.addSpace(name)
    const space = ws.spaces.find((one) => one.name === name)
    await ws.selectSpace(space.id)
    for (const note of notes) ws.openBlank(note, `# ${note}`)
    await new Promise((go) => setTimeout(go, 300))
  }
  await ws.selectSpace(home.id)
  for (const note of ['Orden', 'Plans', 'Reading']) ws.openBlank(note, `# ${note}`)
  localStorage.setItem('orden:overview-spaces', 'all')
  await new Promise((go) => setTimeout(go, 600))
}
"""

LOOK = """
() => {
  const zoom = Number(/scale\\(([-\\d.]+)\\)/.exec(document.querySelector('.under .world').style.transform)?.[1] ?? 1)
  const windows = [...document.querySelectorAll('.window')].map((one) => one.getBoundingClientRect())
  const meets = (a, b) => a.left < b.right - 0.5 && b.left < a.right - 0.5 && a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5
  const captions = [...document.querySelectorAll('.caption')].map((one) => {
    const box = one.getBoundingClientRect()
    const name = one.querySelector('.caption-name')
    return {
      text: name.textContent,
      tall: Math.round(box.height * 10) / 10,
      cut: name.scrollWidth > name.clientWidth + 1,
      over: windows.filter((window) => meets(box, window)).length,
      captions: 0,
      box: [box.left, box.top, box.right, box.bottom],
    }
  })
  for (const one of captions)
    one.captions = captions.filter((other) => other !== one && meets(
      { left: one.box[0], top: one.box[1], right: one.box[2], bottom: one.box[3] },
      { left: other.box[0], top: other.box[1], right: other.box[2], bottom: other.box[3] })).length
  const spaces = [...document.querySelectorAll('[data-space-name]')].map((one) => Math.round(one.getBoundingClientRect().height * 10) / 10)
  return { zoom, captions, spaces }
}
"""

def wheel(page: Page, notches: int) -> None:
    page.mouse.move(700, 430)
    for _ in range(abs(notches)):
        page.mouse.wheel(0, 100 if notches > 0 else -100)
        page.wait_for_timeout(60)
    page.wait_for_timeout(900)

def look(page: Page, label: str) -> None:
    seen = page.evaluate(LOOK)
    shot(page, label)
    captions = seen["captions"]
    tallest_space = max(seen["spaces"] or [0])
    least = min((one["tall"] for one in captions), default=0)
    say(
        f"[{label}] zoom {seen['zoom']:.2f}: captions {least}px tall, spaces {tallest_space}px;"
        f" {json.dumps([[one['text'][:24], one['tall'], one['cut']] for one in captions])}"
    )
    for one in captions:
        if one["over"] or one["captions"]:
            wrong(f"[{label}] the caption {one['text']!r} lies over {one['over']} windows and {one['captions']} captions")
    if seen["zoom"] >= 0.25 and least < 11.5:
        wrong(f"[{label}] at zoom {seen['zoom']:.2f} a window's caption is {least}px tall, too small to read")
    if tallest_space and least / tallest_space < 0.45:
        wrong(f"[{label}] captions ({least}px) fall out of proportion with the space names ({tallest_space}px)")
    long = [one for one in captions if one["text"].startswith("A rather long")]
    if long and seen["zoom"] < 1 and not long[0]["cut"]:
        wrong(f"[{label}] the long title does not end in dots inside its window: {long[0]}")

def drive(browser: Browser) -> None:
    page = DRIVE.page(browser, viewport={"width": 1400, "height": 860})
    DRIVE.open(page)
    page.evaluate(SEED)
    DRIVE.settled(page)
    page.keyboard.press("Alt")
    page.keyboard.press("Alt")
    wait_for(page, "document.querySelectorAll('.caption').length >= 7", "every window's caption")
    page.wait_for_timeout(1400)
    look(page, "01-opened")
    for _ in range(12):
        if page.evaluate(LOOK)["zoom"] <= 0.32:
            break
        wheel(page, 1)
    look(page, "02-a-third")
    wheel(page, 6)
    look(page, "02-further")
    wheel(page, 10)
    look(page, "03-furthest")
    wheel(page, -24)
    look(page, "04-near")
    page.emulate_media(color_scheme="dark")
    wheel(page, 12)
    look(page, "05-dark")
    page.close()

if __name__ == "__main__":
    raise SystemExit(DRIVE.run(drive, "the overview's window captions stay readable zoomed out"))
