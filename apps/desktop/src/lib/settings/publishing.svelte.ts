/** The publish form: the two addresses a space can be reached by, and which of
 *  them is being offered.
 *
 *  One or the other, never both - a domain of one's own replaces the shared
 *  name - so the choice is the control rather than a pair of fields that could
 *  disagree. The form is filled from what the account already holds every time
 *  the panel opens, so it never shows a half-typed address from last time. */

import { settings } from '../settings.svelte'
import { workspace } from '../workspace.svelte'

export type Address = 'subdomain' | 'domain'

export class Publishing {
  subdomain = $state('')
  domain = $state('')
  /** Which kind of address the blog is reached by. */
  address = $state<Address>('subdomain')
  /** Empty means the whole space; otherwise the one note's path in it. */
  note = $state('')
  /** Publishing is a public act, so it is asked about outright rather than
   *  assumed from the button being pressed. */
  confirmed = $state(false)

  private checkTimer: ReturnType<typeof setTimeout> | undefined

  /** Fills the form from what the account holds. */
  fill(blog: { subdomain: string | null; domain: string | null; note: string | null } | undefined) {
    this.subdomain = blog?.subdomain ?? ''
    this.domain = blog?.domain ?? ''
    this.address = blog?.domain ? 'domain' : 'subdomain'
    this.note = blog?.note ?? ''
  }

  /** Only the characters a subdomain may hold, and the availability check a
   *  moment after the typing stops rather than on every keystroke. */
  typeSubdomain(value: string) {
    this.subdomain = value.toLowerCase().replace(/[^a-z0-9-]/g, '')

    clearTimeout(this.checkTimer)
    this.checkTimer = setTimeout(() => void settings.checkSubdomain(this.subdomain), 260)
  }

  get ready(): boolean {
    return !settings.busy && (this.address === 'subdomain' ? !!this.subdomain : !!this.domain)
  }

  /** Only the chosen address goes up; the server lets the other one go. */
  publish() {
    const note = this.note || null
    void settings.publish(
      this.address === 'subdomain'
        ? { subdomain: this.subdomain, note }
        : { domain: this.domain, note },
    )
  }
}

/** The path the server knows a note by: relative to its space, forward
 *  slashed, whatever separator the machine writes. */
export function relativeToSpace(path: string): string {
  const root = workspace.activeSpace?.root ?? ''
  return path
    .slice(root.length)
    .replace(/^[\\/]+/, '')
    .replace(/\\/g, '/')
}
