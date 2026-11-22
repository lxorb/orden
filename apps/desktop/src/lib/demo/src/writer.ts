import { setPeers } from '@orden/editor'
import type { Tab } from '../../workspace/src/api'
import { scheme } from './kit'
import { replacement, TEAM, type Written, writtenAt } from './scenes'

export function writer(
  tab: () => Tab | null,
  text: string,
  written: readonly Written[],
  people: readonly (number | null)[] = [0, 1],
  after: (text: string) => string = (same) => same,
) {
  let said = ''
  return (typed: readonly string[], shown: readonly boolean[] = typed.map(() => true)) => {
    const note = tab()?.note
    if (!note) return
    const { text: made, carets } = writtenAt(
      text,
      typed.map((one) => one.length),
      written.map((one, index) => ({ ...one, words: typed[index] ?? '' })),
    )
    const wanted = after(made)
    const key = `${wanted}\u0000${shown.join()}`
    if (key === said) return
    said = key
    const change = replacement(note.live.text.toString(), wanted)
    if (change) note.live.arrived([change])
    note.live.announce([
      setPeers.of(
        carets.flatMap((head, index) => {
          const who = people[index]
          if (who === null || who === undefined || !shown[index]) return []
          return [{ id: who + 1, name: TEAM[who]?.name ?? '', colour: TEAM[who]?.[scheme()] ?? '', head, anchor: head }]
        }),
      ),
    ])
  }
}
