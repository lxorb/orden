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
    const [{ drawingOf }, { printCanvas }] = await Promise.all([
      import('./canvas/drawing'),
      import('./canvas/picture'),
    ])
    await printCanvas(drawingOf(open))
    return
  }

  const out = await import('./pages/out')
  await out.printPages(out.pagesOutOf(open))
}
