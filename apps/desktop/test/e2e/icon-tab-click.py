from __future__ import annotations

from playwright.sync_api import Browser

from harness import Drive

DRIVE = Drive(__file__)
say, wrong = DRIVE.say, DRIVE.wrong

TABS = """() => [...document.querySelectorAll('.tab .pick[data-tab]')].map((one) => {
  const r = one.getBoundingClientRect()
  return { id: one.dataset.tab, chosen: !!one.closest('.tab.active'), x: r.x + r.width / 2, y: r.y + r.height / 2 }
})"""

def drive(browser: Browser) -> None:
    page = DRIVE.page(browser, viewport={"width": 1280, "height": 800})
    DRIVE.open(page)
    names = ("One", "Two", "Three", "Four", "Five")
    DRIVE.seed(page, *(f"# {name}\n\nWords.\n" for name in names))
    for name in names:
        DRIVE.open_note(page, name)
    page.wait_for_timeout(800)

    count = len(page.evaluate(TABS))
    for round_ in range(count - 1):
        page.mouse.move(640, 500)
        page.wait_for_timeout(400)
        tabs = page.evaluate(TABS)
        other = next((one for one in tabs if not one["chosen"]), None)
        if other is None:
            wrong(f"round {round_}: no tab but the one in front")
            break
        page.mouse.move(other["x"], other["y"])
        page.mouse.down()
        page.mouse.up()
        page.wait_for_timeout(500)
        after = page.evaluate(TABS)
        if len(after) != count:
            wrong(f"round {round_}: a click on a tab drawn as its mark closed a tab ({len(after)} of {count} left)")
            break
        if not any(one["id"] == other["id"] and one["chosen"] for one in after):
            wrong(f"round {round_}: a click on a tab drawn as its mark did not choose it")
    say(f"{count} tabs, each chosen by a click on its mark, none closed")

if __name__ == "__main__":
    raise SystemExit(DRIVE.run(drive, "a click on a tab drawn as its mark chooses it"))
