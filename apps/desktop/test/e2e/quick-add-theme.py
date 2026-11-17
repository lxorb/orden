from __future__ import annotations

import json

from playwright.sync_api import Browser, Page

from harness import Drive

DRIVE = Drive(__file__)
say, wrong, shot, wait_for = DRIVE.say, DRIVE.wrong, DRIVE.shot, DRIVE.wait_for

LOOK = """() => {
  const root = document.documentElement
  const style = getComputedStyle(root)
  const token = (name) => style.getPropertyValue(name).trim()
  return {
    scheme: root.dataset.theme,
    accent: token('--accent'),
    surface: token('--surface'),
    text: token('--text'),
    sheet: document.getElementById('orden-user-theme')?.textContent.length ?? 0,
  }
}"""

def look(page: Page) -> dict[str, object]:
    return page.evaluate(LOOK)  # type: ignore[no-any-return]

def choose(page: Page, name: str, scheme: str, accent: str) -> None:
    page.evaluate(
        """([name, scheme, accent]) => {
          window.ordenApp.theme.select(name)
          window.ordenApp.theme.setScheme(scheme)
          window.ordenApp.theme.setAccent(accent)
        }""",
        [name, scheme, accent],
    )
    page.wait_for_timeout(400)

def alike(app: Page, quick: Page, what: str) -> None:
    wanted = look(app)
    matched = DRIVE.waited(quick, f"JSON.stringify(({LOOK})()) === {json.dumps(json.dumps(wanted, separators=(',', ':')))}", what, 10)
    said = look(quick)
    say(f"{what}: the app {wanted}, quick add {said}")
    if not matched:
        wrong(f"{what}: quick add wears {said}, the app {wanted}")

def opened(app: Page) -> Page:
    quick = app.context.new_page()
    quick.set_viewport_size({"width": 600, "height": 420})
    quick.goto(f"{DRIVE.origin}/quick-add.html", wait_until="domcontentloaded")
    wait_for(quick, "!!document.querySelector('main input')", "the quick add field")
    quick.wait_for_timeout(400)
    return quick

def drive(browser: Browser) -> None:
    app = DRIVE.page(browser, viewport={"width": 1180, "height": 820})
    DRIVE.open(app)

    choose(app, "default", "light", "red")
    quick = opened(app)
    alike(app, quick, "opened after a change")
    shot(quick, "01-classic-light-red")

    choose(app, "glass", "dark", "teal")
    alike(app, quick, "changed while it was open")
    shot(quick, "02-glass-dark-teal")

    choose(app, "contrast", "light", "teal")
    alike(app, quick, "a theme with its own accent")
    shot(quick, "03-contrast-light")

    quick.close()
    choose(app, "default", "system", "orange")
    quick = opened(app)
    alike(app, quick, "opened again on the system scheme")
    shot(quick, "04-classic-system-orange")
    shot(app, "05-the-app")

if __name__ == "__main__":
    raise SystemExit(DRIVE.run(drive, "quick add wears the theme, scheme and accent the app wears"))
