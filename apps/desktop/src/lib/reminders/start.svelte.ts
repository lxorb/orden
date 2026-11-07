import { untrack } from 'svelte'
import type { Row } from '@orden/bases'
import { t } from '../i18n.svelte'
import { answer, wordSaid } from '../mobile/bridge'
import { modes } from '../modes.svelte'
import { hearHere } from '../own-window'
import { quickAdd } from '../quick-add/asked.svelte'
import { rows } from '../rows/rows.svelte'
import { insideSpace } from '../space-paths'
import { invoke, isDesktop } from '../tauri'
import { workspace } from '../workspace.svelte'
import { askToShow } from '../notify'
import { hand, show, taken } from './platform'
import { type Host as PressHost, type Pressed, respond } from './presses'
import { residency } from './residency.svelte'
import { Ringer } from './ring'
import { Scheduler } from './scheduler'

const later = (run: () => void, ms: number) => {
  const timer = setTimeout(run, ms)
  return () => clearTimeout(timer)
}

function whenReady(): Promise<void> {
  if (rows.ready) return Promise.resolve()
  return new Promise((done) => {
    const stop = rows.watch(() => {
      if (!rows.ready) return
      stop()
      done()
    })
  })
}

const pressHost: PressHost = {
  rootOf: (space) => workspace.spaces.find((one) => one.name === space)?.root ?? null,
  rowsAt: (path) => rows.at(path),
  ready: whenReady,
  tick: (row) => rows.write(row, { task: { done: true } }),
  inside: insideSpace,
  async open(root, path, line) {
    const space = workspace.spaces.find((one) => one.root === root)
    if (space && workspace.activeSpace?.root !== root) await workspace.selectSpace(space.id)
    await workspace.open(path)
    workspace.goto = { path, line }
  },
}

async function answerAll() {
  const presses = await taken()
  for (const one of presses) await answered(one)
  if (presses.length && isDesktop) {
    await invoke('reminders_quietly').catch(() => undefined)
  }
}

async function answered(press: Pressed) {
  await respond(press, pressHost).catch(() => false)
}

function hidden(row: Row): string | null {
  const root = pressHost.rootOf(row.space)
  if (root === null || !workspace.protection.covering(insideSpace(root, row.path)).length)
    return null
  return t('A protected note has a reminder')
}

const ringer = new Ringer({
  now: () => Date.now(),
  later,
  show: (one) => show(one, (press) => void answered(press)),
})

let auto: number | null = null

const scheduler = new Scheduler({
  rows: () => rows.of(),
  ready: () => rows.ready,
  watch: (listener) => rows.watch(listener),
  auto: () => auto,
  hidden,
  now: () => Date.now(),
  hand,
  ring(plan) {
    if (plan.length) askToShow()
    ringer.ring(plan)
  },
  waiting(any) {
    residency.waiting = any
  },
  later,
})
scheduler.start()
void wordSaid().then(() => {
  scheduler.changed()
  void answerAll()
})

$effect.root(() => {
  $effect(() => {
    const minutes = modes.remindBefore
    untrack(() => {
      auto = minutes < 0 ? null : minutes
      scheduler.changed()
    })
  })
  $effect(() => {
    if (!workspace.protection.seen) return
    untrack(() => scheduler.changed())
  })
  $effect(() => {
    const held = quickAdd.held
    untrack(() => (residency.quickAdd = held))
  })
  $effect(() => {
    const on = residency.on
    untrack(() => residency.apply(on))
  })
})

void answerAll()
if (isDesktop) {
  void hearHere('orden://reminder', () => void answerAll())
} else {
  answer('__ordenReminders', () => void answerAll())
}
