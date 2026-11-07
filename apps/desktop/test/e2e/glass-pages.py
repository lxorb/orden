from __future__ import annotations

import io
import re

from PIL import Image
from playwright.sync_api import Browser, Page

import harness
from harness import Drive

DRIVE = Drive(__file__)
say, wrong, shot, wait_for = DRIVE.say, DRIVE.wrong, DRIVE.shot, DRIVE.wait_for

FLOOR = 4.5

def site(ground: str, header: str, theme: str | None, title: str) -> str:
    meta = f'<meta name="theme-color" content="{theme}">' if theme else ""
    ink = "#ffffff" if ground in ("#0f0f0f",) or header in ("#d32f2f",) else "#111111"
    return f"""<!doctype html><html><head><meta charset="utf-8">{meta}<title>{title}</title>
<style>
  html, body {{ margin: 0; background: {ground}; color: {ink}; font: 15px/1.5 system-ui, sans-serif; }}
  header {{ background: {header}; padding: 18px 24px; font-weight: 600; }}
  main {{ padding: 24px; max-width: 640px; }}
</style></head><body>
<header>{title}</header>
<main><p>A page standing on a colour of its own, for the frame to take.</p></main>
</body></html>"""

PROTON = """<!doctype html><html><head><meta charset="utf-8"><title>Thank you for installing Proton Pass</title>
<style>html, body { margin: 0; min-height: 100vh; color: #ffffff; font: 15px/1.5 system-ui, sans-serif; }
main { padding: 48px; }</style></head><body><main><h1>Welcome to your new password manager!</h1></main>
<script>setTimeout(() => {
  const meta = document.createElement('meta')
  meta.name = 'theme-color'
  meta.content = '#1b1340'
  document.head.append(meta)
  document.body.style.background = 'linear-gradient(#1b1340, #1d1c35 40%, #68556f)'
}, 600)</script></body></html>"""

PAGES = {
    "white": site("#ffffff", "#ffffff", None, "White"),
    "black": site("#0f0f0f", "#0f0f0f", None, "Black"),
    "red": site("#ffffff", "#d32f2f", "#d32f2f", "Red"),
    "yellow": site("#ffffff", "#ffeb3b", None, "Yellow"),
    "darkstale": site("#0f0f0f", "#0f0f0f", "rgba(255, 255, 255, 0.98)", "Dark, named white"),
    "lightstale": site("#ffffff", "#ffffff", "#23272f", "Light, named black"),
    "proton": PROTON,
}

TOPS = {
    "white": (255, 255, 255),
    "black": (15, 15, 15),
    "red": (211, 47, 47),
    "yellow": (255, 235, 59),
    "darkstale": (15, 15, 15),
    "lightstale": (255, 255, 255),
    "proton": (27, 19, 64),
}

DARK = {"black", "darkstale", "proton"}

LATE = {"proton": "#1b1340"}

HUED = {"proton": 12}
LIGHT = {"white", "lightstale"}

MIDDLE = 0.179

@DRIVE.answers
def pages(request: harness.Files) -> bool:
    name = re.fullmatch(r"/glass/(\w+)\.html", request.path.split("?", 1)[0])
    if name and name.group(1) in PAGES:
        return request.reply(PAGES[name.group(1)])
    if request.path == "/favicon.ico":
        return request.reply(b"", "image/x-icon", 404)
    return False

INK = """
(selector) => {
  const one = document.querySelector(selector)
  if (!one) return null
  const probe = document.createElement('span')
  probe.style.color = 'var(--muted)'
  one.append(probe)
  const said = getComputedStyle(probe).color
  probe.remove()
  const parts = (said.match(/[\\d.]+/g) ?? []).map(Number)
  const scale = said.startsWith('color(') ? 255 : 1
  return [parts[0] * scale, parts[1] * scale, parts[2] * scale]
}
"""

POINT = """
([selector, where]) => {
  const one = document.querySelector(selector)
  if (!one) return null
  const box = one.getBoundingClientRect()
  if (!box.width || !box.height) return null
  if (where === 'start') return [Math.round(box.left + 3), Math.round(box.top + box.height / 2)]
  if (where === 'below') return [Math.round(box.left + box.width / 2), Math.round(box.bottom + 2)]
  if (where === 'foot') return [Math.round(box.left + box.width / 2), Math.round(box.bottom - 6)]
  return [Math.round(box.left + box.width / 2), Math.round(box.top + box.height / 2)]
}
"""

BARE = """
() => {
  const bar = document.querySelector("header[data-chrome='top']")
  if (!bar) return null
  const box = bar.getBoundingClientRect()
  const y = Math.round(box.top + box.height / 2)
  for (let x = Math.round(box.right - 48); x > box.left; x -= 6) {
    const hit = document.elementFromPoint(x, y)
    if (hit && (hit === bar || hit.hasAttribute('data-tauri-drag-region'))) return [x, y]
  }
  return null
}
"""

