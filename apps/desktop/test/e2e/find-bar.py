from __future__ import annotations

import sys
import time

from playwright.sync_api import Browser, Page

import harness
from harness import Drive

DRIVE = Drive(__file__)
say, wait_for = DRIVE.say, DRIVE.wait_for
failures = DRIVE.failures
ORIGIN = DRIVE.origin
SHOTS = DRIVE.shots
APP = harness.APP

PATIENCE = 40

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

def check(fine: bool, what: str) -> None:
    if fine:
        say(f"ok   {what}")
    else:
        failures.append(what)
        say(f"WRONG {what}")

LAUNCHED = "() => window.nibApp.workspace.tabs.length > 0"

def fresh(browser: Browser, label: str, viewport: dict[str, int], scheme: str) -> Page:
    context = browser.new_context(viewport=viewport, color_scheme=scheme)
    page = context.new_page()
    page.on("pageerror", lambda error: say(f"[{label}] page error: {error}"))
    DRIVE.open(page)
    return page

NOTE = """# The wind

the wind came up in the night, and the Wind
dropped again before morning. a windmill
turned once. wind, Wind, windward.
"""

SEED = """
async (text) => {
  const ws = window.nibApp.workspace
  const path = await ws.noteFrom(text, ws.activeSpace.root)
  // Activated, not merely opened - and see `SHOWING`, which is what makes it stay
  // activated through the sitting being read back.
  await ws.openEntry(path, { activate: true })
  if (ws.panel) ws.showPanel(null)
  return path
}
"""

BAR = """
() => {
  const bar = document.querySelector('.findbar')
  if (!bar) return null

  return {
    query: bar.querySelector('input')?.value ?? null,
    tally: bar.querySelector('.tally')?.textContent?.trim() ?? '',
    flags: bar.querySelectorAll('.flag').length,
    steps: bar.querySelectorAll('.act').length,
    replacing: bar.querySelectorAll('input').length > 1,
    lit: document.querySelectorAll('.cm-searchMatch').length,
    here: document.querySelectorAll('.cm-searchMatch-selected').length,
    field: bar.querySelector('input')?.className ?? '',
    focused: document.activeElement?.tagName ?? '',
  }
}
"""

WHERE = "() => document.activeElement?.className ?? document.activeElement?.tagName ?? ''"
DOC = "() => window.nibApp.workspace.active.doc"
GALE = "(window.nibApp.workspace.active.doc.match(/gale/g) || []).length"
CARET = """
() => ({
  active: window.nibApp.workspace.active?.path ?? null,
  tabs: window.nibApp.workspace.tabs.length,
  editors: document.querySelectorAll('.cm-content').length,
  windmill: (window.nibApp.workspace.active?.doc ?? '').includes('windmill'),
  picked: (getSelection()?.toString() ?? '').slice(0, 24),
  focused: document.activeElement?.className?.slice?.(0, 40) ?? '',
})
"""

SHOWING = """
() => {
  const ws = window.nibApp.workspace
  const mine = ws.tabs.find((one) => (one.path ?? '').endsWith('The wind.md'))
  if (!mine) return false

  if (ws.activeTabId !== mine.id) {
    ws.activeTabId = mine.id
    return false
  }

  for (const other of [...ws.tabs]) if (other.id !== mine.id) ws.close(other.id)

  return (ws.active?.doc ?? '').includes('windmill')
    && document.querySelectorAll('.cm-content').length === 1
}
"""
PANEL = "() => document.querySelectorAll('.cm-panel, .cm-panels').length"

AS_PHONE = """
() => {
  const app = window.nibApp
  app.viewport.device = 'phone'
  app.viewport.portrait = true
  app.viewport.narrow = true

  const root = document.documentElement
  root.dataset.device = 'phone'
  root.toggleAttribute('data-touch', true)
  root.toggleAttribute('data-drawer', true)
  root.toggleAttribute('data-narrow', true)
}
"""

SIZES = """
() => {
  const out = []
  for (const [what, selector] of [
    ['the field', '.findbar .nib-field'],
    ['a step', '.findbar .act'],
    ['a flag', '.findbar .flag'],
  ]) {
    const one = document.querySelector(selector)
    if (!one) { out.push({ what, missing: true }); continue }

    const box = one.getBoundingClientRect()
    out.push({ what, width: Math.round(box.width), height: Math.round(box.height) })
  }

  return out
}
"""

FINGER = 40

