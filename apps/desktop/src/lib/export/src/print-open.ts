import { busy } from '../../ui-kit/src/api'
import { openOut } from './context'
import { picker } from './picker.svelte'
import { printNote } from './print'
import { workspace } from '../../workspace/src/api'

export async function printOpen(): Promise<void> {
  const kind = workspace.active?.kind
  if (__EVEN_PLUGIN__ || (kind !== 'canvas' && kind !== 'pages')) {
    await printNote()
    return
  }

  const open = openOut()

  if (kind === 'canvas') {
    const { drawingOf, printCanvas } = await import('../../plane/src/api')
    await printCanvas(drawingOf(open))
    return
  }

  const out = await (await import('../../pages/src/api')).pagesOut()
  await out.printPages(out.pagesOutOf(open))
}

export const exportRuns = {
  'export.print': () => busy.start('Printing', () => printOpen(), 'print'),
  'export.picker': () => picker.show(),
}
