import { whenLoaded } from '@orden/contracts'
import { account } from './accounts/src/api'
import { recovery } from './history/src/api'
import { modes } from './modes/src/api'
import { shortcuts, toolbar } from './shortcuts/src/api'
import { spaceArchiving } from './spaces/src/api'
import { keyboardStays, overlays, takesCaret, viewport } from './ui-kit/src/api'
import { paneMoves, workspace } from './workspace/src/api'
import type { EditorView } from '@orden/editor'

interface Hears {
  on(type: 'settings', run: () => void): () => void
  opened(run: () => void): () => void
}
export function settingsFollower<T>(
  token: () => string | null,
  adopt: (token: string) => Promise<T | null>,
  fan: (remote: T) => void,
) {
  let running = false
  let wanted = 0
  async function take(): Promise<void> {
    wanted++
    if (running) return
    running = true
    try {
      let seen: number
      do {
        seen = wanted
        const now = token()
        if (!now) return
        const remote = await adopt(now)
        if (remote) fan(remote)
      } while (wanted !== seen)
    } finally {
      running = false
    }
  }
  const asked = () => void take().catch(() => undefined)
  return {
    take: asked,
    hear(hub: Hears): () => void {
      const offs = [hub.on('settings', asked), hub.opened(asked)]
      return () => {
        for (const off of offs) off()
      }
    },
  }
}
export const accountSettings = settingsFollower(
  () => account.accountToken,
  (token) => modes.adopt(token),
  (remote) => {
    shortcuts.receive(remote)
    toolbar.receive(remote)
    whenLoaded(
      () => import('./gates/src/api'),
      (gates) => gates.receive(remote),
    )
    recovery.receive(remote)
    whenLoaded(spaceArchiving, (archiving) => void archiving.receive(remote))
    if (!__EVEN_PLUGIN__)
      whenLoaded(
        () => import('./chats-client/src/api'),
        ({ hush }) => hush.receive(remote),
      )
  },
)
export function hearAccountSettings(): () => void {
  let stop: (() => void) | null = null
  const off = whenLoaded(
    () => import('./sync-client/src/api'),
    ({ hub }) => (stop = accountSettings.hear(hub)),
  )
  return () => {
    off()
    stop?.()
  }
}
const EARLY = ['keydown', 'beforeinput', 'compositionstart'] as const
export function caretAfterPaint(take: () => void, early: () => void = take, at: Window = window): () => void {
  let frame = 0
  let painted = 0
  const stop = () => {
    at.cancelAnimationFrame(frame)
    at.clearTimeout(painted)
    for (const kind of EARLY) at.removeEventListener(kind, keyed, true)
  }
  function keyed() {
    stop()
    early()
  }
  for (const kind of EARLY) at.addEventListener(kind, keyed, true)
  frame = at.requestAnimationFrame(() => {
    painted = at.setTimeout(() => {
      stop()
      take()
    })
  })
  return stop
}
let moves: Awaited<ReturnType<typeof paneMoves>> | null = null
void paneMoves().then((one) => (moves = one))
interface Shown {
  kind: NonNullable<Parameters<typeof takesCaret>[0]>['kind']
  reading: boolean
}
export function caretInto(
  current: EditorView | null | undefined,
  tab: Shown | null | undefined,
  pane: string,
): () => void {
  const free = () => overlays.depth === 0 && workspace.naming === null && !viewport.touch && !keyboardStays()
  const note = () =>
    !!current &&
    takesCaret(tab ? { kind: tab.kind, reading: tab.reading } : null, {
      overlaid: overlays.depth > 0,
      renaming: workspace.naming !== null,
      touch: viewport.touch,
    })
  const intoNote = () => {
    if (current && note() && !keyboardStays() && !current.hasFocus) current.focus()
  }
  return caretAfterPaint(intoNote, () => {
    if (note()) intoNote()
    else if (free()) moves?.keyboardInto(pane)
  })
}
