from __future__ import annotations

import sys

from playwright.sync_api import Page

from harness import ROOT, Drive

DRIVE = Drive(__file__, dev=True, chats=True)
say, wrong = DRIVE.say, DRIVE.wrong

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

FAKE = f"/@fs{(ROOT / 'packages' / 'chats' / 'src' / 'fake-provider.ts').as_posix()}"
TELEGRAM = f"/@fs{(ROOT / 'packages' / 'chats' / 'src' / 'telegram').as_posix()}"

TELEGRAM_LINK = """
async (where) => {
  const fake = await import(`${where}/fake.ts`)
  const { telegramProvider } = await import(`${where}/index.ts`)
  const { connected } = await import('/src/lib/chats/connected.svelte.ts')
  const { openConversation } = await import('/src/lib/chats/linked.ts')
  const now = Math.floor(Date.now() / 1000)
  const client = new fake.FakeTelegram()
  const mia = fake.user(2, 'Mia', { status: { _: 'userStatusOnline', expires: now + 600 } })
  const team = fake.channel(45, 'Team', { creator: true })
  const toMia = { _: 'peerUser', userId: 2 }
  const toTeam = { _: 'peerChannel', channelId: 45 }
  const thumbs = {
    _: 'messageReactions',
    results: [{ _: 'reactionCount', reaction: { _: 'reactionEmoji', emoticon: '👍' }, count: 1 }],
  }
  const history = {
    u2: [
      fake.text(9, toMia, 2, 'Morning!', { date: now - 900 }),
      fake.text(10, toMia, 2, 'Where do we meet?', { date: now - 600, reactions: thumbs }),
      fake.text(11, toMia, 1, 'At the lab', { date: now - 300, out: true }),
    ],
    s45: [
      fake.text(30, toTeam, 2, 'ship it', { date: now - 200 }),
      fake.text(31, toTeam, 2, 'tests are green', { date: now - 100 }),
    ],
  }
  const keyOf = (peer) =>
    peer._ === 'inputPeerUser' ? `u${peer.userId}` : peer._ === 'inputPeerChannel' ? `s${peer.channelId}` : ''
  client.answer('users.getUsers', () => [client.me])
  client.answer('messages.getDialogs', (request) => ({
    _: 'messages.dialogs',
    dialogs:
      request.folderId === 1
        ? []
        : [fake.dialog(toMia, 11, { unreadCount: 1 }), fake.dialog(toTeam, 31)],
    messages: request.folderId === 1 ? [] : [history.u2[2], history.s45[1]],
    chats: [team],
    users: [mia],
  }))
  client.answer('messages.getHistory', (request) => ({
    _: 'messages.messages',
    messages: [...(history[keyOf(request.peer)] ?? [])].reverse(),
    chats: [team],
    users: [mia, client.me],
  }))
  client.answer('messages.readHistory', () => ({ _: 'messages.affectedMessages', pts: 1, ptsCount: 0 }))
  client.answer('channels.readHistory', () => true)
  client.answer('messages.setTyping', () => true)
  client.answer('messages.sendReaction', () => ({ _: 'updates', updates: [], users: [], chats: [], date: now, seq: 0 }))
  let next = 100
  client.answer('messages.sendMessage', (request) => {
    const id = next++
    return {
      _: 'updates',
      updates: [
        { _: 'updateMessageID', id, randomId: request.randomId },
        {
          _: 'updateNewMessage',
          message: fake.text(id, toMia, 1, request.message, { out: true, date: Math.floor(Date.now() / 1000) }),
          pts: 1,
          ptsCount: 1,
        },
      ],
      users: [],
      chats: [],
      date: now,
      seq: 0,
    }
  })
  const host = new fake.FakeHost()
  host.clock = Date.now()
  host.now = () => Date.now()
  host.replies = [client.code]
  const provider = telegramProvider(async () => client)
  const linked = await connected.link(provider, { ...fake.KEYS, phone: '+41 79 000 00 01' }, host)
  window.__telegram = client
  openConversation({ provider: 'telegram', account: linked.account.id, conversation: 'u2' }, 'Mia')
}
"""