def on_phone(browser: Browser) -> None:
    label = "phone"
    page = fresh(browser, label, {"width": 390, "height": 844}, "light")
    try:
        page.evaluate(AS_PHONE)
        page.wait_for_timeout(200)
        wait_for(page, LAUNCHED, f"[{label}] the launch's own note")
        say(f"[{label}] wrote {page.evaluate(SEED, NOTE)}")
        wait_for(page, "() => !!document.querySelector('.cm-content')", f"[{label}] the editor")
        wait_for(page, SHOWING, f"[{label}] the note to be the document")

        page.locator(".cm-content").first.click()
        page.keyboard.press("Control+f")
        page.wait_for_selector(".findbar", state="visible", timeout=8000)

        bar = page.evaluate(BAR)
        check(bar is not None, f"[{label}] Ctrl+F puts the bar up")
        if not bar:
            return

        page.locator(".findbar input").first.fill("wind")
        page.wait_for_timeout(300)
        page.locator(".findbar").first.screenshot(path=str(SHOTS / "bar-phone.png"))
        say(f"[{label}] wrote bar-phone.png")

        for one in page.evaluate(SIZES):
            say(f"[{label}]   {one}")
            if one.get("missing"):
                check(False, f"[{label}] {one['what']} is drawn")
                continue

            check(
                one["height"] >= FINGER,
                f"[{label}] {one['what']} is a finger's target ({one['height']}px)",
            )
    finally:
        page.context.close()

