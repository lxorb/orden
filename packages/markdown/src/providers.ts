import { EMBEDDABLE } from './embeddable'

export type Shape = 'video' | number

export interface Provider {
  id: string
  name: string
  mark: 'play' | 'open'
  shape: Shape
  sandbox: string
  allow?: string
}

export interface WebEmbed {
  provider: Provider
  frame: string
  href: string
}

export interface Listed {
  id: string
  name: string
  mark: 'play' | 'open'
  shape: Shape
  hosts: readonly string[]
  frames: readonly (readonly [from: string, to: string])[]
}

interface Row extends Provider {
  hosts: readonly string[]
  frame: (url: URL) => string | null
}

const ID = /^[\w-]{1,64}$/

const NAME = /^[\w.-]{1,80}$/

function parts(url: URL): string[] {
  return url.pathname.split('/').filter(Boolean)
}

function id(piece: string | undefined): string | null {
  return piece !== undefined && ID.test(piece) ? piece : null
}

function quoted(url: URL): string {
  return encodeURIComponent(url.toString())
}

const YOUTUBE = 'allow-scripts allow-same-origin allow-presentation'
const PLAYER = 'encrypted-media; picture-in-picture; fullscreen'

const ROWS: readonly Row[] = [
  {
    id: 'youtube',
    name: 'YouTube',
    mark: 'play',
    hosts: ['youtube.com', 'm.youtube.com', 'youtube-nocookie.com', 'youtu.be'],
    shape: 'video',
    sandbox: YOUTUBE,
    allow: PLAYER,
    frame: (url) => {
      const path = parts(url)
      const named = url.hostname.endsWith('youtu.be')
        ? path[0]
        : (url.searchParams.get('v') ?? undefined)
      const shorts = path[0] === 'shorts' || path[0] === 'embed' || path[0] === 'live'
      const video = id(shorts ? path[1] : named)
      if (video === null) return null

      const at = seconds(url.searchParams.get('t'))
      return `https://www.youtube-nocookie.com/embed/${video}${at === null ? '' : `?start=${at}`}`
    },
  },
  {
    id: 'vimeo',
    name: 'Vimeo',
    mark: 'play',
    hosts: ['vimeo.com', 'player.vimeo.com'],
    shape: 'video',
    sandbox: YOUTUBE,
    allow: PLAYER,
    frame: (url) => {
      const path = parts(url)
      const video = id(path[0] === 'video' ? path[1] : path[0])
      return video === null || !/^\d+$/.test(video)
        ? null
        : `https://player.vimeo.com/video/${video}`
    },
  },
  {
    id: 'x',
    name: 'X',
    mark: 'open',
    hosts: ['x.com', 'twitter.com', 'mobile.twitter.com'],
    shape: 520,
    sandbox: 'allow-scripts allow-same-origin allow-popups',
    frame: (url) => {
      const path = parts(url)
      const post = path[1] === 'status' || path[1] === 'statuses' ? id(path[2]) : null
      return post === null || !/^\d+$/.test(post)
        ? null
        : `https://platform.twitter.com/embed/Tweet.html?id=${post}`
    },
  },
  {
    id: 'spotify',
    name: 'Spotify',
    mark: 'play',
    hosts: ['open.spotify.com', 'spotify.com'],
    shape: 152,
    sandbox: YOUTUBE,
    allow: 'encrypted-media',
    frame: (url) => {
      const path = parts(url)
      const from = path[0]?.startsWith('intl-') ? 1 : 0
      const kind = path[from]
      const thing = id(path[from + 1])
      if (thing === null || kind === undefined) return null
      if (!['track', 'album', 'playlist', 'episode', 'show', 'artist'].includes(kind)) return null

      return `https://open.spotify.com/embed/${kind}/${thing}`
    },
  },
  {
    id: 'soundcloud',
    name: 'SoundCloud',
    mark: 'play',
    hosts: ['soundcloud.com'],
    shape: 166,
    sandbox: YOUTUBE,
    frame: (url) =>
      parts(url).length < 2 ? null : `https://w.soundcloud.com/player/?url=${quoted(url)}`,
  },
  {
    id: 'figma',
    name: 'Figma',
    mark: 'open',
    hosts: ['figma.com'],
    shape: 'video',
    sandbox: YOUTUBE,
    frame: (url) => {
      const kind = parts(url)[0]
      if (kind === undefined || !['file', 'design', 'proto', 'board', 'slides'].includes(kind)) {
        return null
      }

      return `https://www.figma.com/embed?embed_host=orden&url=${quoted(url)}`
    },
  },
  {
    id: 'codepen',
    name: 'CodePen',
    mark: 'open',
    hosts: ['codepen.io'],
    shape: 400,
    sandbox: 'allow-scripts allow-same-origin',
    frame: (url) => {
      const path = parts(url)
      const who = path[0] !== undefined && NAME.test(path[0]) ? path[0] : null
      const pen = path[1] === 'pen' || path[1] === 'details' ? id(path[2]) : null
      return who === null || pen === null
        ? null
        : `https://codepen.io/${who}/embed/${pen}?default-tab=result`
    },
  },
  {
    id: 'loom',
    name: 'Loom',
    mark: 'play',
    hosts: ['loom.com'],
    shape: 'video',
    sandbox: YOUTUBE,
    allow: PLAYER,
    frame: (url) => {
      const path = parts(url)
      const video = id(path[0] === 'share' || path[0] === 'embed' ? path[1] : undefined)
      return video === null ? null : `https://www.loom.com/embed/${video}`
    },
  },
  {
    id: 'maps',
    name: 'Google Maps',
    mark: 'open',
    hosts: ['google.com', 'maps.google.com', 'goo.gl', 'maps.app.goo.gl'],
    shape: 'video',
    sandbox: YOUTUBE,
    frame: (url) => {
      if (url.hostname.endsWith('goo.gl')) return null

      const path = parts(url)
      if (path[0] !== 'maps' && url.pathname !== '/maps') return null

      const asked = url.searchParams.get('q') ?? placeOf(path) ?? pointOf(url.pathname)
      return asked === null
        ? null
        : `https://www.google.com/maps?q=${encodeURIComponent(asked)}&output=embed`
    },
  },
]

