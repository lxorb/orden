from __future__ import annotations

import base64
import pathlib

from playwright.sync_api import sync_playwright

PUBLIC = pathlib.Path(__file__).resolve().parent.parent / "apps/desktop/public"
SOURCE = PUBLIC / "pass.svg"
ROUNDED = {"pass-32.png": 32, "pass-192.png": 192, "pass-256.png": 256, "pass-512.png": 512}
EDGE = {"pass-apple-touch.png": 180}


def drawn(page, svg: str, size: int, out: pathlib.Path) -> None:
    source = "data:image/svg+xml;base64," + base64.b64encode(svg.encode()).decode()
    page.set_viewport_size({"width": size, "height": size})
    page.set_content(
        f'<html><body style="margin:0;background:transparent"><img src="{source}" width="{size}" height="{size}" style="display:block"></body></html>'
    )
    page.wait_for_function("() => document.images[0].complete")
    page.screenshot(path=str(out), omit_background=True, clip={"x": 0, "y": 0, "width": size, "height": size})


def main() -> None:
    svg = SOURCE.read_text()
    edge = svg.replace('rx="164"', 'rx="0"')
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch()
        page = browser.new_page(device_scale_factor=1)
        for name, size in ROUNDED.items():
            drawn(page, svg, size, PUBLIC / name)
        for name, size in EDGE.items():
            drawn(page, edge, size, PUBLIC / name)
        browser.close()
    print("the Pass icon, every size")


if __name__ == "__main__":
    main()
