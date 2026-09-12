"""What the built web app actually costs, in Chrome, measured against counted work.

Eleven things are timed, twice over: once against the build as it stands and once
against a build of the code before the change, served side by side on ports of
their own so neither is what the machine was doing while the other was measured.

    launch          the navigation to the first paint, to the file list, to the
                    editor, and to the first half second the main thread has
                    nothing left to do in - which is the first moment a keystroke
                    would land in the frame it was typed in
    big note        a note of twenty thousand lines opened, and a key pressed at
                    the end of it, input to paint
    tabs            the other tab shown
    palette         Mod-P to the list on screen
    settings        the sheet on screen
    search          four queries over five thousand notes: one hit, no hits, a
                    tag, a task - and whether the notes were read again for any
                    of them, which is the counter the worker keeps
    graph           five thousand nodes, panned
    canvas          ten thousand strokes: opened, panned, zoomed, drawn on
    reading         the big note as a page
    memory          the heap once the launch has settled

Nothing here asserts. It prints numbers, and the numbers are medians of several
rounds run turn and turn about, because this machine's own load moves by more than
most of these changes do. The counted work behind each fix is asserted in the unit
tests beside the code it is about; a clock says what the machine was doing and a
count says what the code did.

Two builds, each with the app's own handle on the page - a production build hides
the stores this reads. From the repository root:

    cd apps/desktop
    NODE_ENV=development pnpm exec vite build --mode development

and, from a tree without the change in it, the same again into a folder of its own:

    NODE_ENV=development pnpm exec vite build --mode development --outDir dist-before

Then, from the repository root:

    python apps/desktop/test/e2e/speed.py

Either folder on its own is fine; the one that is there is the one that is driven.
A subset by name, when one number is being chased:

    python apps/desktop/test/e2e/speed.py launch search canvas

The names are the keys of `PARTS`. `--rounds` sets how many of each.

When a number here is bad, the next question is which function. The long animation
frames this prints already name the file and the handler; for the function, build a
third time with the names left in and take a sampling profile of the one thing:

    NODE_ENV=development pnpm exec vite build --mode development \
        --outDir dist-profile --minify false

then drive that folder with Chrome's own profiler through `CDPSession`
(`Profiler.enable`, `Profiler.start`, the gesture, `Profiler.stop`) and sum the
samples per call frame. Every cause named in this file's comments was found that
way, and the folder is ignored so it can be left lying about.
"""

from __future__ import annotations

import argparse
import functools
import http.server
import json
import statistics
import threading
from pathlib import Path

from playwright.sync_api import Page, sync_playwright

ROOT = Path(__file__).resolve().parents[4]
APP = ROOT / "apps" / "desktop"

# Above 1425, and not any other drive's port. One per build and per space: two
# builds cannot share one database, and a space of five thousand notes in the same
# database as the empty one would make the empty launch a launch of both.
PORTS = {("before", "big"): 18301, ("after", "big"): 18302, ("before", "empty"): 18303, ("after", "empty"): 18304}

DESKTOP_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko)"
    " Chrome/140.0.0.0 Safari/537.36"
)

#: How many notes the big space holds.
NOTES = 5000
#: How many lines the big note holds.
LINES = 20000
#: How many ink strokes the canvas holds.
STROKES = 10000
#: How many points each of them went through.
POINTS = 10

#: A page on the app's own origin that is not the app, so the storage underneath it
#: can be written before the app is up to read it.
SEED_PAGE = "<!doctype html><title>seed</title><p>seeding"

#: How long to watch for jank while a gesture runs.
GESTURE = 1500

#: How many launches a lane gets before any of them is timed; see `ready`.
WARMING = 3

#: How long the machine is left alone between one lane's round and the next.
SETTLING = 2000


def say(words: str) -> None:
    print(f"  {words}", flush=True)


class Quiet(http.server.SimpleHTTPRequestHandler):
    """The same server, without a line per asset."""

    def log_message(self, *args: object) -> None:  # noqa: D102
        return


# --------------------------------------------------------------------------- seed

