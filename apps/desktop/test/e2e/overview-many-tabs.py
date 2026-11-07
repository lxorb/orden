from __future__ import annotations

from playwright.sync_api import Browser

from harness import Drive

DRIVE = Drive(__file__)
say, wrong, wait_for = DRIVE.say, DRIVE.wrong, DRIVE.wait_for

TABS = 250

LONGEST = 1500

WATCH = """() => {
  window.__long = []
  new PerformanceObserver((list) => {
    for (const one of list.getEntries()) window.__long.push(Math.round(one.duration))
  }).observe({ type: 'longtask' })
}"""

def drive(browser: Browser) -> None:
    page = DRIVE.page(browser, viewport={"width": 1400, "height": 850})
    DRIVE.open(page)
    page.evaluate(
        f"""async () => {{
          const ws = window.ordenApp.workspace
          for (let i = 0; i < {TABS}; i++) ws.openBlank('T' + i, '# T' + i + '\\n\\nwords')
          await new Promise((done) => setTimeout(done, 50))
          ws.split('row')
          ws.split('column')
        }}"""
    )
    page.wait_for_timeout(2000)
    page.evaluate(WATCH)
    for round in range(2):
        page.evaluate("() => { window.__long = [] }")
        page.keyboard.press("Alt")
        page.wait_for_timeout(60)
        page.keyboard.press("Alt")
        wait_for(page, "document.documentElement.hasAttribute('data-overview')", "the overview")
        page.wait_for_timeout(2000)
        longest = max(page.evaluate("() => window.__long") or [0])
        say(f"round {round}: the longest task was {longest} ms")
        if longest > LONGEST:
            wrong(f"with {TABS} tabs the overview held the window for {longest} ms")
        page.keyboard.press("Escape")
        page.wait_for_timeout(1500)
    DRIVE.shot(page, "after")

if __name__ == "__main__":
    raise SystemExit(DRIVE.run(drive, f"the overview of {TABS} tabs never holds the window long"))
