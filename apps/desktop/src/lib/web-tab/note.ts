import type { ClipOrigin } from '@orden/markdown/clip-note'
import { frontMatterEdit, frontMatterValue, stripFrontMatter } from '@orden/markdown/front-matter'
import { isWebAddress } from './address'

const URL_KEY = 'url'

export function webUrlOf(text: string | null | undefined): string | null {
  const said = frontMatterValue(text ?? '', URL_KEY)
  return said !== null && isWebAddress(said) ? said : null
}

export function webTitleOf(text: string | null | undefined): string | null {
  const said = frontMatterValue(text ?? '', 'title')?.trim()
  return said === undefined || said.length === 0 ? null : said
}

export function keptBody(text: string): string | null {
  const written = stripFrontMatter(text)
    .split('\n')
    .filter((line) => {
      const said = line.trim()
      return said.length > 0 && !said.startsWith('#') && !/^<https?:\/\/[^>]*>$/i.test(said)
    })

  if (written.length === 0) return null

  const edit = frontMatterEdit(text, URL_KEY, null)
  return edit === null ? text : text.slice(0, edit.from) + edit.insert + text.slice(edit.to)
}

export function clipSource(
  read: string | null | undefined,
  fallback: string | null,
): string | null {
  const url = (read ?? '').trim() || (fallback ?? '').trim()
  return isWebAddress(url) ? url : null
}

interface Read {
  url: string
  title: string
  html: string
}

export async function articleOf(page: Read): Promise<ClipOrigin & { html: string }> {
  const { isSnapshot } = await import('@orden/markdown/snapshot')
  if (!isSnapshot(page.html)) return { kind: 'page', ...page, tags: [] }

  const { readSnapshot } = await import('@orden/markdown/article')
  const read = readSnapshot(page.html, page.url)

  return { ...read, title: read.title.trim() || page.title }
}

export async function clipNote(page: Read, when: Date): Promise<string> {
  const [read, { htmlToMarkdown }, { clipNoteText }] = await Promise.all([
    articleOf(page),
    import('@orden/markdown/from-html'),
    import('@orden/markdown/clip-note'),
  ])

  const words = read.html.trim() ? htmlToMarkdown(read.html) : ''
  return clipNoteText(read, words, when)
}
