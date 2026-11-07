from __future__ import annotations

import sys
from pathlib import Path

from harness import Drive

DRIVE = Drive(__file__)
say = DRIVE.say
ORIGIN = DRIVE.origin

PHONE_AGENT = (
    "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko)"
    " Chrome/140.0.0.0 Mobile Safari/537.36"
)
DESKTOP_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko)"
    " Chrome/140.0.0.0 Safari/537.36"
)

DEVICES = [
    ("desktop", 1440, 900, DESKTOP_AGENT, False, "dark"),
    ("phone", 390, 844, PHONE_AGENT, True, "light"),
]

SEED = """
async () => {
  const ws = window.ordenApp.workspace
  const note = (text) => ws.noteFrom(text, undefined)

  await note('# Plan\\n\\n#work\\n\\nThe centre of it: [[Ink]], [[Wind]], [[Paper]] and [[Nothing here]].')
  await note('# Ink\\n\\n#work/orden\\n\\nBack to the [[Plan]], and across to [[Paper]].')
  await note('# Wind\\n\\n#work\\n\\nAbout [[Ink]].')
  await note('# Paper\\n\\n#later\\n\\nAbout [[Ink]] and [[Grain]].')
  await note('# Grain\\n\\n#later\\n\\nAbout [[Paper]].')
  await note('# Kestrel\\n\\n#later\\n\\nA kestrel over the field, and the [[Weather]].')
  await note('# Weather\\n\\n#later\\n\\nAbout the [[Kestrel]].')
  await note('# Ledger\\n\\n#money\\n\\nNothing points here and it points nowhere.')
  await note('# Shots\\n\\n#work\\n\\nA picture: ![[shot.png]] and ![](assets/other.png), and a paper ![[paper.pdf]].')
  await note('# Standup\\n\\n#work\\n\\nMonday: [[Wind]]. Tuesday: [[Ink]].')

  await ws.loadTree()
  return ws.notes.length
}
"""

SPREAD_DATES = """
async () => {
  const day = 24 * 60 * 60 * 1000
  // No version asked for: the page's own store decides which it is on, and
  // asking for an older one is an error rather than a database.
  const open = indexedDB.open('orden')
  const db = await new Promise((resolve, reject) => {
    open.onsuccess = () => resolve(open.result)
    open.onerror = () => reject(open.error)
  })

  const rows = await new Promise((resolve, reject) => {
    const ask = db.transaction('files', 'readonly').objectStore('files').getAll()
    ask.onsuccess = () => resolve(ask.result)
    ask.onerror = () => reject(ask.error)
  })

  const start = Date.now() - rows.length * day
  await new Promise((resolve, reject) => {
    const write = db.transaction('files', 'readwrite')
    const store = write.objectStore('files')
    rows.forEach((row, one) => store.put({ ...row, created: start + one * day }))
    write.oncomplete = () => resolve()
    write.onerror = () => reject(write.error)
  })

  await window.ordenApp.workspace.loadTree()
  return rows.length
}
"""

SEED_MANY = """
async (count) => {
  const links = window.ordenApp.links
  const root = window.ordenApp.workspace.activeSpace.root
  const began = performance.now()

  for (let one = 0; one < count; one++) {
    const next = (one + 1) % count
    const far = (one + 7) % count
    const hub = one % 40 === 0 ? '\\n\\n[[Note 0]]' : ''
    links.noteSaved(`${root}/Note ${one}.md`, `# Note ${one}\\n\\n[[Note ${next}]] and [[Note ${far}]]${hub}`)
  }

  const graph = links.graph
  return {
    ms: Math.round(performance.now() - began),
    nodes: graph.nodes.length,
    edges: graph.edges.length,
  }
}
"""