# The notes, the big note and the canvas, written the way the app's own store
# writes them: a row per path in `files`, and the listing beside it in `stats`.
# Which stores exist is read off the database rather than assumed, so the same
# drive seeds a build from before a store was added.
SEED = r"""
async (plan) => {
  const { notes, lines, strokes, points, space } = plan

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
  const now = Date.now()

  const rows = []
  const add = (path, content, at) => rows.push({ path, content, created: now - at * 1000, modified: now - at * 500 })

  const folders = ['Field notes', 'Reading', 'Work', 'Work/Q3', 'Archive']
  const tags = ['#wind', '#ink', '#paper', '#kestrel', '#plan']

  // A note with front matter, an icon, an alias, tags, tasks and links out of it,
  // so every operator has something to find and the scan that reads every body has
  // every kind of thing in it. Four kilobytes is a page and a half, which over five
  // thousand notes is the twenty megabytes a space of this size actually weighs: a
  // stub each would have measured the search against a store small enough for
  // reading all of it to cost nothing, which is not the space anybody has.
  const body = (at) => {
    const tag = tags[at % tags.length]
    const to = (at + 7) % notes
    const out = [
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
      // The one word in the space that names this note and nothing else: a query
      // for it is a hit the walk cannot stop early on, which is the search every
      // other one is faster than.
      `Filed under marker-${String(at).padStart(4, '0')}.`,
      '',
      `See [[note-${String(to).padStart(4, '0')}]] and [the plan](Work/Q3/plan.md).`,
      '',
      '- [ ] Pressure on the pen',
      '- [x] Slides out of a note',
      '',
    ]

    for (let part = 0; out.join('\n').length < 4000; part++) {
      out.push(
        `## What went in, ${part}`,
        '',
        'The wind was steady all week, and the ink took its time. What the pen leaves',
        'behind on paper is the only part of this anybody reads twice.',
        '',
      )
    }

    return out.join('\n')
  }

  const pathOf = (at) => {
    const folder = at % 4 === 0 ? '' : `${folders[at % folders.length]}/`
    return `${space}/${folder}note-${String(at).padStart(4, '0')}.md`
  }

  for (let at = 0; at < notes; at++) add(pathOf(at), body(at), at)

  // The folder marker, so a space with no notes in it is still a space.
  add(`${space}/.keep`, '', notes)

  // One small note, so every space has an editor to reach - the empty one too.
  add(`${space}/first.md`, '# First\n\nA short note, opened at launch.\n', notes + 1)
  add(`${space}/second.md`, '# Second\n\nThe other tab.\n', notes + 2)

  // The big note: twenty thousand lines with headings, links, tasks and tags
  // through it, so the editor has the work a long note of somebody's actually is
  // rather than one paragraph repeated.
  if (lines) {
    const long = ['# The long one', '']
    for (let line = 0; long.length < lines; line++) {
      if (line % 40 === 0) long.push(`## Part ${line / 40}`, '')
      if (line % 17 === 0) long.push(`- [ ] Something at line ${line} #plan`)
      else if (line % 11 === 0) long.push(`See [[note-${String(line % 1000).padStart(4, '0')}]] on this.`)
      else if (line % 7 === 0) long.push('')
      else long.push(`Line ${line}: the wind was steady and the ink took its time on the page.`)
    }
    add(`${space}/long.md`, long.join('\n'), notes + 3)
  }

  // And the canvas: ten thousand strokes of ink, spread over a plane wide enough
  // that panning brings new ones into view, plus a handful of cards so the plane is
  // a plane rather than a drawing.
  if (strokes) {
    const ink = []
    for (let at = 0; at < strokes; at++) {
      const column = at % 100
      const row = Math.floor(at / 100)
      const x = column * 120 + 40
      const y = row * 120 + 40
      const packed = []
      for (let step = 0; step < points; step++) {
        packed.push(
          Math.round((x + step * 8) * 10) / 10,
          Math.round((y + Math.sin(step) * 20) * 10) / 10,
          0.5,
          0,
          0,
          step * 12,
        )
      }
      ink.push({ id: `s${at}`, tool: 'pen', color: 'ink', size: 3, points: packed })
    }

    const nodes = []
    for (let at = 0; at < 20; at++) {
      nodes.push({
        id: `n${at}`,
        type: 'text',
        x: (at % 5) * 400,
        y: Math.floor(at / 5) * 300,
        width: 260,
        height: 120,
        text: `Card ${at}`,
      })
    }

    add(`${space}/plane.canvas`, JSON.stringify({ nodes, edges: [], nib: { version: 1, ink } }), notes + 4)
  }

  // In batches, because one transaction of five thousand puts is a minute of
  // waiting and several hundred is not.
  const SIZE = 200
  for (let from = 0; from < rows.length; from += SIZE) {
    await new Promise((go, no) => {
      const change = db.transaction(stores, 'readwrite')
      change.oncomplete = () => go()
      change.onerror = () => no(change.error)

      const files = change.objectStore('files')
      const listing = has('stats') ? change.objectStore('stats') : null

      for (const row of rows.slice(from, from + SIZE)) {
        files.put(row)
        listing?.put({ path: row.path, modified: row.modified, created: row.created })
      }
    })
  }

  db.close()
  return { rows: rows.length, stores }
}
"""

# --------------------------------------------------------------------------- marks

