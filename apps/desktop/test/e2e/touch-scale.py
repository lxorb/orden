from __future__ import annotations

import json
import sys

from playwright.sync_api import Browser, Page

from harness import Drive

DRIVE = Drive(__file__, fresh=False)
say, shot, wait_for = DRIVE.say, DRIVE.shot, DRIVE.wait_for
ORIGIN = DRIVE.origin
SHOTS = DRIVE.shots

PATIENCE = 40

PREPARE = """
window.__TAURI_OS_PLUGIN_INTERNALS__ = {
  platform: 'android', family: 'unix', os_type: 'android',
  version: '15.0.0', arch: 'aarch64', exe_extension: '', eol: '\\n',
};
window.__ORDEN_SYSTEM__ = {
  insets: () => JSON.stringify({ top: 24, right: 0, bottom: 24, left: 0 }),
  bars: () => {},
};
"""

AS_DEVICE = """
([device, portrait, narrow]) => {
  const app = window.ordenApp
  app.viewport.device = device
  app.viewport.portrait = portrait
  app.viewport.narrow = narrow
  const drawer = device === 'phone' || (device === 'tablet' && portrait)
  const root = document.documentElement
  root.dataset.device = device
  root.toggleAttribute('data-touch', device !== 'desktop')
  root.toggleAttribute('data-drawer', drawer)
  root.toggleAttribute('data-narrow', narrow)
  if (window.__nibInsets) window.__nibInsets()
}
"""

SEED = """
async () => {
  const ws = window.ordenApp.workspace
  const root = ws.activeSpace.root
  const at = (name) => (root.endsWith('/') ? root + name : root + '/' + name)

  if (ws.panel !== 'tree') ws.showPanel('tree')

  await ws.noteFrom('# Deep work\\n\\n## Mornings\\n\\n### Before eight\\n\\nthe first line\\n', root)
  await ws.noteFrom('# Meeting notes\\n\\nwho said what, and a [[Deep work]] link\\n', root)
  await ws.noteFrom('# Chapter one\\n\\nreading, #work and #work/orden\\n', at('Reading'))
  const paper = await ws.noteFrom('# paper\\n', at('Reading'))
  await ws.rename(paper, 'Deep Learning.pdf')
  await ws.noteFrom('# Archived\\n\\nolder words\\n', at('Reading/Archive'))
  // Named outright: with a name in hand the file is written at once, rather than a
  // row waiting to be typed into. See `createCanvas`.
  await ws.createCanvas(root, 'Roadmap.canvas')

  ws.bookmarks.toggle({ kind: 'note', path: 'Deep work.md', text: '' })
  ws.bookmarks.toggle({ kind: 'search', path: '', text: 'the' })

  ws.toggleFolder(at('Reading'))
  await ws.openEntry(at('Deep work.md'))
  return ws.tree.children.map((one) => one.name)
}
"""

MEASURE = """(specs) => {
  const round = (n) => Math.round(n * 10) / 10
  return specs.map(([name, sel]) => {
    let el = null
    try { el = document.querySelector(sel) } catch { el = null }
    if (!el) return [name, null]
    const r = el.getBoundingClientRect()
    const cs = getComputedStyle(el)
    const num = (v) => (v === 'normal' ? 0 : parseFloat(v) || 0)
    const icon = el.querySelector('svg')
    const box = icon && icon.getBoundingClientRect()
    return [name, {
      w: round(r.width), h: round(r.height),
      font: num(cs.fontSize),
      gap: num(cs.columnGap),
      pl: num(cs.paddingLeft), pr: num(cs.paddingRight), pb: num(cs.paddingBottom),
      icon: box ? round(Math.max(box.width, box.height)) : null,
    }]
  })
}"""

PROFILES = [
    ("phone", 390, 844, 3, "phone", True, True),
    ("tablet-portrait", 820, 1180, 2, "tablet", True, False),
    ("tablet-landscape", 1180, 820, 2, "tablet", False, False),
    ("desktop", 1440, 900, 1, "desktop", False, False),
]

CHROME = [
    ["sidebar", "aside"],
    ["sidebar tabs strip", "aside .switch"],
    ["sidebar panel tab", "aside .switch button"],
    ["sidebar tab icon", "aside .switch button svg"],
    ["sidebar body", "aside .body"],
    ["tree row", "aside .row"],
    ["tree row twist", "aside .row .twist"],
    ["tree file mark", "aside .row .mark"],
    ["rail", "nav"],
    ["rail space square", "nav .space"],
    ["rail add", "nav .add"],
    ["rail foot glyph", "nav .foot .add svg"],
    ["titlebar", "header"],
    ["titlebar drawer toggle", "header .toggle"],
    ["titlebar title", "header .title"],
    ["titlebar more", "header .more"],
    ["status bar", "footer"],
    ["titlebar search", "header .search"],
]

