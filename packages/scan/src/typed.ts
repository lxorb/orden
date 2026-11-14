import { isWebAddress } from './web-address'
import { isOwnPage } from './own-pages'
import { TOP_LEVEL_DOMAINS } from './tlds'

export const SEARCH = 'https://www.google.com/search?q=%s'

export const WORDS = '%s'

function searchOn(engine: string, words: string): string {
  return engine.replaceAll(WORDS, encodeURIComponent(words))
}

const HOST =
  /^(?:localhost|\[[0-9a-f:.]+\]|\d{1,3}(?:\.\d{1,3}){3}|[^\s/?#@]+\.[^\s/?#@.]{2,}|[a-z\d-]+(?=:\d))(?::\d{1,5})?(?:[/?#]|$)/i

const NOT_HOSTS = new Set(['tel', 'sms', 'mailto', 'news', 'urn', 'magnet', 'about', 'data'])

const OWN_NAMES = /(?:^|\.)(?:localhost|local|lan|internal|home\.arpa)$/i

function isOwnHost(host: string): boolean {
  const name = host.toLowerCase().replace(/^\[|\]$/g, '')
  if (!name.includes('.') && !name.includes(':')) return true
  if (OWN_NAMES.test(name)) return true

  const four = /^(\d+)\.(\d+)\.\d+\.\d+$/.exec(name)
  if (four) {
    const [a, b] = [Number(four[1]), Number(four[2])]
    return (
      a === 127 ||
      a === 10 ||
      a === 0 ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 169 && b === 254)
    )
  }
  return name === '::1' || /^f[cd][\da-f]{0,2}:/.test(name) || /^fe[89ab][\da-f]?:/.test(name)
}

function schemeFor(typed: string): 'http' | 'https' {
  let parsed: URL
  try {
    parsed = new URL(`http://${typed}`)
  } catch {
    return 'https'
  }
  if (isOwnHost(parsed.hostname)) return 'http'
  return parsed.port && parsed.port !== '443' ? 'http' : 'https'
}

const CLOCK = /^(?:[01]?\d|2[0-3]):[0-5]\d$/

function noName(typed: string): boolean {
  if (typed.startsWith('[')) return false
  if (/^https?:\D/i.test(typed)) return true
  const name = typed.split(/[/?#:]/, 1)[0] ?? ''
  if (name.includes('..')) return true
  if (typed[name.length] === ':') return false
  return /\.\d+$/.test(name) && !/^\d{1,3}(?:\.\d{1,3}){3}$/.test(name)
}

function namesASite(typed: string): boolean {
  const name = typed.split(/[/?#:]/, 1)[0] ?? ''
  if (typed.length > name.length || name.startsWith('[')) return true

  let host: string
  try {
    host = new URL(`http://${name}`).hostname
  } catch {
    return false
  }
  const last = host.split('.').at(-1) ?? ''
  return isOwnHost(host) || /^\d+$/.test(last) || TOP_LEVEL_DOMAINS.has(last)
}

function isHost(typed: string): boolean {
  if (!HOST.test(typed) || CLOCK.test(typed) || noName(typed) || !namesASite(typed)) return false
  const word = /^([a-z\d-]+):\d/i.exec(typed)?.[1]
  return !word || !NOT_HOSTS.has(word.toLowerCase())
}

const SCHEME = /^([a-z][a-z\d+.-]*):/i

const KNOWN_SCHEMES = new Set([
  ...NOT_HOSTS,
  'http',
  'https',
  'file',
  'ftp',
  'ws',
  'wss',
  'javascript',
  'vbscript',
  'blob',
  'filesystem',
  'view-source',
  'orden',
  'nib',
])

function hasScheme(said: string): boolean {
  const word = SCHEME.exec(said)?.[1]
  if (word === undefined) return false

  const rest = said.slice(word.length + 1)
  return rest.startsWith('//') || (KNOWN_SCHEMES.has(word.toLowerCase()) && !/^\s/.test(rest))
}

export interface HalfTyped {
  value: string
  typed: string
  from: number
  to: number
  over: string
}

const WINDOWS_PATH = /^(?:[a-z]:(?!\s)(?!\d{1,5}(?:[/?#]|$))|(?:~|\.{1,2})?\\)/i

const FILE_SCHEME = /^(?:file|smb|afp|nfs|cifs):/i

const UNIX_PATH = /^(?:~|\.{1,2})?\/(?!\/)/

export function isLocalFile(typed: string): boolean {
  const said = typed.trim()
  return WINDOWS_PATH.test(said) || FILE_SCHEME.test(said) || UNIX_PATH.test(said)
}

const WORD_AND_WORD = /^[^\s:/?#@]+:(?!:)\S+$/

const NAME_AT_HOST = /^[^\s:/?#@]+:\S.*@/

const NAMES_A_SECRET =
  /^(?:password|passwd|passcode|passphrase|pwd|secret|token|api[-_]?key|passwort|kennwort|mot de passe|contrase\u00f1a|contrasena|senha|wachtwoord|l\u00f6senord|losenord|has\u0142o|\u043f\u0430\u0440\u043e\u043b\u044c|\u5bc6\u7801|\u5bc6\u78bc|\u30d1\u30b9\u30ef\u30fc\u30c9|\ube44\ubc00\ubc88\ud638)\s*[:\uff1a]/iu

export function mayBeSecret(typed: string): boolean {
  const said = typed.trim()
  if (CLOCK.test(said)) return false
  return WORD_AND_WORD.test(said) || NAME_AT_HOST.test(said) || NAMES_A_SECRET.test(said)
}

function asTheEngineSays(address: string): string {
  return /[^ -~]/.test(address) ? new URL(address).href : address
}

export function typedAddress(typed: string): string | null {
  const said = typed.trim()
  if (!said || WINDOWS_PATH.test(said)) return null

  const host = said.startsWith('//') ? said.slice(2) : said
  if (said.startsWith('//') || isHost(said)) {
    const guessed = `${schemeFor(host)}://${host}`
    return isWebAddress(guessed) ? asTheEngineSays(guessed) : null
  }

  if (hasScheme(said)) {
    const whole = said.replace(/^https?:(?!\/\/)/i, '$&//')
    return isWebAddress(whole) ? asTheEngineSays(whole) : null
  }

  return null
}

export function webAddress(typed: string, engine = SEARCH): string | null {
  const said = typed.trim()
  if (!said) return null

  const address = typedAddress(said)
  if (address !== null) return address
  if (said.startsWith('//') || isHost(said) || hasScheme(said)) return null
  if (isLocalFile(said) || mayBeSecret(said)) return null

  return searchOn(engine, said)
}

export type Unopened = 'nothing' | 'own page' | 'file' | 'link'

export function unopened(typed: string): Unopened {
  const said = typed.trim()
  if (!said) return 'nothing'
  if (isOwnPage(said.toLowerCase())) return 'own page'
  return isLocalFile(said) ? 'file' : 'link'
}

export function dotCom(typed: string): string | null {
  const said = typed.trim()
  if (!said || /[\s/?#@:.]/.test(said)) return null

  const guessed = `https://www.${said}.com`
  return isWebAddress(guessed) ? guessed : null
}
