from __future__ import annotations

from playwright.sync_api import Browser, Page

from harness import WEBKIT, Drive

DRIVE = Drive(__file__)
say, wrong, wait_for = DRIVE.say, DRIVE.wrong, DRIVE.wait_for

NAMES = [f"Note {letter}" for letter in "ABCDEFGHIJKL"]

PARTED = 3

SEED = """
async (names) => {
  const ws = window.ordenApp.workspace
  const root = ws.activeSpace.root
  for (const tab of [...ws.tabs]) ws.close(tab.id)
  for (const name of names) {
    const path = await ws.noteFrom(`# ${name}\\n\\nWords.\\n`, root)
    await ws.openEntry(path, { activate: true })
    ws.keep(ws.activeTabId)
  }
  for (const one of ws.tabs.filter((tab) => !names.includes(tab.shown))) ws.close(one.id)
}
"""

WATCH = """
() => {
  window.__frames = []
  const look = () => {
    window.__frames.push([...document.querySelectorAll('.tabs .tab')].map((one) => {
      const box = one.getBoundingClientRect()
      return {
        name: one.querySelector('.label')?.textContent ?? '',
        left: box.left,
        right: box.right,
        width: box.width,
        active: one.classList.contains('active'),
        leaving: one.classList.contains('leaving'),
        filled: getComputedStyle(one.querySelector('.fill')).backgroundColor !== 'rgba(0, 0, 0, 0)',
      }
    }))
    if (window.__frames.length < 40) requestAnimationFrame(look)
  }
  requestAnimationFrame(look)
}
"""

def tab(name: str) -> str:
    return f'.tab:has(.label:text-is("{name}"))'

def frames(page: Page) -> list[list[dict]]:
    wait_for(page, "window.__frames && window.__frames.length >= 40", "forty frames")
    return page.evaluate("() => window.__frames")

def closing(page: Page, look: str, icons: bool) -> None:
    page.emulate_media(color_scheme=look)  # type: ignore[arg-type]
    scheme = look if icons else f"{look}-chrome"
    page.evaluate(SEED, NAMES)
    wait_for(page, f"document.querySelectorAll('.tabs .tab').length === {len(NAMES)}", "the strip")
    page.locator(f"{tab('Note D')} .pick").click()
    page.wait_for_timeout(400)

    cross = page.locator(f"{tab('Note D')} .shut").bounding_box()
    x, y = cross["x"] + cross["width"] / 2, cross["y"] + cross["height"] / 2
    page.mouse.move(x, y)
    page.wait_for_timeout(300)

    page.evaluate(WATCH)
    page.mouse.down()
    page.mouse.up()
    page.wait_for_timeout(60)
    DRIVE.shot(page, f"{scheme}-01-closing")
    seen = frames(page)

    first = {one["name"]: one["width"] for one in seen[0] if one["name"] != "Note D"}
    front = next((one["name"] for one in seen[-1] if one["active"]), None)
    say(f"[{scheme}] in front after the close: {front}")
    if icons and front in first:
        del first[front]
    rest = next((one["name"] for one in seen[-1] if one["left"] <= x <= one["right"]), None)
    say(f"[{scheme}] under the pointer after the close: {rest}")
    if icons and rest in first:
        del first[rest]
    worst = 0.0
    for at, frame in enumerate(seen):
        active = [one["name"] for one in frame if one["active"]]
        if len(active) > 1:
            wrong(f"[{scheme}] frame {at} draws {active} in front")
            break
        going = next((one for one in frame if one["name"] == "Note D"), None)
        if going is None:
            continue
        if going["filled"] and going["leaving"]:
            wrong(f"[{scheme}] frame {at}: the closed tab is still filled")
            break
        after = next((one for one in frame if one["name"] == "Note E"), None)
        if after and going["leaving"]:
            worst = max(worst, abs(going["right"] - after["left"]))
        for one in frame:
            held = first.get(one["name"])
            if held is not None and one["name"] != "Note E" and abs(one["width"] - held) > 0.5:
                wrong(f"[{scheme}] frame {at}: {one['name']} went from {held} to {one['width']} wide")
                return
    say(f"[{scheme}] the closed tab's edge and the next one's: at most {worst:.1f} px apart")
    if worst > PARTED and not WEBKIT:
        wrong(f"[{scheme}] the closed tab and the next one parted by {worst:.1f} px")

    if icons:
        page.mouse.move(x, y + 300)
        return

    page.mouse.down()
    page.mouse.up()
    wait_for(page, "!window.ordenApp.workspace.tabs.some((one) => one.shown === 'Note E')", "Note E to close")
    left = page.evaluate("() => window.ordenApp.workspace.tabs.map((one) => one.shown)")
    say(f"[{scheme}] after two presses in one place: {left}")
    if "Note D" in left or "Note E" in left or len(left) != len(NAMES) - 2:
        wrong(f"[{scheme}] two presses did not close the two tabs: {left}")
    page.mouse.move(x, y + 300)
    page.wait_for_timeout(500)
    DRIVE.shot(page, f"{scheme}-02-let-out")

def drive(browser: Browser) -> None:
    for icons in (True, False):
        for scheme in ("light", "dark"):
            page = DRIVE.page(browser, viewport={"width": 1440, "height": 700})
            page.context.add_init_script(
                f"localStorage.setItem('orden:icon-tabs', {'yes' if icons else 'no'!r})"
            )
            DRIVE.open(page)
            closing(page, scheme, icons)
            page.context.close()

if __name__ == "__main__":
    raise SystemExit(DRIVE.run(drive, "a closed tab shrinks out of the way, and the rest hold still"))
