import json
import os
import sys
import time
from typing import Any

os.environ["ORDEN_APP"] = "chat"
os.environ["TAURI_ENV_PLATFORM"] = "android"
os.environ["ORDEN_WORKER_DIST"] = "dist-chat-worker"
import harness  # noqa: E402
from harness import Drive  # noqa: E402
from playwright.sync_api import Browser, BrowserContext, Page  # noqa: E402

DRIVE = Drive(__file__, served=False)
say, wrong = DRIVE.say, DRIVE.wrong
ORIGIN = harness.worker_origin()
sys.stdout.reconfigure(encoding="utf-8", errors="replace")  # type: ignore[attr-defined]
OWNER, MEMBER = "emil@example.com", "lucile@example.com"
NAMES = {OWNER: "Emil", MEMBER: "Lucile"}
PHONE_AGENT = (
    "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko)"
    " Chrome/140.0.0.0 Mobile Safari/537.36"
)
LIVE = 20
APP = "window.ordenApp"
ROWS = "() => [...document.querySelectorAll('[data-chat-pane=list] .orden-row .orden-row-name, [data-chat-pane=list] .orden-row .name')].map((one) => one.textContent.trim())"
LISTED = f"() => {APP}.chats.list.filter((one) => one.space === {APP}.nav.space).map((one) => one.name)"
BODIES = "() => [...document.querySelectorAll('[data-chat-pane=chat] .message .body')].map((one) => one.textContent.trim())"
COUNT = 0
def post(body: str) -> dict[str, Any]:
    global COUNT  # noqa: PLW0603 - ids of this run
    COUNT += 2
    return {"kind": "post", "id": f"01CHAT{COUNT:020d}", "message": f"01CHAT{COUNT + 1:020d}", "body": body}
def wait(page: Page, script: str, what: str, arg: object = None, patience: float = LIVE) -> Any:
    until = time.monotonic() + patience
    while time.monotonic() < until:
        answer = page.evaluate(script, arg)
        if answer:
            return answer
        page.wait_for_timeout(100)
    wrong(f"gave up waiting for {what}")
    return None
def phone(browser: Browser, token: str) -> tuple[BrowserContext, Page]:
    context = browser.new_context(
        viewport={"width": 390, "height": 844}, user_agent=PHONE_AGENT, has_touch=True, is_mobile=True
    )
    context.add_init_script(f"localStorage.setItem('orden:session', {json.dumps(token)})")
    page = context.new_page()
    page.on("console", lambda message: say(f"console {message.type}: {message.text[:240]}") if message.type == "error" else None)
    page.on("pageerror", lambda error: wrong(f"page error: {error}"))
    page.on("requestfailed", lambda request: "/assets/" in request.url and wrong(f"not loaded: {request.url}"))
    page.goto(ORIGIN, wait_until="domcontentloaded")
    wait(page, f"() => !!{APP} && {APP}.account.signedIn", "the session", patience=40)
    wait(page, f"() => {APP}.chats.ready", "the chats' store", patience=40)
    return context, page
def said_in(worker: harness.Worker, token: str, chat: str) -> list[str]:
    page = worker.request(f"/v2/chats/{chat}/state", token)
    return [one["body"] for one in page.get("messages", [])]
