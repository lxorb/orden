from __future__ import annotations

import re

from playwright.sync_api import Browser, Page

from harness import Drive

DRIVE = Drive(__file__)
say, shot, wait_for = DRIVE.say, DRIVE.shot, DRIVE.wait_for
failures = DRIVE.failures
ORIGIN = DRIVE.origin

NOTE = """# A window with a desk behind it

Ordinary words, and *some* of them `marked up`, with a [link](https://example.com)
and a bit of **weight** in the middle of a sentence that runs on long enough to be
read rather than glanced at.

> A quote, which is drawn in the muted colour - the first thing a wash takes.

- A list, because a list is mostly second-level ink
- And a second line of it
"""

SEED = """
async ([note, name]) => {
  const ws = window.nibApp.workspace
  await ws.noteFrom(note, ws.activeSpace.root)
  await ws.loadTree()
  const first = ws.notes.find((one) => one.name.startsWith(name))
  if (first) await ws.openEntry(first.path, { activate: true })
  return ws.notes.length
}
"""

def grey(level: int) -> str:
    return f"rgb({level}, {level}, {level})"

DESKS = {
    "acrylic": {
        "dark": {"paint": "#ffffff", "under": [grey(255), grey(0)]},
        "light": {"paint": "#000000", "under": [grey(0), grey(255)]},
        "busy": (
            "radial-gradient(60vw 60vh at 12% 18%, #ff5f6d 0%, transparent 60%),"
            " radial-gradient(70vw 70vh at 78% 22%, #1a2980 0%, transparent 62%),"
            " radial-gradient(55vw 55vh at 30% 82%, #f7ff00 0%, transparent 58%),"
            " linear-gradient(120deg, #ffffff, #2b2f38)"
        ),
    },
    "mica": {
        "dark": {
            "paint": "linear-gradient(120deg, #1d2338, #2a1c26)",
            "under": [grey(0), grey(10), grey(32), grey(58), "rgb(22, 30, 72)", "rgb(64, 24, 24)"],
        },
        "light": {
            "paint": "linear-gradient(120deg, #d9dde8, #e8ddd6)",
            "under": [grey(192), grey(218), grey(243), grey(255), "rgb(206, 214, 240)", "rgb(240, 205, 196)"],
        },
    },
}

READINGS = [
    ("text in the bar", "--text", ["--shell-ground"]),
    ("quiet text in the bar", "--muted", ["--shell-ground"]),
    ("text in the list", "--text", ["--side-bar-bg-color", "--shell-ground"]),
    ("quiet text in the list", "--muted", ["--side-bar-bg-color", "--shell-ground"]),
    ("the second quiet level in the list", "--muted-strong", ["--side-bar-bg-color", "--shell-ground"]),
    (
        "quiet text on a row under the pointer",
        "--muted",
        ["--item-hover-bg-color", "--side-bar-bg-color", "--shell-ground"],
    ),
    ("text on the paper", "--text", ["--bg"]),
    ("quiet text on the paper", "--muted", ["--bg"]),
]

FLOOR = 4.5

MEASURE = """
([readings, backdrop]) => {
  const probe = document.createElement('span')
  probe.style.position = 'fixed'
  probe.style.opacity = '0'
  document.body.append(probe)

  const parse = (said) => {
    const parts = (said.match(/[\\d.]+/g) ?? []).map(Number)
    const scale = said.startsWith('color(') ? 255 : 1
    return [
      (parts[0] ?? 0) * scale,
      (parts[1] ?? 0) * scale,
      (parts[2] ?? 0) * scale,
      parts.length > 3 ? parts[3] : 1,
    ]
  }

  const colourOf = (token) => {
    probe.style.color = 'rgb(1, 2, 3)'
    probe.style.color = `var(${token})`
    return parse(getComputedStyle(probe).color)
  }

  const over = (top, under) => [0, 1, 2].map((at) => top[at] * top[3] + under[at] * (1 - top[3]))

  const light = ([r, g, b]) => {
    const channel = (one) => {
      const value = one / 255
      return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
    }
    return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
  }

  const ratio = (a, b) => {
    const [high, low] = light(a) > light(b) ? [a, b] : [b, a]
    return Math.round(((light(high) + 0.05) / (light(low) + 0.05)) * 100) / 100
  }

  const desk = parse(backdrop)
  const out = []
  for (const [what, ink, layers] of readings) {
    let under = desk
    for (const layer of [...layers].reverse()) under = over(colourOf(layer), under)
    out.push([what, ratio(over(colourOf(ink), under), under)])
  }

  probe.remove()
  return out
}
"""

STAND_ON = """
([desk, material]) => {
  document.getElementById('nib-desk')?.remove()
  const style = document.createElement('style')
  style.id = 'nib-desk'
  style.textContent = `html { background: ${desk} !important; background-attachment: fixed !important; }`
  document.head.append(style)
  if (material) document.documentElement.dataset.translucent = material
  else delete document.documentElement.dataset.translucent
}
"""

