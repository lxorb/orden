import json
from playwright.sync_api import Browser, Page
from harness import Drive

DRIVE = Drive(__file__)
say, wrong, wait_for = DRIVE.say, DRIVE.wrong, DRIVE.wait_for
BOARD = "[data-todos-board]"
PANEL = "[data-todos-panel]"
RECORD = """([scope, count]) => {
  window.__frames = []
  window.__stop = false
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
    if (window.__frames.length < count && !window.__stop) requestAnimationFrame(rec)
  }
  requestAnimationFrame(rec)
}"""
Frames = list[list[tuple[str, list[tuple[str, int, int, bool, float]]]]]
def recorded(page: Page, count: int = 90) -> Frames:
    page.wait_for_function(f"() => window.__frames?.length >= {count}", timeout=15000)
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
    page.evaluate(RECORD, [scope, 90])
    page.mouse.up()
    return recorded(page)
def columns(page: Page) -> list[str]:
    return page.evaluate(f"() => [...document.querySelectorAll('{BOARD} [data-todos-column]')].map((one) => one.dataset.key)")  # type: ignore[no-any-return]
def titles(page: Page, key: str) -> list[str]:
    return page.evaluate(f"() => [...document.querySelectorAll(\"{BOARD} [data-todos-column][data-key='{key}'] [data-todo-card] .title\")].map((one) => one.textContent.trim())")  # type: ignore[no-any-return]
def listed(page: Page, scope: str) -> list[list[str]]:
    return page.evaluate(f"() => [...document.querySelectorAll({json.dumps(scope)})].map((list) => [...list.querySelectorAll('[data-todo-card] .title')].map((one) => one.textContent.trim()))")  # type: ignore[no-any-return]
def ticked(page: Page, scope: str, title: str, what: str) -> None:
    before = listed(page, scope)
    page.evaluate(RECORD, [scope, 150])
    page.locator(f"{scope} [data-todo-card]", has=page.locator(".title", has_text=title)).first.locator(".tick").click()
    frames = recorded(page, 150)
    track = tracks(frames).get(title, [])
    say(f"{what}: {len(frames)} frames, {title} {changes(track) if track else 'never shown'}, others {({one: changes(t) for one, t in tracks(frames).items() if one != title and len(set(t)) > 1})}")
    if len(set(track)) > 1:
        wrong(f"{what}: {title} moved before it left {changes(track)}")
    if track and len(track) == len(frames):
        wrong(f"{what}: {title} was still shown after {len(frames)} frames")
    for one, t in tracks(frames).items():
        ys = [y for _, _, y in changes(t)]
        if one != title and any(b > a for a, b in zip(ys, ys[1:])):
            wrong(f"{what}: {one} moved down while {title} left {ys}")
    page.locator("button", has_text="Undo").first.click()
    page.wait_for_timeout(700)
    after = listed(page, scope)
    say(f"{what}: undone {after}")
    if after != before:
        wrong(f"{what}: Undo did not bring {title} back where it stood: {before} -> {after}")