LINK = """
async ([fake, full]) => {
  const made = await import(fake)
  const { connected } = await import('/src/lib/chats/connected.svelte.ts')
  const { openConversation } = await import('/src/lib/chats/linked.ts')
  const host = {
    secret: () => Promise.resolve(null),
    keepSecret: () => Promise.resolve(),
    fetch: (...args) => fetch(...args),
    now: () => Date.now(),
  }
  const provider = full
    ? made.fakeProvider({ id: 'full', name: 'Full' })
    : made.fakeProvider({ id: 'bare', name: 'Bare', can: made.SEND_ONLY, methods: [] })
  const linked = await connected.link(provider, { name: full ? 'everything' : 'little' }, host)
  window.__fake = provider
  openConversation(
    { provider: provider.id, account: linked.account.id, conversation: full ? 'team' : 'ada' },
    full ? 'Team' : 'Ada',
  )
}
"""

SIGNED_OUT = """
async (fake) => {
  const made = await import(fake)
  const { accounts } = await import('/src/lib/chats/linked.ts')
  const provider = made.fakeProvider({ id: 'again', name: 'Again' })
  const connect = provider.connect.bind(provider)
  const asked = []
  provider.connect = (config, host, account) => {
    asked.push({ ...config })
    return connect(config, host, account)
  }
  window.__again = { provider, asked }
  accounts.offer(provider)
  const reason = await accounts.connect('again', { name: 'wren' })
  if (reason) throw new Error(reason)
  provider.world.tell({ t: 'status', status: 'signed-out' })
}
"""

LOOK = """
() => {
  const tab = document.querySelector('.chat-tab')
  const has = (selector) => !!tab?.querySelector(selector)
  const labelled = (label) => !!tab?.querySelector(`[aria-label="${label}"]`)
  return {
    rows: tab?.querySelectorAll('.message').length ?? 0,
    members: labelled('Members'),
    pinned: labelled('Pinned'),
    bell: labelled('Notifications'),
    search: labelled('Search this chat'),
    attach: labelled('Attach something'),
    voice: labelled('Voice message'),
    poll: has('.poll'),
    reactions: has('.reactions'),
    service: has('.head .service'),
  }
}
"""

BAR = """
() => {
  const bar = document.querySelector('.chat-tab .bar')
  if (!bar) return null
  return [...bar.querySelectorAll('button')].map((one) => one.getAttribute('aria-label'))
}
"""

MENU = "() => [...document.querySelectorAll('[role=\"menuitem\"]')].map((one) => one.textContent.trim())"


def wait_for(page: Page, expression: str, what: str, patience: float = 30) -> bool:
    return DRIVE.waited(page, expression, what, patience)


def opened(page: Page, full: bool) -> dict[str, object]:
    DRIVE.open(page)
    page.evaluate("() => window.ordenApp.workspace.showPanel('chats')")
    page.evaluate(LINK, [FAKE, full])
    wait_for(page, "document.querySelectorAll('.chat-tab .message').length > 2", "the conversation's rows")
    DRIVE.settled(page)
    return page.evaluate(LOOK)  # type: ignore[no-any-return]


def hover_bar(page: Page, words: str) -> list[str]:
    row = page.locator(".chat-tab .message", has_text=words).first
    row.hover()
    page.wait_for_timeout(250)
    return page.evaluate(BAR) or []  # type: ignore[no-any-return]


def menu_of(page: Page, words: str) -> list[str]:
    page.locator(".chat-tab .message", has_text=words).first.click(button="right")
    page.wait_for_timeout(250)
    found: list[str] = page.evaluate(MENU)
    page.keyboard.press("Escape")
    page.wait_for_timeout(150)
    return found


