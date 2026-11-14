import { busy } from '../../ui-kit/src/api'
import { pageBytes, invoke } from '../../platform/src/api'
import { type PaperInches, pageSetupFor, paperInches } from '../../page-setup'
import { DEFAULT_PAGE_SETUP } from '../../paper'
import { openTarget, renderOptions } from './context'

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

export async function printNote(): Promise<void> {
  const [{ renderNote }, { printWithPictures }] = await Promise.all([
    import('./render'),
    import('./sheet'),
  ])

  const target = openTarget()
  const { resolveImage, ...options } = await renderOptions(target)
  const html = await renderNote(target.source, target.name, { ...options, scheme: 'light' })
  const page = paperInches(pageSetupFor(target.source, options.page ?? DEFAULT_PAGE_SETUP))

  await printWithPictures(html, resolveImage, page)
}
