import type { DomainStatus } from './accounts/src/api'
import { isRecord, isString } from './stored'

const STATES: DomainStatus['state'][] = [
  'none',
  'unproved',
  'pending',
  'active',
  'error',
  'unconfigured',
]

export function isDomainStatus(value: unknown): value is DomainStatus {
  return (
    isRecord(value) &&
    STATES.some((one) => one === value.state) &&
    Array.isArray(value.dns) &&
    (value.detail === null || isString(value.detail))
  )
}

export interface Notice {
  tone: 'muted' | 'ok' | 'bad'
  text: string
  detail: string | null
}

export function domainNotice(status: DomainStatus): Notice | null {
  switch (status.state) {
    case 'none':
      return null
    case 'unproved':
      return status.detail ? { tone: 'bad', text: status.detail, detail: null } : null
    case 'pending':
      return { tone: 'muted', text: 'Waiting for the record to show up.', detail: status.detail }
    case 'active':
      return { tone: 'ok', text: 'Certificate issued.', detail: null }
    case 'error':
      return {
        tone: 'bad',
        text: 'Cloudflare could not set this domain up.',
        detail: status.detail,
      }
    case 'unconfigured':
      return {
        tone: 'muted',
        text: 'This server does not hand out certificates yet.',
        detail: null,
      }
  }
}

export function keepAsking(status: DomainStatus | null): boolean {
  return status?.state === 'pending' || status?.state === 'error'
}