SCROLL = """
() => new Promise((done) => {
  const scroller = document.querySelector('.cm-scroller')
  if (!scroller) return done(null)

  scroller.scrollTop = 0
  const frames = []
  let last = performance.now()
  let at = 0

  const step = () => {
    const now = performance.now()
    frames.push(now - last)
    last = now

    if (at++ > 90 || scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight) {
      const kept = frames.slice(1).sort((a, b) => a - b)
      return done({
        frames: kept.length,
        median: Math.round(kept[Math.floor(kept.length / 2)] * 100) / 100,
        worst: Math.round(kept[kept.length - 1] * 100) / 100,
        slow: kept.filter((one) => one > 16.7).length,
      })
    }

    scroller.scrollTop += 240
    requestAnimationFrame(step)
  }

  requestAnimationFrame(step)
})
"""

FILTERS = """
() => [...document.querySelectorAll('*')]
  .filter((one) => {
    const style = getComputedStyle(one)
    return style.backdropFilter !== 'none' && style.backdropFilter !== ''
  })
  .map((one) => one.tagName.toLowerCase() + '.' + [...one.classList].join('.'))
"""

FIRST_FRAME = """
(() => {
  const look = () => {
    const app = document.getElementById('app')
    if (!app || !app.childElementCount) return requestAnimationFrame(look)
    const sheet = document.getElementById('nib-user-theme')
    window.__glassFirstFrame = !!sheet && sheet.textContent.includes('--glass-chrome')
  }
  requestAnimationFrame(look)
})()
"""

TOLERATED = ("orden.so", "nibeditor.com", "Failed to load resource", "net::ERR")

finished: set[object] = set()

def channels(said: str) -> tuple[int, ...]:
    parts = [float(one) for one in re.findall(r"[\d.]+", said)]
    scale = 255 if said.startswith("color(") else 1
    alpha = parts[3] if len(parts) > 3 else 1
    return (*(round(one * scale) for one in parts[:3]), round(alpha * 255))

def shows(what: str, saw: object, wanted: object) -> None:
    if saw == wanted:
        say(f"ok   {what}: {saw!r}")
        return

    failures.append(what)
    say(f"NOT  {what}: {saw!r}, wanted {wanted!r}")

def holds(what: str, ratio: float, floor: float = FLOOR) -> None:
    if ratio >= floor:
        say(f"ok   {what}: {ratio}:1")
        return

    failures.append(what)
    say(f"NOT  {what}: {ratio}:1, under {floor}")

def done_with(page: Page) -> None:
    finished.add(page)
    page.context.close()

def fresh(browser: Browser, scheme: str, note: str = NOTE, name: str = "A window") -> Page:
    context = browser.new_context(
        viewport={"width": 1240, "height": 760},
        color_scheme=scheme,
        device_scale_factor=1,
        reduced_motion="reduce",
    )
    page = context.new_page()
    page.on(
        "pageerror",
        lambda error: failures.append(f"page error: {error}") if page not in finished else None,
    )
    page.on(
        "console",
        lambda message: failures.append(f"console error: {message.text}")
        if message.type == "error"
        and page not in finished
        and not any(one in message.text for one in TOLERATED)
        else None,
    )
    page.goto(ORIGIN, wait_until="domcontentloaded")
    if not page.evaluate("() => !!window.nibApp"):
        page.wait_for_timeout(1500)
        if not page.evaluate("() => !!window.nibApp"):
            page.reload(wait_until="domcontentloaded")

    wait_for(page, "window.nibApp", "the app")
    wait_for(page, "window.nibApp.workspace.activeSpace", "a space")
    page.evaluate(SEED, [note, name])
    page.evaluate(f"() => window.nibApp.theme.setScheme('{scheme}')")
    page.evaluate("() => window.nibApp.workspace.showPanel('tree')")
    wait_for(page, "document.querySelector('.cm-content')", "the editor")
    page.wait_for_timeout(400)
    return page

def choose(page: Page, theme: str) -> None:
    page.evaluate(f"() => window.nibApp.theme.select('{theme}')")
    if theme == "glass":
        wait_for(
            page,
            "getComputedStyle(document.documentElement).getPropertyValue('--glass-chrome')",
            "glass's sheet",
        )
    page.wait_for_timeout(300)

def stand(page: Page, desk: str, material: str | None) -> None:
    page.evaluate(STAND_ON, [desk, material])
    page.wait_for_timeout(300)
    page.evaluate(
        "() => window.nibApp.theme.settings.some((one) => one.id === 'content')"
        " && window.nibApp.theme.set('content', 'opaque')"
    )
    page.wait_for_timeout(100)

