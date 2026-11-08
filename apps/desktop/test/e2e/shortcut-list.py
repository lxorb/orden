from __future__ import annotations

from playwright.sync_api import Browser, Page

from harness import Drive

DRIVE = Drive(__file__)
say, wrong, wait_for = DRIVE.say, DRIVE.wrong, DRIVE.wait_for

MEASURE = """
() => {
  const body = document.querySelector('[role="region"][aria-label="Settings"] .body')
  const list = body?.querySelector('.shortcut-list')
  if (!body || !list) return null
  return {
    body: body.clientHeight,
    page: body.scrollHeight,
    list: list.clientHeight,
    held: list.scrollHeight,
    top: list.scrollTop,
    rows: list.querySelectorAll('.orden-setting').length,
    groups: list.querySelectorAll('.shortcut-group').length,
    lines: [...document.querySelectorAll('[role="region"][aria-label="Settings"] .pane p.hint')].map(
      (one) => one.innerText,
    ),
    inline: [...list.querySelectorAll('.orden-setting .name small')].map((one) => one.innerText),
  }
}
"""

ROW_IN_VIEW = """
(label) => {
  const list = document.querySelector('.shortcut-list')
  const row = [...list.querySelectorAll('.orden-setting')].find((one) =>
    one.querySelector('.name')?.textContent.trim().startsWith(label),
  )
  if (!row) return null
  const box = list.getBoundingClientRect()
  const at = row.getBoundingClientRect()
  return { inside: at.top >= box.top - 1 && at.bottom <= box.bottom + 1, landed: row.classList.contains('landed') }
}
"""

def bounded(page: Page, name: str) -> dict:
    seen = wait_for(page, MEASURE, "the shortcut list")
    say(f"{name}: {seen}")
    if seen["page"] > seen["body"] + 2:
        wrong(f"{name}: the page scrolls ({seen['page']} in {seen['body']})")
    if seen["held"] <= seen["list"]:
        wrong(f"{name}: the list does not scroll ({seen['held']} in {seen['list']})")
    if seen["rows"] < 60:
        wrong(f"{name}: only {seen['rows']} shortcuts in the list")
    if seen["lines"]:
        wrong(f"{name}: standing lines under the list: {seen['lines']}")
    if any("belongs" in one for one in seen["inline"]):
        wrong(f"{name}: an explanation is printed under a name: {seen['inline']}")
    return seen

def drive(browser: Browser) -> None:
    for name, size in (("wide", {"width": 1280, "height": 800}), ("narrow", {"width": 420, "height": 760})):
        page = DRIVE.page(browser, viewport=size)
        DRIVE.open(page)
        page.evaluate("() => window.ordenApp.settings.show('shortcuts')")
        page.wait_for_timeout(500)
        if name == "narrow":
            page.evaluate("() => { window.ordenApp.settings.listing = false }")
            page.wait_for_timeout(300)
        bounded(page, name)
        DRIVE.shot(page, f"{name}-list")

        page.locator(".shortcut-list").evaluate("(list) => { list.scrollTop = 900 }")
        page.wait_for_timeout(200)
        sticky = page.evaluate(
            """() => {
              const list = document.querySelector('.shortcut-list')
              const top = list.getBoundingClientRect().top
              return [...list.querySelectorAll('.shortcut-group h3')].some(
                (one) => Math.abs(one.getBoundingClientRect().top - top) < 2,
              )
            }"""
        )
        say(f"{name}: a group header holds at the top of the list: {sticky}")
        if not sticky:
            wrong(f"{name}: no group header stays at the top while the list scrolls")

        page.evaluate("() => window.ordenApp.settings.show('editor')")
        page.wait_for_timeout(300)
        page.evaluate("() => window.ordenApp.settings.show('shortcuts')")
        page.evaluate("() => { window.ordenApp.settings.listing = false }")
        page.wait_for_timeout(400)
        top = page.evaluate(MEASURE)["top"]
        say(f"{name}: back on Shortcuts the list is at {top}")
        if abs(top - 900) > 2:
            wrong(f"{name}: the list lost its place ({top})")

        if name == "wide":
            hint = page.evaluate(
                """() => [...document.querySelectorAll('.shortcut-list .orden-setting')]
                  .find((one) => one.querySelector('.what')?.textContent.replace('\\u2060', '').trim() === 'Copy')
                  ?.querySelector('.explain button')?.getAttribute('aria-label') ?? null"""
            )
            say(f"Copy's ?: {hint!r}")
            if not hint or "clipboard" not in hint:
                wrong(f"Copy has no ? with its explanation: {hint!r}")

            page.get_by_placeholder("Search shortcuts").fill("redo")
            page.wait_for_timeout(300)
            seen = page.evaluate(MEASURE)
            say(f"searching redo: {seen['rows']} rows")
            if seen["rows"] < 1 or seen["rows"] > 6:
                wrong(f"search left {seen['rows']} rows")
            page.get_by_placeholder("Search shortcuts").fill("")

            page.get_by_placeholder("Search settings").fill("Quit")
            page.wait_for_timeout(300)
            page.locator("[role=region][aria-label=Settings] .body .orden-setting.link", has_text="Quit").first.click()
            landed = wait_for(page, "() => (" + ROW_IN_VIEW + ")('Quit')", "the deep link")
            say(f"deep link to Quit: {landed}")
            if not landed["inside"]:
                wrong("the deep link left Quit outside the list's view")

            row = page.locator(".shortcut-list .orden-setting.shortcut", has_text="New note").first
            key = row.locator("button.key")
            key.scroll_into_view_if_needed()
            key.click()
            listening = key.get_attribute("title") or ""
            say(f"recording, the control says: {listening!r}")
            if "Esc" not in listening:
                wrong("the recording control does not say how to stop")
            page.keyboard.press("Control+Alt+Shift+F9")
            page.wait_for_timeout(300)
            shown = key.inner_text()
            say(f"New note now: {shown!r}")
            if "F9" not in shown:
                wrong(f"rebinding did not take: {shown!r}")
            row.locator(".revert").click()

        page.close()

if __name__ == "__main__":
    raise SystemExit(DRIVE.run(drive, "the shortcut list scrolls in its own box"))
