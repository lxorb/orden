import json
from playwright.sync_api import Browser
from harness import Drive

DRIVE = Drive(__file__)
say, wrong = DRIVE.say, DRIVE.wrong
BAND = 4
BANDED = f"""(() => {{
  const set = () => {{
    const root = document.documentElement
    if (!root) return false
    root.style.setProperty('--orden-band', '{BAND}px')
    root.dataset.ordenBand = ''
    return true
  }}
  if (!set()) new MutationObserver((_, watching) => set() && watching.disconnect()).observe(document, {{ childList: true }})
}})()"""
MEASURE = """() => {
  const layer = document.createElement('div')
  layer.style.cssText = 'position: fixed; inset: 0; pointer-events: none'
  document.body.append(layer)
  const screen = document.createElement('div')
  screen.className = 'orden-screen is-centred'
  screen.style.cssText = 'position: fixed; left: 50%; height: 100000px; pointer-events: none'
  document.body.append(screen)
  const box = (one) => one.getBoundingClientRect()
  const out = {
    tall: innerHeight,
    html: box(document.documentElement).height,
    body: box(document.body).height,
    layer: [box(layer).top, box(layer).bottom],
    screen: box(screen).bottom,
    contain: getComputedStyle(document.body).contain,
  }
  layer.remove()
  screen.remove()
  return out
}"""
def measured(browser: Browser, banded: bool) -> dict:
    context = browser.new_context(viewport={"width": 1100, "height": 700})
    if banded:
        context.add_init_script(BANDED)
    page = context.new_page()
    page.on("pageerror", lambda error: wrong(f"page error: {error}"))
    DRIVE.open(page)
    page.wait_for_timeout(300)
    out = page.evaluate(MEASURE)
    context.close()
    say(f"{'banded' if banded else 'native'}: {json.dumps(out)}")
    return out
def drive(browser: Browser) -> None:
    native = measured(browser, False)
    if native["body"] != native["tall"] or native["html"] != native["tall"]:
        wrong(f"with no band the window is not all the page's: {native}")
    if native["layer"] != [0, native["tall"]]:
        wrong(f"with no band a layer over everything does not fill the window: {native['layer']}")
    if native["contain"] != "none":
        wrong(f"with no band the page contains its layers: {native['contain']}")
    banded = measured(browser, True)
    shown = banded["tall"] - BAND
    if banded["body"] != shown:
        wrong(f"with a band the page is {banded['body']}px tall, not the {shown}px left above it")
    if banded["layer"] != [0, shown]:
        wrong(f"with a band a layer over everything reaches into it: {banded['layer']}, not [0, {shown}]")
    if banded["screen"] > shown:
        wrong(f"with a band a sheet reaches into it: its foot at {banded['screen']}, past {shown}")
raise SystemExit(DRIVE.run(drive))
