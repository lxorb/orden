export type ForeignTool =
  'Proton' | 'Dropbox' | 'OneDrive' | 'Syncthing' | 'Nextcloud' | 'ownCloud' | 'Seafile'

export interface ForeignCopy {
  tool: ForeignTool
  original: string
}

const MARKS: readonly (readonly [ForeignTool, RegExp])[] = [
  [
    'Proton',
    / \(# (?:Name clash|Edit conflict|Delete conflict|Temporary renamed|Deleted)(?: \d{4}-\d{2}-\d{2})? [0-9a-z]{6,8} #\)/i,
  ],
  ['Nextcloud', / \(conflicted copy \d{4}-\d{2}-\d{2} \d{6}\)/i],
  ['Dropbox', / \([^()]*conflicted copy \d{4}-\d{2}-\d{2}(?: \(\d+\))?\)/i],
  ['Syncthing', /\.sync-conflict-\d{8}-\d{6}-[A-Z0-9]{7}/],
  ['ownCloud', /_conflict-\d{8}-\d{6}/],
  ['Seafile', / \(SFConflict [^()]+ \d{4}-\d{2}-\d{2}-\d{2}-\d{2}-\d{2}\)/],
  ['OneDrive', /-(?:DESKTOP-[A-Z0-9]{7}|LAPTOP-[A-Z0-9]{7,8})(?=\.[^.]*$|$)/],
]

export function foreignCopy(name: string): ForeignCopy | null {
  for (const [tool, mark] of MARKS) {
    const found = mark.exec(name)
    if (found) return { tool, original: name.replace(found[0], '') }
  }
  return null
}

export function inForeignCopy(path: string): boolean {
  return path.split(/[\\/]/).some((part) => foreignCopy(part) !== null)
}