def luminance(colour: tuple[float, ...]) -> float:
    def channel(one: float) -> float:
        value = one / 255
        return value / 12.92 if value <= 0.04045 else ((value + 0.055) / 1.055) ** 2.4

    r, g, b = colour[:3]
    return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)

def ratio(one: tuple[float, ...], two: tuple[float, ...]) -> float:
    high, low = sorted((luminance(one), luminance(two)), reverse=True)
    return round((high + 0.05) / (low + 0.05), 2)

def near(one: tuple[int, ...], two: tuple[int, ...], by: int = 6) -> bool:
    return all(abs(a - b) <= by for a, b in zip(one[:3], two[:3]))

def fresh(browser: Browser, scheme: str) -> Page:
    page = DRIVE.page(
        browser,
        viewport={"width": 1240, "height": 760},
        color_scheme=scheme,
        device_scale_factor=1,
        reduced_motion="reduce",
    )
    DRIVE.open(page)
    page.evaluate(f"() => window.nibApp.theme.setScheme('{scheme}')")
    page.evaluate("() => window.nibApp.theme.select('glass')")
    wait_for(page, "document.documentElement.hasAttribute('data-tinted')", "glass")
    page.evaluate("() => window.nibApp.workspace.showPanel('tree')")
    DRIVE.settled(page)
    return page

def open_site(page: Page, name: str) -> None:
    address = f"{DRIVE.origin}/glass/{name}.html"
    page.evaluate("(address) => window.nibApp.workspace.openPage(address)", address)
    wait_for(page, "document.querySelector('.web .card .nib-button')", f"the {name} card")
    page.click(".web .card .nib-button")
    wait_for(page, f"document.querySelector('iframe[data-web-tab]')?.src?.endsWith('/glass/{name}.html')", "the frame")
    wait_for(page, "document.querySelector('.webbar.grounded')", f"the {name} page's colour on its bar")
    if name in LATE:
        wait_for(
            page,
            f"document.querySelector('.webbar')?.style.getPropertyValue('--web-ground') === '{LATE[name]}'",
            f"the {name} page's colour once it has painted",
        )
    page.wait_for_timeout(300)
    DRIVE.settled(page)

def measure(page: Page, picture: Image.Image, where: str, selector: str, at: str = "middle") -> None:
    point = page.evaluate(BARE) if at == "bare" else page.evaluate(POINT, [selector, at])
    ink = page.evaluate(INK, selector)
    if point is None or ink is None:
        wrong(f"{where}: nothing at {selector}")
        return
    ground = picture.getpixel((point[0], point[1]))
    seen = ratio(tuple(ink), ground)
    if seen >= FLOOR:
        say(f"ok   {where}: quiet words {seen}:1 on {ground[:3]}")
    else:
        wrong(f"{where}: quiet words {seen}:1 on {ground[:3]}, under {FLOOR}")

def drive(browser: Browser) -> None:
    for scheme in ("light", "dark"):
        page = fresh(browser, scheme)
        for name in PAGES:
            open_site(page, name)
            path = shot(page, f"glass-{scheme}-{name}")
            picture = Image.open(io.BytesIO(path.read_bytes())).convert("RGB")

            label = f"[{scheme}, {name}]"
            measure(page, picture, f"{label} the title bar", "header[data-chrome='top'] .drag", "bare")
            measure(page, picture, f"{label} the list down the side", ".panels[data-chrome='start']", "foot")
            measure(page, picture, f"{label} the bar over the page", ".webbar", "start")

            frame = page.evaluate(BARE)
            if frame and name in DARK | LIGHT:
                seen = picture.getpixel((frame[0], frame[1]))
                dark = luminance(seen) <= MIDDLE
                if dark == (name in DARK):
                    say(f"ok   {label} the frame is {'dark' if dark else 'light'}: {seen[:3]}")
                else:
                    wrong(f"{label} the frame {seen[:3]} is not as {'dark' if name in DARK else 'light'} as the page")

            if frame and name in HUED:
                seen = picture.getpixel((frame[0], frame[1]))
                if seen[2] - seen[0] >= HUED[name]:
                    say(f"ok   {label} the frame wears the page's hue: {seen[:3]}")
                else:
                    wrong(f"{label} the frame {seen[:3]} is a grey over a coloured page")

            bar = page.evaluate(POINT, [".webbar", "start"])
            below = page.evaluate(POINT, [".webbar", "below"])
            if bar and below:
                upper = picture.getpixel((bar[0], bar[1]))
                lower = picture.getpixel((below[0], below[1]))
                top = TOPS[name]
                if name == "red":
                    say(f"     {label} the bar is {upper[:3]} over the page's {lower[:3]}: moved until its words read")
                elif near(upper, lower) and near(lower, top):
                    say(f"ok   {label} the bar runs into the page: {upper[:3]}")
                else:
                    wrong(f"{label} the bar {upper[:3]} is not the page's top {lower[:3]}")

        page.context.close()

if __name__ == "__main__":
    raise SystemExit(DRIVE.run(drive, "glass takes every page's colour and every word on it reads"))