def slow(page: Page, key: str, what: str) -> None:
    scope = f"{BOARD} [data-todos-column][data-key='{key}']"
    order = titles(page, key)
    start, end = box(page, order[0]), box(page, order[3])
    page.evaluate(RECORD, [scope, 100000])
    page.mouse.move(start["x"] + 30, start["y"] + start["height"] / 2)
    page.mouse.down()
    page.mouse.move(start["x"] + 34, start["y"] + start["height"] / 2 + 6, steps=3)
    page.wait_for_timeout(300)
    y0, y1 = start["y"] + start["height"] / 2 + 6, end["y"] + end["height"] * 0.8
    for step in range(1, 41):
        page.mouse.move(start["x"] + 34, y0 + (y1 - y0) * step / 40)
        page.wait_for_timeout(250 if step % 10 == 5 else 25)
    page.wait_for_timeout(400)
    dropped = page.evaluate("() => window.__frames.length")
    page.mouse.up()
    page.wait_for_timeout(800)
    frames: Frames = page.evaluate("() => { window.__stop = true; return window.__frames }")
    lifted = order[0]
    held = tracks(frames[:dropped])
    say(f"{what}: {len(frames)} frames, drop at {dropped}: " + ", ".join(f"{one} {[y for _, _, y in changes(t)]}" for one, t in held.items()))
    for one, track in held.items():
        ys = [y for _, _, y in changes(track)]
        if one == lifted:
            if any(b < a for a, b in zip(ys, ys[1:])):
                wrong(f"{what}: the lifted {one} went back up while carried down {ys}")
            if max(ys) >= max(y for t in held.values() for _, _, y in t):
                wrong(f"{what}: the lifted {one} showed at the end of the column {ys}")
        else:
            if any(b > a for a, b in zip(ys, ys[1:])):
                wrong(f"{what}: {one} went down and up while a card passed it {ys}")
            if order.index(one) > 3 and len(ys) > 1:
                wrong(f"{what}: {one} moved though nothing passed it {ys}")
    after = {one: set(track) for one, track in tracks(frames[dropped:]).items()}
    if any(len(one) > 1 for one in after.values()):
        wrong(f"{what}: cards moved after the drop {({one: sorted(t) for one, t in after.items() if len(t) > 1})}")
    if titles(page, key) != [*order[1:4], order[0], *order[4:]]:
        wrong(f"{what}: {order} became {titles(page, key)}")
def sort(page: Page, name: str) -> None:
    page.locator(f"{BOARD} [data-todos-sort] [role=combobox]").click()
    page.locator("[role=listbox] [role=option]", has_text=name).click()
    wait_for(page, f"document.querySelector('{BOARD} [data-todos-sort] [role=combobox]').textContent.includes({json.dumps(name)})", f"sorted by {name}")
    page.wait_for_timeout(400)
def board(page: Page) -> None:
    page.evaluate("() => window.ordenApp.tasks().then(({ openTodos }) => openTodos())")
    page.wait_for_selector(f"{BOARD} [data-todos-column]", state="attached")
    for title, label in [("Delta one", "d"), ("Delta two", "d"), ("Delta three", "d"), ("Delta four", "d"), ("Delta five", "d"), ("Alpha one", "a"), ("Bravo one", "b"), ("Bravo two", "b"), ("Bravo three", "b"), ("Charlie one", "c"), ("Charlie two", "c"), ("Charlie three", "c"), ("Charlie four", "c")]:
        page.evaluate("([title, label]) => window.ordenApp.tasks().then(({ todos }) => todos.add({ title, labels: [label] }))", [title, label])
    wait_for(page, f"document.querySelectorAll('{BOARD} [data-todo-card]').length >= 13", "the cards")
    page.wait_for_timeout(600)
    slow(page, "d", "sorted: Delta one carried slowly down its column")
    slow(page, "d", "manual: Delta two carried slowly down its column")
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
    sort(page, "Deadline")
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
def panel_groups(page: Page) -> None:
    page.locator(f"{PANEL} [data-todos-group] [role=combobox]").click()
    page.locator("[role=listbox] [role=option]", has_text="Label").click()
    page.wait_for_selector(f"{PANEL} [data-todos-group-box][data-key='a'] [data-todos-group-head]")
    page.wait_for_timeout(500)
    DRIVE.shot(page, "panel-groups")
    scope = f"{PANEL} .lists"
    for what in ["folded", "unfolded"]:
        page.evaluate(RECORD, [scope, 60])
        page.locator(f"{PANEL} [data-todos-group-box][data-key='a'] [data-todos-group-head]").click()
        frames = recorded(page, 60)
        for title, track in tracks(frames).items():
            ys = [y for _, _, y in changes(track)]
            steps = [b - a for a, b in zip(ys, ys[1:]) if b != a]
            if title != "Alpha one" and any(x * y < 0 for x, y in zip(steps, steps[1:])):
                wrong(f"group a {what}: {title} went back and forth {ys}")
        say(f"group a {what}: {len(frames)} frames, cards below moved one way")
    under = page.locator(f"{PANEL} [data-todos-group-box][data-key='b'] [data-todo-card]").first.bounding_box() or {}
    start = page.locator(f"{PANEL} [data-todos-group-box][data-key='a'] [data-todo-card]").first.bounding_box() or {}
    carry(page, start, (under["x"] + 40, under["y"] + under["height"] * 0.8), scope)
    labels = page.evaluate("() => window.ordenApp.tasks().then(({ todos }) => todos.todos.find((one) => one.title === 'Alpha one').labels)")
    say(f"Alpha one carried into group b has labels {labels}")
    if labels != ["b"]:
        wrong(f"a todo carried into another group of the panel kept {labels}")
