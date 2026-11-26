const ASSETS = 'assets'
function slashed(path: string): string {
  return path.replace(/\\/g, '/')
}
export function assetFolder(notePath: string, spaceRoot: string | null): string {
  const depth = foldersBelow(spaceRoot, notePath)
  return depth === null ? ASSETS : `${'../'.repeat(depth)}${ASSETS}`
}
function foldersBelow(spaceRoot: string | null, notePath: string): number | null {
  const root = slashed(spaceRoot ?? '').replace(/\/+$/, '')
  const note = slashed(notePath)
  if (!root || !note.startsWith(`${root}/`)) return null
  return note.slice(root.length + 1).split('/').length - 1
}
