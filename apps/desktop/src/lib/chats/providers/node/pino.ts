import { log } from '../../../log'

interface Quiet {
  level: string
  trace(...args: unknown[]): void
  debug(...args: unknown[]): void
  info(...args: unknown[]): void
  warn(...args: unknown[]): void
  error(...args: unknown[]): void
  fatal(...args: unknown[]): void
  child(...args: unknown[]): Quiet
}

const nothing = () => undefined

const SAID_AT_MOST = 50

const said = new Set<string>()

function wordsOf(args: readonly unknown[]): string {
  return args
    .map((one) => {
      if (typeof one === 'string') return one
      if (one instanceof Error) return one.message
      const error =
        (one as { err?: unknown; error?: unknown } | null)?.err ??
        (one as { error?: unknown } | null)?.error
      if (error instanceof Error) return error.message
      if (typeof error === 'string') return error
      return ''
    })
    .filter(Boolean)
    .join(': ')
}

function told(args: readonly unknown[]): void {
  const words = wordsOf(args)
  if (!words || said.has(words) || said.size >= SAID_AT_MOST) return
  said.add(words)
  log('error', `WhatsApp: ${words}`)
}

export const quiet: Quiet = {
  level: 'error',
  trace: nothing,
  debug: nothing,
  info: nothing,
  warn: nothing,
  error: (...args) => told(args),
  fatal: (...args) => told(args),
  child: () => quiet,
}

export default function pino(): Quiet {
  return quiet
}
