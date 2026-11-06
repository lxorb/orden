from __future__ import annotations

from collections.abc import Callable

from playwright.sync_api import Browser, Page

from harness import Drive

DRIVE = Drive(__file__)
say, wrong, shot = DRIVE.say, DRIVE.wrong, DRIVE.shot

def shown(page: Page, selector: str) -> bool:
    return bool(page.evaluate("(selector) => !!document.querySelector(selector)", selector))

def gone(page: Page, selector: str, what: str) -> bool:
    try:
        DRIVE.wait_for(page, f"!document.querySelector({selector!r})", what, 5)
        return True
    except SystemExit:
        return False

def blurred(page: Page) -> None:
    page.evaluate("() => window.dispatchEvent(new FocusEvent('blur'))")

def check(
    page: Page,
    name: str,
    opening: Callable[[], None],
    popup: str,
    area: str | Callable[[], None],
    still: str | None = None,
    toggles: bool | Callable[[], None] = True,
) -> None:
    closers: list[tuple[str, Callable[[], None]]] = [
        ("a press past it", area if callable(area) else lambda: press_past(page, area, popup)),
        ("Escape", lambda: page.keyboard.press("Escape")),
        ("the window losing the focus", lambda: blurred(page)),
    ]
    if toggles:
        closers.append(("its own button", opening if toggles is True else toggles))
    for how, close in closers:
        opening()
        try:
            DRIVE.wait_for(page, f"!!document.querySelector({popup!r})", f"{name} to open", 15)
        except SystemExit:
            wrong(f"{name}: the press never opened it")
            return
        page.wait_for_timeout(250)
        if not shown(page, popup):
            wrong(f"{name}: the press that opened it closed it again")
            return
        if how == "a press past it":
            shot(page, f"{name.replace(' ', '-')}-open")

        close()
        if not gone(page, popup, f"{name} to close on {how}"):
            said = page.evaluate(
                "() => ({ depth: window.nibApp.overlays.depth, pressed: window.__pressed ?? [],"
                " layers: [...document.querySelectorAll('.nib-layer, .nib-bubble, .nib-scrim')]"
                ".map((one) => one.className) })"
            )
            wrong(f"{name}: {how} left it open: {said}")
            page.keyboard.press("Escape")
            page.wait_for_timeout(200)
            continue
        if still and how == "a press past it" and not shown(page, still):
            wrong(f"{name}: a press past it closed what it was dropped from as well")
        say(f"{name}: closed by {how}")

SPOTS = ((0.5, 0.5), (0.2, 0.3), (0.8, 0.3), (0.2, 0.75), (0.8, 0.75), (0.5, 0.1), (0.5, 0.9))
FLOATING = (".cluster", ".over", ".nib-bubble", "[role=listbox]", ".canvas [data-id]")

def press_past(page: Page, area: str, popup: str) -> None:
    clear = page.evaluate(
        """([area, avoid, spots]) => {
          const box = document.querySelector(area)?.getBoundingClientRect()
          if (!box) return null
          const rects = avoid.flatMap((one) => [...document.querySelectorAll(one)])
            .map((one) => one.getBoundingClientRect())
          for (const [dx, dy] of spots) {
            const x = box.left + box.width * dx, y = box.top + box.height * dy
            const under = (r) => x > r.left - 16 && x < r.right + 16 && y > r.top - 16 && y < r.bottom + 16
            if (!rects.some(under)) return [x, y]
          }
          return null
        }""",
        [area, [popup, *FLOATING], SPOTS],
    )
    if not clear:
        raise SystemExit(f"nowhere in {area} is clear of {popup}")
    page.mouse.click(clear[0], clear[1])

def empty_spot(page: Page, selector: str, dx: float = 0.5, dy: float = 0.5) -> Callable[[], None]:

    def press() -> None:
        box = page.locator(selector).first.bounding_box()
        if not box:
            raise SystemExit(f"{selector} is not on screen")
        x, y = box["x"] + box["width"] * dx, box["y"] + box["height"] * dy
        page.mouse.click(x, y)

    return press

