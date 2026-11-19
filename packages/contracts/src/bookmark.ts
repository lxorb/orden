export const BOOKMARK_KINDS = ['note', 'folder', 'heading', 'search', 'block', 'group', 'graph'] as const
export type BookmarkKind = (typeof BOOKMARK_KINDS)[number]
export interface Bookmark {
  kind: BookmarkKind
  path: string
  text: string
  parent?: string
  view?: string
  id?: string
}
