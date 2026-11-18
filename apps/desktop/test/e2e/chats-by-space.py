from __future__ import annotations

from playwright.sync_api import Browser

from harness import Drive

DRIVE = Drive(__file__, dev=True, chats=True)
say, wrong, shot, wait_for = DRIVE.say, DRIVE.wrong, DRIVE.shot, DRIVE.wait_for

START = """
async () => {
  const { seeded } = await import('/src/lib/chats-client/src/view/seed.ts')
  const { useStore } = await import('/src/lib/chats-client/src/view/source.svelte.ts')
  const made = seeded()
  const space = window.ordenApp.workspace.activeSpace
  for (const name of ['general', 'plans']) {
    made.store.add(name, [], { root: space.root, path: `${space.root}/${name}.chat`, space: 's_here' })
  }
  useStore(made.store)
  return space.name
}
"""

LISTED = """() => [...document.querySelectorAll('.chats .space, .chats .entry')].map((one) =>
  one.classList.contains('space') ? `# ${one.textContent.trim()}` : one.textContent.trim())"""

def drive(browser: Browser) -> None:
    for scheme in ("light", "dark"):
        page = DRIVE.page(browser, viewport={"width": 1180, "height": 760}, color_scheme=scheme)
        DRIVE.open(page)
        page.evaluate(f"() => window.ordenApp.theme.setScheme('{scheme}')")
        here = page.evaluate(START)
        DRIVE.sign_in(page)
        page.evaluate("() => window.ordenApp.workspace.showPanel('chats')")
        wait_for(page, "document.querySelectorAll('.chats .entry').length >= 4", "the chats")
        listed: list[str] = page.evaluate(LISTED)
        say(f"{scheme}: {listed}")
        heads = [one for one in listed if one.startswith("# ")]
        if heads != [f"# {here}", "# Other spaces"]:
            wrong(f"{scheme}: the spaces read {heads}, not {here} and Other spaces")
        generals = [at for at, one in enumerate(listed) if one == "general"]
        between = [one for one in listed[slice(*generals)] if one.startswith("# ")] if len(generals) == 2 else []
        if len(generals) != 2 or not between:
            wrong(f"{scheme}: the two chats called general are not under two spaces: {listed}")
        DRIVE.settled(page)
        shot(page, f"{scheme}-chats-by-space", clip={"x": 0, "y": 0, "width": 320, "height": 520})
        page.context.close()

if __name__ == "__main__":
    raise SystemExit(DRIVE.run(drive, "two chats with one name stand under the spaces they belong to"))