PAN = """
async ({ steps }) => {
  const canvas = document.querySelector('.graph canvas')
  if (!canvas) return null

  const box = canvas.getBoundingClientRect()
  const from = { x: box.left + 30, y: box.top + 30 }
  const frames = []
  let last = performance.now()
  let watching = true

  const tick = (now) => {
    frames.push(now - last)
    last = now
    if (watching) requestAnimationFrame(tick)
  }
  requestAnimationFrame(tick)

  const send = (kind, x, y, buttons) => {
    canvas.dispatchEvent(
      new PointerEvent(kind, {
        pointerId: 1,
        pointerType: 'mouse',
        isPrimary: true,
        bubbles: true,
        cancelable: true,
        buttons,
        clientX: x,
        clientY: y,
      }),
    )
  }

  const nextFrame = () => new Promise((resolve) => requestAnimationFrame(() => resolve()))

  send('pointermove', from.x, from.y, 0)
  send('pointerdown', from.x, from.y, 1)
  await nextFrame()

  // Round and back, so the view ends where it began and the picture at the end of
  // one pan is the picture at the start of the next.
  for (let step = 0; step < steps; step++) {
    const turn = (step / steps) * Math.PI * 2
    send('pointermove', from.x + Math.sin(turn) * 180, from.y + (1 - Math.cos(turn)) * 90, 1)
    await nextFrame()
  }

  send('pointerup', from.x, from.y, 0)
  watching = false
  await nextFrame()

  // The first two are the frames before the drag began.
  const kept = frames.slice(2).filter((one) => one > 0)
  kept.sort((one, other) => one - other)
  return {
    frames: kept.length,
    median: Math.round(kept[Math.floor(kept.length / 2)] * 100) / 100,
    worst: Math.round(kept[kept.length - 1] * 100) / 100,
    ninety: Math.round(kept[Math.floor(kept.length * 0.9)] * 100) / 100,
  }
}
"""

RASTER = """
async ({ ratio, width, height }) => {
  const graph = window.ordenApp.links.graph
  const canvas = document.createElement('canvas')
  canvas.style.position = 'fixed'
  canvas.style.inset = '0'
  canvas.style.width = width + 'px'
  canvas.style.height = height + 'px'
  canvas.style.zIndex = '99'
  canvas.width = Math.round(width * ratio)
  canvas.height = Math.round(height * ratio)
  document.body.append(canvas)
  const context = canvas.getContext('2d')
  context.setTransform(ratio, 0, 0, ratio, 0, 0)

  // A disc of notes, which is the shape a settled space has.
  const count = graph.nodes.length
  const x = new Float64Array(count)
  const y = new Float64Array(count)
  for (let one = 0; one < count; one++) {
    const radius = Math.sqrt(one / count) * Math.min(width, height) * 0.48
    const angle = one * 2.399963
    x[one] = width / 2 + radius * Math.cos(angle)
    y[one] = height / 2 + radius * Math.sin(angle)
  }

  const strokeAt = (wide) => (shift) => {
    const path = new Path2D()
    for (const edge of graph.edges) {
      path.moveTo(x[edge.a] + shift, y[edge.a])
      path.lineTo(x[edge.b] + shift, y[edge.b])
    }
    context.strokeStyle = '#8a9099'
    context.lineWidth = wide
    context.stroke(path)
  }

  // The same hairline stroked more than once, a device pixel apart, which is what
  // the Lines dial's thick step draws: a line two device pixels wide out of strokes
  // that are each still a hairline. See `LINES` in graph-paint.ts.
  const brushed = (offsets) => (shift) => {
    const hair = 1 / ratio
    const path = new Path2D()
    for (const edge of graph.edges) {
      path.moveTo(x[edge.a] + shift, y[edge.a])
      path.lineTo(x[edge.b] + shift, y[edge.b])
    }
    context.strokeStyle = '#8a9099'
    context.lineWidth = hair
    for (const [dx, dy] of offsets) {
      context.save()
      context.translate(dx * hair, dy * hair)
      context.stroke(path)
      context.restore()
    }
  }

  const dots = (shift) => {
    const path = new Path2D()
    for (let one = 0; one < count; one++) {
      path.moveTo(x[one] + shift + 1.2, y[one])
      path.arc(x[one] + shift, y[one], 1.2, 0, Math.PI * 2)
    }
    context.fillStyle = '#cccccc'
    context.fill(path)
  }

  async function measure(what, draw) {
    const gaps = []
    let last = performance.now()

    for (let frame = 0; frame < 40; frame++) {
      await new Promise((resolve) =>
        requestAnimationFrame((now) => {
          gaps.push(now - last)
          last = now
          context.clearRect(0, 0, width, height)
          draw(frame % 7)
          resolve()
        }),
      )
    }

    const kept = gaps.slice(4).sort((one, other) => one - other)
    const median = kept[Math.floor(kept.length / 2)]
    return `${what}: ${Math.round(median * 10) / 10} ms (${Math.round(1000 / median)} fps)`
  }

  const out = [`${count} dots and ${graph.edges.length} links at ratio ${ratio}`]
  out.push(await measure('a clear and nothing else', () => undefined))
  out.push(await measure('links one page pixel wide', strokeAt(1)))
  out.push(await measure('links one screen pixel wide', strokeAt(1 / ratio)))
  // The three steps of the Lines dial, and the quarter pixel past the cliff that
  // says why the thick one is a brush rather than a wider stroke.
  out.push(await measure('Lines thin: 0.6 screen pixels', strokeAt(0.6 / ratio)))
  out.push(await measure('Lines normal: one screen pixel', brushed([[0, 0]])))
  out.push(
    await measure(
      'Lines thick: one screen pixel, brushed three ways',
      brushed([
        [0, 0],
        [1, 0],
        [0, 1],
      ]),
    ),
  )
  out.push(await measure('and 1.25 screen pixels as one stroke', strokeAt(1.25 / ratio)))
  out.push(await measure('the dots alone', dots))
  out.push(
    await measure('screen hairlines, dots and 400 names', (shift) => {
      strokeAt(1 / ratio)(shift)
      dots(shift)
      context.font = '11px system-ui'
      context.fillStyle = '#9aa3b2'
      for (let one = 0; one < Math.min(400, count); one++) {
        context.fillText('Note ' + one, x[one] + shift, y[one] + 6)
      }
    }),
  )

  canvas.remove()
  return out
}
"""

