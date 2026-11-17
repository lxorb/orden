export const OWN_FILE = '.Inbox.md'

const plain = (relative: string) => relative.replace(/\\/g, '/').replace(/^\/+/, '')

export function isOwnFile(relative: string): boolean {
  return plain(relative) === OWN_FILE
}

function blocks(text: string): string[] {
  const out: string[] = []
  let block: string[] = []
  const flush = () => {
    if (block.length) out.push(block.join('\n'))
    block = []
  }
  for (const line of text.replace(/\r\n?/g, '\n').split('\n')) {
    if (!line.trim()) {
      flush()
      continue
    }
    if (/^\s/.test(line) && block.length) block.push(line)
    else {
      flush()
      block.push(line)
    }
  }
  flush()
  return out
}

export function withBlocksOf(into: string, from: string): string {
  const held = new Map<string, number>()
  for (const one of blocks(into)) held.set(one, (held.get(one) ?? 0) + 1)
  const added = blocks(from).filter((one) => {
    const left = held.get(one) ?? 0
    if (left > 0) held.set(one, left - 1)
    return left === 0
  })
  if (!added.length) return into
  const head = into.replace(/\s+$/, '')
  return `${head ? `${head}\n` : ''}${added.join('\n')}\n`
}
