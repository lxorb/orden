import { todayOf } from '@orden/bases'
import type { Message, Who } from '@orden/chats'
import { complete } from '../ai/complete'
import { ai } from '../ai/store.svelte'
import { chatsOn } from '../settings.svelte'
import { type Asker, type Heard, priorities } from './priorities.svelte'
import { store } from './view/source.svelte'

const asker = (): Asker | null => {
  const provider = ai.providerFor('ask')
  if (!provider) return null
  return (messages) => complete({ provider, model: provider.model, messages })
}

let started = false

export function startPriorities(): void {
  if (started) return
  started = true
  priorities.useAsker(asker)
  store().heard((chat, messages) => {
    if (!chatsOn() || (!priorities.on && !priorities.drafting)) return
    const me = store().me
    if (messages.every((one) => one.author === me)) return
    void consider(chat).catch(() => undefined)
  })
}

export function heardOf(messages: readonly Message[], me: Who | null): Heard[] {
  return messages.map((one) => ({
    from: one.author,
    words: one.deleted ? '' : one.body,
    mine: one.author === me,
    at: one.at,
  }))
}

const considering = new Map<string, { again: boolean }>()

async function consider(chat: string): Promise<void> {
  const busy = considering.get(chat)
  if (busy) {
    busy.again = true
    return
  }
  const turn = { again: true }
  considering.set(chat, turn)
  try {
    while (turn.again) {
      turn.again = false
      await considered(chat)
    }
  } finally {
    considering.delete(chat)
  }
}

async function considered(chat: string): Promise<void> {
  const title = store().entry(chat)?.name ?? ''
  const heard = heardOf(await store().history(chat, { limit: 30 }), store().me)
  await priorities.heard(chat, title, heard.slice(-8))
  const mine = heard.filter((one) => one.mine && one.words).map((one) => one.words)
  await priorities.suggest(chat, title, heard.slice(-10), mine, todayOf())
}
