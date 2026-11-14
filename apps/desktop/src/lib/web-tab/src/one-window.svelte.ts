import { untrack } from 'svelte'
import { invoke } from '../../platform/src/api'
import { workspace } from '../../workspace.svelte'

interface Said {
  window?: unknown
  held?: unknown
  ask?: unknown
  show?: unknown
  to?: unknown
}

const me = crypto.randomUUID()
// eslint-disable-next-line svelte/prefer-svelte-reactivity -- what the other windows said; nothing renders from it
const others = new Map<string, Map<string, number>>()
let mine = new Map<string, number>()
let channel: BroadcastChannel | null = null

const say = (what: object) => channel?.postMessage({ window: me, ...what })

export function heldElsewhere(path: string): boolean {
  return [...others.values()].some((held) => held.has(path))
}

export function showElsewhere(path: string): void {
  const to = [...others.entries()].find(([, held]) => held.has(path))?.[0]
  if (to) say({ show: path, to })
}

function heard(said: Said) {
  if (said.ask === true) say({ held: [...mine] })
  if (typeof said.window !== 'string' || said.window === me) return

  if (typeof said.show === 'string' && said.to === me) show(said.show)
  if (!Array.isArray(said.held)) return

  // eslint-disable-next-line svelte/prefer-svelte-reactivity -- what one window said; nothing renders from it
  const theirs = new Map<string, number>()
  for (const one of said.held as unknown[]) {
    if (Array.isArray(one) && typeof one[0] === 'string' && typeof one[1] === 'number') {
      theirs.set(one[0], one[1])
    }
  }
  others.set(said.window, theirs)
  settle(said.window, theirs)
}

function settle(window: string, theirs: Map<string, number>) {
  for (const [path, since] of mine) {
    const other = theirs.get(path)
    if (other === undefined) continue
    if (since < other || (since === other && me < window)) continue

    const tab = workspace.tabs.find((one) => one.kind === 'web' && one.path === path)
    if (tab) workspace.asUnsaved(tab, tab)
  }
}

function show(path: string) {
  const tab = workspace.tabs.find((one) => one.kind === 'web' && one.path === path)
  if (!tab) return

  workspace.activate(tab.id)
  void invoke('show_window').catch(() => undefined)
}

let started = false

function start(): void {
  if (started || typeof BroadcastChannel !== 'function' || typeof window === 'undefined') return
  started = true

  channel = new BroadcastChannel('orden:web-notes')
  channel.onmessage = (event: MessageEvent<Said>) => {
    heard(event.data)
  }
  say({ ask: true })
  window.addEventListener('pagehide', () => say({ held: [] }))

  $effect.root(() => {
    $effect(() => {
      const paths = workspace.tabs.flatMap((one) =>
        one.kind === 'web' && one.path !== null ? [one.path] : [],
      )
      untrack(() => {
        const now = Date.now()
        mine = new Map(paths.map((path) => [path, mine.get(path) ?? now]))
        say({ held: [...mine] })
        for (const [window, theirs] of others) settle(window, theirs)
      })
    })
  })
}

start()
