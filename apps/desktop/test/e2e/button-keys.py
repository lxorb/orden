import json
from playwright.sync_api import Browser
from harness import Drive

DRIVE = Drive(__file__)
say, wrong = DRIVE.say, DRIVE.wrong
FLOOR = 4.5
PLACE = """() => {
  document.getElementById('button-keys')?.remove()
  const row = document.createElement('div')
  row.id = 'button-keys'
  row.style.cssText = 'position: fixed; left: 40px; top: 120px; z-index: 99999; display: flex; gap: 12px; padding: 16px; background: var(--bg)'
  for (const kind of ['', 'is-quiet', 'is-quiet is-soft', 'is-danger']) {
    const button = document.createElement('button')
    button.className = `orden-button ${kind}`.trim()
    button.innerHTML = 'Create <kbd class="orden-keys">⌘↩</kbd>'
    row.append(button)
  }
  document.body.append(row)
  const parse = (said) => {
    const parts = (said.match(/[\\d.]+/g) ?? []).map(Number)
    const scale = said.startsWith('color(') ? 255 : 1
    return { rgb: parts.slice(0, 3).map((one) => one * scale), alpha: parts.length > 3 ? parts[3] : 1 }
  }
  const lum = ([r, g, b]) => {
    const ch = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4 }
    return 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b)
  }
  const over = (top, under) => top.rgb.map((one, at) => one * top.alpha + under[at] * (1 - top.alpha))
  const page = parse(getComputedStyle(row).backgroundColor).rgb
  return [...row.querySelectorAll('button')].map((button) => {
    const keys = button.querySelector('.orden-keys')
    const ground = over(parse(getComputedStyle(button).backgroundColor), page)
    const pill = over(parse(getComputedStyle(keys).backgroundColor), ground)
    const ink = parse(getComputedStyle(keys).color).rgb
    const ratio = (one, two) => { const [high, low] = [lum(one), lum(two)].sort((a, b) => b - a); return Math.round(((high + 0.05) / (low + 0.05)) * 100) / 100 }
    const words = parse(getComputedStyle(button).color).rgb
    const ring = parse(getComputedStyle(keys).boxShadow.replace(/ inset.*/, ''))
    return { kind: button.className, keys: ratio(ink, pill), words: ratio(words, ground), ring: ring.alpha, mono: getComputedStyle(keys).fontFamily.startsWith('"iA Writer Mono') }
  })
}"""
def drive(browser: Browser) -> None:
    for scheme in ("light", "dark"):
        for look in ("default", "contrast", "glass"):
            page = DRIVE.page(browser, viewport={"width": 1100, "height": 700}, color_scheme=scheme)
            DRIVE.open(page)
            page.evaluate(f"() => {{ window.ordenApp.theme.setScheme('{scheme}'); window.ordenApp.theme.select('{look}') }}")
            page.wait_for_timeout(600)
            found = page.evaluate(PLACE)
            page.wait_for_timeout(200)
            DRIVE.shot(page, f"keys-{look}-{scheme}", clip={"x": 30, "y": 110, "width": 620, "height": 80})
            for one in found:
                say(f"[{look}, {scheme}] {json.dumps(one)}")
                if one["keys"] < min(FLOOR, one["words"]) - 0.01:
                    wrong(f"[{look}, {scheme}] the keys in '{one['kind']}' read at {one['keys']}:1, worse than its words at {one['words']}:1")
                if not one["mono"] or not one["ring"]:
                    wrong(f"[{look}, {scheme}] the keys in '{one['kind']}' are not the mono pill: {one}")
            page.context.close()
raise SystemExit(DRIVE.run(drive, "the keys in a button read on every kind of button, light and dark, in every built-in theme"))
