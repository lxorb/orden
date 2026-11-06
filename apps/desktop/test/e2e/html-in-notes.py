from __future__ import annotations

import sys
from pathlib import Path

from harness import Drive

DRIVE = Drive(__file__, fresh=False)
say = DRIVE.say
ORIGIN = DRIVE.origin

DESKTOP_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko)"
    " Chrome/140.0.0.0 Safari/537.36"
)

BLOCK = """# A raw block

<div class="card" data-kind="note">
  <p>A kestrel <em>hangs</em> on the wind.</p>
  <style>.card { color: teal; border: 1px solid }</style>
  <script>const wind = 12; console.log("knots", wind)</script>
</div>

<!-- and a comment block -->

After the block.
"""

INLINE = """# An inline tag

The wind was <u>steady</u> all week, and <strong>cold</strong> with it.

A <span class="tint">tinted</span> word, and an <abbr title="knots">kn</abbr>.
"""

FENCE = """# A fence

```html
<section id="field">
  <h2>Field notes</h2>
  <img src="kestrel.png" alt="A kestrel">
</section>
```

After the fence.
"""

TYPING = """# Typing

<div>
  <p>Wind</p>
"""

NOTES = [("block", BLOCK), ("inline", INLINE), ("fence", FENCE)]

COLOURED = """
() => {
  const painted = [...document.querySelectorAll('.cm-content span[class]')].filter(
    (one) => !/(^|\\s)cm-/.test(one.className),
  )
  return {
    spans: painted.length,
    letters: painted.reduce((sum, one) => sum + one.textContent.length, 0),
  }
}
"""

OPEN = """async (text) => {
  const ws = window.nibApp.workspace
  const path = await ws.noteFrom(text)
  if (path) await ws.openEntry(path, { activate: true })
}"""

def drive(browser, out: Path, scheme: str) -> None:
    out.mkdir(parents=True, exist_ok=True)
    context = browser.new_context(
        viewport={"width": 1280, "height": 860},
        user_agent=DESKTOP_AGENT,
        color_scheme=scheme,
        device_scale_factor=2,
    )
    page = context.new_page()
    page.set_default_timeout(8000)
    page.on("pageerror", lambda error: say(f"[{scheme}] page error: {error}"))
    DRIVE.open(page)
    page.evaluate(f"() => window.nibApp.theme.setScheme('{scheme}')")
    page.wait_for_timeout(400)

    def shot(tag: str) -> None:
        box = page.locator(".cm-content").first.bounding_box()
        if not box:
            say(f"[{scheme}] no editor for {tag}")
            return
        page.screenshot(
            path=str(out / f"{scheme}-{tag}.png"),
            clip={
                "x": box["x"],
                "y": box["y"],
                "width": box["width"],
                "height": min(520, 860 - box["y"]),
            },
        )
        say(f"shot {scheme}-{tag}.png")

    for name, text in NOTES:
        page.evaluate(OPEN, text)
        page.wait_for_timeout(1800)
        say(f"[{scheme}] {name}: {page.evaluate(COLOURED)}")
        shot(name)

    page.evaluate(OPEN, TYPING)
    page.wait_for_timeout(1600)
    page.evaluate(
        """() => {
          const view = window.nib
          view.dispatch({ selection: { anchor: view.state.doc.line(4).to } })
          view.focus()
        }"""
    )
    page.keyboard.type("<em>")
    page.wait_for_timeout(700)
    say(f"[{scheme}] typed: {page.evaluate('() => window.nib.state.doc.toString()')!r}")
    shot("typed")

    context.close()

def main() -> int:
    tag = sys.argv[1] if len(sys.argv) > 1 else "now"
    out = DRIVE.shots / tag
    with DRIVE.session() as browser:
        for scheme in ("light", "dark"):
            say(f"--- {scheme} ---")
            drive(browser, out, scheme)

    return DRIVE.verdict(f"shots in {out}")

if __name__ == "__main__":
    raise SystemExit(main())
