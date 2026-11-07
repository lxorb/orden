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
    scan            the space read for the link index on the way up: how long, and
                    the longest task it put on the thread
    canvas          ten thousand strokes: opened, the ink filling in, and then seen
                    whole - panned, drawn on, rubbed out - before it is zoomed into
                    and drawn on again
    reading         the big note as a page
    memory          the heap once the launch has settled

Nothing here asserts. It prints numbers taken over several rounds run turn and turn
about, because this machine's own load moves by more than most of these changes do.
A row in milliseconds is reported as its least disturbed round and not its median:
noise only ever adds time, so the quietest round is the one that is about the code,
and it is the only one that repeats. See `pick`. The counted work behind each fix is
asserted in the unit tests beside the code it is about; a clock says what the machine
was doing and a count says what the code did.

The two search walks that keep a clock on themselves are timed here and nowhere
else. Both count what the code did, and those counts are their test; each also has
one wall-clock bound on its worst case, which a loaded machine misses for reasons
that are nothing to do with the code. So they ask for `ORDEN_PERF=1` before they
believe their own clock, this drive is the only thing that sets it, and it is asked
before a browser exists. `--no-clock` leaves it out. See `clocked`.

Every run ends by reading each lane against the other and against what the row is
worth to nobody - the two halves of the run asked the same question. Put the same
build in both folders and every row must read `same`; a row that says `differs` then
is a fault in this file. `--as-was` serves the way this file used to, which is how
that check earns its keep: HTTP/1.0 with no caching headers made Chrome guess how
long each asset was good for from the folder's own timestamp, so the same build in
two folders written minutes apart was two different launches - 252 revalidation
round-trips in one lane and none in the other, and sixty to ninety milliseconds on
the file list and the editor for it.

Two builds, each with the app's own handle on the page - a production build hides
the stores this reads. From the repository root:

    cd apps/desktop
    NODE_ENV=development pnpm exec vite build --mode drive

and, from a tree without the change in it, the same again into a folder of its own:

    NODE_ENV=development pnpm exec vite build --mode drive --outDir dist-before

Then, from the repository root:

    python apps/desktop/test/e2e/speed.py

Either folder on its own is fine; the one that is there is the one that is driven.
A subset by name, when one number is being chased:

    python apps/desktop/test/e2e/speed.py launch search canvas

The names are the keys of `PARTS`. `--rounds` sets how many of each.

When a number here is bad, the next question is which function. The long animation
frames this prints already name the file and the handler; for the function, build a
third time with the names left in and take a sampling profile of the one thing:

    NODE_ENV=development pnpm exec vite build --mode drive \
        --outDir dist-profile --minify false

then drive that folder with Chrome's own profiler through `CDPSession`
(`Profiler.enable`, `Profiler.start`, the gesture, `Profiler.stop`) and sum the
samples per call frame. Every cause named in this file's comments was found that
way, and the folder is ignored so it can be left lying about.
"""

from __future__ import annotations

import argparse
import http.server
import json
import os
import shutil
import statistics
import subprocess
from pathlib import Path

from playwright.sync_api import Error as PlaywrightError
from playwright.sync_api import Page

import harness
from harness import Drive

DRIVE = Drive(__file__, served=False)
BUDGET = 1800
say = DRIVE.say
APP = harness.APP

DESKTOP_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko)"
    " Chrome/140.0.0.0 Safari/537.36"
)

NOTES = 5000
LINES = 20000
STROKES = 10000
POINTS = 10

GESTURE = 1500

WARMING = 3

SETTLING = 2000

AS_WAS = False

class AsWas(harness.Files):

    protocol_version = "HTTP/1.0"

    def send_header(self, keyword: str, value: str) -> None:
        if keyword == "Content-Length":
            self.tally()["bytes"] += int(value)
        http.server.SimpleHTTPRequestHandler.send_header(self, keyword, value)

    def end_headers(self) -> None:
        http.server.SimpleHTTPRequestHandler.end_headers(self)

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
      // Every fifth note points at one note, so the space holds a note a thousand
      // others link to. A space where every note has exactly one link in is a space
      // where the Links panel is never asked a hard question, and the hard question
      // is the one somebody with a hub note - an index, a person, a project - asks
      // every time they open it. See `part_links`.
      ...(at % 5 === 0 ? [`Filed under [[hub]].`, ''] : []),
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

  // The note a fifth of the space points at. Short itself: what is being measured
  // when it is opened is the panel finding what points here, not the editor.
  add(`${space}/hub.md`, '# Hub\n\nThe note everything is filed under.\n', notes + 5)
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

    add(`${space}/plane.canvas`, JSON.stringify({ nodes, edges: [], orden: { version: 1, ink } }), notes + 4)
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
        listing?.put({ path: row.path, modified: row.modified, created: row.created, size: row.content.length })
      }
    })
  }

  db.close()
  return { rows: rows.length, stores }
}
"""

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