# Installed before the app's first script runs, so every moment is taken against
# the navigation rather than against whenever a poll got round to looking.
#
# Four moments and two counters. The moments are the first paint the browser
# reports, the first row of the file list, the editor, and - worked out at the end -
# the first half second after the editor in which no task ran long enough to eat a
# frame, which is the first moment typing would have appeared in the frame it
# happened in. The counters are every long task and every long animation frame,
# kept with the scripts the browser blames for them, which is the profile.
MARKS = r"""
window.__marks = { paint: null, tree: null, editor: null, tasks: [], loaf: [] }
const marks = window.__marks

const look = () => {
  if (marks.tree === null && document.querySelector('aside .row')) marks.tree = performance.now()
  if (marks.editor === null && document.querySelector('.cm-content')) marks.editor = performance.now()
}

// On the document itself, which exists before there is an element in it: this runs
// before the app's first script, and a watch that waited for the body would miss
// whatever the first paint already held.
new MutationObserver(look).observe(document, { childList: true, subtree: true })

new PerformanceObserver((list) => {
  for (const one of list.getEntries()) {
    if (one.name === 'first-contentful-paint' && marks.paint === null) marks.paint = one.startTime
  }
}).observe({ type: 'paint', buffered: true })

new PerformanceObserver((list) => {
  for (const one of list.getEntries()) marks.tasks.push({ at: one.startTime, ms: one.duration })
}).observe({ entryTypes: ['longtask'] })

// The long animation frames, with what the browser blames: a frame's own length,
// how much of it blocked, how long style and layout were forced inside it, and the
// three longest scripts by name. This is the attribution the profile is read from.
if (typeof PerformanceObserver.supportedEntryTypes !== 'undefined'
    && PerformanceObserver.supportedEntryTypes.includes('long-animation-frame')) {
  new PerformanceObserver((list) => {
    for (const one of list.getEntries()) {
      const scripts = [...(one.scripts ?? [])]
        .sort((a, b) => b.duration - a.duration)
        .slice(0, 3)
        .map((script) => ({
          name: `${script.invokerType ?? ''} ${script.invoker ?? ''} ${script.sourceFunctionName ?? ''}`.trim(),
          url: (script.sourceURL ?? '').split('/').pop() ?? '',
          ms: Math.round(script.duration),
          layout: Math.round(script.forcedStyleAndLayoutDuration ?? 0),
        }))

      marks.loaf.push({
        at: one.startTime,
        ms: one.duration,
        blocking: one.blockingDuration,
        render: one.renderStart ? one.startTime + one.duration - one.renderStart : 0,
        layout: one.styleAndLayoutStart ? one.startTime + one.duration - one.styleAndLayoutStart : 0,
        scripts,
      })
    }
  }).observe({ type: 'long-animation-frame', buffered: true })
}

// Frames, collected only while something is being driven: the gap between two of
// them is the length of whatever sat in between, which is the frame a reader lost.
window.__frames = { list: [], on: false, last: 0 }
const tick = (at) => {
  const frames = window.__frames
  if (frames.on) {
    if (frames.last) frames.list.push(at - frames.last)
    frames.last = at
  } else {
    frames.last = 0
  }
  requestAnimationFrame(tick)
}
requestAnimationFrame(tick)

/** Every moment since the page was navigated to, cleared so the next gesture's
 *  jank is its own. */
window.__since = () => {
  const marks = window.__marks
  marks.tasks = []
  marks.loaf = []
  window.__frames.list = []
  window.__frames.last = 0
  return performance.now()
}

/** One frame the browser has actually painted: the first callback runs before the
 *  paint it was scheduled for, so the second is the first moment the pixels are on
 *  screen. Everything below that says "to paint" waits for this. */
window.__painted = () => new Promise((go) => requestAnimationFrame(() => requestAnimationFrame(() => go(performance.now()))))
"""

#: How long after the editor to look for a quiet stretch, and how long a stretch
#: has to be to count as one.
SETTLED_WITHIN = 8000
QUIET = 500

# --------------------------------------------------------------------------- steps

LAUNCHED = "() => !!window.nibApp && !!window.nibApp.workspace.activeSpace"

#: The note every launch opens, and the one beside it for the tab switch.
FIRST = "first.md"
SECOND = "second.md"

# The launch, once the app is up and has stopped moving: the four moments, the
# longest task after the editor, and the heap. `settled` is worked out here rather
# than watched for, because it is a property of the list of tasks.
LAUNCH = r"""
(quiet) => {
  const marks = window.__marks
  const after = marks.editor ?? 0
  const tasks = marks.tasks.filter((one) => one.at + one.ms > after)

  // The first moment with nothing long enough to eat a frame for `quiet` after it.
  let settled = after
  for (const one of tasks.sort((a, b) => a.at - b.at)) {
    if (one.at - settled >= quiet) break
    settled = Math.max(settled, one.at + one.ms)
  }

  const worst = tasks.reduce((most, one) => Math.max(most, one.ms), 0)
  const memory = performance.memory ? performance.memory.usedJSHeapSize : 0

  return {
    paint: marks.paint ?? 0,
    tree: marks.tree ?? 0,
    editor: marks.editor ?? 0,
    settled: settled + quiet,
    worst,
    tasks: tasks.filter((one) => one.ms >= 50).length,
    memory: Math.round(memory / 1e6),
    // Every long frame of the launch, not only the ones after the editor: what
    // holds the first paint up is before it by definition, and a profile that
    // started at the editor could not see it.
    loaf: marks.loaf.filter((one) => one.ms >= 60),
  }
}
"""

# One note opened by path, timed from the call to the frame the editor's own
# document is that note in. The editor is asked rather than the DOM: a long note is
# drawn a viewport at a time, so the rows on screen say nothing about whether the
# document has landed.
OPEN_NOTE = r"""
async (path) => {
  const ws = window.nibApp.workspace
  const started = window.__since()
  await ws.open(path)
  // The editor catches up on the frame after the tab does.
  for (let spin = 0; spin < 240; spin++) {
    await window.__painted()
    if (ws.active?.path === path && document.querySelector('.cm-content')) break
  }
  const painted = await window.__painted()
  return { ms: painted - started, loaf: window.__marks.loaf, tasks: window.__marks.tasks }
}
"""

# The other tab shown: the store is told, and the frame after it is when the words
# are on screen.
SWITCH = r"""
async (id) => {
  const ws = window.nibApp.workspace
  const started = window.__since()
  ws.activeTabId = id
  const painted = await window.__painted()
  return { ms: painted - started, loaf: window.__marks.loaf }
}
"""

# The settings sheet. Opened through its own store rather than through a pointer,
# because what is being timed is the sheet being built and not the click.
SHEET = r"""
async () => {
  const started = window.__since()
  window.nibApp.settings.open = true
  for (let spin = 0; spin < 120; spin++) {
    await window.__painted()
    if (document.querySelector('.sheet, .settings, dialog[open]')) break
  }
  const painted = await window.__painted()
  return { ms: painted - started, loaf: window.__marks.loaf }
}
"""

SHUT_SHEET = "() => { window.nibApp.settings.open = false }"

