import { taskHash } from '@orden/bases'
import { type Meta, writtenDates } from '@orden/bases/todo-lists'
import { readTask } from '@orden/markdown/task-line'
import { taskAt } from '@orden/markdown/tasks'
import { fieldsOfTask, type Item, readInbox } from '@orden/bases/inbox-items'

const FENCE = /^\s{0,3}(```|~~~)/

export interface Split {
  kept: string
  todos: string
}

export function todosOut(markdown: string): Split {
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n')
  const front = lines[0] === '---' ? lines.indexOf('---', 1) + 1 : 0
  const kept: string[] = lines.slice(0, front)
  const todos: string[] = []
  let fence: string | null = null
  let inTodo = false
  for (const line of lines.slice(front)) {
    const opens = FENCE.exec(line)?.[1] ?? null
    if (fence !== null || opens !== null) {
      fence = fence === null ? opens : opens === fence ? null : fence
      inTodo = false
      kept.push(line)
    } else if (taskAt(line)?.indent === 0 && readTask(line)) {
      inTodo = true
      todos.push(line)
    } else if (inTodo && line.trim() !== '' && /^\s/.test(line)) {
      todos.push(line)
    } else {
      inTodo = false
      kept.push(line)
    }
  }
  return {
    kept: kept.join('\n'),
    todos: todos.length ? `${todos.join('\n')}\n` : '',
  }
}

export function carriedItems(markdown: string): Item[] {
  const seen = new Map<string, number>()
  return readInbox(markdown).blocks.map((block, index) => {
    const many = seen.get(block.task.text) ?? 0
    seen.set(block.task.text, many + 1)
    const key = `${block.task.text}\u0000${many}`
    return {
      id: `m${taskHash(key)}${taskHash(`${many}\u0000${key}`)}`,
      fields: fieldsOfTask(block.task, block.rest, index),
    }
  })
}

export interface Carrying {
  read(path: string): Promise<string | null>
  meta(path: string): Meta
  write(path: string, text: string): Promise<void>
  remove(path: string): Promise<void>
  carried(items: readonly Item[]): Promise<void>
  headed(text: string): Promise<void>
  kept(ids: readonly string[]): Promise<boolean>
}

export type Carried = 'none' | 'carried' | 'waiting'

export async function carriedFrom(
  path: string,
  carrying: Carrying,
  whole: boolean,
): Promise<Carried> {
  const words = await carrying.read(path)
  if (words === null) return 'none'
  const split = todosOut(writtenDates(words, carrying.meta(path)))
  const items = carriedItems(split.todos)
  if (!items.length && !whole) return 'carried'
  await carrying.carried(items)
  if (whole) await carrying.headed(split.kept)
  if (!(await carrying.kept(items.map((one) => one.id)))) return 'waiting'
  if ((await carrying.read(path)) !== words) return 'waiting'
  if (whole) await carrying.remove(path)
  else await carrying.write(path, split.kept)
  return 'carried'
}

const TASK = /^\s*(?:[-*+]|\d+[.)])\s+\[[^\]]\]/

export function madeByOrden(text: string): boolean {
  let inTask = false
  for (const line of text.replace(/\r\n?/g, '\n').split('\n')) {
    if (!line.trim()) continue
    if (TASK.test(line)) {
      inTask = true
      continue
    }
    if (inTask && /^\s/.test(line)) continue
    return false
  }
  return true
}
