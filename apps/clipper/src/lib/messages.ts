/** What the three halves of the extension say to each other.
 *
 *  The popup draws, the service worker clips and saves, the content script
 *  reads the page. `chrome.runtime.sendMessage` hands whatever it is given
 *  straight across, so every message is checked on arrival into one of the
 *  shapes below, and a message that does not fit is a message that never
 *  happened. */

import type { Origin } from './extract'
import { type Kind, KINDS } from './kinds'
import { isRecord, isString, listOf } from './stored'

/** A clip that has been read and converted but not yet saved: what the popup
 *  previews, and what it sends back when Save is pressed. The article's HTML is
 *  deliberately not in here - the markdown has replaced it, and a megabyte of
 *  it would cross between the two contexts twice for nothing. */
export interface Clip {
  origin: Origin
  /** When the page was read, so the preview and the saved note record the same
   *  instant rather than two a few seconds apart. */
  clipped: string
  /** With `nib:0` style placeholders where the pictures go; see `markdown.ts`. */
  markdown: string
  images: string[]
}

export type Ask =
  { ask: 'clip'; kind: Kind } | { ask: 'save'; clip: Clip; spaceId: string; folder: string }

/** Either half of a clip, answered. Each carries what it produced or the one
 *  sentence saying why it produced nothing. */
export type Clipped = { clip: Clip } | { problem: string }
export type Saved = { path: string } | { problem: string }
export type Answer = Clipped | Saved

/** What the worker asks the page for. `link` is the address the context menu
 *  was opened on, and is null everywhere else. */
export interface Reading {
  read: Kind
  link: string | null
}

function readKind(value: unknown): Kind | null {
  return KINDS.find((one) => one === value) ?? null
}

function readOrigin(value: unknown): Origin | null {
  if (!isRecord(value)) return null

  const kind = readKind(value.kind)
  if (!kind || !isString(value.url) || !isString(value.title)) return null

  return {
    kind,
    url: value.url,
    title: value.title,
    tags: listOf(value.tags, (one) => (isString(one) ? one : null)),
  }
}

export function readClip(value: unknown): Clip | null {
  if (!isRecord(value)) return null

  const origin = readOrigin(value.origin)
  if (!origin || !isString(value.markdown) || !isString(value.clipped)) return null

  return {
    origin,
    clipped: value.clipped,
    markdown: value.markdown,
    images: listOf(value.images, (one) => (isString(one) ? one : null)),
  }
}

export function readAsk(value: unknown): Ask | null {
  if (!isRecord(value)) return null

  if (value.ask === 'clip') {
    const kind = readKind(value.kind)
    return kind ? { ask: 'clip', kind } : null
  }

  if (value.ask === 'save') {
    const clip = readClip(value.clip)
    if (!clip || !isString(value.spaceId) || !isString(value.folder)) return null

    return { ask: 'save', clip, spaceId: value.spaceId, folder: value.folder }
  }

  return null
}

export function readReading(value: unknown): Reading | null {
  if (!isRecord(value)) return null

  const kind = readKind(value.read)
  return kind ? { read: kind, link: isString(value.link) ? value.link : null } : null
}

export function readAnswer(value: unknown): Answer | null {
  if (!isRecord(value)) return null
  if (isString(value.problem)) return { problem: value.problem }
  if (isString(value.path)) return { path: value.path }

  const clip = readClip(value.clip)
  return clip ? { clip } : null
}

/** The worker, asked. A worker that was stopped and could not start, or one
 *  that threw before answering, reads as no answer rather than as a throw at
 *  the call site. */
export async function ask(request: Ask): Promise<Answer | null> {
  try {
    return readAnswer(await chrome.runtime.sendMessage(request))
  } catch {
    return null
  }
}
