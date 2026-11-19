import { portOf, runCommand, tabKindLoaded, webPages } from '@orden/contracts'
import type { IconNode } from 'lucide'
import type { FileMark } from '@orden/contracts'
import { hiddenKinds, type KindName, kindsHere } from '../../gates/src/api'
import { kindLabel } from './kind-words'
import { MARKS } from '../../marks/src/api'
import { menu, type MenuEntry } from '../../ui-kit/src/api'
import { canWriteAt } from '../../sharing/src/api'
import { workspace } from '../../workspace/src/api'

type KindLine = 'notes' | 'chats' | 'terminals' | 'browser' | 'apps'
const LINES: readonly KindLine[] = ['notes', 'chats', 'terminals', 'browser', 'apps']
const LINE_TITLES: Record<KindLine, string> = {
  notes: 'Notes',
  chats: 'Chats',
  terminals: 'Terminals',
  browser: 'Browser',
  apps: 'Apps',
}
export const lineTitle = (line: KindLine): string => LINE_TITLES[line]
export interface NewKindRow {
  kind: KindName
  line: KindLine
  label: () => string
  mark: FileMark
  icon?: IconNode
  letter: string
  make: (paneId?: string) => void
  grouped?: boolean
  others?: (paneId?: string) => Promise<MenuEntry[]>
  ready?: () => void
}
const making = () => {
  const found = portOf('terminal.making')
  return found.ok ? found.value : null
}
function inPane(paneId: string | undefined, make: () => unknown) {
  if (paneId !== undefined) workspace.focusPane(paneId)
  void make()
}
export function newKinds(): NewKindRow[] {
  return kindsHere().map((kind) => ROWS[kind]())
}
export function offeredKinds(): NewKindRow[] {
  const shown = hiddenKinds.shown
  const root = workspace.activeSpace?.root
  const chats = !root || canWriteAt(root)
  return newKinds().filter((one) => shown.includes(one.kind) && (chats || one.kind !== 'chat'))
}
const SPARK: IconNode = [
  [
    'path',
    {
      d: 'M12 3.7c.74 4.8 3.5 7.56 8.3 8.3-4.8.74-7.56 3.5-8.3 8.3-.74-4.8-3.5-7.56-8.3-8.3 4.8-.74 7.56-3.5 8.3-8.3z',
    },
  ],
]
const ROWS: Record<KindName, () => NewKindRow> = {
  note: () => ({
    kind: 'note',
    line: 'notes',
    label: () => kindLabel('note'),
    mark: 'note',
    letter: 'n',
    make: (paneId) => inPane(paneId, () => workspace.openBlank()),
  }),
  canvas: () => ({
    kind: 'canvas',
    line: 'notes',
    label: () => kindLabel('canvas'),
    mark: 'canvas',
    letter: 'c',
    make: (paneId) => inPane(paneId, () => workspace.newCanvas()),
  }),
  pages: () => ({
    kind: 'pages',
    line: 'notes',
    label: () => kindLabel('pages'),
    mark: 'pages',
    letter: 'p',
    make: (paneId) => inPane(paneId, () => workspace.newPages()),
  }),
  chat: () => ({
    kind: 'chat',
    line: 'chats',
    label: () => kindLabel('chat'),
    mark: 'chat',
    letter: 'm',
    make: (paneId) => {
      if (!__EVEN_PLUGIN__) inPane(paneId, () => tabKindLoaded('chat').then((one) => one.make?.()))
    },
  }),
  ai: () => ({
    kind: 'ai',
    line: 'chats',
    label: () => kindLabel('ai'),
    mark: 'chat',
    icon: SPARK,
    letter: 'q',
    make: (paneId) => {
      if (!__EVEN_PLUGIN__) inPane(paneId, () => runCommand('ai.tab'))
    },
  }),
  explorer: () => ({
    kind: 'explorer',
    line: 'apps',
    label: () => kindLabel('explorer'),
    mark: 'folder',
    letter: 'f',
    make: (paneId) => {
      if (!__EVEN_PLUGIN__) inPane(paneId, () => runCommand('app.explorer'))
    },
  }),
  pass: () => ({
    kind: 'pass',
    line: 'apps',
    label: () => kindLabel('pass'),
    mark: 'key',
    letter: 'k',
    make: (paneId) => {
      if (!__EVEN_PLUGIN__) inPane(paneId, () => runCommand('pass.open'))
    },
  }),
  terminal: () => terminalRow(),
  remote: () => remoteRow(),
  online: () => onlineRow(),
  application: () => ({
    kind: 'application',
    line: 'apps',
    label: () => kindLabel('application'),
    mark: 'application',
    letter: 'a',
    make: (paneId) => {
      if (!__EVEN_PLUGIN__) inPane(paneId, () => tabKindLoaded('application').then((one) => one.make?.()))
    },
  }),
  web: () => ({
    kind: 'web',
    line: 'browser',
    label: () => kindLabel('web'),
    mark: 'web',
    letter: 'w',
    make: (paneId) =>
      inPane(paneId, async () => {
        const home = await webPages().searchHome()
        if (home) workspace.openPage(home)
      }),
  }),
  private: () => ({
    kind: 'private',
    line: 'browser',
    label: () => kindLabel('private'),
    mark: 'web',
    letter: 'i',
    make: (paneId) => inPane(paneId, () => workspace.openWebsite(true)),
  }),
}
export function kindLines(kinds: readonly NewKindRow[]): NewKindRow[][] {
  return LINES.map((line) => kinds.filter((one) => one.line === line)).filter((line) => line.length > 0)
}
export function groupOf(line: readonly NewKindRow[]): NewKindRow | null {
  const [first] = line
  if (!first || line.length === 1) return first ?? null
  return {
    kind: first.kind,
    line: first.line,
    mark: first.mark,
    ...(first.icon ? { icon: first.icon } : {}),
    label: () => LINE_TITLES[first.line],
    letter: '',
    grouped: true,
    make: () => undefined,
    others: (paneId) =>
      Promise.resolve(
        line.map((one) => ({
          label: one.label(),
          icon: one.icon ?? MARKS[one.mark],
          hint: one.letter.toUpperCase(),
          run: () => one.make(paneId),
        })),
      ),
  }
}
export function fitsWhole(
  lines: readonly NewKindRow[][],
  room: { width: number; height: number },
  card: { width: number; height: number; gap: number },
  stacked: boolean,
): boolean {
  if (room.width <= 0 || card.width <= 0) return true
  const across = stacked ? 1 : Math.max(1, Math.floor((room.width + card.gap) / (card.width + card.gap)))
  const rows = lines.reduce((sum, line) => sum + Math.ceil(line.length / across), 0)
  return rows * card.height + (rows - 1) * card.gap <= room.height
}
const ONLINE: IconNode = [
  ['path', { d: 'M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z' }],
  ['path', { d: 'm7.5 11.5 2 1.75-2 1.75' }],
  ['path', { d: 'M12 15h3' }],
]
function onlineRow(): NewKindRow {
  return {
    kind: 'online',
    line: 'terminals',
    label: () => kindLabel('online'),
    mark: 'terminal',
    icon: ONLINE,
    letter: 'o',
    make: (paneId) => {
      if (!__EVEN_PLUGIN__) inPane(paneId, () => making()?.online())
    },
  }
}
function remoteRow(): NewKindRow {
  return {
    kind: 'remote',
    line: 'terminals',
    label: () => kindLabel('remote'),
    mark: 'remote',
    letter: 's',
    make: (paneId) => {
      if (!__EVEN_PLUGIN__) void making()?.pickHost(paneId)
    },
  }
}
function terminalRow(): NewKindRow {
  return {
    kind: 'terminal',
    line: 'terminals',
    label: () => kindLabel('terminal'),
    mark: 'terminal',
    letter: 'r',
    make: (paneId) => inPane(paneId, () => making()?.open()),
    others: async (paneId) =>
      (await making()?.shells((shell) => {
        inPane(paneId, () => making()?.open(shell))
      })) ?? [],
    ready: () => void making()?.warm(),
  }
}
export function showOthers(one: NewKindRow, card: Element, paneId?: string, before?: () => void): boolean {
  const others = one.others
  if (!others) return false
  const box = card.getBoundingClientRect()
  void others(paneId).then((rows) => {
    const at = new MouseEvent('contextmenu', { clientX: box.left, clientY: box.bottom })
    const choosing = rows.map((row) =>
      row === null
        ? row
        : {
            ...row,
            run: () => {
              before?.()
              row.run()
            },
          },
    )
    menu.show(at, choosing, { title: one.label() })
  })
  return true
}
