from __future__ import annotations

import weakref
from collections.abc import Callable

LANDED = (
    "[...document.querySelectorAll('link[rel=stylesheet]')].every((one) => one.sheet)"
    " && [...document.querySelectorAll('style')]"
    ".every((one) => [...document.styleSheets].includes(one.sheet))"
)

UNLANDED = """
() => [
  ...[...document.querySelectorAll('link[rel=stylesheet]')].filter((one) => !one.sheet)
    .map((one) => one.getAttribute('href')),
  ...[...document.querySelectorAll('style')]
    .filter((one) => ![...document.styleSheets].includes(one.sheet))
    .map((one) => `<style id="${one.id}">`),
]
"""

MOVED_ON = """
document.fonts.status === 'loaded'
  && document.getAnimations().every((one) => one.playState !== 'running')
  && !document.querySelector('.nib-scrollbar.is-lit, .nib-scrollbar.is-settling')
"""
STILL = f"() => {LANDED} && {MOVED_ON}"

NO_SHEET: "weakref.WeakSet[object]" = weakref.WeakSet()

NO_CARET = """
  *, *::before, *::after { caret-color: transparent !important }
  .cm-cursor, .cm-cursorLayer, .cm-dropCursor { visibility: hidden !important }
"""

HIDE_CARET = (
    "document.addEventListener('DOMContentLoaded', function () {"
    " var style = document.createElement('style');"
    f" style.textContent = {NO_CARET!r};"
    " document.head.appendChild(style) })"
)

FOCUS = """
() => {
  const one = document.activeElement
  if (!one) return 'none'
  return `${one.tagName}.${one.className}#${one.id}[${one.getAttribute('aria-label') ?? ''}]`
}
"""

def quiet(page: object, settle: int = 90) -> None:
    try:
        still = f"() => {MOVED_ON}" if page in NO_SHEET else STILL
        page.wait_for_function(still, timeout=6000)  # type: ignore[attr-defined]
    except Exception:
        missing = page.evaluate(UNLANDED)  # type: ignore[attr-defined]
        if missing and page not in NO_SHEET:
            NO_SHEET.add(page)
            print(f"  a sheet never landed, what follows is drawn without it: {missing}", flush=True)

    was = page.evaluate(FOCUS)  # type: ignore[attr-defined]
    for _ in range(8):
        page.wait_for_timeout(settle)  # type: ignore[attr-defined]
        now = page.evaluate(FOCUS)  # type: ignore[attr-defined]
        if now == was:
            return
        was = now

def steady(
    page: object,
    take: Callable[[], bytes],
    said: Callable[[str], None] | None = None,
    what: str = "",
    tries: int = 8,
) -> bytes:
    quiet(page)

    last = take()
    for _ in range(tries):
        page.wait_for_timeout(60)  # type: ignore[attr-defined]
        now = take()
        if now == last:
            return now
        last = now

    if said:
        said(f"{what} never held still".strip())

    return last
