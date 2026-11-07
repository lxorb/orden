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

export const quiet: Quiet = {
  level: 'silent',
  trace: nothing,
  debug: nothing,
  info: nothing,
  warn: nothing,
  error: nothing,
  fatal: nothing,
  child: () => quiet,
}

export default function pino(): Quiet {
  return quiet
}
