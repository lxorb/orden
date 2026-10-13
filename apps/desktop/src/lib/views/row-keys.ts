/** What a key pressed on a row of a view does (docs/tasks.md 5.16): Todoist's keys, read
 *  the same in every layout that has rows, each one a row of the shortcuts registry
 *  (`tasks.*`), so it is shown in the settings and can be put on another key.
 *
 *    ↑ ↓, j k             the row below, the row above
 *    Enter                the task's own view (a note: the note, beside the view)
 *    Space                the note at the line, beside the view
 *    e, Ctrl+Enter        complete
 *    t, Shift+T           the scheduler; the date taken away
 *    y, 1 2 3 4           priority: its menu, or one of them
 *    l, v, .              labels, move to a project, the task's menu
 *    x, Esc               select the row; the selection let go
 *    Ctrl+E               change the task in its own field (Todoist's inline editor)
 *    Ctrl+] Ctrl+[, Tab   a sub-task of the one above, or lifted out
 *    Ctrl+↑ ↓, Alt+↑ ↓    up or down among its siblings in the note
 *    Shift+E              its sub-tasks folded or unfolded
 *    Shift+Delete         delete
 *    Ctrl+Shift+C         copy its link
 *    q, a, Shift+A        add a task here, at the end of the list, at its top
 *
 *  Pure: a keystroke in, an action out, and the layout does it. */

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
  | { kind: 'pick' }
  | { kind: 'unpick' }
  | { kind: 'move'; up: boolean }
  | { kind: 'indent'; deeper: boolean }
  | { kind: 'fold' }
  | { kind: 'delete' }
  | { kind: 'link' }
  | { kind: 'add'; where?: 'end' | 'top' }
  | { kind: 'edit' }

/** Which registry row asks for which action, in the order they are tried. */
const ROW_KEYS: readonly (readonly [string, RowKey])[] = [
  ['tasks.next', { kind: 'step', by: 1 }],
  ['tasks.previous', { kind: 'step', by: -1 }],
  ['tasks.complete.alt', { kind: 'tick' }],
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

/** The arrows and Escape, which belong to every list and are on no other key. */
function fixed(press: Keystroke): RowKey | null {
  if (press.ctrlKey || press.metaKey || press.altKey || press.shiftKey) return null
  if (press.key === 'ArrowDown') return { kind: 'step', by: 1 }
  if (press.key === 'ArrowUp') return { kind: 'step', by: -1 }
  if (press.key === 'Escape') return { kind: 'unpick' }
  return null
}

/** The action a key on a row asks for, or null for a key that is not one of these.
 *  `keyFor` answers the key a registry row is on now (`shortcuts.keyFor`). */
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
