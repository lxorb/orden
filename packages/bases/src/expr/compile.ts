import { BasesError } from '../errors'
import type { Context, Row, Value } from '../types'
import { callGlobal, GLOBALS } from './globals'
import { fileField, indexed, member, taskField } from './members'
import { type Arg, callMethod } from './methods'
import { type Node, parseExpression } from './parse'
import { evaluation, spend } from './pattern'
import {
  add,
  arithmetic,
  compare,
  equal,
  fieldOf,
  FileRef,
  isDuration,
  NoteRef,
  type Scope,
  settled,
  subtract,
  TaskRef,
  ThisRef,
  truthy,
  type Val,
  weigh,
} from './runtime'

type Fn = (scope: Scope) => Val

const BOUND = new Set(['value', 'index', 'acc', 'values'])

const READS_OTHERS = new Set(['asFile', 'linksTo', 'backlinks'])

export interface Compiled {
  source: string
  local: boolean
  clock: boolean
  formulas: string[]
  run: (scope: Scope) => Val
  evaluate: (row: Row | null, context: Context, formulas?: Record<string, string>) => Value
}

interface Facts {
  local: boolean
  clock: boolean
  formulas: Set<string>
}

const CLOCK = new Set(['now', 'relative'])

const literal =
  (value: Val): Fn =>
  () =>
    value

function compileName(name: string): Fn {
  switch (name) {
    case 'file':
      return (scope) => (scope.row ? new FileRef(scope.row) : null)
    case 'note':
      return (scope) => (scope.row ? new NoteRef(scope.row) : null)
    case 'task':
      return (scope) => (scope.row?.task ? new TaskRef(scope.row) : null)
    case 'this':
      return (scope) => (scope.context.this ? new ThisRef(scope.context.this) : null)
    case 'formula':
      return () => null
    default:
      if (BOUND.has(name)) {
        return (scope) => {
          const locals = scope.locals
          if (locals && name in locals) return locals[name] ?? null
          return scope.row ? fieldOf(scope.row.note, name) : null
        }
      }
      return (scope) => (scope.row ? fieldOf(scope.row.note, name) : null)
  }
}

function compileMember(node: Extract<Node, { type: 'member' }>, facts: Facts): Fn {
  const { name } = node
  if (READS_OTHERS.has(name)) facts.local = false
  if (node.object.type === 'name' && !BOUND.has(node.object.name)) {
    switch (node.object.name) {
      case 'formula':
        facts.formulas.add(name)
        return (scope) => (scope.row ? scope.formula(name, scope.row) : null)
      case 'note':
        return (scope) => (scope.row ? fieldOf(scope.row.note, name) : null)
      case 'file':
        return (scope) => (scope.row ? fileField(scope.row, name, scope) : null)
      case 'task':
        return (scope) => (scope.row?.task ? taskField(scope.row, name, scope) : null)
    }
  }
  const object = compileNode(node.object, facts)
  return (scope) => member(object(scope), name, scope)
}

function thunks(args: readonly Fn[], scope: Scope): Arg[] {
  return args.map(
    (arg): Arg =>
      (locals) =>
        locals ? arg({ ...scope, locals: { ...scope.locals, ...locals } }) : arg(scope),
  )
}

const NODES_A_STEP = 32

function sizeOf(part: unknown): number {
  if (typeof part !== 'object' || part === null) return 0
  return Object.values(part).reduce<number>((sum, one) => sum + sizeOf(one), 1)
}

function compileCall(node: Extract<Node, { type: 'call' }>, facts: Facts): Fn {
  const args = node.args.map((arg) => compileNode(arg, facts))
  const { callee } = node
  if ((callee.type === 'name' || callee.type === 'member') && CLOCK.has(callee.name))
    facts.clock = true

  if (callee.type === 'name') {
    const name = callee.name
    if (!GLOBALS.has(name)) throw new BasesError(`There is no function ${name}()`, callee.at)
    if (name === 'file' || name === 'random') facts.local = false
    if (name === 'today' && !args.length)
      return (scope) => ({ kind: 'date', iso: scope.context.today })
    return (scope) => callGlobal(name, thunks(args, scope), scope)
  }

  if (callee.type === 'member') {
    if (READS_OTHERS.has(callee.name)) facts.local = false
    const receiver = compileNode(callee.object, facts)
    const name = callee.name
    const each = Math.floor(sizeOf(node.args) / NODES_A_STEP)
    return (scope) => {
      const on = receiver(scope)
      if (each > 0 && Array.isArray(on)) spend(on.length * each)
      return callMethod(on, name, thunks(args, scope), scope)
    }
  }

  throw new BasesError('Only a function or a method can be called', node.at)
}

