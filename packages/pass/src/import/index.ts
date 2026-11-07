import { ImportError, textOf } from './build'
import type { Files } from './build'
import { parseBitwarden } from './bitwarden'
import { parseBrave, parseChrome, parseEdge } from './chromium'
import { csvHeader } from './csv'
import { parseDashlane } from './dashlane'
import { parseEnpass } from './enpass'
import { parseFirefox } from './firefox'
import { csvLooksLike, parseCsv } from './generic'
import { parseKaspersky } from './kaspersky'
import { parseKeePass } from './keepass'
import { parseKeePassXC } from './keepassxc'
import { parseKeeper } from './keeper'
import { parseLastPass } from './lastpass'
import { parseNordPass } from './nordpass'
import { parseOnePassword } from './onepassword'
import { parseOrden } from './orden'
import { parseProton } from './proton'
import { parseRoboForm } from './roboform'
import { parseSafari } from './safari'
import type { SourceId } from './sources'
import { extensionOf, needsZip } from './sources'
import type { Imported } from './types'

export type { Imported, ImportedItem, ImportedVault, Skipped } from './types'
export type { Files } from './build'
export { ImportError } from './build'
export { SOURCES, SOURCE_IDS, needsZip, sourceOf } from './sources'
export type { Source, SourceId } from './sources'

type Parser = (data: string | Files) => Imported

function textOnly(parse: (text: string) => Imported): Parser {
  return (data) => {
    if (typeof data !== 'string') throw new ImportError('This kind of export is not an archive.')
    return parse(data)
  }
}

const PARSERS: Record<SourceId, Parser> = {
  proton: parseProton,
  bitwarden: textOnly(parseBitwarden),
  onepassword: parseOnePassword,
  lastpass: textOnly(parseLastPass),
  chrome: textOnly(parseChrome),
  edge: textOnly(parseEdge),
  brave: textOnly(parseBrave),
  firefox: textOnly(parseFirefox),
  safari: textOnly(parseSafari),
  keepass: textOnly(parseKeePass),
  keepassxc: textOnly(parseKeePassXC),
  dashlane: parseDashlane,
  keeper: textOnly(parseKeeper),
  roboform: textOnly(parseRoboForm),
  nordpass: textOnly(parseNordPass),
  enpass: textOnly(parseEnpass),
  kaspersky: textOnly(parseKaspersky),
  orden: textOnly(parseOrden),
  csv: textOnly(parseCsv),
}

export function importFile(
  source: SourceId,
  name: string,
  data: Uint8Array | Record<string, Uint8Array>,
): Imported {
  if (data instanceof Uint8Array) {
    if (needsZip(source, name)) throw new ImportError('Open the archive before reading it.')
    return PARSERS[source](textOf(data))
  }
  return PARSERS[source](data)
}

function jsonSource(text: string): SourceId | null {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    return null
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null
  const root = value as Record<string, unknown>
  const has = (key: string): boolean => key in root
  if (root.format === 'orden-pass' || root.format === 'orden-pass-sealed') return 'orden'
  if (has('vaults') && (has('userId') || has('version'))) return 'proton'
  if (has('encrypted') && (has('items') || has('folders') || has('collections') || has('data'))) {
    return 'bitwarden'
  }
  if (has('records') || has('shared_folders')) return 'keeper'
  if (Array.isArray(root.items)) {
    const first: unknown = root.items[0]
    const item =
      first !== null && typeof first === 'object' ? (first as Record<string, unknown>) : {}
    if ('template_type' in item || 'category' in item) return 'enpass'
    if ('login' in item || 'type' in item) return 'bitwarden'
  }
  if (has('accounts')) return 'onepassword'
  return null
}

function csvSource(name: string, header: readonly string[]): SourceId | null {
  const names = new Set(header.map((one) => one.trim().toLowerCase()))
  const all = (...wanted: string[]): boolean => wanted.every((one) => names.has(one))
  if (all('folder', 'favorite', 'type', 'name', 'login_uri')) return 'bitwarden'
  if (all('url', 'username', 'password', 'extra', 'name', 'grouping')) return 'lastpass'
  if (all('url', 'username', 'password', 'httprealm')) return 'firefox'
  if (all('group', 'title', 'username', 'password', 'url', 'notes')) return 'keepassxc'
  if (all('username', 'username2', 'password')) return 'dashlane'
  if (all('name', 'url', 'matchurl', 'login', 'pwd')) return 'roboform'
  if (all('name', 'url', 'additional_urls') || all('cardholdername', 'cardnumber', 'type')) {
    return 'nordpass'
  }
  if (all('type', 'name', 'url', 'email', 'username', 'password', 'vault')) return 'proton'
  if (all('title', 'url', 'username', 'password', 'otpauth')) {
    return names.has('archived') || names.has('favorite') || names.has('tags')
      ? 'onepassword'
      : 'safari'
  }
  if (all('cc_number') || all('account_holder') || all('place_of_issue')) return 'dashlane'
  if (all('name', 'url', 'username', 'password') && names.size <= 5) {
    const lower = name.toLowerCase()
    if (lower.includes('edge')) return 'edge'
    if (lower.includes('brave')) return 'brave'
    return 'chrome'
  }
  if (csvLooksLike(header)) return 'csv'
  return null
}

export function guessSource(name: string, text: string): SourceId | null {
  const extension = extensionOf(name)
  const lower = name.toLowerCase()
  if (extension === '.1pux' || extension === '.1pif') return 'onepassword'
  if (extension === '.zip') {
    if (lower.includes('dashlane')) return 'dashlane'
    if (lower.includes('1password')) return 'onepassword'
    return 'proton'
  }
  const body = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
  const start = body.trimStart()
  if (start.includes('***5642bee8-a5ff-11dc-8314-0800200c9a66***')) return 'onepassword'
  if (start.startsWith('<'))
    return /<KeePassFile[\s>]/.test(start.slice(0, 4096)) ? 'keepass' : null
  if (start.startsWith('-----BEGIN PGP')) return 'proton'
  if (start.startsWith('{') || start.startsWith('[')) return jsonSource(start)
  if (/^(Websites|Applications|Other Accounts|Notes)\s*$/m.test(start.slice(0, 200))) {
    if (/^(Website name|Application|Account name|Name):/m.test(start)) return 'kaspersky'
  }
  const header = csvHeader(start)
  const fromHeader = csvSource(name, header)
  if (fromHeader !== null) return fromHeader
  if (header.length >= 6 && extension === '.csv' && lower.includes('keeper')) return 'keeper'
  return null
}