def main() -> int:
    worker = harness.Worker(DRIVE)
    with DRIVE.session() as browser:
        worker.start()
        tokens = {email: worker.account(email) for email in NAMES}
        for email, name in NAMES.items():
            worker.request("/v1/me", tokens[email], {"name": name}, method="PATCH")
        spaces = {}
        for name in ("Team", "Home"):
            spaces[name] = worker.request("/v1/spaces", tokens[OWNER], {"name": name})["space"]["id"]
        worker.request(f"/v1/spaces/{spaces['Team']}/share/invite", tokens[OWNER], {"email": MEMBER, "role": "write"})
        link = worker.waits_for_mail(MEMBER, r"/join/([a-f0-9]+)", "Lucile's invitation").group(1)
        worker.request(f"/v1/join/{link}", tokens[MEMBER], {})
        chats = {}
        for space, name in (("Team", "Team talk"), ("Home", "Diary")):
            chat = worker.request("/v2/chats", tokens[OWNER], {"space": spaces[space]})["chat"]
            worker.request(
                f"/v1/spaces/{spaces[space]}/notes",
                tokens[OWNER],
                {"path": f"{name}.chat", "content": json.dumps({"v": 1, "chat": chat}) + "\n"},
            )
            chats[name] = chat
        first = post("The draft is up")
        worker.request(f"/v2/chats/{chats['Team talk']}/events", tokens[MEMBER], {"events": [first]})
        say(f"Team holds {chats['Team talk']}, Home holds {chats['Diary']}")
        context, page = phone(browser, tokens[OWNER])
        carried = page.evaluate(f"() => Object.keys({APP}).sort()")
        if carried != ["account", "chats", "nav"]:
            wrong(f"this is not the Orden Chat build: its hooks are {carried}")
        if page.evaluate("() => !!document.querySelector('.tabs, .tab-strip, .sidebar, .cm-editor')"):
            wrong("the Chat app drew a workspace part before any chat was open")
        page.evaluate(f"(space) => {APP}.nav.show(space)", spaces["Team"])
        wait(page, f"() => ({LISTED})().includes('Team talk')", "Team's chat in the list")
        listed = page.evaluate(LISTED)
        if listed != ["Team talk"]:
            wrong(f"Team lists {listed}")
        shown = page.evaluate("() => document.querySelector('[data-chat-pane=list]')?.textContent ?? ''")
        if "Team talk" not in shown or "Diary" in shown:
            wrong(f"the list shows: {shown[:200]!r}")
        DRIVE.shot(page, "list")
        page.evaluate(f"(space) => {APP}.nav.show(space)", spaces["Home"])
        wait(page, f"() => ({LISTED})().includes('Diary')", "Home's chat in the list")
        shown = page.evaluate("() => document.querySelector('[data-chat-pane=list]')?.textContent ?? ''")
        if "Diary" not in shown or "Team talk" in shown:
            wrong(f"after switching space the list shows: {shown[:200]!r}")
        page.evaluate(f"(space) => {APP}.nav.show(space)", spaces["Team"])
        wait(page, "() => (document.querySelector('[data-chat-pane=list]')?.textContent ?? '').includes('Team talk')", "Team again")
        page.locator("[data-chat-pane=list]").get_by_text("Team talk", exact=True).first.tap()
        wait(page, "() => document.querySelector('[data-chat-app]')?.dataset.chatApp === 'chat'", "the chat to open")
        wait(page, f"() => ({BODIES})().includes('The draft is up')", "Lucile's earlier message")
        if page.evaluate("() => !!document.querySelector('[data-chat-pane=list]')"):
            wrong("on a phone the list stayed beside the open chat")
        page.locator("[data-chat-pane=chat] .composer .cm-content").tap()
        page.keyboard.type("Hello from the phone", delay=8)
        page.keyboard.press("Enter")
        wait(page, f"() => ({BODIES})().includes('Hello from the phone')", "the message sent to show")
        until = time.monotonic() + LIVE
        while time.monotonic() < until and "Hello from the phone" not in said_in(worker, tokens[MEMBER], chats["Team talk"]):
            time.sleep(0.3)
        if "Hello from the phone" not in said_in(worker, tokens[MEMBER], chats["Team talk"]):
            wrong("the message never reached the account")
        worker.request(f"/v2/chats/{chats['Team talk']}/events", tokens[MEMBER], {"events": [post("Reading it now")]})
        wait(page, f"() => ({BODIES})().includes('Reading it now')", "Lucile's live message")
        DRIVE.shot(page, "chat")
        context.set_offline(True)
        page.wait_for_timeout(300)
        if "The draft is up" not in page.evaluate(BODIES):
            wrong("offline, the messages already loaded went away")
        page.locator("[data-chat-pane=chat] .composer .cm-content").tap()
        page.keyboard.type("Written with no network", delay=8)
        page.keyboard.press("Enter")
        wait(page, f"() => ({BODIES})().includes('Written with no network')", "the offline message to show as waiting")
        if "Written with no network" in said_in(worker, tokens[MEMBER], chats["Team talk"]):
            wrong("a message written offline reached the account while offline")
        context.set_offline(False)
        until = time.monotonic() + 40
        while time.monotonic() < until and "Written with no network" not in said_in(worker, tokens[MEMBER], chats["Team talk"]):
            time.sleep(0.5)
        page.wait_for_timeout(3000)
        sent = said_in(worker, tokens[MEMBER], chats["Team talk"]).count("Written with no network")
        if sent != 1:
            wrong(f"the message written offline is on the account {sent} times")
        else:
            say("a message written offline went out once the network was back, once")
        page.go_back()
        wait(page, "() => document.querySelector('[data-chat-app]')?.dataset.chatApp === 'list'", "Back to show the list")
        opened = page.evaluate(
            f"([link]) => {APP}.nav.follow(link, {APP}.chats.list)",
            [f"orden-chat://chat/{chats['Diary']}?message={first['message']}"],
        )
        state = page.evaluate(f"() => [{APP}.nav.space, {APP}.nav.chat, {APP}.nav.message]")
        if not opened or state != [spaces["Home"], chats["Diary"], first["message"]]:
            wrong(f"a push link opened {state}")
        wait(page, "() => document.querySelector('[data-chat-app]')?.dataset.chatApp === 'chat'", "the linked chat to open")
        context.close()
    return DRIVE.verdict("Orden Chat lists a space's chats, opens one, sends and hears live, and sends what was written offline once")
sys.exit(main())
