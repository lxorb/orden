from harness import Drive

DRIVE = Drive(__file__)
say, wrong, shot, wait_for = DRIVE.say, DRIVE.wrong, DRIVE.shot, DRIVE.wait_for
NOTES = """**46 bugs fixed** since v0.21.0.

### New

- Settings opens as a tab of its own inside Orden, as Pass does
- A themes button takes the light and dark switch's place
- Choose an icon for every kind of essential
"""
SIZES = [("desktop", 1280, 800, "light"), ("desktop-dark", 1280, 800, "dark"), ("phone", 390, 844, "light")]
def main() -> int:
    with DRIVE.session() as browser:
        for name, width, height, scheme in SIZES:
            context = browser.new_context(
                viewport={"width": width, "height": height},
                color_scheme=scheme,
                reduced_motion="reduce",
                device_scale_factor=2,
            )
            page = context.new_page()
            page.on("pageerror", lambda error: wrong(f"[{name}] page error: {error}"))
            DRIVE.open(page)
            wait_for(page, "window.ordenApp.workspace.active", "the app to open its own note")
            page.evaluate(f"() => window.ordenApp.theme.setScheme('{scheme}')")
            page.evaluate(
                "(notes) => { window.ordenApp.updates.news = { version: '0.22.0', notes } }",
                NOTES,
            )
            wait_for(page, "document.querySelector('.sheet .notes li')", "the notes in their sheet")
            title = page.locator(".sheet h2").inner_text()
            if title != "What's new in Orden 0.22.0":
                wrong(f"[{name}] the sheet is called {title!r}")
            said = page.locator(".sheet .notes").inner_text()
            if "46 bugs fixed" not in said or said.count("\n") < 3:
                wrong(f"[{name}] the notes read {said!r}")
            page.wait_for_timeout(300)
            shot(page, f"{name}-sheet")
            page.get_by_role("button", name="Done").click()
            wait_for(page, "!document.querySelector('.sheet .notes')", "the sheet to close")
            if page.evaluate("() => window.ordenApp.updates.news") is not None:
                wrong(f"[{name}] the notes are still up after Done")
            say(f"[{name}] {title}: shown and closed")
            context.close()
    return DRIVE.verdict("the release notes show in their sheet and close on Done")
raise SystemExit(main())
