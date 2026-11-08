import type { Quiet } from '../whatsapp-log'

const nothing = () => undefined

const silent: Quiet = {
  level: 'silent',
  trace: nothing,
  debug: nothing,
  info: nothing,
  warn: nothing,
  error: nothing,
  fatal: nothing,
  child: () => silent,
}

export default function pino(): Quiet {
  return silent
}
