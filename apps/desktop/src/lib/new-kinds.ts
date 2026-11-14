import type { IconNode } from 'lucide'
import type { FileMark } from './file-mark'
import { hiddenKinds, type KindName, kindsHere } from './settings.svelte'
import { kindLabel } from './kind-words'
import { menu, type MenuEntry } from './menu.svelte'
import { hostPicking, openOnline, openTerminal, shellRows, shells } from './terminal/src/api'
import { canWriteAt } from './sharing/src/api'
import { workspace } from './workspace.svelte'

type KindLine = 'write' | 'run' | 'web'

export interface NewKindRow {
  kind: KindName
  line: KindLine
  label: () => string
  mark: FileMark
  icon?: IconNode
  letter: string
  make: (paneId?: string) => void
  others?: (paneId?: string) => Promise<MenuEntry[]>
  ready?: () => void
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

const ROWS: Record<KindName, () => NewKindRow> = {
  note: () => ({
    kind: 'note',
    line: 'write',
    label: () => kindLabel('note'),
    mark: 'note',
    letter: 'n',
    make: (paneId) => inPane(paneId, () => workspace.openBlank()),
  }),
  canvas: () => ({
    kind: 'canvas',
    line: 'write',
    label: () => kindLabel('canvas'),
    mark: 'canvas',
    letter: 'c',
    make: (paneId) => inPane(paneId, () => workspace.newCanvas()),
  }),
  pages: () => ({
    kind: 'pages',
    line: 'write',
    label: () => kindLabel('pages'),
    mark: 'pages',
    letter: 'p',
    make: (paneId) => inPane(paneId, () => workspace.newPages()),
  }),
  chat: () => ({
    kind: 'chat',
    line: 'write',
    label: () => kindLabel('chat'),
    mark: 'chat',
    letter: 'm',
    make: (paneId) => {
      if (!__EVEN_PLUGIN__)
        inPane(paneId, () => import('./chats/view/open').then((one) => one.makeChat()))
    },
  }),
  explorer: () => ({
    kind: 'explorer',
    line: 'run',
    label: () => kindLabel('explorer'),
    mark: 'folder',
    letter: 'f',
    make: (paneId) => {
      if (!__EVEN_PLUGIN__)
        inPane(paneId, () => import('./explorer/src/api').then((one) => one.openExplorer()))
    },
  }),
  pass: () => ({
    kind: 'pass',
    line: 'run',
    label: () => kindLabel('pass'),
    mark: 'key',
    letter: 'k',
    make: (paneId) => {
      if (!__EVEN_PLUGIN__)
        inPane(paneId, () => import('./pass-sync/src/api').then((one) => one.openPass()))
    },
  }),
  terminal: () => terminalRow(),
  remote: () => remoteRow(),
  online: () => onlineRow(),
  application: () => ({
    kind: 'application',
    line: 'run',
    label: () => kindLabel('application'),
    mark: 'application',
    letter: 'a',
    make: (paneId) => {
      if (!__EVEN_PLUGIN__)
        inPane(paneId, () =>
          import('./apps/src/api').then(({ makeApplication }) => makeApplication()),
        )
    },
  }),
  web: () => ({
    kind: 'web',
    line: 'web',
    label: () => kindLabel('web'),
    mark: 'web',
    letter: 'w',
    make: (paneId) =>
      inPane(paneId, () =>
        import('./web-tab/search-engine.svelte').then((one) =>
          workspace.openPage(one.searchEngine.home),
        ),
      ),
  }),
  private: () => ({
    kind: 'private',
    line: 'web',
    label: () => kindLabel('private'),
    mark: 'web',
    letter: 'i',
    make: (paneId) => inPane(paneId, () => workspace.openWebsite(true)),
  }),
}

export function kindLines(kinds: readonly NewKindRow[]): NewKindRow[][] {
  const lines: KindLine[] = ['write', 'run', 'web']
  return lines
    .map((line) => kinds.filter((one) => one.line === line))
    .filter((line) => line.length > 0)
}

const ONLINE: IconNode = [
  ['path', { d: 'M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z' }],
  ['path', { d: 'm7.5 11.5 2 1.75-2 1.75' }],
  ['path', { d: 'M12 15h3' }],
]

function onlineRow(): NewKindRow {
  return {
    kind: 'online',
    line: 'run',
    label: () => kindLabel('online'),
    mark: 'terminal',
    icon: ONLINE,
    letter: 'o',
    make: (paneId) => {
      if (!__EVEN_PLUGIN__) inPane(paneId, () => openOnline())
    },
  }
}

function remoteRow(): NewKindRow {
  return {
    kind: 'remote',
    line: 'run',
    label: () => kindLabel('remote'),
    mark: 'remote',
    letter: 's',
    make: (paneId) => {
      if (!__EVEN_PLUGIN__) void hostPicking().then(({ hostPicker }) => hostPicker.show(paneId))
    },
  }
}

function terminalRow(): NewKindRow {
  return {
    kind: 'terminal',
    line: 'run',
    label: () => kindLabel('terminal'),
    mark: 'terminal',
    letter: 'r',
    make: (paneId) => inPane(paneId, () => openTerminal()),
    others: (paneId) =>
      shellRows((shell) => {
        inPane(paneId, () => openTerminal(shell.id))
      }),
    ready: () => void shells.ask(),
  }
}

export function showOthers(
  one: NewKindRow,
  card: Element,
  paneId?: string,
  before?: () => void,
): boolean {
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
