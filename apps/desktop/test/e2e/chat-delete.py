from __future__ import annotations

from playwright.sync_api import Browser, Page

from harness import Drive

DRIVE = Drive(__file__, dev=True)
say, wrong, shot = DRIVE.say, DRIVE.wrong, DRIVE.shot

SEED = r"""
async () => {
  const ws = window.ordenApp.workspace
  const root = ws.activeSpace.root
  const { invoke } = await import('/src/lib/platform/src/api.ts')
  const { chats } = await import('/src/lib/chats-client/src/store.svelte.ts')
  const made = [['Plans', 12], ['Quiet', 0]].map(([name, seq], at) => {
    const id = 'c_' + String(at + 1).repeat(32)
    return { id, path: root + '/' + name + '.chat', name, seq }
  })
  for (const one of made) {
    await invoke('write_note', { path: one.path, content: JSON.stringify({ v: 1, chat: one.id }) + '\n' })
  }
  chats.list = made.map((one) => ({
    id: one.id, space: 'space-1', root, path: one.path, name: one.name, role: 'owner', members: 1,
    lastSeq: one.seq, lastAt: null, lastBy: null, readSeq: one.seq, unread: 0, mentions: 0,
    notify: null, mutedUntil: null, meta: { topic: '', posting: 'writers', slowmode: 0 },
  }))
  await ws.loadTree()
  return made.map((one) => one.path)
}
"""

DELETE = r"""
async (path) => {
  const ws = window.ordenApp.workspace
  const { rowMenu } = await (await import('/src/lib/row-menu/src/api.ts')).rowMenus()
  const entry = ws.notes.find((one) => one.path === path) ?? { path, name: path.split('/').pop(), is_dir: false }
  const item = rowMenu(entry).find((one) => one && one.label === 'Delete')
  if (!item) return false
  item.run()
  return true
}
"""

THERE = "(path) => window.ordenApp.workspace.notes.some((one) => one.path === path)"

DIALOG = '[role="dialog"], [role="alertdialog"]'

def asked(page: Page) -> str | None:
    try:
        page.wait_for_selector(DIALOG, timeout=3000)
    except Exception:
        return None
    return page.locator(DIALOG).last.inner_text()

def gone(page: Page, path: str) -> bool:
    try:
        page.wait_for_function(f"(path) => !({THERE})(path)", arg=path, timeout=5000)
    except Exception:
        return False
    return True

def drive(browser: Browser) -> None:
    page = DRIVE.page(browser, viewport={"width": 1280, "height": 760}, color_scheme="dark")
    DRIVE.open(page)
    plans, quiet = page.evaluate(SEED)

    if not page.evaluate(DELETE, plans):
        wrong("no Delete in the chat row's menu")
        return
    said = asked(page)
    say(f"asked: {said!r}")
    if not said or "Delete Plans?" not in said or "messages" not in said:
        wrong("deleting a chat with messages did not ask first")
    else:
        shot(page, "asked")
        page.keyboard.press("Escape")
        page.wait_for_timeout(500)
        if not page.evaluate(THERE, plans):
            wrong("Escape deleted the chat anyway")
        page.evaluate(DELETE, plans)
        asked(page)
        page.locator(DIALOG).last.get_by_role("button", name="Delete").click()
        if not gone(page, plans):
            wrong("Delete in the question left the chat")

    page.evaluate(DELETE, quiet)
    page.wait_for_timeout(300)
    if page.locator(DIALOG).count():
        wrong("deleting a chat with no messages asked")
        shot(page, "asked-empty")
    if not gone(page, quiet):
        wrong("a chat with no messages was not deleted")
    shot(page, "after")
    page.context.close()

if __name__ == "__main__":
    raise SystemExit(DRIVE.run(drive))