SETTLED_WITHIN = 8000
QUIET = 500

LAUNCHED = "() => !!window.nibApp && !!window.nibApp.workspace.activeSpace"

FIRST = "first.md"
SECOND = "second.md"

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

SWITCH = r"""
async (id) => {
  const ws = window.nibApp.workspace
  const started = window.__since()
  ws.activeTabId = id
  const painted = await window.__painted()
  return { ms: painted - started, loaf: window.__marks.loaf }
}
"""

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

def pick(rounds: list[dict[str, float]], key: str, unit: str) -> float:
    found = [one[key] for one in rounds if key in one]
    if not found:
        return 0.0
    if unit == "ms":
        return min(found)
    if unit == "fps":
        return max(found)
    return statistics.median(found)

def floor(rounds: list[dict[str, float]], key: str, unit: str) -> float:
    found = [one[key] for one in rounds if key in one]
    if len(found) < 4:
        return 0.0

    half = len(found) // 2
    halves = abs(pick(rounds[:half], key, unit) - pick(rounds[half:], key, unit))

    ordered = sorted(found)
    if unit == "ms":
        nearly = ordered[1] - ordered[0]
    elif unit == "fps":
        nearly = ordered[-1] - ordered[-2]
    else:
        nearly = 0.0

    return max(halves, nearly)

def blame(entries: list[dict]) -> list[str]:
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

def part_launch(lane: Lane, page: Page) -> dict[str, object]:
    page.goto(lane.origin, wait_until="commit")
    page.wait_for_function("() => window.__marks.editor !== null", timeout=120000)
    page.wait_for_function(LAUNCHED, timeout=120000)
    page.wait_for_timeout(SETTLED_WITHIN)
    lane.sweep()
    found = page.evaluate(LAUNCH, QUIET)
    lane.profile("launch", found.pop("loaf"))
    return found

def part_note(lane: Lane, page: Page) -> dict[str, object]:
    if lane.space == "empty":
        return {}

    ready(page, lane)
    settled(page)
    opened = page.evaluate(OPEN_NOTE, f"{lane.root}/long.md")
    lane.profile("big note opened", opened["loaf"])

    page.click(".cm-content")
    page.keyboard.press("Control+End")
    page.wait_for_timeout(400)

    page.evaluate(TYPING_READY)
    for at in range(12):
        page.keyboard.press("x")
        try:
            page.wait_for_function(
                "(had) => (window.__keys?.length ?? 0) > had", arg=at, timeout=2000
            )
        except PlaywrightError:
            break

    latency = page.evaluate(TYPING)
    lane.profile("typing at the end of the big note", latency.pop("loaf"))

    if not latency.pop("keys"):
        lane.note("the keystrokes went nowhere; that round is not in the typing numbers")
        latency = {}

    reading = page.evaluate(READING)
    lane.profile("reading the big note", reading.pop("loaf"))
    page.evaluate("() => window.nibApp.workspace.toggleReading()")
    page.wait_for_timeout(300)

    return {"note-open": opened["ms"], **latency, **reading}

