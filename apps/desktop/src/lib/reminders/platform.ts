import { frameWord, method, NoWord } from '../mobile/bridge'
import { notify } from '../notify'
import { parsed } from '../stored'
import { invoke, isDesktop } from '../tauri'
import type { Reminder } from './plan'
import { type Pressed, pressOf } from './presses'

function untilTomorrow(at: number): number {
  const day = new Date(at)
  const nine = new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1, 9, 0)
  return Math.max(1, Math.round((nine.getTime() - at) / 60_000))
}

function words() {
  return {
    done: 'Done',
    snooze: 'Snooze',
    minutes: '15 min',
    hour: '60 min',
    tomorrow: 'Tomorrow',
    channel: 'Reminders',
  }
}

export async function hand(plan: readonly Reminder[]): Promise<boolean> {
  const reminders = plan.map((one) => ({ ...one, tomorrow: untilTomorrow(one.at) }))

  if (isDesktop) return invoke<boolean>('reminders_set', { reminders, words: words() })

  const alarms = method('reminders')
  if (alarms) {
    const word = await frameWord()
    if (!word) throw new NoWord()
    alarms(word, JSON.stringify({ reminders, words: words() }))
    return true
  }
  return false
}

export function show(one: Reminder, opened: (press: Pressed) => void) {
  notify(one.title, one.body, one.id, () => {
    opened({ act: 'open', space: one.space, path: one.path, hash: one.hash, line: one.line })
  })
}

export async function taken(): Promise<Pressed[]> {
  let said: unknown = []
  if (isDesktop) said = await invoke<unknown>('reminders_taken').catch(() => [])
  else {
    const take = method('remindersTaken')
    if (take) said = parsed(take(await frameWord()))
  }
  return Array.isArray(said) ? said.map(pressOf).filter((one) => one !== null) : []
}
