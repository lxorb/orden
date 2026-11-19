import { noMoreThan, type Thread } from '../../../ai-providers/src/api'

export function allows(thread: Pick<Thread, 'only' | 'without'>, tool: string): boolean {
  return !thread.without?.includes(tool) && (thread.only === undefined || thread.only.includes(tool))
}
export function keptUnder(parent: Thread, child: Thread): void {
  const without = [...new Set([...(parent.without ?? []), ...(child.without ?? [])])]
  if (without.length) child.without = without
  const only =
    parent.only && child.only ? child.only.filter((one) => parent.only?.includes(one)) : (parent.only ?? child.only)
  if (only) child.only = [...only]
  child.mode = noMoreThan(child.mode, parent.mode) ?? parent.mode
}
