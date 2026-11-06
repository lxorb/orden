from __future__ import annotations

import json
import shutil
import sys
from pathlib import Path

from playwright.sync_api import BrowserContext, Page

import harness
from harness import Drive

DRIVE = Drive(__file__)
problems = DRIVE.failures
say, wrong, wait_for = DRIVE.say, DRIVE.wrong, DRIVE.wait_for
ORIGIN = DRIVE.origin
SHOTS = DRIVE.shots
APP = harness.APP
ROOT = harness.ROOT

PATIENCE = 60

ORDERS = [
    ("Name, A to Z", "name"),
    ("Name, Z to A", "name-desc"),
    ("Modified, newest first", "modified-desc"),
    ("Modified, oldest first", "modified-asc"),
    ("Created, newest first", "created-desc"),
    ("Created, oldest first", "created-asc"),
    ("Manual", "manual"),
]

def opened(context: BrowserContext, label: str) -> Page:
    page = context.pages[0] if context.pages else context.new_page()
    page.on("pageerror", lambda error: wrong(f"[{label}] page error: {error}"))
    DRIVE.open(page)
    page.evaluate("() => { const ws = window.nibApp.workspace; if (ws.panel !== 'tree') ws.showPanel('tree') }")
    return page

SEED = """
async (many) => {
  const ws = window.nibApp.workspace
  const root = ws.activeSpace.root
  const at = (name) => (root.endsWith('/') ? root + name : root + '/' + name)

  const write = async (name, folder) => {
    const made = await ws.noteFrom(`# ${name}\\n\\nwritten for the drive\\n`, folder)
    if (!made) throw new Error(`nothing written for ${name}`)
    return made
  }

  // Deliberately not in name order: zeta first, Note 12 before Note 2.
  const top = ['zeta', 'Note 12', 'Note 2', 'Note 10', 'Alpha', 'Note 1', 'beta', 'Note 3']
  for (const name of top) await write(name, root)

  for (const [folder, names] of Object.entries(many)) {
    for (const name of names) await write(name, at(folder))
  }

  await ws.createCanvas(root, 'Roadmap.canvas')
  await ws.loadTree()

  return ws.files.length
}
"""

TOUCH = """
async (names) => {
  const ws = window.nibApp.workspace
  const root = ws.activeSpace.root
  const at = (name) => (root.endsWith('/') ? root + name : root + '/' + name)
  const done = []

  for (const name of names) {
    const path = at(`${name}.md`)
    await ws.openEntry(path)
    const doc = ws.documents.find((one) => one.path === path)
    if (!doc) continue

    doc.replace(`${doc.text}\\nwritten in again\\n`, true)
    // Written the way the app writes, a moment after the words change: waited for
    // here, or the tree is read before either file has moved.
    await ws.writeNow()
    done.push(name)
  }

  await ws.loadTree()
  return done
}
"""

TOP_NAMES = """
() => {
  const ws = window.nibApp.workspace
  const root = ws.shownTree
  return root ? root.children.map((one) => one.name) : []
}
"""

DRAWN = """
() => [...document.querySelectorAll('aside .row[data-path]')].map((row) =>
  row.querySelector('.nib-row-label')?.textContent?.trim() ?? '')
"""

WHAT_IS_KEPT = """
() => {
  const ws = window.nibApp.workspace
  return {
    mode: ws.sortMode,
    arranged: ws.arranged.of(ws.activeSpace.root),
    stored: JSON.parse(localStorage.getItem('nib:sorting') ?? 'null'),
  }
}
"""

GLYPH = "aside button[aria-label='Order of the files']"

def open_menu(page: Page) -> None:
    page.locator(GLYPH).first.click()
    page.wait_for_selector("[role=menu] [role=menuitem]", timeout=PATIENCE * 1000)

def chosen(page: Page, label: str, mode: str) -> None:
    open_menu(page)
    page.locator("[role=menu] [role=menuitem]", has_text=label).first.click()
    page.wait_for_timeout(250)

    now = page.evaluate("() => window.nibApp.workspace.sortMode")
    if now != mode:
        wrong(f"pressing {label!r} left the order as {now!r} rather than {mode!r}")

def ticked(page: Page) -> list[str]:
    return page.evaluate(
        """() => [...document.querySelectorAll('[role=menu] [role=menuitem]')].map((row) =>
             `${row.querySelector('.nib-row-label')?.textContent?.trim()}`
             + (row.querySelector('.tick') ? ' [tick]' : ''))"""
    )

def row(page: Page, name: str):
    return page.locator(f'aside .row[data-path$="/{name}"]').first

def rowbox(page: Page, name: str):
    box = row(page, name).bounding_box()
    if not box:
        raise SystemExit(f"no row on screen for {name}")
    return box

