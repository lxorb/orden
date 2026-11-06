import type { ModelInfo } from '../chat/types'
import type { Provider } from '../providers'

export interface Offered {
  provider: Provider
  models: readonly ModelInfo[]
}

export type Routed = { provider: Provider; model: string } | { refused: string }

const NAMED = 24

function parentFirst(offered: readonly Offered[], parent: Provider | null): Offered[] {
  if (!parent) return [...offered]
  const mine = offered.filter((one) => one.provider.id === parent.id)
  return [...mine, ...offered.filter((one) => one.provider.id !== parent.id)]
}

export function routed(want: string, offered: readonly Offered[], parent: Provider | null): Routed {
  const asked = want.trim().toLowerCase()
  const order = parentFirst(offered, parent)
  if (!asked) {
    const provider = parent ?? order[0]?.provider
    return provider ? { provider, model: '' } : { refused: 'there is no AI provider set up' }
  }

  const is = (one: ModelInfo) => one.id.toLowerCase() === asked || one.name.toLowerCase() === asked
  const holds = (one: ModelInfo) =>
    one.id.toLowerCase().includes(asked) || one.name.toLowerCase().includes(asked)
  for (const test of [is, holds]) {
    for (const { provider, models } of order) {
      const found = models.find(test)
      if (found) return { provider, model: found.id }
    }
  }

  const names = order.flatMap(({ models }) => models.map((one) => one.id)).slice(0, NAMED)
  return {
    refused: names.length
      ? `no model called "${want}" is offered. Models: ${names.join(', ')}`
      : `no model called "${want}" is offered`,
  }
}