# One query, from the word being typed to the last note having answered, less the
# wait the field keeps before it asks at all - which is a decision about typing
# rather than a cost. The counter the worker keeps is read either side of it: rows
# read out of storage, which is what "the notes are kept between searches" means.
QUERY = r"""
async (plan) => {
  const { text, wait } = plan
  const search = window.nibApp.search
  const held = () => document.querySelector('[data-search]')?.dataset.search ?? ''
  const readOf = (line) => Number(/read=(\d+)/.exec(line)?.[1] ?? -1)

  const before = readOf(held())
  const started = performance.now()
  search.ask(text)
  await new Promise((go) => {
    const look = () => (search.running ? setTimeout(look, 4) : go())
    setTimeout(look, 4)
  })
  const ms = performance.now() - started - wait
  // The worker says what it is holding after it has answered, which is a message
  // back to the page: give it the turn it needs to land.
  await new Promise((go) => setTimeout(go, 120))

  return { ms, hits: search.hits.length, read: readOf(held()) - Math.max(0, before), warmth: held() }
}
"""

# A gesture watched: frames while it runs, and the frames the browser called long.
WATCH_START = "() => { window.__t0 = window.__since(); window.__frames.on = true }"
WATCH_STOP = r"""
() => {
  window.__frames.on = false
  const frames = window.__frames.list
  const sorted = [...frames].sort((a, b) => a - b)
  const middle = sorted[Math.floor(sorted.length / 2)] ?? 0
  return {
    frames: frames.length,
    middle,
    fps: middle ? Math.round(1000 / middle) : 0,
    worst: sorted.at(-1) ?? 0,
    ninety: sorted[Math.floor(sorted.length * 0.9)] ?? 0,
    loaf: window.__marks.loaf.filter((one) => one.ms >= 50),
  }
}
"""


def median(rounds: list[dict[str, float]], key: str) -> float:
    found = [one[key] for one in rounds if key in one]
    return statistics.median(found) if found else 0.0


def blame(entries: list[dict]) -> list[str]:
    """The scripts the browser blamed for the long frames, worst first, as lines."""
    worst: dict[str, dict[str, float]] = {}
    for frame in entries:
        for script in frame.get("scripts", []):
            name = f"{script.get('url', '')} {script.get('name', '')}".strip()
            if not name:
                continue
            held = worst.setdefault(name, {"ms": 0, "layout": 0, "times": 0})
            held["ms"] = max(held["ms"], script.get("ms", 0))
            held["layout"] = max(held["layout"], script.get("layout", 0))
            held["times"] += 1

    lines = []
    for name, held in sorted(worst.items(), key=lambda one: -one[1]["ms"])[:6]:
        layout = f" layout {held['layout']:.0f}ms" if held["layout"] else ""
        lines.append(f"{held['ms']:.0f}ms x{held['times']:.0f}{layout}  {name}")

    return lines


# --------------------------------------------------------------------------- parts


def part_launch(lane: Lane, page: Page) -> dict[str, object]:
    """One measured launch: the navigation, the four moments, and the heap."""
    page.goto(lane.origin, wait_until="commit")
    page.wait_for_function("() => window.__marks.editor !== null", timeout=120000)
    page.wait_for_function(LAUNCHED, timeout=120000)
    page.wait_for_timeout(SETTLED_WITHIN)
    # Swept first, or the heap is whatever the collector had not got round to: the
    # same build read 123MB one round and 215MB the next without it.
    lane.sweep()
    found = page.evaluate(LAUNCH, QUIET)
    lane.profile("launch", found.pop("loaf"))
    return found


def part_note(lane: Lane, page: Page) -> dict[str, object]:
    """The big note opened, and a key pressed at the end of it."""
    if lane.space == "empty":
        return {}

    ready(page, lane)
    # The launch's own reads have to be out of the way first. This part is about the
    # editor, and a keystroke measured while the space is still being scanned measures
    # the scan: the browser blamed `IDBRequest.onsuccess` for eight hundred
    # milliseconds inside the typing window, in both builds alike.
    settled(page)
    opened = page.evaluate(OPEN_NOTE, f"{lane.root}/long.md")
    lane.profile("big note opened", opened["loaf"])

    # The end of it, which is where a note this long is slowest: every line above
    # the caret is a line the editor has to have measured to know where it is.
    page.click(".cm-content")
    page.keyboard.press("Control+End")
    page.wait_for_timeout(400)

    typed = page.evaluate(TYPING_READY)
    del typed
    for _ in range(12):
        page.keyboard.press("x")
        page.wait_for_timeout(90)

    latency = page.evaluate(TYPING)
    lane.profile("typing at the end of the big note", latency.pop("loaf"))

    # A round where the keys never reached the editor says nothing about typing, and
    # its noughts would read as "no wait at all".
    if not latency.pop("keys"):
        lane.note("the keystrokes went nowhere; that round is not in the typing numbers")
        latency = {}

    reading = page.evaluate(READING)
    lane.profile("reading the big note", reading.pop("loaf"))
    page.evaluate("() => window.nibApp.workspace.toggleReading()")
    page.wait_for_timeout(300)

    return {"note-open": opened["ms"], **latency, **reading}


# The keystrokes, taken from the browser's own event timing rather than from a
# clock around `press`: what a reader feels is the key going down to the frame that
# shows the letter, which is exactly what this entry measures. Eight millisecond
# buckets, which is the browser rounding and not this drive.
TYPING_READY = r"""
() => {
  window.__keys = []
  new PerformanceObserver((list) => {
    for (const one of list.getEntries()) {
      if (one.name === 'keydown') window.__keys.push({ ms: one.duration, handler: one.processingEnd - one.processingStart })
    }
  }).observe({ type: 'event', durationThreshold: 0 })
  window.__since()
  return true
}
"""

