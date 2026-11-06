import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { format, resolveConfig } from 'prettier'

const ROOT = new URL('../', import.meta.url)
const TARGET = fileURLToPath(new URL('packages/markdown/src/embeddable.ts', ROOT))
const HAND_WRITTEN = fileURLToPath(new URL('packages/markdown/src/providers.ts', ROOT))

const REGISTRY = 'https://oembed.com/providers.json'

interface Rule {
  id: string
  name: string
  mark: 'play' | 'open'
  shape: 'video' | number
  hosts: string[]
  oembed: string | null
  frames: [from: string, to: string][]
}

const TWITCH = 'parent=localhost&parent=tauri.localhost&autoplay=false'

const RULES: Rule[] = [
  {
    id: 'drive',
    name: 'Google Drive',
    mark: 'open',
    shape: 720,
    hosts: ['drive.google.com'],
    oembed: null,
    frames: [['^/file/d/([\\w-]+)', 'https://drive.google.com/file/d/$1/preview']],
  },
  {
    id: 'gdocs',
    name: 'Google Docs',
    mark: 'open',
    shape: 720,
    hosts: ['docs.google.com'],
    oembed: null,
    frames: [
      ['^/document/d/([\\w-]+)', 'https://docs.google.com/document/d/$1/preview'],
      ['^/spreadsheets/d/([\\w-]+)', 'https://docs.google.com/spreadsheets/d/$1/preview'],
      ['^/forms/d/e/([\\w-]+)', 'https://docs.google.com/forms/d/e/$1/viewform?embedded=true'],
      ['^/forms/d/([\\w-]+)', 'https://docs.google.com/forms/d/$1/viewform?embedded=true'],
    ],
  },
  {
    id: 'gslides',
    name: 'Google Slides',
    mark: 'open',
    shape: 'video',
    hosts: ['docs.google.com'],
    oembed: null,
    frames: [['^/presentation/d/([\\w-]+)', 'https://docs.google.com/presentation/d/$1/embed']],
  },
  {
    id: 'miro',
    name: 'Miro',
    mark: 'open',
    shape: 'video',
    hosts: ['miro.com'],
    oembed: 'Miro',
    frames: [['^/app/board/([\\w=-]+)', 'https://miro.com/app/live-embed/$1/']],
  },
  {
    id: 'twitch',
    name: 'Twitch',
    mark: 'play',
    shape: 'video',
    hosts: ['twitch.tv', 'm.twitch.tv', 'player.twitch.tv'],
    oembed: null,
    frames: [
      ['^/videos/(\\d+)', `https://player.twitch.tv/?video=$1&${TWITCH}`],
      ['^/(\\w+)/clip/([\\w-]+)', `https://clips.twitch.tv/embed?clip=$2&${TWITCH}`],
      ['^/(\\w+)$', `https://player.twitch.tv/?channel=$1&${TWITCH}`],
    ],
  },
  {
    id: 'twitch-clip',
    name: 'Twitch',
    mark: 'play',
    shape: 'video',
    hosts: ['clips.twitch.tv'],
    oembed: null,
    frames: [['^/([\\w-]+)$', `https://clips.twitch.tv/embed?clip=$1&${TWITCH}`]],
  },
  {
    id: 'tiktok',
    name: 'TikTok',
    mark: 'play',
    shape: 740,
    hosts: ['tiktok.com'],
    oembed: 'TikTok',
    frames: [
      ['^/@[\\w.-]+/video/(\\d+)', 'https://www.tiktok.com/embed/v2/$1'],
      ['^/embed/v2/(\\d+)', 'https://www.tiktok.com/embed/v2/$1'],
      ['^/v/(\\d+)', 'https://www.tiktok.com/embed/v2/$1'],
    ],
  },
  {
    id: 'gist',
    name: 'GitHub Gist',
    mark: 'open',
    shape: 400,
    hosts: ['gist.github.com'],
    oembed: null,
    frames: [['^/([\\w-]+)/([0-9a-f]{7,64})', 'https://gist.github.com/$1/$2.pibb']],
  },
  {
    id: 'typeform',
    name: 'Typeform',
    mark: 'open',
    shape: 560,
    hosts: ['form.typeform.com'],
    oembed: null,
    frames: [['^/to/([\\w-]+)', 'https://form.typeform.com/to/$1']],
  },
  {
    id: 'sketchfab',
    name: 'Sketchfab',
    mark: 'open',
    shape: 'video',
    hosts: ['sketchfab.com'],
    oembed: 'Sketchfab',
    frames: [
      ['^/3d-models/[\\w-]*-([0-9a-f]{12,40})$', 'https://sketchfab.com/models/$1/embed'],
      ['^/models/([0-9a-f]{12,40})', 'https://sketchfab.com/models/$1/embed'],
    ],
  },
  {
    id: 'dailymotion',
    name: 'Dailymotion',
    mark: 'play',
    shape: 'video',
    hosts: ['dailymotion.com'],
    oembed: 'Dailymotion',
    frames: [['^/video/(\\w+)', 'https://geo.dailymotion.com/player.html?video=$1']],
  },
  {
    id: 'ted',
    name: 'TED',
    mark: 'play',
    shape: 'video',
    hosts: ['ted.com'],
    oembed: 'TED',
    frames: [['^/talks/([\\w-]+)', 'https://embed.ted.com/talks/$1']],
  },
  {
    id: 'reddit',
    name: 'Reddit',
    mark: 'open',
    shape: 500,
    hosts: ['reddit.com'],
    oembed: 'Reddit',
    frames: [
      ['^/r/(\\w+)/comments/(\\w+)', 'https://www.redditmedia.com/r/$1/comments/$2/?embed=true'],
    ],
  },
  {
    id: 'giphy',
    name: 'GIPHY',
    mark: 'open',
    shape: 'video',
    hosts: ['giphy.com'],
    oembed: 'GIPHY',
    frames: [
      ['^/gifs/[\\w-]*-(\\w+)$', 'https://giphy.com/embed/$1'],
      ['^/gifs/(\\w+)$', 'https://giphy.com/embed/$1'],
      ['^/clips/[\\w-]*-(\\w+)$', 'https://giphy.com/embed/$1'],
      ['^/embed/(\\w+)', 'https://giphy.com/embed/$1'],
    ],
  },
  {
    id: 'streamable',
    name: 'Streamable',
    mark: 'play',
    shape: 'video',
    hosts: ['streamable.com'],
    oembed: 'Streamable',
    frames: [
      ['^/e/(\\w+)$', 'https://streamable.com/e/$1'],
      ['^/(\\w+)$', 'https://streamable.com/e/$1'],
    ],
  },
  {
    id: 'mixcloud',
    name: 'Mixcloud',
    mark: 'play',
    shape: 120,
    hosts: ['mixcloud.com'],
    oembed: 'MixCloud',
    frames: [['^/[\\w-]+/[\\w-]+/?$', 'https://www.mixcloud.com/widget/iframe/?feed=$url']],
  },
  {
    id: 'codesandbox',
    name: 'CodeSandbox',
    mark: 'open',
    shape: 500,
    hosts: ['codesandbox.io'],
    oembed: 'CodeSandbox',
    frames: [
      ['^/s/([\\w-]+)', 'https://codesandbox.io/embed/$1'],
      ['^/p/sandbox/([\\w-]+)', 'https://codesandbox.io/embed/$1'],
      ['^/embed/([\\w-]+)', 'https://codesandbox.io/embed/$1'],
    ],
  },
  {
    id: 'stackblitz',
    name: 'StackBlitz',
    mark: 'open',
    shape: 500,
    hosts: ['stackblitz.com'],
    oembed: null,
    frames: [['^/edit/([\\w.-]+)', 'https://stackblitz.com/edit/$1?embed=1']],
  },
  {
    id: 'replit',
    name: 'Replit',
    mark: 'open',
    shape: 500,
    hosts: ['replit.com'],
    oembed: 'Replit',
    frames: [['^/@([\\w-]+)/([\\w.-]+)', 'https://replit.com/@$1/$2?embed=true']],
  },
  {
    id: 'observable',
    name: 'Observable',
    mark: 'open',
    shape: 500,
    hosts: ['observablehq.com'],
    oembed: 'Observable',
    frames: [
      ['^/@([\\w-]+)/([\\w-]+)', 'https://observablehq.com/embed/@$1/$2'],
      ['^/d/(\\w+)', 'https://observablehq.com/embed/d/$1'],
    ],
  },
  {
    id: 'jsfiddle',
    name: 'JSFiddle',
    mark: 'open',
    shape: 400,
    hosts: ['jsfiddle.net'],
    oembed: null,
    frames: [['^/([\\w-]+)/([\\w-]+)/?$', 'https://jsfiddle.net/$1/$2/embedded/']],
  },
  {
    id: 'apple-music',
    name: 'Apple Music',
    mark: 'play',
    shape: 175,
    hosts: ['music.apple.com'],
    oembed: null,
    frames: [
      [
        '^/[\\w-]+/(?:album|song|playlist|artist|music-video)/',
        'https://embed.music.apple.com$path',
      ],
    ],
  },
  {
    id: 'apple-podcasts',
    name: 'Apple Podcasts',
    mark: 'play',
    shape: 175,
    hosts: ['podcasts.apple.com'],
    oembed: 'Apple Podcasts',
    frames: [['^/[\\w-]+/podcast/', 'https://embed.podcasts.apple.com$path']],
  },
  {
    id: 'deezer',
    name: 'Deezer',
    mark: 'play',
    shape: 300,
    hosts: ['deezer.com'],
    oembed: null,
    frames: [
      [
        '^/(?:[\\w-]+/)?(album|playlist|track|show|episode)/(\\d+)',
        'https://widget.deezer.com/widget/dark/$1/$2',
      ],
    ],
  },
  {
    id: 'desmos',
    name: 'Desmos',
    mark: 'open',
    shape: 'video',
    hosts: ['desmos.com'],
    oembed: null,
    frames: [
      ['^/calculator/(\\w+)', 'https://www.desmos.com/calculator/$1?embed'],
      ['^/geometry/(\\w+)', 'https://www.desmos.com/geometry/$1?embed'],
    ],
  },
  {
    id: 'geogebra',
    name: 'GeoGebra',
    mark: 'open',
    shape: 'video',
    hosts: ['geogebra.org'],
    oembed: null,
    frames: [
      ['^/m/(\\w+)', 'https://www.geogebra.org/material/iframe/id/$1'],
      ['^/material/iframe/id/(\\w+)', 'https://www.geogebra.org/material/iframe/id/$1'],
    ],
  },
  {
    id: 'calendly',
    name: 'Calendly',
    mark: 'open',
    shape: 700,
    hosts: ['calendly.com'],
    oembed: null,
    frames: [['^/[\\w-]+/[\\w-]+', 'https://calendly.com$path']],
  },
  {
    id: 'canva',
    name: 'Canva',
    mark: 'open',
    shape: 'video',
    hosts: ['canva.com'],
    oembed: 'Canva',
    frames: [
      ['^/design/([\\w-]+)/([\\w-]+)/view', 'https://www.canva.com/design/$1/$2/view?embed'],
    ],
  },
  {
    id: 'whimsical',
    name: 'Whimsical',
    mark: 'open',
    shape: 'video',
    hosts: ['whimsical.com'],
    oembed: 'Whimsical',
    frames: [['^/([\\w-]+-\\w{12,})$', 'https://whimsical.com/embed/$1']],
  },
  {
    id: 'flourish',
    name: 'Flourish',
    mark: 'open',
    shape: 'video',
    hosts: ['public.flourish.studio'],
    oembed: 'Flourish',
    frames: [
      ['^/visualisation/(\\d+)', 'https://flo.uri.sh/visualisation/$1/embed'],
      ['^/story/(\\d+)', 'https://flo.uri.sh/story/$1/embed'],
    ],
  },
  {
    id: 'datawrapper',
    name: 'Datawrapper',
    mark: 'open',
    shape: 500,
    hosts: ['datawrapper.dwcdn.net'],
    oembed: 'Datawrapper',
    frames: [['^/(\\w+)/(\\d+)', 'https://datawrapper.dwcdn.net/$1/$2/']],
  },
  {
    id: 'pinterest',
    name: 'Pinterest',
    mark: 'open',
    shape: 600,
    hosts: ['pinterest.com'],
    oembed: 'Pinterest',
    frames: [['^/pin/(\\d+)', 'https://assets.pinterest.com/ext/embed.html?id=$1']],
  },
  {
    id: 'instagram',
    name: 'Instagram',
    mark: 'open',
    shape: 700,
    hosts: ['instagram.com'],
    oembed: 'Instagram',
    frames: [
      ['^/p/([\\w-]+)', 'https://www.instagram.com/p/$1/embed'],
      ['^/reel/([\\w-]+)', 'https://www.instagram.com/reel/$1/embed'],
      ['^/[\\w.]+/p/([\\w-]+)', 'https://www.instagram.com/p/$1/embed'],
    ],
  },
  {
    id: 'bluesky',
    name: 'Bluesky',
    mark: 'open',
    shape: 400,
    hosts: ['bsky.app'],
    oembed: 'Bluesky Social',
    frames: [
      [
        '^/profile/([\\w.:-]+)/post/(\\w+)',
        'https://embed.bsky.app/embed/$1/app.bsky.feed.post/$2',
      ],
    ],
  },
  {
    id: 'acast',
    name: 'Acast',
    mark: 'play',
    shape: 175,
    hosts: ['play.acast.com'],
    oembed: 'Acast',
    frames: [['^/s/([\\w-]+)/([\\w-]+)', 'https://embed.acast.com/$1/$2']],
  },
  {
    id: 'arcgis',
    name: 'ArcGIS StoryMaps',
    mark: 'open',
    shape: 'video',
    hosts: ['storymaps.arcgis.com'],
    oembed: 'ArcGIS StoryMaps',
    frames: [['^/stories/(\\w+)', 'https://storymaps.arcgis.com/stories/$1']],
  },
  {
    id: 'padlet',
    name: 'Padlet',
    mark: 'open',
    shape: 600,
    hosts: ['padlet.com'],
    oembed: 'Padlet',
    frames: [['^/[\\w-]+/([\\w-]+)$', 'https://padlet.com/embed/$1']],
  },
  {
    id: 'airtable',
    name: 'Airtable',
    mark: 'open',
    shape: 600,
    hosts: ['airtable.com'],
    oembed: null,
    frames: [
      ['^/app\\w+/(shr\\w+)', 'https://airtable.com/embed/$1'],
      ['^/embed/(shr\\w+)', 'https://airtable.com/embed/$1'],
      ['^/(shr\\w+)', 'https://airtable.com/embed/$1'],
    ],
  },
  {
    id: 'imgur',
    name: 'Imgur',
    mark: 'open',
    shape: 600,
    hosts: ['imgur.com'],
    oembed: null,
    frames: [
      ['^/a/(\\w+)', 'https://imgur.com/a/$1/embed'],
      ['^/gallery/(\\w+)', 'https://imgur.com/a/$1/embed'],
    ],
  },
  {
    id: 'asciinema',
    name: 'asciinema',
    mark: 'play',
    shape: 400,
    hosts: ['asciinema.org'],
    oembed: null,
    frames: [['^/a/(\\w+)', 'https://asciinema.org/a/$1/iframe']],
  },
  {
    id: 'coub',
    name: 'Coub',
    mark: 'play',
    shape: 'video',
    hosts: ['coub.com'],
    oembed: 'Coub',
    frames: [
      ['^/view/(\\w+)', 'https://coub.com/embed/$1'],
      ['^/embed/(\\w+)', 'https://coub.com/embed/$1'],
    ],
  },
  {
    id: 'scribd',
    name: 'Scribd',
    mark: 'open',
    shape: 600,
    hosts: ['scribd.com'],
    oembed: 'Scribd',
    frames: [['^/doc(?:ument)?/(\\d+)', 'https://www.scribd.com/embeds/$1/content']],
  },
]

