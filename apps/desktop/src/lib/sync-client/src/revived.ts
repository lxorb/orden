import { relativeTo, within } from '../../platform/src/api'

export async function revived(
  path: string,
  id: string | undefined,
  roots: readonly string[],
): Promise<void> {
  const root = roots.find((one) => within(one, path) !== null)
  if (!id || !root) return
  const { buried, protection } = await import('../../protect/src/api')
  if (!(await buried()).waits(id, null, '')) return
  await protection.unbury(id, root, relativeTo(root, path))
}
