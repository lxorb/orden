from __future__ import annotations
from harness import Drive
DRIVE = Drive(__file__, dev=True)
say, wrong = DRIVE.say, DRIVE.wrong

JS = r"""
async () => {
  const ws = window.ordenApp.workspace
  const { invoke } = await import('/src/lib/platform/src/api.ts')
  const { modes } = await import('/src/lib/modes.svelte.ts')
  const listing = async (base) => {
    const tree = await invoke('read_tree', { root: base, options: { every: true, showHidden: true, papers: true } }).catch(() => ({ children: [] }))
    const out = []
    const go = (entry) => { for (const c of entry.children) { out.push(c.path.slice(base.length + 1)); if (c.is_dir) go(c) } }
    go(tree)
    return out.sort()
  }
  const space = async (name) => { const s = await ws.addSpace(name); await ws.loadTree(); return s }
  const write = async (path, text) => { await invoke('write_note', { path, content: text }); await ws.loadTree() }
  const out = {}
  const rootOf = (s) => ws.spaces.find((one) => one.id === s.id).root
  {
    const s = await space('U11')
    const was = s.root
    await write(was + '/x.md', 'words\n')
    await ws.remove(was + '/x.md', false)
    await ws.renameSpace(s.id, 'U11b')
    await ws.undoFileAction(); await ws.writesSettled(); await ws.loadTree()
    await ws.loadSpaces()
    out.t11 = { now: await listing(rootOf(s)), spaces: ws.spaces.map((one) => one.root).filter((one) => one.includes('U11')) }
  }
  {
    const s = await space('U12')
    await write(s.root + '/x.md', 'words\n')
    await ws.rename(s.root + '/x.md', 'y.md')
    await ws.renameSpace(s.id, 'U12b')
    await ws.undoFileAction(); await ws.writesSettled(); await ws.loadTree()
    out.t12 = { now: await listing(rootOf(s)), left: ws.undoLabel }
  }
  {
    const s = await space('U3')
    await invoke('create_folder', { path: s.root + '/A' })
    await write(s.root + '/A/A.md', 'inner\n'); await write(s.root + '/A/B.md', 'b\n'); await write(s.root + '/A.md', 'outer\n')
    let threw = null
    await ws.removeMany([s.root + '/A/B.md']).catch((error) => { threw = String(error) })
    await ws.loadTree()
    out.t3 = { now: await listing(s.root), threw }
  }
  modes.setZoom(1); modes.setZoom(1.05); out.up = modes.zoom; modes.setZoom(1)
  return out
}
"""

def drive(browser):
    page = DRIVE.page(browser, viewport={"width": 1280, "height": 860})
    DRIVE.open(page)
    got = page.evaluate(JS)
    say(str(got))
    if got["t11"]["now"] != ["x.md"] or len(got["t11"]["spaces"]) != 1:
        wrong(f"delete undone over a space rename: {got['t11']}")
    if got["t12"]["now"] != ["x.md"]:
        wrong(f"rename undone over a space rename: {got['t12']}")
    if got["t3"]["threw"] is not None or "A/B.md" in got["t3"]["now"] or "A.md" not in got["t3"]["now"]:
        wrong(f"delete beside a note of the folder's name: {got['t3']}")
    if got["up"] != 1.1:
        wrong(f"text size by key: {got['up']}")

if __name__ == "__main__":
    raise SystemExit(DRIVE.run(drive))
