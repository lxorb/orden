from playwright.sync_api import Browser, Page
from harness import Drive

DRIVE = Drive(__file__)
say, wrong = DRIVE.say, DRIVE.wrong
WHERE = "(name) => window.ordenApp.workspace.files.find((one) => one.name === name)?.path ?? null"
def row(page: Page, name: str):
    return page.locator(f"aside .row[data-path$='/{name}']").first
def drive(browser: Browser) -> None:
    page: Page = DRIVE.page(browser, viewport={"width": 1100, "height": 760})
    DRIVE.open(page)
    DRIVE.seed(page, "# Alpha\n\nW.", "# Sponsors\n\nW.", "# Old Branding\n\nW.")
    DRIVE.seed(page, "# Lore\n\nW.", "# Orga\n\nW.", folder="Docs")
    root = page.evaluate("() => window.ordenApp.workspace.activeSpace.root")
    page.evaluate(
        """async (root) => { const ws = window.ordenApp.workspace; ws.showPanel('tree');
        await ws.archive.change(root, ['Old Branding.md'], []); ws.device.expand(root.replace(/\\/+$/, '') + '/Docs') }""",
        root,
    )
    page.wait_for_timeout(800)
    if page.evaluate("() => !document.querySelector('aside .archive-head')"):
        wrong("the ARCHIVED section did not come up")
    for name, target, at in (("Lore.md", "Sponsors.md", 0.9), ("Orga.md", "Alpha.md", 0.1)):
        before = page.evaluate(WHERE, name)
        box = row(page, target).bounding_box()
        assert box is not None
        row(page, name).drag_to(row(page, target), target_position={"x": 40, "y": box["height"] * at})
        page.wait_for_timeout(900)
        after = page.evaluate(WHERE, name)
        say(f"{name} dropped at {at:.0%} of {target}: {before} -> {after}")
        if after is None or after.rsplit("/", 1)[0] != root.rstrip("/"):
            wrong(f"{name} dropped beside {target} did not come into the root: {after}")
    page.context.close()
raise SystemExit(DRIVE.run(drive, "a note dropped beside a row of the root lands in the root, whatever sits below the list"))
