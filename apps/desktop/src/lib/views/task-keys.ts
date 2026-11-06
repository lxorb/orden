import { t } from '../i18n.svelte'
import { BY_ID, CATEGORIES, SHORTCUTS, type Shortcut } from '../shortcuts/registry'

const TASK_ENTRIES: Shortcut[] = (
  [
    ['tasks.next', () => t('Next task'), 'j'],
    ['tasks.previous', () => t('Previous task'), 'k'],
    ['tasks.open', () => t('Open'), 'Enter'],
    ['tasks.note', () => t('Open in note'), 'o'],
    ['tasks.complete', () => t('Complete'), 'e'],
    ['tasks.complete.alt', () => t('Complete'), 'Mod-Enter'],
    ['tasks.complete.alt2', () => t('Complete'), 'Space'],
    ['tasks.schedule', () => t('Schedule'), 't'],
    ['tasks.undate', () => t('Remove date'), 'Shift-t'],
    ['tasks.priority', () => t('Priority'), 'y'],
    ['tasks.p1', () => t('Priority {level}', { level: 1 }), '1'],
    ['tasks.p2', () => t('Priority {level}', { level: 2 }), '2'],
    ['tasks.p3', () => t('Priority {level}', { level: 3 }), '3'],
    ['tasks.p4', () => t('Priority {level}', { level: 4 }), '4'],
    ['tasks.labels', () => t('Labels'), 'l'],
    ['tasks.move', () => t('Move to'), 'v'],
    ['tasks.more', () => t('More'), '.'],
    ['tasks.comment', () => t('Comment'), 'c'],
    ['tasks.select', () => t('Select'), 'x'],
    ['tasks.edit', () => t('Edit'), 'Mod-e'],
    ['tasks.indent', () => t('Indent'), 'Mod-]'],
    ['tasks.indent.alt', () => t('Indent'), 'Tab'],
    ['tasks.outdent', () => t('Outdent'), 'Mod-['],
    ['tasks.outdent.alt', () => t('Outdent'), 'Shift-Tab'],
    ['tasks.up', () => t('Move up'), 'Mod-ArrowUp'],
    ['tasks.up.alt', () => t('Move up'), 'Alt-ArrowUp'],
    ['tasks.down', () => t('Move down'), 'Mod-ArrowDown'],
    ['tasks.down.alt', () => t('Move down'), 'Alt-ArrowDown'],
    ['tasks.subtasks', () => t('Sub-tasks'), 'Shift-e'],
    ['tasks.delete', () => t('Delete'), 'Shift-Delete'],
    ['tasks.link', () => t('Copy link'), 'Mod-Shift-c'],
    ['tasks.add', () => t('Add task'), 'a'],
    ['tasks.add-top', () => t('Add task at the top'), 'Shift-a'],
    ['tasks.week-back', () => t('Previous week'), 'Shift-ArrowLeft'],
    ['tasks.week-on', () => t('Next week'), 'Shift-ArrowRight'],
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
  CATEGORIES.splice(-1, 0, { id: 'tasks', label: () => t('Tasks') })
  for (const one of TASK_ENTRIES) {
    SHORTCUTS.push(one)
    BY_ID.set(one.id, one)
  }
}
