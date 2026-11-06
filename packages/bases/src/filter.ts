import { compile } from './expr/compile'
import { type Scope, truthy } from './expr/runtime'
import type { Context, Filter, Row } from './types'
import { scopeFor } from './expr/compile'

export interface CompiledFilter {
  test: (scope: Scope) => boolean
  local: boolean
  clock: boolean
}

const ALWAYS: CompiledFilter = { test: () => true, local: true, clock: false }

function compileOne(filter: Filter): CompiledFilter {
  if (typeof filter === 'string') {
    const expression = compile(filter)
    return {
      local: expression.local,
      clock: expression.clock,
      test: (scope) => {
        try {
          return truthy(expression.run(scope))
        } catch {
          return false
        }
      },
    }
  }

  const [kind, members] =
    'and' in filter
      ? (['and', filter.and] as const)
      : 'or' in filter
        ? (['or', filter.or] as const)
        : (['not', filter.not] as const)
  const tests = members.map(compileOne)
  const local = tests.every((one) => one.local)
  const clock = tests.some((one) => one.clock)
  switch (kind) {
    case 'and':
      return { local, clock, test: (scope) => tests.every((one) => one.test(scope)) }
    case 'or':
      return { local, clock, test: (scope) => tests.some((one) => one.test(scope)) }
    case 'not':
      return { local, clock, test: (scope) => !tests.some((one) => one.test(scope)) }
  }
}

export function compileFilters(...filters: (Filter | undefined)[]): CompiledFilter {
  const present = filters.filter((one): one is Filter => one !== undefined)
  if (!present.length) return ALWAYS
  if (present.length === 1 && present[0] !== undefined) return compileOne(present[0])
  return compileOne({ and: present })
}

export function compileFilter(filter: Filter): (row: Row, context: Context) => boolean {
  const compiled = compileOne(filter)
  return (row, context) => compiled.test(scopeFor(row, context))
}

export function readFilter(raw: unknown): Filter | null {
  if (typeof raw === 'string') return raw
  if (typeof raw === 'number' || typeof raw === 'boolean') return String(raw)
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null
  const entries = Object.entries(raw as Record<string, unknown>)
  const [first] = entries
  if (entries.length !== 1 || !first) return null
  const [key, value] = first
  if ((key !== 'and' && key !== 'or' && key !== 'not') || !Array.isArray(value)) return null
  const members: Filter[] = []
  for (const one of value as unknown[]) {
    const read = readFilter(one)
    if (read === null) return null
    members.push(read)
  }
  return key === 'and' ? { and: members } : key === 'or' ? { or: members } : { not: members }
}
