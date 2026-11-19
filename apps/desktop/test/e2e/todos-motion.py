import json
from playwright.sync_api import Browser, Page
from harness import Drive

DRIVE = Drive(__file__)
say, wrong, wait_for = DRIVE.say, DRIVE.wrong, DRIVE.wait_for
BOARD = "[data-todos-board]"
RECORD = """(scope) => {
  window.__frames = []
  const rec = () => {
    const lists = [...document.querySelectorAll(scope)].map((list) => {
      const box = list.getBoundingClientRect()
      const cards = [...list.querySelectorAll('[data-todo-card]')].map((one) => {
        const at = one.getBoundingClientRect()
        const row = one.querySelector('[data-todo]')
        return [one.querySelector('.title').textContent.trim(), Math.round(at.left - box.left), Math.round(at.top - box.top), row?.classList.contains('is-lifted') ?? false, Number(getComputedStyle(one.parentElement).opacity)]
      })
      return [list.dataset.key ?? '', cards]
    })
    window.__frames.push(lists)
    if (window.__frames.length < 90) requestAnimationFrame(rec)
  }
  requestAnimationFrame(rec)
}"""
Frames = list[list[tuple[str, list[tuple[str, int, int, bool, float]]]]]
def recorded(page: Page) -> Frames:
    page.wait_for_function("() => window.__frames?.length >= 90", timeout=10000)
    return page.evaluate("() => window.__frames")  # type: ignore[no-any-return]
def tracks(frames: Frames) -> dict[str, list[tuple[str, int, int]]]:
    out: dict[str, list[tuple[str, int, int]]] = {}
    for lists in frames:
        for key, cards in lists:
            for title, x, y, *_ in cards:
                out.setdefault(title, []).append((key, x, y))
    return out
def changes(track: list[tuple[str, int, int]]) -> list[tuple[str, int, int]]:
    out = [track[0]]
    for one in track[1:]:
        if one != out[-1]:
            out.append(one)
    return out
def still(frames: Frames, what: str) -> None:
    moved = {title: changes(track) for title, track in tracks(frames).items() if len(set(track)) > 1}
    say(f"{what}: {len(frames)} frames, cards moving inside their column: {moved}")
    if moved:
        wrong(f"{what}: cards moved inside their column {moved}")
def one_way(frames: Frames, what: str) -> None:
    for title, track in tracks(frames).items():
        if len({key for key, _, _ in track}) > 1:
            wrong(f"{what}: {title} changed column while settling {changes(track)}")
        ys = [y for _, _, y in changes(track)]
        steps = [b - a for a, b in zip(ys, ys[1:]) if b != a]
        if any(a * b < 0 for a, b in zip(steps, steps[1:])):
            wrong(f"{what}: {title} went back and forth {ys}")
    say(f"{what}: {len(frames)} frames, {({title: changes(track) for title, track in tracks(frames).items() if len(set(track)) > 1})}")
def order(frames: Frames, what: str) -> None:
    seen = {tuple(key for key, _ in lists) for lists in frames}
    if len(seen) > 1:
        wrong(f"{what}: the column order changed after the drop {seen}")
def box(page: Page, title: str) -> dict:
    found = page.locator(f"{BOARD} [data-todo-card]", has=page.locator(".title", has_text=title)).first.bounding_box()
    if not found:
        raise RuntimeError(f"no card {title}")
    return found
def head(page: Page, key: str) -> dict:
    found = page.locator(f"{BOARD} [data-todos-column][data-key='{key}'] h2 .name").bounding_box()
    if not found:
        raise RuntimeError(f"no column {key}")
    return found
def carry(page: Page, start: dict, end: tuple[float, float], scope: str) -> Frames:
    page.mouse.move(start["x"] + 30, start["y"] + start["height"] / 2)
    page.mouse.down()
    page.mouse.move(start["x"] + 34, start["y"] + start["height"] / 2 + 6, steps=3)
    page.mouse.move(end[0], end[1], steps=12)
    page.mouse.move(end[0], end[1] + 1)
    page.wait_for_timeout(600)
    page.evaluate(RECORD, scope)
    page.mouse.up()
    return recorded(page)
def columns(page: Page) -> list[str]:
    return page.evaluate(f"() => [...document.querySelectorAll('{BOARD} [data-todos-column]')].map((one) => one.dataset.key)")  # type: ignore[no-any-return]
def titles(page: Page, key: str) -> list[str]:
    return page.evaluate(f"() => [...document.querySelectorAll(\"{BOARD} [data-todos-column][data-key='{key}'] [data-todo-card] .title\")].map((one) => one.textContent.trim())")  # type: ignore[no-any-return]
def board(page: Page) -> None:
    page.evaluate("() => window.ordenApp.tasks().then(({ openTodos }) => openTodos())")
    page.wait_for_selector(f"{BOARD} [data-todos-column]", state="attached")
    for title, label in [("Alpha one", "a"), ("Bravo one", "b"), ("Bravo two", "b"), ("Bravo three", "b"), ("Charlie one", "c"), ("Charlie two", "c"), ("Charlie three", "c"), ("Charlie four", "c")]:
        page.evaluate("([title, label]) => window.ordenApp.tasks().then(({ todos }) => todos.add({ title, labels: [label] }))", [title, label])
    wait_for(page, f"document.querySelectorAll('{BOARD} [data-todo-card]').length >= 8", "the cards")
    page.wait_for_timeout(600)
    scope = f"{BOARD} [data-todos-column]"
    first = page.locator(scope).first.bounding_box() or {}
    frames = carry(page, head(page, "c"), (first["x"] + 12, first["y"] + 20), scope)
    still(frames, "column c to the front")
    order(frames, "column c to the front")
    if columns(page)[0] != "c":
        wrong(f"column c did not land in front: {columns(page)}")
    last = page.locator(scope).last.bounding_box() or {}
    frames = carry(page, head(page, "a"), (last["x"] + last["width"] - 10, last["y"] + 20), scope)
    still(frames, "column a to the end")
    order(frames, "column a to the end")
    under = box(page, "Bravo two")
    frames = carry(page, box(page, "Charlie one"), (under["x"] + 40, under["y"] + under["height"] * 0.8), scope)
    one_way(frames, "sorted: Charlie one into column b")
    if "Charlie one" not in titles(page, "b"):
        wrong(f"Charlie one did not land in column b: {titles(page, 'b')}")
    under = box(page, "Bravo three")
    frames = carry(page, box(page, "Bravo one"), (under["x"] + 40, under["y"] + under["height"] * 0.8), scope)
    still(frames, "Bravo one under Bravo three in its column")
    under = box(page, "Bravo one")
    frames = carry(page, box(page, "Charlie two"), (under["x"] + 40, under["y"] + under["height"] * 0.2), scope)
    still(frames, "manual: Charlie two into column b")
    say(f"column b: {titles(page, 'b')}, column c: {titles(page, 'c')}")
    if titles(page, "b").index("Charlie two") != titles(page, "b").index("Bravo one") - 1:
        wrong(f"Charlie two did not land above Bravo one: {titles(page, 'b')}")
def drive(browser: Browser) -> None:
    context = DRIVE.context(browser, viewport={"width": 1400, "height": 820}, color_scheme="dark")
    page = context.new_page()
    page.on("pageerror", lambda error: wrong(f"page error: {error}"))
    DRIVE.open(page)
    page.wait_for_function("() => !!window.ordenApp?.tasks", timeout=60000)
    board(page)
    context.close()
raise SystemExit(DRIVE.run(drive, "todos move without a jump: a column carries its cards still, a card lands without going back"))
