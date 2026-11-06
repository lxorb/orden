import type { KeyOverrides } from '@orden/editor'
import { t } from '../i18n.svelte'
import type { PresetId } from './preset-ids'

export interface Preset {
  id: Exclude<PresetId, 'custom'>
  label: () => string
  keys: KeyOverrides
  vim: boolean
}

const OBSIDIAN: KeyOverrides = {
  'app.palette.alt': 'Mod-o',
  'app.palette.open': null,
  'app.commands.alt': 'Mod-p',
  'app.print': null,
  'pane.split-right': 'Mod-\\',
  'pane.split-down': 'Mod-Shift-\\',
  'format.clear': null,
  'app.graph': 'Mod-g',
  'edit.find-next': null,
  'edit.follow-link': 'Alt-Enter',
  'app.back': 'Mod-Alt-ArrowLeft',
  'app.forward': 'Mod-Alt-ArrowRight',
  'edit.delete-line': 'Mod-d',
  'app.deselect-tab': null,
  'edit.indent': 'Mod-]',
  'edit.outdent': 'Mod-[',
}

for (let index = 1; index <= 9; index++) OBSIDIAN[`app.note-${index}`] = `Mod-${index}`
for (let level = 1; level <= 6; level++) OBSIDIAN[`paragraph.heading-${level}`] = null
OBSIDIAN['canvas.frame'] = null

const NOTION: KeyOverrides = {
  'app.palette.alt': 'Mod-p',
  'app.print': null,
  'app.sidebar': 'Mod-\\',
  'format.clear': null,
  'format.code': 'Mod-e',
  'app.reading': null,
  'format.strikethrough': 'Mod-Shift-s',
  'paragraph.heading-1': 'Mod-Shift-1',
  'paragraph.heading-2': 'Mod-Shift-2',
  'paragraph.heading-3': 'Mod-Shift-3',
  'paragraph.task-list': 'Mod-Shift-4',
  'paragraph.bullet-list': 'Mod-Shift-5',
  'paragraph.ordered-list': 'Mod-Shift-6',
  'paragraph.code-block': 'Mod-Shift-8',
  'edit.duplicate-block': 'Mod-d',
  'app.deselect-tab': null,
  'edit.move-block-up': 'Mod-Shift-ArrowUp',
  'edit.move-block-down': 'Mod-Shift-ArrowDown',
}

const VSCODE: KeyOverrides = {
  'app.palette': 'Mod-p',
  'app.palette.alt': 'Shift Shift',
  'app.print': null,
  'edit.goto-line': 'Ctrl-g',
  'edit.find-next': null,
  'edit.select-word': 'Mod-d',
  'app.deselect-tab': null,
  'edit.delete-line': 'Mod-Shift-k',
  'paragraph.code-block': null,
  'edit.select-all-occurrences': 'Mod-Shift-l',
  'app.sidebar': null,
  'pane.split-right': 'Mod-\\',
  'format.clear': null,
  'edit.indent': 'Mod-]',
  'edit.outdent': 'Mod-[',
}

export const PRESETS: Preset[] = [
  { id: 'default', label: () => t('Default'), keys: {}, vim: false },
  { id: 'notion', label: () => 'Notion', keys: NOTION, vim: false },
  { id: 'obsidian', label: () => 'Obsidian', keys: OBSIDIAN, vim: false },
  { id: 'vscode', label: () => 'VS Code', keys: VSCODE, vim: false },
  { id: 'vim', label: () => 'Vim', keys: {}, vim: true },
]

export const presetById = (id: string): Preset | undefined => PRESETS.find((one) => one.id === id)
