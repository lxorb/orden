from __future__ import annotations

import json
import sys

from playwright.sync_api import Browser, Page

from harness import Drive

DRIVE = Drive(__file__)
say, wrong, wait_for = DRIVE.say, DRIVE.wrong, DRIVE.wait_for
ORIGIN = DRIVE.origin
SHOTS = DRIVE.shots

PHONE = {"width": 390, "height": 844}
PHONE_AGENT = (
    "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko)"
    " Chrome/140.0.0.0 Mobile Safari/537.36"
)

PATIENCE = 20

def fresh(browser: Browser, label: str, theme: str = "light") -> Page:
    context = browser.new_context(
        viewport=PHONE,
        user_agent=PHONE_AGENT,
        has_touch=True,
        is_mobile=True,
        color_scheme=theme,
    )
    page = context.new_page()
    page.on("pageerror", lambda error: say(f"[{label}] page error: {error}"))
    page.goto(ORIGIN, wait_until="domcontentloaded")

    wait_for(page, "() => !!window.ordenApp", f"[{label}] the app to start")
    wait_for(page, "() => document.documentElement.hasAttribute('data-touch')", "a touch layout")
    wait_for(page, "() => !!window.ordenApp.workspace.active", f"[{label}] the app's own note")
    return page

PRESS = """
(selector) => {
  const node = document.querySelector(selector)
  if (!node) return false

  const box = node.getBoundingClientRect()
  const at = { clientX: box.left + 20, clientY: box.top + box.height / 2 }
  const touch = new Touch({ identifier: 1, target: node, ...at })
  const send = (kind) =>
    node.dispatchEvent(
      new TouchEvent(kind, {
        touches: kind === 'touchend' ? [] : [touch],
        targetTouches: kind === 'touchend' ? [] : [touch],
        changedTouches: [touch],
        bubbles: true,
        cancelable: true,
      }),
    )

  send('touchstart')
  window.__nibRelease = () => send('touchend')
  return true
}
"""

SWIPE = """
(selector) => {
  const node = document.querySelector(selector)
  if (!node) return false

  const box = node.getBoundingClientRect()
  const start = { clientX: box.left + 20, clientY: box.top + box.height / 2 }
  const at = (x, y) => new Touch({ identifier: 1, target: node, clientX: x, clientY: y })
  const send = (kind, touch) =>
    node.dispatchEvent(
      new TouchEvent(kind, {
        touches: kind === 'touchend' ? [] : [touch],
        targetTouches: kind === 'touchend' ? [] : [touch],
        changedTouches: [touch],
        bubbles: true,
        cancelable: true,
      }),
    )

  send('touchstart', at(start.clientX, start.clientY))
  send('touchmove', at(start.clientX + 40, start.clientY + 4))
  return true
}
"""

TRIES = 6

PRESS_NTH = """
(asked) => {
  const nodes = document.querySelectorAll(asked.selector)
  const node = nodes[asked.index]
  if (!node) return false

  const box = node.getBoundingClientRect()
  const at = { clientX: box.left + 20, clientY: box.top + box.height / 2 }
  const touch = new Touch({ identifier: 1, target: node, ...at })
  const send = (kind) =>
    node.dispatchEvent(
      new TouchEvent(kind, {
        touches: kind === 'touchend' ? [] : [touch],
        targetTouches: kind === 'touchend' ? [] : [touch],
        changedTouches: [touch],
        bubbles: true,
        cancelable: true,
      }),
    )

  send('touchstart')
  window.__nibRelease = () => send('touchend')
  return true
}
"""

def hold_for(page: Page, selector: str, index: int, wanted: str, label: str) -> None:
    row = page.get_by_role("menuitem", name=wanted, exact=True)
    page.wait_for_selector(selector, state="attached", timeout=10000)

    for attempt in range(TRIES):
        last = attempt == TRIES - 1

        if not page.evaluate(PRESS_NTH, {"selector": selector, "index": index}):
            if last:
                raise SystemExit(f"[{label}] nothing matched {selector} at {index}")
            page.wait_for_timeout(250)
            continue

        try:
            row.first.wait_for(state="visible", timeout=2000)
        except Exception:
            page.evaluate("() => window.__nibRelease?.()")
            if last:
                raise SystemExit(f"[{label}] no menu offering {wanted!r} on {selector}")
            continue

        page.evaluate("() => window.__nibRelease?.()")
        return

def hold(page: Page, selector: str, label: str) -> None:
    page.wait_for_selector(selector, state="attached", timeout=10000)

    for attempt in range(TRIES):
        last = attempt == TRIES - 1

        if not page.evaluate(PRESS, selector):
            if last:
                raise SystemExit(f"[{label}] nothing matched {selector}")
            page.wait_for_timeout(250)
            continue

        try:
            page.wait_for_selector('[role="menu"]:visible', timeout=2000)
        except Exception:
            page.evaluate("() => window.__nibRelease?.()")
            if last:
                raise SystemExit(
                    f"[{label}] the menu never opened on {selector}"
                    f" after {TRIES} presses"
                )
            continue

        page.evaluate("() => window.__nibRelease?.()")
        return

def seed(page: Page) -> None:
    page.evaluate(
        """
        async () => {
          const app = window.ordenApp
          await app.workspace.createCanvas('/Notes/Work', 'Board.canvas')
          await app.workspace.addSpace('Uni')
          const notes = app.workspace.spaces.find((one) => one.name === 'Notes')
          if (notes) await app.workspace.showSpace(notes.id)
        }
        """
    )
    wait_for(page, "() => window.ordenApp.workspace.activeSpace?.name === 'Notes'", "Notes to open")
    wait_for(
        page,
        "() => window.ordenApp.workspace.spaces.some((one) => one.name === 'Uni')",
        "the second space",
    )

