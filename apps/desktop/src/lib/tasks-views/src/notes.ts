export async function openNote(name: string): Promise<void> {
  const [{ followNote, workspace }, { links }] = await Promise.all([
    import('../../workspace/src/api'),
    import('../../link-index/src/api'),
  ])
  const target = name.split(/[#|]/)[0]?.trim() ?? name
  const active = workspace.activeSpace
  const roots = [
    ...(active ? [active.root] : []),
    ...workspace.spaces.filter((one) => one.id !== active?.id).map((one) => one.root),
  ]
  for (const root of roots) {
    await links.spaceRead(root)
    const path = links.reachedOf(root, { kind: 'wikilink', target })
    if (path === null) continue
    followNote({ path, target, heading: null, block: null, page: null }, undefined, root)
    return
  }
}
