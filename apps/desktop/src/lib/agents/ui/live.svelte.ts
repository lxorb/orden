/** The activity UI, started: the store, and everything that follows it for as long as
 *  the window lives.
 *
 *  Started by the first agent event the shell hears (agent-marks.svelte.ts), or by the
 *  chat list showing its agents, whichever is first, and only ever once. What it keeps
 *  up to date is small and all of it is the shell's: which tabs wear a mark, the badge,
 *  the steps asked of the reader, whether closing the window hides it, the stop's key from any app, and
 *  the pairing bubble while a client is asking. */

import { mount, unmount, untrack } from 'svelte'
import { agentOpen } from '../../ai/sidebar/agent-open.svelte'
import { revealPanel } from '../../focus'
import { notify, unshow } from '../../notify'
import { agentMarks } from '../../agent-marks.svelte'
import { unlend } from '../../web-tab/lending'
import { t } from '../../i18n.svelte'
import { shortcuts } from '../../shortcuts.svelte'
import { accelerator } from '../../accelerator'
import { Activity } from './activity.svelte'
import { asking } from './asking.svelte'
import { nextLapse, sameMarks, wornAt } from './marks'
import PairingBubble from './PairingBubble.svelte'
import { readEvent } from './read'
import { crate, type Source } from './source'
import type { NoteDoc } from '../../workspace/documents.svelte'

/** How long past an acting tab's lapse its timer fires, so the look it takes is on the
 *  far side of the edge rather than a millisecond short of it. */
const PAST = 20

let running: Activity | null = null

/** Stops following the store: the effect root the UI was started with. */
let unfollow: (() => void) | null = null

/** The activity UI, started once. Answers the store; `hear` is what the door hands
 *  each event to. */
export function started(source: Source = crate): Activity {
  if (running) return running

  const activity = new Activity(source)
  running = activity
  agentMarks.heard = true
  agentMarks.act = (tab, what) => void activity.act(tab, what)
  agentMarks.hide = () => source.hide().catch(() => false)

  unfollow = $effect.root(() => {
    // Which tabs wear a mark: written only when one changed, since the strip and every
    // web tab read it. A tab the agent has let go of is the reader's to hide and freeze
    // again, out of sight; the crate lent it page and all (agents/reader.rs).
    $effect(() => {
      const worn = wornAt(activity.seen, activity.now, (agent) => activity.colourOf(agent))
      untrack(() => {
        if (sameMarks(worn, agentMarks.on)) return
        for (const tab of Object.keys(agentMarks.on)) if (!(tab in worn)) unlend(tab)
        agentMarks.on = worn
      })
    })

    // An acting tab lets go once nothing has called on it for a while: looked at again
    // when the first of them is due, and not before.
    $effect(() => {
      const now = activity.now
      const next = nextLapse(activity.seen, now)
      if (next === null) return

      const timer = setTimeout(() => (activity.now = Date.now()), next - now + PAST)
      return () => clearTimeout(timer)
    })

    // The badge on the panel's tab, and the steps asked of the reader that each web tab
    // puts under its bar.
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

    // While an agent is connected: the stop answers from any app, the tray has its
    // rows, and closing the window that holds the agents' pages hides it instead.
    const connected = $derived(activity.seen.connected.length > 0)
    const key = $derived(connected ? shortcuts.keyFor('agents.stop') : null)
    $effect(() => {
      agentMarks.holding = connected && activity.holds
    })
    $effect(() => {
      const system = key === null ? null : accelerator(key, shortcuts.platform)
      const words = {
        show: t('Open'),
        stop: t('Stop agents'),
        quit: t('Quit'),
        stopped: t('Agents stopped'),
        closed: t('Agent tabs closed'),
        hidden: t('Orden is still running for your agents'),
        pairing: t('{client} wants to connect'),
      }
      untrack(() => void source.shell(system, words).catch(() => undefined))
    })

    // What an agent asked the reader, and the marks it drew in notes, go with it (#1078):
    // it is the one being talked to only while it is connected and not stopped.
    $effect(() => {
      // eslint-disable-next-line svelte/prefer-svelte-reactivity -- handed on at once, never drawn
      const here = new Set(activity.seen.connected.filter((one) => !activity.stopped(one)))
      untrack(() => {
        asking.keepOnly(here)
        // The marks' module fetched only now, where there may be some.
        void import('../workspace/editor').then(({ keepMarksOf }) => keepMarksOf(here))
      })
    })

    // A client asking to become an agent: the bubble, for as long as it asks.
    // Each question an agent asks is a notification too, as a chat's message is: the
    // agent is waiting on the reader, who may be in another app. Pressed, it opens the
    // agent's session, where the question is answered. Taken back once answered.
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

/** What a question's notification is filed under, so its answer takes it back. */
const questionTag = (id: string) => `agent-question-${id}`

/** An agent's session, open in the Ask panel where a conversation would be (#1120). */
function openSession(agent: string): void {
  agentOpen.id = agent
  revealPanel('ask')
}

/** The UI taken down, and the shell told nothing is known: for a test that starts it
 *  again against a crate of its own. */
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

/** The door's side: starts the UI if it was not, and hands it the event. */
export function start(source: Source = crate): (event: unknown) => void {
  const activity = started(source)
  return (payload) => {
    const event = readEvent(payload)
    if (event) activity.hear(event)
  }
}

/** The stop key, the tray's row and the panel's: every agent. A second press, with
 *  everything already stopped, closes their tabs; see stop.rs. A window no agent has
 *  spoken to has nothing to stop, and a stop pressed there would hold the next agent
 *  that comes, so it does nothing. */
export function stopAgents(): void {
  void running?.stop().catch(() => undefined)
}

/** An agent wrote in a note: the tabs showing it wear its mark. */
export function wrote(note: NoteDoc, agent: string): void {
  started().wrote(note, agent)
}
