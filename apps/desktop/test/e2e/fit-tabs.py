from __future__ import annotations

from playwright.sync_api import Browser

from harness import Drive

DRIVE = Drive(__file__)
say, wrong = DRIVE.say, DRIVE.wrong

STANDARD = 238

TABS = """() => [...document.querySelectorAll('.tab')].map((one) => {
  const label = one.querySelector('.label')
  return {
    name: label?.textContent.trim(),
    width: one.getBoundingClientRect().width,
    whole: label ? label.scrollWidth <= label.clientWidth + 1 : false,
    active: one.classList.contains('active'),
  }
})"""

def drive(browser: Browser) -> None:
    page = DRIVE.page(browser, viewport={"width": 1600, "height": 800})
    page.add_init_script("localStorage.setItem('nib:icon-tabs', 'no')")
    DRIVE.open(page)
    long = "A note whose name is far longer than any tab is wide"
    DRIVE.seed(page, "# Orden\n\nWords.\n", f"# {long}\n\nWords.\n")
    for name in ("Orden", long):
        DRIVE.open_note(page, name)
    DRIVE.open_note(page, "Orden")
    page.wait_for_timeout(800)

    DRIVE.shot(page, "fitted")
    tabs = {one["name"]: one for one in page.evaluate(TABS)}
    short = tabs.get("Orden")
    far = tabs.get(long)
    if not short or not far:
        wrong(f"the two notes are not both in the strip: {list(tabs)}")
        return
    say(f"on: Orden {short['width']:.0f}, the long one {far['width']:.0f}")
    if not short["width"] < STANDARD - 60:
        wrong(f"Orden's tab is {short['width']:.0f} wide, not as wide as its name")
    if not short["whole"]:
        wrong("Orden's tab does not show the whole of its name")
    if abs(far["width"] - STANDARD) > 1:
        wrong(f"the long name's tab is {far['width']:.0f}, not the standard {STANDARD}")

    page.add_init_script("localStorage.setItem('nib:fit-tabs', 'no')")
    page.reload()
    page.wait_for_timeout(1500)
    for name in ("Orden", long):
        DRIVE.open_note(page, name)
    page.wait_for_timeout(800)
    widths = [one["width"] for one in page.evaluate(TABS)]
    say(f"off: {[round(one) for one in widths]}")
    if any(abs(one - STANDARD) > 1 for one in widths):
        wrong(f"with the switch off the tabs are {widths}, not all the standard width")

if __name__ == "__main__":
    raise SystemExit(DRIVE.run(drive, "tabs as wide as their names"))
