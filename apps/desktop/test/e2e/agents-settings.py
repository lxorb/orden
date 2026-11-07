from __future__ import annotations

from harness import Drive
from settling import quiet

DRIVE = Drive(__file__)
say, wrong, shot = DRIVE.say, DRIVE.wrong, DRIVE.shot

DESKTOP_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko)"
    " Chrome/140.0.0.0 Safari/537.36"
)

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

STANDING = """
(one) => new Promise((done) => {
  const started = Date.now()
  let was = ''
  let same = 0
  const look = () => {
    const box = one.getBoundingClientRect()
    const at = [box.x + box.width / 2, box.y + box.height / 2]
    same = String(at) === was ? same + 1 : 0
    was = String(at)
    const found = one.contains(document.elementFromPoint(at[0], at[1]))
    if (same >= 6 && found) done(at)
    else if (Date.now() - started > 5000) done(null)
    else setTimeout(look, 30)
  }
  look()
})
"""

def press(page, row) -> None:
    row.evaluate("(one) => one.scrollIntoView({ block: 'center', behavior: 'instant' })")
    quiet(page)
    at = row.evaluate(STANDING)
    if at is None:
        raise SystemExit(f"nothing to press: {row} never stood still with nothing over it")
    page.mouse.click(*at)

def choose(page, name: str) -> None:
    press(page, page.locator(".agents .agent", has_text=name))
    page.wait_for_function(
        "(name) => document.querySelector('.agents .who input.title')?.value === name",
        arg=name,
    )

def switch(page, name: str) -> None:
    row = page.locator(".agents [role=switch]", has_text=name)
    was = row.get_attribute("aria-checked")
    press(page, row)
    moved = row.evaluate(
        "(one, was) => new Promise((done) => { const at = Date.now(); const look = () =>"
        " one.getAttribute('aria-checked') !== was ? done(true) : Date.now() - at > 5000 ?"
        " done(false) : setTimeout(look, 50); look() })",
        was,
    )
    if not moved:
        say(f"     the switch {name!r} did not move when pressed")

def body_to(page, where: str) -> None:
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

MEMORY = ".agents .orden-setting.sliding:has-text('Browser memory limit')"

SLIDE = """
([label, value]) => {
  const row = [...document.querySelectorAll('.agents .orden-setting.sliding')].find(
    (one) => one.querySelector('.name')?.textContent?.trim() === label,
  )
  const range = row.querySelector('input[type=range]')
  range.value = String(value)
  range.dispatchEvent(new Event('input', { bubbles: true }))
  range.dispatchEvent(new Event('change', { bubbles: true }))
}
"""

def memory_limit(page, name: str) -> None:
    row = page.locator(MEMORY)
    row.scroll_into_view_if_needed()
    quiet(page)
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
    context.add_init_script(f"localStorage.setItem('orden:language', {language!r})")
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

    choose(page, "Codex")
    quiet(page)
    check(f"[{name}] no trifecta line on an agent with no browser", page.locator(".trifecta").count() == 0)
    page.locator(".agents .back").click()
    page.wait_for_selector(".agents .agent")
    quiet(page)

    choose(page, "Claude Code")
    quiet(page)
    check(f"[{name}] the trifecta line is on the agent that reads and browses", page.locator(".trifecta").count() == 1)
    body_to(page, "top")
    photograph("agent-top")

    page.locator(".agents .session").first.click()
    page.wait_for_selector(".agents .calls li")
    quiet(page)
    photograph("session")
    page.locator(".agents .session").first.click()
    page.wait_for_selector(".agents .calls", state="detached")
    quiet(page)

    if language == "en":
        check(f"[{name}] an MCP client says it manages its own permissions", page.locator(".agents .connected").count() == 1)
        check(f"[{name}] and has no switch of them", page.locator(".agents [role=switch]", has_text="Run scripts in pages").count() == 0)
        sidebar = page.evaluate("() => { const one = window.agentsFake.pair('Orden · Claude'); return { id: one.id, name: one.name } }")
        page.locator(".agents .back").click()
        page.wait_for_selector(".agents .agent")
        quiet(page)
        choose(page, sidebar["name"])
        quiet(page)

        switch(page, "Run scripts in pages")
        page.wait_for_timeout(200)
        grant = page.evaluate(GRANT, sidebar["id"])
        check(f"[{name}] a switch pressed is in the crate's grant", "browser.script" in grant["scopes"])

        switch(page, "Read your cookies")
        page.wait_for_timeout(200)
        switch(page, "Act in your tabs")
        page.wait_for_timeout(200)
        grant = page.evaluate(GRANT, sidebar["id"])
        check(
            f"[{name}] what needed a scope goes with it",
            "browser.reader" not in grant["scopes"] and "browser.storage" not in grant["scopes"],
        )
        page.locator(".agents .back").click()
        page.wait_for_selector(".agents .agent")
        quiet(page)
        choose(page, "Claude Code")
        quiet(page)

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