def drive(browser: Browser) -> None:
    page = DRIVE.page(browser, viewport={"width": 1180, "height": 820})
    page.add_init_script(
        """for (const type of ['pointerdown', 'pointerup', 'click']) addEventListener(type, (event) => {
          const one = event.target
          ;(window.__pressed ??= []).push(`${type} ${one?.tagName}.${one?.className ?? ''}`)
          window.__pressed.splice(0, window.__pressed.length - 9)
        }, true)"""
    )
    DRIVE.open(page)
    DRIVE.seed(page, "# Plan\n\nWhat we are doing.\n", "# Other\n\nSomething else.\n")
    DRIVE.open_note(page, "Plan")
    page.wait_for_timeout(300)

    page.evaluate("() => window.nibApp.workspace.showPanel('tree')")
    row = page.locator('.row[data-path$="/Other.md"]').first
    row.wait_for(state="visible", timeout=10_000)
    check(
        page,
        "the context menu",
        lambda: row.click(button="right"),
        ".menu[role=menu]",
        ".cm-content",
        toggles=False,
    )

    switcher = page.locator('[data-space-drop="switcher"]').first
    check(
        page,
        "the space switcher",
        lambda: switcher.click(),
        "[data-spaces-open]",
        ".cm-content",
        toggles=lambda: empty_spot(page, '[data-space-drop="switcher"]')(),
    )

    page.evaluate("() => window.nibApp.settings.show('general')")
    DRIVE.wait_for(page, "!!document.querySelector('.sheet button[role=combobox]')", "a dropdown in the settings")
    dropdown = page.locator(".sheet button[role=combobox]").first
    check(
        page,
        "a settings dropdown",
        lambda: dropdown.click(),
        ".sheet [role=listbox]",
        empty_spot(page, ".sheet", 0.5, 0.06),
        still=".sheet",
    )
    page.keyboard.press("Escape")
    DRIVE.wait_for(page, "!document.querySelector('.sheet')", "the settings to close")

    page.evaluate(
        "async () => { const ws = window.nibApp.workspace;"
        " await ws.createCanvas(ws.activeSpace.root, 'Board.canvas') }"
    )
    DRIVE.wait_for(page, "!!document.querySelector('.cluster button.swatch')", "the canvas bar")
    swatch = page.locator(".cluster button.swatch").first
    check(page, "the canvas colours", lambda: swatch.click(), ".cluster .panel", ".canvas")
    put = page.locator('.cluster button[aria-label="Add"]').first
    if put.count():
        check(page, "the canvas's things to add", lambda: put.click(), ".cluster .panel", ".canvas")

    plane = page.locator(".canvas").first.bounding_box()
    if plane:
        page.mouse.dblclick(plane["x"] + plane["width"] * 0.55, plane["y"] + plane["height"] * 0.45)
        page.wait_for_timeout(400)
        page.keyboard.type("card")
        page.keyboard.press("Escape")
        page.wait_for_timeout(400)
    scrolled = page.evaluate(
        "() => { const it = document.querySelector('.canvas'); it.scrollTo(40, 40);"
        " const at = [it.scrollLeft, it.scrollTop]; it.scrollTo(0, 0); return at }"
    )
    if scrolled != [0, 0]:
        wrong(f"the box the plane stands in scrolled to {scrolled}")
    picked = page.locator('.over button[aria-label="Colour"]').first

    def pick_and_open() -> None:
        if not shown(page, ".over"):
            page.locator(".canvas [data-id]").first.click()
            page.wait_for_timeout(300)
        picked.click()

    if picked.count() and picked.is_visible():
        check(
            page,
            "the colours of what is picked",
            pick_and_open,
            ".over .panel",
            ".canvas",
            toggles=False,
        )
    else:
        wrong("no card was picked to open its colours on")

    page.evaluate("() => window.nibApp.workspace.openGraph()")
    DRIVE.wait_for(page, "!!document.querySelector('.graph .corner > button')", "the graph")
    controls = page.locator(".graph .corner > button").last
    check(page, "the graph controls", lambda: controls.click(), ".graph .corner .card", ".graph")

    page.evaluate("() => window.nibApp.workspace.openWebsite()")
    DRIVE.wait_for(page, "!!document.querySelector('.web')", "a web tab")
    field = page.locator(".web input").first
    field.fill("https://example.com/")
    field.press("Enter")
    page.wait_for_timeout(800)
    site = page.locator('[data-opens="site"]').first
    if site.count() and site.is_enabled():
        check(page, "a site's information", lambda: site.click(), ".site.nib-bubble", ".web")
    else:
        say("a site's information: this build has no page to say anything about")
    page.evaluate(
        "async () => (await window.nibApp.downloads()).heard({ id: 1, tab: '', url:"
        " 'https://example.com/a.pdf', name: 'a.pdf', state: 'done', received: 9, total: 9 })"
    )
    page.wait_for_timeout(300)
    saving = page.locator('[data-opens="downloads"]').first
    if saving.count():
        check(page, "the downloads", lambda: saving.click(), ".downloads.nib-bubble", ".web")
    else:
        say("the downloads: nothing has been downloaded in this build")

    page.evaluate(
        """() => {
          window.nibApp.account.guest = { id: 'g1', name: 'Chromium wren' }
          window.nibApp.workspace.openShared(
            { id: 'shared-1', name: 'board.canvas', path: '/Boards/board.canvas' },
            '{"nib":{"version":1},"nodes":[],"edges":[]}',
          )
        }"""
    )
    DRIVE.wait_for(page, "!!document.querySelector('.guest-corner .who')", "a guest's corner")
    face = page.locator(".guest-corner .who").first
    check(page, "a guest's corner", lambda: face.click(), ".guest-corner .pop", ".canvas")

if __name__ == "__main__":
    raise SystemExit(DRIVE.run(drive, "every popup closes past itself, on Escape and on a blur, and not on its own press"))
