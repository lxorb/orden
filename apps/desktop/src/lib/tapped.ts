import { DoubleTap, type Modifier, tapOf } from './double-tap'
import { shortcuts } from './shortcuts.svelte'
import { present } from './slides/present.svelte'
import { type AppContext, SHORTCUTS } from './shortcuts/registry'
import { fromPage } from './web-tab/keys'
import { ran } from './usage/tally'

type Hearer = (key: Modifier) => void

const hearers: Hearer[] = []

export function hearTaps(hearer: Hearer): () => void {
  hearers.push(hearer)
  return () => {
    const at = hearers.lastIndexOf(hearer)
    if (at >= 0) hearers.splice(at, 1)
  }
}

export function heard(key: Modifier): void {
  hearers.at(-1)?.(key)
}

export function listenForTaps(target: Window = window): () => void {
  const taps = new DoubleTap()
  const now = () => performance.now()

  const down = (event: KeyboardEvent) => {
    if (!fromPage(event)) taps.pressed(event, now())
  }
  const up = (event: KeyboardEvent) => {
    if (fromPage(event)) return
    const key = taps.released(event, now())
    if (key) heard(key)
  }
  const broken = () => taps.broken()
  const left = (event: Event) => {
    if (event.target === target) taps.broken()
  }

  const options = { capture: true, passive: true }
  target.addEventListener('keydown', down, options)
  target.addEventListener('keyup', up, options)
  target.addEventListener('pointerdown', broken, options)
  target.addEventListener('wheel', broken, options)
  target.addEventListener('blur', left, options)

  return () => {
    target.removeEventListener('keydown', down, options)
    target.removeEventListener('keyup', up, options)
    target.removeEventListener('pointerdown', broken, options)
    target.removeEventListener('wheel', broken, options)
    target.removeEventListener('blur', left, options)
  }
}

export function runTap(key: Modifier, context: AppContext): boolean {
  for (const entry of SHORTCUTS) {
    const held = shortcuts.keyFor(entry.id)
    if (entry.scope !== 'app' || !entry.run || !held) continue
    if (tapOf(held, shortcuts.platform) !== key) continue

    ran(entry.id, 'shortcut')
    entry.run(context)
    return true
  }

  return false
}

export function hear(context: () => AppContext, target: Window = window): () => void {
  const unlisten = listenForTaps(target)
  const unhear = hearTaps((key) => {
    if (!present.on) runTap(key, { ...context(), tapped: true })
  })

  return () => {
    unlisten()
    unhear()
  }
}
