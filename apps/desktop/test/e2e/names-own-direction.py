from __future__ import annotations

from playwright.sync_api import Browser, Page

from harness import Drive

DRIVE = Drive(__file__)
say, wrong, wait_for = DRIVE.say, DRIVE.wrong, DRIVE.wait_for

NAMES = {"2024 report": ("2024", "report"), "(draft) plan": ("(draft)", "plan"), "تقرير 2024": ("تقرير", "2024")}

PLACES = {
    "tab": "[data-strip] .tab .label",
    "file list": ".row[data-path] .nib-row-label",
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
  return { first: one.left, second: other.left }
}"""

def opened(browser: Browser, language: str) -> Page:
    page = DRIVE.page(browser, viewport={"width": 1300, "height": 600})
    page.add_init_script("localStorage.setItem('nib:icon-tabs', 'no')")
    page.add_init_script(f"localStorage.setItem('nib:language', '{language}')")
    DRIVE.open(page)
    DRIVE.seed(page, *[f"# {name}\n\nWords.\n" for name in NAMES])
    page.evaluate(
        """async () => {
          const ws = window.nibApp.workspace
          for (const note of ws.notes) await ws.openEntry(note.path, 'behind')
          ws.showPanel('tree')
        }"""
    )
    page.wait_for_timeout(800)
    return page

def drive(browser: Browser) -> None:
    for language, direction in (("ar", "rtl"), ("en", "ltr")):
        page = opened(browser, language)
        wait_for(page, f"document.documentElement.dir === '{direction}'", f"the words running {direction}")
        for place, selector in PLACES.items():
            for name, (first, second) in NAMES.items():
                found = page.evaluate(ORDER, [selector, name, first, second])
                if found is None:
                    wrong(f"[{language}] no {place} shows {name!r}")
                    continue
                rtl_name = first == "تقرير"
                reads_left_to_right = found["first"] < found["second"]
                say(f"[{language}] {place} {name!r}: {found}")
                if reads_left_to_right == rtl_name:
                    wrong(f"[{language}] the {place} shows {name!r} back to front")
        DRIVE.shot(page, language)
        page.close()

if __name__ == "__main__":
    raise SystemExit(DRIVE.run(drive, "a name reads in its own direction in either language"))
