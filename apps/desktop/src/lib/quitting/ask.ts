import { mount } from 'svelte'
import { invoke, platform } from '../platform/src/api'
import { shells } from '../terminal/shells.svelte'
import { jump } from './jump'
import QuitSheet from './QuitSheet.svelte'
import { asks, rowsHere, type Why } from './rows'
import { quitAsk } from './state.svelte'
import { rowsEverywhere, showElsewhere } from './windows'

let mounted = false

async function label(): Promise<string> {
  const { getCurrentWindow } = await import('@tauri-apps/api/window')
  return getCurrentWindow().label
}

export async function mayStop(why: Why): Promise<boolean> {
  const warning = shells.warning
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
    if (answer.window === window) void jump(answer)
    else showElsewhere(answer)
  }
  return false
}

export async function quitAsked() {
  if (quitAsk.open) return
  const going = await mayStop('quit').catch(() => true)
  await invoke(going ? 'quit_confirmed' : 'keep_running').catch(() => undefined)
}