interface Registered {
  provider_name?: string
  endpoints?: { schemes?: string[] }[]
}

async function registry(): Promise<Registered[]> {
  const answered = await fetch(REGISTRY)
  if (!answered.ok) throw new Error(`${REGISTRY} answered ${String(answered.status)}`)

  const read: unknown = await answered.json()
  if (!Array.isArray(read)) throw new Error(`${REGISTRY} is no longer a list of providers`)

  return read as Registered[]
}

function hostOf(scheme: string): string | null {
  let url: URL
  try {
    url = new URL(scheme)
  } catch {
    return null
  }

  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null

  const host = url.hostname.toLowerCase().replace(/^www\./, '')
  return host.includes('*') || host === '' ? null : host
}

function hostsOf(provider: Registered): string[] {
  const schemes = (provider.endpoints ?? []).flatMap((one) => one.schemes ?? [])
  return [...new Set(schemes.map(hostOf).filter((host): host is string => host !== null))]
}

function handWritten(): Set<string> {
  const source = readFileSync(HAND_WRITTEN, 'utf8')
  const found = [...source.matchAll(/hosts: \[([^\]]*)\]/g)].flatMap((one) =>
    [...(one[1] ?? '').matchAll(/'([^']+)'/g)].map((quoted) => quoted[1] ?? ''),
  )
  if (found.length < 9)
    throw new Error('providers.ts no longer spells its hosts out in `hosts: []`')

  return new Set(found)
}

