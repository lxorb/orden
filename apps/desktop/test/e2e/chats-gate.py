from __future__ import annotations

from playwright.sync_api import Browser, Page

from harness import Drive, experimental_on

DRIVE = Drive(__file__, dev=True)
say, wrong, shot, wait_for = DRIVE.say, DRIVE.wrong, DRIVE.shot, DRIVE.wait_for

THESIS = "/spaces/Team/thesis.chat"

SEED = """
async () => {
  const { seeded } = await import('/src/lib/chats/view/seed.ts')
  const { useStore } = await import('/src/lib/chats/view/source.svelte.ts')
  useStore(seeded().store)
}
"""

OPEN = """
async (path) => {
  const { openChat } = await import('/src/lib/chats/view/open.ts')
  openChat(path)
}
"""

TABS = "() => window.ordenApp.workspace.tabs.filter((one) => one.kind === 'channel').length"

def switch(page: Page, on: bool) -> None:
    experimental_on(page)
    row = page.locator('[role=switch][aria-label="Chats"]')
    row.wait_for(state="visible", timeout=15_000)
    if (row.get_attribute("aria-checked") == "true") != on:
        row.click()
    wait_for(
        page,
        f"document.querySelector('[role=switch][aria-label=\"Chats\"]')?.getAttribute('aria-checked') === '{str(on).lower()}'",
        "the switch",
    )
    page.wait_for_timeout(300)
    keywords = page.evaluate("() => document.body.textContent.includes('My keywords')")
    if keywords != on:
        wrong(f"with Chats {'on' if on else 'off'}, the chat settings are {'missing' if on else 'shown'}")
    shot(page, f"switch-{'on' if on else 'off'}")
    page.keyboard.press("Escape")
    page.wait_for_timeout(400)


def none_of_it(page: Page, when: str) -> None:
    page.evaluate(OPEN, THESIS)
    page.wait_for_timeout(600)
    if page.evaluate(TABS) or page.query_selector(".chat-tab"):
        wrong(f"{when}: a chat opened")
    if not page.evaluate("() => document.body.textContent.includes('Chats are off. Turn them on in Settings.')"):
        wrong(f"{when}: opening a chat did not say how to turn chats on")
    shot(page, f"none-{when.replace(' ', '-')}")
    say(f"{when}: no chat tab, and opening one says how to turn Chats on")


def drive(browser: Browser) -> None:
    page = DRIVE.page(browser, viewport={"width": 1280, "height": 820})
    DRIVE.open(page)
    page.evaluate(SEED)

    if page.evaluate("() => localStorage.getItem('orden:hidden-kinds')"):
        wrong("a fresh start keeps hidden kinds")
    none_of_it(page, "never turned on")

    switch(page, True)
    page.evaluate(OPEN, THESIS)
    wait_for(page, "document.querySelectorAll('.chat-tab .message').length > 4", "the chat's rows")
    shot(page, "on")
    say("turned on, the chat opens and its settings show")

    switch(page, False)
    wait_for(page, f"({TABS})() === 0 && !document.querySelector('.chat-tab')", "the chat tab to close")
    none_of_it(page, "turned off")

    switch(page, True)
    page.evaluate(OPEN, THESIS)
    wait_for(page, "document.querySelectorAll('.chat-tab .message').length > 4", "the chat again")
    say("turned on again, the chat is back")

    page.reload(wait_until="domcontentloaded")
    DRIVE.ready(page)
    if page.evaluate("() => !JSON.parse(localStorage.getItem('orden:hidden-kinds') || '[]').includes('experimental-chats')"):
        wrong("the switch was not kept through a reload")
    say("still on after a reload")


if __name__ == "__main__":
    raise SystemExit(DRIVE.run(drive, "Chats is off until turned on, and its chats come back when it is"))