PATCH = """
const patch = () => {
  const canvas = document.querySelector('.graph canvas')
  const context = canvas.getContext('2d')
  const wide = Math.min(240, canvas.width)
  const tall = Math.min(240, canvas.height)
  const data = context.getImageData(
    Math.round((canvas.width - wide) / 2),
    Math.round((canvas.height - tall) / 2),
    wide,
    tall,
  ).data

  let sum = 0
  for (let one = 0; one < data.length; one += 4) {
    sum = (sum * 31 + data[one] + data[one + 3]) % 1e9
  }
  return sum
}
"""

PATCH_ONCE = (
    """
() => {
"""
    + PATCH
    + """
  return patch()
}
"""
)

SWITCH = """
async ({ orphans }) => {
  const painted = () =>
    new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))

  const began = performance.now()
  window.ordenApp.workspace.graphSettings.set({ orphans })
  await painted()
  return Math.round((performance.now() - began) * 100) / 100
}
"""

PAINTED = """
  const painted = () =>
    new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
"""

TINT = (
    """
async () => {
"""
    + PAINTED
    + """
  const began = performance.now()
  window.ordenApp.workspace.graphSettings.set({ groups: [{ query: 'path:Note 1', colour: 5 }] })
  await painted()
  return Math.round((performance.now() - began) * 100) / 100
}
"""
)

FILTER = (
    """
async () => {
"""
    + PAINTED
    + """
  const began = performance.now()
  window.ordenApp.workspace.graphSettings.set({ filter: 'path:Note 4' })
  await painted()
  return Math.round((performance.now() - began) * 100) / 100
}
"""
)

VIEW = """
() => {
  const one = window.ordenApp.workspace.graphSettings.here
  return { filter: one.filter, arrows: one.arrows, depth: one.depth, lines: one.lines }
}
"""

KEEP_VIEW = """
(name) => {
  const ws = window.ordenApp.workspace
  ws.bookmarks.toggle(ws.bookmarks.forGraph(name, ws.graphSettings.here))
  return ws.bookmarks.list.map((one) => `${one.kind}:${one.text}`)
}
"""

TAB = """
() => window.ordenApp.workspace.active?.note?.kind ?? 'none'
"""

