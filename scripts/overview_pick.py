from __future__ import annotations
import json
import pathlib
from typing import Any
from PIL import Image, ImageChops, ImageStat

COLOUR = (255, 0, 255)
CELLS = (16, 10)
FAR = 24.0
WIDE = 10
MOST = 0.6
LOG = """
(() => {
  window.__pick = { frames: [], puts: [] }
  const look = () => {
    const got = window.__pick
    if (!got) return
    got.frames.push([Date.now(), document.documentElement.hasAttribute('data-overview'), orden.workspace.activeTabId])
    requestAnimationFrame(look)
  }
  requestAnimationFrame(look)
  const pages = orden.pages
  if (!pages.__picked) {
    const put = pages.put
    pages.put = function (id, page, one) {
      window.__pick?.puts.push([Date.now(), id, one.visible, !!one.away, !!(one.cut && one.cut.all)])
      return put.call(this, id, page, one)
    }
    pages.__picked = true
  }
  return true
})()
"""
TAKE = "(() => { const got = window.__pick; window.__pick = null; return got })()"
TABS = """(() => {
  const ws = orden.workspace
  const web = ws.tabs.find((one) => one.kind === 'web')
  if (!web) return null
  const alone = (one) => ws.tabs.filter((other) => other.shown === one.shown).length === 1
  const near = () => ws.tabsIn(web.paneId).find((one) => one.kind !== 'web' && alone(one))
  if (!near()) {
    ws.openBlank('Beside', '# Beside\\n\\n' + 'Words beside the page. '.repeat(40))
    const made = ws.tabs.find((one) => one.shown === 'Beside')
    if (made && made.paneId !== web.paneId) ws.moveTab(made.id, web.paneId, ws.tabsIn(web.paneId).length)
    ws.activate(web.id)
  }
  const mate = near()
  const front = ws.tabs.find((one) => one.paneId !== web.paneId && one.kind !== 'web' && alone(one))
  const said = (one) => (one ? { id: one.id, name: one.shown } : null)
  return { web: said(web), mate: said(mate), other: said(front) }
})()"""
def bubble(name: str) -> str:
    return (
        "(() => { const one = [...document.querySelectorAll('.canvas .window')]"
        f".find((it) => it.getAttribute('aria-label') === {json.dumps(name)});"
        " const box = one?.getBoundingClientRect();"
        " return box && box.width > 0 ? { x: box.x + box.width / 2, y: box.y + box.height / 2 } : null })()"
    )
def small(image: Image.Image) -> Image.Image:
    return image.convert("L").resize((CELLS[0] * 20, CELLS[1] * 20))
def cells(a: Image.Image, b: Image.Image) -> list[float]:
    return list(ImageChops.difference(a, b).resize(CELLS, Image.Resampling.BOX).getdata())
def distinct(smalls: list[Image.Image]) -> list[int]:
    kept = [0]
    for i in range(1, len(smalls)):
        if max(cells(smalls[kept[-1]], smalls[i])) >= 1:
            kept.append(i)
    return kept
def flashes(smalls: list[Image.Image], kept: list[int]) -> list[tuple[int, int]]:
    found: list[tuple[int, int]] = []
    for length in (1, 2, 3):
        for k in range(1, len(kept) - length):
            before, after = smalls[kept[k - 1]], smalls[kept[k + length]]
            across = cells(before, after)
            inside = [cells(before, smalls[kept[k + n]]) for n in range(length)]
            back = [cells(smalls[kept[k + n]], after) for n in range(length)]
            far = 0
            for cell in range(len(across)):
                left = min(one[cell] for one in inside)
                right = min(one[cell] for one in back)
                if min(left, right) > FAR and across[cell] < min(left, right) / 3:
                    far += 1
            if far >= WIDE and not any(start <= kept[k] < start + span for start, span in found):
                found.append((kept[k], length))
    return found
def painted(image: Image.Image, hole: tuple[float, float, float, float]) -> int:
    left, top, right, bottom = hole
    side = 20
    spots = [(left + 8, top + 8), (right - 60, top + 8), (left + 8, bottom - 28), (right - 60, bottom - 28)]
    return sum(
        all(abs(channel - COLOUR[k]) < 40 for k, channel in enumerate(ImageStat.Stat(image.crop((int(x), int(y), int(x) + side, int(y) + side))).mean[:3]))
        for x, y in spots
    )
def judged(
    name: str,
    frames: list[tuple[float, Image.Image]],
    log: Any,
    clicked: float,
    hole: tuple[float, float, float, float],
    chosen: str,
    left: str,
    page: bool,
    out: pathlib.Path,
) -> tuple[list[str], dict[str, Any]]:
    wrong: list[str] = []
    folder = out / name
    folder.mkdir(parents=True, exist_ok=True)
    log = log if isinstance(log, dict) else {"frames": [], "puts": [], "said": log}
    after = [(at, one) for at, one in frames if at >= clicked - 50]
    for index, (_, one) in enumerate(after):
        one.resize((one.width // 2, one.height // 2)).save(folder / f"{index:03d}.jpg", quality=80)
    smalls = [small(one) for _, one in after]
    kept = distinct(smalls) if smalls else []
    flashed = flashes(smalls, kept)
    jumps = sum(
        sum(one > FAR for one in cells(smalls[kept[k - 1]], smalls[kept[k]])) > MOST * CELLS[0] * CELLS[1]
        for k in range(1, len(kept))
    )
    for i, length in flashed:
        wrong.append(f"[{name}] frames {i}-{i + length - 1} flash")
    ups = [(at, bool(on)) for at, on, *_ in log.get("frames", [])]
    gone = next((at for at, on in ups if at > clicked and not on), None)
    if gone is None:
        wrong.append(f"[{name}] the overview did not go away after the pick")
    front = next((one[2] for one in reversed(log.get("frames", [])) if len(one) > 2), None)
    if front != chosen:
        wrong.append(f"[{name}] the tab in front is {front}, not the one picked, {chosen}")
    stale = [i for i, (at, one) in enumerate(after) if gone is not None and at > gone + 100 and painted(one, hole) >= 3]
    put_back = [one for one in log.get("puts", []) if one[0] > clicked and one[1] == left and one[2] and not one[3] and not one[4]]
    shown = bool(after) and painted(after[-1][1], hole) >= 3
    if page and not shown:
        wrong.append(f"[{name}] the picked page is not shown in its pane at the end")
    if not page:
        if stale:
            wrong.append(f"[{name}] the page of the tab left is drawn over the tab picked in {len(stale)} frames")
        if put_back:
            wrong.append(f"[{name}] the page of the tab left was put back {len(put_back)} times")
    row = {
        "pick": name,
        "frames": len(after),
        "drawn anew": len(kept),
        "flashes": len(flashed),
        "jumps": jumps,
        "picked in front": front == chosen,
        "old page frames": 0 if page else len(stale),
        "old page put back": 0 if page else len(put_back),
        "page shown at the end": shown,
    }
    print(f"[{name}] {json.dumps(row)}", flush=True)
    (folder / "log.json").write_text(json.dumps({"clicked": clicked, "times": [at for at, _ in after], "row": row, **log}, indent=1), encoding="utf-8")
    return wrong, row