TYPING = r"""
() => {
  const keys = window.__keys ?? []
  const by = (pick) => {
    const sorted = keys.map(pick).sort((a, b) => a - b)
    return { middle: sorted[Math.floor(sorted.length / 2)] ?? 0, worst: sorted.at(-1) ?? 0 }
  }

  const paint = by((one) => one.ms)
  const handler = by((one) => one.handler)
  return {
    // How many keystrokes were actually seen, so a round where the keys went
    // somewhere else is a round with nothing in it rather than a nought: a nought
    // read as "no wait at all" and dragged the median of every other round down.
    keys: keys.length,
    'type-paint': paint.middle,
    'type-worst': paint.worst,
    'type-handler': handler.middle,
    loaf: window.__marks.loaf.filter((one) => one.ms >= 50),
  }
}
"""

READING = r"""
async () => {
  const ws = window.nibApp.workspace
  performance.clearMeasures('nib:reading')
  const started = window.__since()
  ws.toggleReading()

  // The page painted - and the render's own measure beside it, which is what the
  // renderer already takes for exactly this question; see `MEASURE` in
  // lib/reading/render.ts. A spin on a selector that never matched measured the
  // spin, which is how the first run of this said twenty-five seconds.
  for (let spin = 0; spin < 900; spin++) {
    await window.__painted()
    if (document.querySelector('.read #write')?.childElementCount) break
  }
  const painted = await window.__painted()
  const render = performance.getEntriesByName('nib:reading').at(-1)?.duration ?? 0

  return {
    reading: painted - started,
    'reading-render': render,
    loaf: window.__marks.loaf.filter((one) => one.ms >= 50),
  }
}
"""


def part_shell(lane: Lane, page: Page) -> dict[str, object]:
    """The two tabs, the palette and the settings sheet."""
    ready(page, lane)

    page.evaluate(OPEN_NOTE, f"{lane.root}/{FIRST}")
    page.evaluate(OPEN_NOTE, f"{lane.root}/{SECOND}")
    tabs = page.evaluate("() => window.nibApp.workspace.tabs.map((one) => one.id)")
    switched = page.evaluate(SWITCH, tabs[0])
    lane.profile("tab switch", switched["loaf"])
    back = page.evaluate(SWITCH, tabs[-1])
    del back

    # The palette, driven by its own key so the keystroke is in the number.
    page.evaluate(WATCH_START)
    page.keyboard.press("Control+p")
    page.wait_for_selector(".palette, .quick, [role=listbox]", timeout=20000)
    palette = page.evaluate(PALETTE)
    lane.profile("palette", palette.pop("loaf"))
    page.keyboard.press("Escape")
    page.wait_for_timeout(200)

    sheet = page.evaluate(SHEET)
    lane.profile("settings", sheet["loaf"])
    page.evaluate(SHUT_SHEET)
    page.wait_for_timeout(200)

    return {"tab-switch": switched["ms"], **palette, "settings": sheet["ms"]}


PALETTE = r"""
async () => {
  const started = window.__t0 ?? performance.now()
  const painted = await window.__painted()
  window.__frames.on = false
  const rows = document.querySelectorAll('.palette li, .palette .row, [role=option]').length
  return { palette: painted - started, 'palette-rows': rows, loaf: window.__marks.loaf }
}
"""


def part_search(lane: Lane, page: Page) -> dict[str, object]:
    """Four queries over the space, and what the worker was holding either side."""
    if lane.space == "empty":
        return {}

    ready(page, lane)
    # Opening the panel is a cost of its own: it asks the space for its tags, which
    # is the one thing on this surface that reads every note there is.
    panel = page.evaluate(PANEL)
    lane.profile("search panel opened", panel.pop("loaf"))
    # Attached rather than visible: the line is a data attribute on a row that a
    # theme may give no size at all, and what is being read is the attribute.
    page.wait_for_selector("[data-search]", state="attached", timeout=30000)
    # The pass that reads the space into the worker is part of the launch, not part
    # of a query: wait for it to say it is warm before asking anything.
    page.wait_for_function(
        "() => /warm=1/.test(document.querySelector('[data-search]')?.dataset.search ?? '')",
        timeout=180000,
    )

    found: dict[str, object] = dict(panel)
    for name, text in QUERIES:
        one = page.evaluate(QUERY, {"text": text, "wait": 140})
        page.evaluate("() => window.nibApp.search.clear()")
        page.wait_for_timeout(80)
        found[f"q-{name}"] = one["ms"]
        found[f"q-{name}-read"] = one["read"]
        lane.note(f"{name}: {one['hits']} hits, {one['read']} rows read  [{one['warmth']}]")

    return found


PANEL = r"""
async () => {
  const ws = window.nibApp.workspace
  const started = window.__since()
  ws.showPanel('search')

  // Two moments, because they are two questions. The panel is on screen when the
  // field is there to type in; the tag tree above it says what the space is tagged
  // with, and where that comes from is the thing being measured - off the disk, which
  // costs a read of every note, or off the index, which costs nothing and is not
  // answerable until the space has been scanned once.
  let panel = 0
  let tags = 0
  for (let spin = 0; spin < 900 && !(panel && tags); spin++) {
    const at = await window.__painted()
    if (!panel && document.querySelector('[data-search]')) panel = at - started
    if (!tags && ws.tags?.length) tags = at - started
  }

  return {
    'search-panel': panel,
    'search-tags': tags,
    loaf: window.__marks.loaf.filter((one) => one.ms >= 50),
  }
}
"""


#: The four questions, and what each is about.
QUERIES = [
    ("hit", "marker-4242"),
    ("none", "zzqqxxnothing"),
    ("tag", "tag:kestrel"),
    ("task", "task:pressure"),
]