def desktop(playwright, profile: Path) -> list[str]:
    context = DRIVE.persistent(
        playwright,
        profile,
        viewport={"width": 1180, "height": 820},
        color_scheme="light",
    )
    try:
        page = opened(context, "desktop")

        held = page.evaluate(
            SEED,
            {
                "Reading": ["Chapter two", "Chapter one", "Notes on it", "Later", "Earlier"],
                "Reading/Deep": ["Attention", "Residuals", "Scaling", "Tokens"],
                "Work": ["Q3 plan", "Budget", "Hiring", "Retro", "Offsite", "Standup"],
                "Work/Q3": ["Week 2", "Week 10", "Week 1", "Week 20"],
                "Archive": ["Last year", "Older still", "Oldest of all"],
                "Archive/2025": [f"Day {index + 1}" for index in range(28)],
            },
        )
        say(f"the space holds {held} files in six folders")
        if held < 55:
            wrong(f"the seed made only {held} files, which is not a list worth windowing")

        written = page.evaluate(TOUCH, ["Note 12", "Alpha"])
        say(f"written in again, so the modified order is not the created one: {written}")

        open_menu(page)
        for one in ticked(page):
            say(f"menu: {one}")
        page.screenshot(path=str(SHOTS / "order-menu.png"))
        say("wrote order-menu.png")
        page.keyboard.press("Escape")
        page.wait_for_timeout(200)

        orders: dict[str, list[str]] = {}
        for label, mode in ORDERS:
            chosen(page, label, mode)
            names = page.evaluate(TOP_NAMES)
            orders[mode] = names
            say(f"{mode}: {' | '.join(names)}")
            page.locator("aside:not(.right)").screenshot(path=str(SHOTS / f"order-{mode}.png"))

        by_name = orders["name"]
        if by_name.index("Note 2.md") > by_name.index("Note 10.md"):
            wrong("Note 10 sorted before Note 2, so the digits were spelled rather than counted")

        deep = len(FOLDERS)
        for mode, names in orders.items():
            if sorted(names[:deep]) != sorted(FOLDERS):
                wrong(f"{mode} did not put the folders first: {names[:deep]}")

        if orders["name-desc"][:deep] != list(reversed(by_name[:deep])) or orders["name-desc"][
            deep:
        ] != list(reversed(by_name[deep:])):
            wrong("Z to A was not A to Z backwards within each group")
        if orders["modified-asc"][deep:] != list(reversed(orders["modified-desc"][deep:])):
            wrong("the two modified orders were not each other backwards")
        if orders["created-asc"][deep:] != list(reversed(orders["created-desc"][deep:])):
            wrong("the two created orders were not each other backwards")
        if orders["modified-desc"] == orders["created-desc"]:
            wrong("the modified order and the created order were the same list")
        if orders["created-asc"] == by_name:
            wrong("the created order was name order, so the seed proved nothing")
        if orders["manual"] != by_name:
            wrong("Manual did not start out as name order for a space nobody has arranged")

        before = page.evaluate(TOP_NAMES)
        moving, onto = "Roadmap.canvas", "Note 1.md"
        say(f"dragging {moving} above {onto}")
        row(page, moving).drag_to(row(page, onto), target_position={"x": 40, "y": 2})
        page.wait_for_timeout(500)

        after = page.evaluate(TOP_NAMES)
        say(f"after the drag: {' | '.join(after)}")
        if after == before:
            wrong("the drag moved nothing")
        elif after.index(moving) != after.index(onto) - 1:
            wrong(f"{moving} did not land above {onto}: {after}")

        page.locator("aside:not(.right)").screenshot(path=str(SHOTS / "order-dragged.png"))
        kept = page.evaluate(WHAT_IS_KEPT)
        say(f"kept: {json.dumps(kept, ensure_ascii=False)}")
        if not kept["arranged"]:
            wrong("the drag wrote no arranged order for the space")
        if kept["stored"] is None or "manual" not in json.dumps(kept["stored"]):
            wrong(f"the chosen order was not written down per space: {kept['stored']}")

        for folder, names in kept["arranged"].items():
            say(f"arranged {folder!r}: {names}")

        held, under = FOLDERS[-1], "Note 1.md"
        tall = int(rowbox(page, under)["height"])
        say(f"dragging the folder {held} below {under}")
        row(page, held).drag_to(row(page, under), target_position={"x": 40, "y": tall - 2})
        page.wait_for_timeout(500)

        mixed = page.evaluate(TOP_NAMES)
        say(f"after the folder moved: {' | '.join(mixed)}")
        if mixed.index(held) != mixed.index(under) + 1:
            wrong(f"the folder {held} did not land below {under}: {mixed}")
        if mixed[: len(FOLDERS)] == after[: len(FOLDERS)]:
            wrong(f"the folders were put back on top of the notes: {mixed}")

        page.locator("aside:not(.right)").screenshot(path=str(SHOTS / "order-folder-moved.png"))

        return mixed
    finally:
        context.close()

