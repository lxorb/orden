import json
from harness import Drive

DRIVE = Drive(__file__)
say, wrong, shot, wait_for = DRIVE.say, DRIVE.wrong, DRIVE.shot, DRIVE.wait_for
NOTE = "# Today\n\ntoday:\n- [ ] numcs (20min)\n- [x] numcs (20min)\n\nend\n"
SEED = """
async ([note]) => {
  const ws = window.ordenApp.workspace
  await ws.noteFrom(note, ws.activeSpace.root)
  await ws.loadTree()
  const one = ws.notes.find((entry) => entry.name.startsWith('Today'))
  await ws.openEntry(one.path, { activate: true })
}
"""
MEASURE = """() => {
  const rgb = (said) => (said.match(/[\\d.]+/g) ?? []).map(Number)
  const lum = ([r, g, b]) => {
    const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4 }
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
  }
  const ground = (node) => {
    for (let at = node; at; at = at.parentElement) {
      const [r, g, b, a = 1] = rgb(getComputedStyle(at).backgroundColor)
      if (a > 0.5 && r !== undefined) return [r, g, b]
    }
    return null
  }
  const boxes = [...document.querySelectorAll('.cm-content input.orden-checkbox')].map((box) => {
    const r = box.getBoundingClientRect()
    const border = rgb(getComputedStyle(box).borderTopColor)
    const under = ground(box.parentElement)
    const ratio = under ? (Math.max(lum(border), lum(under)) + 0.05) / (Math.min(lum(border), lum(under)) + 0.05) : null
    return { checked: box.checked, w: r.width, h: r.height, top: Math.round(r.top - box.closest('.cm-line').getBoundingClientRect().top), right: r.right, ratio }
  })
  const caret = document.querySelector('.cm-cursor')?.getBoundingClientRect()
  const view = window.orden
  const words = view.coordsAtPos(view.state.doc.toString().indexOf('numcs'), 1)
  return { boxes, caret: caret ? caret.left : null, words: words ? words.left : null }
}"""
def look(browser, theme: str, scheme: str) -> None:
    context = browser.new_context(viewport={"width": 700, "height": 360}, color_scheme=scheme, device_scale_factor=2)
    page = context.new_page()
    DRIVE.open(page)
    page.evaluate(f"() => {{ window.ordenApp.theme.setScheme('{scheme}'); window.ordenApp.theme.select('{theme}') }}")
    page.evaluate(SEED, [NOTE])
    wait_for(page, "document.querySelectorAll('.cm-content input.orden-checkbox').length === 2", "the boxes")
    page.wait_for_timeout(700)
    page.evaluate("() => { const v = window.orden; const at = v.state.doc.toString().indexOf('numcs'); v.focus(); v.dispatch({ selection: { anchor: at }, userEvent: 'select' }) }")
    page.wait_for_timeout(400)
    seen = page.evaluate(MEASURE)
    label = f"{theme}-{scheme}"
    say(f"[{label}] {json.dumps(seen)}")
    open_box, done_box = seen["boxes"]
    if (open_box["w"], open_box["h"], open_box["top"]) != (done_box["w"], done_box["h"], done_box["top"]):
        wrong(f"[{label}] the open and the done box differ: {open_box} {done_box}")
    if open_box["ratio"] is not None and open_box["ratio"] < 1.8:
        wrong(f"[{label}] the open box's edge is too faint to see: contrast {open_box['ratio']:.2f}")
    caret, words = seen["caret"], seen["words"]
    if caret is None or not (open_box["right"] + 1 < caret < words - 1):
        wrong(f"[{label}] the caret at the start of the words is not in the gap after the box: box ends {open_box['right']}, caret {caret}, words {words}")
    shot(page, label)
    context.close()
def main() -> int:
    with DRIVE.session() as browser:
        for theme in ("default", "contrast", "glass", "wallpaper"):
            for scheme in ("light", "dark"):
                look(browser, theme, scheme)
    return DRIVE.verdict("a task's box shows in every look, open or done alike, and the caret waits in the gap after it")
raise SystemExit(main())
