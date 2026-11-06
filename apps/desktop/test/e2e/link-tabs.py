from __future__ import annotations


from harness import Drive

DRIVE = Drive(__file__)
say, wrong = DRIVE.say, DRIVE.wrong
failures = DRIVE.failures
SHOTS = DRIVE.shots


DESKTOP_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko)"
    " Chrome/140.0.0.0 Safari/537.36"
)

NOTE = (
    "# Kestrel notes\\n\\n"
    "The bird is written up at [Svelte](https://svelte.dev/docs) and the keeper is "
    "at [the keeper](mailto:keeper@example.com).\\n"
)

SEED = f"""
async () => {{
  const ws = window.nibApp.workspace
  await ws.noteFrom('{NOTE}', undefined)
  const first = ws.files.find((one) => one.name.startsWith('Kestrel'))
  if (first) await ws.openEntry(first.path, {{ activate: true }})
  return ws.tabs.length
}}
"""

STATE = """
() => {
  const ws = window.nibApp.workspace
  return {
    tabs: ws.tabs.map((one) => ({ kind: one.kind, address: one.address ?? null })),
    active: ws.active ? { kind: ws.active.kind, address: ws.active.address ?? null } : null,
  }
}
"""

CATCH = """
() => {
  window.__left = []
  const was = window.open
  window.open = (url) => {
    window.__left.push(String(url))
    return null
  }
  window.__unwrap = () => { window.open = was }
}
"""

LEFT = "() => window.__left"


def web_tabs(state: dict) -> list[str]:
    return [one["address"] or "" for one in state["tabs"] if one["kind"] == "web"]


def close_pages(page) -> None:
    page.evaluate(
        """
        () => {
          const ws = window.nibApp.workspace
          for (const one of [...ws.tabs]) if (one.kind === 'web') ws.close(one.id)
        }
        """
    )
    page.wait_for_timeout(250)


def press(page, selector: str, *, modifiers=(), button="left") -> None:
    page.locator(selector).first.click(modifiers=list(modifiers), button=button)
    page.wait_for_timeout(400)


def in_the_note(page) -> None:
    say("--- a link in a note ---")

    link = ".nib-link[data-href]"
    if not page.locator(link).count():
        wrong("the note drew no link to press")
        return

    press(page, link, modifiers=["Control"])
    state = page.evaluate(STATE)
    if web_tabs(state) != ["https://svelte.dev/docs"]:
        wrong(f"Ctrl+click made no web tab: {state}")
    elif state["active"]["kind"] != "note":
        wrong(f"Ctrl+click took the reader off their note: {state['active']}")
    else:
        say("Ctrl+click            -> a page in the strip, the note still in front")
    page.screenshot(path=str(SHOTS / "behind.png"))
    close_pages(page)

    press(page, link, button="middle")
    state = page.evaluate(STATE)
    if web_tabs(state) != ["https://svelte.dev/docs"]:
        wrong(f"the middle button made no web tab: {state}")
    elif state["active"]["kind"] != "note":
        wrong(f"the middle button took the reader off their note: {state['active']}")
    else:
        say("middle-click          -> the same, with a different finger")
    close_pages(page)

    press(page, link, modifiers=["Control", "Shift"])
    state = page.evaluate(STATE)
    if state["active"]["address"] != "https://svelte.dev/docs":
        wrong(f"Ctrl+Shift+click did not open the page in front: {state}")
    else:
        say("Ctrl+Shift+click      -> the page, in front")
    page.screenshot(path=str(SHOTS / "in-front.png"))
    close_pages(page)


def an_email(page) -> None:
    say("--- what is not a page ---")

    mail = '.nib-link[data-href^="mailto:"]'
    if not page.locator(mail).count():
        wrong("the note drew no mailto link to press")
        return

    page.evaluate(CATCH)
    press(page, mail, modifiers=["Control"])
    state = page.evaluate(STATE)
    left = page.evaluate(LEFT)
    page.evaluate("() => window.__unwrap()")

    if web_tabs(state):
        wrong(f"an email address became a tab: {state}")
    elif left != ["mailto:keeper@example.com"]:
        wrong(f"the email address did not leave for the system: {left}")
    else:
        say("Ctrl+click on mailto: -> left for the system, no tab made")
    close_pages(page)


