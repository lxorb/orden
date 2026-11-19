import type { Entry } from '@orden/contracts'

export const file = (path: string): Entry => ({
  name: path.split(/[\\/]/).pop() ?? path,
  path,
  is_dir: false,
  modified: 0,
  created: 0,
  children: [],
})
export const folder = (path: string, children: Entry[] = []): Entry => ({
  ...file(path),
  is_dir: true,
  children,
})