def relaunched(playwright, profile: Path, want: list[str]) -> None:
    context = DRIVE.persistent(
        playwright,
        profile,
        viewport={"width": 1180, "height": 820},
        color_scheme="light",
    )
    try:
        page = opened(context, "relaunch")
        wait_for(page, "() => window.nibApp.workspace.files.length > 10", "the space to be read")
        page.wait_for_timeout(400)

        mode = page.evaluate("() => window.nibApp.workspace.sortMode")
        names = page.evaluate(TOP_NAMES)
        say(f"after a relaunch the order is {mode!r}: {' | '.join(names)}")

        if mode != "manual":
            wrong(f"the chosen order did not survive the relaunch: {mode!r}")
        if names != want:
            wrong(f"the arranged order did not survive the relaunch:\n  was {want}\n  now {names}")

        page.locator("aside:not(.right)").screenshot(path=str(SHOTS / "order-relaunched.png"))
        say("wrote order-relaunched.png")
    finally:
        context.close()

def phone(playwright, profile: Path) -> None:
    context = DRIVE.persistent(
        playwright,
        profile,
        viewport={"width": 390, "height": 844},
        has_touch=True,
        is_mobile=True,
        color_scheme="light",
    )
    try:
        page = opened(context, "phone")
        held = page.evaluate(
            SEED,
            {"Reading": ["Chapter two", "Chapter one"], "Work": ["Q3 plan", "Budget"]},
        )
        say(f"[phone] the space holds {held} files")

        page.evaluate(
            "() => { const ws = window.nibApp.workspace; if (!ws.panel) ws.showPanel('tree') }"
        )
        page.wait_for_timeout(400)
        page.locator("aside .row[data-path]").first.wait_for(state="visible", timeout=10000)

        chosen(page, "Manual", "manual")

        before = page.evaluate(TOP_NAMES)
        say(f"[phone] before: {' | '.join(before)}")
        page.screenshot(path=str(SHOTS / "order-phone.png"))

        moving, onto = "zeta.md", "Alpha.md"
        source = rowbox(page, moving)
        target = rowbox(page, onto)
        say(f"[phone] lifting {moving} with a finger and dropping it above {onto}")

        cdp = context.new_cdp_session(page)

        def touch(kind: str, x: float, y: float) -> None:
            points = [] if kind == "touchEnd" else [{"x": x, "y": y}]
            cdp.send("Input.dispatchTouchEvent", {"type": kind, "touchPoints": points})

        start_x = source["x"] + 40
        start_y = source["y"] + source["height"] / 2
        end_y = target["y"] + 2

        touch("touchStart", start_x, start_y)
        page.wait_for_timeout(320)
        if not page.evaluate("() => !!document.querySelector('.row.carried')"):
            wrong("[phone] the hold did not lift the row")

        steps = 14
        for step in range(1, steps + 1):
            touch("touchMove", start_x, start_y + (end_y - start_y) * step / steps)
            page.wait_for_timeout(20)
            if step == steps // 2:
                page.wait_for_timeout(220)
                page.screenshot(path=str(SHOTS / "order-phone-lifted.png"))
                held = page.evaluate(
                    "() => ({ carried: !!document.querySelector('.row.carried'),"
                    " hollow: document.querySelectorAll('.row.is-lifted').length })"
                )
                say(f"[phone] in the air: {held}")
                if not held["carried"] or not held["hollow"]:
                    wrong(f"[phone] the lift was not drawn as one: {held}")

        page.wait_for_timeout(200)
        touch("touchEnd", start_x, end_y)
        page.wait_for_timeout(500)

        after = page.evaluate(TOP_NAMES)
        say(f"[phone] after: {' | '.join(after)}")
        if after == before:
            wrong("[phone] the lift moved nothing")
        elif after.index(moving) != after.index(onto) - 1:
            wrong(f"[phone] {moving} did not land above {onto}: {after}")

        if page.evaluate("() => !!document.querySelector('.row.carried')"):
            wrong("[phone] the copy under the finger was left behind")

        page.screenshot(path=str(SHOTS / "order-phone-dragged.png"))
        say("wrote the phone shots")
    finally:
        context.close()

FOLDERS: list[str] = []

def main() -> int:
    global FOLDERS

    profiles = Path(ROOT / "target" / "tree-order-profiles")
    if profiles.exists():
        shutil.rmtree(profiles, ignore_errors=True)
    desk = profiles / "desktop"
    hand = profiles / "phone"
    desk.mkdir(parents=True, exist_ok=True)
    hand.mkdir(parents=True, exist_ok=True)

    FOLDERS = sorted(["Archive", "Reading", "Work"])

    with DRIVE.session(playwright=True) as playwright:
        arranged = desktop(playwright, desk)
        relaunched(playwright, desk, arranged)
        phone(playwright, hand)

    return DRIVE.verdict("the seven orders read as they should, and Manual held a drag")

if __name__ == "__main__":
    sys.exit(main())