def full(page: Page) -> None:
    look = opened(page, True)
    for key in ("members", "pinned", "bell", "search", "attach", "voice", "poll", "reactions", "service"):
        if not look.get(key):
            wrong(f"everything: no {key} in a service that has it")
    bar = hover_bar(page, "Where do we meet?")
    for label in ("Add reaction", "Reply", "Quote", "More"):
        if label not in bar:
            wrong(f"everything: the hover bar lacks {label} ({bar})")
    items = menu_of(page, "Where do we meet?")
    for label in ("Reply", "Quote", "Pin", "Mark unread", "Delete for me"):
        if label not in items:
            wrong(f"everything: the menu lacks {label} ({items})")
    if "Copy link" in items:
        wrong("everything: an Orden link is offered for another service's message")

    page.locator(".chat-tab .message button.replies").first.click()
    if not wait_for(page, "document.querySelector('.chat-tab aside.replies .message')", "the thread"):
        return
    if "At the lab" not in (page.locator(".chat-tab aside.replies").inner_text()):
        wrong("everything: the thread does not hold its reply")
    page.keyboard.press("Escape")

    page.click(".chat-tab .main .composer .cm-content")
    page.keyboard.type("hello from Orden", delay=5)
    page.keyboard.press("Enter")
    if wait_for(page, "[...document.querySelectorAll('.chat-tab .message')].some((one) => one.textContent.includes('hello from Orden') && one.querySelector('.delivery'))", "the sent message with its tick"):
        sent = page.evaluate("() => window.__fake.world.calls.filter((one) => one.method === 'send').length")
        if sent != 1:
            wrong(f"everything: the service was asked to send {sent} times")
    items = menu_of(page, "hello from Orden")
    for label in ("Edit", "Delete for everyone", "Delete for me"):
        if label not in items:
            wrong(f"everything: own new message lacks {label} ({items})")

    page.locator(".chat-tab .poll .answer").first.click()
    if not wait_for(page, "window.__fake.world.calls.some((one) => one.method === 'vote')", "the vote reaching the service"):
        return
    panel = page.evaluate("""() => ({
      rows: document.querySelectorAll('.chats .remote').length,
      archived: !!document.querySelector('.chats .archived'),
      begin: !!document.querySelector('.chats [aria-label="New conversation"]'),
      more: document.querySelectorAll('.chats .remote .more').length,
    })""")
    if panel["rows"] < 2 or not panel["archived"] or not panel["begin"] or panel["more"] < 2:
        wrong(f"everything: the panel lacks rows, the archive, New conversation or row menus ({panel})")
    page.locator(".chats .remote", has_text="Team").locator(".more").click(force=True)
    page.wait_for_timeout(250)
    items = page.evaluate(MENU)
    for label in ("Pin", "Mute", "Archive", "Leave"):
        if label not in items:
            wrong(f"everything: the conversation menu lacks {label} ({items})")
    page.locator('[role="menuitem"]', has_text="Pin").first.click()
    wait_for(page, "!!document.querySelector('.chats .remote .pinned')", "the pinned conversation")
    DRIVE.shot(page, "full")


def bare(page: Page) -> None:
    look = opened(page, False)
    for key in ("members", "pinned", "bell", "search", "attach", "voice", "service"):
        want = key == "service"
        if bool(look.get(key)) != want:
            wrong(f"send only: {key} is {'missing' if want else 'shown'}")
    bar = hover_bar(page, "Hello! Did you see the plan?")
    for label in ("Add reaction", "Reply", "Quote"):
        if label in bar:
            wrong(f"send only: the hover bar offers {label}")
    items = menu_of(page, "Yes, looks good.")
    for label in ("Reply", "Quote", "Pin", "Edit", "Delete", "Delete for me", "Delete for everyone", "Mark unread", "Copy link"):
        if label in items:
            wrong(f"send only: the menu offers {label} ({items})")
    page.click(".chat-tab .main .composer .cm-content")
    page.keyboard.type("just words", delay=5)
    if not page.locator(".chat-tab .composer [aria-label='Send']").count():
        wrong("send only: no Send button")
    page.keyboard.press("Enter")
    wait_for(page, "window.__fake.world.calls.some((one) => one.method === 'send')", "the words reaching the service")
    panel = page.evaluate("""() => ({
      rows: document.querySelectorAll('.chats .remote').length,
      begin: !!document.querySelector('.chats [aria-label="New conversation"]'),
      more: document.querySelectorAll('.chats .remote .more').length,
    })""")
    if panel["rows"] < 2 or panel["begin"] or panel["more"]:
        wrong(f"send only: the panel offers what the service cannot do ({panel})")
    DRIVE.shot(page, "bare")


