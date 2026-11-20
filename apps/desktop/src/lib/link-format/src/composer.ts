import type { LinkWrite } from '@orden/editor'
import { formatLink, type LinkFormat, type LinkTarget, linkWriting } from './link-format'
import {
  frontMatterBlock,
  frontMatterEdit,
  frontMatterEntry,
  frontMatterKeys,
  frontMatterList,
  stripFrontMatter,
} from '@orden/markdown/front-matter'
import { flowItem } from '@orden/markdown/yaml'

const SEAM = '\n\n---\n\n'
const LISTED = new Set(['aliases', 'alias', 'tags', 'tag', 'cssclasses'])
const edited = (text: string, edit: { from: number; to: number; insert: string } | null): string =>
  edit ? text.slice(0, edit.from) + edit.insert + text.slice(edit.to) : text
const lineEnded = (text: string): string => (text.endsWith('\n') ? text : `${text}\n`)
function withMatterOf(into: string, from: string): string {
  const block = frontMatterBlock(from)
  if (!block) return into
  if (!frontMatterBlock(into)) return `${lineEnded(from.slice(block.from, block.to))}${into}`
  let out = into
  for (const key of frontMatterKeys(from)) {
    const held = frontMatterKeys(out).find((one) => one.toLowerCase() === key.toLowerCase())
    if (held === undefined) {
      const said = frontMatterEntry(from, key)
      const close = frontMatterBlock(out)?.close ?? 0
      if (said) out = `${out.slice(0, close)}${lineEnded(said)}${out.slice(close)}`
      continue
    }
    if (!LISTED.has(key.toLowerCase())) continue
    const ours = frontMatterList(out, held)
    const both = [...new Set([...ours, ...frontMatterList(from, key)])]
    if (both.length === ours.length) continue
    out = edited(out, frontMatterEdit(out, held, null))
    out = edited(out, frontMatterEdit(out, held, `[${both.map(flowItem).join(', ')}]`))
  }
  return out
}
export function merged(into: string, from: string): string {
  const head = withMatterOf(into, from).replace(/\s+$/, '')
  const tail = stripFrontMatter(from).replace(/^\s+/, '').replace(/\s+$/, '')
  if (!head) return tail
  if (!tail) return head
  return `${head}${SEAM}${tail}\n`
}
export const linkTo = (
  name: string,
  shown?: string | null,
  about: Omit<LinkTarget, 'name' | 'shown'> = {},
  format: LinkFormat = linkWriting(),
): string => formatLink({ ...about, name, ...(shown ? { shown } : {}) }, format)
export const pickedLink = (target: LinkWrite): string =>
  linkTo(target.name, target.shown ?? null, {
    markdown: target.markdown ?? null,
    path: target.path ?? null,
    from: target.from ?? null,
    fragment: target.fragment ?? null,
    file: target.file ?? null,
  })
