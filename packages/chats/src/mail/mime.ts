import { ascii, decode, fromBase64, fromLatin, latin, toBase64 } from './bytes'

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

export function decodeWords(text: string): string {
  return text
    .replace(/(=\?[^?]+\?[BbQq]\?[^?]*\?=)\s+(?==\?)/g, '$1')
    .replace(
      /=\?([^?*]+)(?:\*[^?]*)?\?([BbQq])\?([^?]*)\?=/g,
      (_all, charset: string, how: string, data: string) => {
        const bytes =
          how.toUpperCase() === 'B'
            ? fromBase64(data)
            : fromLatin(
                data
                  .replace(/_/g, ' ')
                  .replace(/=([0-9A-Fa-f]{2})/g, (_m, hex: string) =>
                    String.fromCharCode(Number.parseInt(hex, 16)),
                  ),
              )
        return decode(bytes, charset)
      },
    )
}

export function headersOf(block: string): Map<string, string[]> {
  const headers = new Map<string, string[]>()
  for (const line of block.replace(/\r?\n[ \t]+/g, ' ').split(/\r?\n/)) {
    const colon = line.indexOf(':')
    if (colon <= 0) continue
    const name = line.slice(0, colon).trim().toLowerCase()
    const list = headers.get(name) ?? []
    const value = line.slice(colon + 1).trim()
    list.push(/[\x80-\xff]/.test(value) ? decode(fromLatin(value)) : value)
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
  if (how === 'base64') return fromBase64(latin(bytes))
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
  const text = latin(bytes)
  const found = /\r?\n\r?\n/.exec(text)
  if (!found) return { head: text, body: new Uint8Array(0) }
  return { head: text.slice(0, found.index), body: bytes.subarray(found.index + found[0].length) }
}

function walk(bytes: Uint8Array, path: string, into: Part[], fallback = 'text/plain'): void {
  const { head, body } = split(bytes)
  const headers = headersOf(head)
  const type = valueWithParams(headers.get('content-type')?.[0] ?? fallback)
  const disposition = valueWithParams(headers.get('content-disposition')?.[0] ?? '')
  if (type.value.startsWith('multipart/') && type.params.boundary) {
    const boundary = `--${type.params.boundary}`
    const text = latin(body)
    const pieces = text.split(new RegExp(`\\r?\\n?${escape(boundary)}(?:--)?[ \\t]*\\r?\\n?`))
    const inner = text.includes(`${boundary}--`) ? pieces.slice(1, -1) : pieces.slice(1)
    const child = type.value === 'multipart/digest' ? 'message/rfc822' : 'text/plain'
    inner.forEach((piece, at) => {
      if (piece.trim())
        walk(fromLatin(piece), path ? `${path}.${at + 1}` : String(at + 1), into, child)
    })
    return
  }
  const name = disposition.params.filename ?? type.params.name ?? null
  into.push({
    path: path || '1',
    type: type.value,
    params: type.params,
    disposition: disposition.value,
    filename: name === null ? null : decodeWords(name),
    bytes: decodeBody(body, headers.get('content-transfer-encoding')?.[0] ?? '7bit'),
  })
}

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function textOfHtml(html: string): string {
  return html
    .replace(/<(script|style|head)[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|li|h[1-6]|blockquote)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_m, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&amp;/g, '&')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
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

export function withoutQuote(text: string): string {
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
  if (!one.name) return `<${one.address}>`
  const name = /^[\w .-]*$/.test(one.name) ? `"${one.name}"` : encodeWords(one.name)
  return `${name} <${one.address}>`
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
  const parts = [
    [
      ...head,
      `Content-Type: multipart/mixed; boundary="${boundary}"`,
      '',
      `--${boundary}`,
      ...text,
    ].join('\r\n'),
    ...files.map((file) =>
      [
        `--${boundary}`,
        `Content-Type: ${file.type || 'application/octet-stream'}; name="${encodeWords(file.name).replace(/"/g, '')}"`,
        `Content-Disposition: attachment; filename*=utf-8''${encodeURIComponent(file.name)}`,
        'Content-Transfer-Encoding: base64',
        '',
        wrapped(toBase64(file.bytes)),
      ].join('\r\n'),
    ),
    `--${boundary}--`,
    '',
  ]
  return ascii(parts.join('\r\n'))
}
