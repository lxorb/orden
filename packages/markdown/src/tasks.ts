export interface TaskItem {
  box: number
  mark: string
  done: boolean
  marker: number
  indent: number
}

const TASK = /^([ \t]*)(?:[-*+]|\d{1,9}[.)])([ \t]+)\[(.)\](?:[ \t]+|$)/

export function taskAt(line: string): TaskItem | null {
  const found = TASK.exec(line)
  const [whole, indent, gap, mark] = found ?? []
  if (whole === undefined || indent === undefined || gap === undefined || mark === undefined) {
    return null
  }

  return {
    box: whole.indexOf('[', indent.length + gap.length),
    mark,
    done: mark !== ' ',
    marker: whole.length,
    indent: indent.length,
  }
}
