import type { EditorState } from '@codemirror/state'
import { loadFor } from '@orden/markdown/engines'
import { decodeTarget } from '@orden/markdown/links'
import { mapSources } from '@orden/markdown/sources'
import { attributeValue } from '../attributes'
import { imageResolver } from '../images'
import { noteIndex } from './notes'

const REMOTE = /^(?:[a-z][a-z\d+.-]*:|\/\/)/i

function written(src: string): string {
  return decodeTarget(src.replace(/&amp;/g, '&'))
}

export async function renderNote(
  source: string,
  path: string | null,
  state: EditorState,
): Promise<string> {
  const host = state.facet(noteIndex).render
  if (host) return host(source, path)

  const [{ renderMarkdown }] = await Promise.all([import('@orden/markdown'), loadFor(source)])

  const html = renderMarkdown(source, { footnotes: true, escapeHtml: true })
  const resolve = state.facet(imageResolver)

  return mapSources(html, (src) =>
    REMOTE.test(src) ? null : attributeValue(resolve(written(src))),
  )
}