function rows(known: Registered[], theirs: Set<string>): Rule[] {
  const byName = new Map(known.map((one) => [one.provider_name ?? '', one]))
  const registered = new Set(known.flatMap(hostsOf))
  const seen = new Set<string>()

  return RULES.map((rule) => {
    if (seen.has(rule.id)) throw new Error(`two rows are called \`${rule.id}\``)
    seen.add(rule.id)

    const hosts = new Set(rule.hosts)
    if (rule.oembed !== null) {
      const provider = byName.get(rule.oembed)
      if (provider === undefined) {
        throw new Error(`the registry no longer lists \`${rule.oembed}\` (row \`${rule.id}\`)`)
      }

      for (const host of hostsOf(provider)) hosts.add(host)
    } else {
      for (const host of rule.hosts) {
        if (registered.has(host)) {
          console.warn(`${rule.id}: the registry now names ${host}; give the row its provider name`)
        }
      }
    }

    for (const host of hosts) {
      if (theirs.has(host)) throw new Error(`\`${rule.id}\` claims ${host}, a hand-written host`)
      if (host !== host.toLowerCase() || host.startsWith('www.')) {
        throw new Error(`\`${rule.id}\` spells a host the table cannot match: ${host}`)
      }
    }

    for (const [from, to] of rule.frames) checked(rule, from, to)

    return { ...rule, hosts: [...hosts].sort() }
  })
}

