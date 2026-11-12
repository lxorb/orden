import { Hono } from 'hono'
import { NOT_AN_OBJECT } from '../refused'
import { objectBody, objectIn } from '../body'
import { fits, writeColumn } from './columns'
import type { Env, Variables } from '../types'
import { atLeast, spaceOf } from './space'
import { deviceOf } from '../sync2/device'
import { v1Wrote } from '../sync2/maps'

const MOST_GROUPS = 6
const LONGEST_QUERY = 200
const LEAST_SPREAD = 0.25
const MOST_SPREAD = 4
const LEAST_DISTANCE = 12
const MOST_DISTANCE = 96
const LEAST_PUSH = 40
const MOST_PUSH = 400
const SHALLOWEST = 1
const DEEPEST = 5
const LEAST_LINES = 1
const MOST_LINES = 3
const LEAST_FADE = 0.25
const MOST_FADE = 4

interface ColourGroup {
  query: string
  colour: number
}

interface GraphSettings {
  filter?: string
  orphans?: boolean
  attachments?: boolean
  groups?: ColourGroup[]
  spread?: number
  gather?: boolean
  distance?: number
  push?: number
  arrows?: boolean
  sized?: boolean
  lines?: number
  fade?: number
  depth?: number
}

function wrong(value: unknown): string | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return 'graph must be an object'

  const sent = value as Record<string, unknown>
  if (typeof sent.filter === 'string' && sent.filter.length > LONGEST_QUERY) {
    return `a filter is at most ${LONGEST_QUERY} characters`
  }
  if (Array.isArray(sent.groups) && sent.groups.length > MOST_GROUPS) {
    return `a space colours at most ${MOST_GROUPS} groups`
  }

  return null
}

function held(value: unknown, least: number, most: number): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined
  return Math.min(most, Math.max(least, value))
}

function switched(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined
}

function groupsOf(value: unknown): ColourGroup[] | undefined {
  if (!Array.isArray(value)) return undefined

  const out: ColourGroup[] = []
  for (const one of value) {
    if (out.length >= MOST_GROUPS) break
    if (!one || typeof one !== 'object' || Array.isArray(one)) continue

    const sent = one as Record<string, unknown>
    if (typeof sent.query !== 'string') continue

    out.push({
      query: sent.query.slice(0, LONGEST_QUERY),
      colour: Math.round(held(sent.colour, 1, MOST_GROUPS) ?? 1),
    })
  }

  return out
}

function settingsOf(value: object): GraphSettings {
  const sent = value as Record<string, unknown>
  const out: GraphSettings = {}

  if (typeof sent.filter === 'string') out.filter = sent.filter.slice(0, LONGEST_QUERY)

  const orphans = switched(sent.orphans)
  if (orphans !== undefined) out.orphans = orphans

  const attachments = switched(sent.attachments)
  if (attachments !== undefined) out.attachments = attachments

  const groups = groupsOf(sent.groups)
  if (groups !== undefined) out.groups = groups

  const spread = held(sent.spread, LEAST_SPREAD, MOST_SPREAD)
  if (spread !== undefined) out.spread = spread

  const gather = switched(sent.gather)
  if (gather !== undefined) out.gather = gather

  const distance = held(sent.distance, LEAST_DISTANCE, MOST_DISTANCE)
  if (distance !== undefined) out.distance = Math.round(distance)

  const push = held(sent.push, LEAST_PUSH, MOST_PUSH)
  if (push !== undefined) out.push = Math.round(push)

  const arrows = switched(sent.arrows)
  if (arrows !== undefined) out.arrows = arrows

  const sized = switched(sent.sized)
  if (sized !== undefined) out.sized = sized

  const lines = held(sent.lines, LEAST_LINES, MOST_LINES)
  if (lines !== undefined) out.lines = Math.round(lines)

  const fade = held(sent.fade, LEAST_FADE, MOST_FADE)
  if (fade !== undefined) out.fade = fade

  const depth = held(sent.depth, SHALLOWEST, DEEPEST)
  if (depth !== undefined) out.depth = Math.round(depth)

  return out
}

export function readGraph(raw: string): GraphSettings {
  const held = objectIn(raw)
  return held ? settingsOf(held) : {}
}

export const spaceGraph = new Hono<{ Bindings: Env; Variables: Variables }>()

spaceGraph.put('/:id/graph', atLeast('write'), async (context) => {
  const space = spaceOf(context)

  const body = await objectBody(context)
  if (!body) return context.json({ error: NOT_AN_OBJECT }, 400)

  const sent = body.graph
  const problem = wrong(sent)
  if (problem) return context.json({ error: problem }, 400)

  const kept = settingsOf(sent as object)
  const written = JSON.stringify(kept)
  if (!fits(written, 'graph')) {
    return context.json({ error: 'that is more than a space keeps about its graph' }, 413)
  }

  await writeColumn(context.env, 'graph', space.id, written)
  await v1Wrote(context.env, space, 'graph', kept, await deviceOf(context))

  return context.json({ graph: kept })
})
