import { frontMatterBlock } from '@orden/markdown/front-matter'
import { isMarkdownPath, nameFromTitle, nameOf, shownName } from '../../platform/src/api'

export interface Title {
  from: number
  to: number
  words: string
}
const HEADING = /^# +(\S.*?)\s*$/
export function titleOf(text: string): Title | null {
  const start = frontMatterBlock(text)?.to ?? 0
  const end = text.indexOf('\n', start)
  const line = text.slice(start, end === -1 ? text.length : end).replace(/\r$/, '')
  const found = HEADING.exec(line)
  const words = found?.[1]
  if (words === undefined) return null
  const from = start + line.indexOf(words, 2)
  return { from, to: from + words.length, words }
}
export const sameName = (words: string, stem: string): boolean => nameFromTitle(words) === stem
export const stemOf = (path: string): string | null => (isMarkdownPath(path) ? shownName(nameOf(path)) : null)
export function lineOf(text: string, title: Title): { from: number; to: number } {
  const end = text.indexOf('\n', title.to)
  return { from: text.lastIndexOf('\n', title.from - 1) + 1, to: end === -1 ? text.length : end }
}
export function retitled(text: string, from: string, to: string): string | null {
  const title = titleOf(text)
  const was = stemOf(from)
  const now = stemOf(to)
  if (title === null || was === null || now === null || !sameName(title.words, was)) return null
  return text.slice(0, title.from) + now + text.slice(title.to)
}
