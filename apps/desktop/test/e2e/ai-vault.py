"""The AI accounts on two devices of one nib account, against the real Worker.

A laptop and a phone are two browsers signed in to the same account, each with its own
storage, so its own secret store and its own device key. A browser keeps its keys in the
vault only once told to, so both are; a third browser, not told, stays out. Docs/ai.md,
"Every device":

- the laptop adds an Anthropic key, and opens the vault without a word as the account's
  first device;
- a browser not told to keep its keys in the vault never asks for them;
- the phone signs in and waits; once the laptop has answered it, it shows six digits in
  Settings > AI;
- the laptop shows the bubble with the same six digits, and Allow gives the phone the key;
- the phone then says the laptop offers it the vault, and takes nothing until Join;
- after Join it has the account and its key, and the account holds no key in the clear;
- a change on the phone reaches the laptop within seconds, through the hub;
- the phone, reloaded, opens at once without asking.

Everything is the real thing: the built web app, the Worker under `wrangler dev`, each
account's hub as a Durable Object and D1 with every migration.

    python apps/desktop/test/e2e/ai-vault.py
"""

from __future__ import annotations

import hashlib
import json
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
#: How long anything live is given to arrive on the other device.
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
    context.add_init_script(f"localStorage.setItem('nib:session', {json.dumps(token)})")
    if vault:
        # What Settings > AI's switch writes; see browserVault in ai/vault/start.svelte.ts.
        context.add_init_script("localStorage.setItem('nib:ai-vault-browser', 'yes')")
    page = context.new_page()
    page.on("pageerror", lambda error: wrong(f"[{label}] page error: {error}"))
    page.goto(ORIGIN, wait_until="domcontentloaded")
    wait(page, "() => !!window.nibApp && window.nibApp.account.signedIn", f"[{label}] the session", 40)
    wait(page, "() => !!window.nibApp.aiVault", f"[{label}] the AI vault handle", 40)
    return context, page


def standing(word: str) -> str:
    """A script answering whether the page's vault stands as `word`."""
    return f"async () => (await window.nibApp.aiVault()).vault.standing === {json.dumps(word)}"


def main() -> int:
    worker = harness.Worker(DRIVE)
    with DRIVE.session() as browser:
        worker.prepare()
        user = str(uuid.uuid4())
        now = int(time.time() * 1000)
        tokens = [uuid.uuid4().hex + uuid.uuid4().hex for _ in range(3)]
        statements = [f"insert into users (id, email, created_at) values ('{user}', 'two@example.com', {now});"]
        for token in tokens:
            digest = hashlib.sha256(token.encode()).hexdigest()
            statements.append(
                "insert into sessions (token_hash, user_id, created_at, expires_at)"
                f" values ('{digest}', '{user}', {now}, {now + 86_400_000});"
            )
        worker.sql("".join(statements))
        worker.start()

        _, laptop = signed_in(browser, tokens[0], "laptop")
        laptop.evaluate(
            """async (key) => {
              const { writeKey } = await window.nibApp.aiVault()
              const made = window.nibApp.ai.add('anthropic')
              window.nibApp.ai.update(made.id, { model: 'claude-opus-5-5' })
              await writeKey(made.id, key)
            }""",
            KEY,
        )
        wait(laptop, standing("open"), "the laptop's vault open", 40)
        check("the account's first device opens without a word", True)

        _, stranger = signed_in(browser, tokens[2], "a browser not told", vault=False)
        stranger.wait_for_timeout(3000)
        check(
            "a browser not told to keep its keys in the vault stays out of it",
            stranger.evaluate(standing("off")) and len(worker.query("select id from ai_devices")) == 1,
        )

        _, phone = signed_in(browser, tokens[1], "phone")
        wait(phone, standing("waiting"), "the phone waiting", 40)
        digits = wait(
            phone,
            "async () => (await window.nibApp.aiVault()).vault.digits",
            "the phone's six digits, once the laptop answered",
            40,
        )
        phone.evaluate("window.nibApp.settings.show('ai')")
        phone.wait_for_selector(f"text={digits}")
        shot(phone, "01-phone-waiting")
        check("the phone waits, its six digits in Settings > AI", bool(digits))

        laptop.wait_for_selector(".approve", timeout=LIVE * 1000)
        bubble = laptop.locator(".approve").inner_text()
        shot(laptop, "02-laptop-asked")
        check("the laptop's bubble names the phone and shows the same digits", digits in bubble)
        laptop.locator(".approve").get_by_role("button", name="Allow", exact=True).click()

        wait(phone, standing("offered"), "the phone offered the vault", LIVE)
        phone.wait_for_selector("text=offers this device your AI vault")
        before = phone.evaluate("() => window.nibApp.ai.accounts.map((one) => one.id)")
        shot(phone, "03-phone-offered")
        check("the phone, offered the vault, takes nothing until Join", before == [])
        phone.get_by_role("button", name="Join", exact=True).click()

        wait(phone, standing("open"), "the phone open", LIVE)
        have = phone.evaluate(
            """async () => {
              const { readSecret } = await window.nibApp.aiVault()
              return { key: await readSecret('anthropic'),
                       ids: window.nibApp.ai.accounts.map((one) => one.id) }
            }"""
        )
        check("the phone has the account", have["ids"] == ["anthropic"])
        check("the phone has the key, in its own secret store", have["key"] == KEY)
        shot(phone, "04-phone-open")

        rows = worker.query("select blob from ai_vaults")
        wraps = worker.query("select wrapped, pub from ai_devices")
        stored = json.dumps(rows) + json.dumps(wraps)
        check("the account holds the vault sealed", len(rows) == 1 and KEY not in stored)
        check("both devices are allowed", len(wraps) == 2 and all(one["wrapped"] for one in wraps))

        phone.evaluate("window.nibApp.ai.update('anthropic', { name: 'Work' })")
        start = time.monotonic()
        wait(laptop, "() => window.nibApp.ai.accounts[0]?.name === 'Work'", "the change on the laptop", LIVE)
        say(f"     a change on the phone reached the laptop in {time.monotonic() - start:.1f} s")
        check("a change on the phone reaches the laptop", True)

        phone.reload(wait_until="domcontentloaded")
        wait(phone, "() => !!window.nibApp && !!window.nibApp.aiVault", "the phone again", 40)
        wait(phone, standing("open"), "the phone open after a reload", 40)
        check("the phone, reloaded, opens without asking", True)
    return DRIVE.verdict("the AI accounts carried from one device to another, end to end")


if __name__ == "__main__":
    raise SystemExit(main())