PANELS = {
    "outline": [["outline row", "aside .row.heading"]],
    "search": [
        ["search field", "aside .query"],
        ["search hit", "aside .hit"],
        ["search tick", "aside .tick"],
    ],
    "links": [["links hit", "aside .hit"], ["links line", "aside .hit-line"]],
}

TAGS = [
    ["tag row", "aside .line .row"],
    ["tag twist", "aside .twist"],
    ["search find bar row", "aside .find .row"],
    ["find bar field", ".findbar .orden-field"],
    ["find bar step", ".findbar .act"],
    ["find bar flag", ".findbar .flag"],
]
MARKS = [["bookmark row", "aside .row"], ["bookmark icon", "aside .row svg"]]

PALETTE = [
    ["palette", ".palette"],
    ["palette input", ".palette input"],
    ["palette row", ".palette ul li button"],
]

BROWSE = [
    ["palette browse row", ".palette ul li button"],
    ["palette browse head", ".palette .orden-section"],
]

CONTEXT = [
    ["context menu", ".menu"],
    ["context menu row", ".menu button"],
    ["context menu title", ".menu .title"],
]

SETTINGS = [
    ["settings sheet", ".sheet"],
    ["settings bar", ".sheet .bar"],
    ["settings bar icon", ".sheet .bar .icon"],
    ["settings search", ".sheet .search"],
    ["settings nav row", ".sheet .item"],
    ["settings nav glyph", ".sheet .item .glyph"],
    ["settings search field", ".sheet .search input"],
]

PRESS = """
(selector) => {
  const node = document.querySelector(selector)
  if (!node) return false
  const box = node.getBoundingClientRect()
  const at = { clientX: box.left + 20, clientY: box.top + box.height / 2 }
  const touch = new Touch({ identifier: 1, target: node, ...at })
  const send = (kind) =>
    node.dispatchEvent(new TouchEvent(kind, {
      touches: kind === 'touchend' ? [] : [touch],
      targetTouches: kind === 'touchend' ? [] : [touch],
      changedTouches: [touch], bubbles: true, cancelable: true,
    }))
  send('touchstart')
  window.__nibRelease = () => send('touchend')
  return true
}
"""

def measure(page: Page, specs) -> dict:
    return dict(page.evaluate(MEASURE, specs))

def open_drawer(page: Page) -> None:
    page.evaluate("() => { const ws = window.ordenApp.workspace; if (!ws.panel) ws.showPanel('tree') }")
    page.wait_for_timeout(350)

def shut_drawer(page: Page) -> None:
    page.evaluate(
        "() => { const ws = window.ordenApp.workspace; ws.closePanel(); ws.closePanel('right') }"
    )
    page.wait_for_timeout(400)

def run(label: str) -> int:
    found: dict[str, dict] = {}

    with DRIVE.session() as browser:
        for name, width, height, scale, device, portrait, narrow in PROFILES:
            for scheme in ("dark", "light"):
                say(f"[{name}] {width}x{height} at {scale}x, a {device}, {scheme}")
                seen = one(
                    browser,
                    label,
                    name,
                    width,
                    height,
                    scale,
                    device,
                    portrait,
                    narrow,
                    scheme,
                )
                if scheme == "dark":
                    found[name] = seen

    (SHOTS / f"{label}.json").write_text(json.dumps(found, indent=2), encoding="utf8")
    say(f"wrote {label}.json")
    report(label)
    return DRIVE.verdict()

