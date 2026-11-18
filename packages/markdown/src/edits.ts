export interface TextEdit {
  from: number
  to: number
  insert: string
}

function leadsPair(text: string, at: number): boolean {
  const code = text.charCodeAt(at)
  return code >= 0xd800 && code <= 0xdbff
}

export function oneEdit(held: string, mine: string): TextEdit | null {
  if (held === mine) return null

  const shortest = Math.min(held.length, mine.length)

  let front = 0
  while (front < shortest && held.charCodeAt(front) === mine.charCodeAt(front)) front++
  if (front > 0 && leadsPair(held, front - 1)) front--

  let back = 0
  while (
    back < shortest - front &&
    held.charCodeAt(held.length - 1 - back) === mine.charCodeAt(mine.length - 1 - back)
  ) {
    back++
  }
  if (back > 0 && leadsPair(held, held.length - back - 1)) back--

  return { from: front, to: held.length - back, insert: mine.slice(front, mine.length - back) }
}

export function appliedEdits(before: string, edits: readonly TextEdit[]): string {
  let text = ''
  let at = 0
  for (const edit of edits) {
    text += before.slice(at, edit.from) + edit.insert
    at = edit.to
  }
  return text + before.slice(at)
}
