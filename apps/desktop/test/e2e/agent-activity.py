from __future__ import annotations

import sys

from playwright.sync_api import Page

from harness import Drive

DRIVE = Drive(__file__, dev=True)
say, wrong = DRIVE.say, DRIVE.wrong
failures = DRIVE.failures
ORIGIN = DRIVE.origin

def wait_for(page: Page, expression: str, what: str, patience: float = 30) -> bool:
    return DRIVE.waited(page, expression, what, patience)

def shot(page: Page, name: str) -> None:
    settle(page)
    DRIVE.shot(page, name)

AGENT = "claude-code"

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

START = """
async () => {
  const { FakeCrate } = await import('/src/lib/agents/ui/fake.ts')
  const { start } = await import('/src/lib/agents/ui/index.ts')
  const fake = new FakeCrate()
  fake.listen(start(fake))
  window.__fake = fake
}
"""

def settle(page: Page) -> None:
    page.evaluate("() => document.fonts.ready")
    page.wait_for_timeout(250)

def fake(page: Page, call: str) -> object:
    return page.evaluate(f"() => window.__fake.{call}")

def drive(page: Page, scheme: str) -> None:
    page.goto(ORIGIN, wait_until="domcontentloaded")
    wait_for(page, "window.nibApp && window.nibApp.workspace.activeSpace", "a space", 120)
    page.evaluate(f"() => window.nibApp.theme.setScheme('{scheme}')")

    tab = page.evaluate(
        "() => window.nibApp.workspace.openPage('https://shop.example/checkout', 'front')"
    )
    wait_for(page, "document.querySelector('.web .card')", "the web tab's card")
    page.evaluate(START)

    fake(page, f"connect('{AGENT}', 'Claude Code')")
    fake(page, f"act('{AGENT}', '{tab}', 'browser_open', {{ url: 'https://shop.example/' }})")
    fake(page, f"act('{AGENT}', '{tab}', 'browser_click')")
    if wait_for(page, "document.querySelector('.web .card.acted')", "the frame round the page"):
        colour = page.evaluate(
            "() => getComputedStyle(document.querySelector('.web .card.acted')).outlineColor"
        )
        if "0, 0, 0, 0" in colour:
            wrong(f"the frame has no colour: {colour}")
    wait_for(page, "document.querySelector('.tab .mark.agent.turning')", "the turning mark")
    shot(page, f"{scheme}-01-acting")

    fake(page, f"stop('{AGENT}')")
    wait_for(page, "document.querySelector('.web .card.acted.resting')", "the muted frame")
    wait_for(page, "document.querySelector('.tab .mark.agent.resting')", "the still mark")
    shot(page, f"{scheme}-02-stopped")
    page.click(".tab .mark.agent")
    if not wait_for(page, "document.querySelector('.tab .mark.agent.turning')", "the mark resumed"):
        say(f"asked: {page.evaluate('() => window.__fake.asked.slice(-3)')}")

    own = page.evaluate(
        f"() => window.__fake.open('{AGENT}', 'https://flights.example/', 'Flights to Lisbon').id"
    )
    fake(page, f"act('{AGENT}', '{own}', 'browser_type')")
    fake(
        page,
        f"ask('{AGENT}', 'paying', 'Place order on shop.example', 'shop.example', '{tab}')",
    )
    page.evaluate("() => window.nibApp.workspace.showPanel('ask')")
    page.evaluate("() => import('/src/lib/ai/sidebar/chat.svelte.ts').then(({ chat }) => chat.showThreads())")
    wait_for(page, f"document.querySelector('.nib-row.agent[data-agent=\"{AGENT}\"]')", "the agent's row")
    row = page.evaluate(
        f"""() => {{
          const row = document.querySelector('.nib-row.agent[data-agent="{AGENT}"]')
          return {{
            name: row.querySelector('.name')?.textContent,
            asking: row.querySelector('.asking')?.textContent,
            badge: row.querySelector('.asks')?.textContent.trim(),
            connected: !!row.querySelector('.connected'),
          }}
        }}"""
    )
    say(f"[row] {row}")
    if row != {
        "name": "Claude Code",
        "asking": "Place order on shop.example",
        "badge": "1",
        "connected": True,
    }:
        wrong(f"the agent's row is {row}")
    shot(page, f"{scheme}-03-list")

    page.click(f".nib-row.agent[data-agent='{AGENT}']")
    wait_for(page, "document.querySelector('section.agent .name')", "the agent's session")
    wait_for(page, "document.querySelector('.agent .question')", "the question")
    page.evaluate("() => import('/src/lib/agents/ui/index.ts').then((ui) => ui.started().readLog())")
    wait_for(page, "document.querySelectorAll('.agent .call').length >= 3", "the session")

    name = page.evaluate("() => document.querySelector('section.agent .name').textContent")
    if name != "Claude Code":
        wrong(f"the session names the agent {name!r}")
    pages = page.evaluate(
        "() => [...document.querySelectorAll('section.agent .tabs .nib-row-label')].map((one) => one.textContent)"
    )
    if pages != ["Flights to Lisbon"]:
        wrong(f"the session lists the agent's own pages as {pages}")
    answers = page.evaluate(
        "() => [...document.querySelectorAll('.agent .question button')].map((b) => b.textContent.trim())"
    )
    if answers != ["Don’t allow", "Allow", "Always on this site"]:
        wrong(f"the question's answers are {answers}")
    shot(page, f"{scheme}-04-session")

    page.click(".agent .question .rows .nib-button:not(.is-quiet)")
    wait_for(page, "!document.querySelector('.agent .question')", "the answered question to go")
    answered = page.evaluate("() => window.__fake.asked.filter((one) => one.command === 'answer')")
    if not answered or answered[-1]["args"][1] is not True:
        wrong(f"Allow sent {answered}")

    fake(
        page,
        f"ask('{AGENT}', 'takeover', 'Sign in to finish the order', 'https://shop.example/', '{tab}')",
    )
    wait_for(page, "document.querySelector('.takeover')", "the takeover's line")
    shot(page, f"{scheme}-05-takeover")
    page.click(".takeover .nib-button")
    wait_for(page, "!document.querySelector('.takeover')", "the step said done")

    fake(page, "pair('Codex')")
    wait_for(page, "document.querySelector('.pairing')", "the pairing bubble")
    words = page.evaluate("() => document.querySelector('.pairing').textContent")
    if "Codex wants to connect" not in words:
        wrong(f"the pairing bubble says {words!r}")
    shot(page, f"{scheme}-06-pairing")

def main() -> int:
    with DRIVE.session() as browser:
        for scheme in ("light", "dark"):
            say(f"-- {scheme}")
            context = browser.new_context(
                viewport={"width": 1280, "height": 800},
                color_scheme=scheme,
                reduced_motion="reduce",
            )
            page = context.new_page()
            errors: list[str] = []
            page.on("pageerror", lambda error: errors.append(str(error)))
            drive(page, scheme)
            for error in errors:
                wrong(f"the page threw: {error}")
            context.close()

    return DRIVE.verdict("all good")

if __name__ == "__main__":
    raise SystemExit(main())