function compileNode(node: Node, facts: Facts): Fn {
  switch (node.type) {
    case 'literal':
      return literal(node.value)
    case 'regex': {
      let pattern: RegExp
      try {
        pattern = new RegExp(node.pattern, node.flags)
      } catch {
        throw new BasesError(`/${node.pattern}/ is not a pattern`)
      }
      return literal(pattern)
    }
    case 'list': {
      const items = node.items.map((item) => compileNode(item, facts))
      return (scope) => {
        spend(items.length)
        return items.map((item) => item(scope)) as Value[]
      }
    }
    case 'object': {
      const entries = node.entries.map(([key, value]) => [key, compileNode(value, facts)] as const)
      return (scope) =>
        Object.fromEntries(entries.map(([key, value]) => [key, settled(value(scope))]))
    }
    case 'name':
      return compileName(node.name)
    case 'member':
      return compileMember(node, facts)
    case 'index': {
      if (
        node.object.type === 'name' &&
        node.object.name === 'formula' &&
        node.index.type === 'literal' &&
        typeof node.index.value === 'string'
      ) {
        const name = node.index.value
        facts.formulas.add(name)
        return (scope) => (scope.row ? scope.formula(name, scope.row) : null)
      }
      const object = compileNode(node.object, facts)
      const index = compileNode(node.index, facts)
      return (scope) => indexed(object(scope), index(scope), scope)
    }
    case 'call':
      return compileCall(node, facts)
    case 'unary': {
      const argument = compileNode(node.argument, facts)
      if (node.op === '!') return (scope) => !truthy(argument(scope))
      const sign = node.op === '-' ? -1 : 1
      return (scope) => {
        const value = argument(scope)
        if (typeof value === 'number') return sign * value
        if (isDuration(value))
          return { kind: 'duration', ms: sign * value.ms, months: sign * value.months }
        if (value === null) return null
        throw new BasesError(`Cannot negate ${typeof value}`)
      }
    }
    case 'logical': {
      const left = compileNode(node.left, facts)
      const right = compileNode(node.right, facts)
      return node.op === '&&'
        ? (scope) => {
            const value = left(scope)
            return truthy(value) ? right(scope) : value
          }
        : (scope) => {
            const value = left(scope)
            return truthy(value) ? value : right(scope)
          }
    }
    case 'binary': {
      const left = compileNode(node.left, facts)
      const right = compileNode(node.right, facts)
      switch (node.op) {
        case '==':
          return (scope) => equal(left(scope), right(scope), scope)
        case '!=':
          return (scope) => !equal(left(scope), right(scope), scope)
        case '<':
          return (scope) => (compare(left(scope), right(scope)) ?? NaN) < 0
        case '>':
          return (scope) => (compare(left(scope), right(scope)) ?? NaN) > 0
        case '<=':
          return (scope) => (compare(left(scope), right(scope)) ?? NaN) <= 0
        case '>=':
          return (scope) => (compare(left(scope), right(scope)) ?? NaN) >= 0
        case '+':
          return (scope) => add(left(scope), right(scope))
        case '-':
          return (scope) => subtract(left(scope), right(scope))
        case '*':
        case '/':
        case '%': {
          const op = node.op
          return (scope) => arithmetic(op, left(scope), right(scope))
        }
      }
    }
  }
}

export function formulaReader(
  formulas: Record<string, string>,
): (name: string, row: Row, scope: Scope) => Val {
  const compiled = new Map<string, Compiled>()
  const cache = new WeakMap<Row, Map<string, Val>>()
  const running = new Set<string>()

  return (name, row, scope) => {
    const kept = cache.get(row)?.get(name)
    if (kept !== undefined) return kept
    const source = Object.hasOwn(formulas, name) ? formulas[name] : undefined
    if (source === undefined) return null
    if (running.has(name)) throw new BasesError(`formula.${name} refers to itself`)

    let formula = compiled.get(name)
    if (!formula) {
      formula = compile(source)
      compiled.set(name, formula)
    }
    running.add(name)
    try {
      const value = formula.run({ ...scope, row, locals: null })
      const forRow = cache.get(row) ?? new Map<string, Val>()
      forRow.set(name, value)
      cache.set(row, forRow)
      return value
    } finally {
      running.delete(name)
    }
  }
}

export function scopeFor(
  row: Row | null,
  context: Context,
  formulas: Record<string, string> = {},
): Scope {
  const read = formulaReader(formulas)
  const scope: Scope = {
    row,
    context,
    locals: null,
    formula: (name, at) => read(name, at, scope),
  }
  return scope
}

const MOST_KEPT = 4000
const kept = new Map<string, Compiled>()

export function compile(source: string): Compiled {
  const known = kept.get(source)
  if (known) return known

  const facts: Facts = { local: true, clock: false, formulas: new Set() }
  const node = compileNode(parseExpression(source), facts)
  const run: Fn = (scope) => evaluation(node, scope, weigh)
  const compiled: Compiled = {
    source,
    local: facts.local,
    clock: facts.clock,
    formulas: [...facts.formulas],
    run,
    evaluate: (row, context, formulas) => settled(run(scopeFor(row, context, formulas))),
  }

  if (kept.size >= MOST_KEPT) kept.clear()
  kept.set(source, compiled)
  return compiled
}
