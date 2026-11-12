from __future__ import annotations

from playwright.sync_api import Browser, Page

from harness import Drive

DRIVE = Drive(__file__)
say, wrong = DRIVE.say, DRIVE.wrong

NAMES = {"2024 report": ("2024", "report"), "(draft) plan": ("(draft)", "plan"), "تقرير 2024": ("تقرير", "2024")}

PLACES = {
    "tab": "[data-strip] .tab .label",
    "file list": ".row[data-path] .orden-row-label",
}

ORDER = """([selector, name, first, second]) => {
  const label = [...document.querySelectorAll(selector)].find((one) => one.textContent.trim() === name)
  if (!label) return null
  const walker = document.createTreeWalker(label, NodeFilter.SHOW_TEXT)
  const node = walker.nextNode()
  const at = (word) => {
    const range = document.createRange()
    const from = node.data.indexOf(word)
    range.setStart(node, from)
    range.setEnd(node, from + word.length)
    return range.getBoundingClientRect()
  }
  const one = at(first)
  const other = at(second)
  const range = document.createRange()
  range.selectNodeContents(label)
  const text = range.getBoundingClientRect()
  const box = label.getBoundingClientRect()
  return { first: one.left, second: other.left, room: box.width - text.width, left: text.left - box.left, right: box.right - text.right }
}"""

def opened(browser: Browser) -> Page:
    page = DRIVE.page(browser, viewport={"width": 1300, "height": 600})
    page.add_init_script("localStorage.setItem('orden:icon-tabs', 'no')")
    DRIVE.open(page)
    DRIVE.seed(page, *[f"# {name}\n\nWords.\n" for name in NAMES])
    page.evaluate(
        """async () => {
          const ws = window.ordenApp.workspace
          for (const note of ws.notes) await ws.openEntry(note.path, 'behind')
          ws.showPanel('tree')
        }"""
    )
    page.wait_for_timeout(800)
    return page

def drive(browser: Browser) -> None:
    page = opened(browser)
    for place, selector in PLACES.items():
        for name, (first, second) in NAMES.items():
            found = page.evaluate(ORDER, [selector, name, first, second])
            if found is None:
                wrong(f"no {place} shows {name!r}")
                continue
            rtl_name = first == "تقرير"
            reads_left_to_right = found["first"] < found["second"]
            say(f"{place} {name!r}: {found}")
            if reads_left_to_right == rtl_name:
                wrong(f"the {place} shows {name!r} back to front")
            if place == "file list" and found["room"] > 8 and found["left"] > 2:
                wrong(f"the {place} sets {name!r} {found['left']:.0f}px off the row's left edge")
    DRIVE.shot(page, "names")
    page.close()

if __name__ == "__main__":
    raise SystemExit(DRIVE.run(drive, "a name reads in its own direction"))
