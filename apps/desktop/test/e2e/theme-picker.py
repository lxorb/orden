from __future__ import annotations

import sys

from settling import HIDE_CARET, steady

import harness
from harness import Drive

DRIVE = Drive(__file__)
say = DRIVE.say
failures = DRIVE.failures
ORIGIN = DRIVE.origin
SHOTS = DRIVE.shots
APP = harness.APP

INSTALL = ["github", "rose", "solar", "graphite", "newsprint", "mono"]

SEED = """
async () => {
  const ws = window.ordenApp.workspace
  await ws.noteFrom('# Kestrel notes\\n\\nA kestrel hangs on the wind, and [a link](https://example.com) says where.\\n\\n- One thing\\n- Another\\n\\n```js\\nconst ink = "on glass"\\n```\\n')
  await ws.noteFrom('# Reading list\\n\\nA paper about ink.')
  await ws.noteFrom('# Journal\\n\\nThe morning.')
  await ws.loadTree()
  const first = ws.notes.find((one) => one.name.startsWith('Kestrel'))
  if (first) await ws.openEntry(first.path, { activate: true })
  return ws.files.length
}
"""

INSTALLING = """
async (ids) => {
  const store = window.ordenApp.themeStore
  await store.load(true)
  for (const id of ids) {
    const one = store.themes.find((theme) => theme.id === id)
    if (one) await store.install(one)
  }
  const theme = window.ordenApp.theme
  theme.select('default')
  theme.setScheme('dark')
  theme.setAccent('violet')
  return theme.files.map((one) => one.id)
}
"""

STATE = """
() => ({
  id: window.ordenApp.theme.id,
  scheme: document.documentElement.dataset.theme,
  kept: localStorage.getItem('orden:theme'),
  keptScheme: localStorage.getItem('orden:theme-scheme'),
  open: !!document.querySelector('[role="dialog"][aria-label="Themes"]'),
})
"""

TIMED = """
async (name) => {
  const card = [...document.querySelectorAll('[role="option"]')].find((one) => one.textContent.includes(name))
  const before = getComputedStyle(document.body).backgroundColor
  const start = performance.now()
  card.dispatchEvent(new PointerEvent('pointermove', { bubbles: true }))
  getComputedStyle(document.body).backgroundColor
  const styled = performance.now() - start
  let frames = 0
  await new Promise((done) => {
    const frame = () => {
      frames++
      const on = window.ordenApp.theme.id === `file:${name.toLowerCase()}`
      if ((on && getComputedStyle(document.body).backgroundColor !== before) || frames > 60) done()
      else requestAnimationFrame(frame)
    }
    requestAnimationFrame(frame)
  })
  return { styled, frames, painted: performance.now() - start }
}
"""

def check(what: str, ok: bool) -> None:
    say(f"{'ok  ' if ok else 'FAIL'} {what}")
    if not ok:
        failures.append(what)

