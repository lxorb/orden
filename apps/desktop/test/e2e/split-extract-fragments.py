import json
from playwright.sync_api import Browser
from harness import Drive

DRIVE = Drive(__file__)
say, wrong = DRIVE.say, DRIVE.wrong
BETA = "# Beta\n\n## Intro\n\nsee [[#Later]], [[#^blk]] and [m](#later)\n\n## Later\n\nback to [[#Intro]]\n\npara ^blk\n"
RUN = r"""
async ([mode, beta]) => {
  const ws = window.ordenApp.workspace
  const nap = (ms = 300) => new Promise((go) => setTimeout(go, ms))
  const dir = ws.activeSpace.root.replace(/\/$/, '') + '/' + mode
  await ws.noteFrom(beta, dir)
  await ws.loadTree()
  await nap(600)
  await ws.openEntry(dir + '/Beta.md', { activate: true })
  for (let i = 0; i < 50 && !document.querySelector('.cm-content'); i++) await nap(100)
  await nap(400)
  const at = beta.indexOf('## Later')
  if (mode === 'split') await ws.splitAtCaret(at)
  else await ws.extractSelection(at, beta.length)
  await nap(1500)
  const files = async () => {
    await ws.loadTree()
    const walk = (entry) => entry.children.flatMap((one) => (one.is_dir ? walk(one) : [one.path]))
    const out = {}
    for (const path of walk(ws.tree).filter((one) => one.startsWith(dir + '/'))) {
      out[path.slice(dir.length + 1)] = await ws.noteText(path)
    }
    return out
  }
  const carved = await files()
  await ws.undoFileAction()
  await nap(1500)
  return { carved, undone: await files() }
}
"""
def drive(browser: Browser) -> None:
    page = DRIVE.page(browser, viewport={"width": 1280, "height": 860})
    page.on("pageerror", lambda error: wrong(f"page error: {error}"))
    DRIVE.open(page)
    for mode in ("split", "extract"):
        got = page.evaluate(RUN, [mode, BETA])
        say(mode + " " + json.dumps(got))
        carved, undone = got["carved"], got["undone"]
        kept, moved = carved.get("Beta.md") or "", carved.get("Later.md") or ""
        for link in ("[[Later#Later]]", "[[Later#^blk]]", "[m](Later.md#later)"):
            if link not in kept:
                wrong(f"{mode}: the kept Beta.md does not hold {link}: {kept!r}")
        if "[[Beta#Intro]]" not in moved:
            wrong(f"{mode}: the moved Later.md does not point back with [[Beta#Intro]]: {moved!r}")
        if undone.get("Beta.md") != BETA:
            wrong(f"{mode}: undo did not give Beta.md its words back: {undone.get('Beta.md')!r}")
        if "Later.md" in undone:
            wrong(f"{mode}: undo left Later.md behind")
    page.context.close()
raise SystemExit(DRIVE.run(drive))