TYPING_READY = r"""
() => {
  window.__keys = []

  // The key going down, and the second frame after it: the first callback runs
  // before the paint it was scheduled for, so the second is the first moment the
  // letter is on screen. The same two frames everything else here calls painted.
  //
  // Not the Event Timing entry, which is what this used to read. That API will not
  // report an event whose duration is under sixteen milliseconds however low
  // `durationThreshold` is set - the spec floors it - so a keystroke that landed in
  // its own frame produced no entry at all, and a round of twelve fast keystrokes
  // looked like a round where the keys went nowhere and was thrown away. What was
  // left was the median of the keystrokes slow enough to be reported, which is a
  // number that can only ever look bad and cannot show an improvement: the same
  // build read 432ms in one lane and 560 in the other off one or two rounds each.
  // The entry is still read for the handler time beside it, which is the one thing
  // a clock around the frame cannot see.
  addEventListener('keydown', () => {
    const down = performance.now()
    requestAnimationFrame(() =>
      requestAnimationFrame(() => window.__keys.push({ ms: performance.now() - down })),
    )
  }, { capture: true })

  window.__handlers = []
  new PerformanceObserver((list) => {
    for (const one of list.getEntries()) {
      if (one.name === 'keydown') {
        window.__handlers.push(one.processingEnd - one.processingStart)
      }
    }
  }).observe({ type: 'event', durationThreshold: 16 })

  window.__since()
  return true
}
"""

TYPING = r"""
() => {
  const keys = window.__keys ?? []
  const middle = (list) => {
    const sorted = [...list].sort((a, b) => a - b)
    return { middle: sorted[Math.floor(sorted.length / 2)] ?? 0, worst: sorted.at(-1) ?? 0 }
  }

  const paint = middle(keys.map((one) => one.ms))
  const handler = middle(window.__handlers ?? [])
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
  performance.clearMeasures('orden:reading')
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
  const render = performance.getEntriesByName('orden:reading').at(-1)?.duration ?? 0

  return {
    reading: painted - started,
    'reading-render': render,
    loaf: window.__marks.loaf.filter((one) => one.ms >= 50),
  }
}
"""

def part_shell(lane: Lane, page: Page) -> dict[str, object]:
    ready(page, lane)

    page.evaluate(OPEN_NOTE, f"{lane.root}/{FIRST}")
    page.evaluate(OPEN_NOTE, f"{lane.root}/{SECOND}")
    tabs = page.evaluate("() => window.nibApp.workspace.tabs.map((one) => one.id)")
    switched = page.evaluate(SWITCH, tabs[0])
    lane.profile("tab switch", switched["loaf"])
    back = page.evaluate(SWITCH, tabs[-1])
    del back

    page.evaluate(WATCH_START)
    page.keyboard.press("Control+o")
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
    if lane.space == "empty":
        return {}

    ready(page, lane)
    panel = page.evaluate(PANEL)
    lane.profile("search panel opened", panel.pop("loaf"))
    try:
        page.wait_for_selector("[data-search]", state="attached", timeout=30000)
    except Exception:
        say(f"{lane.name}: no search panel; the window says {page.evaluate(SIDEBAR)}")
        raise
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

