from __future__ import annotations

import json

from playwright.sync_api import Browser, Page
from playwright.sync_api import TimeoutError as PlaywrightTimeout

from harness import Drive
from settling import LANDED, UNLANDED

DRIVE = Drive(__file__)
say, wrong, shot, wait_for = DRIVE.say, DRIVE.wrong, DRIVE.shot, DRIVE.wait_for
ORIGIN = DRIVE.origin

NOTE = """# What contrast is for

Ordinary words, and *some* of them `marked up`, with a [link](https://example.com)
and a bit of **weight**.

> A quote, which is drawn in the muted colour.

```js
class Kestrel {}
const answer = 41 + 1 // a comment
function shout(word) { return `${word}!` }
```

| Kind | Size |
| --- | ---: |
| Image | 288 |
"""

SEED = """
async ([note]) => {
  const ws = window.nibApp.workspace
  await ws.noteFrom(note, ws.activeSpace.root)
  await ws.loadTree()
  return ws.notes.map((one) => one.path)
}
"""

RATIOS = """
(names) => {
  if (!(LANDED)) return null

  const probe = document.createElement('span')
  probe.style.position = 'fixed'
  probe.style.opacity = '0'
  document.body.append(probe)

  const colourOf = (token) => {
    probe.style.color = 'red'
    probe.style.color = `var(${token})`
    const said = getComputedStyle(probe).color
    const parts = said.match(/[\\d.]+/g) ?? []
    return parts.slice(0, 3).map(Number)
  }

  const light = ([r, g, b]) => {
    const channel = (one) => {
      const value = one / 255
      return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
    }
    return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
  }

  const paper = light(colourOf('--bg'))
  const out = {}
  for (const name of names) {
    const ink = light(colourOf(name))
    const [high, low] = ink > paper ? [ink, paper] : [paper, ink]
    out[name] = Math.round(((high + 0.05) / (low + 0.05)) * 10) / 10
  }

  probe.remove()
  return out
}
""".replace("LANDED", LANDED)

CODE = """
() => {
  const found = {}
  for (const span of document.querySelectorAll('.cm-line.nib-code span')) {
    const name = [...span.classList].find((one) => one.startsWith('ͼ')) ?? span.className
    if (name && !found[name]) found[name] = getComputedStyle(span).color
  }
  return found
}
"""

WANTED = [
    "--text",
    "--text-strong",
    "--muted",
    "--muted-strong",
    "--accent",
    "--line",
    "--line-strong",
    "--danger",
    "--success",
]

FLOORS = {
    "--text": 15,
    "--text-strong": 15,
    "--muted": 7,
    "--muted-strong": 9,
    "--accent": 5.5,
    "--line": 3,
    "--line-strong": 4.5,
    "--danger": 4.5,
    "--success": 4.5,
}

TOLERATED = ("orden.so", "nibeditor.com", "Failed to load resource", "net::ERR")

CANCELLED = ("Importing a module script failed", "due to access control checks")
LEAVING: set[Page] = set()

def listen(page: Page, label: str) -> None:
    def cancelled(said: str) -> bool:
        return page in LEAVING and any(one in said for one in CANCELLED)

    page.on(
        "pageerror",
        lambda error: None if cancelled(str(error)) else wrong(f"[{label}] page error: {error}"),
    )
    page.on(
        "console",
        lambda message: wrong(f"[{label}] console error: {message.text}")
        if message.type == "error"
        and not any(one in message.text for one in TOLERATED)
        and not cancelled(message.text)
        else None,
    )
    page.on(
        "requestfailed",
        lambda request: wrong(f"[{label}] a piece of the app did not arrive: {request.url}")
        if page not in LEAVING and "/assets/" in request.url
        else None,
    )
    page.on(
        "framenavigated",
        lambda frame: LEAVING.discard(page) if frame == page.main_frame else None,
    )

def launched(browser: Browser, label: str, forced: bool = False) -> Page:
    context = browser.new_context(
        viewport={"width": 1180, "height": 820},
        color_scheme="dark",
        forced_colors="none",
        contrast="more" if forced else "no-preference",
    )
    page = context.new_page()
    listen(page, label)
    page.goto(ORIGIN, wait_until="domcontentloaded")

    wait_for(page, "window.nibApp", f"[{label}] the app")
    return page

def fresh(browser: Browser, label: str, forced: bool = False) -> Page:
    page = launched(browser, label, forced)

    wait_for(page, "window.nibApp.workspace.activeSpace", f"[{label}] a space")
    say(f"[{label}] the space holds {page.evaluate(SEED, [NOTE])}")

    page.evaluate(
        """async () => {
          const ws = window.nibApp.workspace
          const note = ws.notes.find((one) => one.name.startsWith('What contrast'))
          await ws.openEntry(note.path, { activate: true })
        }"""
    )
    wait_for(page, "window.nib && document.querySelector('.cm-content')", f"[{label}] the editor")
    page.wait_for_timeout(600)
    return page

def ratios(page: Page) -> dict:
    try:
        return page.wait_for_function(RATIOS, arg=WANTED, timeout=30_000, polling=50).json_value()
    except PlaywrightTimeout:
        wrong(f"a sheet never landed, so the colours cannot be read: {page.evaluate(UNLANDED)}")
        return {}

