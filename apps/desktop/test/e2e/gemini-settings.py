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
        {"id": "anthropic", "kind": "anthropic", "name": "", "model": "claude-opus-5-5"},
        {"id": "gemini", "kind": "gemini", "name": "", "model": ""},
        {"id": "gemini-cli", "kind": "gemini-cli", "name": "", "model": ""},
    ],
    "active": {"claude": "anthropic", "gemini": "gemini"},
    "defaultVendor": "claude",
    "uses": {},
}

MODELS = {
    "models": [
        {
            "name": "models/gemini-3-flash",
            "displayName": "Gemini 3 Flash",
            "inputTokenLimit": 1048576,
            "supportedGenerationMethods": ["generateContent"],
            "thinking": True,
        },
        {
            "name": "models/gemini-3.1-pro-preview",
            "supportedGenerationMethods": ["generateContent"],
            "thinking": True,
        },
        {"name": "models/gemini-embedding-2", "supportedGenerationMethods": ["embedContent"]},
        {"name": "models/gemini-3.8-flash-tts", "supportedGenerationMethods": ["generateContent"]},
    ]
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
    asked: list[dict[str, str]] = []

    def models(route) -> None:
        asked.append({k.lower(): v for k, v in route.request.headers.items()})
        route.fulfill(
            status=200,
            content_type="application/json",
            body=json.dumps(MODELS),
            headers={"access-control-allow-origin": "*"},
        )

    page.route("https://generativelanguage.googleapis.com/v1beta/models?*", models)
    DRIVE.open(page)
    page.evaluate("window.nibApp.settings.show('ai')")
    page.wait_for_selector("text=Accounts")
    quiet(page)
    shot(page, "01-accounts")

    sheet = page.locator(".sheet")
    vendor = sheet.locator('[data-vendor="gemini"]')
    check("Gemini is a provider of its own beside Claude", vendor.count() == 1)
    check("Gemini is named Gemini", vendor.get_by_text("Gemini", exact=True).count() == 1)
    try:
        vendor.locator('.mark[data-brand="googlegemini"] svg.drawn').wait_for(timeout=10_000)
    except PlaywrightTimeout:
        pass
    check(
        "Gemini wears Gemini's logo",
        vendor.locator('.mark[data-brand="googlegemini"] svg.drawn').count() == 1,
    )
    key_card = sheet.locator('.card[data-account="gemini"]')
    cli_card = sheet.locator('.card[data-account="gemini-cli"]')
    check("the key and the CLI are a card each", key_card.count() == 1 and cli_card.count() == 1)
    check("the CLI's card is the Gemini CLI's", cli_card.get_by_text("Gemini CLI", exact=True).count() == 1)
    adding = sheet.locator("button.nib-action", has_text="Add Gemini")
    check("Gemini can be added again by key", adding.count() >= 1)

    field = key_card.locator('input[type="password"]')
    check("the key field asks for a Google key", field.get_attribute("placeholder") == "AIza")
    field.fill("AIza-e2e-key")
    field.press("Tab")
    quiet(page)
    listing = key_card.get_by_role("button", name="List models")
    try:
        listing.wait_for(timeout=5_000)
        listing.click()
    except PlaywrightTimeout:
        pass
    try:
        page.wait_for_function(
            "() => JSON.parse(localStorage.getItem('orden:ai-accounts')).accounts.find((one) => one.id === 'gemini')?.model",
            timeout=10_000,
        )
    except PlaywrightTimeout:
        pass
    quiet(page)
    shot(page, "02-models")
    chosen = page.evaluate(
        "JSON.parse(localStorage.getItem('orden:ai-accounts')).accounts.find((one) => one.id === 'gemini').model"
    )
    check("the newest Pro that talks is picked first", chosen == "gemini-3.1-pro-preview")
    check("Google is asked with the key in its own header", any(one.get("x-goog-api-key") == "AIza-e2e-key" for one in asked))
    check("no Bearer goes to Google", all("authorization" not in one for one in asked))
    picker = key_card.get_by_role("combobox", name="Model")
    picker.click()
    quiet(page)
    offered = page.locator('[role="listbox"] [role="option"]').all_inner_texts()
    check("the picker offers the chat models alone", [one.strip() for one in offered] == ["gemini-3-flash", "gemini-3.1-pro-preview"])
    page.keyboard.press("Escape")
    quiet(page)

    used = sheet.get_by_text("Used for", exact=True)
    check("Used for is shown with two providers", used.count() == 1)
    first = sheet.locator('[role="combobox"]').filter(has_text="Default").first
    first.click()
    quiet(page)
    names = [one.strip() for one in page.locator('[role="listbox"] [role="option"]').all_inner_texts()]
    check("a feature can be given to Gemini", "Gemini" in names)
    page.keyboard.press("Escape")
    quiet(page)

    page.keyboard.press("Escape")
    page.wait_for_selector(".sheet", state="detached")
    page.evaluate("async () => { window.agentsFake = await window.nibApp.agents.standIn() }")
    page.evaluate("window.nibApp.settings.show('agents')")
    page.wait_for_selector("text=Accounts")
    tab = page.get_by_role("tab", name="Antigravity")
    try:
        tab.evaluate("(one) => one.scrollIntoView({ block: 'center', behavior: 'instant' })", timeout=10_000)
    except PlaywrightTimeout:
        say("     tabs: " + ", ".join(page.get_by_role("tab").all_inner_texts()))
    try:
        tab.wait_for(timeout=10_000)
    except PlaywrightTimeout:
        pass
    check("Connect has a tab of Antigravity's own", tab.count() == 1)
    if tab.count():
        tab.click()
        quiet(page)
        shot(page, "03-antigravity")
        block = page.locator(".agents pre").first
        text = block.inner_text() if block.count() else ""
        try:
            entry = json.loads(text)
        except ValueError:
            entry = {}
        orden = entry.get("mcpServers", {}).get("orden", {})
        check("it shows the MCP entry to paste", orden.get("args") == ["mcp"] and bool(orden.get("command")))
        check(
            "it says where Antigravity keeps it",
            page.get_by_text("View raw config", exact=False).count() == 1,
        )
        check("it offers the entry to copy", page.locator(".agents").get_by_role("button", name="Copy").count() >= 1)
        tabs = page.locator('.agents [role="tablist"]')
        fits = tabs.evaluate("(one) => one.scrollWidth <= one.clientWidth + 1")
        check("the tabs fit their row", fits)

if __name__ == "__main__":
    raise SystemExit(DRIVE.run(drive, "settings > ai offers Gemini and Antigravity"))
