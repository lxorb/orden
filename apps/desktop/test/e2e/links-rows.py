from __future__ import annotations

from playwright.sync_api import Browser

from harness import Drive

DRIVE = Drive(__file__)
say, wrong, wait_for = DRIVE.say, DRIVE.wrong, DRIVE.wait_for

HOLES = """() => {
  const ul = document.querySelector('.hit')?.closest('ul')
  if (!ul) return { rows: 0 }
  let box = ul.parentElement
  while (box && getComputedStyle(box).overflowY !== 'auto' && getComputedStyle(box).overflowY !== 'scroll') box = box.parentElement
  const room = box.getBoundingClientRect()
  const rows = [...ul.querySelectorAll(':scope > li[data-row]:not(.away)')]
  const seen = rows.filter((one) => { const b = one.getBoundingClientRect(); return b.bottom > room.top && b.top < room.bottom })
  let empty = 0
  for (let y = room.top + 4; y < room.bottom - 4; y += 6) {
    const at = document.elementFromPoint(room.left + room.width / 2, y)
    if (!at || !at.closest('li[data-row]')) empty++
  }
  return { rows: rows.length, seen: seen.length, empty, top: box.scrollTop, height: rows[0] ? Math.round(rows[0].getBoundingClientRect().height) : 0,
    first: seen[0]?.dataset.row, last: seen.at(-1)?.dataset.row }
}"""


def drive(browser: Browser) -> None:
    page = DRIVE.page(browser, viewport={"width": 1280, "height": 820})
    DRIVE.open(page)
    texts = ["# Heron\n\nThe target.\n"] + [f"# Bird {n:03d}\n\nSee [[Heron]] for the line about bird {n}.\n" for n in range(400)]
    DRIVE.seed(page, *texts)
    DRIVE.open_note(page, "Heron")
    page.evaluate("() => window.ordenApp.workspace.showPanel('links')")
    wait_for(page, "document.querySelectorAll('.hit').length > 5", "the backlinks")
    page.wait_for_timeout(500)
    say(f"at the top: {page.evaluate(HOLES)}")
    page.evaluate("""() => { const ul = document.querySelector('.hit').closest('ul'); let box = ul.parentElement
      while (getComputedStyle(box).overflowY !== 'auto' && getComputedStyle(box).overflowY !== 'scroll') box = box.parentElement
      box.scrollTop = 6000 }""")
    page.wait_for_timeout(400)
    mid = page.evaluate(HOLES)
    say(f"scrolled: {mid}")
    page.set_viewport_size({"width": 1180, "height": 700})
    page.wait_for_timeout(600)
    after = page.evaluate(HOLES)
    say(f"after a resize while scrolled: {after}")
    for name, one in (("scrolled", mid), ("resized", after)):
        if one.get("empty", 0) > 3:
            wrong(f"{name}: {one['empty']} empty strips in the Links list")
    DRIVE.shot(page, "links")
    page.context.close()


if __name__ == "__main__":
    raise SystemExit(DRIVE.run(drive, "the Links panel's rows stay in place"))
