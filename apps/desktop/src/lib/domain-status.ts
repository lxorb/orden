import type { DomainStatus } from './api'

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
    case 'pending':
      return { tone: 'muted', text: 'Waiting for the record to show up.', detail: status.detail }
    case 'active':
      return { tone: 'ok', text: 'Certificate issued.', detail: null }
    case 'error':
      return { tone: 'bad', text: 'Cloudflare could not set this domain up.', detail: status.detail }
    case 'unconfigured':
      return { tone: 'muted', text: 'This server does not hand out certificates yet.', detail: null }
  }
}

/** Whether the answer can still change by itself. A record on its way will
 *  show up; trouble may be something the owner is fixing right now. A domain
 *  that works, or a server that cannot do this, stays as it is. */
export function keepAsking(status: DomainStatus | null): boolean {
  return status?.state === 'pending' || status?.state === 'error'
}
