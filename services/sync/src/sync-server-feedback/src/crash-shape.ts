import { sha256 } from '../../sync-server/src/api'

const CRASH_KINDS = ['panic', 'crash', 'freeze', 'engine', 'js', 'exit'] as const
type CrashKind = (typeof CRASH_KINDS)[number]

const CHANNELS = ['stable', 'unstable'] as const

const MOST = {
  version: 64,
  build: 64,
  os: 40,
  osVersion: 64,
  arch: 20,
  engine: 120,
  summary: 300,
  where: 300,
  doing: 300,
  process: 40,
  reason: 40,
  threadName: 120,
  module: 200,
  offset: 24,
  symbol: 500,
  stack: 16 * 1024,
  what: 300,
  line: 2000,
  kind: 40,
} as const

const MANY = { threads: 64, frames: 64, breadcrumbs: 100, log: 200, kinds: 50 } as const

interface CrashFrame {
  module: string
  offset: string
  symbol?: string | undefined
}

interface CrashThread {
  name: string
  crashed?: boolean | undefined
  main?: boolean | undefined
  frames: CrashFrame[]
}

export interface CrashReport {
  v: 1
  id: string
  kind: CrashKind
  at: number
  app: { version: string; channel: (typeof CHANNELS)[number]; build: string }
  system: { os: string; osVersion: string; arch: string; engine: string }
  summary: string
  where?: string | undefined
  doing?: string | undefined
  held?: number | undefined
  killed?: boolean | undefined
  process?: string | undefined
  reason?: string | undefined
  threads?: CrashThread[] | undefined
  stack?: string | undefined
  breadcrumbs?: { at: number; what: string }[] | undefined
  log?: string[] | undefined
  open?: { windows: number; kinds: Record<string, number> } | undefined
  resources?:
    | { memory?: number | undefined; cpu?: number | undefined; uptime?: number | undefined }
    | undefined
}

class Wrong extends Error {}

type Raw = Record<string, unknown>

function isObject(value: unknown): value is Raw {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function cut(value: string, most: number): string {
  return value.length > most ? value.slice(0, most) : value
}

function absent(value: unknown): value is null | undefined {
  return value === undefined || value === null
}

function textOf(value: unknown, label: string, most: number): string {
  if (typeof value !== 'string') throw new Wrong(`${label} must be text`)
  return cut(value, most)
}

function numberOf(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Wrong(`${label} must be a number`)
  }
  return value
}

function flagOf(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') throw new Wrong(`${label} must be true or false`)
  return value
}

function objectOf(value: unknown, label: string): Raw {
  if (!isObject(value)) throw new Wrong(`${label} must be an object`)
  return value
}

function listOf(value: unknown, label: string, most: number): unknown[] {
  if (!Array.isArray(value)) throw new Wrong(`${label} must be a list`)
  return value.slice(0, most)
}

function maybe<T>(value: unknown, read: (value: unknown) => T): T | undefined {
  return absent(value) ? undefined : read(value)
}

function oneOf<T extends string>(value: unknown, label: string, among: readonly T[]): T {
  const found = among.find((one) => one === value)
  if (!found) throw new Wrong(`${label} must be one of ${among.join(', ')}`)
  return found
}

function baseName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path
}

function frameOf(value: unknown, label: string): CrashFrame {
  const frame = objectOf(value, label)
  return {
    module: baseName(textOf(frame.module, `${label}.module`, MOST.module)),
    offset: textOf(frame.offset, `${label}.offset`, MOST.offset).toLowerCase(),
    symbol: maybe(frame.symbol, (one) => textOf(one, `${label}.symbol`, MOST.symbol)),
  }
}

function threadOf(value: unknown, label: string): CrashThread {
  const thread = objectOf(value, label)
  return {
    name: textOf(thread.name, `${label}.name`, MOST.threadName),
    crashed: maybe(thread.crashed, (one) => flagOf(one, `${label}.crashed`)),
    main: maybe(thread.main, (one) => flagOf(one, `${label}.main`)),
    frames: listOf(thread.frames, `${label}.frames`, MANY.frames).map((one, index) =>
      frameOf(one, `${label}.frames[${index}]`),
    ),
  }
}

function openOf(value: unknown): NonNullable<CrashReport['open']> {
  const open = objectOf(value, 'open')
  const kinds: Record<string, number> = {}
  for (const [kind, many] of Object.entries(objectOf(open.kinds, 'open.kinds')).slice(
    0,
    MANY.kinds,
  )) {
    kinds[cut(kind, MOST.kind)] = numberOf(many, `open.kinds.${kind}`)
  }
  return { windows: numberOf(open.windows, 'open.windows'), kinds }
}

function resourcesOf(value: unknown): NonNullable<CrashReport['resources']> {
  const resources = objectOf(value, 'resources')
  return {
    memory: maybe(resources.memory, (one) => numberOf(one, 'resources.memory')),
    cpu: maybe(resources.cpu, (one) => numberOf(one, 'resources.cpu')),
    uptime: maybe(resources.uptime, (one) => numberOf(one, 'resources.uptime')),
  }
}