def opened(browser, width, height, agent, finger, scheme, name):
    context = browser.new_context(
        viewport={"width": width, "height": height},
        user_agent=agent,
        has_touch=finger,
        is_mobile=finger,
        color_scheme=scheme,
        device_scale_factor=2,
    )
    page = context.new_page()
    page.set_default_timeout(8000)
    page.on("pageerror", lambda error: say(f"[{name}] page error: {error}"))
    page.on(
        "console",
        lambda one: say(f"[{name}] console {one.type}: {one.text}")
        if one.type == "error"
        else None,
    )
    DRIVE.open(page)
    page.evaluate("() => { for (let i = 0; i < 12; i++) history.pushState({ spare: i }, '') }")
    page.evaluate(f"() => window.ordenApp.theme.setScheme('{scheme}')")
    page.wait_for_timeout(200)
    return context, page

def drive(browser, out: Path, name, width, height, agent, finger, scheme) -> None:
    shots = out
    shots.mkdir(parents=True, exist_ok=True)
    context, page = opened(browser, width, height, agent, finger, scheme, name)

    def shot(tag: str) -> None:
        page.screenshot(path=str(shots / f"{name}-{tag}.png"))
        say(f"shot {name}-{tag}.png")

    say(f"[{name}] the space holds {page.evaluate(SEED)} notes")
    say(f"[{name}] dates spread over {page.evaluate(SPREAD_DATES)} files")
    page.wait_for_timeout(500)

    page.evaluate("() => window.ordenApp.workspace.openGraph()")
    page.wait_for_selector(".graph", timeout=20000)
    page.wait_for_timeout(1400)
    shot("arrived")

    counts = page.evaluate(
        "() => ({ nodes: window.ordenApp.links.graph.nodes.length,"
        " edges: window.ordenApp.links.graph.edges.length })"
    )
    say(f"[{name}] {counts['nodes']} nodes and {counts['edges']} edges")

    tab = page.locator(".graph .corner > button").last
    if not tab.count():
        say(f"[{name}] no card to open")
        context.close()
        return

    tab.click(force=True)
    page.wait_for_timeout(500)
    shot("card")

    forces = page.locator('.graph .corner .card button:has-text("Forces")').first
    if forces.count():
        forces.click(force=True)
        page.wait_for_timeout(500)
        shot("card-forces")
        forces.click(force=True)
        page.wait_for_timeout(400)
    else:
        say(f"[{name}] no Forces row on the card")

    page.evaluate(
        "() => window.ordenApp.workspace.graphSettings.set({"
        " groups: [{ query: 'tag:work', colour: 4 }, { query: 'tag:later', colour: 6 }] })"
    )
    page.wait_for_timeout(700)
    shot("groups")

    page.evaluate("() => window.ordenApp.workspace.graphSettings.set({ attachments: true })")
    page.wait_for_timeout(1600)
    shot("attachments")
    files = page.evaluate(
        """() => {
          const nodes = window.ordenApp.links.graphWithFiles.nodes
          return {
            all: nodes.length,
            files: nodes.filter((one) => one.attachment).map((one) => one.name).sort(),
            without: window.ordenApp.links.graph.nodes.length,
          }
        }"""
    )
    say(
        f"[{name}] {files['without']} nodes without the attachments and {files['all']} with:"
        f" {files['files']}"
    )
    page.evaluate("() => window.ordenApp.workspace.graphSettings.set({ attachments: false })")
    page.wait_for_timeout(1400)

    for step, what in ((1, "thin"), (3, "thick")):
        page.evaluate(
            f"() => window.ordenApp.workspace.graphSettings.set({{ lines: {step} }})"
        )
        page.wait_for_timeout(500)
        shot(f"lines-{what}")
    page.evaluate("() => window.ordenApp.workspace.graphSettings.set({ lines: 2 })")
    page.wait_for_timeout(400)

    for fade, what in ((0.25, "soon"), (4, "late")):
        page.evaluate(
            f"() => window.ordenApp.workspace.graphSettings.set({{ fade: {fade} }})"
        )
        page.wait_for_timeout(600)
        shot(f"fade-{what}")
    page.evaluate("() => window.ordenApp.workspace.graphSettings.set({ fade: 1 })")
    page.wait_for_timeout(400)

    page.evaluate("() => window.ordenApp.workspace.graphSettings.set({ arrows: true })")
    page.wait_for_timeout(600)
    shot("arrows")

    page.evaluate("() => window.ordenApp.workspace.graphSettings.set({ filter: 'tag:later' })")
    page.wait_for_timeout(800)
    shot("filtered")
    shown = page.evaluate(
        "() => window.ordenApp.workspace.graphSettings.here.filter"
    )
    say(f"[{name}] the filter reads {shown!r}")

    page.evaluate(
        "() => window.ordenApp.workspace.graphSettings.set({ filter: '', orphans: false })"
    )
    page.wait_for_timeout(800)
    shot("no-orphans")

    page.evaluate("() => window.ordenApp.workspace.graphSettings.set({ orphans: true })")
    page.wait_for_timeout(400)
    played = page.locator(".graph .corner .time button")
    if played.count():
        played.click(force=True)
        page.wait_for_timeout(1800)
        shot("playing")
        page.wait_for_timeout(5000)
        shot("played")
    else:
        say(f"[{name}] no time row, so no dates to play")

    page.evaluate(
        "() => window.ordenApp.workspace.graphSettings.set({ spread: 3, gather: false })"
    )
    page.wait_for_timeout(2000)
    shot("spread")

    page.evaluate(
        "() => window.ordenApp.workspace.graphSettings.set("
        " { spread: 1, gather: true, distance: 96, push: 40 })"
    )
    page.wait_for_timeout(2200)
    shot("forces-long-links")
    page.evaluate(
        "() => window.ordenApp.workspace.graphSettings.set({ distance: 12, push: 400 })"
    )
    page.wait_for_timeout(2200)
    shot("forces-hard-push")

    page.evaluate("() => window.ordenApp.workspace.graphSettings.reset()")
    page.wait_for_timeout(1600)
    shot("reset")

    page.evaluate(
        """() => {
          const ws = window.ordenApp.workspace
          const ink = ws.notes.find((one) => one.name.startsWith('Ink'))
          if (ink) void ws.openEntry(ink.path, { activate: true })
        }"""
    )
    DRIVE.wait_for(page, "window.ordenApp.workspace.active?.shown?.startsWith('Ink')", "the Ink note")
    page.evaluate(
        "() => { const ws = window.ordenApp.workspace; if (ws.panel !== 'links') ws.showPanel('links') }"
    )
    page.wait_for_timeout(700)
    picture = page.locator("aside .tools button").last
    if picture.count():
        picture.click(force=True)
        page.wait_for_timeout(1200)
        shot("panel-depth-1")

        step = page.locator("aside .tools .depth")
        if step.count():
            step.click(force=True)
            page.wait_for_timeout(1200)
            step.click(force=True)
            page.wait_for_timeout(1400)
            shot("panel-depth-3")
            say(
                f"[{name}] the stepper reads "
                f"{page.evaluate('() => window.ordenApp.workspace.graphSettings.here.depth')}"
            )

            page.evaluate("() => window.ordenApp.workspace.graphSettings.set({ depth: 5 })")
            page.wait_for_timeout(1600)
            shot("panel-depth-5")
            say(
                f"[{name}] and at the far end of the slider it reads "
                f"{page.evaluate('() => window.ordenApp.workspace.graphSettings.here.depth')}"
            )
            page.evaluate("() => window.ordenApp.workspace.graphSettings.set({ depth: 1 })")
            page.wait_for_timeout(1000)
        else:
            say(f"[{name}] no depth stepper")
    else:
        say(f"[{name}] no picture switch in the panel")

    say(f"[{name}] --- a bookmarked view ---")
    page.evaluate("() => window.ordenApp.workspace.openGraph()")
    page.wait_for_timeout(800)
    page.evaluate(
        "() => window.ordenApp.workspace.graphSettings.set("
        " { filter: 'ink', arrows: true, lines: 3 })"
    )
    page.wait_for_timeout(600)
    say(f"[{name}] the picture now: {page.evaluate(VIEW)}")

    kept = page.evaluate(KEEP_VIEW, "Ink and arrows")
    say(f"[{name}] the bookmarks hold: {kept}")

    page.evaluate("() => window.ordenApp.workspace.graphSettings.reset()")
    page.wait_for_timeout(600)
    say(f"[{name}] after a reset: {page.evaluate(VIEW)}")

    page.evaluate("() => window.ordenApp.workspace.showPanel('tree')")
    page.wait_for_timeout(600)

    row = page.locator('aside .row:has-text("Ink and arrows")').first
    if row.count():
        row.click(force=True)
        page.wait_for_timeout(1200)
        say(f"[{name}] after pressing the row: {page.evaluate(VIEW)}")
        say(f"[{name}] and the tab in front is {page.evaluate(TAB)}")
        shot("bookmarked-view")
    else:
        say(f"[{name}] no row for the view")

    context.close()

