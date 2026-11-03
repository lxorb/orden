/** A space's inbox where the reader chose no note of theirs: Orden's own (#1044).
 *
 *  A note underneath, so its tasks are rows like any other and the one write path edits
 *  it, but a hidden one at the root of the space, which the file list, the search, the
 *  link scan, the graph and Obsidian all leave out: a task with no place puts no file
 *  into the space the reader did not make. Sync carries it all the same (`carriedOwn`).
 *  A file rather than a folder of Orden's: two devices that each made the inbox apart
 *  make one note, merged (a mergeable create, docs/sync-v2.md 5.9), where two folders
 *  made apart would be two folders. The app, the crate and the account's connector all
 *  write here. */
export const INBOX_PATH = '.Inbox.md'

/** Whether a path inside a space, relative to it, is a hidden one sync carries all the
 *  same: the space's own inbox, and nothing else. The crate's walk says the same
 *  (`carried` in src-tauri/src/space_watch/walk.rs). */
export function carriedOwn(relative: string): boolean {
  return relative.replace(/\\/g, '/').replace(/^\/+/, '') === INBOX_PATH
}

/** A note's lines in blocks: a task line with the lines indented under it (its
 *  description, comments and sub-tasks), and every other line on its own. */
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

/** Every task of `into`, and after them every block of `from` that `into` does not
 *  hold as often yet, in the order `from` has them: two lists of tasks as one, nothing
 *  lost and nothing twice, however often it is asked. What an inbox moved in is merged
 *  by, and what two copies of one are where nothing finer can tell them apart. */
export function withTasksOf(into: string, from: string): string {
  // Counted, so a task written twice on purpose is twice in the answer, and asked again
  // the answer adds nothing.
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

