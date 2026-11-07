from __future__ import annotations

from typing import Any

from PIL import Image, ImageChops

from harness import Drive
from settling import HIDE_CARET, quiet
from shell import PHONE_AGENT, SEED, TABLET_AGENT

DRIVE = Drive(__file__)
say, wrong, wait_for = DRIVE.say, DRIVE.wrong, DRIVE.wait_for

SHEET = "document.getElementById('orden-user-theme')?.textContent ?? ''"

INSETS = """
(insets) => {
  for (const [side, px] of Object.entries(insets)) {
    document.documentElement.style.setProperty('--inset-' + side, px + 'px')
  }
}
"""

BOX = """
(selector) => {
  const one = document.querySelector(selector)
  if (!one) return null
  const box = one.getBoundingClientRect()
  const x = Math.max(0, Math.floor(box.left))
  const y = Math.max(0, Math.floor(box.top))
  const right = Math.min(innerWidth, Math.ceil(box.right))
  const bottom = Math.min(innerHeight, Math.ceil(box.bottom))
  const corner = parseFloat(getComputedStyle(one).borderTopLeftRadius) || 0
  return { x, y, width: right - x, height: bottom - y, corner: Math.ceil(corner * devicePixelRatio) }
}
"""

BARE = """
(selector) => {
  const kept = document.querySelector(selector)
  for (const one of document.body.querySelectorAll('*')) {
    if (one.contains(kept) || kept.contains(one)) continue
    one.style.setProperty('visibility', 'hidden', 'important')
  }
}
"""

GROUND_ONLY = """
(selector) => {
  for (const one of document.querySelector(selector).querySelectorAll('*')) {
    one.style.setProperty('visibility', 'hidden', 'important')
  }
}
"""

HANDHELDS = [
    ("phone", 390, 844, PHONE_AGENT, {"top": 47, "bottom": 34}),
    ("phone-side", 844, 390, PHONE_AGENT, {"left": 47, "right": 47, "bottom": 21}),
    ("tablet", 820, 1180, TABLET_AGENT, {"top": 24}),
]

JITTER = 50

def through(shown: Image.Image, bare: Image.Image, corner: int) -> int:
    difference = ImageChops.difference(shown.convert("RGB"), bare.convert("RGB"))
    width, height = difference.size
    changed = 0
    for y in range(height):
        for x in range(width):
            if (x < corner or x >= width - corner) and (y < corner or y >= height - corner):
                continue
            if max(difference.getpixel((x, y))) > 32:
                changed += 1
    return changed

def compare(page: Any, name: str, selector: str) -> None:
    quiet(page)
    box = page.evaluate(BOX, selector)
    if not box or box["width"] < 40 or box["height"] < 40:
        wrong(f"{name}: no sidebar to photograph ({box})")
        return
    corner = box.pop("corner")
    page.evaluate(GROUND_ONLY, selector)
    page.wait_for_timeout(120)
    shown = DRIVE.shot(page, f"{name}-1-shown", clip=box, animations="disabled")
    page.evaluate(BARE, selector)
    page.wait_for_timeout(120)
    bare = DRIVE.shot(page, f"{name}-2-bare", clip=box, animations="disabled")
    changed = through(Image.open(shown), Image.open(bare), corner)
    say(f"{name}: {box}, {changed} pixels show what is under it")
    if changed > JITTER:
        wrong(f"{name}: what is under the sidebar shows through it, {changed} pixels")

def wallpaper(page: Any) -> None:
    wait_for(page, "window.ordenApp.wallpaper", "the wallpaper store on the handle")
    page.evaluate("() => window.ordenApp.theme.select('wallpaper')")
    wait_for(page, f"{SHEET}.includes('--wallpaper-field')", "the wallpaper's sheet")

def handheld(browser: Any, name: str, width: int, height: int, agent: str, insets: dict, theme: str, side: str) -> None:
    page = DRIVE.page(
        browser,
        viewport={"width": width, "height": height},
        user_agent=agent,
        has_touch=True,
        is_mobile=True,
        device_scale_factor=2,
    )
    page.context.add_init_script(HIDE_CARET)
    DRIVE.open(page)
    page.evaluate(SEED)
    page.evaluate(INSETS, insets)
    if theme == "wallpaper":
        wallpaper(page)
    wait_for(page, "document.documentElement.hasAttribute('data-drawer')", "the sidebar a drawer")
    if side == "left":
        page.evaluate("() => window.ordenApp.workspace.showPanel('tree')")
        wait_for(page, "document.querySelector('.panels:not(.right)')?.classList.contains('open')", "the left drawer open")
        selector = ".panels:not(.right)"
    else:
        page.evaluate("() => { window.ordenApp.workspace.movePanel('outline', 'right'); window.ordenApp.workspace.showPanel('outline') }")
        wait_for(page, "document.querySelector('.panels.right')?.classList.contains('open')", "the right drawer open")
        selector = ".panels.right"
    page.wait_for_timeout(700)
    compare(page, f"{name}-{side}-{theme}", selector)
    page.context.close()

def desktop(browser: Any, theme: str) -> None:
    page = DRIVE.page(browser, viewport={"width": 1280, "height": 800}, color_scheme="light")
    page.context.add_init_script(HIDE_CARET)
    DRIVE.open(page)
    page.evaluate(SEED)
    if theme == "wallpaper":
        wallpaper(page)
    page.evaluate("() => { window.ordenApp.workspace.showPanel('tree'); window.ordenApp.workspace.panel = null }")
    wait_for(page, "window.ordenApp.workspace.panel === null", "the list shut")
    page.mouse.move(640, 400)
    page.wait_for_timeout(400)
    page.mouse.move(0, 400)
    wait_for(
        page,
        "(() => { const a = document.querySelector('.panels .column.floating aside');"
        " return !!a && getComputedStyle(a).transform === 'none' })()",
        "the list out at the edge",
    )
    page.wait_for_timeout(300)
    compare(page, f"desktop-peek-{theme}", ".panels .column.floating aside")
    page.context.close()

def drive(browser: Any) -> None:
    for theme in ("plain", "wallpaper"):
        for name, width, height, agent, insets in HANDHELDS:
            for side in ("left", "right"):
                handheld(browser, name, width, height, agent, insets, theme, side)
        desktop(browser, theme)

if __name__ == "__main__":
    raise SystemExit(DRIVE.run(drive))
