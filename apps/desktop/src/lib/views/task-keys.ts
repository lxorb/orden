import { BY_ID, CATEGORIES, SHORTCUTS, type Shortcut } from '../shortcuts/registry'

const TASK_ENTRIES: Shortcut[] = (
  [
    ['tasks.next', () => 'Next task', 'j'],
    ['tasks.previous', () => 'Previous task', 'k'],
    ['tasks.open', () => 'Open', 'Enter'],
    ['tasks.note', () => 'Open in note', 'o'],
    ['tasks.complete', () => 'Complete', 'e'],
    ['tasks.complete.alt', () => 'Complete', 'Mod-Enter'],
    ['tasks.complete.alt2', () => 'Complete', 'Space'],
    ['tasks.schedule', () => 'Schedule', 't'],
    ['tasks.undate', () => 'Remove date', 'Shift-t'],
    ['tasks.priority', () => 'Priority', 'y'],
    ['tasks.p1', () => 'Priority 1', '1'],
    ['tasks.p2', () => 'Priority 2', '2'],
    ['tasks.p3', () => 'Priority 3', '3'],
    ['tasks.p4', () => 'Priority 4', '4'],
    ['tasks.labels', () => 'Labels', 'l'],
    ['tasks.more', () => 'More', '.'],
    ['tasks.comment', () => 'Comment', 'c'],
    ['tasks.select', () => 'Select', 'x'],
    ['tasks.edit', () => 'Edit', 'Mod-e'],
    ['tasks.indent', () => 'Indent', 'Mod-]'],
    ['tasks.indent.alt', () => 'Indent', 'Tab'],
    ['tasks.outdent', () => 'Outdent', 'Mod-['],
    ['tasks.outdent.alt', () => 'Outdent', 'Shift-Tab'],
    ['tasks.up', () => 'Move up', 'Mod-ArrowUp'],
    ['tasks.up.alt', () => 'Move up', 'Alt-ArrowUp'],
    ['tasks.down', () => 'Move down', 'Mod-ArrowDown'],
    ['tasks.down.alt', () => 'Move down', 'Alt-ArrowDown'],
    ['tasks.subtasks', () => 'Sub-tasks', 'Shift-e'],
    ['tasks.delete', () => 'Delete', 'Shift-Delete'],
    ['tasks.link', () => 'Copy link', 'Mod-Shift-c'],
    ['tasks.add', () => 'Add task', 'a'],
    ['tasks.add-top', () => 'Add task at the top', 'Shift-a'],
    ['tasks.week-back', () => 'Previous week', 'Shift-ArrowLeft'],
    ['tasks.week-on', () => 'Next week', 'Shift-ArrowRight'],
  ] as const
).map(([id, label, key]) => ({
  id,
  label,
  category: 'tasks' as const,
  scope: 'panel' as const,
  key,
  contextual: true,
  ...(/\.alt\d*$/.test(id) ? { alias: true } : {}),
}))

if (!BY_ID.has('tasks.next')) {
  CATEGORIES.splice(-1, 0, { id: 'tasks', label: () => 'Tasks' })
  for (const one of TASK_ENTRIES) {
    SHORTCUTS.push(one)
    BY_ID.set(one.id, one)
  }
}
