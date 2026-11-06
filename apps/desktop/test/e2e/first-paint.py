from __future__ import annotations

import json
import statistics
from pathlib import Path

from playwright.sync_api import Page

import harness
from harness import Drive

DRIVE = Drive(__file__, served=False)
say = DRIVE.say
APP = harness.APP

DESKTOP_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko)"
    " Chrome/140.0.0.0 Safari/537.36"
)

NOTES = 3000
ROUNDS = 9

SEED = """
async (count) => {
  const open = () => new Promise((go, no) => {
    const ask = indexedDB.open('nib')
    ask.onupgradeneeded = () => {
      const db = ask.result
      for (const name of ['files', 'assets', 'stats']) {
        if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, { keyPath: 'path' })
      }
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta')
      if (!db.objectStoreNames.contains('snapshots')) {
        db.createObjectStore('snapshots', { keyPath: 'id', autoIncrement: true }).createIndex('notePath', 'notePath')
      }
    }
    ask.onsuccess = () => go(ask.result)
    ask.onerror = () => no(ask.error)
  })

  const db = await open()
  const has = (name) => db.objectStoreNames.contains(name)
  const stores = ['files', ...(has('stats') ? ['stats'] : [])]

  const folders = ['Field notes', 'Reading', 'Work', 'Work/Q3', 'Archive']
  const tags = ['#wind', '#ink', '#paper', '#kestrel', '#plan']
  const now = Date.now()

  // A note with front matter, an icon, an alias, tags and links out of it, so the
  // scan that reads every body has every kind of thing to find - and long enough to
  // be a note somebody wrote rather than a stub. Four kilobytes is a page and a
  // half, which over three thousand notes is the twelve megabytes a space of this
  // size actually weighs; a stub each would have measured the listing against a
  // store small enough for reading all of it to cost nothing, which is not the
  // space anybody has.
  const body = (at) => {
    const tag = tags[at % tags.length]
    const to = (at + 7) % count
    const lines = [
      '---',
      'icon: rocket',
      'icon-color: violet',
      'aliases:',
      `  - note ${at} elsewhere`,
      '---',
      '',
      `# Note ${at}`,
      '',
      `${tag} and a line about the wind, written on the ${at}th of the month.`,
      '',
      `See [[note-${String(to).padStart(4, '0')}]] and [the plan](Work/Q3/plan.md).`,
      '',
    ]

    for (let part = 0; lines.join('\\n').length < 4000; part++) {
      lines.push(
        `## What went in, ${part}`,
        '',
        '- Pressure on the pen',
        '- Slides out of a note',
        '',
        'The wind was steady all week, and the ink took its time. What the pen leaves',
        'behind on paper is the only part of this anybody reads twice.',
        '',
      )
    }

    return lines.join('\\n')
  }

  const pathOf = (at) => {
    const folder = at % 4 === 0 ? '' : `${folders[at % folders.length]}/`
    return `/Big/${folder}note-${String(at).padStart(4, '0')}.md`
  }

  // In batches, because one transaction of three thousand puts is a minute of
  // waiting and several hundred is not.
  const SIZE = 250
  for (let from = 0; from < count; from += SIZE) {
    await new Promise((go, no) => {
      const change = db.transaction(stores, 'readwrite')
      change.oncomplete = () => go()
      change.onerror = () => no(change.error)

      const files = change.objectStore('files')
      const listing = has('stats') ? change.objectStore('stats') : null

      for (let at = from; at < Math.min(count, from + SIZE); at++) {
        const path = pathOf(at)
        const row = { path, content: body(at), created: now - at * 1000, modified: now - at * 500 }
        files.put(row)
        listing?.put({ path, modified: row.modified, created: row.created })
      }
    })
  }

  db.close()
  return stores
}
"""

MARKS = """
window.__marks = { tree: null, note: null, worst: 0, frames: 0, task: 0 }

const marks = window.__marks
const look = () => {
  if (marks.tree === null && document.querySelector('aside .row')) {
    marks.tree = performance.now()
  }
  if (marks.note === null && document.querySelector('.cm-content')) {
    marks.note = performance.now()
  }
}

// On the document itself, which exists before there is an element in it: this runs
// before the app's first script, and a watch that waited for the body would miss
// whatever the first paint already held.
new MutationObserver(look).observe(document, { childList: true, subtree: true })

// And the longest single task the launch spends, once the list is on screen: the
// frame gap says the same thing more roughly, and a gap is easy to blame on
// whatever else the machine was doing.
new PerformanceObserver((list) => {
  if (marks.tree === null) return
  for (const one of list.getEntries()) marks.task = Math.max(marks.task, one.duration)
}).observe({ entryTypes: ['longtask'] })

let last = performance.now()
const tick = (at) => {
  // Only once the list is up: the gap before that is the launch itself, which the
  // moments above already say, and this number is about what comes after it.
  if (marks.tree !== null) {
    marks.frames += 1
    marks.worst = Math.max(marks.worst, at - last)
  }
  last = at
  requestAnimationFrame(tick)
}
requestAnimationFrame(tick)
"""

