import type { AliasProvider } from '@orden/pass/types'

export type AliasService = Exclude<AliasProvider, 'manual'>

export interface AliasMailbox {
  id: string
  email: string
  isDefault: boolean
}

interface AliasSuffix {
  value: string
  label: string
  premium: boolean
}

export interface AliasOptions {
  prefix: string
  suffixes: AliasSuffix[]
  mailboxes: AliasMailbox[]
  canCreate: boolean
}

export interface AliasMade {
  remoteId: string
  address: string
  enabled: boolean
  mailboxes: string[]
  name: string
  note: string
}

export interface AliasAsk {
  prefix: string
  suffix: string
  mailboxes: string[]
  name: string
  note: string
}

export interface AliasStats {
  forwarded: number
  replied: number
  blocked: number
  days: number | null
}

export interface AliasClient {
  mailboxes(): Promise<AliasMailbox[]>
  options(hostname?: string): Promise<AliasOptions>
  create(ask: AliasAsk, hostname?: string): Promise<AliasMade>
  random(note: string, hostname?: string): Promise<AliasMade>
  setEnabled(remoteId: string, on: boolean): Promise<boolean>
  remove(remoteId: string): Promise<void>
  stats(remoteId: string, now?: number, days?: number): Promise<AliasStats | null>
}

export type AliasFetcher = (input: string, init: RequestInit) => Promise<Response>

export class AliasRefused extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
    this.name = 'AliasRefused'
  }
}

export type Fields = Record<string, unknown>

export function unreadable(): Error {
  return new Error('pass: unreadable alias answer')
}

export function fieldsOf(value: unknown): Fields {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw unreadable()
  return value as Fields
}

export function listOf(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw unreadable()
  return value
}

export function textOf(value: unknown): string {
  if (typeof value === 'string') return value
  if (value === null || value === undefined) return ''
  throw unreadable()
}

export function idOf(value: unknown): string {
  if (typeof value === 'number' && Number.isSafeInteger(value)) return String(value)
  if (typeof value === 'string' && value !== '') return value
  throw unreadable()
}

export function countOf(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0
}

function said(body: unknown, status: number): string {
  if (typeof body === 'object' && body !== null) {
    const { error, message } = body as Fields
    if (typeof error === 'string' && error !== '') return error
    if (typeof message === 'string' && message !== '') return message
  }
  return `the alias service refused (${String(status)})`
}

export async function answerOf(
  fetcher: AliasFetcher,
  url: string,
  init: RequestInit,
): Promise<unknown> {
  const response = await fetcher(url, init)
  const text = await response.text()
  let body: unknown
  try {
    body = text === '' ? null : JSON.parse(text)
  } catch {
    body = null
  }
  if (!response.ok) throw new AliasRefused(response.status, said(body, response.status))
  return body
}

export function withQuery(url: string, query: Record<string, string | undefined>): string {
  const pairs = Object.entries(query).filter(
    (one): one is [string, string] => one[1] !== undefined && one[1] !== '',
  )
  return pairs.length ? `${url}?${new URLSearchParams(pairs).toString()}` : url
}
