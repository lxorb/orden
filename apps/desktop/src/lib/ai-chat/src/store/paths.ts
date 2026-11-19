import { insideSpace, joinPath, spaceHolding } from '../../../platform/src/api'

export interface Here {
  root: string | null
  system: string
  spaces: readonly { readonly root: string }[]
  holds: (path: string) => boolean
  opens: (path: string) => boolean
  reveals: boolean
}
type Kind = 'absolute' | 'home' | 'relative'
const LINE = /:\d+(?::\d+)?$/
const DRIVE = /^[A-Za-z]:[\\/]/
const SHARE = /^\\\\[^\\/]+[\\/][^\\/]+/
const FOREIGN = /:\/\/|^\/\/|[\n\r\t<>"|*?$={}`]|^[@#~]?[\\/]?$|^[@#]/
const TOPS = new Set([
  'Applications',
  'Library',
  'System',
  'Users',
  'Volumes',
  'etc',
  'home',
  'media',
  'mnt',
  'opt',
  'private',
  'root',
  'run',
  'snap',
  'srv',
  'tmp',
  'usr',
  'var',
])
const spokenPath = (said: string): string => said.trim().replace(LINE, '')
function kindOf(path: string, system: string): Kind | null {
  if (!path || path.length > 1024 || FOREIGN.test(path)) return null
  const colon = path.indexOf(':')
  if (colon !== -1 && !(colon === 1 && DRIVE.test(path))) return null
  if (path.split(/[\\/]/).some((step) => step === '..')) return null
  if (/^~[\\/]/.test(path)) return 'home'
  if (system === 'windows' ? DRIVE.test(path) || SHARE.test(path) : path.startsWith('/')) return 'absolute'
  return /^[\\/]/.test(path) || DRIVE.test(path) ? null : 'relative'
}
const forward = (path: string) => path.replace(/\\/g, '/').replace(/^(?:\.\/)+/, '')
export function placeOf(said: string, here: Pick<Here, 'root' | 'system'>, home: string | null): string | null {
  const path = spokenPath(said)
  const kind = kindOf(path, here.system)
  if (kind === 'absolute') return path
  if (kind === 'home') return home === null ? null : joinPath(home, forward(path.slice(2)))
  return kind === 'relative' && here.root !== null ? insideSpace(here.root, forward(path)) : null
}
function linksTo(said: string, here: Here): boolean {
  const path = spokenPath(said)
  const kind = kindOf(path, here.system)
  if (kind === 'relative') {
    const at = placeOf(path, here, null)
    return at !== null && here.holds(at) && (here.reveals || here.opens(at))
  }
  if (kind === null) return false
  const inSpace = kind === 'absolute' && spaceHolding(here.spaces, path) !== null
  if (!here.reveals) return inSpace && here.opens(path)
  if (inSpace || kind === 'home' || here.system === 'windows') return true
  return TOPS.has(path.split('/')[1] ?? '')
}
const WRITTEN = /&(amp|lt|gt|quot|#39);/g
const WRITTEN_AS: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'" }
const unwritten = (html: string) => html.replace(WRITTEN, (whole, name: string) => WRITTEN_AS[name] ?? whole)
const written = (text: string) => text.replace(/[&<>"']/g, (one) => `&#${String(one.charCodeAt(0))};`)
const marked = (said: string, inner: string) => `<span class="chat-path" data-path="${written(said)}">${inner}</span>`
const LEADING = /^(?:[([{“‘]|&quot;|&#39;)+/
const TRAILING = /(?:[)\]}”’.,;:!?]|&quot;|&#39;)+$/
function wordsIn(text: string, here: Here): string {
  return text.replace(/[^\s]+/g, (word) => {
    const before = LEADING.exec(word)?.[0] ?? ''
    const rest = word.slice(before.length)
    const after = TRAILING.exec(rest)?.[0] ?? ''
    const core = rest.slice(0, rest.length - after.length)
    const said = unwritten(core)
    if (!core || /&#?\w+;/.test(said) || !linksTo(said, here)) return word
    return before + marked(said, core) + after
  })
}
const TAG = /<(\/?)([a-zA-Z][\w-]*)[^>]*>/g
const SHUT = new Set(['a', 'pre', 'button', 'svg', 'math', 'script', 'style', 'textarea', 'select'])
export function withPaths(html: string, here: Here): string {
  let out = ''
  let from = 0
  let shut = 0
  TAG.lastIndex = 0
  for (let tag = TAG.exec(html); tag; tag = TAG.exec(html)) {
    const text = html.slice(from, tag.index)
    out += shut ? text : wordsIn(text, here)
    const [whole, closing, name = ''] = tag
    const lower = name.toLowerCase()
    from = tag.index + whole.length
    if (SHUT.has(lower)) shut = Math.max(0, shut + (closing ? -1 : 1))
    if (lower !== 'code' || closing || shut) {
      out += whole
      continue
    }
    const end = html.indexOf('</code>', from)
    if (end === -1) {
      out += whole
      continue
    }
    const inner = html.slice(from, end)
    const said = unwritten(inner)
    const code = whole + inner + '</code>'
    out += !inner.includes('<') && linksTo(said, here) ? marked(said.trim(), code) : code
    from = end + '</code>'.length
    TAG.lastIndex = from
  }
  return out + (shut ? html.slice(from) : wordsIn(html.slice(from), here))
}