def the_menu(page) -> None:
    say("--- a right click on a link ---")

    page.locator(".nib-link[data-href^='https']").first.click(button="right")
    page.wait_for_timeout(400)
    rows = page.evaluate(
        """
        () => [...document.querySelectorAll('.menu [role="menuitem"]')]
          .map((one) => one.textContent.trim())
        """
    )
    if not rows or rows[0] != "Open in the browser":
        wrong(f"the link's menu did not offer the browser first: {rows[:3]}")
    else:
        say("right click           -> 'Open in the browser' at the top")

    box = page.locator('.menu [role="menuitem"]').first.bounding_box()
    if box is None or box["y"] < 0 or box["y"] + box["height"] > 900:
        wrong(f"the first row of the menu is off the window: {box}")
    else:
        say("and in the window     -> the rows scroll rather than hang off the top")
    page.screenshot(path=str(SHOTS / "menu.png"))

    page.keyboard.press("Escape")
    page.wait_for_timeout(300)

    page.locator(".cm-content p, .cm-line").first.click(button="right")
    page.wait_for_timeout(400)
    rows = page.evaluate(
        """
        () => [...document.querySelectorAll('.menu [role="menuitem"]')]
          .map((one) => one.textContent.trim())
        """
    )
    if rows and rows[0] == "Open in the browser":
        wrong("the browser row appeared on words that are not a link")
    else:
        say("right click on words  -> no browser row, because there is no link")
    page.keyboard.press("Escape")
    page.wait_for_timeout(300)


def a_locked_note(page) -> None:
    say("--- a locked note ---")

    page.evaluate("() => window.nibApp.modes.toggleReadOnly(undefined)")
    page.wait_for_timeout(400)

    press(page, ".nib-link[data-href^='https']")
    state = page.evaluate(STATE)
    if state["active"]["address"] != "https://svelte.dev/docs":
        wrong(f"a plain click in a locked note did not open the page in front: {state}")
    else:
        say("plain click           -> the page, in front")
    close_pages(page)

    page.evaluate("() => window.nibApp.modes.toggleReadOnly(undefined)")
    page.wait_for_timeout(400)


def the_reading_view(page) -> None:
    say("--- the reading view ---")

    page.evaluate("() => window.nibApp.workspace.toggleReading()")
    page.wait_for_timeout(700)

    anchor = '.read a[href^="https"]'
    if not page.locator(anchor).count():
        wrong("the reading view drew no link to press")
        return

    press(page, anchor)
    state = page.evaluate(STATE)
    if state["active"]["address"] != "https://svelte.dev/docs":
        wrong(f"a plain click in the reading view did not open the page in front: {state}")
    else:
        say("plain click           -> the page, in front")
    page.screenshot(path=str(SHOTS / "reading.png"))
    close_pages(page)

    press(page, anchor, modifiers=["Control"])
    state = page.evaluate(STATE)
    if web_tabs(state) != ["https://svelte.dev/docs"]:
        wrong(f"Ctrl+click in the reading view made no web tab: {state}")
    elif state["active"]["kind"] != "note":
        wrong(f"Ctrl+click in the reading view moved the reader: {state['active']}")
    else:
        say("Ctrl+click            -> a page in the strip, the reading still in front")
    close_pages(page)

    press(page, anchor, button="middle")
    state = page.evaluate(STATE)
    if web_tabs(state) != ["https://svelte.dev/docs"]:
        wrong(f"the middle button in the reading view made no web tab: {state}")
    elif state["active"]["kind"] != "note":
        wrong(f"the middle button in the reading view moved the reader: {state['active']}")
    else:
        say("middle-click          -> the same, with a different finger")
    close_pages(page)

    page.evaluate(CATCH)
    press(page, anchor, modifiers=["Shift"])
    state = page.evaluate(STATE)
    left = page.evaluate(LEFT)
    page.evaluate("() => window.__unwrap()")

    if state["active"]["address"] != "https://svelte.dev/docs":
        wrong(f"Shift+click in the reading view did not open the page in front: {state}")
    elif left:
        wrong(f"Shift+click handed the page to the system browser: {left}")
    else:
        say("Shift+click           -> the page, in front, and nothing left the app")
    close_pages(page)

    page.evaluate("() => window.nibApp.workspace.toggleReading()")
    page.wait_for_timeout(500)


def drive(browser) -> None:
    SHOTS.mkdir(parents=True, exist_ok=True)

    context = browser.new_context(
        viewport={"width": 1440, "height": 900},
        user_agent=DESKTOP_AGENT,
        color_scheme="dark",
    )
    page = context.new_page()
    page.set_default_timeout(8000)
    page.on("pageerror", lambda error: wrong(f"page error: {error}"))
    DRIVE.open(page)
    page.wait_for_timeout(900)

    say(f"{page.evaluate(SEED)} tab(s) open")
    page.wait_for_timeout(600)

    in_the_note(page)
    the_menu(page)
    an_email(page)
    a_locked_note(page)
    the_reading_view(page)

    page.screenshot(path=str(SHOTS / "after.png"))
    context.close()


def main() -> int:
    with DRIVE.session() as browser:
        drive(browser)

    return DRIVE.verdict("everything the drive checked was right")


if __name__ == "__main__":
    raise SystemExit(main())