def part_graph(lane: Lane, page: Page) -> dict[str, object]:
    """The picture of the space, opened and panned."""
    if lane.space == "empty":
        return {}

    ready(page, lane)
    opened = page.evaluate(OPEN_GRAPH)
    lane.profile("graph opened", opened.pop("loaf"))

    page.wait_for_selector(".graph, canvas", state="visible", timeout=90000)
    box = page.locator(".graph, canvas").first.bounding_box()
    if not box:
        return opened

    panned = drag(lane, page, box, "graph panned", button="left")
    hovered = hover(lane, page, box)
    return {
        "graph-open": opened["ms"],
        "graph-fps": panned["fps"],
        "graph-worst": panned["worst"],
        "hover-fps": hovered["fps"],
        "hover-worst": hovered["worst"],
    }


OPEN_GRAPH = r"""
async () => {
  const ws = window.nibApp.workspace
  const started = window.__since()
  ws.openGraph()
  for (let spin = 0; spin < 900; spin++) {
    await window.__painted()
    if (document.querySelector('.graph canvas, .graph svg, canvas.graph')) break
  }
  const painted = await window.__painted()
  return { ms: painted - started, loaf: window.__marks.loaf.filter((one) => one.ms >= 50) }
}
"""


def part_canvas(lane: Lane, page: Page) -> dict[str, object]:
    """Ten thousand strokes: opened, panned, zoomed and drawn on."""
    if lane.space == "empty":
        return {}

    ready(page, lane)
    opened = page.evaluate(OPEN_CANVAS, f"{lane.root}/plane.canvas")
    lane.profile("canvas opened", opened.pop("loaf"))
    if not opened.get("ms"):
        return {}

    # The element, and a size for it. A plane of ten thousand strokes is still
    # laying itself out when the div arrives, and a locator asked for a box before
    # then waits its own thirty seconds and gives up.
    page.wait_for_selector(".canvas", state="visible", timeout=90000)
    box = page.locator(".canvas").first.bounding_box()
    if not box:
        return {"canvas-open": opened["ms"]}

    panned = drag(lane, page, box, "canvas panned")
    zoomed = wheel(lane, page, box)
    drawn = draw(lane, page, box)

    return {
        "canvas-open": opened["ms"],
        "canvas-fps": panned["fps"],
        "canvas-worst": panned["worst"],
        "zoom-fps": zoomed["fps"],
        "zoom-worst": zoomed["worst"],
        "draw-fps": drawn["fps"],
        "draw-worst": drawn["worst"],
    }


OPEN_CANVAS = r"""
async (path) => {
  const ws = window.nibApp.workspace
  const started = window.__since()
  await ws.openCanvas(path)
  for (let spin = 0; spin < 900; spin++) {
    await window.__painted()
    if (document.querySelector('.canvas')) break
  }
  const painted = await window.__painted()
  return { ms: painted - started, loaf: window.__marks.loaf.filter((one) => one.ms >= 50) }
}
"""


def drag(lane: Lane, page: Page, box: dict, what: str, button: str = "middle") -> dict:
    """A pan: the middle of the surface dragged, with the frames counted.

    The canvas pans with the middle button, over a card as readily as over the
    paper; the graph pans with the left one, from anywhere no node is."""
    middle = (box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)
    page.mouse.move(*middle)
    page.evaluate(WATCH_START)
    page.mouse.down(button=button)
    for step in range(40):
        page.mouse.move(middle[0] - step * 6, middle[1] - step * 3)
    page.mouse.up(button=button)
    page.wait_for_timeout(200)
    found = page.evaluate(WATCH_STOP)
    lane.profile(what, found["loaf"])
    return found


def hover(lane: Lane, page: Page, box: dict) -> dict:
    """The pointer moved across the picture with nothing held down, which is the
    gesture that asks what is under it - once per event rather than once a frame."""
    start = (box["x"] + 60, box["y"] + box["height"] / 2)
    page.mouse.move(*start)
    page.evaluate(WATCH_START)
    for step in range(60):
        page.mouse.move(start[0] + step * 12, start[1] + (step % 9) * 8)
    page.wait_for_timeout(200)
    found = page.evaluate(WATCH_STOP)
    lane.profile("graph hovered", found["loaf"])
    return found


def wheel(lane: Lane, page: Page, box: dict) -> dict:
    """A zoom: the wheel with the modifier down, which is how both surfaces zoom."""
    page.mouse.move(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)
    page.evaluate(WATCH_START)
    for _ in range(30):
        page.keyboard.down("Control")
        page.mouse.wheel(0, -120)
        page.keyboard.up("Control")
    page.wait_for_timeout(300)
    found = page.evaluate(WATCH_STOP)
    lane.profile("canvas zoomed", found["loaf"])
    return found


def draw(lane: Lane, page: Page, box: dict) -> dict:
    """One more stroke on a plane that already holds ten thousand."""
    page.keyboard.press("d")
    page.wait_for_timeout(300)
    start = (box["x"] + 80, box["y"] + box["height"] - 80)
    page.mouse.move(*start)
    page.evaluate(WATCH_START)
    page.mouse.down()
    for step in range(60):
        page.mouse.move(start[0] + step * 5, start[1] - (step % 12) * 4)
    page.mouse.up()
    page.wait_for_timeout(300)
    found = page.evaluate(WATCH_STOP)
    lane.profile("stroke drawn", found["loaf"])
    page.keyboard.press("Escape")
    return found


PARTS = {
    "launch": part_launch,
    "note": part_note,
    "shell": part_shell,
    "search": part_search,
    "graph": part_graph,
    "canvas": part_canvas,
}


