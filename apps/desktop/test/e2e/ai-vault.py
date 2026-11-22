import hashlib
import json
import re
import secrets
import sys
import time
import uuid
from typing import Any
from playwright.sync_api import Browser, BrowserContext, Page
import harness
from harness import Drive

DRIVE = Drive(__file__, served=False)
say, wrong, shot = DRIVE.say, DRIVE.wrong, DRIVE.shot
ORIGIN = harness.worker_origin()
sys.stdout.reconfigure(encoding="utf-8", errors="replace")  # type: ignore[attr-defined]
KEY = "sk-ant-drive-" + uuid.uuid4().hex
LIVE = 20
def check(what: str, held: bool) -> None:
    if held:
        say(f"ok   {what}")
    else:
        wrong(what)
def wait(page: Page, script: str, what: str, patience: float = LIVE) -> Any:
    until = time.monotonic() + patience
    while time.monotonic() < until:
        answer = page.evaluate(script)
        if answer:
            return answer
        page.wait_for_timeout(150)
    raise SystemExit(f"gave up waiting for {what}")
def signed_in(
    browser: Browser, token: str, label: str, vault: bool = True
) -> tuple[BrowserContext, Page]:
    context = browser.new_context(viewport={"width": 1180, "height": 760}, reduced_motion="reduce")
    context.add_init_script(f"localStorage.setItem('orden:session', {json.dumps(token)})")
    if vault:
        context.add_init_script("localStorage.setItem('orden:ai-vault-browser', 'yes')")
    page = context.new_page()
    page.on("pageerror", lambda error: wrong(f"[{label}] page error: {error}"))
    page.goto(ORIGIN, wait_until="domcontentloaded")
    wait(page, "() => !!window.ordenApp && window.ordenApp.account.signedIn", f"[{label}] the session", 40)
    wait(page, "() => !!window.ordenApp.aiVault", f"[{label}] the AI vault handle", 40)
    return context, page
def standing(word: str) -> str:
    return f"async () => (await window.ordenApp.aiVault()).vault.standing === {json.dumps(word)}"
ASKED = re.compile(r"wants your AI accounts|offers this device|your AI vault|six digits", re.IGNORECASE)
def asked(page: Page) -> list[str]:
    seen = page.evaluate("() => [...document.querySelectorAll('.orden-bubble, .orden-screen, [role=dialog], [role=alertdialog]')].map((one) => one.innerText.trim()).filter(Boolean)")
    words = page.evaluate("() => document.body.innerText")
    return [one for one in seen if ASKED.search(one)] + [line for line in words.split("\n") if "wants your AI accounts" in line]
def holding(page: Page) -> Any:
    return page.evaluate(
        """async () => {
          const { readSecret } = await window.ordenApp.aiVault()
          return { key: await readSecret('anthropic'), ids: window.ordenApp.ai.accounts.map((one) => one.id) }
        }"""
    )
def main() -> int:
    worker = harness.Worker(DRIVE, {"OPENAI_KEY_SECRET": secrets.token_hex(32)})
    with DRIVE.session() as browser:
        worker.prepare()
        user = str(uuid.uuid4())
        now = int(time.time() * 1000)
        tokens = [uuid.uuid4().hex + uuid.uuid4().hex for _ in range(3)]
        statements = [f"insert into users (id, email, created_at) values ('{user}', 'two@example.com', {now});"]
        for token in tokens:
            digest = hashlib.sha256(token.encode()).hexdigest()
            statements.append(harness.session_row(digest, user, now))
        worker.sql("".join(statements))
        worker.start()
        _, laptop = signed_in(browser, tokens[0], "laptop")
        laptop.evaluate(
            """async (key) => {
              const { writeKey } = await window.ordenApp.aiVault()
              const made = window.ordenApp.ai.add('anthropic')
              window.ordenApp.ai.update(made.id, { model: 'claude-opus-5-5' })
              await writeKey(made.id, key)
            }""",
            KEY,
        )
        wait(laptop, standing("open"), "the laptop's AI accounts open", 40)
        until = time.monotonic() + LIVE
        rows: list[Any] = []
        while time.monotonic() < until and not rows:
            rows = worker.query("select rev, sealed from ai_accounts")
            time.sleep(0.5)
        check("the laptop's accounts reach the server", len(rows) == 1)
        check("the server holds them sealed, the key nowhere in the clear", bool(rows) and KEY not in json.dumps(rows))
        _, stranger = signed_in(browser, tokens[2], "a browser not told", vault=False)
        stranger.wait_for_timeout(3000)
        check("a browser not told to keep its keys with the account stays out", stranger.evaluate(standing("off")) and holding(stranger)["ids"] == [])
        _, phone = signed_in(browser, tokens[1], "phone")
        start = time.monotonic()
        wait(phone, standing("open"), "the phone's AI accounts open", 40)
        wait(phone, "() => window.ordenApp.ai.accounts.some((one) => one.id === 'anthropic')", "the account on the phone", LIVE)
        say(f"     the phone had the account {time.monotonic() - start:.1f} s after sign-in")
        have = holding(phone)
        check("the phone, only signed in, has the account", have["ids"] == ["anthropic"])
        check("the phone has the key, in its own secret store", have["key"] == KEY)
        phone.evaluate("window.ordenApp.settings.show('ai')")
        phone.wait_for_timeout(1500)
        shot(phone, "01-phone-signed-in")
        shot(laptop, "02-laptop-unasked")
        check("the phone shows no prompt, no digits and nothing to join", asked(phone) == [])
        check("the laptop shows no bubble and nobody wants its AI accounts", asked(laptop) == [])
        phone.evaluate("window.ordenApp.ai.update('anthropic', { name: 'Work' })")
        start = time.monotonic()
        wait(laptop, "() => window.ordenApp.ai.accounts[0]?.name === 'Work'", "the change on the laptop", LIVE)
        say(f"     a change on the phone reached the laptop in {time.monotonic() - start:.1f} s")
        check("a change on the phone reaches the laptop", True)
        laptop.evaluate("window.ordenApp.ai.update('anthropic', { name: 'After' })")
        start = time.monotonic()
        wait(phone, "() => window.ordenApp.ai.accounts[0]?.name === 'After'", "the change on the phone", LIVE)
        say(f"     a change on the laptop reached the phone in {time.monotonic() - start:.1f} s")
        check("a change on the laptop reaches the phone", True)
        phone.reload(wait_until="domcontentloaded")
        wait(phone, "() => !!window.ordenApp && !!window.ordenApp.aiVault", "the phone again", 40)
        wait(phone, standing("open"), "the phone open after a reload", 40)
        have = holding(phone)
        check("the phone, reloaded, keeps the account and its key without asking", have["ids"] == ["anthropic"] and have["key"] == KEY and asked(phone) == [])
        shot(phone, "03-phone-reloaded")
    return DRIVE.verdict("the AI accounts carried from one device to another, end to end")
raise SystemExit(main())
