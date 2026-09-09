import type { DomainStatus } from './api'
import { isRecord, isString } from './stored'

const STATES: DomainStatus['state'][] = [
  'none',
  'unproved',
  'pending',
  'active',
  'error',
  'unconfigured',
]

/** Whether this is a status the pane can show.
 *
 *  Asked of one place only: the body of a refusal. Saying the record is in place
 *  when it is not is answered with the state the domain is in rather than with a
 *  bare failure, and a body that arrives inside an error is as unknown as any
 *  other thing off the network. */
export function isDomainStatus(value: unknown): value is DomainStatus {
  return (
    isRecord(value) &&
    STATES.some((one) => one === value.state) &&
    Array.isArray(value.dns) &&
    (value.detail === null || isString(value.detail))
  )
}

/** A line under the records: what is happening with the domain, in which
 *  colour, and Cloudflare's own words about it when it has some. */
export interface Notice {
  tone: 'muted' | 'ok' | 'bad'
  text: string
  detail: string | null
}

export function domainNotice(status: DomainStatus): Notice | null {
  switch (status.state) {
    case 'none':
      return null
    // The records are on screen and there is a button under them, which says
    // what to do without a sentence saying it as well. What is worth a line is a
    // verify that did not find the record.
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

/** Whether the answer can still change by itself. A record on its way will
 *  show up; trouble may be something the owner is fixing right now. A domain
 *  that works, or a server that cannot do this, stays as it is - and so does one
 *  waiting to be proved, which waits on the button rather than on the clock. */
export function keepAsking(status: DomainStatus | null): boolean {
  return status?.state === 'pending' || status?.state === 'error'
}
