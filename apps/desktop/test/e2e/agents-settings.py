"""Settings > Agents, over the crate's stand-in, in light, dark and Arabic.

A browser has no crate, so the drive puts `agents/settings/fake.ts` in front of the
pane (`window.nibApp.agents.standIn()`), filled the way a week of use would be: two
of the reader's own clients and a script given a token. Then, in each of the three
looks, it opens the pane and photographs the list, one agent from the top to the
foot, and one session opened as its calls.

What it checks on the way, and fails on: the trifecta line is on the agent that reads
notes and browses, and not on the one that does not; a switch pressed is in the
crate's grant, and so is what it needs; a site typed as an address is kept as its
site; the browser's memory has no limit until one is set, and one set is in the grant
(#333); a right-to-left language turns the pane round.

From the repository root; the harness builds the app with its handle on the page
the first time and serves it (see harness.py):

    python apps/desktop/test/e2e/agents-settings.py

Screenshots go beside this file under `shots/agents-settings/`, which is ignored.
"""

from __future__ import annotations

from harness import Drive
from settling import quiet

DRIVE = Drive(__file__)
say, wrong, shot = DRIVE.say, DRIVE.wrong, DRIVE.shot

DESKTOP_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko)"
    " Chrome/140.0.0.0 Safari/537.36"
)

# The three looks: the scheme, and the language the interface is in.
LOOKS = [("light", "en"), ("dark", "en"), ("light", "ar")]

OPEN = """
async () => {
  window.agentsFake = window.nibApp.agents.standIn()
  window.nibApp.settings.show('agents')
}
"""

GRANT = """
(id) => JSON.parse(JSON.stringify(window.agentsFake.grants.find((one) => one.id === id)))
"""

def check(what: str, held: bool) -> None:
    if held:
        say(f"ok   {what}")
    else:
        wrong(what)


def switch(page, name: str) -> None:
    """Presses the switch of that name, brought to the middle of the column first. A
    click scrolls what it presses into view by itself in Chromium; in WebKit it did not
    reach into the sheet's column, so the press landed below the window, on nothing,
    and the switch never moved. Then until the switch says it moved, which is the
    grant written back through the crate's stand-in and drawn again: on a busy runner
    in WebKit that was now and then more than the 200 ms the drive used to give it."""
    row = page.locator(".agents [role=switch]", has_text=name)
    row.evaluate("(one) => one.scrollIntoView({ block: 'center', behavior: 'instant' })")
    quiet(page)
    was = row.get_attribute("aria-checked")
    row.click()
    moved = row.evaluate(
        "(one, was) => new Promise((done) => { const at = Date.now(); const look = () =>"
        " one.getAttribute('aria-checked') !== was ? done(true) : Date.now() - at > 5000 ?"
        " done(false) : setTimeout(look, 50); look() })",
        was,
    )
    if not moved:
        say(f"     the switch {name!r} did not move when pressed")


def body_to(page, where: str) -> None:
    """Scrolls the pane's column to the top, the middle or the foot."""
    page.evaluate(
        """(where) => {
          const body = document.querySelector('.sheet .body')
          if (!body) return
          const end = body.scrollHeight - body.clientHeight
          body.scrollTop = where === 'top' ? 0 : where === 'middle' ? end / 2 : end
        }""",
        where,
    )
    quiet(page)


MEMORY = ".agents .nib-setting.sliding:has-text('Browser memory limit')"

SLIDE = """
([label, value]) => {
  const row = [...document.querySelectorAll('.agents .nib-setting.sliding')].find(
    (one) => one.querySelector('.name')?.textContent?.trim() === label,
  )
  const range = row.querySelector('input[type=range]')
  range.value = String(value)
  range.dispatchEvent(new Event('input', { bubbles: true }))
  range.dispatchEvent(new Event('change', { bubbles: true }))
}
"""


def memory_limit(page, name: str) -> None:
    """#333: there was a 3 GB ceiling on the browser for every agent. The row starts at
    Off, which is no ceiling, and a limit the reader sets is in the grant, and can be
    taken away again."""
    row = page.locator(MEMORY)
    row.scroll_into_view_if_needed()
    quiet(page)
    # The words in the row, not what is drawn of them: WebKit has no innerText for a
    # row its scroller has not drawn yet, and Chromium does (#384).
    said = lambda: (row.locator(".value").text_content() or "").strip()  # noqa: E731
    check(f"[{name}] the memory limit starts Off", said() == "Off")
    check(f"[{name}] and the grant holds no ceiling", page.evaluate(GRANT, "claude-code")["limits"]["memory"] == 0)
    page.evaluate(SLIDE, ["Browser memory limit", 4096])
    page.wait_for_timeout(200)
    quiet(page)
    check(f"[{name}] a limit set is in the grant", page.evaluate(GRANT, "claude-code")["limits"]["memory"] == 4096)
    check(f"[{name}] and its row says it", said() == "4 GB")
    shot(page, f"{name}-memory-limit")
    page.evaluate(SLIDE, ["Browser memory limit", 0])
    page.wait_for_timeout(200)
    check(f"[{name}] and taken away again", page.evaluate(GRANT, "claude-code")["limits"]["memory"] == 0)


