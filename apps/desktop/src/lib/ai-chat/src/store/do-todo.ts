import { AGENT_WINDOW_VERBS, BROWSER_VERBS } from '../../../agent-protocol/src/api'
import type { Todo } from '../../../tasks-model/src/api'
import { DEFAULT_ASK, TASK_TOOLS, type TaskTool, taskAsk, taskMode, taskUses } from './prefs'

const FINISH = [
  'When it is done and you are sure it is, tick it with update_task (done: true) by its id below.',
  'If you are not sure, or what it asks is unclear, or you need something from me, leave it open and say what you need in its description with update_task.',
  'Always end with one of these two update_task calls: words in this chat alone are never read.',
].join(' ')
export function askOf(todo: Todo, ask = DEFAULT_ASK): string {
  const own = ask.trim() || DEFAULT_ASK
  const about = [
    `Todo: ${todo.title}`,
    `Id: ${todo.id}`,
    ...(todo.description.trim() ? [`Description: ${todo.description.trim()}`] : []),
    ...(todo.deadline ? [`Deadline: ${todo.deadline}`] : []),
    ...(todo.subtasks.length
      ? [`Subtasks: ${todo.subtasks.map((one) => `${one.done ? '[x]' : '[ ]'} ${one.title}`).join('; ')}`]
      : []),
  ]
  return `${own}\n\n${FINISH}\n\n${about.join('\n')}`
}
const verbsOf = (scope: string): string[] =>
  Object.entries(AGENT_WINDOW_VERBS)
    .filter(([, needs]) => needs === scope)
    .map(([verb]) => verb)
const TOOLS_OF: Record<TaskTool, () => string[]> = {
  browser: () => BROWSER_VERBS.filter((one) => one.startsWith('browser_')),
  notes: () => verbsOf('notes.read').filter((one) => one !== 'list_tasks'),
  edits: () => [...verbsOf('notes.write'), ...verbsOf('tree')].filter((one) => one !== 'update_task'),
}
export const keptOut = (off: readonly TaskTool[]): string[] => off.flatMap((one) => TOOLS_OF[one]())
export async function doWithAi(todo: Todo, space: string): Promise<boolean> {
  if (todo.done || space === '') return false
  const { chat } = await import('./chat.svelte')
  const without = keptOut(TASK_TOOLS.filter((one) => !taskUses(one)))
  void chat.startAside(space, todo.title, taskMode(), askOf(todo, taskAsk()), without).catch(() => undefined)
  return true
}
