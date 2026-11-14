import { agentMarks } from '../agent-marks.svelte'
import { copyText } from '../ui-controls/src/api'
import {
  archiveEntry,
  DIVIDER,
  iconEntries,
  shareEntry,
  stackEntries,
  type MenuEntry,
} from '../menu.svelte'
import { iconChoice } from '../icon-choice.svelte'
import { bookmarkAll, webDataEntry } from '../row-menu'
import { shortcuts } from '../shortcuts.svelte'
import { shownName, nameOf, withinSpace } from '../platform/src/api'
import { toggleFill } from '../tab-fill/fill'
import { openTerminal, shellRows, readSpec, openOnline } from '../terminal/src/api'
import { isOnlineTab } from '../online-terms/src/api'
import { pages } from '../web-tab/pages.svelte'
import { viewport } from '../ui-kit/src/api'
import { workspace, type Tab } from '../workspace.svelte'
import { protectEntries } from '../sharing/src/api'
import { closeAfterLabel } from '../workspace/closing-around'
import { isUnsaved } from '../workspace/drafts'
import { askPlace } from '../save-place/src/api'
import { duplicateTab, moveToOtherPane, renameFromTab, renamesFromTab } from './ops'
import { spaceEntry } from './to-space'
import { unloadEntries } from './unloading.svelte'
import { chosen, duplicateMany, moveManyToOtherPane } from './picking.svelte'

function movedToSpace(tabs: readonly Tab[]): MenuEntry[] {
  return viewport.touch ? spaceEntry(tabs) : []
}

function agentEntries(tab: Tab): MenuEntry[] {
  const worn = agentMarks.on[tab.id]
  const act = agentMarks.act
  if (!worn || !act) return []

  return [
    worn.stopped
      ? { label: 'Resume', run: () => act(tab.id, 'resume') }
      : { label: 'Stop', run: () => act(tab.id, 'stop') },
    DIVIDER,
  ]
}

function keepEntry(tab: Tab): MenuEntry[] {
  if (tab.id !== workspace.previewTabId) return []
  return [{ label: 'Keep open', run: () => workspace.keep(tab.id) }]
}

function paneEntries(tab: Tab): MenuEntry[] {
  const entries: MenuEntry[] = []

  if (workspace.canSplit('row', tab.id)) {
    entries.push({
      label: 'Split right',
      hint: shortcuts.hint('pane.split-right'),
      run: () => workspace.split('row', tab.id),
    })
  }
  if (workspace.canSplit('column', tab.id)) {
    entries.push({
      label: 'Split down',
      hint: shortcuts.hint('pane.split-down'),
      run: () => workspace.split('column', tab.id),
    })
  }
  if (workspace.canMoveToOtherPane(tab.id)) {
    entries.push({
      label: 'Move to other pane',
      hint: shortcuts.hint('pane.move-tab'),
      run: () => moveToOtherPane(tab.id),
    })
  }
  if (!viewport.touch) {
    entries.push({
      label: workspace.panes.fills === null ? 'Full window' : 'Leave full window',
      hint: shortcuts.hint('app.fill-tab'),
      run: () => void toggleFill(tab.id),
    })
  }

  return entries.length ? [...entries, DIVIDER] : []
}

function readingEntry(tab: Tab): MenuEntry[] {
  if (tab.kind !== 'note') return []

  return [
    {
      label: tab.reading ? 'Leave reading' : 'Reading',
      hint: shortcuts.hint('app.reading'),
      run: () => workspace.toggleReading(tab.id),
    },
    DIVIDER,
  ]
}