def read_over(page: Page, where: str, unders: list[str]) -> None:
    paired = page.evaluate("() => document.documentElement.hasAttribute('data-paired')")
    grounds = ["--glass-from", "--glass-to"] if paired else ["--shell-ground"]
    readings = [
        (f"{what} ({ground})" if paired else what, ink, [ground if one == "--shell-ground" else one for one in layers])
        for what, ink, layers in READINGS
        for ground in grounds
    ]
    for under in unders:
        for what, ratio in page.evaluate(MEASURE, [readings, under]):
            holds(f"[{where} over {under}] {what}", ratio)

def main() -> int:
    with DRIVE.session() as browser:
        for scheme in ("dark", "light"):
            first_look(browser, scheme)
            drive(browser, scheme)
        scrolling(browser)

    return DRIVE.verdict("every reading held")

def first_look(browser: Browser, scheme: str) -> None:
    context = browser.new_context(
        viewport={"width": 1240, "height": 760},
        color_scheme=scheme,
        device_scale_factor=1,
        reduced_motion="reduce",
        first_look=True,
    )
    page = context.new_page()
    page.goto(ORIGIN, wait_until="domcontentloaded")
    wait_for(page, "window.nibApp && window.nibApp.workspace.activeSpace", "a space")
    wait_for(
        page,
        "getComputedStyle(document.documentElement).getPropertyValue('--glass-chrome')",
        "glass's sheet",
    )
    look = page.evaluate(
        "() => ({ id: window.nibApp.theme.id, accent: window.nibApp.theme.accent,"
        " scheme: window.nibApp.theme.scheme, current: window.nibApp.theme.current,"
        " kept: localStorage.getItem('nib:theme') })"
    )
    shows(f"[{scheme}] a first launch is glass", look["id"], "glass")
    shows(f"[{scheme}] in green", look["accent"], "green")
    shows(f"[{scheme}] following the system", look["scheme"], "system")
    shows(f"[{scheme}] which here is {scheme}", look["current"], scheme)
    shows(f"[{scheme}] and nothing is written down as chosen", look["kept"], None)
    page.wait_for_timeout(400)
    shot(page, f"{scheme}-first-look")
    done_with(page)

    context = browser.new_context(color_scheme=scheme, first_look=True)
    context.add_init_script(
        "try { if (!sessionStorage.getItem('seeded')) { sessionStorage.setItem('seeded', '1');"
        " localStorage.setItem('nib:theme', 'default');"
        " localStorage.setItem('nib:theme-settings', JSON.stringify({ '*': { accent: 'teal' } })) } }"
        " catch {}"
    )
    page = context.new_page()
    page.goto(ORIGIN, wait_until="domcontentloaded")
    wait_for(page, "window.nibApp && window.nibApp.workspace.activeSpace", "a space")
    read = "() => [window.nibApp.theme.id, window.nibApp.theme.accent]"
    shows(f"[{scheme}] an older install on the built-in moves to glass", page.evaluate(read), ["glass", "teal"])
    page.evaluate("() => window.nibApp.theme.select('default')")
    page.reload(wait_until="domcontentloaded")
    wait_for(page, "window.nibApp && window.nibApp.workspace.activeSpace", "a space")
    shows(f"[{scheme}] and Classic chosen again stays", page.evaluate(read), ["default", "teal"])
    done_with(page)

    context = browser.new_context(color_scheme=scheme, first_look=True)
    context.add_init_script(
        "try { if (!sessionStorage.getItem('seeded')) { sessionStorage.setItem('seeded', '1');"
        " localStorage.setItem('nib:theme-moved', 'yes');"
        " localStorage.setItem('nib:theme-settings', JSON.stringify({ '*': { accent: 'yellow' } })) } }"
        " catch {}"
    )
    page = context.new_page()
    page.goto(ORIGIN, wait_until="domcontentloaded")
    wait_for(page, "window.nibApp && window.nibApp.workspace.activeSpace", "a space")
    shows(f"[{scheme}] the first look's yellow turns green", page.evaluate(read), ["glass", "green"])
    page.evaluate("() => window.nibApp.theme.setAccent('yellow')")
    page.reload(wait_until="domcontentloaded")
    wait_for(page, "window.nibApp && window.nibApp.workspace.activeSpace", "a space")
    shows(f"[{scheme}] and a yellow picked after stays", page.evaluate(read), ["glass", "yellow"])
    done_with(page)

