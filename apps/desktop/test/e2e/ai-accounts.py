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
    page.evaluate("window.nibApp.settings.show('ai')")
    page.wait_for_selector("text=Accounts")
    quiet(page)
    shot(page, "01-accounts")

    sheet = page.locator(".sheet")
    cards = sheet.locator(".card[data-account]")
    check("every account is a card of its own", cards.count() == len(ACCOUNTS["accounts"]))
    for one in ACCOUNTS["accounts"]:
        card = sheet.locator(f'.card[data-account="{one["id"]}"]')
        check(
            f"{one['id']}'s card holds its own Remove and Model",
            card.get_by_role("button", name="Remove", exact=True).count() >= 1
            and card.get_by_text("Model", exact=True).count() == 1,
        )
    check("each provider has its name over its cards", sheet.locator("[data-vendor]").count() == 3)
    try:
        sheet.locator("[data-vendor] .mark svg.drawn").nth(2).wait_for(timeout=10_000)
    except PlaywrightTimeout:
        pass
    for vendor, brand in (("claude", "claude"), ("openai", "openai"), ("ollama", "ollama")):
        mark = sheet.locator(f'[data-vendor="{vendor}"] .mark[data-brand="{brand}"]')
        check(f"{vendor} wears {brand}'s logo beside its name", mark.locator("svg.drawn").count() == 1)
    inked = page.evaluate(
        """() => [...document.querySelectorAll('[data-vendor] .mark svg')].map((one) => {
          const look = getComputedStyle(one)
          return look.fill === look.color
        })"""
    )
    check("the logos are drawn in the text's colour", len(inked) == 3 and all(inked))
    adding = sheet.locator("button.nib-action", has_text="Add")
    check(
        "every Add wears its provider's mark",
        adding.count() > 0 and adding.locator(".mark").count() == adding.count(),
    )
    check("the provider keeps its Default", sheet.locator('[data-vendor="claude"]').get_by_text("Default", exact=True).count() == 1)
    check("OpenAI keeps its Make default", sheet.locator('[data-vendor="openai"]').get_by_role("button", name="Make default").count() == 1)
    boxed = page.evaluate(
        """() => [...document.querySelectorAll('.card[data-account]')].map((card) => {
          const look = getComputedStyle(card)
          return parseFloat(look.borderTopWidth) > 0 && parseFloat(look.borderTopLeftRadius) > 0 && parseFloat(look.paddingInlineStart) > 0
        })"""
    )
    check("each card is drawn as a card", all(boxed))
    in_use = sheet.locator('.card[data-account="anthropic"]')
    check("the account in use is marked on its card", "using" in (in_use.get_attribute("class") or "") and in_use.get_by_text("In use", exact=True).count() == 1)
    check("only one card is marked", sheet.locator(".card.using").count() == 1)
    check("the other can be switched to", sheet.locator('.card[data-account="anthropic-2"]').get_by_role("button", name="Use", exact=True).count() == 1)
    try:
        sheet.get_by_text("Access", exact=True).first.wait_for(timeout=10_000)
        access = True
    except PlaywrightTimeout:
        access = False
    check("Access is on the same page", access)

    sheet.get_by_role("button", name="Use", exact=True).click()
    quiet(page)
    active = page.evaluate("JSON.parse(localStorage.getItem('orden:ai-accounts')).active.claude")
    check("Use moved Claude to the other account", active == "anthropic-2")
    check("the mark moved with it", (sheet.locator(".card.using").get_attribute("data-account") or "") == "anthropic-2")
    shot(page, "02-switched")

    page.keyboard.press("Escape")
    page.wait_for_selector(".sheet", state="detached")
    page.keyboard.press("Control+Shift+P")
    page.wait_for_selector('input[role="combobox"]')
    page.keyboard.type("AI account")
    quiet(page)
    shot(page, "03-palette")
    rows = page.locator('[role="option"]', has_text="AI account")
    check("the palette offers each Claude account", rows.count() == 2)

    page.keyboard.press("Escape")
    page.evaluate("window.nibApp.settings.show('agents')")
    quiet(page)
    check("an old link to Agents lands on AI", page.locator(".sheet").get_by_text("Accounts", exact=True).count() == 1)

if __name__ == "__main__":
    raise SystemExit(DRIVE.run(drive, "settings > ai holds several accounts of a provider"))
