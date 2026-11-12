from __future__ import annotations

import sys

from playwright.sync_api import Browser, Page

import harness
from harness import Drive

DRIVE = Drive(__file__)
say, wait_for = DRIVE.say, DRIVE.wait_for
ORIGIN = DRIVE.origin
SHOTS = DRIVE.shots
APP = harness.APP

PATIENCE = 40

def fresh(browser: Browser, label: str, scheme: str) -> Page:
    context = browser.new_context(viewport={"width": 1180, "height": 760}, color_scheme=scheme)
    page = context.new_page()
    page.on("pageerror", lambda error: say(f"[{label}] page error: {error}"))
    DRIVE.open(page)
    return page

SEED = """
async () => {
  const ws = window.ordenApp.workspace
  const root = ws.activeSpace.root
  const at = (name) => (root.endsWith('/') ? root + name : root + '/' + name)

  const text = '# Notes\\n\\nthe first thought\\n\\n---\\n\\nthe second thought\\n'
  const path = await ws.noteFrom(text, root)
  await ws.openEntry(path)
  return path
}
"""

RULE = """
() => {
  const line = document.querySelector('.cm-line:has(.orden-rule)')
  if (!line) return null

  const before = getComputedStyle(line, '::before')
  return {
    classes: line.className,
    editor: document.querySelector('.cm-editor')?.className ?? '',
    rules: [...line.querySelectorAll('.orden-rule')].length,
    content: before.content,
    width: before.width,
    height: before.height,
    radius: before.borderRadius,
    background: before.backgroundColor,
  }
}
"""

TYPED = """
async () => {
  const ws = window.ordenApp.workspace
  const root = ws.activeSpace.root
  const path = await ws.noteFrom('# Ruled\\n\\nthe first part\\n\\n', root)
  await ws.openEntry(path)
  return path
}
"""

def shoot(browser: Browser, scheme: str) -> None:
    page = fresh(browser, scheme, scheme)
    try:
        say(f"[{scheme}] wrote {page.evaluate(SEED)}")
        wait_for(
            page,
            "() => !!document.querySelector('.cm-line:has(.orden-rule)')",
            f"[{scheme}] the rule",
        )
        page.wait_for_timeout(300)

        rule = page.evaluate(RULE)
        say(f"[{scheme}] the rule line: {rule}")

        box = page.locator(".cm-line:has(.orden-rule)").first.bounding_box()
        page.screenshot(
            path=str(SHOTS / f"rule-{scheme}.png"),
            clip={
                "x": max(0, box["x"] - 40),
                "y": max(0, box["y"] - 46),
                "width": min(1180, box["width"] + 80),
                "height": box["height"] + 92,
            },
        )
        say(f"[{scheme}] wrote rule-{scheme}.png")

        if rule["content"] not in ("none", "normal", ""):
            raise SystemExit(
                f"[{scheme}] something is drawn in front of the rule: "
                f"content={rule['content']} {rule['width']}x{rule['height']} "
                f"radius={rule['radius']} background={rule['background']}"
            )
        if rule["rules"] != 1:
            raise SystemExit(f"[{scheme}] the rule line holds {rule['rules']} hairlines")

        if scheme != "light":
            return

        say(f"[{scheme}] wrote {page.evaluate(TYPED)}")
        page.evaluate("() => window.ordenApp.modes.punctuation || window.ordenApp.modes.togglePunctuation()")
        content = page.locator(".cm-content")
        content.click()
        page.keyboard.press("Control+End")
        page.keyboard.type("---")
        page.wait_for_timeout(200)

        text = page.evaluate("() => window.orden.state.doc.toString()")
        lines = [line for line in text.split("\n") if line.strip()]
        typed = lines[-1] if lines else ""
        say(f"[{scheme}] the last line reads {typed!r}")
        if typed != "---":
            raise SystemExit(f"[{scheme}] typing three hyphens gave {typed!r}, not '---'")

        page.keyboard.type("\n\nthe second part\n")
        page.wait_for_timeout(300)

        written = page.evaluate("() => window.orden.state.doc.toString()")
        say(f"[{scheme}] the note now reads {written!r}")
        if "\n---\n" not in written:
            raise SystemExit(f"[{scheme}] no rule survived in {written!r}")
    finally:
        page.context.close()

def main() -> int:
    with DRIVE.session() as browser:
        shoot(browser, "light")
        shoot(browser, "dark")

    return DRIVE.verdict("the rule is a hairline and nothing else, and it can be typed")

if __name__ == "__main__":
    sys.exit(main())
