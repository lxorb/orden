import type { AgentAnswer, AgentCaller as Caller, AgentScope as Scope } from '@orden/contracts'
import { holds, said, type Said, words, yes } from '../../automation/src/api'
import type { Agent as Writer } from '../../agent-docs/src/api'
import { Refused } from './problem'

export interface Call {
  verb: string
  args: Said
  caller: Caller
  deadline?: AbortSignal
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
  const sent = call.args[name]
  const value = sent === null ? Number.NaN : Number(sent)
  if (!Number.isFinite(value)) return fallback

  return Math.min(Math.max(1, Math.floor(value)), most)
}

export function done(result: unknown, untrusted?: string | null): AgentAnswer {
  return untrusted
    ? { ok: true, status: 'ok', result, untrusted }
    : { ok: true, status: 'ok', result }
}

export function ranOut(before: string): Refused {
  return new Refused('timeout', `the time to answer ran out before ${before}, so nothing was done`)
}

export function inTime(call: Call, before: string): void {
  if (call.deadline?.aborted) throw ranOut(before)
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

export function needScope(call: Call, scope: Scope, why: string): void {
  if (!holds(call.caller, scope)) {
    throw new Refused('not_granted', `${why} needs ${scope}, which this agent was not granted`)
  }
}
