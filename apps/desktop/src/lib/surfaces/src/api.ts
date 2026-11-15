import type { Component } from 'svelte'
import {
  commandRowsLoaded,
  type FindBarProps,
  type OpenHow,
  type SheetId,
  type SheetsPort,
  type SurfaceId,
  surfaceLoad,
} from '@orden/contracts'
import type { Tab } from '../../documents/src/api'
import type { NoteGraph } from '../../graph/src/api'
import { loadHistory } from '../../history/src/api'
import { storedText } from '../../platform/src/api'
import { held, type Latched, latched } from '../../ui-kit/src/api'

type Loaded<T> = () => Promise<{ default: T }>
type Shown = Loaded<Component>
type TabShown = Loaded<Component<{ tab: Tab; focused: boolean }>>
type TabOnly = Loaded<Component<{ tab: Tab }>>

const from = (id: SurfaceId) => () => surfaceLoad(id)

export const canvasSurface = held(from('canvas') as TabShown)

export const graphSurface = held(
  from('graph') as Loaded<
    Component<{
      graph: NoteGraph
      current?: string | null
      whole?: boolean
      focused?: boolean
      onopen?: ((path: string, how: OpenHow) => void) | undefined
      onescape?: (() => void) | undefined
    }>
  >,
)

export const viewSurface = held(from('view') as TabOnly)
export const tasksPanel = held(from('tasks') as Shown)
export const todosBoard = held(from('todos') as Shown)
export const chatSurface = held(from('channel') as TabOnly)
export const chatsPanel = held(from('chats') as Shown)
export const timePanel = held(from('time-panel') as Shown)
export const timeSurface = held(from('time') as TabOnly)
export const pagesSurface = held(from('pages') as TabShown)
export const webSurface = held(from('web') as TabShown)
export const terminalSurface = held(from('terminal') as TabShown)
export const applicationSurface = held(from('application') as TabOnly)
export const explorerSurface = held(from('explorer') as TabShown)
export const passSurface = held(from('pass') as TabShown)
export const passFill = held(from('pass-fill') as Loaded<Component<{ bubble: unknown }>>)
export const emptySurface = held(() => import('../../NewHere.svelte'))
export const readingSurface = held(from('reading') as TabShown)

export const lockScreen = held(() =>
  __EVEN_PLUGIN__
    ? Promise.reject(new Error('nothing is protected in the Even Realities plugin'))
    : import('../../sharing/src/api').then((one) => one.loadLockScreen()),
)

export const findBar = held(from('find-bar') as Loaded<Component<FindBarProps>>)

export const takeoverBar = held(
  from('takeover-bar') as Loaded<Component<{ id: string; reason: string }>>,
)
export const agentRows = held(
  from('agent-rows') as Loaded<Component<{ open: string | null; onopen: (agent: string) => void }>>,
)
export const agentSession = held(from('agent-session') as Loaded<Component<{ agent: string }>>)
export const sparkMark = held(
  from('spark') as Loaded<Component<{ colour: string; turning?: boolean; paused?: boolean }>>,
)
export const searchPanel = held(() => import('../../SearchPanel.svelte'))
export const phoneTabsBar = held(from('phone-tabs') as Loaded<Component<{ unread?: boolean }>>)
export const phoneYou = held(from('phone-you') as Loaded<Component<{ scratchpad: () => void }>>)

export const settingsSurface = held(from('settings') as Shown)

export const pagesNavigator = held(from('pages-navigator') as Shown)
export const linksPanel = held(() => import('../../Links.svelte'))
export const askPanel = held(
  from('ask') as Loaded<
    Component<{ ongoto?: ((line: number) => void) | undefined; wide?: boolean }>
  >,
)
export const archiveSection = held(from('archive') as Shown)
export const archivedStrip = held(from('archived-strip') as Loaded<Component<{ path: string }>>)
export const historySheet = latched(loadHistory)

export const shareSheet = latched(() =>
  import('../../accounts-ui/src/api').then((one) => one.loadShareSheet()),
)

