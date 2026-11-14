import type { AgentAnswer } from '../automation/caller'
import { folderOf, insideSpace, within } from '../platform/src/api'
import type { TrashItem } from '../trash.svelte'
import { asked } from './asks'
import { type Call, done, need } from './call'
import { Refused } from './problem'
import { reachable } from './spaces'

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

async function listed(call: Call) {
  const { trash } = await import('../trash.svelte')
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

  if (op === 'list') return done(rows.map(({ item: _item, ...row }) => row))
  if (op !== 'restore') throw new Refused('bad_arguments', 'op is list or restore')

  const id = need(call, 'id')
  const found = rows.find((row) => row.id === id)
  if (!found) throw new Refused('not_found', `nothing called ${id} is in Recently deleted`)

  const { trash } = await import('../trash.svelte')
  if (!trash.restorable(found.item)) {
    throw new Refused('read_only', `${found.from} is shared with you to read`)
  }

  const question = await asked(call, null, `Put back ${found.name}`)
  if (question) return question

  await trash.restore(found.item)
  if (trash.error) throw new Refused('failed', trash.error)

  return done({ id, name: found.name, from: found.from, restored: true })
}
