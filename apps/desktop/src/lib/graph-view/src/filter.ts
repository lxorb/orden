import { backtracksWildly } from '@orden/markdown/pattern-cost'
import type { GraphNode } from '../../graph/src/api'
import { aKindOfLine, type Query } from '@orden/scan/search/query'

export type Keeps = (node: GraphNode) => boolean

export function graphFilter(query: Query): Keeps | null {
  switch (query.kind) {
    case 'all': {
      const parts = known(query.of.map((one) => graphFilter(one)))
      return parts.length ? (node) => parts.every((one) => one(node)) : null
    }

    case 'any': {
      const parts = query.of.map((one) => graphFilter(one))
      const told = known(parts)
      if (told.length < parts.length) return null
      return (node) => told.some((one) => one(node))
    }

    case 'not': {
      const inner = graphFilter(query.of)
      return inner ? (node) => !inner(node) : null
    }

    case 'text': {
      const wanted = folded(query.text, query.fold)
      return (node) =>
        folded(node.name, query.fold).includes(wanted) ||
        folded(node.id, query.fold).includes(wanted)
    }

    case 'path': {
      const wanted = folded(query.text, query.fold)
      return (node) => folded(node.id, query.fold).includes(wanted)
    }

    case 'file': {
      const wanted = folded(query.text, query.fold)
      return (node) => folded(node.name, query.fold).includes(wanted)
    }

    case 'tag': {
      const wanted = query.tag
      return (node) => node.tags.some((tag) => tag === wanted || tag.startsWith(`${wanted}/`))
    }

    case 'regex': {
      const pattern = compiled(query.source, query.fold)
      if (!pattern) return null
      return (node) => {
        pattern.lastIndex = 0
        return pattern.test(node.name)
      }
    }

    case 'scope':
      return aKindOfLine(query.unit) ? null : graphFilter(query.of)

    case 'property':
    case 'content':
      return null
  }
}

function known(parts: readonly (Keeps | null)[]): Keeps[] {
  return parts.filter((one): one is Keeps => one !== null)
}

function folded(text: string, fold: boolean): string {
  return fold ? text.toLowerCase() : text
}

function compiled(source: string, fold: boolean): RegExp | null {
  try {
    return backtracksWildly(source, 'u') ? null : new RegExp(source, fold ? 'iu' : 'u')
  } catch {
    return null
  }
}
