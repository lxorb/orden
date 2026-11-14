import { said, type Said, words, yes } from '../automation/args'
import type { AgentAnswer, Caller } from '../automation/caller'
import type { Agent as Writer } from '../agents/src/api'
import { Refused } from './problem'

export interface Call {
  verb: string
  args: Said
  caller: Caller
}

export function need(call: Call, name: string): string {
  const value = said(call.args, name)
  if (value === null) throw new Refused('bad_arguments', `say ${name}`)

  return value
}

const LONGEST_QUERY = 1000

export function short(name: string, value: string): string {
  if (value.length > LONGEST_QUERY) {
    throw new Refused('bad_arguments', `${name} is at most ${LONGEST_QUERY} characters`)
  }
  return value
}

export function maybe(call: Call, name: string): string | null {
  return said(call.args, name)
}

export function text(call: Call, name: string): string | null {
  return words(call.args, name)
}

export function flag(call: Call, name: string): boolean {
  return yes(call.args, name)
}

export function count(call: Call, name: string, fallback: number, most: number): number {
  const value = Number(call.args[name])
  if (!Number.isFinite(value)) return fallback

  return Math.min(Math.max(1, Math.floor(value)), most)
}

export function done(result: unknown, untrusted?: string | null): AgentAnswer {
  return untrusted
    ? { ok: true, status: 'ok', result, untrusted }
    : { ok: true, status: 'ok', result }
}

export function sourceOf(call: Call): string | undefined {
  return call.caller.agent?.name
}

export function writerOf(call: Call): Writer {
  const caller = call.caller
  if (!caller.agent) return { id: 'cli', name: 'orden' }
  const { id, name } = caller.agent
  return caller.thread ? { id, name, thread: caller.thread } : { id, name }
}

function holding(call: Call, scope: string): boolean {
  return call.caller.agent === null || call.caller.agent.scopes.includes(scope)
}

export function needScope(call: Call, scope: string, why: string): void {
  if (!holding(call, scope)) {
    throw new Refused('not_granted', `${why} needs ${scope}, which this agent was not granted`)
  }
}
