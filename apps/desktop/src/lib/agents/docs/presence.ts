import { type Peer, setAgents } from '@orden/editor'
import { accentColour, accentFor } from '../../accents'
import type { NoteDoc } from '../../workspace/documents.svelte'

export interface Agent {
  id: string
  name: string
  accent?: string
  thread?: string
}

export const SHOWN_FOR = 3500

interface Shown {
  peer: Peer
  timer: ReturnType<typeof setTimeout>
}

interface Note {
  carets: Map<string, Shown>
  stop: () => void
}

const shown = new Map<NoteDoc, Note>()

function numberOf(id: string): number {
  let sum = 7
  for (const character of id) sum = (sum * 31 + (character.codePointAt(0) ?? 0)) % 1_000_003
  return -1 - sum
}

export function showAgent(note: NoteDoc, agent: Agent, at: number, scheme: 'dark' | 'light'): void {
  const here = shown.get(note) ?? follow(note)
  const was = here.carets.get(agent.id)
  if (was) clearTimeout(was.timer)

  here.carets.set(agent.id, {
    peer: {
      id: numberOf(agent.id),
      name: agent.name,
      colour: agent.accent ? accentColour(agent.accent, scheme) : accentFor(agent.name, scheme),
      head: at,
      anchor: at,
    },
    timer: setTimeout(() => {
      gone(note, agent.id)
    }, SHOWN_FOR),
  })

  announce(note, here)
  void import('../ui/index').then(({ wrote }) => wrote(note, agent.id))
}

function follow(note: NoteDoc): Note {
  const here: Note = {
    carets: new Map(),
    stop: note.live.listen(({ changes, by }) => {
      if (by === 'switch') {
        note.live.announce([setAgents.of([])])
        forget(note)
        return
      }

      for (const one of here.carets.values()) {
        const head = changes.mapPos(one.peer.head)
        one.peer = { ...one.peer, head, anchor: head }
      }
    }),
  }

  shown.set(note, here)
  return here
}

function gone(note: NoteDoc, agent: string) {
  const here = shown.get(note)
  if (!here) return

  here.carets.delete(agent)
  announce(note, here)
  if (!here.carets.size) forget(note)
}

function forget(note: NoteDoc) {
  const here = shown.get(note)
  if (!here) return

  for (const one of here.carets.values()) clearTimeout(one.timer)
  here.stop()
  shown.delete(note)
}

function announce(note: NoteDoc, here: Note) {
  note.live.announce([setAgents.of([...here.carets.values()].map((one) => one.peer))])
}
