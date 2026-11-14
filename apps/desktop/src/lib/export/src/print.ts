import { pageSetupFor, paperInches } from '../../page-setup'
import { DEFAULT_PAGE_SETUP } from '../../paper'
import { openTarget, renderOptions } from './context'

export async function printNote(): Promise<void> {
  const [{ renderNote }, { printWithPictures }] = await Promise.all([
    import('./render'),
    import('../../files-out/src/api'),
  ])

  const target = openTarget()
  const { resolveImage, ...options } = await renderOptions(target)
  const html = await renderNote(target.source, target.name, { ...options, scheme: 'light' })
  const page = paperInches(pageSetupFor(target.source, options.page ?? DEFAULT_PAGE_SETUP))

  await printWithPictures(html, resolveImage, page)
}
