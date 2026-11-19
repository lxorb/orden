import { CodeBlocks, OPENS } from '@orden/markdown/fences'
import { frontMatterBlock } from '@orden/markdown/front-matter'

interface DrawnFence {
  words: string
  from: number
  to: number
  margin: boolean
}
export function drawnFences(text: string): DrawnFence[] {
  const out: DrawnFence[] = []
  const code = new CodeBlocks()
  const matter = frontMatterBlock(text)
  let at = matter ? matter.to : 0
  let open: { from: number; prefix: number; lines: string[] } | null = null
  const close = (to: number) => {
    if (open) {
      out.push({
        words: open.lines.join('\n'),
        from: open.from,
        to,
        margin: open.prefix === 0,
      })
    }
    open = null
  }
  while (at < text.length) {
    const end = text.indexOf('\n', at)
    const next = end === -1 ? text.length : end + 1
    const raw = text.slice(at, end === -1 ? text.length : end)
    const kind = code.line(raw)
    if (open && code.fence === null) close(at)
    else if (open) {
      const { prefix } = open
      open.lines.push(prefix ? raw.replace(new RegExp(`^[ \\t>]{0,${prefix}}`), '') : raw)
    }
    if (kind === OPENS && code.fence !== null) {
      const prefix = raw.indexOf(code.fence)
      const info = raw.slice(prefix + code.fence.length).trim()
      if (info.split(/\s+/)[0] === 'base') open = { from: next, prefix, lines: [] }
    }
    at = next
  }
  close(text.length)
  return out
}