def drive(browser: Browser, scheme: str) -> None:
    page = fresh(browser, scheme)

    shot(page, f"{scheme}-default")

    choose(page, "glass")
    shows(f"[{scheme}] glass is worn", page.evaluate("() => window.nibApp.theme.id"), "glass")
    shows(
        f"[{scheme}] the accent is still the reader's to choose",
        page.evaluate("() => window.nibApp.theme.accentIsTheme"),
        False,
    )

    read_over(page, f"{scheme}, nothing behind", ["rgb(255, 0, 255)"])

    for material, desks in DESKS.items():
        side = desks[scheme]
        stand(page, side["paint"], material)
        read_over(page, f"{scheme} on {material}", side["under"])
        shot(page, f"{scheme}-glass-{material}")

    stand(page, DESKS["acrylic"]["busy"], "acrylic")
    shot(page, f"{scheme}-glass-busy")

    stand(page, DESKS["mica"][scheme]["paint"], "mica")
    shows(
        f"[{scheme}] the note stands on paper of its own",
        channels(page.evaluate("() => getComputedStyle(document.querySelector('.pane')).backgroundColor")),
        channels(
            page.evaluate(
                "() => { const probe = document.createElement('span');"
                " probe.style.color = 'var(--bg)'; document.body.append(probe);"
                " const said = getComputedStyle(probe).color; probe.remove(); return said }"
            )
        ),
    )
    shows(
        f"[{scheme}] and the open tab is filled with the same paper",
        page.evaluate(
            "() => { const one = document.querySelector('.tab.active .fill');"
            " return !!one && getComputedStyle(one).backgroundColor"
            " === getComputedStyle(document.querySelector('.pane')).backgroundColor }"
        ),
        True,
    )
    shows(f"[{scheme}] nothing repaints what is behind it on every frame", page.evaluate(FILTERS), [])

    page.evaluate("() => window.nibApp.settings.show('appearance')")
    page.wait_for_timeout(600)
    rows = page.evaluate(
        "() => [...document.querySelectorAll('.nib-setting')].map((one) => one.textContent.trim())"
    )
    shows(
        f"[{scheme}] Appearance has no Translucency row",
        any("Translucency" in one for one in rows),
        False,
    )
    shot(page, f"{scheme}-glass-settings")

    row = page.locator(".nib-setting", has_text="Tint colour")
    shows(f"[{scheme}] the pair row offers seven and two of one's own", row.locator(".swatch").count(), 9)
    row.scroll_into_view_if_needed()
    shot(page, f"{scheme}-glass-pairs", clip=row.bounding_box())
    row.locator("input[type=color]").first.evaluate(
        "(one) => { one.value = '#ffd6a5'; one.dispatchEvent(new Event('change', { bubbles: true })) }"
    )
    page.wait_for_timeout(300)
    kept = page.evaluate("() => window.nibApp.theme.values.pair")
    shows(f"[{scheme}] a colour picked is kept with the other", bool(re.fullmatch(r"#ffd6a5 #[0-9a-f]{6}", str(kept))), True)
    shows(
        f"[{scheme}] and both of them are worn as one's own",
        row.locator(".swatch.picked.active").count(),
        2,
    )
    shot(page, f"{scheme}-glass-pairs-own", clip=row.bounding_box())
    page.keyboard.press("Escape")
    page.wait_for_timeout(400)
    shows(
        f"[{scheme}] the frame is a pair",
        page.evaluate("() => document.documentElement.hasAttribute('data-paired')"),
        True,
    )
    shot(page, f"{scheme}-glass-own-pair")
    page.evaluate("() => window.nibApp.theme.set('pair', 'dawn')")

    page.add_init_script(FIRST_FRAME)
    page.reload(wait_until="domcontentloaded")
    wait_for(page, "window.__glassFirstFrame !== undefined", "the first frame")
    shows(
        f"[{scheme}] a launch on glass wears it from its first frame",
        page.evaluate("() => window.__glassFirstFrame"),
        True,
    )
    page.evaluate("() => localStorage.removeItem('nib:theme-sheet')")
    page.reload(wait_until="domcontentloaded")
    wait_for(page, "window.__glassFirstFrame !== undefined", "the first frame")
    say(
        f"     [{scheme}] and without last time's sheet, the first frame wears it: "
        f"{page.evaluate('() => window.__glassFirstFrame')}"
    )

    done_with(page)

def scrolling(browser: Browser) -> None:
    long_note = "# A long note\n\n" + "\n\n".join(
        f"## Section {one}\n\nA paragraph of ordinary words, long enough to wrap and be"
        " read rather than glanced at, which is what a note is mostly made of."
        for one in range(120)
    )

    page = fresh(browser, "dark", note=long_note, name="A long note")

    for what in ("default", "glass"):
        choose(page, what)
        if what == "glass":
            page.evaluate(STAND_ON, [DESKS["acrylic"]["busy"], "acrylic"])
        page.wait_for_timeout(500)
        seen = page.evaluate(SCROLL)
        say(
            f"     scrolling on {what}: {seen['frames']} frames, median {seen['median']}ms,"
            f" worst {seen['worst']}ms, {seen['slow']} over 16.7"
        )

    done_with(page)

if __name__ == "__main__":
    raise SystemExit(main())
