import { busy } from '../ui-kit/src/api'
import { pageBytes, invoke } from '../platform/src/api'
import { type PaperInches, pageSetupFor, paperInches } from '../page-setup'
import { DEFAULT_PAGE_SETUP } from '../paper'
import { workspace } from '../workspace.svelte'
import { openTarget, renderOptions } from './context'

export const canPrint = typeof window !== 'undefined' && typeof window.print === 'function'

export async function writtenPdf(
  html: string | Blob,
  target: string,
  page: PaperInches,
): Promise<boolean> {
  try {
    await invoke('print_pdf', { bytes: await pageBytes(html), output: target, page })
    return true
  } catch {
    busy.failed('The file could not be written, so it goes to the print dialog')
    return false
  }
}

async function printNote(): Promise<void> {
  const [{ renderNote }, { printWithPictures }] = await Promise.all([
    import('../export'),
    import('./sheet'),
  ])

  const target = openTarget()
  const { resolveImage, ...options } = await renderOptions(target)
  const html = await renderNote(target.source, target.name, { ...options, scheme: 'light' })
  const page = paperInches(pageSetupFor(target.source, options.page ?? DEFAULT_PAGE_SETUP))

  await printWithPictures(html, resolveImage, page)
}

const PRINTABLE: ReadonlySet<string> = new Set(
  __EVEN_PLUGIN__ ? ['note'] : ['note', 'canvas', 'pages'],
)

export function printable(kind: string | undefined): boolean {
  return kind !== undefined && PRINTABLE.has(kind)
}

export async function printOpen(): Promise<void> {
  const kind = workspace.active?.kind
  if (__EVEN_PLUGIN__ || (kind !== 'canvas' && kind !== 'pages')) {
    await printNote()
    return
  }

  const target = openTarget()
  const open = {
    text: target.source,
    name: target.name,
    path: target.path,
    root: workspace.rootHolding(target.path),
    shared: workspace.active?.note.shared ?? null,
    trusted: target.trusted,
  }

  if (kind === 'canvas') {
    const [{ drawingOf }, { printCanvas }] = await Promise.all([
      import('./drawing'),
      import('../canvas/picture'),
    ])
    await printCanvas(drawingOf(open))
    return
  }

  const out = await import('../pages/out')
  await out.printPages(out.pagesOutOf(open))
}