def main() -> int:
    with DRIVE.session() as browser:
        context = browser.new_context(
            viewport={"width": 1280, "height": 800},
            color_scheme="dark",
            reduced_motion="reduce",
            device_scale_factor=2,
        )
        context.add_init_script(HIDE_CARET)
        page = context.new_page()
        page.on("pageerror", lambda error: say(f"page error: {error}"))

        def shot(name: str) -> None:
            picture = steady(page, lambda: page.screenshot(), say, name)
            (SHOTS / f"{name}.png").write_bytes(picture)
            say(f"shot {name}")

        def state() -> dict:
            return page.evaluate(STATE)

        def card(name: str):
            return page.locator('[role="option"]', has_text=name).first

        DRIVE.open(page)
        page.evaluate(SEED)
        page.evaluate("() => window.ordenApp.workspace.showPanel('tree')")
        installed = page.evaluate(INSTALLING, INSTALL)
        say(f"installed {', '.join(installed)}")
        check("the store installed the six themes", {f"file:{one}" for one in INSTALL} <= set(installed))
        page.wait_for_timeout(300)

        themes = page.locator('.foot .acts button[aria-label="Themes"]')
        themes.click()
        page.wait_for_selector('[role="dialog"][aria-label="Themes"]')
        box = page.locator('[role="dialog"][aria-label="Themes"]').bounding_box()
        near = themes.bounding_box()
        check(
            "the Themes button opens the picker beside it",
            box is not None
            and near is not None
            and box["y"] + box["height"] <= near["y"]
            and abs(box["x"] - near["x"]) < 400,
        )
        shot("1-open-from-button")

        card("GitHub").hover()
        now = state()
        check("pointing at GitHub puts it on the app", now["id"] == "file:github")
        check("and writes nothing down", now["kept"] == "default")
        shot("2-pointing-github")

        card("Rose").hover()
        check("pointing at Rose tries Rose", state()["id"] == "file:rose")
        shot("3-pointing-rose")

        card("Newsprint").hover()
        now = state()
        check(
            "a light-only theme is shown in its light",
            now["id"] == "file:newsprint" and now["scheme"] == "light",
        )
        shot("4-pointing-newsprint")

        timing = page.evaluate(TIMED, "Solar")
        say(
            f"Solar on the page in frame {timing['frames']} after the pointer moved"
            f" ({timing['styled']:.1f} ms styled, {timing['painted']:.1f} ms painted)"
        )
        check("a theme is on the page within two frames", timing["frames"] <= 2)

        page.mouse.move(1200, 60)
        now = state()
        check(
            "moving off the cards gives the kept theme back",
            now["id"] == "default" and now["scheme"] == "dark" and now["open"],
        )

        page.keyboard.press("ArrowRight")
        check("the arrows try a theme", state()["id"] == "contrast")
        page.keyboard.press("ArrowDown")
        tried = state()["id"]
        page.keyboard.press("Escape")
        page.wait_for_selector('[role="dialog"][aria-label="Themes"]', state="detached")
        now = state()
        check(
            f"Escape after trying {tried} closes and puts back the kept theme",
            now["id"] == "default" and now["kept"] == "default" and not now["open"],
        )

        themes.click()
        page.wait_for_selector('[role="dialog"][aria-label="Themes"]')
        card("Graphite").hover()
        page.mouse.click(1100, 400)
        page.wait_for_selector('[role="dialog"][aria-label="Themes"]', state="detached")
        check("a press outside puts back the kept theme", state()["id"] == "default")

        themes.click()
        page.wait_for_selector('[role="dialog"][aria-label="Themes"]')
        page.locator('[role="radiogroup"] button[aria-label="Light"]').hover()
        now = state()
        check(
            "pointing at the light mark tries the light, and keeps nothing",
            now["scheme"] == "light" and now["keptScheme"] == "dark",
        )
        shot("5-pointing-light")
        card("Solar").hover()
        shot("6-pointing-solar")

        card("Solar").click()
        page.wait_for_selector('[role="dialog"][aria-label="Themes"]', state="detached")
        now = state()
        check(
            "a click keeps Solar, written down, and closes",
            now["id"] == "file:solar" and now["kept"] == "file:solar" and not now["open"],
        )
        shot("7-kept-solar")

        page.keyboard.press("Control+Shift+P")
        page.wait_for_selector('input[role="combobox"]')
        page.keyboard.type("Switch theme")
        page.wait_for_timeout(150)
        page.keyboard.press("Enter")
        page.wait_for_selector('[role="dialog"][aria-label="Themes"]')
        box = page.locator('[role="dialog"][aria-label="Themes"]').bounding_box()
        check(
            "the palette's row opens it where the palette stands",
            box is not None and abs(box["x"] + box["width"] / 2 - 640) < 4,
        )
        shot("8-open-from-palette")

        page.keyboard.type("gra")
        now = state()
        check("typing narrows to Graphite and tries it", now["id"] == "file:graphite")
        shot("9-typed")
        page.keyboard.press("Enter")
        page.wait_for_selector('[role="dialog"][aria-label="Themes"]', state="detached")
        check("and Enter keeps it", state()["kept"] == "file:graphite")

        page.evaluate(
            "() => { window.ordenApp.theme.select('default'); window.ordenApp.theme.setScheme('light') }"
        )
        themes.click()
        page.wait_for_selector('[role="dialog"][aria-label="Themes"]')
        shot("10-light-open")
        page.keyboard.press("Escape")

    if failures:
        say(f"{len(failures)} failed: {'; '.join(failures)}")
        return 1

    say("every promise kept")
    return 0

if __name__ == "__main__":
    sys.exit(main())
