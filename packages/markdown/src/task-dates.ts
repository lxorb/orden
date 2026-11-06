export type DueReads = 'start' | 'deadline'

interface Dated {
  due?: string | undefined
  scheduled?: string | undefined
  start?: string | undefined
  deadline?: string | undefined
}

export function startOf(task: Dated, due: DueReads = 'start'): string | undefined {
  return task.start ?? (due === 'start' ? task.due : undefined)
}

export function deadlineOf(task: Dated, due: DueReads = 'start'): string | undefined {
  return task.deadline ?? (dueIsDeadline(task, due) ? task.due : undefined)
}

function dueIsDeadline(task: Dated, due: DueReads): boolean {
  return due === 'deadline' || task.start !== undefined
}

export function dayOf(task: Dated, due: DueReads = 'start'): string | undefined {
  return startOf(task, due) ?? task.scheduled ?? deadlineOf(task, due)
}

export function hasStarted(task: Dated, today: string, due: DueReads = 'start'): boolean {
  const start = startOf(task, due)
  return start === undefined || start <= today
}

export function isLate(task: Dated, today: string, due: DueReads = 'start'): boolean {
  const deadline = deadlineOf(task, due)
  return deadline !== undefined && deadline < today
}

export function startField(task: Dated, due: DueReads = 'start'): 'start' | 'scheduled' | 'due' {
  if (task.start) return 'start'
  if (due === 'start' && task.due) return 'due'
  if (task.scheduled) return 'scheduled'
  return 'start'
}

export function deadlineField(task: Dated, due: DueReads = 'start'): 'deadline' | 'due' {
  if (!task.deadline && task.due && dueIsDeadline(task, due)) return 'due'
  return 'deadline'
}
