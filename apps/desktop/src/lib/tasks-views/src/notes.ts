import { isTodoSpace, todoSpaceOf } from '../../tasks-model/src/api'

export async function openNote(name: string, space: string | null): Promise<void> {
  const [{ followNote, workspace }, { links }] = await Promise.all([
    import('../../workspace/src/api'),
    import('../../link-index/src/api'),
  ])
  const root = (workspace.spaces.find((one) => isTodoSpace(todoSpaceOf(one), space)) ?? workspace.activeSpace)?.root
  if (!root) return
  const target = name.split(/[#|]/)[0]?.trim() ?? name
  await links.spaceRead(root)
  const path = links.reachedOf(root, { kind: 'wikilink', target })
  if (path !== null) followNote({ path, target, heading: null, block: null, page: null }, undefined, root)
}
