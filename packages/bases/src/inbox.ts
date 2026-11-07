export const INBOX_PATH = '.Inbox.md'

export const INBOX_NAME = 'Inbox'

export const ACCOUNT_INBOX = '.orden-inbox.md'

const plain = (relative: string) => relative.replace(/\\/g, '/').replace(/^\/+/, '')

export function isAccountInbox(path: string): boolean {
  return plain(path).split('/').at(-1) === ACCOUNT_INBOX
}

export function isInboxPath(relative: string): boolean {
  const path = plain(relative)
  return path === INBOX_PATH || path === ACCOUNT_INBOX
}

export function carriedOwn(relative: string): boolean {
  return plain(relative) === INBOX_PATH
}

export const INBOX_KEY = 'inbox'

export const INBOX_VALUE = 'yes'

export function markedInbox(
  notes: Iterable<readonly [string, Readonly<Record<string, string>> | null | undefined]>,
): string | null {
  let first: string | null = null
  for (const [path, meta] of notes) {
    if (meta?.[INBOX_KEY] !== INBOX_VALUE || carriedOwn(path)) continue
    if (first === null || path < first) first = path
  }
  return first
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

export function withTasksOf(into: string, from: string): string {
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

export function meansInbox(said: string): boolean {
  return /^\s*inbox(?:\.md)?\s*$/i.test(said)
}