export const publishSheet = latched(from('publish') as Shown)
export const exportSheet = latched(from('export') as Shown)
export const importSheet = latched(from('import') as Shown)
export const iconPicker = latched(() => import('../../IconPicker.svelte'))
export const rewriteSheet = latched(from('rewrite') as Shown)
export const quickSheet = latched(from('quick-question') as Shown)
export const scratchpadCard = held(
  from('scratchpad-card') as Loaded<Component<{ docked?: boolean }>>,
)
export const recordingPill = latched(from('recording-pill') as Shown)

export const joinPending = latched(() =>
  import('../../sharing/src/api').then((one) => one.loadJoinPending()),
)

export const renameNotice = latched(() => import('../../RenameNotice.svelte'))
export const keysMovedNotice = latched(from('keys-moved') as Shown)

export const outsideNotice = latched(() => {
  if (__EVEN_PLUGIN__) throw new Error('no spaces folder in the Even Realities plugin')
  return import('../../OutsideFolder.svelte')
})

export const CRASH_REPORTS = 'orden:crash-reports'

export const CRASHES_ASKED = 'orden:crash-reports-told'

export const crashAskDue = (): boolean =>
  storedText(CRASHES_ASKED) === null && storedText(CRASH_REPORTS) === null

export const crashAsk = latched(from('crash-ask') as Shown)

export const appMenuRows = held(async () => {
  const [{ appMenu }] = await Promise.all([import('../../app-menu'), commandRowsLoaded()])
  return { default: appMenu }
})

export const undoToastNotice = latched(from('undo-toast') as Shown)
export const spaceSound = latched(() => import('../../SpaceSound.svelte'))
export const soundMark = held(() => import('../../SoundMark.svelte'))
export const privateMark = held(from('private-mark') as Loaded<Component<{ large?: boolean }>>)

export const terminalMark = held(
  from('terminal-mark') as Loaded<
    Component<{
      tab: Pick<Tab, 'doc' | 'running'> & { id?: string; path?: string | null }
    }>
  >,
)

export const syncMark = latched(() =>
  __EVEN_PLUGIN__ ? Promise.reject(new Error('v1 only')) : import('../../SyncMark.svelte'),
)

export const spacePickerDialog = latched(() => import('../../SpacePicker.svelte'))
export const tabOverviewLayer = latched(from('overview') as Shown)
export const hostPickerDialog = latched(from('host-picker') as Shown)
export const spacesMenu = held(() => import('../../SpaceMenu.svelte'))
export const promptSheet = latched(() => import('../../PromptSheet.svelte'))

export const contextMenu = latched(() =>
  import('../../context-menu/src/api').then((one) => one.loadContextMenu()),
)

export const formatBar = latched(() => import('../../FormatBar.svelte'))

export const signInSheet = latched(() =>
  import('../../accounts-ui/src/api').then((one) => ({ default: one.SignIn })),
)

export const joinSheet = latched(() =>
  import('../../sharing/src/api').then((one) => one.loadJoinSheet()),
)

export const feedbackSheet = latched(() => import('../../FeedbackSheet.svelte'))

export function showFeedback(): void {
  void import('../../feedback/src/api').then(({ feedback }) => {
    feedback.show()
    void feedbackSheet.ask()
  })
}

export const quickAddSheet = latched(from('quick-add') as Shown)

export const fillBar = held(() => import('../../tab-fill/src/api').then((one) => one.loadFillBar()))
export const fullscreenWayOut = held(() => import('../../FullscreenLeave.svelte'))

export const guestCorner = held(() =>
  import('../../collab/src/api').then((one) => one.loadGuestCorner()),
)

export const firstSpaceDoor = () =>
  __EVEN_PLUGIN__
    ? Promise.reject(new Error('no fresh start in the Even Realities plugin'))
    : import('../../first-space.svelte')

const SHEETS: Readonly<Record<SheetId, Latched<unknown>>> = {
  export: exportSheet,
  'host-picker': hostPickerDialog,
  import: importSheet,
  overview: tabOverviewLayer,
  publish: publishSheet,
  'quick-question': quickSheet,
  'recording-pill': recordingPill,
  rewrite: rewriteSheet,
  'space-picker': spacePickerDialog,
  'space-sound': spaceSound,
  'sync-mark': syncMark,
  'undo-toast': undoToastNotice,
}

export const sheets: SheetsPort = {
  ask: (id) => SHEETS[id].ask().then(() => undefined),
}
