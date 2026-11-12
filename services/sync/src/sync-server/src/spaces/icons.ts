import { Hono } from 'hono'
import { NOT_AN_OBJECT } from '../refused'
import { objectBody, objectIn } from '../body'
import { byteLength, now } from '../crypto'
import { MOST_BYTES } from './columns'
import type { Env, Variables } from '../types'
import { LONGEST_PATH, staysInside } from './paths'
import { atLeast, spaceOf } from './space'
import { deviceOf } from '../sync2/device'
import { v1Wrote } from '../sync2/maps'

const MOST = 400

const NAME = /^[A-Za-z0-9][A-Za-z0-9-]{0,63}$/
const LONGEST_MARK = 16
const NOT_A_MARK = /[A-Za-z0-9\s/\\]|\p{Cc}/u
const A_PICTURE = /\p{Extended_Pictographic}|\p{Regional_Indicator}/u

const PREFIXED = /^[a-z][a-z\d-]{0,31}:[A-Za-z0-9][A-Za-z0-9-]{0,63}$/

export function isIcon(value: string): boolean {
  if (NAME.test(value) || PREFIXED.test(value)) return true
  return value.length <= LONGEST_MARK && A_PICTURE.test(value) && !NOT_A_MARK.test(value)
}

const TINT = /^[a-z][a-z-]{0,31}$/

export function isTint(value: string): boolean {
  return TINT.test(value)
}

function inside(path: string): boolean {
  return !!path && path.length <= LONGEST_PATH && staysInside(path)
}

function wrong(value: unknown, called: string): string | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return `${called} must be a map`
  if (Object.keys(value).length > MOST) return `${called} holds at most ${MOST} folders`

  return null
}

function mapOf(value: object, said: (value: string) => boolean): Record<string, string> {
  const kept = Object.entries(value).filter(
    (entry): entry is [string, string] =>
      inside(entry[0]) && typeof entry[1] === 'string' && said(entry[1]),
  )

  return Object.fromEntries(kept.slice(0, MOST))
}

function read(raw: string, said: (value: string) => boolean): Record<string, string> {
  const held = objectIn(raw)
  return held ? mapOf(held, said) : {}
}

export function readIcons(raw: string): Record<string, string> {
  return read(raw, isIcon)
}

export function readTints(raw: string): Record<string, string> {
  return read(raw, isTint)
}

export const folderIcons = new Hono<{ Bindings: Env; Variables: Variables }>()

folderIcons.put('/:id/icons', atLeast('write'), async (context) => {
  const space = spaceOf(context)

  const body = await objectBody(context)
  if (!body) return context.json({ error: NOT_AN_OBJECT }, 400)

  const sent = body.icons
  const problem = wrong(sent, 'icons')
  if (problem) return context.json({ error: problem }, 400)

  const sentTints = body.tints
  const tintProblem = sentTints === undefined ? null : wrong(sentTints, 'tints')
  if (tintProblem) return context.json({ error: tintProblem }, 400)

  const kept = mapOf(sent as object, isIcon)
  const tints = sentTints === undefined ? null : mapOf(sentTints as object, isTint)
  const written = JSON.stringify(kept)
  const writtenTints = tints === null ? null : JSON.stringify(tints)
  if (byteLength(written) + byteLength(writtenTints ?? '') > MOST_BYTES.icons) {
    return context.json({ error: 'that is more folder icons than a space holds' }, 413)
  }

  await context.env.DB.prepare(
    'update spaces set icons = ?1, tints = coalesce(?2, tints), updated_at = ?3 where id = ?4',
  )
    .bind(written, writtenTints, now(), space.id)
    .run()
  await v1Wrote(
    context.env,
    space,
    'icon',
    { icons: kept, tints: tints ?? readTints(space.tints) },
    await deviceOf(context),
  )

  return context.json({ icons: kept, tints: tints ?? readTints(space.tints) })
})