def drive(browser: Browser, label: str, scheme: str) -> None:
    page = fresh(browser, label, {"width": 1180, "height": 760}, scheme)
    try:
        wait_for(page, LAUNCHED, f"[{label}] the launch's own note")
        say(f"[{label}] wrote {page.evaluate(SEED, NOTE)}")
        wait_for(page, "() => !!document.querySelector('.cm-content')", f"[{label}] the editor")
        wait_for(page, SHOWING, f"[{label}] the note to be the document")

        content = page.locator(".cm-content").first
        content.click()
        page.keyboard.press("Control+Home")
        page.keyboard.press("Control+ArrowRight")
        page.keyboard.press("Control+ArrowRight")
        page.keyboard.press("Control+Shift+ArrowRight")
        say(f"[{label}] before Ctrl+F: {page.evaluate(CARET)}")
        page.keyboard.press("Control+f")
        page.wait_for_selector(".findbar", state="visible", timeout=8000)
        try:
            wait_for(page, "document.querySelectorAll('.cm-searchMatch').length > 0", "the matches", 10)
        except SystemExit:
            pass

        bar = page.evaluate(BAR)
        say(f"[{label}] the bar: {bar}")
        check(bar is not None, f"[{label}] Ctrl+F puts the bar up")
        if not bar:
            return

        check(page.evaluate(PANEL) == 0, f"[{label}] and no library panel with it")
        check(
            "nib-field" in bar["field"],
            f"[{label}] the query sits in one .nib-field ({bar['field']})",
        )
        check(bar["flags"] == 3, f"[{label}] with three flags inside it ({bar['flags']})")
        check(bar["query"].strip().lower() == "wind", f"[{label}] on the word the caret was on")
        check(bar["lit"] >= 4, f"[{label}] and the matches are lit ({bar['lit']})")

        page.locator(".findbar").first.screenshot(path=str(SHOTS / f"bar-{label}.png"))
        say(f"[{label}] wrote bar-{label}.png")

        def tally(unlike: str | None = None) -> str:
            until = time.monotonic() + PATIENCE
            said = ""
            while time.monotonic() < until:
                said = page.evaluate(BAR)["tally"]
                if said and (unlike is None or said != unlike):
                    return said
                page.wait_for_timeout(30)

            return said

        def flag(label: str, on: bool) -> None:
            page.locator(f'.findbar .flag[aria-label="{label}"]').click()
            page.wait_for_selector(
                f'.findbar .flag[aria-label="{label}"][aria-pressed="{str(on).lower()}"]',
                timeout=8000,
            )

        field = page.locator(".findbar input").first
        field.fill("wind")
        loose = tally()
        say(f"[{label}] 'wind' is {loose!r}")
        check("of 7" in loose, f"[{label}] finds every wind, however written ({loose!r})")

        flag("Match case", True)
        cased = tally(unlike=loose)
        say(f"[{label}] with Match case: {cased!r}")
        check(cased != loose, f"[{label}] Match case changes the answer")

        flag("Match case", False)
        flag("Whole word", True)
        whole = tally(unlike=loose)
        say(f"[{label}] with Whole word: {whole!r}")
        check(whole != loose, f"[{label}] Whole word changes the answer")

        flag("Whole word", False)
        flag("Regular expression", True)
        field.fill("w[a-z]+d")
        regex = tally()
        say(f"[{label}] as a regular expression: {regex!r}")
        check(bool(regex) and "0" not in regex[:2], f"[{label}] a regular expression matches")
        flag("Regular expression", False)

        field.fill("wind")
        first = tally()
        field.press("Enter")
        second = tally(unlike=first)
        say(f"[{label}] Enter took {first!r} to {second!r}")
        check(first != second, f"[{label}] Enter steps on")

        field.press("Shift+Enter")
        back = tally(unlike=second)
        say(f"[{label}] Shift+Enter took {second!r} to {back!r}")
        check(back == first, f"[{label}] and Shift+Enter steps back")

        check(
            page.evaluate(BAR)["here"] == 1,
            f"[{label}] and the match the caret is on is the one picked out",
        )

        page.locator('.findbar .act[aria-label="Replace"]').click()
        page.wait_for_function(
            "() => document.querySelectorAll('.findbar input').length > 1", timeout=8000
        )
        open_bar = page.evaluate(BAR)
        say(f"[{label}] with the replace row: {open_bar}")
        check(open_bar["replacing"], f"[{label}] the chevron opens the replace row")

        page.locator(".findbar").first.screenshot(path=str(SHOTS / f"replace-{label}.png"))
        say(f"[{label}] wrote replace-{label}.png")

        page.locator(".findbar input").nth(1).fill("gale")
        page.wait_for_selector(".findbar .apply:not([disabled])", timeout=8000)
        page.locator(".findbar .apply").first.click()
        wait_for(page, f"() => {GALE} >= 1", "the first replacement")
        once = page.evaluate(DOC)
        say(f"[{label}] after one Replace: {once.count('gale')} gale, {once.count('wind')} wind")
        check(once.count("gale") == 1, f"[{label}] Replace changes one match")

        page.locator(".findbar .apply").nth(1).click()
        wait_for(page, f"() => {GALE} > 1", "the rest of the replacements")
        all_done = page.evaluate(DOC)
        say(f"[{label}] after Replace all: {all_done.count('gale')} gale")
        check(all_done.count("gale") > 1, f"[{label}] and Replace all changes the rest")

        page.locator(".findbar input").first.press("Escape")
        page.wait_for_selector(".findbar", state="detached", timeout=8000)
        say(f"[{label}] the keyboard landed on {page.evaluate(WHERE)!r}")
        check(page.evaluate(BAR) is None, f"[{label}] Escape closes the bar")
        check(
            "cm-content" in page.evaluate(WHERE),
            f"[{label}] and hands the caret back to the note",
        )
        check(
            page.evaluate("() => document.querySelectorAll('.cm-searchMatch').length") == 0,
            f"[{label}] and the matches go with it",
        )

        page.evaluate("() => window.nibApp.workspace.toggleReading?.()")
        page.wait_for_timeout(200)
        reading = page.evaluate(
            "() => { const ws = window.nibApp.workspace; const tab = ws.active;"
            " if (tab) tab.reading = true; return !!tab?.reading }"
        )
        page.wait_for_timeout(600)
        if reading and page.locator(".read").count():
            page.locator(".read").first.click()
            page.keyboard.press("Control+f")
            page.wait_for_timeout(400)
            read_bar = page.evaluate(BAR)
            say(f"[{label}] the reader's bar: {read_bar}")
            if read_bar:
                check(
                    read_bar["flags"] == 0,
                    f"[{label}] a note being read gets no flags it cannot honour",
                )
                check(
                    not read_bar["replacing"],
                    f"[{label}] and nothing to replace with",
                )
                page.locator(".findbar").first.screenshot(path=str(SHOTS / f"reading-{label}.png"))
                say(f"[{label}] wrote reading-{label}.png")
            else:
                say(f"[{label}] the reader's bar did not open; nothing checked there")
        else:
            say(f"[{label}] could not switch to reading; nothing checked there")
    finally:
        page.context.close()

def main() -> int:
    with DRIVE.session() as browser:
        drive(browser, "light", "light")
        drive(browser, "dark", "dark")
        on_phone(browser)

    return DRIVE.verdict("the find bar is nib's own, and it finds, steps and replaces")

if __name__ == "__main__":
    sys.exit(main())