def settled(page: Page) -> None:
    """The launch's own passes finished: the index scanned, and a quiet moment after
    it. What is measured after this is the thing being measured."""
    page.wait_for_function(
        "() => !!window.nibApp && !window.nibApp.links.scanning && !!window.nibApp.links.rootOf()",
        timeout=180000,
    )
    page.wait_for_timeout(2500)


def ready(page: Page, lane: Lane) -> None:
    """The app up, on the space, with the file list showing."""
    if not page.evaluate("() => !!window.nibApp"):
        page.goto(lane.origin, wait_until="domcontentloaded")

    page.wait_for_function(LAUNCHED, timeout=120000)
    page.evaluate("() => window.nibApp.workspace.showPanel('tree')")
    page.wait_for_selector("aside .row", timeout=60000)


# --------------------------------------------------------------------------- lanes


class Lane:
    """One build over one space, served and driven."""

    def __init__(self, tag: str, folder: str, space: str) -> None:
        self.tag = tag
        self.space = space
        self.name = f"{tag}/{space}"
        self.folder = APP / folder
        self.port = PORTS[(tag, space)]
        self.origin = f"http://127.0.0.1:{self.port}"
        self.root = "/Big" if space == "big" else "/Empty"
        self.rounds: dict[str, list[dict]] = {}
        self.profiles: dict[str, list[str]] = {}
        self.notes: list[str] = []
        self.page: Page | None = None
        self.cdp = None

        handler = functools.partial(Quiet, directory=str(self.folder))
        self.server = http.server.ThreadingHTTPServer(("127.0.0.1", self.port), handler)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)

    def start(self) -> None:
        (self.folder / "seed.html").write_text(SEED_PAGE, encoding="utf-8")
        self.thread.start()
        say(f"{self.name}: serving {self.folder.name} on {self.origin}")

    def stop(self) -> None:
        self.server.shutdown()

    def note(self, words: str) -> None:
        self.notes.append(f"{self.name}: {words}")

    def profile(self, what: str, entries: list[dict] | None) -> None:
        lines = blame(entries or [])
        if lines:
            self.profiles.setdefault(f"{self.name} - {what}", []).extend(lines)

    def ready(self, browser) -> None:
        """A seeded store, and a session as an app somebody has used before leaves
        one: which space was open, which note, and that the file list was the panel
        showing. Every launch measured after this is a launch of an app somebody has
        used before, which is the launch that happens every day."""
        context = browser.new_context(
            viewport={"width": 1440, "height": 900},
            user_agent=DESKTOP_AGENT,
        )
        context.add_init_script(MARKS)
        page = context.new_page()
        page.on("pageerror", lambda error: say(f"{self.name}: page error: {error}"))
        self.page = page
        self.cdp = context.new_cdp_session(page)

        page.goto(f"{self.origin}/seed.html", wait_until="domcontentloaded")
        plan = {
            "notes": NOTES if self.space == "big" else 0,
            "lines": LINES if self.space == "big" else 0,
            "strokes": STROKES if self.space == "big" else 0,
            "points": POINTS,
            "space": self.root,
        }
        seeded = page.evaluate(SEED, plan)
        say(f"{self.name}: {seeded['rows']} rows seeded into {seeded['stores']}")

        # Three launches before anything is timed, not one. Chrome keeps a compiled
        # copy of a script and writes it on the second or third visit, so the build
        # that has been served all afternoon comes up faster than the one built five
        # minutes ago - by three hundred milliseconds to the file list, which is more
        # than most changes worth making. Every asset of both builds is under a hash
        # of its own, so each needs its own warming.
        for _ in range(WARMING):
            page.goto(self.origin, wait_until="domcontentloaded")
            page.wait_for_function(LAUNCHED, timeout=180000)
            # Said every time: a first visit has no session behind it and opens on
            # whichever panel the app starts with.
            page.evaluate("() => window.nibApp.workspace.showPanel('tree')")
            page.wait_for_selector("aside .row", timeout=60000)

        page.evaluate(OPEN_NOTE, f"{self.root}/{FIRST}")
        # The session is written as things settle, so give it the moment it takes.
        page.wait_for_timeout(2500)
        say(f"{self.name}: session written")

    def quiet(self) -> None:
        """A moment with nothing happening, before something is timed."""
        if self.page:
            self.page.wait_for_timeout(SETTLING)

    def sweep(self) -> None:
        """The collector, asked. A heap read with garbage still in it is a number
        about when the collector last ran."""
        if self.cdp:
            self.cdp.send("HeapProfiler.collectGarbage")

    def park(self) -> None:
        """Off the app and onto nothing, so a lane that is not being measured is
        not an app running beside the one that is."""
        if self.page:
            self.page.goto("about:blank", wait_until="domcontentloaded")

    def round(self, part: str) -> None:
        page = self.page
        if not page:
            return

        found = PARTS[part](self, page)
        if not found:
            return

        self.rounds.setdefault(part, []).append(found)
        said = "  ".join(f"{key} {value:.0f}" for key, value in found.items())
        say(f"{self.name} {part} {len(self.rounds[part])}: {said}")

    def numbers(self) -> dict[str, float]:
        out: dict[str, float] = {}
        for rounds in self.rounds.values():
            for key in rounds[0]:
                out[key] = median(rounds, key)
        return out


