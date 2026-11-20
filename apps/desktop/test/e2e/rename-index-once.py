import json
from harness import Drive
DRIVE = Drive(__file__, dev=True)
say, wrong = DRIVE.say, DRIVE.wrong
RUN = r"""
async ([linked, panel, wait]) => {
  const ws = window.ordenApp.workspace
  const links = window.ordenApp.links
  const root = ws.activeSpace.root.replace(/\/$/, '')
  const nap = (ms = 300) => new Promise((go) => setTimeout(go, ms))
  const tag = 'T' + Math.random().toString(36).slice(2, 6)
  if (panel) ws.showPanel('search')
  await ws.noteFrom('# B' + tag + '\n\nwords\n', root)
  if (linked) await ws.noteFrom('# A' + tag + '\n\nsee [[B' + tag + ']]\n', root)
  await ws.loadTree()
  await nap(wait)
  const count = (name) => links.held().filter((n) => n.path === name).length
  const before = count('B' + tag + '.md')
  await ws.rename(root + '/B' + tag + '.md', 'G' + tag + '.md')
  await nap(800)
  const after = count('G' + tag + '.md')
  const old = count('B' + tag + '.md')
  await nap(3000)
  const later = count('G' + tag + '.md')
  const back = linked ? links.backlinks(root + '/G' + tag + '.md').length : null
  const nodes = links.pictureOf(false).nodes.filter((n) => n.id === 'G' + tag + '.md').length
  return { linked, panel, wait, before, after, old, later, back, nodes }
}
"""
def drive(browser):
    page = DRIVE.page(browser, viewport={"width": 1280, "height": 860})
    DRIVE.open(page)
    for linked in (True, False):
        for panel in (False, True):
            for wait in (300, 2000):
                got = page.evaluate(RUN, [linked, panel, wait])
                say(json.dumps(got))
                if got["later"] != 1 or got["nodes"] != 1:
                    wrong(f"the link index holds the renamed note {got['later']} times: {got}")
raise SystemExit(DRIVE.run(drive))
