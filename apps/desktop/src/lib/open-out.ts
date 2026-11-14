import { openTarget, printNote } from './export/src/api'
import { workspace } from './workspace.svelte'

export function openOut() {
  const target = openTarget()
  return {
    text: target.source,
    name: target.name,
    path: target.path,
    root: workspace.rootHolding(target.path),
    shared: workspace.active?.note.shared ?? null,
    trusted: target.trusted,
  }
}

export async function printOpen(): Promise<void> {
  const kind = workspace.active?.kind
  if (__EVEN_PLUGIN__ || (kind !== 'canvas' && kind !== 'pages')) {
    await printNote()
    return
  }

  const open = openOut()

  if (kind === 'canvas') {
    const { drawingOf, printCanvas } = await import('./plane/src/api')
    await printCanvas(drawingOf(open))
    return
  }

  const out = await (await import('./pages/src/api')).pagesOut()
  await out.printPages(out.pagesOutOf(open))
}