def one(
    browser: Browser, label, name, width, height, scale, device, portrait, narrow, scheme
) -> dict:
    touch = device != "desktop"
    context = browser.new_context(
        viewport={"width": width, "height": height},
        device_scale_factor=scale,
        has_touch=touch,
        is_mobile=touch,
        color_scheme=scheme,
    )
    page = context.new_page()
    page.on("pageerror", lambda error: say(f"[{name}] page error: {error}"))
    context.add_init_script(PREPARE)
    DRIVE.open(page)
    page.evaluate("() => { for (let i = 0; i < 8; i++) history.pushState({ spare: i }, '') }")
    page.evaluate(AS_DEVICE, [device, portrait, narrow])
    page.wait_for_timeout(200)
    say(f"[{name}] the space holds {page.evaluate(SEED)}")
    page.evaluate(AS_DEVICE, [device, portrait, narrow])
    open_drawer(page)
    wait_for(page, "() => document.querySelectorAll('aside .row').length >= 2", "the rows")
    page.wait_for_timeout(500)

    rows: dict = {
        "device": page.evaluate("() => document.documentElement.dataset.device"),
        "touch": page.evaluate("() => document.documentElement.hasAttribute('data-touch')"),
        "tokens": page.evaluate(
            "() => Object.fromEntries(['--touch-target','--touch-row','--touch-text',"
            "'--touch-icon','--touch-mark','--touch-gap','--touch-pad','--touch-indent',"
            "'--touch-bottom','--swipe-edge'].map((k) => "
            "[k, getComputedStyle(document.documentElement).getPropertyValue(k).trim()]))"
        ),
    }

    open_drawer(page)
    rows.update(measure(page, CHROME))
    rows.update(measure(page, MARKS))
    rows["tree indent step"] = page.evaluate(
        "() => { const rows = [...document.querySelectorAll('aside .row')];"
        " const at = (r) => parseFloat(getComputedStyle(r).paddingLeft);"
        " const deep = rows.filter((r) => at(r) > at(rows[0]));"
        " return deep.length ? at(deep[0]) - at(rows[0]) : null }"
    )
    shot(page, f"{label}-{name}-tree-{scheme}")

    for panel, specs in PANELS.items():
        page.evaluate("(p) => window.ordenApp.workspace.showPanel(p)", panel)
        page.wait_for_timeout(500)
        if panel == "search":
            rows.update(measure(page, TAGS))
            page.evaluate("() => { window.ordenApp.search.replacing = true }")
            page.evaluate("() => window.ordenApp.search.ask('the')")
            page.wait_for_timeout(900)
        rows.update(measure(page, specs))
        if panel == "search":
            shot(page, f"{label}-{name}-search-{scheme}")
    page.evaluate("() => window.ordenApp.workspace.showPanel('tree')")
    page.wait_for_timeout(400)

    page.keyboard.press("Control+o")
    page.wait_for_timeout(400)
    page.keyboard.type(">")
    page.wait_for_timeout(700)
    rows.update(measure(page, PALETTE))
    shot(page, f"{label}-{name}-palette-{scheme}")
    page.keyboard.press("Escape")
    page.wait_for_timeout(300)

    shut_drawer(page)
    if page.locator("header .search").count():
        page.click("header .search")
    else:
        page.keyboard.press("Control+o")
    page.wait_for_timeout(600)
    rows.update(measure(page, BROWSE))
    shot(page, f"{label}-{name}-browse-{scheme}")
    page.keyboard.press("Escape")
    page.wait_for_timeout(300)

    open_drawer(page)
    page.wait_for_timeout(200)
    if touch:
        if page.evaluate(PRESS, "aside .row"):
            page.wait_for_selector('[role="menu"]:visible', timeout=5000)
            page.evaluate("() => window.__nibRelease?.()")
            page.wait_for_timeout(300)
    else:
        page.locator("aside .row").first.click(button="right")
        page.wait_for_timeout(400)
    rows.update(measure(page, CONTEXT))
    shot(page, f"{label}-{name}-context-{scheme}")
    page.keyboard.press("Escape")
    page.wait_for_timeout(300)

    page.evaluate("() => window.ordenApp.settings.show()")
    page.wait_for_selector(".orden-screen.sheet", timeout=15000)
    page.wait_for_timeout(900)
    rows.update(measure(page, SETTINGS))
    shot(page, f"{label}-{name}-settings-{scheme}")
    page.keyboard.press("Escape")
    page.wait_for_timeout(300)

    context.close()
    return rows

ASIDE = {"device", "touch", "tokens", "tree indent step"}

def cell(seen) -> str:
    if not seen:
        return "-"
    icon = f" i{seen['icon']:g}" if seen.get("icon") is not None else ""
    return f"{seen['w']:g}x{seen['h']:g} f{seen['font']:g}{icon} g{seen['gap']:g} p{seen['pl']:g}"

def report(label: str) -> None:
    runs = {label: json.loads((SHOTS / f"{label}.json").read_text(encoding="utf8"))}
    other = "after" if label == "before" else "before"
    if (SHOTS / f"{other}.json").exists():
        runs = {
            name: json.loads((SHOTS / f"{name}.json").read_text(encoding="utf8"))
            for name in (("before", "after") if other == "before" else (label, other))
        }

    order: list[str] = []
    for one_run in runs.values():
        for profile in one_run.values():
            for key in profile:
                if key not in ASIDE and key not in order:
                    order.append(key)

    for column in [name for name, *_ in PROFILES]:
        print(f"\n### {column}")
        print(f"{'surface':<24}" + "".join(f"{name:<30}" for name in runs))
        for key in order:
            cells = "".join(f"{cell(runs[n].get(column, {}).get(key)):<30}" for n in runs)
            print(f"{key:<24}{cells}")

    print("\n### the device, the step per level of the tree, and the scale")
    for column in [name for name, *_ in PROFILES]:
        for name, one_run in runs.items():
            seen = one_run.get(column, {})
            kind = "touch" if seen.get("touch") else "pointer"
            print(f"{column:<18} {name:<8} {seen.get('device')} {kind}, indent {seen.get('tree indent step')}")
    for name, one_run in runs.items():
        print(name, json.dumps(one_run["phone"]["tokens"]))

if __name__ == "__main__":
    sys.exit(run(sys.argv[1] if len(sys.argv) > 1 else "before"))
