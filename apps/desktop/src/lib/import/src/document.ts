import type { PandocPicture } from '@orden/contracts'
import { invoke, isDesktop } from '../../platform/src/api'
import { busy } from '../../ui-kit/src/api'

export async function importDocument(): Promise<{
  name: string
  markdown: string
  pictures: PandocPicture[]
} | null> {
  if (!isDesktop) return null

  const { open } = await import('@tauri-apps/plugin-dialog')
  const given = (await import('../../dialog-answer')).dialogAnswer()
  const picked = given
    ? await given(false)
    : await open({
        filters: [
          {
            name: 'Documents',
            extensions: [
              'docx',
              'odt',
              'rtf',
              'epub',
              'rst',
              'textile',
              'tex',
              'html',
              'opml',
              'org',
            ],
          },
        ],
      })

  if (typeof picked !== 'string') return null

  const { markdown, leftOut, pictures } = await invoke<{
    markdown: string
    leftOut: string | null
    pictures: PandocPicture[]
  }>('import_document', { path: picked })
  if (leftOut) busy.failed(leftOut)
  const name =
    picked
      .split(/[\\/]/)
      .pop()
      ?.replace(/\.[^.]+$/, '') ?? 'Imported'

  return { name: `${name}.md`, markdown, pictures }
}
