"""The AI panel's chats across spaces (#332), in a real browser, light and dark.

Emil, 2026-10-13: *"Switching spaces swaps the agent chats in the right sidebar. They
should stay the same across spaces: one list of chats, and the open chat stays open when
the space changes."*

What it proves, and photographs:

* **One list**: a chat kept in each of two spaces, both in the panel's list whichever
  space is in front.
* **The open chat stays**: a long chat open and scrolled to its middle, words typed in
  the field and not sent; the space switched; the same chat is open, at the same place,
  with the same words in the field. And back again.
* **A new chat starts where you are**: New chat in the second space is kept there.

No provider is asked anything: the chats are written into the store as the panel would
have written them, so nothing here needs a network or a key.

    python apps/desktop/test/e2e/ai-chats-spaces.py

Set NIB_SKIP_BUILD=1 to reuse the dev server's last build. Screenshots go beside this
file under `shots/ai-chats-spaces/`.
"""

from __future__ import annotations

from playwright.sync_api import Browser, Page

from harness import Drive

# A dev server, so the drive can write chats through the store's own module.
DRIVE = Drive(__file__, dev=True)
say, wrong, shot = DRIVE.say, DRIVE.wrong, DRIVE.shot

FIELD = ".ask textarea"
TALK = ".ask .talk"

SETUP = """
async () => {
  const ai = window.nibApp.ai
  for (const one of [...ai.providers]) ai.remove(one.id)
  const made = ai.add('compatible')
  ai.update(made.id, { name: 'Fake', baseUrl: 'http://127.0.0.1:9', model: 'fake-small' })
  ai.setDefault(made.id)
  const ws = window.nibApp.workspace
  const work = ws.activeSpaceId
  if (!ws.spaces.some((one) => one.name === 'Home')) await ws.addSpace('Home')
  const home = ws.spaces.find((one) => one.name === 'Home').id
  if (ws.activeSpaceId !== work) await ws.selectSpace(work)
  const { keepThread, newThread } = await import('/src/lib/ai/chat/threads.ts')
  const chat = (space, title, updated, length) => {
    const thread = newThread(space, made.id, 'fake-small')
    thread.title = title
    thread.updated = updated
    thread.turns = Array.from({ length }, (_, at) => ({
      id: `${title}-${at}`,
      role: at % 2 ? 'model' : 'you',
      at: updated - (length - at) * 1000,
      ...(at % 2
        ? { parts: [{ type: 'text', text: `Answer ${at}: ` + 'the heron waits in the shallows. '.repeat(8) }] }
        : { parts: [], draft: { text: `Question ${at} about ${title}?`, attachments: [] } }),
    }))
    return keepThread(thread).then(() => thread.id)
  }
  const plan = await chat(work, 'Quarterly plan', Date.now() - 1000, 24)
  const garden = await chat(home, 'Garden', Date.now() - 5000, 2)
  return { work, home, plan, garden }
}
"""

STATE = """
() => {
  const talk = document.querySelector('.ask .talk')
  return {
    title: document.querySelector('.ask .title')?.textContent?.trim() ?? null,
    field: document.querySelector('.ask textarea')?.value ?? null,
    scroll: talk ? Math.round(talk.scrollTop) : null,
    space: window.nibApp.workspace.activeSpace?.name ?? null,
  }
}
"""


def check(what: str, held: bool) -> None:
    if held:
        say(f"ok   {what}")
    else:
        wrong(what)


def drive(browser: Browser, scheme: str) -> None:
    page: Page = DRIVE.page(browser, viewport={"width": 1280, "height": 820}, color_scheme=scheme)
    DRIVE.open(page)
    made = page.evaluate(SETUP)

    page.evaluate("() => window.nib.focus()")
    page.keyboard.press("Control+Shift+A")
    DRIVE.waited(page, f"document.querySelector('{FIELD}')", "the panel's field")
    page.evaluate("(id) => import('/src/lib/ai/sidebar/chat.svelte.ts').then(({ chat }) => chat.openThread(id, false))", made["plan"])
    DRIVE.waited(page, "document.querySelector('.ask .title')?.textContent?.includes('Quarterly plan')", "the plan open")
    page.wait_for_timeout(400)
    page.evaluate(f"() => {{ const t = document.querySelector('{TALK}'); t.scrollTop = Math.round(t.scrollHeight / 3); t.dispatchEvent(new Event('scroll')) }}")
    page.locator(FIELD).fill("and the budget for the second quarter")
    page.wait_for_timeout(300)
    before = page.evaluate(STATE)
    shot(page, f"{scheme}-1-work")

    page.evaluate("(id) => window.nibApp.workspace.selectSpace(id)", made["home"])
    DRIVE.waited(page, "window.nibApp.workspace.activeSpace?.name === 'Home'", "the other space")
    page.wait_for_timeout(600)
    after = page.evaluate(STATE)
    shot(page, f"{scheme}-2-home")
    check(f"[{scheme}] the space changed: {before['space']} to {after['space']}", before["space"] != "Home" and after["space"] == "Home")
    check(f"[{scheme}] the same chat is open: {after['title']!r}", after["title"] == before["title"] == "Quarterly plan")
    check(f"[{scheme}] the words in the field are still there", after["field"] == "and the budget for the second quarter")
    check(f"[{scheme}] at the same place: {before['scroll']} and {after['scroll']}", before["scroll"] and abs((after["scroll"] or 0) - before["scroll"]) <= 2)

    # The list holds both spaces' chats.
    page.evaluate("() => import('/src/lib/ai/sidebar/chat.svelte.ts').then(({ chat }) => chat.showThreads())")
    DRIVE.waited(page, "document.querySelectorAll('.ask .threads .row, .ask .list .row').length >= 2", "the list")
    titles = page.evaluate("() => [...document.querySelectorAll('.ask .list .row .title')].map((one) => one.textContent.trim())")
    shot(page, f"{scheme}-3-list")
    check(f"[{scheme}] the list is both spaces' chats: {titles}", "Quarterly plan" in titles and "Garden" in titles)
    page.keyboard.press("Escape")
    page.wait_for_timeout(300)

    page.evaluate("(id) => window.nibApp.workspace.selectSpace(id)", made["work"])
    DRIVE.waited(page, "window.nibApp.workspace.activeSpace?.name !== 'Home'", "back to the first space")
    page.wait_for_timeout(500)
    back = page.evaluate(STATE)
    check(f"[{scheme}] and back again, still the same: {back['title']!r}", back["title"] == "Quarterly plan" and back["field"] == "and the budget for the second quarter")

    # A new chat starts in the space in front.
    page.evaluate("(id) => window.nibApp.workspace.selectSpace(id)", made["home"])
    DRIVE.waited(page, "window.nibApp.workspace.activeSpace?.name === 'Home'", "the other space")
    space = page.evaluate("() => import('/src/lib/ai/sidebar/chat.svelte.ts').then(({ chat }) => { chat.newThread(); return chat.thread?.space })")
    check(f"[{scheme}] a new chat starts in the space in front", space == made["home"])
    page.context.close()


def main() -> int:
    with DRIVE.session() as browser:
        for scheme in ("light", "dark"):
            say(f"--- {scheme} ---")
            drive(browser, scheme)
    return DRIVE.verdict("the AI panel's chats are one list, and the open one stays as the space changes")


if __name__ == "__main__":
    raise SystemExit(main())