#: The numbers, in the order they are worth reading, and what each is in.
SAID = [
    ("paint", "launch: first paint", "ms"),
    ("tree", "launch: file list on screen", "ms"),
    ("editor", "launch: editor on screen", "ms"),
    ("settled", "launch: main thread quiet for 500ms", "ms"),
    ("worst", "launch: longest task after the editor", "ms"),
    ("tasks", "launch: tasks over 50ms after the editor", ""),
    ("memory", "launch: heap once settled", "MB"),
    ("note-open", "big note: opened", "ms"),
    ("type-paint", "big note: key down to paint", "ms"),
    ("type-worst", "big note: worst key down to paint", "ms"),
    ("type-handler", "big note: handlers per key", "ms"),
    ("reading", "big note: reading view, call to paint", "ms"),
    ("reading-render", "big note: the render itself", "ms"),
    ("tab-switch", "shell: other tab shown", "ms"),
    ("palette", "shell: palette on screen", "ms"),
    ("palette-rows", "shell: palette rows", ""),
    ("settings", "shell: settings sheet", "ms"),
    ("search-panel", "search: panel on screen", "ms"),
    ("search-tags", "search: the tag tree filled", "ms"),
    ("q-hit", "search: one hit", "ms"),
    ("q-hit-read", "search: rows read for it", ""),
    ("q-none", "search: no hits", "ms"),
    ("q-none-read", "search: rows read for it", ""),
    ("q-tag", "search: a tag", "ms"),
    ("q-tag-read", "search: rows read for it", ""),
    ("q-task", "search: a task", "ms"),
    ("q-task-read", "search: rows read for it", ""),
    ("graph-open", "graph: opened", "ms"),
    ("graph-fps", "graph: frames a second, panned", "fps"),
    ("graph-worst", "graph: worst frame", "ms"),
    ("hover-fps", "graph: frames a second, hovered", "fps"),
    ("hover-worst", "graph: worst hover frame", "ms"),
    ("canvas-open", "canvas: opened", "ms"),
    ("canvas-fps", "canvas: frames a second, panned", "fps"),
    ("canvas-worst", "canvas: worst frame", "ms"),
    ("zoom-fps", "canvas: frames a second, zoomed", "fps"),
    ("zoom-worst", "canvas: worst zoom frame", "ms"),
    ("draw-fps", "canvas: frames a second, drawing", "fps"),
    ("draw-worst", "canvas: worst drawing frame", "ms"),
]


def main() -> int:
    ask = argparse.ArgumentParser(description=__doc__)
    ask.add_argument("parts", nargs="*", default=[], help=f"any of {', '.join(PARTS)}")
    ask.add_argument("--rounds", type=int, default=5)
    ask.add_argument("--space", default="", help="big or empty, for one of them alone")
    # Four lanes in one browser served by one Python process do not leave each other
    # alone: the launch moments in a four-lane run came out two and three times what
    # they are, and by lane rather than by turn. So a number that is about the launch
    # itself is taken one build at a time, and the two runs compared.
    ask.add_argument("--build", default="", help="before or after, for one of them alone")
    told = ask.parse_args()

    parts = told.parts or list(PARTS)
    for part in parts:
        if part not in PARTS:
            say(f"no part called {part}")
            return 1

    spaces = [told.space] if told.space else ["big", "empty"]
    builds = [
        (tag, folder)
        for tag, folder in (("before", "dist-before"), ("after", "dist"))
        if not told.build or told.build == tag
    ]
    wanted = [Lane(tag, folder, space) for space in spaces for tag, folder in builds]
    lanes = [one for one in wanted if (one.folder / "index.html").exists()]
    if not lanes:
        say("nothing built")
        return 1

    for lane in lanes:
        lane.start()

    try:
        with sync_playwright() as play:
            browser = play.chromium.launch(
                channel="chrome",
                # The heap, honestly: without this the number is bucketed into
                # steps too coarse to compare two builds by.
                args=["--enable-precise-memory-info"],
            )

            for lane in lanes:
                lane.ready(browser)

            # Turn and turn about, so whatever the machine is doing is done to all
            # of them, and one at a time, so none of them is what the machine is
            # doing - and the order reversed every other round, because the lane
            # that goes first pays for the browser waking up. Two identical builds
            # driven one after the other differed by half on a single round, which
            # is more than most changes worth making do; the reversal is what makes
            # a median of several rounds mean the code rather than the order.
            for part in parts:
                for turn_at in range(told.rounds):
                    turn = lanes if turn_at % 2 == 0 else [*reversed(lanes)]
                    for lane in turn:
                        for other in lanes:
                            if other is not lane:
                                other.park()
                        # Parking three pages tears three renderers down, and a
                        # launch measured in the same breath wore it: whichever lane
                        # went second in a round paid the best part of a second, and
                        # it flipped with the order. So the machine is given a moment
                        # to be quiet again before anything is timed.
                        lane.quiet()
                        lane.round(part)

            browser.close()
    finally:
        for lane in lanes:
            lane.stop()

    found = {lane.name: lane.numbers() for lane in lanes}
    names = [lane.name for lane in lanes]

    print()
    print(f"median of {told.rounds} rounds, {NOTES} notes, {LINES} lines, {STROKES} strokes:")
    print(f"  {'':44} {'  '.join(f'{name:>14}' for name in names)}")
    for key, words, unit in SAID:
        if not any(key in found[name] for name in names):
            continue
        row = "  ".join(
            f"{found[name][key]:10.0f}{unit:>4}" if key in found[name] else f"{'-':>14}"
            for name in names
        )
        print(f"  {words:44} {row}")

    for lane in lanes:
        for words in lane.notes:
            say(words)

    print()
    print("what the browser blamed for the long frames:")
    for lane in lanes:
        for what, lines in lane.profiles.items():
            print(f"  {what}")
            for line in dict.fromkeys(lines):
                print(f"    {line}")

    print()
    print(json.dumps({name: {key: round(value, 1) for key, value in one.items()} for name, one in found.items()}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
