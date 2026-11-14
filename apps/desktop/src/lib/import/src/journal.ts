import { destination, htmlToMarkdown } from '@orden/markdown/from-html'

import { folderPlan, isJunk } from './folder'
import { dayOf } from './meta'
import { Names, safeName } from './names'
import type { ImportPlan } from './plan'
import type { Source } from './sources'
import { closingOf, tagsIn, unescapeXml } from './xml'

const ENTRY = /(^|\/)entries\/[^/]+\.html?$/i

const RESOURCE = /(^|\/)resources\/[^/]+$/i

const HEIC = /\.(heic|heif)$/i

const DAY = /(\d{4}-\d{2}-\d{2})/

const MEDIA = new Set(['img', 'video', 'audio', 'source'])

const DRAWN = /assetType_(stateOfMind|motionActivity|genericMap|multiPinMap)\b/i

interface Entry {
  date: string | null
  title: string
  body: string
  drawn: number
}

export async function readJournal(sources: readonly Source[]): Promise<ImportPlan> {
  const names = new Names()
  const entries = new Map<string, Entry>()
  let drawn = 0
  let heic = 0
  let missing = 0

  const held = new Set(
    sources
      .filter((one) => RESOURCE.test(one.path))
      .map((one) => (one.path.split('/').pop() ?? one.path).toLowerCase()),
  )

  for (const source of sources) {
    if (isJunk(source.path) || !ENTRY.test(source.path)) continue
    const html = await source.text()
    const entry = entryOf(html, source.path)
    drawn += entry.drawn
    missing += mediaNames(html).filter((name) => !held.has(name.toLowerCase())).length
    entries.set(source.path, entry)
  }

  const plan = await folderPlan(sources, {
    format: 'journal',
    place: (source) => {
      const entry = entries.get(source.path)
      if (entry) {
        return {
          to: names.free(`${nameFor(entry, source.path)}.md`),
          read: () => ({
            text: entry.body,
            title: entry.title || null,
            meta: { date: entry.date },
          }),
        }
      }

      if (isJunk(source.path) || !RESOURCE.test(source.path)) return { to: null }

      if (/\.json$/i.test(source.path)) return { to: null }

      const name = source.path.split('/').pop() ?? source.path
      if (HEIC.test(name)) heic += 1

      return { to: names.free(`assets/${safeName(name)}`) }
    },
  })

  if (heic) {
    plan.lost.push(`${heic} pictures came as HEIC, which nothing but Apple shows`)
  }

  if (drawn) {
    plan.lost.push(`${drawn} mood and activity cards are drawings, so only their words come over`)
  }

  if (missing) {
    plan.lost.push(
      missing === 1
        ? '1 attachment was missing from the export or could not be read'
        : `${missing} attachments were missing from the export or could not be read`,
    )
  }

  return plan
}

function mediaNames(html: string): string[] {
  const names = new Set<string>()

  for (const tag of tagsIn(html)) {
    if (tag.closing || !MEDIA.has(tag.name.toLowerCase())) continue

    const source = (tag.attributes.src ?? '').trim()
    if (!/(^|\/)resources\//i.test(source)) continue

    const name = source.split(/[?#]/)[0]?.split('/').pop() ?? ''
    try {
      names.add(decodeURIComponent(name))
    } catch {
      names.add(name)
    }
  }

  return [...names].filter(Boolean)
}

function nameFor(entry: Entry, path: string): string {
  const said = [entry.date, entry.title].filter(Boolean).join(' ')
  if (said) return safeName(said)

  const name = path.split('/').pop() ?? path
  return safeName(name.replace(/\.html?$/i, ''))
}

function entryOf(html: string, path: string): Entry {
  const header = divWithClass(html, 'pageHeader')
  const title = divWithClass(html, 'title')

  let rest = html
  for (const cut of [header, title].filter(isSpan).sort((one, two) => two.from - one.from)) {
    rest = rest.slice(0, cut.from) + rest.slice(cut.to)
  }

  const name = path.split('/').pop() ?? path
  const date = dayOf(DAY.exec(name)?.[1]) ?? dayOf(words(header?.inner ?? ''))

  return {
    date,
    title: words(title?.inner ?? ''),
    body: withMedia(
      htmlToMarkdown(rest, { fileTargets: true, appTargets: true, plainTasks: true }),
      html,
    ),
    drawn: drawnCards(html),
  }
}

interface Span {
  from: number
  to: number
  inner: string
}

function divWithClass(html: string, wanted: string): Span | null {
  for (const tag of tagsIn(html)) {
    if (tag.closing || tag.name.toLowerCase() !== 'div') continue
    if (!named(tag.attributes.class ?? '', wanted)) continue
    if (tag.empty) return { from: tag.from, to: tag.to, inner: '' }

    const closes = closingOf(html, tag.name, tag.to)
    const after = html.indexOf('>', closes)

    return {
      from: tag.from,
      to: after < 0 ? html.length : after + 1,
      inner: html.slice(tag.to, closes),
    }
  }

  return null
}

function named(attribute: string, wanted: string): boolean {
  return attribute.split(/\s+/).includes(wanted)
}

function isSpan(span: Span | null): span is Span {
  return !!span
}

function words(inner: string): string {
  return unescapeXml(inner.replace(/<[^>]*>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim()
}

function withMedia(markdown: string, html: string): string {
  const missing: string[] = []

  for (const tag of tagsIn(html)) {
    if (tag.closing || !MEDIA.has(tag.name.toLowerCase())) continue

    const source = (tag.attributes.src ?? '').trim()
    if (!source || source.startsWith('data:')) continue

    const name = source.split('/').pop() ?? source
    if (markdown.includes(name) || missing.includes(source)) continue
    missing.push(source)
  }

  return [markdown, ...missing.map((source) => `![](${destination(source)})`)]
    .filter(Boolean)
    .join('\n\n')
}

function drawnCards(html: string): number {
  let drawn = 0

  for (const tag of tagsIn(html)) {
    if (tag.closing || tag.name.toLowerCase() !== 'div') continue
    if (DRAWN.test(tag.attributes.class ?? '')) drawn += 1
  }

  return drawn
}
