import { mount, unmount, untrack } from 'svelte'
import { agentOpen } from '../../ai/sidebar/agent-open.svelte'
import { revealPanel } from '../../focus'
import { notify, unshow } from '../../notify'
import { agentMarks } from '../../agent-marks.svelte'
import { unlend } from '../../web-tab/src/lending'
import { shortcuts } from '../../shortcuts.svelte'
import { accelerator } from '../../accelerator'
import { Activity } from './activity.svelte'
import { asking } from './asking.svelte'
import { nextLapse, sameMarks, wornAt } from './marks'
import PairingBubble from './PairingBubble.svelte'
import { readEvent } from './read'
import { crate, type Source } from './source'
import type { NoteDoc } from '../../workspace/documents.svelte'

const PAST = 20

let running: Activity | null = null

let unfollow: (() => void) | null = null

export function started(source: Source = crate): Activity {
  if (running) return running

  const activity = new Activity(source)
  running = activity
  agentMarks.heard = true
  agentMarks.act = (tab, what) => void activity.act(tab, what)
  agentMarks.hide = () => source.hide().catch(() => false)

  unfollow = $effect.root(() => {
    $effect(() => {
      const worn = wornAt(activity.seen, activity.now, (agent) => activity.colourOf(agent))
      untrack(() => {
        if (sameMarks(worn, agentMarks.on)) return
        for (const tab of Object.keys(agentMarks.on)) if (!(tab in worn)) unlend(tab)
        agentMarks.on = worn
      })
    })

    $effect(() => {
      const now = activity.now
      const next = nextLapse(activity.seen, now)
      if (next === null) return

      const timer = setTimeout(() => (activity.now = Date.now()), next - now + PAST)
      return () => clearTimeout(timer)
    })

    $effect(() => {
      agentMarks.waiting = activity.questions.length
      agentMarks.takeovers = Object.fromEntries(
        activity.seen.approvals.flatMap((one) =>
          one.category === 'takeover' && one.tab !== undefined
            ? [[one.tab, { id: one.id, reason: one.summary }] as const]
            : [],
        ),
      )
    })

    const connected = $derived(activity.seen.connected.length > 0)
    const key = $derived(connected ? shortcuts.keyFor('agents.stop') : null)
    $effect(() => {
      agentMarks.holding = connected && activity.holds
    })
    $effect(() => {
      const system = key === null ? null : accelerator(key, shortcuts.platform)
      const words = {
        show: 'Open',
        stop: 'Stop agents',
        quit: 'Quit',
        stopped: 'Agents stopped',
        closed: 'Agent tabs closed',
        hidden: 'Orden is still running for your agents',
        pairing: '{client} wants to connect',
      }
      untrack(() => void source.shell(system, words).catch(() => undefined))
    })

    $effect(() => {
      // eslint-disable-next-line svelte/prefer-svelte-reactivity -- handed on at once, never drawn
      const here = new Set(activity.seen.connected.filter((one) => !activity.stopped(one)))
      untrack(() => {
        asking.keepOnly(here)
        void import('../workspace/editor').then(({ keepMarksOf }) => keepMarksOf(here))
      })
    })

    // eslint-disable-next-line svelte/prefer-svelte-reactivity -- bookkeeping, never drawn
    const told = new Set<string>()
    $effect(() => {
      const now = activity.questions
      untrack(() => {
        for (const one of now) {
          if (told.has(one.id)) continue
          told.add(one.id)
          notify(activity.nameOf(one.agent), one.summary, questionTag(one.id), () =>
            openSession(one.agent),
          )
        }
        for (const id of told) {
          if (now.some((one) => one.id === id)) continue
          told.delete(id)
          unshow(questionTag(id))
        }
      })
    })

    const pairing = $derived(activity.seen.approvals.some((one) => one.category === 'pairing'))
    $effect(() => {
      if (!pairing) return
      const bubble = untrack(() =>
        mount(PairingBubble, { target: document.body, props: { activity } }),
      )
      return () => void unmount(bubble, { outro: true })
    })
  })

  void activity.load().catch(() => undefined)
  return activity
}

const questionTag = (id: string) => `agent-question-${id}`

function openSession(agent: string): void {
  agentOpen.id = agent
  revealPanel('ask')
}

export function ended(): void {
  unfollow?.()
  unfollow = null
  running = null
  agentMarks.on = {}
  agentMarks.heard = false
  agentMarks.waiting = 0
  agentMarks.takeovers = {}
  agentMarks.holding = false
  agentMarks.act = null
  agentMarks.hide = null
}

export function start(source: Source = crate): (event: unknown) => void {
  const activity = started(source)
  return (payload) => {
    const event = readEvent(payload)
    if (event) activity.hear(event)
  }
}

export function stopAgents(): void {
  void running?.stop().catch(() => undefined)
}

export function wrote(note: NoteDoc, agent: string): void {
  started().wrote(note, agent)
}
