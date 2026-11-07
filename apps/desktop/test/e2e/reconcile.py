from __future__ import annotations

import importlib.util
import json

import harness
from harness import Drive

BUDGET = 1500

DRIVE = Drive(__file__, served=False)
say = DRIVE.say
ORIGIN = harness.worker_origin()

def sibling(name: str):
    spec = importlib.util.spec_from_file_location(name.replace("-", "_"), harness.HERE / f"{name}.py")
    if not spec or not spec.loader:
        raise SystemExit(f"cannot read {name}.py")

    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module

first = sibling("first-sync")
speed = sibling("speed")

NOTES = 5000

WATCH = """
window.__sync = { tasks: [], heap: 0 }

new PerformanceObserver((list) => {
  for (const one of list.getEntries()) window.__sync.tasks.push(Math.round(one.duration))
}).observe({ entryTypes: ['longtask'] })

setInterval(() => {
  const used = performance.memory ? performance.memory.usedJSHeapSize : 0
  if (used > window.__sync.heap) window.__sync.heap = used
}, 100)
"""

SAYS = """
() => ({
  notes: window.ordenApp?.workspace?.notes?.length ?? null,
  spaces: window.ordenApp?.workspace?.spaces?.length ?? null,
  panel: window.ordenApp?.workspace?.panel ?? null,
  signed: !!window.ordenApp?.account?.signedIn,
  running: !!window.ordenApp?.sync?.running,
  reconciledAt: window.ordenApp?.sync?.reconciledAt ?? null,
  pushed: window.ordenApp?.sync?.pushed ?? null,
  pulled: window.ordenApp?.sync?.pulled ?? null,
  clashed: window.ordenApp?.sync?.clashed ?? null,
  coming: window.ordenApp?.arriving?.coming?.size ?? null,
})
"""

def drive(browser, token: str) -> dict[str, object]:
    context = browser.new_context(viewport={"width": 1280, "height": 860})
    context.add_init_script(WATCH)
    page = context.new_page()
    page.on("pageerror", lambda error: say(f"page error: {error}"))

    asked: list[str] = []
    page.on("request", lambda one: asked.append(one.url) if ORIGIN in one.url else None)

    page.goto(f"{ORIGIN}{harness.SEED_PATH}", wait_until="domcontentloaded")
    seeded = page.evaluate(
        speed.SEED,
        {"notes": NOTES, "lines": 0, "strokes": 0, "points": speed.POINTS, "space": "/Big"},
    )
    say(f"{seeded['rows']} rows seeded into {seeded['stores']}")

    DRIVE.open(page, origin=ORIGIN, patience=60)
    page.evaluate(
        "() => { const ws = window.ordenApp.workspace;"
        " if (ws.panel !== 'tree') ws.showPanel('tree') }"
    )
    page.wait_for_selector("aside .row", timeout=60000)
    page.wait_for_function(
        "() => !!window.ordenApp && !window.ordenApp.links.scanning && !!window.ordenApp.links.rootOf()",
        timeout=180000,
    )
    page.wait_for_timeout(2500)

    before = len(asked)

    page.evaluate(f"() => localStorage.setItem('orden:session', {json.dumps(token)})")
    page.reload(wait_until="commit")

    page.wait_for_function("() => !!window.ordenApp", timeout=60000)
    page.wait_for_function("() => !!window.ordenApp.workspace.activeSpace", timeout=120000)
    page.wait_for_function(
        "() => { const ws = window.ordenApp.workspace;"
        " if (ws.panel !== 'tree') { ws.showPanel('tree'); return false }"
        " return true }",
        timeout=60000,
    )

    def when(script: str, what: str, patience: int = 420000) -> float:
        try:
            page.wait_for_function(script, timeout=patience)
        except Exception:
            say(f"gave up on {what}: {page.evaluate(SAYS)}")
            raise

        at = page.evaluate("() => performance.now()")
        say(f"{what}: {round(at)}ms  {page.evaluate(SAYS)}")
        return at

    tree = when(
        f"() => (window.ordenApp.workspace.notes?.length ?? 0) >= {NOTES}",
        "the space still holds every note",
    )
    first_pass = when(
        "() => { const s = window.ordenApp?.sync;"
        " return !!s && !s.running && (s.reconciledAt ?? 0) > 0 }",
        "the first pass has come back",
        patience=900_000 if harness.WEBKIT else 420_000,
    )

    seen = -1
    still = 0
    while still < 20:
        now = page.evaluate("() => window.ordenApp?.sync?.pushed ?? 0")
        if now != seen:
            if now and (seen < 0 or now // 500 != seen // 500):
                say(f"pushed {now} of {NOTES} at {round(page.evaluate('() => performance.now()'))}ms")
            seen = now
            still = 0
        else:
            still += 1

        if now >= NOTES:
            break

        page.wait_for_timeout(500)

    uploaded = page.evaluate("() => window.ordenApp?.sync?.pushed ?? 0")
    say(f"the pass in flight has sent {uploaded} of {NOTES}; see the note in this file")

    told = page.evaluate(SAYS)
    held = page.evaluate("() => window.__sync")
    tasks = sorted(one for one in held["tasks"] if one >= 50)

    context.close()
    return {
        "tree": round(tree),
        "firstPass": round(first_pass),
        "sentSoFar": uploaded,
        "requests": len(asked) - before,
        "longest": tasks[-1] if tasks else 0,
        "over50": len(tasks),
        "heap": round(held["heap"] / 1e6),
        "pushed": told["pushed"],
        "pulled": told["pulled"],
        "clashed": told["clashed"],
    }

def main() -> int:
    service = harness.Worker(DRIVE)
    with DRIVE.session(args=["--enable-precise-memory-info"]) as browser:
        service.start()
        token = service.account(first.EMAIL)
        found = drive(browser, token)

    print()
    print(f"signing in with {NOTES} notes already on the machine:")
    for key, value in found.items():
        print(f"  {key:36} {value}")

    return 0

if __name__ == "__main__":
    raise SystemExit(main())