function placeOf(path: readonly string[]): string | null {
  if (path[1] !== 'place' || path[2] === undefined) return null

  try {
    return decodeURIComponent(path[2]).replace(/\+/g, ' ') || null
  } catch {
    return null
  }
}

function pointOf(pathname: string): string | null {
  const found = /@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/.exec(pathname)
  return found === null ? null : `${found[1]},${found[2]}`
}

function seconds(written: string | null): number | null {
  if (written === null) return null

  const plain = /^(\d+)s?$/.exec(written)
  if (plain) return Number(plain[1])

  const parsed = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/.exec(written)
  if (!parsed || parsed[0] === '') return null

  const total = Number(parsed[1] ?? 0) * 3600 + Number(parsed[2] ?? 0) * 60 + Number(parsed[3] ?? 0)
  return total > 0 ? total : null
}

function hostOf(url: URL): string {
  return url.hostname.toLowerCase().replace(/^www\./, '')
}

const LISTED = 'allow-scripts'

const PIECE = /^[\w.:=@~-]{1,120}$/

function filled(template: string, found: RegExpExecArray, url: URL): string | null {
  for (const marker of template.matchAll(/\$\d/g)) {
    const piece = found[Number(marker[0].slice(1))]
    if (piece === undefined || !PIECE.test(piece)) return null
  }

  return template.replace(/\$(?:path|url|\d)/g, (marker) => {
    if (marker === '$path') return url.pathname
    if (marker === '$url') return quoted(url)

    return found[Number(marker.slice(1))] ?? ''
  })
}

function listedFrame(row: Listed, url: URL): string | null {
  for (const [from, to] of row.frames) {
    const found = new RegExp(from).exec(url.pathname)
    if (found === null) continue

    const frame = filled(to, found, url)
    if (frame !== null) return frame
  }

  return null
}

function listed(url: URL, host: string): WebEmbed | null {
  for (const row of EMBEDDABLE) {
    if (!row.hosts.includes(host)) continue

    const frame = listedFrame(row, url)
    if (frame === null) continue

    return { provider: plainly(row), frame, href: url.toString() }
  }

  return null
}

function plainly(row: Listed): Provider {
  return { id: row.id, name: row.name, mark: row.mark, shape: row.shape, sandbox: LISTED }
}

export function webEmbed(address: string): WebEmbed | null {
  let url: URL
  try {
    url = new URL(address.trim())
  } catch {
    return null
  }

  if (url.protocol !== 'https:') return null

  const host = hostOf(url)
  for (const row of ROWS) {
    if (!row.hosts.includes(host)) continue

    const frame = row.frame(url)
    if (frame === null) return null

    return { provider: named(row), frame, href: url.toString() }
  }

  return listed(url, host)
}

function named(row: Row): Provider {
  return {
    id: row.id,
    name: row.name,
    mark: row.mark,
    shape: row.shape,
    sandbox: row.sandbox,
    ...(row.allow === undefined ? {} : { allow: row.allow }),
  }
}

export function providers(): Provider[] {
  return [...ROWS.map(named), ...EMBEDDABLE.map(plainly)]
}
