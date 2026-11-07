from __future__ import annotations

from playwright.sync_api import Browser, Page

from harness import Drive

DRIVE = Drive(__file__)
say, wrong, wait_for = DRIVE.say, DRIVE.wrong, DRIVE.wait_for

LONG = "# Long\n\n" + "\n\n".join(
    f"Paragraph {at}: the heron waits at the edge of the water until the fish forgets it is there."
    for at in range(160)
)

TASKS = "# Chores\n\n" + "\n".join(f"- [ ] Chore number {at}" for at in range(120))

BARS = """() => {
  const named = (e) => e.tagName.toLowerCase() + [...e.classList]
    .filter((c) => !c.startsWith('svelte-')).slice(0, 3).map((c) => '.' + c).join('')
  const scrolls = (e) => {
    const s = getComputedStyle(e)
    return /auto|scroll/.test(s.overflowY) && e.clientHeight > 0 && e.scrollHeight > e.clientHeight + 1
  }
  const gutter = (e) => {
    const s = getComputedStyle(e)
    return Math.round(e.offsetWidth - e.clientWidth - parseFloat(s.borderLeftWidth) - parseFloat(s.borderRightWidth))
  }
  const all = [...document.querySelectorAll('*')].filter((e) => e.checkVisibility() && scrolls(e))
  const found = []
  const seen = []
  for (const e of all) {
    const own = e.classList.contains('orden-scrolls')
    const engine = gutter(e)
    seen.push(`${named(e)} ${own ? 'own' : 'engine'} ${engine}px`)
    if (own && engine > 0) found.push(`${named(e)}: its own bar beside the engine's ${engine}px one`)
    const styled = getComputedStyle(e, '::-webkit-scrollbar')
    if (own && styled.display !== 'none' && parseFloat(styled.width) > 0)
      found.push(`${named(e)}: a ${styled.width} engine bar where scrollbar-width is not read`)
    const box = e.getBoundingClientRect()
    for (let up = e.parentElement; up; up = up.parentElement) {
      if (!all.includes(up)) continue
      const outer = up.getBoundingClientRect()
      if (Math.abs(outer.right - box.right) < 24 && box.height > outer.height / 2)
        found.push(`${named(e)} scrolls inside ${named(up)}, which scrolls the same way at the same edge`)
      break
    }
  }
  return { found, seen }
}"""

def looked(page: Page, where: str) -> None:
    page.mouse.move(640, 420)
    page.wait_for_timeout(400)
    state = page.evaluate(BARS)
    say(f"{where}: {state['seen']}")
    for one in state["found"]:
        wrong(f"{where}: {one}")
    DRIVE.shot(page, where.replace(" ", "-"))

def drive(browser: Browser) -> None:
    page = DRIVE.page(browser, viewport={"width": 1280, "height": 820}, color_scheme="light")
    DRIVE.open(page)
    DRIVE.seed(page, LONG, TASKS)

    DRIVE.open_note(page, "Long")
    page.wait_for_timeout(500)
    looked(page, "a long note")
    box = page.locator(".cm-scroller").first.bounding_box()
    if box:
        page.mouse.move(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)
        page.mouse.wheel(0, 1200)
        page.wait_for_timeout(300)
    looked(page, "a long note scrolled")

    DRIVE.open_note(page, "Chores")
    page.wait_for_timeout(500)
    looked(page, "a long list")

    page.evaluate("() => window.ordenApp.workspace.createCanvas()")
    wait_for(page, "document.querySelector('.canvas, [data-canvas], .orden-canvas')", "the canvas", 20)
    page.wait_for_timeout(600)
    looked(page, "a canvas")

    page.evaluate("() => window.ordenApp.workspace.createPages()")
    page.wait_for_timeout(1500)
    looked(page, "a page note")

    page.keyboard.press("Control+Shift+P")
    wait_for(page, "() => !!document.querySelector('.palette ul li')", "the palette")
    page.wait_for_timeout(300)
    looked(page, "the palette")
    page.keyboard.press("Escape")
    page.wait_for_timeout(300)

    for section in ("general", "editor", "shortcuts", "appearance", "ai", "agents", "account", "sync", "import"):
        page.evaluate(f"() => window.ordenApp.settings.show('{section}')")
        page.wait_for_timeout(500)
        looked(page, f"settings {section}")
    page.keyboard.press("Escape")
    page.wait_for_timeout(300)

    DRIVE.open_note(page, "Long")
    page.evaluate("() => window.orden.focus()")
    page.keyboard.press("Control+Shift+A")
    page.wait_for_timeout(800)
    looked(page, "the ask panel")

if __name__ == "__main__":
    raise SystemExit(DRIVE.run(drive, "every place that scrolls shows one bar"))