WATCHING = 4000

LISTING = """
async (rounds) => {
  const ws = window.nibApp.workspace
  const taken = []

  for (let round = 0; round < rounds; round++) {
    const started = performance.now()
    await ws.loadSpaces()
    await ws.loadTree()
    taken.push(performance.now() - started)
  }

  return taken.sort((a, b) => a - b)[Math.floor(rounds / 2)]
}
"""

SCAN = """
async (rounds) => {
  const links = window.nibApp.links
  const ws = window.nibApp.workspace
  const root = ws.activeSpace.root
  const taken = []
  let worst = 0

  const watch = new PerformanceObserver((list) => {
    for (const one of list.getEntries()) worst = Math.max(worst, one.duration)
  })
  watch.observe({ entryTypes: ['longtask'] })

  for (let round = 0; round < rounds; round++) {
    const started = performance.now()
    // Told it is of nowhere first, so the build is a build rather than a no-op.
    links.clear()
    await links.build(root)
    for (const one of ws.notes.slice(0, 3)) links.iconOf(one.path)
    taken.push(performance.now() - started)
  }

  await new Promise((go) => setTimeout(go, 300))
  watch.disconnect()

  return { scan: taken.sort((a, b) => a - b)[Math.floor(rounds / 2)], worst }
}
"""

LIST = """
async () => {
  const box = document.querySelector('aside [data-region="list"]')
  if (!box) return null

  const rows = () => document.querySelectorAll('aside [data-region="list"] .row').length
  const frame = () => new Promise((go) => requestAnimationFrame(() => requestAnimationFrame(go)))

  box.scrollTop = 0
  await frame()
  const resting = rows()

  let worst = 0
  let last = performance.now()
  let watching = true
  const tick = (at) => {
    worst = Math.max(worst, at - last)
    last = at
    if (watching) requestAnimationFrame(tick)
  }
  requestAnimationFrame(tick)

  // Half a panel at a time, from the top of the space to the bottom: what reading
  // a space of three thousand notes down actually asks of the list.
  const most = box.scrollHeight - box.clientHeight
  const step = Math.max(1, Math.floor(box.clientHeight / 2))
  let seen = resting
  for (let at = 0; at <= most; at += step) {
    box.scrollTop = at
    await frame()
    seen = Math.max(seen, rows())
  }

  watching = false
  await frame()

  return { rows: seen, scroll: worst, height: Math.round(box.scrollHeight) }
}
"""

def numbers(page: Page) -> dict[str, float]:
    return page.evaluate("() => window.__marks")

def warm(page: Page, origin: str) -> None:
    page.goto(origin, wait_until="domcontentloaded")
    page.wait_for_function("() => !!window.nibApp", timeout=60000)
    page.wait_for_function("() => !!window.nibApp.workspace.activeSpace", timeout=60000)
    page.evaluate("() => window.nibApp.workspace.showPanel('tree')")
    page.wait_for_function(
        "() => !!document.querySelector('aside .row') && !!document.querySelector('.cm-content')",
        timeout=60000,
    )
    page.wait_for_timeout(2000)

def launch(page: Page, origin: str) -> dict[str, float]:
    page.goto(origin, wait_until="commit")
    page.wait_for_function("() => window.__marks && window.__marks.tree !== null", timeout=60000)
    page.wait_for_function("() => window.__marks.note !== null", timeout=60000)

    page.wait_for_function(
        "() => window.nibApp && window.nibApp.links.rootOf() && !window.nibApp.links.scanning",
        timeout=120000,
    )
    index = page.evaluate("() => performance.now()")

    page.wait_for_timeout(WATCHING)
    taken = numbers(page)
    taken["index"] = index
    return taken

def middle(rounds: list[dict[str, float]], key: str) -> float:
    return statistics.median(one[key] for one in rounds)

