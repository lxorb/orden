import type { AgentAnswer } from '../../automation/src/api'
import { folderOf, insideSpace, within } from '../../platform/src/api'
import type { TrashItem } from '../../trash/src/api'
import type { Space } from '../../workspace/src/api'
import { reachedByOthersIn } from '../../sharing/src/api'
import { asked, type Call, done, need, Refused, reachable } from '../../agent-verbs/src/api'

interface Where {
  from: string
  space: Space | null
}

function whereOf(call: Call, item: TrashItem): Where | null {
  const spaces = reachable(call)
  if (item.kind === 'space') {
    const agent = call.caller.agent
    return agent === null || agent.spaces === 'all' ? { from: '', space: null } : null
  }

  if (item.source === 'account') {
    const [name = '', ...folder] = item.detail.split(' / ')
    const space = spaces.find((one) => one.name === name)
    return space ? { from: [name, ...folder].join('/'), space } : null
  }
  for (const space of spaces) {
    const inside = within(space.root, insideSpace(folderOf(space.root), item.detail))
    if (inside !== null) return { from: inside ? `${space.name}/${inside}` : space.name, space }
  }
  return null
}

function sourceOf(rows: readonly { space: Space | null }[]): string | null {
  const shared = [
    ...new Set(
      rows.flatMap(({ space }) =>
        space !== null && reachedByOthersIn(space.root) ? [space.name] : [],
      ),
    ),
  ]
  return shared.length ? `shared space ${shared.join(', ')}` : null
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
            from: where.from,
            deleted: item.deletedAt,
            item,
            space: where.space,
          },
        ]
  })
}

export async function recentlyDeleted(call: Call): Promise<AgentAnswer> {
  const op = need(call, 'op')
  const rows = await listed(call)

  if (op === 'list') {
    return done(
      rows.map(({ item: _item, space: _space, ...row }) => row),
      sourceOf(rows),
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

  const question = await asked(call, null, `Put back ${found.name}`)
  if (question) return question

  await trash.restore(found.item)
  if (trash.error) throw new Refused('failed', trash.error)

  return done({ id, name: found.name, from: found.from, restored: true })
}