def measure(browser, out: Path, count: int) -> None:
    shots = out
    shots.mkdir(parents=True, exist_ok=True)
    name = "many"
    context, page = opened(browser, 1440, 900, DESKTOP_AGENT, False, "dark", name)

    seeded = page.evaluate(SEED_MANY, count)
    say(f"[{name}] {seeded['nodes']} nodes and {seeded['edges']} edges in {seeded['ms']} ms")

    for line in page.evaluate(RASTER, {"ratio": 2, "width": 1440, "height": 860}):
        say(f"[{name}] {line}")

    page.evaluate("() => window.ordenApp.workspace.openGraph()")
    page.wait_for_selector(".graph", timeout=20000)
    page.wait_for_timeout(10000)

    def pan(what: str) -> None:
        panned = page.evaluate(PAN, {"steps": 90})
        if not panned:
            say(f"[{name}] nothing to pan")
            return
        rate = round(1000 / panned["median"], 1) if panned["median"] else 0
        say(
            f"[{name}] {what}: {panned['frames']} frames, median {panned['median']} ms"
            f" ({rate} fps), 90th {panned['ninety']} ms, worst {panned['worst']} ms"
        )

    pan("panned")
    pan("panned again")

    say(
        f"[{name}] orphans off in {page.evaluate(SWITCH, {'orphans': False})} ms,"
        f" on again in {page.evaluate(SWITCH, {'orphans': True})} ms"
    )
    say(f"[{name}] a colour group over the lot in {page.evaluate(TINT)} ms")
    pan("panned with a colour group")

    say(f"[{name}] a filter over the lot in {page.evaluate(FILTER)} ms")
    pan("panned while filtered")

    page.evaluate("() => window.ordenApp.workspace.graphSettings.set({ filter: '', arrows: true })")
    page.wait_for_timeout(1200)
    pan("panned with arrowheads")

    page.evaluate("() => window.ordenApp.workspace.graphSettings.set({ arrows: false })")
    for step, what in ((1, "thin"), (2, "normal"), (3, "thick")):
        page.evaluate(
            f"() => window.ordenApp.workspace.graphSettings.set({{ lines: {step} }})"
        )
        page.wait_for_timeout(600)
        pan(f"panned with lines {what}")

    page.evaluate("() => window.ordenApp.workspace.graphSettings.set({ lines: 2 })")
    page.wait_for_timeout(400)

    page.screenshot(path=str(shots / f"{name}-arrows.png"))
    say(f"shot {name}-arrows.png")
    page.evaluate("() => window.ordenApp.workspace.graphSettings.reset()")
    page.wait_for_timeout(10000)
    page.screenshot(path=str(shots / f"{name}-settled.png"))
    say(f"shot {name}-settled.png")

    pan("panned after the reset")

    def picture() -> bytes:
        return page.screenshot(clip={"x": 400, "y": 200, "width": 640, "height": 480})

    before = picture()
    page.evaluate(SWITCH, {"orphans": False})
    page.wait_for_timeout(400)
    away = picture()
    page.evaluate(SWITCH, {"orphans": True})
    page.wait_for_timeout(400)
    say(
        f"[{name}] the picture came back identical: {picture() == before}"
        f" (and the switch changed it: {away != before})"
    )

    context.close()

def main() -> int:
    count = int(sys.argv[1]) if len(sys.argv) > 1 else 5000
    out = DRIVE.shots
    with DRIVE.session() as browser:
        for one in DEVICES:
            say(f"--- {one[0]} ---")
            drive(browser, out, *one)

        say(f"--- {count} notes ---")
        measure(browser, out, count)

    return DRIVE.verdict(f"shots in {out}")

if __name__ == "__main__":
    raise SystemExit(main())
