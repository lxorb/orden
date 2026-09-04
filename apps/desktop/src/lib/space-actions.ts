import { key, t } from './i18n.svelte'
import { prompt } from './prompt.svelte'
import { type Space, workspace } from './workspace.svelte'

/** Asks for a name and makes the space. Where it lives is the app's business,
 *  so that is the only question. */
export async function newSpace() {
  const name = await prompt.ask({
    title: t('Name the space'),
    placeholder: t('Journal'),
    confirmLabel: key('Create'),
  })

  if (name) await workspace.addSpace(name)
}

/** Moves a space in the rail and tells the account about it, so the order is
 *  the same on the next machine. Lives here rather than on the workspace,
 *  which knows nothing about syncing. */
export async function moveSpace(id: string, beforeId: string | null) {
  if (!workspace.moveSpace(id, beforeId)) return

  const { sync } = await import('./sync.svelte')
  void sync.pushSpaceOrder()
}

export async function renameSpace(space: Space) {
  const name = await prompt.ask({
    title: t('Rename the space'),
    value: space.name,
    confirmLabel: key('Rename'),
  })

  if (!name) return

  const from = space.root
  await workspace.renameSpace(space.id, name)

  // The folder has a new path now, and the mirror is keyed by the old one.
  // Left alone, the next pass would read this as a space the account has never
  // seen and upload a second copy of it.
  const { sync } = await import('./sync.svelte')
  await sync.renamed(from, space.root, space.name)
}

export async function deleteSpace(space: Space) {
  const sure = await prompt.confirm({
    title: t('Delete {name}?', { name: space.name }),
    detail: t('Every note in this space is deleted from your computer.'),
    confirmLabel: key('Delete'),
    danger: true,
  })

  if (!sure) return

  const root = space.root
  await workspace.deleteSpace(space.id)

  // Deleted here means deleted from the account. Anything less and the next
  // pass downloads it straight back, here and on every other machine.
  const { sync } = await import('./sync.svelte')
  await sync.forget(root)
}
