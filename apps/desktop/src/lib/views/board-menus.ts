import {
  type Base,
  type Group,
  groupName,
  type Row,
  type SelectOption,
  type Value,
} from '@orden/bases'
import { copyText } from '../clipboard'
import { t } from '../i18n.svelte'
import { DIVIDER, type MenuEntry } from '../menu.svelte'
import { workspace } from '../workspace.svelte'
import { asOneUndo, deleteRows, duplicateRows, linkToRow, writeEach } from './act'
import { grouped } from './column-menu'
import { bare } from './columns'
import { forgottenGroup, renamedGroup, setHidden, setProperty } from './edit'
import { notePath, type Kit } from './kit'
import { clearedInBase, optionsAt, renamedInBase } from './options'

const TONES: readonly { tone: string; label: () => string }[] = [
  { tone: '1', label: () => t('Red') },
  { tone: '2', label: () => t('Orange') },
  { tone: '3', label: () => t('Yellow') },
  { tone: '4', label: () => t('Green') },
  { tone: '5', label: () => t('Teal') },
  { tone: '6', label: () => t('Violet') },
]

function writeOptions(kit: Kit, property: string, next: SelectOption[]) {
  kit.change((base) =>
    setProperty(base, bare(property), { options: next.length ? next : undefined }),
  )
}

export function renameOption(kit: Kit, property: string, from: string, to: string): boolean {
  const base = kit.live.base
  const value = to.trim()
  if (!base || !value || value === from) return false
  const options = optionsAt(base, property)
  if (options.some((one) => one.value === value)) return false
  const next = options.map((one) => (one.value === from ? { ...one, value } : one))
  const listed = next.some((one) => one.value === value)
  const notes = renamedInBase(base, kit.live.rows, kit.live.context, property, from, value)
  void asOneUndo([
    () =>
      kit.changed((one) =>
        renamedGroup(
          listed ? setProperty(one, bare(property), { options: next }) : one,
          property,
          from,
          value,
        ),
      ),
    () => writeEach(notes),
  ])
  return true
}

function toneOption(kit: Kit, property: string, value: string, tone: string | null) {
  const base = kit.live.base
  if (!base) return
  writeOptions(
    kit,
    property,
    optionsAt(base, property).map((one) => {
      if (one.value !== value) return one
      const next: SelectOption = { value: one.value }
      if (one.group) next.group = one.group
      if (tone !== null) next.tone = tone
      return next
    }),
  )
}

function addAsOption(kit: Kit, property: string, value: string) {
  const base = kit.live.base
  if (!base) return
  const options = optionsAt(base, property)
  if (options.some((one) => one.value === value)) return
  writeOptions(kit, property, [...options, { value, tone: String((options.length % 6) + 1) }])
}

function mergeInto(kit: Kit, property: string, from: string, to: string) {
  const base = kit.live.base
  if (!base || from === to) return
  const notes = renamedInBase(base, kit.live.rows, kit.live.context, property, from, to)
  void asOneUndo([
    () => kit.changed((one) => renamedGroup(one, property, from, to, true)),
    () => writeEach(notes),
  ])
}

function deleteOption(kit: Kit, property: string, value: string) {
  const base = kit.live.base
  if (!base) return
  const next = optionsAt(base, property).filter((one) => one.value !== value)
  const notes = clearedInBase(base, kit.live.rows, kit.live.context, property, value)
  void asOneUndo([
    () =>
      kit.changed((one) =>
        setProperty(forgottenGroup(one, property, value), bare(property), {
          options: next.length ? next : undefined,
        }),
      ),
    () => writeEach(notes),
  ])
}

export interface ColumnAsk {
  kit: Kit
  event: MouseEvent
  property: string
  group: Group
  name: string
  option: SelectOption | undefined
  unlisted: boolean
  names: readonly string[]
  rename: () => void
  move: (step: -1 | 1) => void
  extra?: MenuEntry[]
}

export function columnEntries(ask: ColumnAsk): MenuEntry[] {
  const { kit, event, property, group, option, unlisted, names } = ask
  const name = groupName(group.key)
  const base = kit.live.base
  const options = base ? optionsAt(base, property) : []
  const at = names.indexOf(name)
  const valued = group.key !== null && name !== ''
  return [
    ...(ask.extra ?? []),
    ...(option || unlisted ? [{ label: t('Rename'), run: ask.rename }] : []),
    ...(option
      ? [
          grouped(event, t('Colour'), () =>
            Promise.resolve([
              {
                label: t('None'),
                checked: option.tone === undefined,
                run: () => toneOption(kit, property, name, null),
              },
              ...TONES.map((one) => ({
                label: one.label(),
                checked: option.tone === one.tone,
                run: () => toneOption(kit, property, name, one.tone),
              })),
            ]),
          ),
        ]
      : []),
    ...(unlisted && valued
      ? [
          { label: t('Add as option'), run: () => addAsOption(kit, property, name) },
          ...(options.length
            ? [
                grouped(event, t('Merge into'), () =>
                  Promise.resolve(
                    options.map((one) => ({
                      label: one.value,
                      run: () => mergeInto(kit, property, name, one.value),
                    })),
                  ),
                ),
              ]
            : []),
        ]
      : []),
    {
      label: t('Hide'),
      run: () => kit.change((one, view) => setHidden(one, view, name, true)),
    },
    DIVIDER,
    { label: t('Move left'), disabled: at <= 0, run: () => ask.move(-1) },
    {
      label: t('Move right'),
      disabled: at === -1 || at >= names.length - 1,
      run: () => ask.move(1),
    },
    ...(option
      ? [
          DIVIDER,
          {
            label: t('Delete option'),
            danger: true,
            run: () => deleteOption(kit, property, name),
          },
        ]
      : []),
  ]
}

export interface CardAsk {
  kit: Kit
  event: MouseEvent
  row: Row
  targets: readonly { key: Value; name: string; here: boolean }[]
  move: (key: Value) => void
}

function noteLink(row: Row): string {
  return `[[${row.path.replace(/\.md$/i, '')}]]`
}

export function cardEntries(ask: CardAsk): MenuEntry[] {
  const { kit, event, row, targets } = ask
  const path = notePath(row)
  return [
    { label: t('Open'), run: () => kit.choose(row) },
    { label: t('Open in new tab'), run: () => kit.open(row, 'tab') },
    DIVIDER,
    ...(targets.length
      ? [
          grouped(event, t('Move to'), () =>
            Promise.resolve(
              targets.map((one) => ({
                label: one.name,
                checked: one.here,
                disabled: one.here,
                run: () => ask.move(one.key),
              })),
            ),
          ),
        ]
      : []),
    {
      label: t('Duplicate'),
      run: () => {
        if (row.task) void duplicateRows([row])
        else if (path) void workspace.duplicate(path)
      },
    },
    {
      label: t('Copy link'),
      run: () => {
        if (row.task) void linkToRow(row).then((link) => (link ? copyText(link) : undefined))
        else void copyText(noteLink(row))
      },
    },
    DIVIDER,
    {
      label: t('Delete'),
      danger: true,
      run: () => {
        if (row.task) void deleteRows([row])
        else if (path) void workspace.remove(path, false)
      },
    },
  ]
}

export function optionFor(
  base: Base | null,
  property: string,
  value: Value,
): SelectOption | undefined {
  if (!base || typeof value !== 'string') return undefined
  return optionsAt(base, property).find((one) => one.value === value)
}
