import sys
from playwright.sync_api import Page
from harness import Drive

DRIVE = Drive(__file__, dev=True, chats=True)
say, wrong = DRIVE.say, DRIVE.wrong
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
THESIS = "/spaces/Team/thesis.chat"
START = """
async (empty) => {
  await import('/src/lib/chats-client/src/view/host-here.ts')
  const { seeded } = await import('/src/lib/chats-client/src/view/seed.ts')
  const { useStore } = await import('/src/lib/chats-client/src/view/source.svelte.ts')
  const made = seeded()
  const root = window.ordenApp.workspace.activeSpace?.root
  if (root && !empty) {
    for (const one of made.store.list) made.store.must(one.id).entry = { ...made.store.must(one.id).entry, root }
    made.store.list = made.store.list.map((one) => ({ ...one, root }))
  }
  useStore(made.store)
  window.__chats = made
  const { keepChats } = await import('/src/lib/spaces/src/space-chats.svelte.ts')
  if (root) keepChats(root, true)
}
"""
OPEN = """
async (path) => {
  const { openChat } = await import('/src/lib/chats-client/src/view/open.ts')
  openChat(path)
}
"""
BOX = "document.querySelector('.chat-tab .scroller')"
def wait_for(page: Page, expression: str, what: str, patience: float = 30) -> bool:
    return DRIVE.waited(page, expression, what, patience)
def shot(page: Page, name: str) -> None:
    DRIVE.settled(page)
    page.wait_for_timeout(250)
    DRIVE.shot(page, name)
def begin(page: Page, scheme: str, empty: bool = False, panel: bool = True) -> bool:
    DRIVE.open(page)
    page.evaluate(f"() => window.ordenApp.theme.setScheme('{scheme}')")
    DRIVE.sign_in(page)
    page.evaluate(START, empty)
    if panel:
        page.evaluate("() => window.ordenApp.workspace.showPanel('chats')")
    if empty:
        return wait_for(page, "document.querySelector('.chats .none')", "the empty Chats list")
    page.evaluate(OPEN, THESIS)
    if panel:
        page.evaluate("() => window.ordenApp.workspace.showPanel('chats')")
    return wait_for(page, "document.querySelectorAll('.chat-tab .message').length > 4", "the chat's rows")
def bottom_gap(page: Page) -> float:
    return page.evaluate(f"() => {{ const box = {BOX}; return box.scrollHeight - box.scrollTop - box.clientHeight }}")  # type: ignore[no-any-return]
