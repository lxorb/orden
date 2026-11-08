from __future__ import annotations

from playwright.sync_api import Browser, Page

from harness import Drive

DRIVE = Drive(__file__)
say, wrong, wait_for, shot = DRIVE.say, DRIVE.wrong, DRIVE.wait_for, DRIVE.shot

DOC = "# Kestrel\n\nA kestrel hangs on the wind, **still** above the field.\n\n- one\n- two\n"

EACH = [
    ("docx", False, (".docx",)),
    ("rtf", False, (".rtf",)),
    ("epub", False, (".epub",)),
    ("md", False, (".md",)),
    ("md", True, (".md", ".zip")),
    ("txt", False, (".txt",)),
    ("textbundle", False, (".textbundle", ".zip", ".textpack")),
    ("html", False, (".html",)),
    ("html", True, (".html",)),
    ("png", False, (".png",)),
    ("jpg", False, (".jpg", ".jpeg")),
]

def the_picker(page: Page) -> None:
    DRIVE.pick_export(page, "pdf")
    shelves = page.evaluate(
        """() => [...document.querySelectorAll('[role="dialog"] .shelf')].map((shelf) => ({
          name: shelf.querySelector('h3').innerText,
          tiles: [...shelf.querySelectorAll('.tile')].map((tile) => ({
            id: tile.dataset.format,
            drawn: tile.querySelector('svg')?.children.length ?? 0,
          })),
        }))"""
    )
    say(f"shelves: {shelves}")
    ids = [tile["id"] for shelf in shelves for tile in shelf["tiles"]]
    for wanted in ("pdf", "docx", "rtf", "epub", "md", "txt", "textbundle", "html", "png", "jpg"):
        if wanted not in ids:
            wrong(f"no tile for {wanted}")
    for gone in ("md-assets", "html-bare"):
        if gone in ids:
            wrong(f"{gone} is a tile of its own, not an option")
    if any(tile["drawn"] == 0 for shelf in shelves for tile in shelf["tiles"]):
        wrong("a tile has no icon")
    shot(page, "picker")
    page.keyboard.press("Escape")
    page.wait_for_selector('[role="dialog"] .tile', state="detached")

def printed_pdf(page: Page) -> None:
    page.evaluate(
        """() => {
          window.__printed = 0
          window.print = () => { window.__printed += 1 }
          for (const frame of document.querySelectorAll('iframe')) frame.contentWindow.print = window.print
          new MutationObserver((changes) => {
            for (const change of changes) for (const node of change.addedNodes)
              if (node.tagName === 'IFRAME') node.addEventListener('load', () => {
                node.contentWindow.print = () => { window.__printed += 1 }
              })
          }).observe(document.documentElement, { childList: true, subtree: true })
        }"""
    )
    DRIVE.pick_export(page, "pdf").click()
    wait_for(
        page,
        "() => [...document.querySelectorAll('iframe')].some((one) => one.contentDocument?.body?.innerText.includes('kestrel hangs'))",
        "the PDF's sheet with the note on it",
    )
    say("pdf: the note went to the print sheet that saves a PDF")
    page.wait_for_timeout(1500)
    page.locator(".cm-content").first.click()

def each_format(page: Page) -> None:
    printed_pdf(page)
    for format, option, endings in EACH:
        go = DRIVE.pick_export(page, format, option)
        with page.expect_download(timeout=40000) as caught:
            go.click()
        name = caught.value.suggested_filename
        size = len(caught.value.path().read_bytes())
        say(f"{format}{' with its option' if option else ''}: {name}, {size} bytes")
        if not name.lower().endswith(endings):
            wrong(f"{format}: came out as {name}")
        if size < 20:
            wrong(f"{format}: only {size} bytes")
        page.wait_for_timeout(300)

def remembered(page: Page) -> None:
    DRIVE.pick_export(page, "png")
    page.locator('[role="dialog"]').press("Escape")
    page.wait_for_timeout(300)
    page.keyboard.press("Control+Shift+P")
    page.wait_for_selector(".palette input")
    page.keyboard.type("Export", delay=1)
    page.locator("[role=option]", has_text="Export…").first.click()
    page.wait_for_selector('[role="dialog"] .tile')
    first = page.evaluate(
        """() => ({
          shelf: document.querySelector('[role="dialog"] .shelf h3')?.innerText,
          tile: document.querySelector('[role="dialog"] .tile')?.dataset.format,
          on: document.querySelector('[role="dialog"] .tile.on')?.dataset.format,
        })"""
    )
    say(f"after a JPG export, the picker opens on: {first}")
    if first["tile"] != "jpg" or first["on"] != "jpg":
        wrong(f"the last format is not shown first: {first}")
    page.keyboard.press("Escape")

def no_palette_rows(page: Page) -> None:
    page.keyboard.press("Control+Shift+P")
    page.wait_for_selector(".palette input")
    page.keyboard.type("pdf", delay=1)
    page.wait_for_timeout(500)
    rows = page.evaluate("() => [...document.querySelectorAll('[role=option]')].map((one) => one.innerText.split('\\n')[0])")
    say(f"the palette on pdf: {rows[:6]}")
    if any(row.startswith("Export as") for row in rows):
        wrong("the palette still lists a row per format")
    if not rows or not rows[0].startswith("Export…"):
        wrong("Export… is not the first row for pdf")
    page.keyboard.press("Escape")

def settings_export(page: Page) -> None:
    page.evaluate("() => window.ordenApp.settings.show('export')")
    page.wait_for_timeout(600)
    seen = page.evaluate(
        """() => {
          const pane = document.querySelector('[role="region"][aria-label="Settings"] .pane')
          return {
            heads: [...pane.querySelectorAll('h3')].map((one) => one.innerText),
            actions: [...pane.querySelectorAll('.orden-action')].map((one) => one.innerText),
          }
        }"""
    )
    say(f"Settings > Export: {seen}")
    if any(head == "This note" for head in seen["heads"]):
        wrong("Settings still has the This note section")
    if any(one.startswith("Export as") for one in seen["actions"]):
        wrong(f"Settings still exports the note: {seen['actions']}")

def drive(browser: Browser) -> None:
    for scheme in ("light", "dark"):
        context = DRIVE.context(browser, color_scheme=scheme, viewport={"width": 1200, "height": 820})
        page = context.new_page()
        DRIVE.open(page)
        DRIVE.seed(page, DOC)
        DRIVE.open_note(page, "Kestrel")
        the_picker(page)
        if scheme == "light":
            each_format(page)
            remembered(page)
            no_palette_rows(page)
            settings_export(page)
        context.close()

if __name__ == "__main__":
    raise SystemExit(DRIVE.run(drive, "Export… picks every format from one picker"))