function checked(rule: Rule, from: string, to: string): void {
  const captures = new RegExp(`${from}|`).exec('')?.length
  if (captures === undefined) throw new Error(`\`${rule.id}\`: ${from} is not a pattern`)

  if (!to.startsWith('https://')) throw new Error(`\`${rule.id}\`: ${to} is not an https address`)

  const after = to.slice('https://'.length).replaceAll('$path', '/')
  const first = /\$\w+/.exec(after)
  if (first !== null && !after.slice(0, first.index).includes('/')) {
    throw new Error(`\`${rule.id}\`: ${to} would let an address write its own host`)
  }

  for (const marker of to.matchAll(/\$\w+/g)) {
    const which = marker[0]
    if (which === '$path' || which === '$url') continue

    const at = Number(which.slice(1))
    if (!Number.isInteger(at) || at < 1 || at >= captures) {
      throw new Error(`\`${rule.id}\`: ${to} asks for ${which}, which ${from} does not capture`)
    }
  }
}

function table(listed: Rule[]): string {
  const written = listed.map(
    (row) =>
      `  {\n` +
      `    id: ${JSON.stringify(row.id)},\n` +
      `    name: ${JSON.stringify(row.name)},\n` +
      `    mark: ${JSON.stringify(row.mark)},\n` +
      `    shape: ${JSON.stringify(row.shape)},\n` +
      `    hosts: ${JSON.stringify(row.hosts)},\n` +
      `    frames: ${JSON.stringify(row.frames)},\n` +
      `  },`,
  )

  return `/* Generated by scripts/embed-table.ts, checked against https://oembed.com/providers.json.
 * Do not edit: run \`pnpm embed:table\`.
 *
 * The broad half of the list of places a note can show rather than link to: the
 * providers nobody has driven a frame of by hand, each one an address pattern and
 * the frame it turns into. ${String(listed.length)} rows, of which ${String(listed.filter((row) => row.oembed !== null).length)} are in the public oEmbed
 * registry - which is where their hosts come from, so a provider that takes on a
 * new domain is a regeneration rather than a rewrite. The rest publish an embed
 * address and no oEmbed endpoint at all, Google Drive and Twitch and gists and
 * Typeform among them, which is why this is a table and not a filter.
 *
 * What every field means, and what is done to a capture before it reaches a
 * frame, is in providers.ts. Nothing here is a frame: a row is read only when a
 * note points at one of its hosts, and what it yields is an address. */

import type { Listed } from './providers'

export const EMBEDDABLE: readonly Listed[] = [
${written.join('\n')}
]
`
}

function missing(known: Registered[], listed: Rule[]): string[] {
  const mine = new Set(listed.flatMap((row) => row.hosts))
  return known
    .filter((one) => hostsOf(one).length > 0 && !hostsOf(one).some((host) => mine.has(host)))
    .map((one) => one.provider_name ?? '')
    .sort()
}

const known = await registry()
const listed = rows(known, handWritten())
const source = await format(table(listed), {
  ...(await resolveConfig(TARGET)),
  filepath: TARGET,
})

writeFileSync(TARGET, source)

const absent = missing(known, listed)
const shown = absent.slice(0, 40)

console.log(
  `wrote ${TARGET} (${(source.length / 1024).toFixed(1)}kB, ${String(listed.length)} rows)`,
)
console.log(
  `${String(known.length)} providers in the registry, ${String(absent.length)} of them with no row here:`,
)
console.log(`${shown.join(', ')}${absent.length > shown.length ? ', …' : ''}`)
