import { type Keystroke, matchesCombination, type Platform } from '../keys'

export type RowKey =
  | { kind: 'step'; by: number }
  | { kind: 'open' }
  | { kind: 'note' }
  | { kind: 'tick' }
  | { kind: 'schedule' }
  | { kind: 'undate' }
  | { kind: 'priority'; priority: 1 | 2 | 3 | 4 }
  | { kind: 'priorities' }
  | { kind: 'labels' }
  | { kind: 'project' }
  | { kind: 'more' }
  | { kind: 'comment' }
  | { kind: 'pick' }
  | { kind: 'unpick' }
  | { kind: 'move'; up: boolean }
  | { kind: 'indent'; deeper: boolean }
  | { kind: 'fold' }
  | { kind: 'delete' }
  | { kind: 'link' }
  | { kind: 'add'; where?: 'end' | 'top' }
  | { kind: 'edit' }

const ROW_KEYS: readonly (readonly [string, RowKey])[] = [
  ['tasks.next', { kind: 'step', by: 1 }],
  ['tasks.previous', { kind: 'step', by: -1 }],
  ['tasks.complete.alt', { kind: 'tick' }],
  ['tasks.complete.alt2', { kind: 'tick' }],
  ['tasks.open', { kind: 'open' }],
  ['tasks.note', { kind: 'note' }],
  ['tasks.complete', { kind: 'tick' }],
  ['tasks.schedule', { kind: 'schedule' }],
  ['tasks.undate', { kind: 'undate' }],
  ['tasks.priority', { kind: 'priorities' }],
  ['tasks.p1', { kind: 'priority', priority: 1 }],
  ['tasks.p2', { kind: 'priority', priority: 2 }],
  ['tasks.p3', { kind: 'priority', priority: 3 }],
  ['tasks.p4', { kind: 'priority', priority: 4 }],
  ['tasks.labels', { kind: 'labels' }],
  ['tasks.move', { kind: 'project' }],
  ['tasks.more', { kind: 'more' }],
  ['tasks.comment', { kind: 'comment' }],
  ['tasks.select', { kind: 'pick' }],
  ['tasks.edit', { kind: 'edit' }],
  ['tasks.indent', { kind: 'indent', deeper: true }],
  ['tasks.indent.alt', { kind: 'indent', deeper: true }],
  ['tasks.outdent', { kind: 'indent', deeper: false }],
  ['tasks.outdent.alt', { kind: 'indent', deeper: false }],
  ['tasks.up', { kind: 'move', up: true }],
  ['tasks.up.alt', { kind: 'move', up: true }],
  ['tasks.down', { kind: 'move', up: false }],
  ['tasks.down.alt', { kind: 'move', up: false }],
  ['tasks.subtasks', { kind: 'fold' }],
  ['tasks.delete', { kind: 'delete' }],
  ['tasks.link', { kind: 'link' }],
  ['tasks.quick-add', { kind: 'add' }],
  ['tasks.add', { kind: 'add', where: 'end' }],
  ['tasks.add-top', { kind: 'add', where: 'top' }],
]

function fixed(press: Keystroke): RowKey | null {
  if (press.ctrlKey || press.metaKey || press.altKey || press.shiftKey) return null
  if (press.key === 'ArrowDown') return { kind: 'step', by: 1 }
  if (press.key === 'ArrowUp') return { kind: 'step', by: -1 }
  if (press.key === 'Escape') return { kind: 'unpick' }
  return null
}

export function rowKey(
  press: Keystroke,
  keyFor: (id: string) => string | null,
  platform: Platform,
): RowKey | null {
  const own = fixed(press)
  if (own) return own
  for (const [id, key] of ROW_KEYS) {
    const combination = keyFor(id)
    if (combination && matchesCombination(combination, press, platform)) return key
  }
  return null
}