def desktop(page: Page, scheme: str) -> None:
    if not begin(page, scheme):
        return
    wait_for(page, "document.querySelector('.chats .entry')", "the Chats panel's rows")
    shot(page, f"desk-{scheme}-1-chat")
    page.evaluate(f"() => {{ {BOX}.scrollTop = 0 }}")
    DRIVE.settled(page)
    shot(page, f"desk-{scheme}-2-history")
    page.evaluate(f"() => {{ const box = {BOX}; box.scrollTop = box.scrollHeight }}")
    DRIVE.settled(page)
    page.query_selector_all(".chat-tab .message")[-2].hover()
    wait_for(page, "document.querySelector('.chat-tab .bar[role=toolbar]')", "the hover bar")
    shot(page, f"desk-{scheme}-3-hover")
    emoji = page.locator(".chat-tab .composer .tool[aria-label='Emoji']").bounding_box()
    page.click(".chat-tab .composer .cm-content")
    page.keyboard.type("Thanks @Lu", delay=10)
    wait_for(page, "document.querySelector('.mentions')", "the mention menu")
    moved = page.locator(".chat-tab .composer .tool[aria-label='Emoji']").bounding_box()
    if emoji and moved and abs(emoji["x"] - moved["x"]) > 0.5:
        wrong(f"the emoji button moved {moved['x'] - emoji['x']:.1f}px when typing began")
    shot(page, f"desk-{scheme}-4-typing")
    page.keyboard.press("Enter")
    page.keyboard.type("I'll read it **today**", delay=5)
    page.evaluate("() => { window.__chats.store.delay = 2500 }")
    page.evaluate(f"() => {{ {BOX}.scrollTop = 0 }}")
    DRIVE.settled(page)
    page.keyboard.press("Enter")
    page.wait_for_timeout(120)
    pending = page.evaluate(
        "() => { const row = [...document.querySelectorAll('.chat-tab .message.pending')].at(-1); return row ? { top: row.getBoundingClientRect().top, words: row.textContent } : null }"
    )
    gap = bottom_gap(page)
    say(f"right after Enter: pending {pending and pending['words'][:40]!r}, {gap:.0f}px above the bottom")
    if not pending or "read it" not in pending["words"]:
        wrong("the post did not show at once as a pending row")
    if gap > 8:
        wrong(f"sending from far up left the reader {gap:.0f}px above the new post")
    page.wait_for_timeout(900)
    shot(page, f"desk-{scheme}-5-sending")
    wait_for(page, "!document.querySelector('.chat-tab .message.pending')", "the post to land")
    landed = page.evaluate(
        "() => { const row = [...document.querySelectorAll('.chat-tab .message')].find((one) => one.textContent.includes('read it today')); return row ? row.getBoundingClientRect().top : null }"
    )
    if pending and landed is not None and abs(landed - pending["top"]) > 0.5:
        wrong(f"the post moved {landed - pending['top']:.1f}px when it landed")
    page.evaluate("() => { window.__chats.store.delay = 250 }")
    page.evaluate(f"() => {{ const box = {BOX}; box.scrollTop = box.scrollHeight }}")
    DRIVE.settled(page)
    page.click(".chat-tab .composer .cm-content")
    page.keyboard.press("ArrowUp")
    if wait_for(page, "document.activeElement?.closest('.chat-tab .message.editing') && document.activeElement.tagName === 'TEXTAREA'", "the last post open for editing in place"):
        composer = page.evaluate("() => document.querySelector('.chat-tab .composer .cm-content').textContent")
        if composer.strip():
            wrong(f"editing loaded words into the composer: {composer!r}")
        shot(page, f"desk-{scheme}-5b-editing")
        page.keyboard.press("End")
        page.keyboard.type(" soon", delay=10)
        page.keyboard.press("Enter")
        if wait_for(page, "!document.querySelector('.chat-tab .message.editing') && [...document.querySelectorAll('.chat-tab .message .body')].some((one) => one.textContent.includes('today soon'))", "the edit to land in place"):
            focused = page.evaluate("() => !!document.activeElement?.closest('.chat-tab .composer')")
            if not focused:
                wrong("the composer did not take the focus back after the edit")
    page.evaluate(f"() => {{ {BOX}.scrollTop = 0 }}")
    DRIVE.settled(page)
    if wait_for(page, "document.querySelector('.chat-tab .message .replies')", "a message with replies"):
        page.click(".chat-tab .message .replies")
        wait_for(page, "document.querySelectorAll('aside.replies .message').length >= 3", "the replies")
        shot(page, f"desk-{scheme}-6-replies")
        page.keyboard.press("Escape")
        wait_for(page, "!document.querySelector('aside.replies')", "the replies to close")
    page.evaluate(f"() => {{ {BOX}.scrollTop = 0 }}")
    DRIVE.settled(page)
    page.evaluate("() => window.__chats.store.speak(window.__chats.thesis, 'user:mia', 'Arrived while you read the top')")
    if wait_for(page, "document.querySelector('.chat-tab .jump.below')", "the jump to the newest"):
        shot(page, f"desk-{scheme}-7-unread-below")
        page.click(".chat-tab .jump.below")
        page.wait_for_timeout(900)
        gap = bottom_gap(page)
        if gap > 8:
            wrong(f"the jump to the newest stopped {gap:.0f}px above the bottom")
    page.click(".chats button.orden-row:has-text('Saved')")
    page.wait_for_timeout(300)
    shot(page, f"desk-{scheme}-8-saved")
def empty(page: Page, scheme: str) -> None:
    if begin(page, scheme, empty=True):
        shot(page, f"desk-{scheme}-9-no-chats")
def phone(page: Page, scheme: str) -> None:
    if not begin(page, scheme, panel=False):
        return
    shot(page, f"phone-{scheme}-1-chat")
    page.click(".chat-tab .composer .cm-content")
    page.keyboard.type("On my way", delay=10)
    shot(page, f"phone-{scheme}-2-typing")
    page.evaluate(f"() => {{ {BOX}.scrollTop = 0 }}")
    if wait_for(page, "document.querySelector('.chat-tab .message .replies')", "a message with replies"):
        page.click(".chat-tab .message .replies")
        wait_for(page, "document.querySelectorAll('aside.replies .message').length >= 3", "the replies")
        shot(page, f"phone-{scheme}-3-replies")
        page.keyboard.press("Escape")
    page.evaluate("() => window.ordenApp.workspace.showPanel('chats')")
    if wait_for(page, "document.querySelector('.chats .entry')", "the Chats list on the phone"):
        shot(page, f"phone-{scheme}-4-list")
def main() -> int:
    with DRIVE.session() as browser:
        for scheme in ("light", "dark"):
            page = DRIVE.page(browser, viewport={"width": 1280, "height": 820}, color_scheme=scheme, device_scale_factor=2)
            desktop(page, scheme)
            page.context.close()
            page = DRIVE.page(browser, viewport={"width": 1280, "height": 820}, color_scheme=scheme, device_scale_factor=2)
            empty(page, scheme)
            page.context.close()
            page = DRIVE.page(
                browser,
                viewport={"width": 390, "height": 844},
                color_scheme=scheme,
                has_touch=True,
                is_mobile=True,
                device_scale_factor=2,
            )
            phone(page, scheme)
            page.context.close()
    return DRIVE.verdict("a chat sends at once, follows its reader, edits in place and never shifts")
raise SystemExit(main())
