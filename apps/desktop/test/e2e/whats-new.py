from harness import Drive

DRIVE = Drive(__file__)
say, wrong, shot, wait_for = DRIVE.say, DRIVE.wrong, DRIVE.shot, DRIVE.wait_for
NEWS = {
    "version": "0.22.0",
    "since": "0.21.0",
    "bugs": 46,
    "added": [
        "Settings opens as a tab of its own inside Orden, as Pass does",
        "A themes button takes the light and dark switch's place",
        "Choose an icon for every kind of essential",
    ],
    "updates": 2,
}
SIZES = [
    ("desktop", 1280, 800, "light"),
    ("desktop-dark", 1280, 800, "dark"),
    ("phone", 390, 844, "light"),
    ("phone-dark", 390, 844, "dark"),
]
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
            page.evaluate("(news) => { window.ordenApp.updates.news = news }", NEWS)
            wait_for(page, "document.querySelector('.sheet li')", "the news in its sheet")
            title = page.locator(".sheet h2").inner_text()
            if title != "What's new in Orden 0.22.0":
                wrong(f"[{name}] the sheet is called {title!r}")
            said = " ".join(page.locator(".sheet .body").inner_text().split())
            for part in ["Since you've been gone, here's what we did for you", "46 bugs fixed", "3 things new"]:
                if part not in said:
                    wrong(f"[{name}] the sheet does not say {part!r}: {said!r}")
            if "2 updates since 0.21.0" not in said or page.locator(".sheet li").count() != 3:
                wrong(f"[{name}] the sheet reads {said!r}")
            if not page.locator(".sheet .mascot").count():
                wrong(f"[{name}] the sheet shows no face")
            page.wait_for_timeout(300)
            shot(page, f"{name}-sheet")
            page.get_by_role("button", name="Done").click()
            wait_for(page, "!document.querySelector('.sheet li')", "the sheet to close")
            if page.evaluate("() => window.ordenApp.updates.news") is not None:
                wrong(f"[{name}] the notes are still up after Done")
            say(f"[{name}] {title}: shown and closed")
            context.close()
    return DRIVE.verdict("what came since the last run shows in its sheet and closes on Done")
raise SystemExit(main())