SAID = [
    ("tree", "time to tree (first row painted)", "ms"),
    ("note", "time to the open note (editor painted)", "ms"),
    ("index", "link index landed", "ms"),
    ("worst", "worst frame gap after the tree", "ms"),
    ("task", "longest single task after the tree", "ms"),
    ("listing", "listing the spaces and the space, warm", "ms"),
    ("scan", "reading every body for the index, warm", "ms"),
    ("longest", "longest single task in that scan", "ms"),
    ("rows", "rows of the list in the page", ""),
    ("scroll", "worst frame gap flicking the list", "ms"),
    ("height", "how far the list runs", "px"),
]

class Lane:

    def __init__(self, tag: str, folder: Path) -> None:
        self.tag = tag
        self.folder = folder
        self.origin = ""
        self.rounds: list[dict[str, float]] = []
        self.warm: dict[str, float] = {}
        self.server: harness.Served | None = None
        self.page: Page | None = None

    def start(self) -> None:
        self.server = harness.Served(self.folder)
        self.origin = self.server.origin(f"{self.tag}.localhost")
        say(f"{self.tag}: serving {self.folder} on {self.origin}")

    def stop(self) -> None:
        if self.server:
            self.server.close()

    def ready(self, browser) -> None:
        context = browser.new_context(
            viewport={"width": 1440, "height": 900},
            user_agent=DESKTOP_AGENT,
        )
        context.add_init_script(MARKS)
        page = context.new_page()
        page.on("pageerror", lambda error: say(f"{self.tag}: page error: {error}"))

        page.goto(f"{self.origin}{harness.SEED_PATH}", wait_until="domcontentloaded")
        stores = page.evaluate(SEED, NOTES)
        say(f"{self.tag}: {NOTES} notes seeded into {stores}")

        self.page = page
        warm(page, self.origin)
        say(f"{self.tag}: session written")

    def park(self) -> None:
        if self.page:
            self.page.goto("about:blank", wait_until="domcontentloaded")

    def round(self) -> None:
        page = self.page
        if not page:
            return

        taken = launch(page, self.origin)
        self.rounds.append(taken)
        say(
            f"{self.tag} round {len(self.rounds)}: tree {taken['tree']:.0f}ms"
            f"  note {taken['note']:.0f}ms"
            f"  index {taken['index']:.0f}ms"
            f"  worst frame gap {taken['worst']:.0f}ms"
            f"  longest task {taken['task']:.0f}ms"
        )

    def measure(self) -> None:
        page = self.page
        if not page:
            return

        warm(page, self.origin)
        listed = page.evaluate(LIST) or {}
        scanning = page.evaluate(SCAN, 3)
        self.warm = {
            "listing": page.evaluate(LISTING, ROUNDS),
            "scan": scanning["scan"],
            "longest": scanning["worst"],
            **{key: listed[key] for key in ("rows", "scroll", "height") if key in listed},
        }

    def numbers(self) -> dict[str, float]:
        return {
            **{key: middle(self.rounds, key) for key, *_ in SAID if key in self.rounds[0]},
            **self.warm,
        }

def main() -> int:
    if harness.OWN_BUILD:
        harness.build()
    wanted = [
        Lane("before", APP / "dist-before"),
        Lane("after", harness.DIST),
    ]
    lanes = [one for one in wanted if (one.folder / "index.html").exists()]
    if not lanes:
        say("nothing built")
        return 1

    for lane in lanes:
        lane.start()

    try:
        with DRIVE.session() as browser:
            for lane in lanes:
                lane.ready(browser)

            for _ in range(ROUNDS):
                for lane in lanes:
                    for other in lanes:
                        if other is not lane:
                            other.park()
                    lane.round()

            for lane in lanes:
                for other in lanes:
                    if other is not lane:
                        other.park()
                lane.measure()
    finally:
        for lane in lanes:
            lane.stop()

    print()
    print(f"median of {ROUNDS} launches over {NOTES} notes, run turn and turn about:")
    print(f"  {'':44} {'  '.join(f'{lane.tag:>9}' for lane in lanes)}")
    found = {lane.tag: lane.numbers() for lane in lanes}

    for key, words, unit in SAID:
        row = "  ".join(f"{found[lane.tag].get(key, 0):7.0f}{unit:<2}" for lane in lanes)
        print(f"  {words:44} {row}")

    print()
    print(json.dumps({tag: {key: round(value) for key, value in one.items()} for tag, one in found.items()}))
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
