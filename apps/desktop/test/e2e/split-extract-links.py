import json
import re
from harness import Drive
DRIVE = Drive(__file__, dev=True)
say, wrong = DRIVE.say, DRIVE.wrong
RUN = r"""
async (mode) => {
  const ws = window.ordenApp.workspace
  const root = ws.activeSpace.root.replace(/\/$/, '')
  const { invoke } = await import('/src/lib/platform/src/api.ts')
  const nap = (ms = 300) => new Promise((go) => setTimeout(go, ms))
  const dir = root + '/' + mode
  const beta = '# Beta\n\nintro\n\n## Later\n\npara ^blk\n'
  await ws.noteFrom(beta, dir)
  await ws.noteFrom('# Alpha\n\n[[Beta#Later]] and [[Beta#^blk]]\n', dir)
  await ws.loadTree()
  await nap(600)
  await ws.openEntry(dir + '/Beta.md', { activate: true })
  for (let i = 0; i < 50 && !document.querySelector('.cm-content'); i++) await nap(100)
  await nap(400)
  const at = beta.indexOf('## Later')
  if (mode === 'split') await ws.splitAtCaret(at)
  else await ws.extractSelection(at, beta.length)
  await nap(1500)
  await ws.loadTree()
  const walk = (entry) => entry.children.flatMap((one) => one.is_dir ? walk(one) : [one.path])
  const files = walk(ws.tree).filter((one) => one.startsWith(dir + '/'))
  const out = {}
  for (const f of files) out[f.slice(dir.length + 1)] = await invoke('read_note', { path: f }).catch(() => null)
  return out
}
"""
def drive(browser):
    page = DRIVE.page(browser, viewport={"width": 1280, "height": 860})
    DRIVE.open(page)
    for mode in ("split", "extract"):
        got = page.evaluate(RUN, mode)
        say(mode + " " + json.dumps(got))
        alpha = got.get("Alpha.md") or ""
        for target, fragment in re.findall(r"\[\[([^#\]|]+)#([^\]|]+)", alpha):
            text = got.get(target + ".md") or ""
            ok = (f"^{fragment[1:]}" in text) if fragment.startswith("^") else (f"## {fragment}" in text)
            if not ok:
                wrong(f"{mode}: Alpha's [[{target}#{fragment}]] no longer finds its place; {target}.md is {text!r}")
raise SystemExit(DRIVE.run(drive))