function pageEntries(tab: Tab): MenuEntry[] {
  if (tab.kind !== 'web') return []

  const url = pages.addressOf(tab.id) ?? tab.address ?? null
  return [
    {
      label: 'Reload',
      disabled: url === null,
      run: () => void pages.step(tab.id, 'reload'),
    },
    {
      label: 'Copy link',
      disabled: url === null,
      run: () => {
        if (url !== null) void copyText(url)
      },
    },
    {
      label: pages.of(tab.id).muted ? 'Unmute site' : 'Mute site',
      hint: shortcuts.hint('web.mute'),
      disabled: url === null,
      run: () => void muting(tab.id),
    },
    ...(tab.path === null ? [] : webDataEntry({ path: tab.path, is_dir: false })),
    DIVIDER,
  ]
}

async function muting(tabId: string): Promise<void> {
  const { muteSite } = await import('../web-tab/mute')
  await muteSite(tabId, !pages.of(tabId).muted)
}

function shellEntries(tab: Tab): MenuEntry[] {
  if (__EVEN_PLUGIN__ || tab.kind !== 'terminal') return []

  if (isOnlineTab(tab)) {
    return [
      {
        label: 'Open another',
        run: () => void openOnline(true),
      },
      ...iconEntries(tab.path),
      DIVIDER,
    ]
  }

  const spec = readSpec(tab.doc)
  const beside = { folder: spec?.folder ?? null, beside: tab.id }
  return [
    {
      label: 'Open another',
      run: () => void openTerminal(spec?.shell, beside),
      more: () => shellRows((shell) => void openTerminal(shell.id, beside)),
    },
    ...(spec
      ? [
          { label: 'Choose an icon', run: () => iconChoice.terminal(tab.id) },
          ...(spec.icon
            ? [
                {
                  label: 'Remove icon',
                  run: () =>
                    void import('../icon-target').then((one) =>
                      one.setTerminalIcon(tab.id, null, null),
                    ),
                },
              ]
            : []),
        ]
      : []),
    DIVIDER,
  ]
}

function tabEntries(tab: Tab): MenuEntry[] {
  return [
    ...(renamesFromTab(tab)
      ? [
          {
            label: 'Rename',
            hint: shortcuts.hint('tabs.rename'),
            run: () => renameFromTab(tab.id),
          },
        ]
      : []),
    ...(workspace.canDuplicateTab(tab) && tab.kind !== 'terminal'
      ? [
          {
            label: 'Duplicate',
            hint: shortcuts.hint('app.duplicate-tab'),
            run: () => duplicateTab(tab.id),
          },
        ]
      : []),
    ...bookmarkAll(tab.path === null ? [] : [tab.path]),
  ]
}

function inListEntry(tab: Tab): MenuEntry[] {
  const root = workspace.activeSpace?.root
  const path = tab.path
  if (path === null || root === undefined || withinSpace(root, path) === null) return []

  return [
    {
      label: 'Show in the file list',
      hint: shortcuts.hint('app.reveal'),
      run: () => workspace.revealNote(path),
    },
  ]
}

function reopenEntry(): MenuEntry[] {
  if (!workspace.closed.any) return []

  return [
    {
      label: 'Reopen closed tab',
      hint: shortcuts.hint('app.reopen'),
      run: () => void workspace.reopenClosed(),
    },
  ]
}

function closeEntries(tab: Tab): MenuEntry[] {
  return [
    {
      label: 'Close',
      hint: shortcuts.hint('app.close'),
      run: () => void workspace.closeAsking(tab.id),
    },
    {
      label: 'Close others',
      disabled: workspace.closesAround(tab.id, 'others') === 0,
      run: () => void workspace.closeAround(tab.id, 'others'),
    },
    {
      label: closeAfterLabel(),
      hint: shortcuts.hint('app.close-right'),
      disabled: workspace.closesAround(tab.id, 'right') === 0,
      run: () => void workspace.closeAround(tab.id, 'right'),
    },
    {
      label: 'Close all',
      hint: shortcuts.hint('app.close-all'),
      disabled: workspace.closesAround(tab.id, 'all') === 0,
      run: () => void workspace.closeAround(tab.id, 'all'),
    },
    ...reopenEntry(),
  ]
}

