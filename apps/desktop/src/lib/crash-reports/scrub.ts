import { scrubbedLog } from '../feedback-log'

interface CrashFrame {
  module: string
  offset: string
  symbol?: string
}

interface CrashThread {
  name: string
  crashed?: boolean
  main?: boolean
  frames: CrashFrame[]
}

export interface CrashReport {
  v: number
  id: string
  kind: string
  at: number
  app: { version: string; channel: string; build: string }
  system: { os: string; osVersion: string; arch: string; engine: string }
  summary: string
  where?: string
  doing?: string
  held?: number
  killed?: boolean
  process?: string
  reason?: string
  threads?: CrashThread[]
  stack?: string
  breadcrumbs?: { at: number; what: string }[]
  log?: string[]
  open?: { windows: number; kinds: Record<string, number> }
  resources?: { memory?: number; cpu?: number; uptime?: number }
}

const SECRET_NAMES = String.raw`(?:pass(?:word|wd|phrase)?|pwd|secret|token|api[_-]?key|access[_-]?key|private[_-]?key|auth(?:orization)?|cookie|session)`

const NAMED_SECRET = new RegExp(
  String.raw`\b(${SECRET_NAMES})(\s*[:=]\s*)("[^"]*"|'[^']*'|\S+)`,
  'gi',
)

const BEARER = /\b(Bearer|Basic|Token)\s+[A-Za-z0-9._~+/=-]{6,}/gi

const KEYS = /\b(?:sk|pk|rk|ghp|gho|ghs|ghu|github_pat|xox[abpr]|AKIA|AIza)[-_A-Za-z0-9]{12,}/g

const OPAQUE =
  /(?<![\w.-])(?=[A-Za-z0-9_+/=-]*\d)(?=[A-Za-z0-9_+/=-]*[A-Za-z])[A-Za-z0-9_+/=-]{28,}(?![\w.-])/g

const COMMAND = /^[A-Za-z0-9_:.|-]{1,80}$/

const KIND = /^[a-z][a-z-]{0,23}$/

const NAME = /^[\w .:#()/-]{0,64}$/

const OFFSET = /^0x[0-9a-f]{1,16}$/i

const LOCATION = /^[\w.:\\/-]+\.rs:\d+:\d+$/

const SYMBOL = /^[\w$.:<>~@?, *&()[\]-]{1,200}$/

function secretsOut(text: string): string {
  return text
    .replace(BEARER, (_whole: string, kind: string) => `${kind} <token>`)
    .replace(KEYS, '<token>')
    .replace(
      NAMED_SECRET,
      (_whole: string, name: string, between: string) => `${name}${between}<hidden>`,
    )
    .replace(OPAQUE, '<token>')
}

export function scrubbedText(text: string): string {
  return secretsOut(scrubbedLog(text))
}

function moduleOf(said: string): string {
  const name = said.split(/[\\/]/).pop() ?? ''
  return NAME.test(name) && name ? name : '?'
}

function symbolOf(said: string | undefined): string | undefined {
  return said && SYMBOL.test(said) ? said : undefined
}

function frameOf(frame: CrashFrame): CrashFrame {
  const symbol = symbolOf(frame.symbol)
  return {
    module: moduleOf(frame.module),
    offset: OFFSET.test(frame.offset) ? frame.offset : '0x0',
    ...(symbol ? { symbol } : {}),
  }
}

function threadOf(thread: CrashThread): CrashThread {
  return {
    name: NAME.test(thread.name) ? thread.name : scrubbedText(thread.name).slice(0, 64),
    ...(thread.crashed ? { crashed: true } : {}),
    ...(thread.main ? { main: true } : {}),
    frames: thread.frames.slice(0, 64).map(frameOf),
  }
}

function placeOf(said: string): string {
  const trimmed = said.trim()
  if (!LOCATION.test(trimmed)) return scrubbedText(trimmed).slice(0, 200)
  return trimmed.split(/[\\/]/).slice(-4).join('/')
}

function doingOf(said: string): string {
  return said
    .split(' < ')
    .map((one) => {
      const [command, ...rest] = one.split(', ')
      return [command && COMMAND.test(command) ? command : '?', ...rest.map(scrubbedText)].join(
        ', ',
      )
    })
    .join(' < ')
}

function kindsOf(kinds: Record<string, number>): Record<string, number> {
  return Object.fromEntries(
    Object.entries(kinds).filter(
      ([kind, count]) => KIND.test(kind) && Number.isInteger(count) && count >= 0,
    ),
  )
}

export function scrubbedReport(report: CrashReport): CrashReport {
  const scrubbed: CrashReport = {
    v: report.v,
    id: report.id,
    kind: report.kind,
    at: report.at,
    app: report.app,
    system: report.system,
    summary: scrubbedText(report.summary).slice(0, 300),
  }
  if (report.where) scrubbed.where = placeOf(report.where)
  if (report.doing) scrubbed.doing = doingOf(report.doing)
  if (report.held !== undefined) scrubbed.held = report.held
  if (report.killed !== undefined) scrubbed.killed = report.killed
  if (report.process && KIND.test(report.process)) scrubbed.process = report.process
  if (report.reason) scrubbed.reason = scrubbedText(report.reason).slice(0, 80)
  if (report.threads?.length) scrubbed.threads = report.threads.slice(0, 64).map(threadOf)
  if (report.stack) scrubbed.stack = scrubbedText(report.stack).slice(0, 16 * 1024)
  if (report.breadcrumbs?.length) {
    scrubbed.breadcrumbs = report.breadcrumbs.filter((one) => COMMAND.test(one.what)).slice(-100)
  }
  if (report.log?.length) {
    scrubbed.log = scrubbedLog(report.log.slice(-200).join('\n'))
      .split('\n')
      .map((line) => secretsOut(line).slice(0, 2000))
  }
  if (report.open) {
    scrubbed.open = { windows: report.open.windows, kinds: kindsOf(report.open.kinds) }
  }
  if (report.resources) scrubbed.resources = report.resources
  return scrubbed
}
