from __future__ import annotations

import json

from harness import Drive
from playwright.sync_api import TimeoutError as PlaywrightTimeout
from settling import quiet

DRIVE = Drive(__file__)
say, wrong, shot = DRIVE.say, DRIVE.wrong, DRIVE.shot

ACCOUNTS = {
    "version": 1,
    "accounts": [
        {"id": "anthropic", "kind": "anthropic", "name": "Work", "model": "claude-opus-5-5"},
        {"id": "anthropic-2", "kind": "anthropic", "name": "", "model": "claude-sonnet-5-5"},
        {"id": "openai", "kind": "openai", "name": "", "model": "gpt-6-astra"},
        {"id": "ollama", "kind": "compatible", "name": "", "baseUrl": "http://localhost:11434", "model": ""},
    ],
    "active": {"claude": "anthropic", "openai": "openai"},
    "defaultVendor": "claude",
    "uses": {},
}

def check(what: str, held: bool) -> None:
    if held:
        say(f"ok   {what}")
    else:
        wrong(what)

def drive(browser) -> None:
    page = DRIVE.page(browser, viewport={"width": 1180, "height": 860}, reduced_motion="reduce")
    page.context.add_init_script(
        f"localStorage.setItem('orden:ai-accounts', {json.dumps(json.dumps(ACCOUNTS))})"
    )
    DRIVE.open(page)
    page.evaluate("window.ordenApp.settings.show('ai')")
    page.wait_for_selector("text=Accounts")
    quiet(page)
    shot(page, "01-accounts")

    sheet = page.locator(".sheet").first
    cards = sheet.locator(".card[data-account]")
    check("every account is a card of its own", cards.count() == len(ACCOUNTS["accounts"]))
    for one in ACCOUNTS["accounts"]:
        card = sheet.locator(f'.card[data-account="{one["id"]}"]')
        check(
            f"{one['id']}'s card holds its own Remove and no Model",
            card.get_by_role("button", name="Remove", exact=True).count() >= 1
            and card.get_by_text("Model", exact=True).count() == 0,
        )
    check("nothing lists models", sheet.get_by_text("List models", exact=True).count() == 0)
    try:
        cards.locator(".mark svg.drawn").nth(3).wait_for(timeout=10_000)
    except PlaywrightTimeout:
        pass
    for account, brand, name in (
        ("anthropic", "claude", "Claude"),
        ("anthropic-2", "claude", "Claude"),
        ("openai", "openai", "OpenAI"),
        ("ollama", "ollama", "OpenAI-compatible"),
    ):
        card = sheet.locator(f'.card[data-account="{account}"]')
        check(
            f"{account}'s card wears {brand}'s logo and names {name}",
            card.locator(f'.mark[data-brand="{brand}"] svg.drawn').count() == 1
            and card.get_by_text(name, exact=True).count() >= 1,
        )
    inked = page.evaluate(
        """() => [...document.querySelectorAll('.card[data-account] .mark svg')].map((one) => {
          const look = getComputedStyle(one)
          return look.fill === look.color
        })"""
    )
    check("the logos are drawn in the text's colour", len(inked) == 4 and all(inked))
    boxed = page.evaluate(
        """() => [...document.querySelectorAll('.card[data-account]')].map((card) => {
          const look = getComputedStyle(card)
          return parseFloat(look.borderTopWidth) > 0 && parseFloat(look.borderTopLeftRadius) > 0 && parseFloat(look.paddingInlineStart) > 0
        })"""
    )
    check("each card is drawn as a card", all(boxed))
    check("only one card is the default", sheet.locator(".card.fallback").count() == 1)
    default = sheet.locator('.card[data-account="anthropic"]')
    check("the default is marked on its card", "fallback" in (default.get_attribute("class") or "") and default.get_by_text("Default", exact=True).count() == 1)
    check(
        "every other card can be made the default",
        all(
            sheet.locator(f'.card[data-account="{one}"]').get_by_role("button", name="Make default").count() == 1
            for one in ("anthropic-2", "openai", "ollama")
        ),
    )
    check("no account says Use or In use", sheet.get_by_role("button", name="Use", exact=True).count() == 0 and sheet.get_by_text("In use", exact=True).count() == 0)
    for gone in ("AI can be wrong", "end-to-end encrypted", "Orden asks you once"):
        check(f"the page no longer says {gone!r}", sheet.get_by_text(gone).count() == 0)
    try:
        sheet.get_by_text("Permissions", exact=True).wait_for(timeout=10_000)
        permissions = True
    except PlaywrightTimeout:
        permissions = False
    check("the task switches sit under Permissions", permissions)
    try:
        sheet.get_by_text("Access", exact=True).first.wait_for(timeout=10_000)
        access = True
    except PlaywrightTimeout:
        access = False
    check("Access is on the same page", access)

    sheet.locator('.card[data-account="anthropic-2"]').get_by_role("button", name="Make default").click()
    quiet(page)
    kept = page.evaluate("JSON.parse(localStorage.getItem('orden:ai-accounts'))")
    check("Make default moved the default to the other account", kept["active"]["claude"] == "anthropic-2" and kept["defaultVendor"] == "claude")
    check("the mark moved with it", (sheet.locator(".card.fallback").get_attribute("data-account") or "") == "anthropic-2")
    sheet.locator('.card[data-account="openai"]').get_by_role("button", name="Make default").click()
    quiet(page)
    kept = page.evaluate("JSON.parse(localStorage.getItem('orden:ai-accounts'))")
    check("OpenAI can be the default too", kept["defaultVendor"] == "openai" and (sheet.locator(".card.fallback").get_attribute("data-account") or "") == "openai")
    shot(page, "02-default-moved")

    check("one Add button, not one per kind", sheet.locator("[data-add-account]").count() == 1 and sheet.get_by_text("Add Claude", exact=True).count() == 0)
    sheet.locator("[data-add-account]").click()
    page.locator("[data-maker]").first.wait_for(timeout=5_000)
    quiet(page)
    shot(page, "03-add-providers")
    makers = page.evaluate("() => [...document.querySelectorAll('[data-maker]')].map((one) => one.dataset.maker)")
    check("Add offers each provider as a tile", makers == ["anthropic", "openai", "google", "compatible"])
    over = page.evaluate(
        """() => {
          const tile = document.querySelector('[data-maker]').getBoundingClientRect()
          const hit = document.elementFromPoint(tile.x + tile.width / 2, tile.y + tile.height / 2)
          return !!hit?.closest('[data-maker]')
        }"""
    )
    check("the add window sits above Settings", over)
    page.locator('[data-maker="anthropic"]').click()
    form = page.locator('[data-step="connect"]')
    form.wait_for(timeout=5_000)
    quiet(page)
    shot(page, "04-add-key")
    check("an Anthropic key asks only for the key", form.locator("input").count() == 1 and form.locator('input[type="password"]').count() == 1)
    form.locator("input").fill("sk-ant-e2e")
    form.locator('button[type="submit"]').click()
    page.wait_for_selector('[data-step="connect"]', state="detached", timeout=5_000)
    quiet(page)
    kinds = page.evaluate("JSON.parse(localStorage.getItem('orden:ai-accounts')).accounts.map((one) => one.kind)")
    check("the key became an account of its own", kinds.count("anthropic") == 3)
    check("the new account is a card too", sheet.locator(".card[data-account]").count() == 5)
    shot(page, "05-added")

    page.evaluate("() => window.ordenApp.settings.hide?.() ?? (window.ordenApp.settings.open = false)")
    page.wait_for_timeout(400)
    page.keyboard.press("Control+Shift+P")
    page.wait_for_selector('input[role="combobox"]')
    page.keyboard.type("AI account")
    quiet(page)
    shot(page, "03-palette")
    rows = page.locator('[role="option"]', has_text="AI account")
    check("the palette offers each Claude account", rows.count() == 3)

    page.keyboard.press("Escape")
    page.evaluate("window.ordenApp.settings.show('agents')")
    quiet(page)
    check("an old link to Agents lands on AI", page.locator(".sheet").get_by_text("Accounts", exact=True).count() == 1)

if __name__ == "__main__":
    raise SystemExit(DRIVE.run(drive, "settings > ai holds several accounts of a provider"))