def telegram(page: Page) -> None:
    DRIVE.open(page)
    page.evaluate("() => window.ordenApp.workspace.showPanel('chats')")
    page.evaluate(TELEGRAM_LINK, TELEGRAM)
    if not wait_for(page, "document.querySelectorAll('.chat-tab .message').length > 2", "Telegram's rows"):
        return
    DRIVE.settled(page)
    look = page.evaluate(LOOK)
    for key in ("bell", "search", "attach", "voice", "reactions", "service"):
        if not look.get(key):
            wrong(f"telegram: no {key} ({look})")
    bar = hover_bar(page, "Where do we meet?")
    for label in ("👍", "❤", "Reply", "Quote", "More"):
        if label not in bar:
            wrong(f"telegram: the hover bar lacks {label} ({bar})")
    if "Add reaction" in bar:
        wrong(f"telegram: the hover bar offers any emoji though Telegram takes only its own ({bar})")
    items = menu_of(page, "Where do we meet?")
    for label in ("Reply", "Quote", "Pin", "Mark unread", "Delete for me"):
        if label not in items:
            wrong(f"telegram: the menu lacks {label} ({items})")
    for label in ("Edit", "Copy link"):
        if label in items:
            wrong(f"telegram: someone else's message offers {label} ({items})")
    items = menu_of(page, "At the lab")
    for label in ("Edit", "Delete for everyone", "Delete for me"):
        if label not in items:
            wrong(f"telegram: own message lacks {label} ({items})")

    page.click(".chat-tab .main .composer .cm-content")
    page.keyboard.type("hello from Orden", delay=5)
    page.keyboard.press("Enter")
    if wait_for(page, "[...document.querySelectorAll('.chat-tab .message')].some((one) => one.textContent.includes('hello from Orden') && one.querySelector('.delivery'))", "the sent Telegram message with its tick"):
        sent = page.evaluate("() => window.__telegram.calls.filter((one) => one._ === 'messages.sendMessage').map((one) => one.message)")
        if sent != ["hello from Orden"]:
            wrong(f"telegram: Telegram was sent {sent}")
    if page.evaluate("() => [...document.querySelectorAll('.chat-tab .message')].filter((one) => one.textContent.includes('hello from Orden')).length") != 1:
        wrong("telegram: the sent message shows more than once")
    items = menu_of(page, "hello from Orden")
    if "Edit" not in items:
        wrong(f"telegram: a message just sent cannot be edited ({items})")

    panel = page.evaluate("""() => ({
      rows: [...document.querySelectorAll('.chats .remote')].map((one) => one.textContent.trim()),
      account: !!document.querySelector('.chats .account'),
      begin: !!document.querySelector('.chats [aria-label="New conversation"]'),
      more: document.querySelectorAll('.chats .remote .more').length,
    })""")
    if not any("Mia" in row for row in panel["rows"]) or not any("Team" in row for row in panel["rows"]):
        wrong(f"telegram: the panel lacks Mia or Team ({panel})")
    if not panel["account"] or not panel["begin"] or panel["more"] < 2:
        wrong(f"telegram: the panel lacks the account, New conversation or row menus ({panel})")

    page.evaluate("() => window.__telegram.state('signed-out')")
    wait_for(page, "[...document.querySelectorAll('.chats .account')].some((one) => one.textContent.includes('Signed out'))", "Telegram's sign-out in the panel")
    DRIVE.shot(page, "telegram")


def signed_out(page: Page) -> None:
    DRIVE.open(page)
    page.evaluate("() => window.ordenApp.workspace.showPanel('chats')")
    page.evaluate(SIGNED_OUT, FAKE)
    if not wait_for(page, "!!document.querySelector('.chats [aria-label=\"Sign in again\"]')", "Sign in again"):
        return
    page.locator('.chats [aria-label="Sign in again"]').first.click()
    if not wait_for(page, "!!document.querySelector('.chats .connect')", "the form to sign in again"):
        return
    form = page.evaluate("""() => ({
      services: document.querySelectorAll('.chats .connect .service').length,
      values: [...document.querySelectorAll('.chats .connect input.orden-field')].map((one) => one.value),
    })""")
    if form["services"] or "wren" not in form["values"]:
        wrong(f"signed out: the form is not for the same account ({form})")
    page.locator(".chats .connect button[type=submit]").click()
    if not wait_for(page, "!document.querySelector('.chats .connect') && !document.querySelector('.chats [aria-label=\"Sign in again\"]')", "the account back"):
        return
    asked = page.evaluate("() => window.__again.asked")
    if asked != [{"name": "wren"}, {"name": "wren"}]:
        wrong(f"signed out: the service was asked to connect with {asked}")
    accounts = page.evaluate("() => document.querySelectorAll('.chats .account').length")
    if accounts != 1:
        wrong(f"signed out: {accounts} accounts are listed after signing in again")
    DRIVE.shot(page, "signed-out")


def main() -> int:
    with DRIVE.session() as browser:
        for name, steps in (("everything", full), ("send only", bare), ("telegram", telegram), ("signed out", signed_out)):
            say(f"-- {name}")
            page = DRIVE.page(browser, viewport={"width": 1280, "height": 820}, reduced_motion="reduce")
            steps(page)
            page.context.close()
    return DRIVE.verdict("all good")


if __name__ == "__main__":
    raise SystemExit(main())
