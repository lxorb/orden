import { mayStop } from '@orden/contracts'
import { startup } from '../../launch/src/api'
import { anythingRuns, GIVE_UP, settleUp, stillWriting, trayKeeper, writeOwed, written } from '../../parting/src/api'
import { currentWindow, internal, isDesktop, isMobile, waited } from '../../platform/src/api'
import { installStaged, ready, settledForInstaller } from '../../updates/src/api'
import { agentMarks } from './agent-marks.svelte'
import { workspace } from './workspace.svelte'

interface Quitting {
  quitAsked(): Promise<void>
  answerQuitting(window: string): Promise<void>
  holdToQuit(): Promise<void>
}
export async function guardClose(quitting: () => Promise<Quitting>): Promise<void> {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      if (isMobile) settle()
      else save()
    } else if (isMobile) void workspace.loadTree()
  })
  addEventListener('pagehide', () => settle())
  const window = await currentWindow()
  await window.onCloseRequested((event) => void onClose(event, window))
  if (!__EVEN_PLUGIN__ && isDesktop) {
    const { getCurrentWindow } = await import('@tauri-apps/api/window')
    const own = getCurrentWindow()
    await own.listen('orden://quit', () => void onQuit(window))
    await own.listen('orden://update-settle', () => {
      settle()
      void settledForInstaller(owed)
    })
    await own.listen('orden://quit-ask', () => void (async () => (await quitting()).quitAsked())())
    await own.listen('orden://quit-hold', () => void (async () => (await quitting()).holdToQuit())())
    void startup.turn('right').then(async () => (await quitting()).answerQuitting(own.label))
  }
}
interface Closing {
  preventDefault(): void
}
interface Closable {
  destroy(): Promise<void>
}
let going = false
async function onClose(event: Closing, window: Closable) {
  save()
  const hide = agentMarks.holding ? agentMarks.hide : trayKeeper()
  if (hide) {
    event.preventDefault()
    if ((await hide()) || going) return
    await go()
    await window.destroy()
    return
  }
  if (!isDesktop) return
  const runs = anythingRuns()
  if (!runs) settle()
  if (!runs && !workspace.writing && !stillWriting() && !ready() && !going) return
  event.preventDefault()
  if (going) return
  if (runs && !(await mayStop('window'))) return
  await go()
  await window.destroy()
}
async function onQuit(window: Closable) {
  if (going) return
  await go()
  await window.destroy()
}
export function settle() {
  settleUp()
  workspace.graphSettings.flush()
}
function save() {
  writeOwed()
  workspace.graphSettings.flush()
}
function owed() {
  return Promise.all([workspace.writesSettled(), written(), internal.flush?.()])
}
async function go(): Promise<void> {
  settle()
  going = true
  try {
    await Promise.race([owed(), waited(GIVE_UP)])
    await installStaged(true)
  } finally {
    going = false
  }
}