function reportOf(sent: Raw): CrashReport {
  if (sent.v !== 1) throw new Wrong('v must be 1')

  const id = sent.id
  if (typeof id !== 'string' || !/^[0-9a-f]{32}$/.test(id)) {
    throw new Wrong('id must be 32 hex digits')
  }

  const app = objectOf(sent.app, 'app')
  const system = objectOf(sent.system, 'system')

  return {
    v: 1,
    id,
    kind: oneOf(sent.kind, 'kind', CRASH_KINDS),
    at: numberOf(sent.at, 'at'),
    app: {
      version: textOf(app.version, 'app.version', MOST.version),
      channel: oneOf(app.channel, 'app.channel', CHANNELS),
      build: textOf(app.build, 'app.build', MOST.build),
    },
    system: {
      os: textOf(system.os, 'system.os', MOST.os),
      osVersion: textOf(system.osVersion, 'system.osVersion', MOST.osVersion),
      arch: textOf(system.arch, 'system.arch', MOST.arch),
      engine: textOf(system.engine, 'system.engine', MOST.engine),
    },
    summary: textOf(sent.summary, 'summary', MOST.summary),
    where: maybe(sent.where, (one) => textOf(one, 'where', MOST.where)),
    doing: maybe(sent.doing, (one) => textOf(one, 'doing', MOST.doing)),
    held: maybe(sent.held, (one) => numberOf(one, 'held')),
    killed: maybe(sent.killed, (one) => flagOf(one, 'killed')),
    process: maybe(sent.process, (one) => textOf(one, 'process', MOST.process)),
    reason: maybe(sent.reason, (one) => textOf(one, 'reason', MOST.reason)),
    threads: maybe(sent.threads, (one) =>
      listOf(one, 'threads', MANY.threads).map((thread, index) =>
        threadOf(thread, `threads[${index}]`),
      ),
    ),
    stack: maybe(sent.stack, (one) => textOf(one, 'stack', MOST.stack)),
    breadcrumbs: maybe(sent.breadcrumbs, (one) =>
      listOf(one, 'breadcrumbs', MANY.breadcrumbs).map((crumb, index) => {
        const label = `breadcrumbs[${index}]`
        const read = objectOf(crumb, label)
        return {
          at: numberOf(read.at, `${label}.at`),
          what: textOf(read.what, `${label}.what`, MOST.what),
        }
      }),
    ),
    log: maybe(sent.log, (one) =>
      listOf(one, 'log', MANY.log).map((line, index) => textOf(line, `log[${index}]`, MOST.line)),
    ),
    open: maybe(sent.open, openOf),
    resources: maybe(sent.resources, resourcesOf),
  }
}

export function crashReportOf(sent: unknown): CrashReport | string {
  if (!isObject(sent)) return 'send a JSON object'
  try {
    return reportOf(sent)
  } catch (error) {
    if (error instanceof Wrong) return error.message
    throw error
  }
}

function withoutNumbers(text: string): string {
  return text.replace(/0x[0-9a-f]+/gi, '0x#').replace(/\d+/g, '#')
}

function withoutPlace(where: string): string {
  return where.replace(/(:\d+){1,2}$/, '')
}

function scriptName(location: string): string {
  const file = baseName(withoutPlace(location).replace(/[?#].*$/, ''))
  return file.replace(/-[\w-]{8}(?=\.[a-z]+$)/, '')
}

export function scriptFrames(stack: string): string[] {
  const frames: string[] = []
  for (const line of stack.split('\n')) {
    if (frames.length === 3) break
    const v8 = /^\s*at\s+(?:(.+?)\s+\()?([^()]+)\)?\s*$/.exec(line)
    const webkit = v8 ? null : /^\s*([^@\s]+)?@(\S+:\d+(?::\d+)?)\s*$/.exec(line)
    const found = v8 ?? webkit
    if (!found) continue
    frames.push(`${found[1] ?? '<anonymous>'} ${scriptName(found[2] ?? '')}`)
  }
  return frames
}

function chosenThread(threads: CrashThread[] | undefined): CrashThread | undefined {
  if (!threads?.length) return undefined
  return threads.find((one) => one.crashed) ?? threads.find((one) => one.main) ?? threads[0]
}

function frameName(frame: CrashFrame): string {
  return frame.symbol ? `${frame.module}!${frame.symbol}` : `${frame.module}+${frame.offset}`
}

function signingParts(report: CrashReport): string[] {
  switch (report.kind) {
    case 'panic':
      return [withoutPlace(report.where ?? ''), withoutNumbers(report.summary)]
    case 'js':
      return [withoutNumbers(report.summary), ...scriptFrames(report.stack ?? '')]
    case 'crash':
    case 'freeze': {
      const frames = (chosenThread(report.threads)?.frames ?? []).slice(0, 6).map(frameName)
      return report.kind === 'freeze' ? [...frames, report.doing ?? ''] : frames
    }
    case 'engine':
      return [report.process ?? '', report.reason ?? '']
    case 'exit':
      return [report.system.os]
  }
}

export async function signatureOf(report: CrashReport): Promise<string> {
  return (await sha256([report.kind, ...signingParts(report)].join('\n'))).slice(0, 16)
}

const MOST_TITLE = 200

export function titleOf(report: CrashReport): string {
  const top = chosenThread(report.threads)?.frames[0]
  const topName = top ? (top.symbol ?? frameName(top)) : null
  const title = (() => {
    switch (report.kind) {
      case 'panic':
        return report.where ? `${report.summary} at ${withoutPlace(report.where)}` : report.summary
      case 'js':
        return report.summary
      case 'crash':
        return topName ? `${report.summary} in ${topName}` : report.summary
      case 'freeze': {
        const held = report.held === undefined ? '' : `${Math.round(report.held / 1000)} s `
        const doing = report.doing ?? topName ?? report.summary
        return `${held}in ${doing}${report.killed ? ', killed' : ''}`
      }
      case 'engine':
        return `${report.process ?? 'engine'} ${report.reason ?? 'failed'}`
      case 'exit':
        return report.system.os
    }
  })()
  return cut(title.replace(/\s+/g, ' ').trim() || report.kind, MOST_TITLE)
}
