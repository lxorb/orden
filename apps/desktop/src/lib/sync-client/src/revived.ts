import { relativeTo, within } from '../../platform/src/api'

const settled = () => new Promise((done) => setTimeout(done, 0))
export async function calledAlso(back: string, id: string): Promise<void> {
  const { buried } = await import('../../protect/src/api')
  const held = await buried()
  held.alsoCalled(back, id)
}
export async function revived(
  path: string,
  idOf: (path: string) => string | undefined,
  roots: readonly string[],
): Promise<void> {
  await settled()
  const id = idOf(path)
  const root = roots.find((one) => within(one, path) !== null)
  if (!id || !root) return
  const at = relativeTo(root, path)
  const { buried, protection } = await import('../../protect/src/api')
  if (!(await buried()).waits(id, root, at)) return
  await protection.unbury(id, root, at, at, true)
}
