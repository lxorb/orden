import { identifier } from '../identifier'
import type { MenuEntry } from '../ui-kit/src/api'
import { type Tab, workspace } from '../workspace.svelte'
import { type Shell, shellName, shells } from './shells.svelte'
import { hostIdOf, startingFolder, writeSpec } from './spec'

interface Where {
  folder?: string | null
  beside?: string
  activate?: boolean
}

export async function openTerminal(shellId?: string, where: Where = {}): Promise<Tab | null> {
  const host = shellId === undefined ? null : hostIdOf(shellId)
  if (host !== null) {
    const { openRemote } = await import('../remote/open')
    await openRemote(host, where.beside === undefined ? {} : { beside: where.beside })
    return null
  }

  const list = await shells.ask()
  const shell = list.find((one) => one.id === shellId) ?? shells.chosen
  if (!shell) return null

  const folder = where.folder === undefined ? hereFolder() : where.folder
  const text = writeSpec({ shell: shell.id, folder, key: identifier(), name: null })
  return workspace.openUnsaved(
    'terminal',
    text,
    shellName(shell),
    where.beside ?? null,
    where.activate ?? true,
  )
}

function hereFolder(): string | null {
  const showing = workspace.showing(workspace.panes.focusedId)?.path ?? null
  const roots = workspace.spaces.map((space) => space.root)
  return startingFolder(showing, workspace.activeSpace?.root ?? null, roots)
}

export async function shellRows(make: (shell: Shell) => void): Promise<MenuEntry[]> {
  const list = await shells.ask()
  const chosen = shells.chosen?.id

  return list.map((shell) => ({
    label: shellName(shell),
    ...(shell.id === chosen ? { checked: true } : {}),
    run: () => make(shell),
  }))
}
