import importlib.util
import json
import sys
import harness
from harness import Drive

spec = importlib.util.spec_from_file_location("speed", harness.HERE / "speed.py")
assert spec and spec.loader
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
NEEDS = ("chromium",)
DRIVE = Drive(__file__, served=False, fresh=False)
PROBE = r"""
async () => {
  const ws = window.ordenApp.workspace
  const out = {}
  const path = '/Big/long.md'

  await ws.open(path)
  for (let spin = 0; spin < 240; spin++) {
    await window.__painted()
    if (ws.active?.path === path) break
  }

  const tab = ws.active
  const source = tab.doc
  out.bytes = source.length

  const heads = []
  {
    let at = 0
    for (const line of source.split('\n')) {
      if (/^#{1,6} /.test(line)) heads.push(at)
      at += line.length + 1
    }
  }
  out.headings = heads.length

  const into = async () => {
    if (!tab.reading) ws.toggleReading()
    for (let spin = 0; spin < 900; spin++) {
      await window.__painted()
      if (document.querySelector('.read #write')?.childElementCount) break
    }
    await window.__painted()
  }

  const outOf = async () => {
    if (tab.reading) ws.toggleReading()
    for (let spin = 0; spin < 900; spin++) {
      await window.__painted()
      if (document.querySelector('.cm-content')) break
    }
    await window.__painted()
  }

  const page = () => document.querySelector('.read #write')
  const box = () => document.querySelector('.read')?.closest('[tabindex]') ?? document.querySelector('.read')

  await into()

  const scroller = page()?.parentElement?.closest('*')
  const scrolled = (() => {
    let one = page()
    while (one && one.scrollHeight <= one.clientHeight) one = one.parentElement
    return one
  })()
  out.scroller = scrolled?.className ?? null

  if (scrolled) {
    const step = Math.max(200, scrolled.clientHeight - 40)
    for (let y = 0; y < scrolled.scrollHeight; y += step) {
      scrolled.scrollTop = y
      await window.__painted()
    }
    scrolled.scrollTop = 0
    await window.__painted()
    await window.__painted()
  }

  const held = page()
  const origin = held.getBoundingClientRect()
  out.blocks = [...held.children].map((one) => {
    const r = one.getBoundingClientRect()
    return [
      one.tagName,
      Math.round((r.left - origin.left) * 100) / 100,
      Math.round((r.top - origin.top) * 100) / 100,
      Math.round(r.width * 100) / 100,
      Math.round(r.height * 100) / 100,
    ]
  })
  out.pageHeight = Math.round(held.getBoundingClientRect().height)
  out.blockCount = out.blocks.length

  const picked = []
  for (let one = 0; one < 20; one++) {
    const index = Math.floor((one * (heads.length - 1)) / 19)
    picked.push(index)
  }

  const landings = []
  for (const index of picked) {
    const offset = heads[index]

    await outOf()
    ws.notePlace(tab.id, 0, offset)
    await window.__painted()

    await into()
    for (let spin = 0; spin < 30; spin++) await window.__painted()

    const now = page()
    const headings = [...now.children].filter((one) => /^H[1-6]$/.test(one.tagName) && one.id)
    const target = headings[index]
    const view = (() => {
      let one = now
      while (one && one.scrollHeight <= one.clientHeight) one = one.parentElement
      return one
    })()

    if (!target || !view) {
      landings.push({ index, error: null })
      continue
    }

    const error = Math.round(target.getBoundingClientRect().top - view.getBoundingClientRect().top)
    const back = tab.anchor ?? null
    landings.push({ index, error, wanted: offset, back, drift: back === null ? null : back - offset })
  }

  out.landings = landings
  out.worst = Math.max(...landings.map((one) => Math.abs(one.error ?? 9999)))
  out.headingsOnPage = [...page().children].filter((one) => /^H[1-6]$/.test(one.tagName) && one.id).length

  return out
}
"""
def main() -> int:
    tag = sys.argv[1] if len(sys.argv) > 1 else "now"
    if harness.OWN_BUILD:
        harness.build()
    lane = m.Lane("after", harness.DIST, "big")
    lane.start()
    try:
        with DRIVE.session(args=["--enable-precise-memory-info"]) as browser:
            lane.ready(browser)
            page = lane.page
            m.ready(page, lane)
            m.settled(page)
            got = page.evaluate(PROBE)
    finally:
        lane.stop()
    (DRIVE.shots / f"{tag}.json").write_text(json.dumps(got), encoding="utf-8")
    print(f"bytes {got['bytes']}  blocks {got['blockCount']}  headings in source {got['headings']}")
    print(f"headings on the page {got['headingsOnPage']}  page height {got['pageHeight']}")
    print(f"worst landing error {got['worst']} px")
    for one in got["landings"]:
        print(f"  heading {one['index']:>3}: error {one['error']} px, anchor drift {one.get('drift')}")
    return DRIVE.verdict()
raise SystemExit(main())
