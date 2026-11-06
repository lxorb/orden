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
  const ws = window.nibApp.workspace
  const note = (text) => ws.noteFrom(text, undefined)

  await note('# This week\\n\\n#work\\n\\n- [ ] write the plan\\n- [x] read the paper\\n- [ ] send the ledger\\n\\nThe plan is the plan.')
  await note('---\\npages: 150\\ndue: 2026-09-01\\nstatus: done\\n---\\n\\n# Ink\\n\\n#work/nib\\n\\nA study of ink, and the plan behind it.')
  await note('---\\npages: 420\\ndue: 2026-12-24\\n---\\n\\n# Paper\\n\\n#later\\n\\nAbout paper, and the wear of ink on it.')
  await note('# Kestrel\\n\\n#later\\n\\n- [ ] watch the kestrel again\\n\\nA kestrel hangs on the wind above the field.')
  await note('# Everything open\\n\\nWhat is still to do, everywhere:\\n\\n```query\\ntask-todo:\\n```\\n\\nAnd the long papers:\\n\\n```query\\n[pages:>200]\\n```')

  // The archive is a note, because that is all a folder is: moving something into
  // it is what makes it one, and `moveMany` nests the note first. See
  // folder-notes.ts.
  await note('# Archive\\n\\nWhat is done with.')
  await note('# Old plan\\n\\nThe plan as it was, with a kestrel in it.')
  await ws.loadTree()

  // The last note into the archive, so there is something to leave out.
  const old = ws.notes.find((one) => one.name.startsWith('Old plan'))
  if (old) await ws.moveMany([old.path], ws.activeSpace.root + '/Archive')
  await ws.loadTree()

  return ws.notes.length
}
"""

SEED_MANY = """
async ({ count, root }) => {
  // No version: the app has already opened the database at whichever one it is at,
  // and asking for an older one is a VersionError rather than a seed.
  const open = indexedDB.open('nib')
  const db = await new Promise((resolve, reject) => {
    open.onsuccess = () => resolve(open.result)
    open.onerror = () => reject(open.error)
  })

  const began = performance.now()
  const made = Date.now()
  let bytes = 0

  for (let batch = 0; batch < count; batch += 500) {
    await new Promise((resolve, reject) => {
      // The listing is a store of its own now, and a note written without its
      // stat is a note the file list cannot see; see web/store.ts.
      const write = db.transaction(['files', 'stats'], 'readwrite')
      const store = write.objectStore('files')
      const listing = write.objectStore('stats')

      for (let one = batch; one < Math.min(batch + 500, count); one++) {
        const content = [
          '---',
          'pages: ' + (100 + (one % 400)),
          'due: 2026-0' + (1 + (one % 9)) + '-1' + (one % 10),
          '---',
          '',
          '# Note ' + one,
          '',
          '#work/' + (one % 20),
          '',
          '- [' + (one % 3 === 0 ? 'x' : ' ') + '] a task on note ' + one,
          '',
          'The quarter plan for note ' + one + ', and the wind above the field.',
          'A second line about ink, paper and the wear of one on the other.',
          'A third line so a note is a note rather than a sentence.',
        ].join('\\n')

        bytes += content.length
        const row = {
          path: root + '/Note ' + one + '.md',
          content,
          modified: made - one * 1000,
          created: made - one * 2000,
        }
        store.put(row)
        listing.put({ path: row.path, modified: row.modified, created: row.created })
      }

      write.oncomplete = () => resolve()
      write.onerror = () => reject(write.error)
    })
  }

  await window.nibApp.workspace.loadTree()

  // The rows went in behind the app's back, so they are called out the way the
  // store would have called them out: the search worker holds the space between
  // two searches and hears about every row that is written. See web/store.ts.
  const rows = await new Promise((resolve, reject) => {
    const ask = db.transaction('files', 'readonly').objectStore('files').getAll()
    ask.onsuccess = () => resolve(ask.result)
    ask.onerror = () => reject(ask.error)
  })
  new BroadcastChannel('nib:rows').postMessage({ rows, gone: [] })

  return { ms: Math.round(performance.now() - began), bytes }
}
"""

SEED_PAPERS = """
async ({ root, papers }) => {
  const open = indexedDB.open('nib')
  const db = await new Promise((resolve, reject) => {
    open.onsuccess = () => resolve(open.result)
    open.onerror = () => reject(open.error)
  })

  const made = Date.now()
  await new Promise((resolve, reject) => {
    const write = db.transaction(['assets', 'stats'], 'readwrite')
    const store = write.objectStore('assets')
    const listing = write.objectStore('stats')

    for (const [name, data] of papers) {
      const path = root + '/' + name
      store.put({ path, type: 'application/pdf', data, modified: made })
      listing.put({ path, modified: made, created: made })
    }

    write.oncomplete = () => resolve()
    write.onerror = () => reject(write.error)
  })

  await window.nibApp.workspace.loadTree()
  return window.nibApp.workspace.files.filter((one) => one.name.endsWith('.pdf')).length
}
"""

TIMED = """
async ({ source, wait }) => {
  const search = window.nibApp.search
  const began = performance.now()
  search.ask(source)

  await new Promise((resolve) => {
    const look = () => {
      if (!search.running) resolve()
      else setTimeout(look, 4)
    }
    setTimeout(look, 4)
  })

  return {
    ms: Math.round((performance.now() - began - wait) * 10) / 10,
    hits: search.hits.length,
  }
}
"""

def searching(page) -> None:
    page.evaluate("() => window.nibApp.workspace.showPanel('search')")

def held_text(page) -> str:
    return str(
        page.evaluate("() => document.querySelector('.find')?.getAttribute('data-search')")
    )

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
    page.evaluate(f"() => window.nibApp.theme.setScheme('{scheme}')")
    page.wait_for_timeout(200)
    return context, page

def drive(browser, out: Path, name, width, height, agent, finger, scheme) -> None:
    shots = out
    shots.mkdir(parents=True, exist_ok=True)
    context, page = opened(browser, width, height, agent, finger, scheme, name)

    def shot(tag: str) -> None:
        page.screenshot(path=str(shots / f"{name}-{tag}.png"))
        say(f"shot {name}-{tag}.png")

    def ask(source: str, pause: int = 900) -> None:
        field = page.locator("aside input.query")
        field.click()
        field.fill(source)
        page.wait_for_timeout(pause)

    say(f"[{name}] the space holds {page.evaluate(SEED)} notes")
    page.evaluate("() => window.nibApp.workspace.showPanel('search')")
    page.wait_for_timeout(500)
    shot("panel")

    ask("ta", 500)
    shot("operators")
    say(
        f"[{name}] typing 'ta' offers"
        f" {page.evaluate('() => [...document.querySelectorAll(String.raw`aside .suggest button`)].map((one) => one.textContent.trim())')}"
    )

    ask("task-todo:")
    shot("tasks")
    boxes = page.locator("aside .hit input[type=checkbox]")
    say(f"[{name}] {boxes.count()} rows have a box")

    if boxes.count():
        before = page.evaluate(
            "() => window.nibApp.workspace.notes.length && window.nibApp.search.hits.length"
        )
        boxes.first.click(force=True)
        page.wait_for_timeout(1200)
        say(
            f"[{name}] a box ticked: {before} rows became"
            f" {page.evaluate('() => window.nibApp.search.hits.length')}"
        )
        shot("ticked")

    ask("[pages:>200]")
    shot("pages")
    say(f"[{name}] [pages:>200] found {page.evaluate('() => window.nibApp.search.hits.length')}")

    ask("[due:<2026-10-01]")
    say(
        f"[{name}] [due:<2026-10-01] found"
        f" {page.evaluate('() => window.nibApp.search.hits.length')}"
    )

    ask("plan")
    tab = page.locator("aside .tools button[aria-label=Sort]")
    if tab.count():
        tab.first.click()
        page.wait_for_timeout(400)
        shot("order")
        page.keyboard.press("Escape")
        page.wait_for_timeout(300)

    page.evaluate(
        """() => {
          const ws = window.nibApp.workspace
          ws.excluded.toggle(ws.activeSpace.root + '/Archive')
        }"""
    )
    ask("kestrel")
    say(
        f"[{name}] with the archive left out, kestrel finds"
        f" {page.evaluate('() => window.nibApp.search.hits.map((one) => one.name)')}"
    )
    shot("excluded")

    page.evaluate("() => window.nibApp.workspace.showPanel('tree')")
    page.wait_for_timeout(500)
    page.evaluate(
        """() => {
          const ws = window.nibApp.workspace
          ws.device.expand(ws.activeSpace.root + '/Archive')
          return ws.loadTree()
        }"""
    )
    page.wait_for_timeout(600)
    shot("tree-dimmed")

    rows = page.locator("aside .row").filter(has_text="Archive")
    if rows.count():
        rows.first.click(button="right", force=True)
        page.wait_for_timeout(400)
        shot("row-menu")
        page.keyboard.press("Escape")
        page.wait_for_timeout(300)

    page.evaluate(
        """() => {
          const ws = window.nibApp.workspace
          ws.excluded.toggle(ws.activeSpace.root + '/Archive')
        }"""
    )

    page.evaluate(
        """async () => {
          const ws = window.nibApp.workspace
          const note = ws.notes.find((one) => one.name.startsWith('Everything open'))
          if (note) await ws.openEntry(note.path, { activate: true })
          ws.closePanel()
        }"""
    )
    page.wait_for_timeout(1600)
    shot("fence-editing")
    say(
        f"[{name}] the fence drew {page.evaluate('() => document.querySelectorAll(String.raw`.nib-query .nib-row`).length')} rows"
        f" under {page.evaluate('() => document.querySelectorAll(String.raw`.nib-query .nib-section`).length')} names"
    )

    page.evaluate(
        "() => window.nibApp.workspace.toggleReading(window.nibApp.workspace.active?.id)"
    )
    page.wait_for_timeout(1800)
    shot("fence-reading")
    say(
        f"[{name}] and in the reading view"
        f" {page.evaluate('() => document.querySelectorAll(String.raw`.nib-query .nib-row`).length')} rows"
    )

    box = page.locator(".nib-query input[data-task]")
    if box.count():
        was = box.count()
        box.first.click(force=True)
        page.wait_for_timeout(2000)
        say(
            f"[{name}] a box ticked in the fence: {was} open tasks became"
            f" {page.locator('.nib-query input[data-task]').count()}"
        )
        shot("fence-ticked")
    else:
        say(f"[{name}] no box in the fence to press")

    context.close()

def measure(browser, out: Path, count: int) -> None:
    shots = out
    shots.mkdir(parents=True, exist_ok=True)
    name = "many"
    context, page = opened(browser, 1440, 900, DESKTOP_AGENT, False, "dark", name)

    root = page.evaluate("() => window.nibApp.workspace.activeSpace.root")
    seeded = page.evaluate(SEED_MANY, {"count": count, "root": root})
    held = page.evaluate("() => window.nibApp.workspace.notes.length")
    say(
        f"[{name}] {held} notes, {round(seeded['bytes'] / 1_000_000, 1)} MB,"
        f" written in {seeded['ms']} ms"
    )

    page.evaluate("() => window.nibApp.workspace.showPanel('search')")
    page.wait_for_timeout(400)

    wait = 140
    asked = [
        "quarter",
        "quarter plan",
        '"wind above the field"',
        "tag:work/7",
        "task-todo:quarter",
        "[pages:>400]",
        "[due:<2026-03-01]",
        "path:Note 4",
        "quater",
        "zzzqx",
    ]

    say(f"[{name}] holding {held_text(page)}")

    for source in asked:
        runs = [page.evaluate(TIMED, {"source": source, "wait": wait}) for _ in range(5)]
        best = min(runs, key=lambda one: one["ms"])
        first = runs[0]
        say(
            f"[{name}] {source!r}: {best['ms']} ms best, {first['ms']} ms first,"
            f" {best['hits']} rows"
        )

    say(f"[{name}] holding {held_text(page)}")

    page.screenshot(path=str(shots / f"{name}-searched.png"))
    say(f"shot {name}-searched.png")

    page.evaluate(
        """({ root }) => {
          const ws = window.nibApp.workspace
          for (let one = 0; one < 1700; one++) ws.excluded.toggle(root + '/Note ' + one + '.md')
        }""",
        {"root": root},
    )
    page.wait_for_timeout(400)
    left = page.evaluate("() => window.nibApp.workspace.excluded.here.length")
    held = [page.evaluate(TIMED, {"source": "quarter", "wait": wait}) for _ in range(5)]
    quickest = min(held, key=lambda one: one["ms"])
    say(f"[{name}] with {left} notes left out: {quickest['ms']} ms, {quickest['hits']} rows")

    context.close()

def paper(words: str) -> str:
    import base64

    stream = f"BT /F1 18 Tf 20 100 Td ({words}) Tj ET"
    body = "\n".join(
        [
            "%PDF-1.4",
            "1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj",
            "2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj",
            "3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]/Contents 4 0 R"
            "/Resources<</Font<</F1 5 0 R>>>>>>endobj",
            f"4 0 obj<</Length {len(stream)}>>stream",
            stream,
            "endstream",
            "endobj",
            "5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj",
            "trailer<</Root 1 0 R/Size 6>>",
            "%%EOF",
        ]
    )

    return base64.b64encode(body.encode("latin-1")).decode("ascii")

def kept_papers(page) -> int:
    return page.evaluate(
        """async () => {
          const open = indexedDB.open('nib')
          const db = await new Promise((resolve, reject) => {
            open.onsuccess = () => resolve(open.result)
            open.onerror = () => reject(open.error)
          })

          const keys = await new Promise((resolve, reject) => {
            const ask = db.transaction('meta', 'readonly').objectStore('meta').getAllKeys()
            ask.onsuccess = () => resolve(ask.result)
            ask.onerror = () => reject(ask.error)
          })

          return keys.filter((key) => String(key).startsWith('papers/')).length
        }"""
    )

def papers(browser, out: Path) -> None:
    shots = out
    shots.mkdir(parents=True, exist_ok=True)
    name = "papers"
    context, page = opened(browser, 1440, 900, DESKTOP_AGENT, False, "dark", name)

    root = page.evaluate("() => window.nibApp.workspace.activeSpace.root")
    listed = page.evaluate(
        SEED_PAPERS,
        {
            "root": root,
            "papers": [
                ["Kestrel study.pdf", paper("the kestrel hangs above the field")],
                ["Ink study.pdf", paper("a study of ink and its wear on paper")],
            ],
        },
    )
    say(f"[{name}] the space holds {listed} papers")

    page.evaluate(
        "(path) => window.nibApp.workspace.openPdf(path, 1)",
        f"{root}/Kestrel study.pdf",
    )
    page.wait_for_selector(".pages", timeout=20000)
    page.wait_for_timeout(2500)
    searching(page)
    page.wait_for_timeout(400)
    say(f"[{name}] holding {held_text(page)}")
    say(f"[{name}] the store keeps {kept_papers(page)} paper")
    page.screenshot(path=str(shots / f"{name}-read.png"))

    def ask(source: str, pause: int = 1200) -> list:
        field = page.locator("aside input.query")
        field.click()
        field.fill(source)
        page.wait_for_timeout(pause)
        return page.evaluate(
            "() => window.nibApp.search.hits.map((one) => one.name + ' p' + (one.page ?? 0))"
        )

    say(f"[{name}] 'kestrel' finds {ask('kestrel')}")

    page.reload(wait_until="domcontentloaded")
    page.wait_for_function("() => !!window.nibApp", timeout=20000)
    page.wait_for_function("() => !!window.nibApp.workspace.activeSpace", timeout=20000)
    searching(page)
    page.wait_for_timeout(1500)

    say(f"[{name}] after a restart: 'kestrel' finds {ask('kestrel')}")
    say(f"[{name}] holding {held_text(page)}")
    page.screenshot(path=str(shots / f"{name}-after-restart.png"))

    page.wait_for_timeout(4000)
    say(f"[{name}] the paper nobody opened: 'ink' finds {ask('ink')}")
    say(f"[{name}] the store keeps {kept_papers(page)} papers, holding {held_text(page)}")
    page.screenshot(path=str(shots / f"{name}-unopened.png"))

    context.close()

def main() -> int:
    count = int(sys.argv[1]) if len(sys.argv) > 1 else 5000
    out = DRIVE.shots
    with DRIVE.session() as browser:
        for one in DEVICES:
            say(f"--- {one[0]} ---")
            drive(browser, out, *one)

        say("--- papers ---")
        papers(browser, out)

        say(f"--- {count} notes ---")
        measure(browser, out, count)

    return DRIVE.verdict(f"shots in {out}")

if __name__ == "__main__":
    raise SystemExit(main())
