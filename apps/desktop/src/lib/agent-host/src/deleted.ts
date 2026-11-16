import type { AgentAnswer } from '../../automation/src/api'
import { workspace } from '../../workspace/src/api'
import { buried } from '../../protect/src/api'
import { folderOf, insideSpace, within } from '../../platform/src/api'
import type { TrashItem } from '../../trash/src/api'
import { reachedByOthersIn } from '../../sharing/src/api'
import { asked, type Call, done, need, Refused, reachable } from '../../agent-verbs/src/api'

function whereOf(call: Call, item: TrashItem): string | null {
  const spaces = reachable(call)
  if (item.kind === 'space') {
    const agent = call.caller.agent
    return agent === null || agent.spaces === 'all' ? '' : null
  }

  if (item.source === 'account') {
    const [space = '', ...folder] = item.detail.split(' / ')
    return spaces.some((one) => one.name === space) ? [space, ...folder].join('/') : null
  }
  for (const space of spaces) {
    const inside = within(space.root, insideSpace(folderOf(space.root), item.detail))
    if (inside !== null) return inside ? `${space.name}/${inside}` : space.name
  }
  return null
}

function spaceAt(item: TrashItem): string | null {
  if (item.from !== undefined) return null
  return item.kind === 'space' ? item.name : (item.detail.split(' / ')[0] ?? null)
}

function placeOf(item: TrashItem): { root: string; at: string } | null {
  const named = spaceAt(item)
  for (const space of workspace.spaces) {
    if (item.from !== undefined) {
      const at = within(space.root, insideSpace(folderOf(space.root), item.from))
      if (at !== null) return { root: space.root, at }
    } else if (named === space.name) return { root: space.root, at: item.note?.path ?? '' }
  }
  return null
}

export async function nothingLockedWaits(item: TrashItem | null): Promise<void> {
  const place = item && placeOf(item)
  const waits = (await buried()).waits(item?.ref ?? null, place?.root ?? null, place?.at ?? '')
  if (!waits) return
  throw new Refused(
    'protected',
    `${item ? item.name : 'This'} brings back a lock: the reader has to put it back themselves`,
  )
}

async function listed(call: Call) {
  const { trash } = await import('../../trash/src/api')
  await trash.load()

  return trash.items.flatMap((item) => {
    const where = whereOf(call, item)
    return where === null
      ? []
      : [
          {
            id: item.id,
            kind: item.kind,
            name: item.name,
            from: where,
            deleted: item.deletedAt,
            item,
          },
        ]
  })
}

export async function recentlyDeleted(call: Call): Promise<AgentAnswer> {
  const op = need(call, 'op')
  const rows = await listed(call)

  if (op === 'list') {
    const shared = reachable(call).some((space) => reachedByOthersIn(space.root))
    return done(
      rows.map(({ item: _item, ...row }) => row),
      shared ? 'names in shared spaces' : null,
    )
  }
  if (op !== 'restore') throw new Refused('bad_arguments', 'op is list or restore')

  const id = need(call, 'id')
  const found = rows.find((row) => row.id === id)
  if (!found) throw new Refused('not_found', `nothing called ${id} is in Recently deleted`)

  const { trash } = await import('../../trash/src/api')
  if (!trash.restorable(found.item)) {
    throw new Refused('read_only', `${found.from} is shared with you to read`)
  }

  await nothingLockedWaits(found.item)
  const question = await asked(call, null, `Put back ${found.name}`)
  if (question) return question

  await trash.restore(found.item)
  if (trash.error) throw new Refused('failed', trash.error)

  return done({ id, name: found.name, from: found.from, restored: true })
}
