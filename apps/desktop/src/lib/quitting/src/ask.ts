import { mount } from 'svelte'
import { invoke, platform } from '../../platform/src/api'
import HoldToQuit from './HoldToQuit.svelte'
import QuitSheet from './QuitSheet.svelte'
import { asks, rowsHere, showRow, type Why } from './rows'
import { holding, quitAsk } from './state.svelte'
import { rowsEverywhere, showElsewhere } from './windows'

let mounted = false

let holdMounted = false

let holdTimer: ReturnType<typeof setTimeout> | undefined

const HOLD_SHOWN = 1_500

async function label(): Promise<string> {
  const { getCurrentWindow } = await import('@tauri-apps/api/window')
  return getCurrentWindow().label
}

export async function mayStop(why: Why): Promise<boolean> {
  const warning = quitAsk.warning
  if (warning === 'never') return true

  const window = await label()
  const idle = warning === 'always'
  const rows = why === 'window' ? await rowsHere(window, idle) : await rowsEverywhere(window, idle)
  if (!asks(warning, rows)) return true

  const alone =
    why === 'window' &&
    platform() !== 'macos' &&
    !(await invoke<string[]>('quit_others').catch(() => [])).length

  if (why === 'quit') await invoke('quit_show').catch(() => undefined)
  if (!mounted) {
    mount(QuitSheet, { target: document.body })
    mounted = true
  }

  const answer = await quitAsk.ask(alone ? 'quit' : why, rows)
  if (answer === 'go') return true
  if (answer !== 'stay') {
    if (answer.window === window) void showRow(answer)
    else showElsewhere(answer)
  }
  return false
}

export async function quitAsked() {
  if (quitAsk.open) return
  const going = await mayStop('quit').catch(() => true)
  await invoke(going ? 'quit_confirmed' : 'keep_running').catch(() => undefined)
}

export function holdToQuit() {
  if (!holdMounted) {
    mount(HoldToQuit, { target: document.body })
    holdMounted = true
  }
  holding.shown = true
  clearTimeout(holdTimer)
  holdTimer = setTimeout(() => (holding.shown = false), HOLD_SHOWN)
}
