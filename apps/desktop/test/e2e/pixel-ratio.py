from __future__ import annotations

from harness import Drive
from shell import SEED

DRIVE = Drive(__file__)
say, wrong = DRIVE.say, DRIVE.wrong

SIZE = {"width": 1200, "height": 800}

CANVASES = """
() => [...document.querySelectorAll('canvas')]
  .filter((one) => one.clientWidth > 20)
  .map((one) => ({
    name: String(one.className).split(' ')[0] || one.parentElement?.className.toString().split(' ')[0],
    drawn: one.width / one.clientWidth,
    screen: devicePixelRatio,
  }))
"""

TOLD = """
() => {
  const asked = []
  const real = window.matchMedia.bind(window)
  window.matchMedia = (query) => {
    const list = real(query)
    if (query.includes('resolution')) asked.push(list)
    return list
  }
  window.screenMoved = () => {
    const now = asked.splice(0)
    for (const list of now) list.dispatchEvent(new Event('change'))
    return now.length
  }
}
"""

SURFACES = [
    ("graph", "() => window.ordenApp.workspace.openGraph()"),
    ("canvas", "() => void window.ordenApp.workspace.createCanvas()"),
]

def look(page, moment: str) -> None:
    found = page.evaluate(CANVASES)
    say(f"{moment}: {[(one['name'], round(one['drawn'], 2), one['screen']) for one in found]}")
    if not found:
        wrong(f"{moment}: no canvas to look at")
    for one in found:
        wanted = (one["screen"], min(2, one["screen"]))
        if all(abs(one["drawn"] - want) > 0.05 for want in wanted):
            wrong(
                f"{moment}: the {one['name']} canvas draws {one['drawn']:.2f} pixels a point"
                f" on a screen of {one['screen']}"
            )

def main() -> int:
    with DRIVE.session() as browser:
        context = browser.new_context(viewport=SIZE, device_scale_factor=1)
        page = context.new_page()
        page.add_init_script(f"({TOLD})()")
        screen = context.new_cdp_session(page)
        DRIVE.open(page)
        page.evaluate(SEED)
        page.wait_for_timeout(800)

        def scale(factor: float) -> None:
            screen.send(
                "Emulation.setDeviceMetricsOverride",
                {**SIZE, "deviceScaleFactor": factor, "mobile": False},
            )
            told = page.evaluate("() => window.screenMoved()")
            say(f"moved to a screen of {factor}, {told} listening")
            page.wait_for_timeout(1200)

        for name, opening in SURFACES:
            scale(1)
            page.evaluate(opening)
            page.wait_for_timeout(2000)
            look(page, f"{name} on a screen of 1")
            scale(2)
            look(page, f"{name} moved to a screen of 2")
            scale(1.5)
            look(page, f"{name} moved to a screen of 1.5")
        context.close()

    return DRIVE.verdict("a canvas follows the screen it is moved to")

if __name__ == "__main__":
    raise SystemExit(main())