def wear_the_theme(page: Page) -> None:
    page.evaluate("() => window.nibApp.theme.select('contrast')")
    page.wait_for_timeout(400)

    if page.evaluate("() => window.nibApp.theme.id") != "contrast":
        wrong("the built-in contrast theme could not be chosen")

def scheme(page: Page, which: str) -> None:
    page.evaluate("(which) => window.nibApp.theme.setScheme(which)", which)
    page.wait_for_timeout(400)

def check(page: Page, label: str, floors: dict) -> dict:
    said = ratios(page)
    say(f"[{label}] {json.dumps(said)}")

    for token, floor in floors.items():
        if said.get(token, 0) < floor:
            wrong(f"[{label}] {token} is {said.get(token)}:1 against the page, under {floor}:1")

    return said

def unmarked(page: Page, label: str) -> None:
    if page.evaluate("() => document.documentElement.getAttribute('data-contrast')"):
        wrong(f"[{label}] the page still says it is drawn with more contrast from outside")

def drive_scheme(browser: Browser, which: str, at: int) -> None:
    page = fresh(browser, which)
    scheme(page, which)

    plain = check(page, f"{which}, the built-in", {})
    shot(page, f"{at}-{which}-default")
    code_plain = page.evaluate(CODE)
    unmarked(page, which)

    wear_the_theme(page)
    more = check(page, f"{which}, the contrast theme", FLOORS)
    shot(page, f"{at + 1}-{which}-contrast")
    unmarked(page, which)

    if page.evaluate("() => document.documentElement.dataset.theme") != which:
        wrong(f"[{which}] the page is not wearing the scheme that was asked for")

    for token, was in plain.items():
        if more.get(token, 0) < was:
            wrong(f"[{which}] {token} lost contrast: {was}:1 became {more.get(token)}:1")

    code_more = page.evaluate(CODE)
    say(f"[{which}] the fence: {json.dumps(code_plain)} became {json.dumps(code_more)}")
    if code_plain == code_more:
        wrong(f"[{which}] the syntax in a fence is the same colour under the contrast theme")

    page.context.close()

def drive_settings(browser: Browser) -> None:
    page = fresh(browser, "settings")
    page.evaluate("() => window.nibApp.settings.show('appearance')")
    page.wait_for_selector(".nib-screen.sheet", timeout=15000)
    page.wait_for_timeout(600)
    shot(page, "20-appearance")

    rows = page.evaluate(
        "() => [...document.querySelectorAll('.setting')]"
        ".map((row) => row.textContent.trim().slice(0, 40))"
    )
    say(f"[settings] the appearance pane: {json.dumps(rows[:8], ensure_ascii=False)}")

    if not rows:
        wrong("the appearance pane is empty, so what it offers cannot be read")
    if page.get_by_role("switch", name="More contrast").count():
        wrong("the More contrast switch is back")

    offered = page.evaluate("() => window.nibApp.theme.all.map((one) => one.id)")
    say(f"[settings] the Style row offers {json.dumps(offered)}")
    if offered[:2] != ["default", "contrast"]:
        wrong(f"the two the app ships with are not the first two offered: {offered}")

    page.context.close()

def drive_offered(browser: Browser) -> None:
    page = launched(browser, "offered", forced=True)
    page.wait_for_timeout(800)

    if not page.evaluate("() => window.nibApp.theme.offerContrast"):
        wrong("a system asking for more contrast was not answered")
    if page.evaluate("() => window.nibApp.theme.id") != "contrast":
        wrong("the launch did not choose the contrast theme")
    if page.evaluate("() => localStorage.getItem('nib:theme')") != "contrast":
        wrong("the choice was not written down, so the next launch would forget it")
    if page.evaluate("() => window.nibApp.settings.section") != "appearance":
        wrong("Appearance did not open on the row the theme was chosen from")
    if page.evaluate("() => localStorage.getItem('nib:contrast-offered')") != "yes":
        wrong("the answer was not written down, so it would be given again")
    said = ratios(page)
    say(f"[offered] {json.dumps(said)}")
    for token, floor in FLOORS.items():
        if said.get(token, 0) < floor:
            wrong(f"[offered] {token} is {said.get(token)}:1 against the page, under {floor}:1")
    shot(page, "30-answered")

    LEAVING.add(page)
    with page.expect_request("**/assets/Palette-*.js", timeout=30_000):
        page.reload(wait_until="domcontentloaded")
        wait_for(page, "window.nibApp", "[offered] the app again")
    page.wait_for_load_state("networkidle")

    if page.evaluate("() => window.nibApp.theme.offerContrast"):
        wrong("the answer was given a second time")
    if page.evaluate("() => !!document.querySelector('.notices .reload')"):
        wrong("a piece of the app did not arrive on the second launch")
    if page.evaluate("() => window.nibApp.theme.id") != "contrast":
        wrong("the theme chosen by the first launch did not survive the second")
    shot(page, "31-not-asked-again")

    page.context.close()

def main() -> int:
    with DRIVE.session() as browser:
        say("--- dark ---")
        drive_scheme(browser, "dark", 1)
        say("--- light ---")
        drive_scheme(browser, "light", 10)
        say("--- the appearance pane ---")
        drive_settings(browser)
        say("--- offered to a system that asks ---")
        drive_offered(browser)

    return DRIVE.verdict("contrast is a theme, and it measures up on both of its sides")

if __name__ == "__main__":
    raise SystemExit(main())