function saveEntry(tab: Tab): MenuEntry[] {
  if (!isUnsaved(tab.note)) return []

  return [{ label: 'Save', hint: shortcuts.saveHint, run: () => askPlace(tab.id) }, DIVIDER]
}

function pickMenu(tabs: readonly Tab[], paneId: string): MenuEntry[] {
  const ids = tabs.map((one) => one.id)
  const web = tabs.filter((one) => one.kind === 'web')
  const last = tabs.at(-1)?.id ?? ''
  const others = workspace.tabsIn(paneId).filter((one) => !ids.includes(one.id))
  const copies = tabs.every((one) => workspace.canDuplicateTab(one) && one.kind !== 'terminal')
  const paths = tabs.flatMap((one) => (one.path === null ? [] : [one.path]))

  return [
    ...(web.length
      ? [
          {
            label: 'Reload',
            run: () => {
              for (const one of web) void pages.step(one.id, 'reload')
            },
          },
          DIVIDER,
        ]
      : []),
    ...(copies
      ? [
          {
            label: 'Duplicate',
            hint: shortcuts.hint('app.duplicate-tab'),
            run: () => duplicateMany(ids),
          },
        ]
      : []),
    ...bookmarkAll(paths),
    ...movedToSpace(tabs),
    DIVIDER,
    {
      label: 'Close',
      hint: shortcuts.hint('app.close'),
      run: () => void workspace.closeMany(ids),
    },
    {
      label: 'Close others',
      disabled: others.length === 0,
      run: () => void workspace.closeMany(others.map((one) => one.id)),
    },
    {
      label: closeAfterLabel(),
      hint: shortcuts.hint('app.close-right'),
      disabled: workspace.closesAround(last, 'right') === 0,
      run: () => void workspace.closeAround(last, 'right'),
    },
    {
      label: 'Close all',
      hint: shortcuts.hint('app.close-all'),
      disabled: workspace.closesAround(last, 'all') === 0,
      run: () => void workspace.closeAround(last, 'all'),
    },
    ...reopenEntry(),
    ...(workspace.canMoveToOtherPane(last)
      ? [
          DIVIDER,
          {
            label: 'Move to other pane',
            hint: shortcuts.hint('pane.move-tab'),
            run: () => moveManyToOtherPane(ids),
          },
        ]
      : []),
  ]
}

function pickOf(tab: Tab, paneId: string): Tab[] {
  const many = chosen.of(paneId)
  return many.some((one) => one.id === tab.id) ? many : []
}

export function tabMenuTitle(tab: Tab, paneId: string): string {
  const many = pickOf(tab, paneId).length
  return many ? (many === 1 ? '1 tab' : `${many} tabs`) : tab.shown
}

export function trailMenu(tab: Tab): MenuEntry[] {
  return tab.trail
    .slice(0, tab.at)
    .map((path, at) => ({ label: shownName(nameOf(path)), at }))
    .reverse()
    .map((row) => ({ label: row.label, run: () => void workspace.walk(row.at, tab.id) }))
}

export function tabMenu(tab: Tab, paneId: string): MenuEntry[] {
  const many = pickOf(tab, paneId)
  if (many.length) return pickMenu(many, paneId)

  return [
    ...agentEntries(tab),
    ...saveEntry(tab),
    ...readingEntry(tab),
    ...pageEntries(tab),
    ...shellEntries(tab),
    ...tabEntries(tab),
    ...inListEntry(tab),
    ...movedToSpace([tab]),
    ...archiveEntry(tab.path),
    ...protectEntries(tab.path),
    DIVIDER,
    ...unloadEntries(tab),
    DIVIDER,
    ...closeEntries(tab),
    DIVIDER,
    ...shareEntry(tab.path),
    ...stackEntries(paneId),
    ...paneEntries(tab),
    ...keepEntry(tab),
  ]
}
