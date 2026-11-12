import type { Core, Holding } from './core'
import { type Doc, MINE } from './docs'
import { inline } from './classify'
import { fileOfUpdates, judge, turn } from './kinds'
import { againstBytes } from './records'
import type { SpaceState } from './places'
import type { Change } from './store'

export async function rejoin(
  core: Core,
  space: SpaceState,
  doc: Doc,
  update: Uint8Array,
  seq: number,
  at: number,
  by: string | null,
): Promise<{ changes: Change[]; held: boolean }> {
  const read = () => ({
    shape: doc.shape,
    base: doc.confirmedText(),
    local: doc.text(),
    remote: fileOfUpdates(doc.shape, doc.row().confirmed, update),
    merged: fileOfUpdates(doc.shape, doc.whole(), update),
    times: { local: doc.pendingAt, remote: at },
  })
  const asked = read()
  let judged = await (core.world.classify ?? inline)(asked)
  const now = read()
  if (now.local !== asked.local || now.base !== asked.base) {
    judged = judge(now.shape, now.base, now.local, now.remote, now.times, now.merged)
  }
  const { base, local, remote, merged, times } = now
  const held = judged.resolution === null

  if (doc.shape !== 'link') {
    core.classified.push({ id: doc.id, base, local, remote, times, merged, held })
  }

  if (judged.resolution === null) {
    const holding: Holding = {
      row: {
        id: doc.id,
        remote: againstBytes({ t: 'moved', update, seq, at }),
        remote_sv: new Uint8Array(),
        device: by,
        at: core.world.now(),
      },
      against: { t: 'moved', update, seq, at },
    }
    return { changes: core.holdChanges(holding), held: true }
  }

  const changes: Change[] = []
  doc.took(update, seq)
  const resolution = judged.resolution
  doc.write((live) => turn(doc.shape, live, merged, resolution, MINE))
  doc.flush()
  changes.push(...keepLosers(core, space, doc.id, judged.lost, local, remote))
  changes.push(...core.docChanges(doc))
  return { changes, held: false }
}

export function keepLosers(
  core: Core,
  space: SpaceState,
  id: string,
  lost: { local: boolean; remote: boolean },
  local: string,
  remote: string,
): Change[] {
  const changes: Change[] = []
  const texts = [...(lost.local ? [local] : []), ...(lost.remote ? [remote] : [])]
  for (const text of texts) {
    const { one, change } = core.outgoing(
      space,
      { t: 'keep', keep: { id, text, device: core.device } },
      space.row.cursor,
    )
    space.outbox.push(one)
    changes.push(change, core.counterRow())
  }
  return changes
}
