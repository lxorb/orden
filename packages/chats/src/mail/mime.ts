import {
  ascii,
  base64Lines,
  concat,
  decode,
  eightBit,
  fromBase64,
  fromLatin,
  latin,
  latinOnly,
  toBase64,
  withoutControls,
} from './bytes'

export interface Address {
  name: string
  address: string
}

interface Part {
  path: string
  type: string
  params: Record<string, string>
  disposition: string
  filename: string | null
  bytes: Uint8Array
}

export interface Parsed {
  headers: Map<string, string[]>
  text: string
  html: string | null
  attachments: Part[]
}

const WORD = /=\?([^?*]+)(?:\*[^?]*)?\?([BbQq])\?([^?]*)\?=/g

function wordBytes(how: string, data: string): Uint8Array {
  if (how.toUpperCase() === 'B') return fromBase64(data)
  return fromLatin(
    data
      .replace(/_/g, ' ')
      .replace(/=([0-9A-Fa-f]{2})/g, (_m, hex: string) =>
        String.fromCharCode(Number.parseInt(hex, 16)),
      ),
  )
}

export function decodeWords(text: string): string {
  const raw = /[\x80-\xff]/.test(text) && latinOnly(text) ? eightBit(fromLatin(text)) : text
  let out = ''
  let last = 0
  let run: { charset: string; bytes: Uint8Array[] } | null = null
  const flush = () => {
    if (run) out += decode(concat(run.bytes), run.charset)
    run = null
  }
  for (const found of raw.matchAll(WORD)) {
    const at = found.index
    const gap = raw.slice(last, at)
    const charset = (found[1] ?? '').toLowerCase()
    if (!run || gap.trim() || run.charset !== charset) {
      flush()
      out += gap
      run = { charset, bytes: [] }
    }
    run.bytes.push(wordBytes(found[2] ?? 'Q', found[3] ?? ''))
    last = at + found[0].length
  }
  flush()
  return out + raw.slice(last)
}

export function headersOf(block: string): Map<string, string[]> {
  const headers = new Map<string, string[]>()
  for (const line of block.replace(/\r?\n[ \t]+/g, ' ').split(/\r?\n/)) {
    const colon = line.indexOf(':')
    if (colon <= 0) continue
    const name = line.slice(0, colon).trim().toLowerCase()
    const list = headers.get(name) ?? []
    const value = line.slice(colon + 1).trim()
    list.push(/[\x80-\xff]/.test(value) ? eightBit(fromLatin(value)) : value)
    headers.set(name, list)
  }
  return headers
}