SIDEBAR = r"""
() => ({
  panel: window.nibApp?.workspace?.panel ?? null,
  aside: !!document.querySelector('aside'),
  rows: document.querySelectorAll('aside .row').length,
  find: !!document.querySelector('.find'),
  sheet: !!document.querySelector('.orden-screen.sheet'),
  palette: !!document.querySelector('.palette'),
  space: window.nibApp?.workspace?.activeSpace?.root ?? null,
})
"""

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
  let asked = started
  for (let spin = 0; spin < 900 && !(panel && tags); spin++) {
    // Asked again where it did not take, and the clock started again with it. A
    // window whose sitting was still being read back put the file list over the top
    // of the panel this had just asked for, and a run that only waited waited its
    // whole timeout and took the lane's numbers with it. Once a second is often
    // enough to get past that and rare enough not to be what is measured.
    if (!panel && spin && spin % 60 === 0 && ws.panel !== 'search') {
      ws.showPanel('search')
      asked = performance.now()
    }
    const at = await window.__painted()
    if (!panel && document.querySelector('[data-search]')) panel = at - asked
    if (!tags && ws.tags?.length) tags = at - asked
  }

  return {
    'search-panel': panel,
    'search-tags': tags,
    loaf: window.__marks.loaf.filter((one) => one.ms >= 50),
  }
}
"""

QUERIES = [
    ("hit", "marker-4242"),
    ("none", "zzqqxxnothing"),
    ("tag", "tag:kestrel"),
    ("task", "task:pressure"),
]

def part_graph(lane: Lane, page: Page) -> dict[str, object]:
    if lane.space == "empty":
        return {}

    ready(page, lane)
    opened = page.evaluate(OPEN_GRAPH)
    lane.profile("graph opened", opened.pop("loaf"))

    page.wait_for_selector(".graph", state="visible", timeout=90000)
    box = page.locator(".graph").first.bounding_box()
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
    if lane.space == "empty":
        return {}

    ready(page, lane)
    opened = page.evaluate(OPEN_CANVAS, f"{lane.root}/plane.canvas")
    lane.profile("canvas opened", opened.pop("loaf"))
    if not opened.get("ms"):
        return {}

    page.wait_for_selector(".canvas", state="visible", timeout=90000)
    box = page.locator(".canvas").first.bounding_box()
    if not box:
        return {"canvas-open": opened["ms"]}

    filling = fill_in(lane, page)
    panned = drag(lane, page, box, "canvas panned")
    whole = draw(lane, page, box, "stroke drawn on the whole plane")
    rubbed = rub(lane, page, box)
    for _ in range(2):
        page.keyboard.press("Control+z")
    page.wait_for_timeout(300)
    zoomed = wheel(lane, page, box)
    drawn = draw(lane, page, box)

    return {
        "canvas-open": opened["ms"],
        "fill-worst": filling["worst"],
        "fill-long": len(filling["loaf"]),
        "canvas-fps": panned["fps"],
        "canvas-worst": panned["worst"],
        "fit-draw-worst": whole["worst"],
        "fit-erase-worst": rubbed["worst"],
        "zoom-fps": zoomed["fps"],
        "zoom-worst": zoomed["worst"],
        "draw-fps": drawn["fps"],
        "draw-worst": drawn["worst"],
    }

def fill_in(lane: Lane, page: Page) -> dict:
    page.evaluate(WATCH_START)
    page.wait_for_timeout(3000)
    found = page.evaluate(WATCH_STOP)
    lane.profile("ink filling in", found["loaf"])
    return found

def rub(lane: Lane, page: Page, box: dict) -> dict:
    page.keyboard.press("e")
    page.wait_for_timeout(300)
    start = (box["x"] + box["width"] / 2 - 150, box["y"] + box["height"] / 2)
    page.mouse.move(*start)
    page.evaluate(WATCH_START)
    page.mouse.down()
    for step in range(60):
        page.mouse.move(start[0] + step * 5, start[1] - (step % 12) * 4)
    page.mouse.up()
    page.wait_for_timeout(300)
    found = page.evaluate(WATCH_STOP)
    lane.profile("strokes rubbed out", found["loaf"])
    page.keyboard.press("Escape")
    return found

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

def draw(lane: Lane, page: Page, box: dict, what: str = "stroke drawn") -> dict:
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
    lane.profile(what, found["loaf"])
    page.keyboard.press("Escape")
    return found

def part_scan(lane: Lane, page: Page) -> dict[str, object]:
    if lane.space == "empty":
        return {}

    page.goto(lane.origin, wait_until="commit")
    page.wait_for_function("() => window.__marks.tree !== null", timeout=120000)
    page.wait_for_function(
        "() => !!window.nibApp && !window.nibApp.links.scanning && !!window.nibApp.links.rootOf()",
        timeout=180000,
    )
    found = page.evaluate(SCAN)
    lane.profile("the space read for the index", found.pop("loaf"))
    return found

SCAN = r"""
() => {
  const marks = window.__marks
  const after = marks.tree ?? 0
  const read = performance.now()
  const tasks = marks.tasks.filter((one) => one.at >= after && one.at <= read)
  return {
    'scan-read': read - after,
    'scan-worst': tasks.reduce((most, one) => Math.max(most, one.ms), 0),
    'scan-long': tasks.filter((one) => one.ms >= 50).length,
    loaf: marks.loaf.filter((one) => one.at >= after && one.ms >= 50),
  }
}
"""

def part_links(lane: Lane, page: Page) -> dict[str, object]:
    if lane.space == "empty":
        return {}

    ready(page, lane)
    settled(page)

    found = page.evaluate(LINKS, f"{lane.root}/hub.md")
    lane.profile("the links panel on a note a thousand notes point at", found.pop("loaf"))
    lane.note(f"hub: {found['links-rows']} rows over {found.pop('sections')} sections")

    page.evaluate("() => { const ws = window.nibApp.workspace; ws.showPanel('tree') }")
    page.wait_for_timeout(200)
    return found

LINKS = r"""
async (path) => {
  const ws = window.nibApp.workspace
  await ws.open(path)
  for (let spin = 0; spin < 240; spin++) {
    await window.__painted()
    if (ws.active?.path === path) break
  }

  const started = window.__since()
  if (ws.panel !== 'links') ws.showPanel('links')

  let shown = 0
  for (let spin = 0; spin < 900 && !shown; spin++) {
    if (spin && spin % 60 === 0 && ws.panel !== 'links') ws.showPanel('links')
    const at = await window.__painted()
    if (document.querySelector('.hit')) shown = at - started
  }

  const rows = document.querySelectorAll('.hit').length
  return {
    'links-panel': shown,
    'links-rows': rows,
    sections: document.querySelectorAll('.orden-section').length,
    loaf: window.__marks.loaf.filter((one) => one.ms >= 50),
  }
}
"""

PARTS = {
    "launch": part_launch,
    "note": part_note,
    "shell": part_shell,
    "search": part_search,
    "scan": part_scan,
    "links": part_links,
    "graph": part_graph,
    "canvas": part_canvas,
}

def settled(page: Page) -> None:
    page.wait_for_function(
        "() => !!window.nibApp && !window.nibApp.links.scanning && !!window.nibApp.links.rootOf()",
        timeout=180000,
    )
    page.wait_for_timeout(2500)

def ready(page: Page, lane: Lane) -> None:
    if not page.evaluate("() => !!window.nibApp"):
        page.goto(lane.origin, wait_until="domcontentloaded")

    page.wait_for_function(LAUNCHED, timeout=120000)
    page.wait_for_timeout(600)
    page.evaluate("() => window.nibApp.workspace.showPanel('tree')")
    page.wait_for_selector("aside .row", timeout=60000)

class Lane:

    def __init__(self, tag: str, folder: Path, space: str) -> None:
        self.tag = tag
        self.space = space
        self.name = f"{tag}/{space}"
        self.folder = folder
        self.server: harness.Served | None = None
        self.origin = ""
        self.root = "/Big" if space == "big" else "/Empty"
        self.rounds: dict[str, list[dict]] = {}
        self.lost: dict[str, int] = {}
        self.profiles: dict[str, list[str]] = {}
        self.notes: list[str] = []
        self.page: Page | None = None
        self.cdp = None

    def start(self) -> None:
        if AS_WAS:
            self.server = harness.Served(handler=type("Lane", (AsWas,), {"folder": str(self.folder)}))
        else:
            self.server = harness.Served(self.folder)
        self.origin = self.server.origin(f"{self.tag}-{self.space}.localhost")
        say(f"{self.name}: serving {self.folder.name} on {self.origin}")

    def stop(self) -> None:
        if self.server:
            self.server.close()

    def note(self, words: str) -> None:
        self.notes.append(f"{self.name}: {words}")

    def profile(self, what: str, entries: list[dict] | None) -> None:
        lines = blame(entries or [])
        if lines:
            self.profiles.setdefault(f"{self.name} - {what}", []).extend(lines)

    def ready(self, browser) -> None:
        context = browser.new_context(
            viewport={"width": 1440, "height": 900},
            user_agent=DESKTOP_AGENT,
        )
        context.add_init_script(MARKS)
        page = context.new_page()
        page.on("pageerror", lambda error: say(f"{self.name}: page error: {error}"))
        self.page = page
        self.cdp = context.new_cdp_session(page)

        page.goto(f"{self.origin}{harness.SEED_PATH}", wait_until="domcontentloaded")
        plan = {
            "notes": NOTES if self.space == "big" else 0,
            "lines": LINES if self.space == "big" else 0,
            "strokes": STROKES if self.space == "big" else 0,
            "points": POINTS,
            "space": self.root,
        }
        seeded = page.evaluate(SEED, plan)
        say(f"{self.name}: {seeded['rows']} rows seeded into {seeded['stores']}")

        for _ in range(WARMING):
            page.goto(self.origin, wait_until="domcontentloaded")
            page.wait_for_function(LAUNCHED, timeout=180000)
            page.evaluate("() => window.nibApp.workspace.showPanel('tree')")
            page.wait_for_selector("aside .row", timeout=60000)

        page.evaluate(OPEN_NOTE, f"{self.root}/{FIRST}")
        page.wait_for_timeout(2500)
        say(f"{self.name}: session written")

    def quiet(self) -> None:
        if self.page:
            self.page.wait_for_timeout(SETTLING)

    def sweep(self) -> None:
        if self.cdp:
            self.cdp.send("HeapProfiler.collectGarbage")

    def park(self) -> None:
        if self.page:
            self.page.goto("about:blank", wait_until="domcontentloaded")

    def round(self, part: str) -> None:
        page = self.page
        if not page:
            return

        try:
            found = PARTS[part](self, page)
        except PlaywrightError as wrong:
            self.lost.setdefault(part, 0)
            self.lost[part] += 1
            self.note(f"{part} could not be reached: {str(wrong).splitlines()[0]}")
            return

        if not found:
            return

        self.rounds.setdefault(part, []).append(found)
        said = "  ".join(f"{key} {value:.0f}" for key, value in found.items())
        say(f"{self.name} {part} {len(self.rounds[part])}: {said}")

    def numbers(self) -> dict[str, float]:
        out: dict[str, float] = {}
        for rounds in self.rounds.values():
            for key in rounds[0]:
                out[key] = pick(rounds, key, UNIT.get(key, ""))
        return out

    def floors(self) -> dict[str, float]:
        out: dict[str, float] = {}
        for rounds in self.rounds.values():
            for key in rounds[0]:
                out[key] = floor(rounds, key, UNIT.get(key, ""))
        return out

    def middles(self) -> dict[str, float]:
        out: dict[str, float] = {}
        for rounds in self.rounds.values():
            for key in rounds[0]:
                found = [one[key] for one in rounds if key in one]
                out[key] = statistics.median(found) if found else 0.0
        return out

    def served(self) -> dict[str, int]:
        if not self.server:
            return {"asked": 0, "sent": 0, "again": 0, "bytes": 0}
        return self.server.tally

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
    ("scan-read", "scan: file list to the space read for the index", "ms"),
    ("scan-worst", "scan: longest task while it reads", "ms"),
    ("scan-long", "scan: tasks over 50ms while it reads", ""),
    ("links-panel", "links: what points here, on screen", "ms"),
    ("links-rows", "links: rows in the panel", ""),
    ("graph-open", "graph: opened", "ms"),
    ("graph-fps", "graph: frames a second, panned", "fps"),
    ("graph-worst", "graph: worst frame", "ms"),
    ("hover-fps", "graph: frames a second, hovered", "fps"),
    ("hover-worst", "graph: worst hover frame", "ms"),
    ("canvas-open", "canvas: opened", "ms"),
    ("fill-worst", "canvas: worst frame while the ink fills in", "ms"),
    ("fill-long", "canvas: frames over 50ms while it fills in", ""),
    ("canvas-fps", "canvas: frames a second, panned", "fps"),
    ("canvas-worst", "canvas: worst frame", "ms"),
    ("fit-draw-worst", "canvas: worst frame, drawing on it seen whole", "ms"),
    ("fit-erase-worst", "canvas: worst frame, rubbing out seen whole", "ms"),
    ("zoom-fps", "canvas: frames a second, zoomed", "fps"),
    ("zoom-worst", "canvas: worst zoom frame", "ms"),
    ("draw-fps", "canvas: frames a second, drawing", "fps"),
    ("draw-worst", "canvas: worst drawing frame", "ms"),
]

UNIT = {key: unit for key, _, unit in SAID}

def waits(
    found: dict[str, dict[str, float]],
    middle: dict[str, dict[str, float]],
    moved: dict[str, dict[str, float]],
    names: list[str],
) -> None:
    loud = []
    for key, words, unit in SAID:
        if unit != "ms":
            continue

        for name in names:
            if key not in found[name]:
                continue

            best = found[name][key]
            mid = middle[name].get(key, best)
            if mid > best * 2 and mid - best > max(moved[name].get(key, 0.0), 20.0):
                loud.append(f"{words:44} {name:>14} best {best:5.0f}ms  middle {mid:5.0f}ms")

    if not loud:
        return

    print("rows whose middle round is well above their best, which is a wait that comes and goes:")
    for line in loud:
        say(line)
    print()

def prove(
    found: dict[str, dict[str, float]],
    moved: dict[str, dict[str, float]],
    names: list[str],
) -> None:
    if len(names) < 2:
        return

    print()
    print("lane against lane, each gap read against what the row is worth to nobody:")
    print(f"  {'':44} {'gap':>9} {'floor':>9}")

    loud = []
    for key, words, unit in SAID:
        seen = [name for name in names if key in found[name]]
        if len(seen) < 2:
            continue

        values = [found[name][key] for name in seen]
        gap = max(values) - min(values)
        sill = max(moved[name].get(key, 0.0) for name in seen)
        how = "same" if gap <= max(sill, 1.0) else "differs"
        if how == "differs":
            loud.append(f"{words} ({gap:.0f}{unit} on a floor of {sill:.0f})")
        print(f"  {words:44} {gap:8.0f}{unit:>4} {sill:8.0f}{unit:>4}  {how}")

    print()
    if loud:
        say(f"{len(loud)} rows differ by more than they are worth to nobody:")
        for words in loud:
            say(f"  {words}")
    else:
        say("every row agrees within what it is worth to nobody")

CLOCKED = [
    "src/lib/search/fuzzy.perf.test.ts",
    "src/lib/search/match.perf.test.ts",
]

def clocked() -> str:
    npx = shutil.which("npx")
    if not npx:
        return "no npx, so the clocked bounds were not asked"

    asked = subprocess.run(
        [npx, "vitest", "run", *CLOCKED],
        cwd=APP,
        env={**os.environ, "ORDEN_PERF": "1"},
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        check=False,
    )

    if asked.returncode == 0:
        return "the clocked bounds hold"

    said = [
        line.strip()
        for line in (asked.stdout + asked.stderr).splitlines()
        if "AssertionError" in line or line.strip().startswith("FAIL")
    ]
    return "; ".join(["the clocked bounds do not hold", *said[:6]])

def main() -> int:
    ask = argparse.ArgumentParser(description=__doc__)
    ask.add_argument("parts", nargs="*", default=[], help=f"any of {', '.join(PARTS)}")
    ask.add_argument("--rounds", type=int, default=5)
    ask.add_argument("--space", default="", help="big or empty, for one of them alone")
    ask.add_argument("--build", default="", help="before or after, for one of them alone")
    ask.add_argument(
        "--no-clock",
        action="store_true",
        help="skip the timed search bounds, for a run that is only about the browser",
    )
    ask.add_argument(
        "--as-was",
        action="store_true",
        help="serve as this file used to, to show what the lane bias was",
    )
    told = ask.parse_args()

    global AS_WAS  # noqa: PLW0603
    AS_WAS = told.as_was
    if AS_WAS:
        say("serving as this file used to: HTTP/1.0, no caching, the folders' own dates")

    parts = told.parts or list(PARTS)
    for part in parts:
        if part not in PARTS:
            say(f"no part called {part}")
            return 1

    spaces = [told.space] if told.space else ["big", "empty"]
    if harness.OWN_BUILD and told.build != "before":
        harness.build()
    builds = [
        (tag, folder)
        for tag, folder in (("before", APP / "dist-before"), ("after", harness.DIST))
        if not told.build or told.build == tag
    ]
    wanted = [Lane(tag, folder, space) for space in spaces for tag, folder in builds]
    lanes = [one for one in wanted if (one.folder / "index.html").exists()]
    if not lanes:
        say("nothing built")
        return 1

    rounds = told.rounds + (-told.rounds % len(lanes))
    if rounds != told.rounds:
        say(f"{told.rounds} rounds over {len(lanes)} lanes is not a whole turn; {rounds} rounds")

    clock = "" if told.no_clock else clocked()
    if clock:
        say(clock)

    for lane in lanes:
        lane.start()

    try:
        with DRIVE.session(args=["--enable-precise-memory-info"]) as browser:

            for lane in lanes:
                lane.ready(browser)

            for part in parts:
                for turn_at in range(rounds):
                    at = turn_at % len(lanes)
                    turn = [*lanes[at:], *lanes[:at]]
                    for lane in turn:
                        for other in lanes:
                            if other is not lane:
                                other.park()
                        lane.quiet()
                        lane.round(part)
    finally:
        for lane in lanes:
            lane.stop()

    found = {lane.name: lane.numbers() for lane in lanes}
    moved = {lane.name: lane.floors() for lane in lanes}
    names = [lane.name for lane in lanes]

    print()
    print(
        f"{rounds} rounds, {NOTES} notes, {LINES} lines, {STROKES} strokes."
        " A time is the least disturbed round, a rate the best, a count the middle:"
    )
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
    waits(found, {lane.name: lane.middles() for lane in lanes}, moved, names)

    for lane in lanes:
        for part, times in lane.lost.items():
            if times * 2 >= rounds:
                say(f"{lane.name}: {part} was reached {rounds - times} of {rounds} rounds")

    print("what each lane's server was asked for, over the whole run:")
    for lane in lanes:
        held = lane.served()
        say(
            f"{lane.name}: {held['asked']} requests, {held['sent']} sent,"
            f" {held['again']} already had, {held['bytes'] / 1e6:.1f}MB"
        )
    counts = {(one["asked"], one["sent"]) for one in (lane.served() for lane in lanes)}
    if len(counts) > 1:
        say("the lanes were not served alike; the launch rows are not comparable")

    prove(found, moved, names)

    print()
    print("what the browser blamed for the long frames:")
    for lane in lanes:
        for what, lines in lane.profiles.items():
            print(f"  {what}")
            for line in dict.fromkeys(lines):
                print(f"    {line}")

    if clock:
        print()
        say(clock)

    print()
    print(json.dumps({name: {key: round(value, 1) for key, value in one.items()} for name, one in found.items()}))
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
