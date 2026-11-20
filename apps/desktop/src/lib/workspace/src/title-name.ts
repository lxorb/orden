import { frontMatterBlock } from '@orden/markdown/front-matter'
import { isMarkdownPath, nameFromTitle, nameOf, shownName } from '../../platform/src/api'

export interface Title {
  from: number
  to: number
  words: string
}
const HEADING = /^# +(\S.*?)\s*$/
export function titleLine(text: string): { from: number; to: number } {
  const from = frontMatterBlock(text)?.to ?? 0
  const end = text.indexOf('\n', from)
  return { from, to: end === -1 ? text.length : end }
}
export function titleOf(text: string): Title | null {
  const { from: start, to } = titleLine(text)
  const line = text.slice(start, to).replace(/\r$/, '')
  const found = HEADING.exec(line)
  const words = found?.[1]
  if (words === undefined) return null
  const from = start + line.indexOf(words, 2)
  return { from, to: from + words.length, words }
}
export const sameName = (words: string, stem: string): boolean => nameFromTitle(words) === stem
export const stemOf = (path: string): string | null => (isMarkdownPath(path) ? shownName(nameOf(path)) : null)