export function valueWithParams(text: string): { value: string; params: Record<string, string> } {
  const parts: string[] = []
  let current = ''
  let quoted = false
  for (const char of text) {
    if (char === '"') quoted = !quoted
    if (char === ';' && !quoted) {
      parts.push(current)
      current = ''
    } else current += char
  }
  parts.push(current)
  const params: Record<string, string> = {}
  const continued: Record<string, string[]> = {}
  for (const part of parts.slice(1)) {
    const eq = part.indexOf('=')
    if (eq < 0) continue
    const key = part.slice(0, eq).trim().toLowerCase()
    let value = part.slice(eq + 1).trim()
    if (value.startsWith('"') && value.endsWith('"')) {
      value = value.slice(1, -1).replace(/\\(.)/g, '$1')
    }
    const split = /^([^*]+)\*(\d+)\*?$/.exec(key)
    if (split?.[1] && split[2]) {
      const list = (continued[`${split[1]}*`] ??= [])
      list[Number(split[2])] = value
    } else params[key] = value
  }
  for (const [key, list] of Object.entries(continued)) params[key] = list.join('')
  const decoded: Record<string, string> = {}
  for (const key of Object.keys(params)) {
    if (!key.endsWith('*')) continue
    const raw = params[key] ?? ''
    const found = /^([^']*)'[^']*'(.*)$/.exec(raw)
    const bytes = fromLatin(
      (found?.[2] ?? raw).replace(/%([0-9A-Fa-f]{2})/g, (_m, hex: string) =>
        String.fromCharCode(Number.parseInt(hex, 16)),
      ),
    )
    decoded[key.slice(0, -1)] = decode(bytes, found?.[1]?.trim() ? found[1] : 'utf-8')
  }
  return { value: (parts[0] ?? '').trim().toLowerCase(), params: { ...params, ...decoded } }
}

export function addressesOf(text: string): Address[] {
  const out: Address[] = []
  for (const piece of splitOutside(decodeWords(text), ',')) {
    const angle = /^(.*)<([^>]*)>\s*$/.exec(piece)
    const address = (angle ? (angle[2] ?? '') : piece).trim()
    if (!address.includes('@')) continue
    const name = (angle?.[1] ?? '').trim().replace(/^"|"$/g, '').replace(/\\(.)/g, '$1')
    out.push({ name, address: address.toLowerCase() })
  }
  return out
}

function splitOutside(text: string, by: string): string[] {
  const out: string[] = []
  let current = ''
  let quoted = false
  let depth = 0
  for (const char of text) {
    if (char === '"') quoted = !quoted
    else if (!quoted && char === '<') depth++
    else if (!quoted && char === '>') depth--
    if (char === by && !quoted && depth <= 0) {
      out.push(current)
      current = ''
    } else current += char
  }
  out.push(current)
  return out
}

export function idsOf(text: string | undefined): string[] {
  return [...(text ?? '').matchAll(/<([^<>\s]+)>/g)].map((one) => one[1] ?? '').filter(Boolean)
}

function decodeBody(bytes: Uint8Array, encoding: string): Uint8Array {
  const how = encoding.trim().toLowerCase()
  if (how === 'base64') return fromBase64(bytes)
  if (how === 'quoted-printable') {
    return fromLatin(
      latin(bytes)
        .replace(/=\r?\n/g, '')
        .replace(/=([0-9A-Fa-f]{2})/g, (_m, hex: string) =>
          String.fromCharCode(Number.parseInt(hex, 16)),
        ),
    )
  }
  return bytes
}

function split(bytes: Uint8Array): { head: string; body: Uint8Array } {
  for (let at = bytes.indexOf(10); at >= 0; at = bytes.indexOf(10, at + 1)) {
    const next = bytes[at + 1] === 13 ? at + 2 : at + 1
    if (bytes[next] !== 10) continue
    const start = at > 0 && bytes[at - 1] === 13 ? at - 1 : at
    return { head: latin(bytes.subarray(0, start)), body: bytes.subarray(next + 1) }
  }
  return { head: latin(bytes), body: new Uint8Array(0) }
}

function found(bytes: Uint8Array, word: Uint8Array, from: number): number {
  const first = word[0] ?? 0
  for (let at = bytes.indexOf(first, from); at >= 0; at = bytes.indexOf(first, at + 1)) {
    let one = 1
    while (one < word.length && bytes[at + one] === word[one]) one++
    if (one === word.length) return at
  }
  return -1
}

function pieces(body: Uint8Array, boundary: string): Uint8Array[] {
  const word = ascii(`--${boundary}`)
  const out: Uint8Array[] = []
  let from = -1
  let search = 0
  for (let at = found(body, word, search); at >= 0; at = found(body, word, search)) {
    const after = at + word.length
    const next = body[after]
    const closing = next === 45 && body[after + 1] === 45
    const ends =
      next === undefined || closing || next === 32 || next === 9 || next === 13 || next === 10
    if ((at > 0 && body[at - 1] !== 10) || !ends) {
      search = at + 1
      continue
    }
    const floor = Math.max(from, 0)
    let start = at
    if (body[start - 1] === 10 && start - 1 >= floor) start--
    if (body[start - 1] === 13 && start - 1 >= floor) start--
    if (from >= 0) out.push(body.subarray(from, start))
    if (closing) return out
    let end = after
    while (body[end] === 32 || body[end] === 9) end++
    if (body[end] === 13) end++
    if (body[end] === 10) end++
    from = end
    search = end
  }
  if (from >= 0) out.push(body.subarray(from))
  return out
}

const BLANK = new Set([9, 10, 11, 12, 13, 32, 160])

function blank(bytes: Uint8Array): boolean {
  return bytes.every((one) => BLANK.has(one))
}

function walk(bytes: Uint8Array, path: string, into: Part[], fallback = 'text/plain'): void {
  const { head, body } = split(bytes)
  const headers = headersOf(head)
  const type = valueWithParams(headers.get('content-type')?.[0] ?? fallback)
  const disposition = valueWithParams(headers.get('content-disposition')?.[0] ?? '')
  if (type.value.startsWith('multipart/') && type.params.boundary) {
    const child = type.value === 'multipart/digest' ? 'message/rfc822' : 'text/plain'
    pieces(body, type.params.boundary).forEach((piece, at) => {
      if (!blank(piece)) walk(piece, path ? `${path}.${at + 1}` : String(at + 1), into, child)
    })
    return
  }
  const name = disposition.params.filename ?? type.params.name ?? null
  const decoded = decodeBody(body, headers.get('content-transfer-encoding')?.[0] ?? '7bit')
  into.push({
    path: path || '1',
    type: type.value,
    params: type.params,
    disposition: disposition.value,
    filename:
      name === null ? fallbackName(type.value, disposition.value, decoded) : decodeWords(name),
    bytes: decoded,
  })
}

const NAMED: Record<string, string> = {
  nbsp: ' ',
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  shy: '',
  zwnj: '',
  zwj: '',
  ensp: ' ',
  emsp: ' ',
  thinsp: ' ',
  auml: 'ä',
  ouml: 'ö',
  uuml: 'ü',
  Auml: 'Ä',
  Ouml: 'Ö',
  Uuml: 'Ü',
  szlig: 'ß',
  eacute: 'é',
  egrave: 'è',
  ecirc: 'ê',
  euml: 'ë',
  Eacute: 'É',
  aacute: 'á',
  agrave: 'à',
  acirc: 'â',
  aring: 'å',
  Aring: 'Å',
  aelig: 'æ',
  AElig: 'Æ',
  ccedil: 'ç',
  iacute: 'í',
  igrave: 'ì',
  icirc: 'î',
  iuml: 'ï',
  oacute: 'ó',
  ograve: 'ò',
  ocirc: 'ô',
  oslash: 'ø',
  Oslash: 'Ø',
  uacute: 'ú',
  ugrave: 'ù',
  ucirc: 'û',
  ntilde: 'ñ',
  Ntilde: 'Ñ',
  euro: '€',
  pound: '£',
  yen: '¥',
  cent: '¢',
  copy: '©',
  reg: '®',
  trade: '™',
  deg: '°',
  para: '¶',
  sect: '§',
  times: '×',
  divide: '÷',
  plusmn: '±',
  middot: '\u00b7',
  bull: '\u2022',
  hellip: '…',
  ndash: '–',
  mdash: '\u2014',
  lsquo: '‘',
  rsquo: '’',
  sbquo: '‚',
  ldquo: '“',
  rdquo: '”',
  bdquo: '„',
  laquo: '«',
  raquo: '»',
  lsaquo: '‹',
  rsaquo: '›',
  iexcl: '¡',
  iquest: '¿',
  rarr: '→',
  larr: '←',
}

function codePoint(code: number): string {
  if (
    !Number.isInteger(code) ||
    code <= 0 ||
    code > 0x10ffff ||
    (code >= 0xd800 && code <= 0xdfff)
  ) {
    return '\ufffd'
  }
  return String.fromCodePoint(code)
}

export function entities(text: string): string {
  return text.replace(
    /&(#[xX][0-9A-Fa-f]{1,8}|#\d{1,10}|[A-Za-z][A-Za-z0-9]{1,31});/g,
    (all, what: string) => {
      if (what.startsWith('#x') || what.startsWith('#X'))
        return codePoint(Number.parseInt(what.slice(2), 16))
      if (what.startsWith('#')) return codePoint(Number(what.slice(1)))
      return NAMED[what] ?? all
    },
  )
}

function linked(attributes: string, inner: string): string {
  const href = /\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(attributes)
  const url = entities(href?.[1] ?? href?.[2] ?? href?.[3] ?? '').trim()
  const words = entities(inner.replace(/<[^>]+>/g, '')).trim()
  if (!/^https?:\/\//i.test(url) || !words || words === url || words === url.replace(/\/$/, '')) {
    return inner
  }
  return `${inner} (${url})`
}

function textOfHtml(html: string): string {
  return entities(
    html
      .replace(/<!--[\s\S]*?(-->|$)/g, '')
      .replace(/<(script|style|head|title)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '')
      .replace(/\s+/g, ' ')
      .replace(/<a\b([^>]*)>([\s\S]*?)<\/a\s*>/gi, (_all, attributes: string, inner: string) =>
        linked(attributes, inner),
      )
      .replace(/<(br|hr)\b[^>]*>/gi, '\n')
      .replace(/<\/?(p|div|tr|li|ul|ol|table|h[1-6]|blockquote|pre)\b[^>]*>/gi, '\n')
      .replace(/<[^>]+>/g, ''),
  )
    .replace(/[ \t\u00a0]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

const EXTENSIONS: Record<string, string> = {
  'message/rfc822': 'eml',
  'text/calendar': 'ics',
  'image/jpeg': 'jpg',
  'application/octet-stream': 'bin',
  'text/plain': 'txt',
  'text/html': 'html',
}

function fallbackName(type: string, disposition: string, bytes: Uint8Array): string | null {
  if (type.startsWith('multipart/')) return null
  if ((type === 'text/plain' || type === 'text/html') && disposition !== 'attachment') return null
  if (type === 'message/rfc822') {
    const subject = decodeWords(headersOf(split(bytes).head).get('subject')?.[0] ?? '')
    const safe = withoutControls(subject)
      .replace(/[\\/:*?"<>|]+/g, ' ')
      .trim()
      .slice(0, 80)
    return `${safe || 'message'}.eml`
  }
  const sub = (type.split('/')[1] ?? '').replace(/^x-/, '').replace(/[^a-z0-9.+-]/g, '') || 'bin'
  const extension = EXTENSIONS[type] ?? sub
  return `${type.startsWith('image/') ? 'image' : 'attachment'}.${extension}`
}

export function parseMessage(bytes: Uint8Array): Parsed {
  const { head } = split(bytes)
  const parts: Part[] = []
  walk(bytes, '', parts)
  const words = (part: Part) => decode(part.bytes, part.params.charset ?? 'utf-8')
  const inline = (part: Part) => part.disposition !== 'attachment' && part.filename === null
  const plain = parts.find((part) => part.type === 'text/plain' && inline(part))
  const html = parts.find((part) => part.type === 'text/html' && inline(part))
  const htmlText = html ? words(html) : null
  return {
    headers: headersOf(head),
    text: plain ? words(plain).replace(/\r\n/g, '\n') : htmlText ? textOfHtml(htmlText) : '',
    html: htmlText,
    attachments: parts.filter((part) => part !== plain && part !== html && !inline(part)),
  }
}

const ORIGINAL =
  /^\s*-{2,}\s*(original message|ursprüngliche nachricht|message d'origine|mensaje original|messaggio originale|oorspronkelijk bericht)\s*-{2,}\s*$/i
const FROM_LINE = /^\s*\*?(from|von|de|da|van|od)\s*:\*?\s+\S/i
const SENT_LINE =
  /^\s*\*?(sent|gesendet|envoyé|enviado|inviato|verzonden|date|datum|odesláno)\s*:\*?\s+\S/i

function quotedHistory(lines: readonly string[]): number {
  for (let at = 1; at < lines.length; at++) {
    const line = lines[at] ?? ''
    if (ORIGINAL.test(line)) return at
    if (!FROM_LINE.test(line)) continue
    if (!lines.slice(at + 1, at + 5).some((one) => SENT_LINE.test(one))) continue
    const before = lines[at - 1] ?? ''
    return /^\s*_{8,}\s*$/.test(before) ? at - 1 : at
  }
  return -1
}

export function withoutQuote(text: string, reply = false): string {
  if (reply) {
    const all = text.split('\n')
    const cut = quotedHistory(all)
    const kept = cut > 0 ? all.slice(0, cut).join('\n').trim() : ''
    if (kept) return withoutQuote(kept)
  }
  const lines = text.replace(/\s+$/, '').split('\n')
  let end = lines.length
  while (end > 0 && (/^\s*>/.test(lines[end - 1] ?? '') || !(lines[end - 1] ?? '').trim())) end--
  if (end === lines.length) return text.trim()
  const said = lines[end - 1] ?? ''
  if (/(wrote|schrieb|a écrit|escribió|scrisse|schreef|написал)\s*:\s*$/i.test(said)) end--
  else if (end > 1 && /:\s*$/.test(said) && /^On |^Am |^Le /.test(lines[end - 2] ?? '')) end -= 2
  const kept = lines.slice(0, end).join('\n').trim()
  return kept || text.trim()
}

export interface Outgoing {
  from: Address
  to: readonly Address[]
  cc?: readonly Address[]
  subject: string
  text: string
  messageId: string
  inReplyTo?: string
  references?: readonly string[]
  date: Date
  attachments?: readonly { name: string; type: string; bytes: Uint8Array }[]
}

function encodeWords(text: string): string {
  if (/^[\x20-\x7e]*$/.test(text)) return text
  const words: string[] = []
  let chunk = ''
  for (const char of text) {
    if (new TextEncoder().encode(chunk + char).length > 45) {
      words.push(chunk)
      chunk = ''
    }
    chunk += char
  }
  if (chunk) words.push(chunk)
  return words.map((one) => `=?UTF-8?B?${toBase64(ascii(one))}?=`).join('\r\n ')
}

function addressText(one: Address): string {
  const plain = withoutControls(one.name).trim()
  if (!plain) return `<${one.address}>`
  const name = /^[\x20-\x7e]*$/.test(plain)
    ? `"${plain.replace(/[\\"]/g, (char) => `\\${char}`)}"`
    : encodeWords(plain)
  return `${name} <${one.address}>`
}

function attrValue(text: string): string {
  return encodeURIComponent(text).replace(
    /['()*!]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  )
}

function wrapped(text: string): string {
  return (text.match(/.{1,76}/g) ?? []).join('\r\n')
}

function rfcDate(date: Date): string {
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  const months = [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec',
  ]
  const two = (n: number) => String(n).padStart(2, '0')
  const offset = -date.getTimezoneOffset()
  const sign = offset >= 0 ? '+' : '-'
  const zone = `${sign}${two(Math.floor(Math.abs(offset) / 60))}${two(Math.abs(offset) % 60)}`
  return `${days[date.getDay()]}, ${date.getDate()} ${months[date.getMonth()]} ${date.getFullYear()} ${two(date.getHours())}:${two(date.getMinutes())}:${two(date.getSeconds())} ${zone}`
}

export function buildMessage(
  mail: Outgoing,
  boundary = `=_orden_${mail.messageId.split('@')[0]}`,
): Uint8Array {
  const head = [
    `From: ${addressText(mail.from)}`,
    `To: ${mail.to.map(addressText).join(', ')}`,
    ...(mail.cc?.length ? [`Cc: ${mail.cc.map(addressText).join(', ')}`] : []),
    `Subject: ${encodeWords(mail.subject)}`,
    `Date: ${rfcDate(mail.date)}`,
    `Message-ID: <${mail.messageId}>`,
    ...(mail.inReplyTo ? [`In-Reply-To: <${mail.inReplyTo}>`] : []),
    ...(mail.references?.length
      ? [`References: ${mail.references.map((id) => `<${id}>`).join('\r\n ')}`]
      : []),
    'MIME-Version: 1.0',
  ]
  const text = [
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: base64',
    '',
    wrapped(toBase64(ascii(mail.text.replace(/\r?\n/g, '\r\n')))),
  ]
  const files = mail.attachments ?? []
  if (!files.length) return ascii([...head, ...text, ''].join('\r\n'))
  const parts: Uint8Array[] = [
    ascii(
      [
        ...head,
        `Content-Type: multipart/mixed; boundary="${boundary}"`,
        '',
        `--${boundary}`,
        ...text,
      ].join('\r\n'),
    ),
  ]
  for (const file of files) {
    const said = [
      '',
      `--${boundary}`,
      `Content-Type: ${/^[\w.+-]+\/[\w.+-]+$/.test(file.type) ? file.type : 'application/octet-stream'}; name="${encodeWords(file.name).replace(/"/g, '')}"`,
      `Content-Disposition: attachment; filename*=utf-8''${attrValue(file.name)}`,
      'Content-Transfer-Encoding: base64',
      '',
      '',
    ]
    parts.push(ascii(said.join('\r\n')), base64Lines(file.bytes, 76))
  }
  parts.push(ascii(`\r\n--${boundary}--\r\n`))
  return concat(parts)
}
