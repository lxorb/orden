export interface TextEdit {
  from: number
  to: number
  insert: string
}

export function oneEdit(before: string, after: string): TextEdit | null {
  if (before === after) return null

  let from = 0
  while (from < before.length && from < after.length && before[from] === after[from]) from++

  let back = 0
  while (
    back < before.length - from &&
    back < after.length - from &&
    before[before.length - 1 - back] === after[after.length - 1 - back]
  ) {
    back++
  }

  return { from, to: before.length - back, insert: after.slice(from, after.length - back) }
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
