from __future__ import annotations

import sys

from playwright.sync_api import Browser, Page

import harness
from harness import Drive

DRIVE = Drive(__file__)
say = DRIVE.say
ORIGIN = DRIVE.origin
APP = harness.APP
ROOT = harness.ROOT

SHOT = ROOT / "docs" / "media" / "screenshot.png"

SIZE = {"width": 1000, "height": 700}
SCALE = 2

NOTE = """# Kestrel notes

A **markdown editor** that formats what you write *as you write it*.

## What went in this week

- [x] Pressure on the pen, so a stroke thins where the hand lifts
- [ ] Slides straight out of a note

| Platform | Sync | Publish |
| --- | :-: | :-: |
| Desktop | yes | yes |

The area of a circle is $A = \\pi r^2$, set as it is typed.

```python
def kestrel(wind):
    return sum(w ** 2 for w in wind) / len(wind)
```
"""

SEED = """
async (note) => {
  const ws = window.ordenApp.workspace
  const root = ws.activeSpace.root
  const at = (name) => (root.endsWith('/') ? root + name : root + '/' + name)

  await ws.noteFrom('# Reading list\\n\\nwhat is next\\n', root)
  await ws.noteFrom('# Chapter one\\n\\nthe opening\\n', at('Book'))
  await ws.noteFrom('# Standup\\n\\nwho said what\\n', root)
  const open = await ws.noteFrom(note, root)
  await ws.rename(open, 'Kestrel notes.md')

  if (ws.panel !== 'tree') ws.showPanel('tree')
  await ws.openEntry(at('Kestrel notes.md'), { activate: true })
  return ws.tree.children.map((one) => one.name)
}
"""

def shoot(browser: Browser) -> None:
    context = browser.new_context(
        viewport=SIZE, device_scale_factor=SCALE, color_scheme="light"
    )
    page: Page = context.new_page()
    page.on("pageerror", lambda error: say(f"page error: {error}"))
    DRIVE.open(page)
    say(f"the space holds {page.evaluate(SEED, NOTE)}")

    page.wait_for_function(
        "() => document.querySelector('.cm-editor table') && document.querySelector('.cm-editor .katex')",
        timeout=40000,
    )
    page.wait_for_timeout(2500)

    SHOT.parent.mkdir(parents=True, exist_ok=True)
    page.screenshot(path=str(SHOT))
    say(f"wrote {SHOT.relative_to(ROOT)}")
    context.close()

def main() -> int:
    return DRIVE.run(shoot)

if __name__ == "__main__":
    sys.exit(main())