def look(browser, scheme: str, language: str) -> None:
    name = f"{scheme}-{language}"
    page = DRIVE.page(
        browser,
        errors=False,
        viewport={"width": 1280, "height": 860},
        user_agent=DESKTOP_AGENT,
        color_scheme=scheme,
        reduced_motion="reduce",
        device_scale_factor=2,
    )
    context = page.context
    context.add_init_script(f"localStorage.setItem('nib:language', {language!r})")
    page.set_default_timeout(8000)
    page.on("pageerror", lambda error: say(f"[{name}] page error: {error}"))
    page.on("console", lambda said: say(f"[{name}] {said.type}: {said.text[:200]}") if said.type == "error" else None)
    try:
        DRIVE.open(page)
    except SystemExit:
        shot(page, f"{name}-stuck")
        raise
    DRIVE.wait_for(page, "window.nibApp.agents", "the agents")

    page.evaluate(OPEN)
    page.wait_for_selector(".agents .agent")
    quiet(page)

    def photograph(tag: str) -> None:
        shot(page, f"{name}-{tag}")

    rows = page.locator(".agents .agent").count()
    check(f"[{name}] the list holds the three agents", rows == 3)
    direction = page.evaluate("() => document.documentElement.dir || 'ltr'")
    check(
        f"[{name}] the interface reads {'right to left' if language == 'ar' else 'left to right'}",
        direction == ("rtl" if language == "ar" else "ltr"),
    )
    photograph("list")

    # Codex was granted no browser: no trifecta.
    page.locator(".agents .agent", has_text="Codex").click()
    page.wait_for_selector(".agents .who")
    quiet(page)
    check(f"[{name}] no trifecta line on an agent with no browser", page.locator(".trifecta").count() == 0)
    page.locator(".agents .back").click()
    page.wait_for_selector(".agents .agent")
    quiet(page)

    page.locator(".agents .agent", has_text="Claude Code").click()
    page.wait_for_selector(".agents .who")
    quiet(page)
    check(f"[{name}] the trifecta line is on the agent that reads and browses", page.locator(".trifecta").count() == 1)
    body_to(page, "top")
    photograph("agent-top")

    page.locator(".agents .session").first.click()
    page.wait_for_selector(".agents .calls li")
    quiet(page)
    photograph("session")
    page.locator(".agents .session").first.click()
    quiet(page)

    if language == "en":
        # A switch pressed is in the crate, with what it needs: scripts need a browser,
        # and Claude Code's is on, so scripts alone come on.
        switch(page, "Run scripts in pages")
        page.wait_for_timeout(200)
        grant = page.evaluate(GRANT, "claude-code")
        check(f"[{name}] a switch pressed is in the crate's grant", "browser.script" in grant["scopes"])

        # Turning the reader's tabs off takes their cookies with them.
        switch(page, "Read your cookies")
        page.wait_for_timeout(200)
        switch(page, "Act in your tabs")
        page.wait_for_timeout(200)
        grant = page.evaluate(GRANT, "claude-code")
        check(
            f"[{name}] what needed a scope goes with it",
            "browser.reader" not in grant["scopes"] and "browser.storage" not in grant["scopes"],
        )

        # A site typed as an address from the bar is kept as its site. The Sites card's
        # own field, named by its heading: counting fields found the terminal's list of
        # programs instead, once the agent's terminal was on and drew it above.
        field = page.locator(".agents h3:text-is('Sites') + .card .add")
        field.press_sequentially("https://login.bank2.example/sign-in?next=/")
        field.press("Enter")
        page.wait_for_function(
            "() => !!window.agentsFake.grants.find((one) => one.id === 'claude-code').sites['bank2.example']"
        )
        grant = page.evaluate(GRANT, "claude-code")
        check(f"[{name}] a typed address is kept as its site", grant["sites"].get("bank2.example") == "deny")

        memory_limit(page, name)

    body_to(page, "middle")
    photograph("agent-middle")
    body_to(page, "foot")
    photograph("agent-foot")

    context.close()


def drive(browser) -> None:
    for scheme, language in LOOKS:
        look(browser, scheme, language)


def main() -> int:
    return DRIVE.run(drive, "Settings > Agents held in all three looks")


if __name__ == "__main__":
    raise SystemExit(main())
