import { CodeBlocks, WORDS } from '@orden/markdown/fences'
import { frontMatterBlock } from '@orden/markdown/front-matter'
import { taskAt } from '@orden/markdown/tasks'

export interface ScannedTask {
  line: number
  indent: number
  mark: string
  text: string
  section: string[]
  description?: string
  comments?: number
}

export interface Stamp {
  size: number
  mtime: number
  ctime: number
}

export interface ScannedRows {
  front: string | null
  tasks: ScannedTask[]
}

const MOST_TASKS = 5000

export const LONGEST_TASK = 2000

export const LONGEST_DESCRIPTION = 300

const LIST_ITEM = /^[ \t]*(?:[-*+]|\d{1,9}[.)])(?:[ \t]+|$)/

interface Open {
  indent: number
  task: ScannedTask | null
  told: boolean
}

export function scanRows(content: string): ScannedRows {
  const block = frontMatterBlock(content)
  const front = block ? content.slice(block.body.from, block.body.to).replace(/\r?\n$/, '') : null
  const wordsFrom = block ? lineOf(content, block.close) + 1 : 0

  const tasks: ScannedTask[] = []
  const section: { level: number; text: string }[] = []
  const open: Open[] = []
  const lines = content.split('\n')
  const code = new CodeBlocks()

  for (let index = 0; index < lines.length; index++) {
    const line = (lines[index] ?? '').replace(/\r$/, '')
    if (index < wordsFrom || code.line(line) !== WORDS) continue

    const heading = headingAt(line)
    if (heading) {
      while ((section.at(-1)?.level ?? 0) >= heading.level) section.pop()
      section.push(heading)
      open.length = 0
      continue
    }

    const task = taskAt(line)
    const scanned =
      task && tasks.length < MOST_TASKS
        ? {
            line: index,
            indent: task.indent,
            mark: task.mark,
            text: clipped(line.slice(task.marker), LONGEST_TASK),
            section: section.map((one) => one.text),
          }
        : null
    if (scanned) tasks.push(scanned)
    under(open, line, task !== null, scanned)
  }

  return { front, tasks }
}

function under(open: Open[], line: string, isTask: boolean, task: ScannedTask | null) {
  const words = line.trim()
  if (!words) return
  const indent = line.length - line.trimStart().length
  while ((open.at(-1)?.indent ?? -1) >= indent) open.pop()
  const owner = open.at(-1)

  if (isTask || LIST_ITEM.test(line)) {
    if (owner?.task) {
      owner.told = true
      if (!isTask) owner.task.comments = (owner.task.comments ?? 0) + 1
    }
    open.push({ indent, task, told: false })
  } else if (owner?.task && !owner.told && owner.task.description === undefined) {
    owner.task.description = clipped(words, LONGEST_DESCRIPTION)
  }
}

function lineOf(content: string, at: number): number {
  let lines = 0
  for (
    let found = content.indexOf('\n');
    found !== -1 && found < at;
    found = content.indexOf('\n', found + 1)
  ) {
    lines++
  }
  return lines
}

function headingAt(line: string): { level: number; text: string } | null {
  const trimmed = line.trimStart()
  if (line.length - trimmed.length > 3) return null

  let level = 0
  while (trimmed[level] === '#') level++
  if (level === 0 || level > 6) return null

  const rest = trimmed.slice(level)
  if (!rest.startsWith(' ') && !rest.startsWith('\t')) return null

  return { level, text: rest.trim().replace(/#+$/, '').trim() }
}

function clipped(text: string, most: number): string {
  if (text.length <= most) return text
  return Array.from(text).slice(0, most).join('')
}
