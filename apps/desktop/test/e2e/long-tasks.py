from __future__ import annotations

import json
import os

from playwright.sync_api import Page

from harness import Drive

DRIVE = Drive(__file__)
say, wait_for = DRIVE.say, DRIVE.wait_for
ORIGIN = DRIVE.origin

NOTES = 100

LONG = 50

REFERENCE = 45.8

CEILING = 0

BENCH = """
() => {
  const started = performance.now()
  const words = /(\\w+)@(\\w+)\\.(\\w+)/g
  let kept = 0
  for (let at = 0; at < 200000; at++) {
    const text = 'note-' + at + ' to someone@example.org about ' + (at % 97)
    words.lastIndex = 0
    const found = words.exec(text)
    kept += text.length + (found ? found[2].length : 0)
  }
  return kept > 0 ? performance.now() - started : -1
}
"""

OBSERVE = """
window.__longTasks = []
new PerformanceObserver((list) => {
  for (const one of list.getEntries()) {
    window.__longTasks.push({ start: one.startTime, duration: one.duration })
  }
}).observe({ type: 'longtask', buffered: true })
"""

SEED = """
async (count) => {
  const ws = window.ordenApp.workspace
  const root = ws.activeSpace.root
  const tags = ['#wind', '#ink', '#paper', '#kestrel', '#plan']
  for (let at = 0; at < count; at++) {
    const body = [
      '---', 'icon: rocket', 'aliases:', `  - note ${at} elsewhere`, '---', '',
      `# Note ${at}`, '',
      `${tags[at % 5]} and a line about the wind, written on the ${at}th of the month.`, '',
      `See [[Note ${(at + 7) % count}]] and [[Note ${(at + 3) % count}#What went in, 1]].`, '',
      '- [ ] Pressure on the pen', '- [x] Slides out of a note', '',
      ...Array.from({ length: 12 }, (_, part) => [
        `## What went in, ${part}`, '',
        'The wind was steady all week, and the ink took its time. What the pen leaves',
        'behind on paper is the only part of this anybody reads twice.', '',
      ]).flat(),
    ].join('\\n')
    await ws.noteFrom(body, root)
  }
  await ws.loadTree()
  const first = ws.notes.find((one) => one.name.startsWith('Note 0'))
  if (first) await ws.openEntry(first.path, { activate: true })
  return ws.notes.length
}
"""

def marks(page: Page) -> dict[str, float]:
    return page.evaluate(
        "() => Object.fromEntries(performance.getEntriesByType('mark')"
        ".filter((one) => one.name.startsWith('nib: '))"
        ".map((one) => [one.name.slice(5), one.startTime]))"
    )

def main() -> int:
    slowed = float(os.environ.get("ORDEN_CPU") or 1)
    with DRIVE.session() as browser:
        context = browser.new_context(viewport={"width": 1180, "height": 820})
        context.add_init_script(OBSERVE)
        page = context.new_page()
        page.goto(ORIGIN, wait_until="domcontentloaded")
        wait_for(page, "window.ordenApp?.workspace?.activeSpace", "a space")
        wait_for(page, "window.ordenApp.workspace.active", "the app to open its own note")
        say(f"the space holds {page.evaluate(SEED, NOTES)} notes")
        page.wait_for_timeout(1500)
        bench = min(page.evaluate(BENCH) for _ in range(7))

        session = context.new_cdp_session(page)
        if slowed != 1:
            session.send("Emulation.setCPUThrottlingRate", {"rate": slowed})
        page.reload(wait_until="commit")
        wait_for(
            page,
            "performance.getEntriesByName('nib: launch order finished').length",
            "the launch order",
        )
        page.wait_for_timeout(1000)
        if slowed != 1:
            session.send("Emulation.setCPUThrottlingRate", {"rate": 1})

        seen = marks(page)
        marks_all = page.evaluate(
            "() => performance.getEntriesByType('mark')"
            ".filter((one) => one.name.startsWith('nib: '))"
            ".map((one) => [one.name.slice(5), one.startTime])"
        )
        tasks = page.evaluate("() => window.__longTasks")

    start = seen.get("first frame painted")
    end = seen.get("launch order finished")
    built = [at for name, at in marks_all if name == "editor built"]
    if start is None or end is None:
        say(f"the page never marked its launch: {json.dumps(seen)}")
        return 1

    scale = bench / REFERENCE
    line = max(LONG, LONG * scale)
    say(
        f"the fixed work took {bench:.1f} ms against {REFERENCE:.1f} on the reference machine,"
        f" so a long task here is one over {line:.0f} ms"
        + (f" (Chrome's own line; {LONG * scale:.0f} ms is under what it reports)" if LONG * scale < LONG else "")
    )
    say(
        f"first frame at {start:.0f} ms, launch order finished at {end:.0f} ms"
        + (f", the page slowed {slowed:g} times" if slowed != 1 else "")
    )

    inside = [
        one
        for one in tasks
        if start <= one["start"] < end
        and not any(one["start"] <= at <= one["start"] + one["duration"] for at in built)
    ]
    long = [one for one in inside if one["duration"] > line]
    for one in long:
        before = [name for name, at in seen.items() if at <= one["start"]]
        during = [
            name
            for name, at in seen.items()
            if one["start"] < at <= one["start"] + one["duration"]
        ]
        say(
            f"  a long task at {one['start']:.0f} ms, {one['duration']:.0f} ms,"
            f" after {before[-1] if before else 'nothing'!r}"
            + (f", holding up {', '.join(repr(name) for name in during)}" if during else "")
        )
    say(f"{len(long)} long tasks after the first frame, the editor's own left out")

    if slowed == 1 and len(long) > CEILING:
        say(f"FAILED: more than {CEILING} long tasks between the first frame and the end of the launch")
        return 1
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
