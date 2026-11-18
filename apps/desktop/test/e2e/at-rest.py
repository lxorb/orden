from playwright.sync_api import Browser, Page

from harness import Drive

DRIVE = Drive(__file__)
say, wrong, wait_for = DRIVE.say, DRIVE.wrong, DRIVE.wait_for

SETTLED = 10_000

MOVING = """() => document.getAnimations()
  .filter((one) => one.playState === 'running')
  .map((one) => {
    const on = one.effect && one.effect.target
    const where = on ? `${on.tagName.toLowerCase()}.${[...on.classList].join('.')}` : 'nothing'
    const endless = one.effect.getComputedTiming().endTime === Infinity
    return `${one.animationName || one.transitionProperty || one.id || 'an animation'} on ${where}${endless ? ', without end' : ''}`
  })"""

def still(page: Page, where: str) -> None:
    endless = [one for one in page.evaluate(MOVING) if one.endswith("without end")]
    say(f"{where}, as it opens, endless: {endless}")
    if endless:
        wrong(f"{where} runs an animation that never ends: {endless}")
    page.wait_for_timeout(SETTLED)
    moving = page.evaluate(MOVING)
    say(f"{where}, {SETTLED // 1000} s on: {moving}")
    if moving:
        wrong(f"{where} still moves while it waits: {moving}")

def drive(browser: Browser) -> None:
    page = DRIVE.page(browser, viewport={"width": 1240, "height": 800})
    DRIVE.open(page)
    DRIVE.seed(page, "# Resting\n\nWords that sit still.\n")
    DRIVE.open_note(page, "Resting")
    page.evaluate("() => document.activeElement && document.activeElement.blur()")
    wait_for(page, "!document.querySelector('.cm-focused')", "the note to let go of the caret")
    page.wait_for_timeout(300)
    still(page, "the window with a note open")

    page.evaluate("() => { window.ordenApp.setup.showing = true }")
    wait_for(page, "!!document.querySelector('.setup[data-step=\"account\"] .stage')", "the setup screen")
    DRIVE.shot(page, "setup")
    still(page, "the setup screen")
    DRIVE.shot(page, "setup-settled")

raise SystemExit(DRIVE.run(drive, "nothing moves on a screen that waits"))