def tree_paths(page: Page) -> list[str]:
    return page.evaluate(
        "() => {"
        "  const walk = (entry) => (entry ? [entry.path, ...(entry.children ?? []).flatMap(walk)] : []);"
        "  return walk(window.ordenApp.workspace.tree)"
        "}"
    )

def space_names(page: Page) -> list[str]:
    return page.evaluate("() => window.ordenApp.workspace.spaces.map((one) => one.name)")

def open_the_switcher(page: Page) -> None:
    page.locator("aside .name").first.click(force=True)
    page.wait_for_selector(".spaces .line button.orden-row", timeout=5000)

def open_the_list(page: Page) -> None:
    page.evaluate("() => (window.ordenApp.workspace.panel = 'tree')")
    page.wait_for_selector(".row[data-path$='.md']", timeout=5000)

def main() -> int:
    with DRIVE.session() as browser:
        page = fresh(browser, "phone")
        seed(page)
        open_the_list(page)
        say(f"the list holds {tree_paths(page)!r}")

        hold(page, ".row[data-path$='.md']", "phone")
        offered = page.locator('[role="menuitem"]').all_inner_texts()
        if "Move" not in [one.strip() for one in offered]:
            wrong(f"a note's menu on a touch screen offers {offered!r}, with no Move")
        else:
            say("a note's menu offers Move")

        page.wait_for_timeout(200)
        page.screenshot(path=str(SHOTS / "touch-move-menu-light.png"))

        page.get_by_role("menuitem", name="Move", exact=True).click()
        sheet = page.locator('div.sheet[role="dialog"]')
        sheet.wait_for(state="visible", timeout=5000)
        page.wait_for_timeout(250)
        page.screenshot(path=str(SHOTS / "touch-move-picker-light.png"))

        rows = [one.strip() for one in page.locator(".found-row").all_inner_texts()]
        say(f"the picker offers {rows!r}")
        for wanted in ("Work", "Uni"):
            if not any(wanted in one for one in rows):
                wrong(f"the picker does not offer {wanted}: {rows!r}")

        before = tree_paths(page)
        moved = next(
            (one for one in before if one.endswith(".md") and "/Work/" not in one), None
        )
        if not moved:
            raise SystemExit(f"no note to move in {before!r}")

        page.locator(".found-row", has_text="Work").first.click()
        wait_for(
            page,
            "() => {"
            "  const walk = (entry) => (entry ? [entry.path, ...(entry.children ?? []).flatMap(walk)] : []);"
            "  return walk(window.ordenApp.workspace.tree).some((one) => one.includes('/Work/') && one.endsWith('.md'))"
            "}",
            "the note to land in Work",
        )
        say(f"{moved} moved into Work")

        label = page.evaluate("() => window.ordenApp.workspace.undoLabel ?? null")
        say(f"undo offers {label!r}")
        page.evaluate("() => window.ordenApp.workspace.undoFileAction()")
        wait_for(
            page,
            "() => {"
            "  const walk = (entry) => (entry ? [entry.path, ...(entry.children ?? []).flatMap(walk)] : []);"
            "  return !walk(window.ordenApp.workspace.tree).some((one) => one.includes('/Work/') && one.endsWith('.md'))"
            "}",
            "the move to be undone",
        )
        say("and undo put it back")

        page.evaluate(SWIPE, ".row[data-path$='.md']")
        page.wait_for_timeout(900)
        if page.locator('[role="menu"]:visible').count():
            wrong("a finger that set off across the row still opened the menu")
        else:
            say("a finger that moves first opens no menu, so a drag can have it")

        was = space_names(page)
        open_the_switcher(page)
        hold_for(page, ".spaces .line button.orden-row", 1, "Move up", "phone")

        offered = [
            one.strip() for one in page.locator('[role="menuitem"]').all_inner_texts()
        ]
        say(f"the second space's menu offers {offered!r}")
        page.wait_for_timeout(250)
        page.screenshot(path=str(SHOTS / "touch-move-spaces-light.png"))

        page.get_by_role("menuitem", name="Move up", exact=True).first.click()
        wait_for(
            page,
            "() => window.ordenApp.workspace.spaces.map((one) => one.name).join() !== "
            + json.dumps(",".join(was)),
            "the list of spaces to reorder",
        )
        now = space_names(page)
        if now != list(reversed(was)):
            wrong(f"one step up turned {was!r} into {now!r}")
        else:
            say(f"the spaces went from {was!r} to {now!r}")

        page = fresh(browser, "dark", theme="dark")
        seed(page)
        open_the_list(page)

        hold(page, ".row[data-path$='.md']", "dark")
        page.wait_for_timeout(200)
        page.screenshot(path=str(SHOTS / "touch-move-menu-dark.png"))

        page.get_by_role("menuitem", name="Move", exact=True).click()
        page.locator('div.sheet[role="dialog"]').wait_for(state="visible", timeout=5000)
        page.wait_for_timeout(250)
        page.screenshot(path=str(SHOTS / "touch-move-picker-dark.png"))

        page.keyboard.press("Escape")
        open_the_switcher(page)
        hold_for(page, ".spaces .line button.orden-row", 1, "Move up", "dark")
        page.wait_for_timeout(250)
        page.screenshot(path=str(SHOTS / "touch-move-spaces-dark.png"))
        say("photographed all three in the dark")

    return DRIVE.verdict("a finger can move a note and reorder the spaces")

if __name__ == "__main__":
    sys.exit(main())