def tones(browser: Browser, scheme: str) -> None:
    context = DRIVE.context(browser, viewport={"width": 1100, "height": 600}, color_scheme=scheme)
    page = context.new_page()
    page.on("pageerror", lambda error: wrong(f"page error: {error}"))
    DRIVE.open(page)
    page.wait_for_function("() => !!window.ordenApp?.tasks", timeout=60000)
    page.evaluate("() => window.ordenApp.tasks().then(({ openTodos }) => openTodos())")
    page.wait_for_selector(f"{BOARD} [data-todos-column]", state="attached")
    for title, priority in [("Fix the roof", 3), ("Call the bank", 2), ("Sort the photos", 1), ("Read a book", 0)]:
        page.evaluate("([title, priority]) => window.ordenApp.tasks().then(({ todos }) => todos.add({ title, priority }))", [title, priority])
    wait_for(page, f"document.querySelectorAll('{BOARD} [data-todo-card]').length >= 4", "the cards")
    page.wait_for_timeout(400)
    seen = page.evaluate(f"""() => Object.fromEntries([...document.querySelectorAll('{BOARD} [data-todo-card]')].map((one) => {{
      const label = one.querySelector('.priority')
      const meta = one.querySelector('.meta') ?? one
      return [one.querySelector('.title').textContent.trim(), [label ? getComputedStyle(label).color : null, getComputedStyle(meta).color, getComputedStyle(one.querySelector('.tick')).borderColor]]
    }}))""")
    say(f"tones ({scheme}): {seen}")
    low, medium, high = seen["Sort the photos"][0], seen["Call the bank"][0], seen["Fix the roof"][0]
    if not low or low == seen["Sort the photos"][1] or low in (medium, high) or medium == high:
        wrong(f"({scheme}) Low, Medium and High are not each in their own tone: {seen}")
    DRIVE.shot(page, f"tones-{scheme}")
    page.evaluate("() => { const ws = window.ordenApp.workspace; ws.movePanel('tasks', 'right'); ws.showPanel('tasks') }")
    page.locator(f"{PANEL} [data-todos-group] [role=combobox]").click()
    page.locator("[role=listbox] [role=option]", has_text="Priority").click()
    page.wait_for_selector(f"{PANEL} [data-todos-group-head]")
    page.wait_for_timeout(400)
    DRIVE.shot(page, f"panel-groups-{scheme}")
    context.close()
def drive(browser: Browser) -> None:
    tones(browser, "light")
    tones(browser, "dark")
    context = DRIVE.context(browser, viewport={"width": 1400, "height": 820}, color_scheme="dark")
    page = context.new_page()
    page.on("pageerror", lambda error: wrong(f"page error: {error}"))
    DRIVE.open(page)
    page.wait_for_function("() => !!window.ordenApp?.tasks", timeout=60000)
    board(page)
    ticked(page, f"{BOARD} [data-todos-column]", "Bravo three", "ticked on the board")
    page.evaluate("() => { const ws = window.ordenApp.workspace; ws.movePanel('tasks', 'right'); ws.showPanel('tasks') }")
    page.wait_for_selector(f"{PANEL} [data-todo-card]")
    page.wait_for_timeout(500)
    second = listed(page, f"{PANEL} ul.list")[0][1]
    ticked(page, f"{PANEL} ul.list", second, "ticked in the panel")
    panel_groups(page)
    context.close()
raise SystemExit(DRIVE.run(drive, "todos move without a jump: a column carries its cards still, a card lands without going back"))
