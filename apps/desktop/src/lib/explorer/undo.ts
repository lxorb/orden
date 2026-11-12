import { folderOf, nameOf, pathKey } from '../space-paths'
import { joinPath } from '../tauri'
import { workspace } from '../workspace.svelte'
import type { FileAction, OutsideStep } from '../workspace/undo.svelte'
import { type Pair, put, trashPaths, type Transferred, untrash } from './commands'
import { jobs } from './jobs.svelte'
import { swapping } from './renaming'
import { relistAll } from './view.svelte'

type Outside = Extract<FileAction, { kind: 'outside' }>

export async function undoOutside(action: Outside): Promise<void> {
  try {
    for (const step of [...action.steps].reverse()) await undoStep(step)
  } finally {
    relistAll()
  }
}

export async function redoOutside(action: Outside): Promise<void> {
  const steps: OutsideStep[] = []
  try {
    for (const step of action.steps) steps.push(await redoStep(step))
  } finally {
    if (steps.length) workspace.undone.record({ kind: 'outside', steps })
    relistAll()
  }
}

async function undoStep(step: OutsideStep): Promise<void> {
  switch (step.op) {
    case 'moved':
      await movedBack(step.pairs.map(({ from, to }) => ({ from: to, to: from })))
      return
    case 'copied':
      await trashPaths(step.pairs.map((one) => one.to))
      return
    case 'made': {
      const [ticket] = await trashPaths([step.path])
      if (ticket) step.ticket = ticket
      return
    }
    case 'trashed':
    case 'replaced': {
      const back = await untrash(step.tickets)
      if (back.length < step.tickets.length) throw new Error('not all of it came back')
      return
    }
  }
}

async function redoStep(step: OutsideStep): Promise<OutsideStep> {
  switch (step.op) {
    case 'moved':
    case 'copied': {
      const done = whole(await carried(step.pairs, step.op === 'moved' ? 'move' : 'copy'))
      return { op: step.op, pairs: done.done }
    }
    case 'made': {
      if (!step.ticket) throw new Error('nothing to bring back')
      await untrash([step.ticket])
      return { op: 'made', path: step.path }
    }
    case 'trashed':
    case 'replaced':
      return { op: step.op, tickets: await trashPaths(step.tickets.map((one) => one.path)) }
  }
}

async function movedBack(pairs: Pair[]) {
  if (!swapping(pairs, (path) => pathKey(path))) {
    whole(await carried(pairs, 'move'))
    return
  }
  const staged = pairs.map((one, at) => ({
    from: one.from,
    to: joinPath(folderOf(one.to), `.orden-renaming-${at}-${nameOf(one.to)}`),
  }))
  whole(await carried(staged, 'move'))
  whole(
    await carried(
      staged.map((one, at) => ({ from: one.to, to: pairs[at]?.to ?? one.from })),
      'move',
    ),
  )
}

function carried(pairs: Pair[], how: 'copy' | 'move'): Promise<Transferred> {
  const label = pairs.length === 1 ? 'Moving 1 item' : `Moving ${pairs.length} items`
  return jobs.run(label, (id) => put(id, pairs, how))
}

function whole(done: Transferred): Transferred {
  if (done.cancelled || done.failed.length) throw new Error(done.failed[0]?.why ?? 'cancelled')
  return done
}
